"""Smoke tests for I/O routes (upload and export-doc)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app

IO_URL = "/api/io"


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_upload_file(client):
    with (
        patch("src.api.io.upload_bytes", return_value=("gs://bucket/file.txt", "https://signed.url")),
        patch("src.api.io.extract_text", return_value="Hello extracted text"),
    ):
        resp = await client.post(
            f"{IO_URL}/upload",
            files={"file": ("test.txt", b"Hello world", "text/plain")},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["uri"] == "gs://bucket/file.txt"
    assert body["signed_url"] == "https://signed.url"
    assert body["name"] == "test.txt"
    assert body["size"] == 11
    assert body["text_content"] == "Hello extracted text"


@pytest.mark.anyio
async def test_upload_file_too_large(client):
    # 50 MB + 1 byte exceeds limit
    large_data = b"x" * (50 * 1024 * 1024 + 1)
    resp = await client.post(
        f"{IO_URL}/upload",
        files={"file": ("big.bin", large_data, "application/octet-stream")},
    )
    assert resp.status_code == 413


# ---------------------------------------------------------------------------
# Export Doc (proxy to CoreAgents)
# ---------------------------------------------------------------------------


def _make_httpx_response(status_code=200, *, json_data=None):
    kwargs = {"status_code": status_code}
    if json_data is not None:
        kwargs["content"] = json.dumps(json_data).encode()
        kwargs["headers"] = {"content-type": "application/json"}
    resp = httpx.Response(**kwargs)
    resp._request = httpx.Request("POST", "https://test")
    return resp


@pytest.mark.anyio
async def test_export_doc(client):
    expected = {"doc_id": "abc123", "url": "https://docs.google.com/document/d/abc123"}
    mock_http_client = AsyncMock()
    mock_http_client.post.return_value = _make_httpx_response(json_data=expected)
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.api.io.httpx.AsyncClient", return_value=mock_http_client):
        resp = await client.post(
            f"{IO_URL}/export-doc",
            json={
                "title": "Test Doc",
                "content": "Some content",
                "access_token": "fake-token",
            },
        )
    assert resp.status_code == 200
    assert resp.json()["doc_id"] == "abc123"


@pytest.mark.anyio
async def test_export_doc_502(client):
    mock_http_client = AsyncMock()
    mock_http_client.post.side_effect = httpx.ConnectError("unreachable")
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.api.io.httpx.AsyncClient", return_value=mock_http_client):
        resp = await client.post(
            f"{IO_URL}/export-doc",
            json={
                "title": "Test Doc",
                "content": "Some content",
                "access_token": "fake-token",
            },
        )
    assert resp.status_code == 502
