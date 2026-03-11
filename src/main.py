"""Pipeliner — FastAPI application."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.io import router as io_router
from src.api.pipelines import agents_router, router as pipelines_router
from src.config import settings

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

app = FastAPI(
    title="Pipeliner",
    version="1.0.0",
    description="Visual pipeline builder for Monks.Flow agent orchestration",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipelines_router)
app.include_router(agents_router)
app.include_router(io_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pipeliner"}


@app.get("/api/debug/spanner-types/{template_id}")
async def debug_spanner_types(template_id: str):
    """Temporary debug endpoint to inspect raw Spanner return types."""
    import asyncio
    from google.cloud import spanner as sp
    from src.services.spanner import spanner_service

    cols = sorted(["template_id", "nodes", "edges", "graph_metadata"])

    def _read():
        with spanner_service.db.snapshot() as snapshot:
            rows = list(snapshot.read(
                "ops_pipeline_templates",
                columns=cols,
                keyset=sp.KeySet(keys=[[template_id]]),
            ))
        return rows

    rows = await asyncio.to_thread(_read)
    if not rows:
        return {"error": "not found"}

    debug = {}
    for col, val in zip(cols, rows[0]):
        debug[col] = {
            "python_type": type(val).__name__,
            "repr": repr(val)[:500],
            "is_str": isinstance(val, str),
        }
    return debug
