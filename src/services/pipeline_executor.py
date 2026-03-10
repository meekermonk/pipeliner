"""Pipeline executor — walks a DAG and dispatches agent nodes via CoreAgents."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

import httpx

from src.config import settings
from src.services.file_parser import extract_text

# Google Workspace MIME types and their export formats
_GOOGLE_MIME_MAP = {
    "application/vnd.google-apps.document": ("text/plain", ".txt"),
    "application/vnd.google-apps.spreadsheet": ("text/csv", ".csv"),
    "application/vnd.google-apps.presentation": ("text/plain", ".txt"),
}


class PipelineExecutor:

    def topological_sort(self, nodes: list[dict], edges: list[dict]) -> list[dict]:
        node_map = {n["id"]: n for n in nodes}
        in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
        adjacency: dict[str, list[str]] = defaultdict(list)

        for edge in edges:
            src = edge.get("from_node") or edge.get("from")
            dst = edge.get("to_node") or edge.get("to")
            if src and dst:
                adjacency[src].append(dst)
                in_degree[dst] = in_degree.get(dst, 0) + 1

        queue = deque(nid for nid, deg in in_degree.items() if deg == 0)
        result: list[dict] = []

        while queue:
            nid = queue.popleft()
            result.append(node_map[nid])
            for neighbor in adjacency[nid]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(result) != len(nodes):
            raise ValueError("Cycle detected in pipeline graph")
        return result

    def gather_inputs(self, node_id: str, edges: list[dict], node_outputs: dict[str, dict]) -> dict[str, Any]:
        inputs: dict[str, Any] = {}
        for edge in edges:
            src = edge.get("from_node") or edge.get("from")
            dst = edge.get("to_node") or edge.get("to")
            if dst == node_id and src in node_outputs:
                inputs.update(node_outputs[src])
        return inputs

    def _assemble_grounding_context(self, run_inputs: dict[str, Any]) -> str:
        """Concatenate text_content from all grounding_docs into a single string."""
        docs = run_inputs.get("grounding_docs", [])
        parts = [d["text_content"] for d in docs if d.get("text_content")]
        return "\n\n---\n\n".join(parts)

    async def handle_drive_pull(self, node: dict, run_inputs: dict[str, Any]) -> dict[str, Any]:
        """Fetch a file from Google Drive, extract text, return as node output."""
        config = node.get("configuration", {})
        file_id = config.get("file_id", "")
        mime_type = config.get("mime_type", "")
        access_token = run_inputs.get("access_token", "")

        if not file_id or not access_token:
            raise ValueError("io-google-drive pull requires file_id in configuration and access_token in run_inputs")
        if not mime_type:
            raise ValueError("io-google-drive pull requires mime_type in configuration")

        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            if mime_type in _GOOGLE_MIME_MAP:
                export_mime, _ext = _GOOGLE_MIME_MAP[mime_type]
                resp = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{file_id}/export",
                    params={"mimeType": export_mime},
                    headers=headers,
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.content
                content_type = export_mime
            else:
                resp = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{file_id}",
                    params={"alt": "media"},
                    headers=headers,
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.content
                content_type = mime_type

        text_content = extract_text(data, content_type)
        return {"text_content": text_content[:50000]}

    async def handle_drive_push(self, node: dict, upstream: dict[str, Any], run_inputs: dict[str, Any]) -> dict[str, Any]:
        """Create a Google Doc from upstream content via CoreAgents export proxy."""
        config = node.get("configuration", {})
        title = config.get("title", "Pipeline Output")
        folder_id = config.get("folder_id")
        access_token = run_inputs.get("access_token", "")
        content = upstream.get("text_content", upstream.get("content", ""))

        if not access_token:
            raise ValueError("io-google-drive push requires access_token in run_inputs")

        payload = {
            "title": title,
            "content": content,
            "access_token": access_token,
        }
        if folder_id:
            payload["folder_id"] = folder_id

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.coreagents_base_url}/export/docs",
                json=payload,
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()

    async def dispatch_node(self, node: dict, previous_outputs: dict[str, Any], run_inputs: dict[str, Any]) -> dict[str, Any]:
        config = node.get("configuration", {})
        agent_id = config.get("agent_id", node["type"].replace("ops-agent-", ""))
        mode = config.get("mode", "pipeline")

        grounding_context = self._assemble_grounding_context(run_inputs)

        inner_payload: dict[str, Any] = {
            "mode": mode,
            **run_inputs,
            **config.get("payload_overrides", {}),
        }
        if grounding_context:
            inner_payload["brief_context"] = grounding_context

        payload = {
            "agent_id": agent_id,
            "run_id": "pipeline",
            "stage_id": node["id"],
            "project_id": "pipeline",
            "brand_config": {},
            "previous_outputs": previous_outputs,
            "payload": inner_payload,
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.coreagents_base_url}/dispatch",
                json=payload,
                timeout=300.0,
            )
            resp.raise_for_status()
            return resp.json()

    async def execute(
        self, template: dict, run_inputs: dict[str, Any],
        on_node_start=None, on_node_complete=None, on_node_error=None,
    ) -> dict[str, Any]:
        nodes = template.get("nodes", [])
        edges = template.get("edges", [])
        sorted_nodes = self.topological_sort(nodes, edges)
        node_outputs: dict[str, dict] = {}
        failed_nodes: set[str] = set()

        upstream_map: dict[str, set[str]] = defaultdict(set)
        for edge in edges:
            src = edge.get("from_node") or edge.get("from")
            dst = edge.get("to_node") or edge.get("to")
            if src and dst:
                upstream_map[dst].add(src)

        for node in sorted_nodes:
            node_id = node["id"]

            if upstream_map[node_id] & failed_nodes:
                failed_nodes.add(node_id)
                if on_node_error:
                    await on_node_error(node_id, "skipped: upstream node failed")
                continue

            if on_node_start:
                await on_node_start(node_id)

            try:
                upstream = self.gather_inputs(node_id, edges, node_outputs)

                if node.get("type") == "utility-human-review":
                    if on_node_complete:
                        await on_node_complete(node_id, {"status": "awaiting_review"})
                    node_outputs[node_id] = {"status": "awaiting_review"}
                    continue

                if node.get("type") == "io-google-drive":
                    mode = node.get("configuration", {}).get("mode", "pull")
                    if mode == "pull":
                        result = await self.handle_drive_pull(node, run_inputs)
                    else:
                        result = await self.handle_drive_push(node, upstream, run_inputs)
                    node_outputs[node_id] = result
                    if on_node_complete:
                        await on_node_complete(node_id, result)
                    continue

                result = await self.dispatch_node(node, upstream, run_inputs)
                node_outputs[node_id] = result
                if on_node_complete:
                    await on_node_complete(node_id, result)
            except Exception as exc:
                failed_nodes.add(node_id)
                if on_node_error:
                    await on_node_error(node_id, str(exc))

        return node_outputs
