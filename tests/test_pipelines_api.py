"""Smoke tests for pipeline template and run CRUD routes + agent registry proxy."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app

TEMPLATES_URL = "/api/pipelines"
AGENTS_URL = "/api/agents/registry"

FAKE_TEMPLATE_ID = "tpl-0001"
FAKE_RUN_ID = "run-0001"

TEMPLATE_DOC = {
    "template_id": FAKE_TEMPLATE_ID,
    "id": FAKE_TEMPLATE_ID,
    "name": "My Pipeline",
    "description": "A test pipeline",
    "nodes": [{"id": "n1", "type": "agent"}],
    "edges": [],
    "graph_metadata": {},
    "created_by": "alice@test.com",
    "created_at": "2026-03-10T00:00:00Z",
    "updated_at": "2026-03-10T00:00:00Z",
}

RUN_DOC = {
    "run_id": FAKE_RUN_ID,
    "id": FAKE_RUN_ID,
    "template_id": FAKE_TEMPLATE_ID,
    "status": "pending",
    "inputs": {"key": "value"},
    "outputs": {},
    "node_runs": [],
    "started_at": None,
    "completed_at": None,
    "created_by": "alice@test.com",
    "error": None,
    "created_at": "2026-03-10T00:00:00Z",
    "updated_at": "2026-03-10T00:00:00Z",
}


@pytest.fixture
def mock_spanner():
    with patch("src.api.pipelines.spanner_service") as m:
        m.create_document = AsyncMock()
        m.get_document = AsyncMock(return_value=None)
        m.list_documents = AsyncMock(return_value=[])
        m.update_document = AsyncMock()
        m.delete_document = AsyncMock()
        yield m


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# Template CRUD
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_template(client, mock_spanner):
    mock_spanner.create_document.return_value = FAKE_TEMPLATE_ID
    resp = await client.post(
        TEMPLATES_URL + "/",
        json={"name": "My Pipeline", "description": "desc", "nodes": [], "edges": []},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == FAKE_TEMPLATE_ID
    assert body["status"] == "created"
    mock_spanner.create_document.assert_awaited_once()


@pytest.mark.anyio
async def test_list_templates(client, mock_spanner):
    mock_spanner.list_documents.return_value = [TEMPLATE_DOC]
    resp = await client.get(TEMPLATES_URL + "/")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "My Pipeline"


@pytest.mark.anyio
async def test_get_template(client, mock_spanner):
    mock_spanner.get_document.return_value = TEMPLATE_DOC
    resp = await client.get(f"{TEMPLATES_URL}/{FAKE_TEMPLATE_ID}")
    assert resp.status_code == 200
    assert resp.json()["id"] == FAKE_TEMPLATE_ID


@pytest.mark.anyio
async def test_get_template_404(client, mock_spanner):
    mock_spanner.get_document.return_value = None
    resp = await client.get(f"{TEMPLATES_URL}/nonexistent")
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_update_template(client, mock_spanner):
    mock_spanner.get_document.return_value = TEMPLATE_DOC
    resp = await client.put(
        f"{TEMPLATES_URL}/{FAKE_TEMPLATE_ID}",
        json={"name": "Renamed"},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] is True
    mock_spanner.update_document.assert_awaited_once()


@pytest.mark.anyio
async def test_update_template_404(client, mock_spanner):
    mock_spanner.get_document.return_value = None
    resp = await client.put(f"{TEMPLATES_URL}/nonexistent", json={"name": "X"})
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_delete_template(client, mock_spanner):
    mock_spanner.get_document.return_value = TEMPLATE_DOC
    resp = await client.delete(f"{TEMPLATES_URL}/{FAKE_TEMPLATE_ID}")
    assert resp.status_code == 204
    mock_spanner.delete_document.assert_awaited_once()


@pytest.mark.anyio
async def test_delete_template_404(client, mock_spanner):
    mock_spanner.get_document.return_value = None
    resp = await client.delete(f"{TEMPLATES_URL}/nonexistent")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Pipeline Runs
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_start_run(client, mock_spanner):
    mock_spanner.get_document.return_value = TEMPLATE_DOC
    mock_spanner.create_document.return_value = FAKE_RUN_ID
    resp = await client.post(
        f"{TEMPLATES_URL}/{FAKE_TEMPLATE_ID}/run",
        json={"inputs": {"brief": "test"}},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == FAKE_RUN_ID
    assert body["status"] == "pending"


@pytest.mark.anyio
async def test_start_run_template_404(client, mock_spanner):
    mock_spanner.get_document.return_value = None
    resp = await client.post(
        f"{TEMPLATES_URL}/nonexistent/run",
        json={"inputs": {}},
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_get_run(client, mock_spanner):
    mock_spanner.get_document.return_value = RUN_DOC
    resp = await client.get(f"{TEMPLATES_URL}/runs/{FAKE_RUN_ID}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


@pytest.mark.anyio
async def test_get_run_404(client, mock_spanner):
    mock_spanner.get_document.return_value = None
    resp = await client.get(f"{TEMPLATES_URL}/runs/nonexistent")
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_list_runs(client, mock_spanner):
    mock_spanner.list_documents.return_value = [RUN_DOC]
    resp = await client.get(f"{TEMPLATES_URL}/{FAKE_TEMPLATE_ID}/runs")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ---------------------------------------------------------------------------
# Agent Registry Proxy
# ---------------------------------------------------------------------------


def _make_httpx_response(status_code=200, *, json_data=None):
    kwargs = {"status_code": status_code}
    if json_data is not None:
        kwargs["content"] = json.dumps(json_data).encode()
        kwargs["headers"] = {"content-type": "application/json"}
    resp = httpx.Response(**kwargs)
    resp._request = httpx.Request("GET", "https://test")
    return resp


@pytest.mark.anyio
async def test_agent_registry_proxy(client, mock_spanner):
    fake_agents = [{"name": "brief_agent"}, {"name": "pitch_agent"}]
    mock_http_client = AsyncMock()
    mock_http_client.get.return_value = _make_httpx_response(json_data=fake_agents)
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.api.pipelines.httpx.AsyncClient", return_value=mock_http_client):
        resp = await client.get(AGENTS_URL)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


@pytest.mark.anyio
async def test_agent_registry_proxy_502(client, mock_spanner):
    mock_http_client = AsyncMock()
    mock_http_client.get.side_effect = httpx.ConnectError("unreachable")
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)

    with patch("src.api.pipelines.httpx.AsyncClient", return_value=mock_http_client):
        resp = await client.get(AGENTS_URL)
    assert resp.status_code == 502
