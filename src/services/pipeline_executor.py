"""Pipeline executor — walks a DAG and dispatches agent nodes via CoreAgents."""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

import httpx

from src.config import settings


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

    async def dispatch_node(self, node: dict, previous_outputs: dict[str, Any], run_inputs: dict[str, Any]) -> dict[str, Any]:
        config = node.get("configuration", {})
        agent_id = config.get("agent_id", node["type"].replace("ops-agent-", ""))
        mode = config.get("mode", "pipeline")

        payload = {
            "agent_id": agent_id,
            "run_id": "pipeline",
            "stage_id": node["id"],
            "project_id": "pipeline",
            "brand_config": {},
            "previous_outputs": previous_outputs,
            "payload": {
                "mode": mode,
                **run_inputs,
                **config.get("payload_overrides", {}),
            },
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

                result = await self.dispatch_node(node, upstream, run_inputs)
                node_outputs[node_id] = result
                if on_node_complete:
                    await on_node_complete(node_id, result)
            except Exception as exc:
                failed_nodes.add(node_id)
                if on_node_error:
                    await on_node_error(node_id, str(exc))

        return node_outputs
