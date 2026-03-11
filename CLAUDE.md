# Pipeliner — CLAUDE.md

## What This Is

A standalone visual pipeline builder for Monks.Flow agent orchestration. Users drag AI agents onto a canvas, connect them into DAGs, and run them. The Pipeliner dispatches agents to CoreAgents over HTTP — it never hosts agents itself.

**Production URL:** `https://pipeliner-app-coluam67dq-uc.a.run.app` (eventually `https://pipeline.mf4g.studio`)
**Parent org:** MediaMonks (Firewood Marketing Inc. dba MediaMonks), contracted to Google under ISA 835441 / MSOW #980608.

## Project Structure

```
ui/                  # Angular 19+ frontend (standalone components, OnPush CD)
  src/app/
    pipeline/        # Editor (Foblex canvas), list (template grid), shell (glass topbar)
    services/        # api.service.ts (pipeline CRUD + I/O), theme.service.ts
src/                 # Python FastAPI backend
  api/
    pipelines.py     # Template/run CRUD + agent registry proxy
    io.py            # File upload (GCS), Drive import, Doc export (CoreAgents proxy)
  models/
    pipeline.py      # PipelineTemplate, PipelineRun, PipelineNodeRun (Pydantic)
  services/
    spanner.py       # Spanner CRUD — 3 tables, JSON columns, commit timestamps
    pipeline_executor.py  # DAG walker — topological sort, node dispatch, Drive I/O
    file_parser.py   # Text extraction: PDF (PyPDF2), DOCX, PPTX, CSV, TXT
    storage.py       # GCS upload + signed URL generation
deploy/              # nginx.conf, supervisord.conf, start-nginx.sh
migrations/          # Spanner DDL (001_pipeline_tables.sql)
tests/               # 42 tests — executor, API routes, I/O endpoints
```

## Commands

```bash
# Frontend
cd ui && ng serve                        # Dev server (port 4200, proxies /api → :8000)

# Backend
uvicorn src.main:app --reload            # API server (port 8000)

# Tests
pytest                                    # All 42 tests
pytest tests/test_executor.py -v         # DAG execution + Drive nodes + grounding

# Lint
ruff check .                              # Lint Python
ruff format .                             # Format Python

# Build frontend
cd ui && npx ng build                    # Production build → ui/dist/ui/

# Deploy
gcloud builds submit --config=cloudbuild.yaml --project=meekerexperiments
```

## Conventions

- **Standalone Angular components** — All components use `standalone: true`, `OnPush` change detection where performance matters (editor). No NgModules.
- **IAP auth only** — No Firebase Auth. IAP handles login, session cookies, access control. `x-goog-authenticated-user-email` header for user identity.
- **Agents live in CoreAgents** — This app dispatches to CoreAgents `POST /v1/dispatch`. It never imports agent code or runs models locally.
- **Spanner for storage** — Same instance as Ops Console (`innovation-graph` / `innovation`). 3 tables: `ops_pipeline_templates`, `ops_pipeline_runs`, `ops_pipeline_node_runs`.
- **JSON in Spanner** — Nodes, edges, inputs, outputs use native `JSON` columns. On read, the Spanner client returns `JsonObject` (a dict subclass) — use `.serialize()` + `json.loads()` to get plain Python. On write, `json.dumps()` is required because the mutation API doesn't accept raw dicts/lists.
- **Grounding context** — Uploaded docs and Drive imports become `grounding_docs` in run inputs. Executor concatenates text and injects as `brief_context` in every agent dispatch.
- **Access tokens are ephemeral** — User's Google OAuth token passed per-request for Drive operations. Never stored. Filtered from agent dispatch payloads.
- **50K char cap** — All text extraction (file upload, Drive pull) truncates at 50,000 characters to keep agent payloads within context limits.
- **Combined container** — Production runs nginx:8080 (frontend) + uvicorn:8000 (API) via supervisord. Same pattern as CoreAgents.

## Key Integration Points

| Endpoint | Direction | Purpose |
|----------|-----------|---------|
| `POST /v1/dispatch` | Pipeliner → CoreAgents | Execute agent node |
| `GET /v1/agents` | Pipeliner → CoreAgents | Fetch agent registry |
| `POST /v1/export/docs` | Pipeliner → CoreAgents | Create Google Doc |
| `GET /v1/sessions/{id}/manifest` | Pipeliner → CoreAgents | Import manifest |
| `?source=core-agents&session_id={id}` | CoreAgents → Pipeliner | Trigger manifest import |

## Domain Context

The agents in the pipeline are creative production agents for Google campaigns under the SCP (Scaled Content Production) program. Relevant reference docs:

- **SCP Brief Template** — 4-part brief structure (Marketing Brief, SCP Adapt Brief with complexity scoring, MonksFlow Setup Checklist, Post-Project Wrap Up). The briefing agent expects this structure.
- **Order Form Template** — 10-section Google Creative MSOW Order Form. Contract module in Ops Console handles this, not the Pipeliner.
- **Complexity Guide** — 6 modalities (Static, Motion HTML, Motion Video, Audio, Copy, Translation) scored Low/Medium/High. Affects pipeline configuration.

These reference docs live in the Ops Console at `docs/reference/`. The Pipeliner doesn't own them but agents consuming pipeline output may reference them.
