"""Pipeline template and run CRUD routes."""

from __future__ import annotations

from typing import Any, Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from src.config import settings
from src.models.pipeline import PipelineRun, PipelineTemplate, RunStatus
from src.services.spanner import spanner_service

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])

TEMPLATES = settings.pipeline_templates_collection
RUNS = settings.pipeline_runs_collection


def _get_user_email(
    x_goog_authenticated_user_email: str | None = None,
) -> str:
    if x_goog_authenticated_user_email:
        return x_goog_authenticated_user_email.split(":")[-1]
    return "anonymous"


class CreateTemplateRequest(BaseModel):
    name: str
    description: str = ""
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    graph_metadata: dict[str, Any] = Field(default_factory=dict)


class UpdateTemplateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[list[dict[str, Any]]] = None
    edges: Optional[list[dict[str, Any]]] = None
    graph_metadata: Optional[dict[str, Any]] = None


class StartRunRequest(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)


@router.post("/", status_code=201)
async def create_template(
    body: CreateTemplateRequest,
    x_goog_authenticated_user_email: str | None = Header(None),
):
    user = _get_user_email(x_goog_authenticated_user_email)
    tpl = PipelineTemplate(name=body.name, description=body.description, created_by=user)
    data = tpl.model_dump(mode="json")
    data["nodes"] = body.nodes
    data["edges"] = body.edges
    data["graph_metadata"] = body.graph_metadata
    doc_id = data.pop("id")
    doc_id = await spanner_service.create_document(TEMPLATES, data, doc_id=doc_id)
    return {"id": doc_id, "status": "created"}


@router.get("/")
async def list_templates():
    return await spanner_service.list_documents(TEMPLATES)


@router.get("/{template_id}")
async def get_template(template_id: str):
    doc = await spanner_service.get_document(TEMPLATES, template_id)
    if not doc:
        raise HTTPException(404, "Pipeline template not found")
    return doc


@router.put("/{template_id}")
async def update_template(template_id: str, body: UpdateTemplateRequest):
    existing = await spanner_service.get_document(TEMPLATES, template_id)
    if not existing:
        raise HTTPException(404, "Pipeline template not found")
    await spanner_service.update_document(
        TEMPLATES, template_id, body.model_dump(exclude_none=True, mode="json"),
    )
    return {"id": template_id, "updated": True}


@router.delete("/{template_id}", status_code=204)
async def delete_template(template_id: str):
    existing = await spanner_service.get_document(TEMPLATES, template_id)
    if not existing:
        raise HTTPException(404, "Pipeline template not found")
    await spanner_service.delete_document(TEMPLATES, template_id)


@router.post("/{template_id}/run", status_code=201)
async def start_run(
    template_id: str, body: StartRunRequest,
    x_goog_authenticated_user_email: str | None = Header(None),
):
    tpl = await spanner_service.get_document(TEMPLATES, template_id)
    if not tpl:
        raise HTTPException(404, "Pipeline template not found")
    user = _get_user_email(x_goog_authenticated_user_email)
    run = PipelineRun(template_id=template_id, inputs=body.inputs, created_by=user)
    data = run.model_dump(mode="json")
    doc_id = data.pop("id")
    doc_id = await spanner_service.create_document(RUNS, data, doc_id=doc_id)
    return {"id": doc_id, "status": RunStatus.PENDING.value}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    doc = await spanner_service.get_document(RUNS, run_id)
    if not doc:
        raise HTTPException(404, "Pipeline run not found")
    return doc


@router.get("/{template_id}/runs")
async def list_runs(template_id: str):
    return await spanner_service.list_documents(RUNS, filters={"template_id": template_id})


# ── Agent registry proxy ────────────────────────────────────────────

agents_router = APIRouter(prefix="/api/agents", tags=["agents"])


@agents_router.get("/registry")
async def get_agent_registry():
    """Fetch agent registry from CoreAgents."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.coreagents_base_url}/agents",
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError:
        raise HTTPException(502, "Failed to reach CoreAgents service")
