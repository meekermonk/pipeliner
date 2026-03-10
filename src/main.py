"""Pipeliner — FastAPI application."""

from __future__ import annotations

import json
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
