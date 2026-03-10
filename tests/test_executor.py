"""Tests for PipelineExecutor — Google Drive nodes and grounding injection."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.services.pipeline_executor import PipelineExecutor


def _make_response(status_code=200, *, json=None, content=None):
    """Build an httpx.Response with a dummy request so raise_for_status works."""
    kwargs = {"status_code": status_code}
    if json is not None:
        import json as _json
        kwargs["content"] = _json.dumps(json).encode()
        kwargs["headers"] = {"content-type": "application/json"}
    elif content is not None:
        kwargs["content"] = content
    resp = httpx.Response(**kwargs)
    resp._request = httpx.Request("GET", "https://test")
    return resp


@pytest.fixture
def executor():
    return PipelineExecutor()


# ---------------------------------------------------------------------------
# Grounding context assembly
# ---------------------------------------------------------------------------


class TestGroundingContext:
    def test_empty_when_no_docs(self, executor):
        result = executor._assemble_grounding_context({})
        assert result == ""

    def test_empty_when_docs_list_empty(self, executor):
        result = executor._assemble_grounding_context({"grounding_docs": []})
        assert result == ""

    def test_single_doc(self, executor):
        docs = [{"text_content": "Hello world"}]
        result = executor._assemble_grounding_context({"grounding_docs": docs})
        assert result == "Hello world"

    def test_multiple_docs_joined(self, executor):
        docs = [
            {"text_content": "Doc one"},
            {"text_content": "Doc two"},
            {"text_content": "Doc three"},
        ]
        result = executor._assemble_grounding_context({"grounding_docs": docs})
        assert result == "Doc one\n\n---\n\nDoc two\n\n---\n\nDoc three"

    def test_skips_empty_text_content(self, executor):
        docs = [
            {"text_content": "Good"},
            {"text_content": ""},
            {"text_content": "Also good"},
        ]
        result = executor._assemble_grounding_context({"grounding_docs": docs})
        assert result == "Good\n\n---\n\nAlso good"

    def test_skips_missing_text_content(self, executor):
        docs = [{"text_content": "Present"}, {"uri": "gs://bucket/file"}]
        result = executor._assemble_grounding_context({"grounding_docs": docs})
        assert result == "Present"


# ---------------------------------------------------------------------------
# Grounding injection into dispatch payload
# ---------------------------------------------------------------------------


class TestGroundingInjection:
    @pytest.mark.asyncio
    async def test_grounding_injected_into_dispatch(self, executor):
        """When grounding_docs exist, brief_context is injected into the dispatch payload."""
        node = {"id": "n1", "type": "ops-agent-brief", "configuration": {}}
        run_inputs = {
            "grounding_docs": [{"text_content": "Background info"}],
        }

        mock_response = _make_response(200, json={"output": "done"})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
            result = await executor.dispatch_node(node, {}, run_inputs)

        call_kwargs = mock_post.call_args
        sent_payload = call_kwargs.kwargs.get("json") or call_kwargs.args[1] if len(call_kwargs.args) > 1 else call_kwargs.kwargs["json"]
        assert sent_payload["payload"]["brief_context"] == "Background info"

    @pytest.mark.asyncio
    async def test_no_grounding_no_brief_context(self, executor):
        """When no grounding_docs, brief_context should not appear."""
        node = {"id": "n1", "type": "ops-agent-brief", "configuration": {}}
        run_inputs = {}

        mock_response = _make_response(200, json={"output": "done"})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
            await executor.dispatch_node(node, {}, run_inputs)

        call_kwargs = mock_post.call_args
        sent_payload = call_kwargs.kwargs.get("json") or call_kwargs.kwargs["json"]
        assert "brief_context" not in sent_payload["payload"]


# ---------------------------------------------------------------------------
# Google Drive pull node
# ---------------------------------------------------------------------------


class TestDrivePull:
    @pytest.mark.asyncio
    async def test_pull_google_doc(self, executor):
        """Pull a Google Doc — should export as text/plain."""
        node = {
            "id": "drive1",
            "type": "io-google-drive",
            "configuration": {
                "mode": "pull",
                "file_id": "abc123",
                "mime_type": "application/vnd.google-apps.document",
            },
        }
        run_inputs = {"access_token": "tok_xyz"}

        mock_response = _make_response(200, content=b"Document text content here")
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            result = await executor.handle_drive_pull(node, run_inputs)

        # Verify correct export URL was called
        call_args = mock_get.call_args
        assert "/export" in call_args.args[0]
        assert call_args.kwargs["params"]["mimeType"] == "text/plain"
        assert call_args.kwargs["headers"]["Authorization"] == "Bearer tok_xyz"
        assert result["text_content"] == "Document text content here"

    @pytest.mark.asyncio
    async def test_pull_spreadsheet(self, executor):
        """Pull a Google Sheet — should export as CSV."""
        node = {
            "id": "drive2",
            "type": "io-google-drive",
            "configuration": {
                "mode": "pull",
                "file_id": "sheet123",
                "mime_type": "application/vnd.google-apps.spreadsheet",
            },
        }
        run_inputs = {"access_token": "tok_xyz"}

        mock_response = _make_response(200, content=b"col1,col2\na,b")
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            result = await executor.handle_drive_pull(node, run_inputs)

        call_args = mock_get.call_args
        assert call_args.kwargs["params"]["mimeType"] == "text/csv"
        assert result["text_content"] == "col1,col2\na,b"

    @pytest.mark.asyncio
    async def test_pull_binary_file(self, executor):
        """Pull a non-Workspace file — should use get_media style."""
        node = {
            "id": "drive3",
            "type": "io-google-drive",
            "configuration": {
                "mode": "pull",
                "file_id": "pdf123",
                "mime_type": "text/plain",
            },
        }
        run_inputs = {"access_token": "tok_xyz"}

        mock_response = _make_response(200, content=b"Plain text file")
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response) as mock_get:
            result = await executor.handle_drive_pull(node, run_inputs)

        call_args = mock_get.call_args
        assert "/export" not in call_args.args[0]
        assert call_args.kwargs["params"]["alt"] == "media"
        assert result["text_content"] == "Plain text file"

    @pytest.mark.asyncio
    async def test_pull_missing_file_id(self, executor):
        node = {
            "id": "d1",
            "type": "io-google-drive",
            "configuration": {"mode": "pull"},
        }
        with pytest.raises(ValueError, match="file_id"):
            await executor.handle_drive_pull(node, {"access_token": "tok"})

    @pytest.mark.asyncio
    async def test_pull_missing_access_token(self, executor):
        node = {
            "id": "d1",
            "type": "io-google-drive",
            "configuration": {"mode": "pull", "file_id": "abc", "mime_type": "text/plain"},
        }
        with pytest.raises(ValueError, match="access_token"):
            await executor.handle_drive_pull(node, {})

    @pytest.mark.asyncio
    async def test_pull_missing_mime_type(self, executor):
        node = {
            "id": "d1",
            "type": "io-google-drive",
            "configuration": {"mode": "pull", "file_id": "abc"},
        }
        with pytest.raises(ValueError, match="mime_type"):
            await executor.handle_drive_pull(node, {"access_token": "tok"})

    @pytest.mark.asyncio
    async def test_pull_truncates_at_50k(self, executor):
        """Text content should be capped at 50,000 characters."""
        node = {
            "id": "d1",
            "type": "io-google-drive",
            "configuration": {
                "mode": "pull",
                "file_id": "big",
                "mime_type": "text/plain",
            },
        }
        run_inputs = {"access_token": "tok"}
        big_content = b"x" * 60000

        mock_response = _make_response(200, content=big_content)
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
            result = await executor.handle_drive_pull(node, run_inputs)

        assert len(result["text_content"]) == 50000


# ---------------------------------------------------------------------------
# Google Drive push node
# ---------------------------------------------------------------------------


class TestDrivePush:
    @pytest.mark.asyncio
    async def test_push_creates_doc(self, executor):
        """Push sends content to CoreAgents export endpoint."""
        node = {
            "id": "push1",
            "type": "io-google-drive",
            "configuration": {
                "mode": "push",
                "title": "My Output Doc",
                "folder_id": "folder_abc",
            },
        }
        upstream = {"text_content": "Final output"}
        run_inputs = {"access_token": "tok_xyz"}

        mock_response = _make_response(200, json={"doc_id": "new_doc_123", "url": "https://docs.google.com/..."})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
            result = await executor.handle_drive_push(node, upstream, run_inputs)

        call_args = mock_post.call_args
        sent = call_args.kwargs.get("json") or call_args.args[1]
        assert sent["title"] == "My Output Doc"
        assert sent["content"] == "Final output"
        assert sent["access_token"] == "tok_xyz"
        assert sent["folder_id"] == "folder_abc"
        assert result["doc_id"] == "new_doc_123"

    @pytest.mark.asyncio
    async def test_push_without_folder_id(self, executor):
        """Push without folder_id should not include it in the payload."""
        node = {
            "id": "push2",
            "type": "io-google-drive",
            "configuration": {"mode": "push", "title": "Doc"},
        }
        upstream = {"text_content": "content"}
        run_inputs = {"access_token": "tok"}

        mock_response = _make_response(200, json={"doc_id": "d1"})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
            await executor.handle_drive_push(node, upstream, run_inputs)

        sent = mock_post.call_args.kwargs.get("json") or mock_post.call_args.args[1]
        assert "folder_id" not in sent

    @pytest.mark.asyncio
    async def test_push_uses_content_fallback(self, executor):
        """Push should fall back to 'content' key if 'text_content' is absent."""
        node = {
            "id": "push3",
            "type": "io-google-drive",
            "configuration": {"mode": "push"},
        }
        upstream = {"content": "fallback content"}
        run_inputs = {"access_token": "tok"}

        mock_response = _make_response(200, json={"doc_id": "d2"})
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
            await executor.handle_drive_push(node, upstream, run_inputs)

        sent = mock_post.call_args.kwargs.get("json") or mock_post.call_args.args[1]
        assert sent["content"] == "fallback content"

    @pytest.mark.asyncio
    async def test_push_missing_access_token(self, executor):
        node = {
            "id": "p1",
            "type": "io-google-drive",
            "configuration": {"mode": "push"},
        }
        with pytest.raises(ValueError, match="access_token"):
            await executor.handle_drive_push(node, {}, {})


# ---------------------------------------------------------------------------
# Full pipeline execute() integration
# ---------------------------------------------------------------------------


class TestExecuteIntegration:
    @pytest.mark.asyncio
    async def test_drive_pull_in_pipeline(self, executor):
        """Drive pull node is handled in execute() and outputs flow downstream."""
        template = {
            "nodes": [
                {
                    "id": "pull",
                    "type": "io-google-drive",
                    "configuration": {
                        "mode": "pull",
                        "file_id": "f1",
                        "mime_type": "text/plain",
                    },
                },
            ],
            "edges": [],
        }
        run_inputs = {"access_token": "tok"}

        mock_response = _make_response(200, content=b"pulled text")
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
            outputs = await executor.execute(template, run_inputs)

        assert outputs["pull"]["text_content"] == "pulled text"

    @pytest.mark.asyncio
    async def test_drive_push_in_pipeline(self, executor):
        """Drive push node receives upstream output."""
        template = {
            "nodes": [
                {
                    "id": "pull",
                    "type": "io-google-drive",
                    "configuration": {
                        "mode": "pull",
                        "file_id": "f1",
                        "mime_type": "text/plain",
                    },
                },
                {
                    "id": "push",
                    "type": "io-google-drive",
                    "configuration": {"mode": "push", "title": "Output"},
                },
            ],
            "edges": [{"from_node": "pull", "to_node": "push"}],
        }
        run_inputs = {"access_token": "tok"}

        mock_get_resp = _make_response(200, content=b"source text")
        mock_post_resp = _make_response(200, json={"doc_id": "new123"})

        with (
            patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_get_resp),
            patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_post_resp),
        ):
            outputs = await executor.execute(template, run_inputs)

        assert outputs["pull"]["text_content"] == "source text"
        assert outputs["push"]["doc_id"] == "new123"

    @pytest.mark.asyncio
    async def test_drive_pull_failure_skips_downstream(self, executor):
        """If drive pull fails, downstream nodes are skipped."""
        template = {
            "nodes": [
                {
                    "id": "pull",
                    "type": "io-google-drive",
                    "configuration": {"mode": "pull"},  # missing file_id -> error
                },
                {
                    "id": "agent",
                    "type": "ops-agent-brief",
                    "configuration": {},
                },
            ],
            "edges": [{"from_node": "pull", "to_node": "agent"}],
        }
        run_inputs = {"access_token": "tok"}

        errors = {}

        async def on_error(nid, msg):
            errors[nid] = msg

        outputs = await executor.execute(template, run_inputs, on_node_error=on_error)
        assert "pull" in errors
        assert "agent" in errors
        assert "pull" not in outputs

    @pytest.mark.asyncio
    async def test_callbacks_invoked_for_drive_nodes(self, executor):
        """on_node_start and on_node_complete are called for drive nodes."""
        template = {
            "nodes": [
                {
                    "id": "d1",
                    "type": "io-google-drive",
                    "configuration": {
                        "mode": "pull",
                        "file_id": "f1",
                        "mime_type": "text/plain",
                    },
                },
            ],
            "edges": [],
        }
        started = []
        completed = []

        async def on_start(nid):
            started.append(nid)

        async def on_complete(nid, res):
            completed.append(nid)

        mock_response = _make_response(200, content=b"hello")
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
            await executor.execute(
                template, {"access_token": "tok"},
                on_node_start=on_start, on_node_complete=on_complete,
            )

        assert "d1" in started
        assert "d1" in completed
