# Pipeliner

Visual pipeline builder for Monks.Flow agent orchestration. A drag-and-drop DAG editor that chains AI agents into creative production workflows — concepting, asset generation, resizing, translations, and delivery — and dispatches them to CoreAgents for execution.

**Production URL:** `https://pipeline.mf4g.studio`

## Quick Start

```bash
# Backend
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000

# Frontend
cd ui
npm install
ng serve --port 4200    # proxies /api → localhost:8000
```

Open `http://localhost:4200`. Create a workflow, drag agents onto the canvas, connect them, hit Run.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Pipeliner                          │
│                                                       │
│  ┌──────────────┐    ┌──────────────────────────┐    │
│  │   Angular UI  │───▶│  FastAPI Backend          │    │
│  │  (port 4200)  │    │  (port 8000)              │    │
│  │               │    │                            │    │
│  │  Foblex Flow  │    │  Pipeline CRUD     ──────▶│ Spanner
│  │  drag-and-drop│    │  DAG Executor      ──────▶│ CoreAgents
│  │  editor       │    │  File I/O          ──────▶│ GCS
│  └──────────────┘    └──────────────────────────┘    │
└─────────────────────────────────────────────────────┘
         │                        │
         │ IAP cookies            │ ID token (SA)
         ▼                        ▼
   ┌──────────┐          ┌──────────────┐
   │   IAP    │          │ CoreAgents   │
   │ (login)  │          │ /v1/dispatch │
   └──────────┘          └──────────────┘
```

### Architectural Decisions

**Why a standalone repo (not a module in Ops Console)?**
The Pipeliner is a general-purpose agent orchestration tool. The Ops Console is a domain-specific compliance platform for Brief/Pitch/Plan/Contract. Coupling them would force the Pipeliner to inherit the Ops Console's compliance domain model and deployment lifecycle. Standalone lets the Pipeliner evolve independently and serve other agent ecosystems beyond Google creative production.

**Why dispatch to CoreAgents over HTTP instead of embedding agents?**
Agents are stateful, GPU-hungry, and change frequently. The Pipeliner is a thin orchestration layer — it builds the DAG, walks it topologically, and dispatches each node to CoreAgents' `/v1/dispatch` endpoint. This keeps the Pipeliner container small (~300MB vs ~2GB with agent deps), deployable in seconds, and decoupled from agent versioning. CoreAgents already handles agent lifecycle, model selection, and rate limiting.

**Why IAP instead of Firebase Auth?**
Both the Pipeliner and CoreAgents are internal tools for `mediamonks.com` users. IAP provides authentication at the infrastructure layer — no client-side OAuth flow, no token refresh logic, no auth state management. The frontend sends `credentials: 'include'` and IAP cookies handle the rest. Row-level security uses `x-goog-authenticated-user-email` from IAP headers.

**Why Spanner (not Firestore or Postgres)?**
The Ops Console and CoreAgents already use the same Spanner instance (`innovation-graph` / `innovation` database). Sharing the instance avoids provisioning overhead and allows future cross-app queries. Pipeline templates store nodes and edges as JSON columns — Spanner handles this via `STRING(MAX)` with application-level JSON serialization.

**Why Foblex Flow for the editor?**
Foblex provides a production-ready node-graph canvas with drag-from-palette, magnetic connections, zoom/pan, and serialization. Alternatives (ReactFlow, Angular-native solutions) either require React or lack the palette `fExternalItem` directive that enables dragging new nodes from a sidebar onto the canvas. Foblex's `FCreateNodeEvent.rect` gives exact drop coordinates, critical for a visual builder.

**Click-to-connect:** Double-click any port to arm it — compatible ports on other nodes pulse as receivable targets. Single-click a receivable port to auto-wire. Press Escape or click the canvas to disarm.

**Why own I/O (file upload, Drive import) instead of proxying through CoreAgents?**
File upload and Drive import are simple GCS + Google API calls (~80 lines). Proxying through CoreAgents would add latency for large files and create an unnecessary runtime dependency. Google Docs export, however, proxies through CoreAgents because the formatting logic (markdown-to-Docs-API conversion) is complex and already implemented there.

## Project Structure

```
pipeliner/
├── src/                          Python FastAPI backend
│   ├── main.py                   App entrypoint, CORS, router registration
│   ├── config.py                 Environment-driven settings (Pydantic)
│   ├── api/
│   │   ├── pipelines.py          Template/run CRUD, agent registry proxy
│   │   └── io.py                 File upload, Drive import, Doc export
│   ├── models/
│   │   └── pipeline.py           PipelineTemplate, PipelineRun, PipelineNodeRun
│   └── services/
│       ├── spanner.py            Spanner CRUD (3 tables, JSON columns)
│       ├── pipeline_executor.py  DAG walker, CoreAgents dispatch, Drive nodes
│       ├── file_parser.py        Text extraction: PDF, DOCX, PPTX, CSV, TXT
│       └── storage.py            GCS upload + signed URL generation
├── ui/                           Angular frontend
│   └── src/app/
│       ├── pipeline/
│       │   ├── pipeline-editor.component.ts   Foblex canvas, 14+ agent nodes
│       │   ├── pipeline-list.component.ts     Template grid, CRUD, run trigger
│       │   └── pipeline-shell.component.ts    Glass topbar, theme toggle
│       └── services/
│           ├── api.service.ts    Pipeline CRUD + I/O HTTP methods
│           └── theme.service.ts  Light/dark/system theme persistence
├── tests/                        42 passing tests
│   ├── test_executor.py          DAG execution, Drive nodes, grounding injection
│   ├── test_pipelines_api.py     CRUD route smoke tests
│   └── test_io_api.py            Upload and export endpoint tests
├── migrations/
│   └── 001_pipeline_tables.sql   Spanner DDL (3 tables + indexes)
├── deploy/                       nginx, supervisord, startup script
├── Dockerfile.combined           Multi-stage: Angular build → Python + nginx
├── cloudbuild.yaml               Cloud Build → Artifact Registry → Cloud Run
└── requirements.txt              Python dependencies
```

## Key Concepts

### Pipeline Templates

A template is a saved workflow: a set of **nodes** (agents, I/O modules) and **edges** (data flow connections). Templates are stored in Spanner as JSON. Users create templates in the visual editor, then run them.

### Pipeline Execution

When a user clicks "Run", the executor:
1. Topologically sorts the DAG (detects cycles)
2. Walks nodes in dependency order
3. For each agent node: assembles upstream outputs + grounding context, dispatches to CoreAgents `POST /v1/dispatch`
4. For I/O nodes: pulls from Google Drive or pushes to Google Docs
5. For human-review nodes: pauses and reports `awaiting_review`
6. On failure: skips all downstream nodes (no partial execution)

**Note:** Pipeline execution currently creates a run record. Async execution dispatch is planned for the next release.

### Node Types

| Type | Purpose | Handler |
|------|---------|---------|
| `ops-agent-*` | AI agent (briefing, creative director, etc.) | CoreAgents `/v1/dispatch` |
| `io-google-drive` (pull) | Import file from Google Drive | Direct Drive API v3 |
| `io-google-drive` (push) | Export output to Google Docs | CoreAgents `/v1/export/docs` |
| `utility-human-review` | Pause for human approval | Returns `awaiting_review` |

### Grounding Context

Uploaded documents and Drive imports populate `run_inputs.grounding_docs`. The executor concatenates all text content and injects it as `brief_context` into every agent dispatch payload. This grounds agent outputs in the user's actual briefs, brand guidelines, and reference materials.

**Source reference:** The SCP Brief Template (see `docs/reference/scp-brief-template-extracted.md` in Ops Console) defines the standard brief structure that Monks.Flow agents expect. Grounding context injection ensures agents receive this context even when briefs are uploaded rather than created in the Brief module.

### Manifest Import

CoreAgents can hand off a working session to the Pipeliner via URL:

```
https://pipeline.mf4g.studio?source=core-agents&session_id={id}&manifest=ready
```

The Pipeliner fetches the manifest (`GET /v1/sessions/{id}/manifest`), extracts agent outputs and grounding docs, and pre-configures pipeline nodes. This bridges the gap between interactive agent sessions and automated pipeline execution.

## API Reference

### Pipeline Templates

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pipelines/` | Create template |
| `GET` | `/api/pipelines/` | List templates |
| `GET` | `/api/pipelines/{id}` | Get template |
| `PUT` | `/api/pipelines/{id}` | Update template |
| `DELETE` | `/api/pipelines/{id}` | Delete template |

### Pipeline Runs

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pipelines/{id}/run` | Start run |
| `GET` | `/api/pipelines/runs/{run_id}` | Get run status |
| `GET` | `/api/pipelines/{id}/runs` | List runs for template |

### I/O

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/io/upload` | Upload file (multipart, 50MB max) |
| `POST` | `/api/io/import-drive` | Import from Google Drive |
| `POST` | `/api/io/export-doc` | Export to Google Docs (via CoreAgents) |

### Agent Registry

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/registry` | Proxy to CoreAgents agent list |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health check |

## Deployment

```bash
gcloud builds submit --config=cloudbuild.yaml \
  --project=meekerexperiments \
  --substitutions=SHORT_SHA=$(git rev-parse --short HEAD)
```

Deploys a combined container (nginx:8080 + uvicorn:8000 via supervisord) to Cloud Run at `https://pipeline.mf4g.studio`. Same pattern as CoreAgents.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GCP_PROJECT_ID` | `meekerexperiments` | Google Cloud project |
| `SPANNER_INSTANCE` | `innovation-graph` | Spanner instance name |
| `SPANNER_DATABASE` | `innovation` | Spanner database name |
| `COREAGENTS_BASE_URL` | `https://core-agents.mf4g.studio/v1` | CoreAgents API base |
| `GCS_BUCKET` | `pipeliner-uploads` | GCS bucket for file uploads |
| `ALLOWED_ORIGINS` | `localhost:4200, pipeline.mf4g.studio` | CORS origins |
| `LOG_LEVEL` | `INFO` | Python logging level |

## Testing

```bash
# All tests (42 passing)
pytest

# Specific suites
pytest tests/test_executor.py -v        # DAG execution, Drive nodes, grounding
pytest tests/test_pipelines_api.py -v   # CRUD routes
pytest tests/test_io_api.py -v          # Upload and export
```

## Related Projects

| Project | Location | Relationship |
|---------|----------|-------------|
| **CoreAgents** | `/Users/dave/playground/Coreagents/` | Agent execution engine — Pipeliner dispatches to it |
| **Ops Console** | `/Users/dave/playground/finance_Agent/` | Compliance platform — Pipeliner was extracted from it |
| **SuperSCP** | `/Users/dave/playground/SuperSCP/` | Main Monks.Flow platform — future integration target |
