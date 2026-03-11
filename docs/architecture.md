# Pipeliner — Architecture

## System Context

The Pipeliner is one of three applications in the Monks.Flow ecosystem:

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│   Ops Console  │     │   Pipeliner    │     │  CoreAgents    │
│                │     │                │     │                │
│  Brief → Pitch │     │  Visual DAG    │     │  Agent runtime │
│  → Plan →      │     │  builder +     │     │  ADK + Gemini  │
│  Contract      │     │  executor      │     │  dispatch      │
│                │     │                │     │                │
│  Compliance    │     │  File I/O      │     │  Google Docs   │
│  engine        │     │  Drive import  │     │  export        │
└───────┬────────┘     └───────┬────────┘     └───────┬────────┘
        │                      │                       │
        └──────────┬───────────┴───────────┬───────────┘
                   │                       │
            ┌──────▼──────┐         ┌──────▼──────┐
            │   Spanner   │         │     IAP     │
            │ innovation- │         │  (auth for  │
            │ graph       │         │  all apps)  │
            └─────────────┘         └─────────────┘
```

All three apps share the same Spanner instance and authenticate through IAP. They communicate over HTTP, not shared code.

## Data Flow

### Pipeline Execution

```
User clicks "Run" in UI
         │
         ▼
POST /api/pipelines/{id}/run
         │
         ▼
PipelineExecutor.execute()
    │
    ├── topological_sort(nodes, edges)
    │   Constraint: Raises ValueError on cycle detection.
    │   Rationale: Creative workflows must be DAGs. Cycles would
    │   cause infinite agent dispatch loops.
    │
    ├── For each node (in topological order):
    │   │
    │   ├── Check upstream failures → skip if any parent failed
    │   │   Rationale: Partial execution creates inconsistent
    │   │   outputs. Better to fail-fast than deliver a half-
    │   │   finished campaign.
    │   │
    │   ├── gather_inputs() → merge all upstream node outputs
    │   │
    │   ├── [Agent node] dispatch_node()
    │   │   ├── Assemble grounding_context from grounding_docs
    │   │   ├── Filter access_token from payload (security)
    │   │   └── POST to CoreAgents /v1/dispatch (300s timeout)
    │   │
    │   ├── [Drive pull] handle_drive_pull()
    │   │   ├── Fetch via Google Drive v3 API
    │   │   ├── Export Workspace files to text/CSV
    │   │   └── Extract text, cap at 50K chars
    │   │
    │   ├── [Drive push] handle_drive_push()
    │   │   └── POST to CoreAgents /v1/export/docs
    │   │
    │   └── [Human review] → return awaiting_review
    │
    └── Return all node_outputs
```

### Grounding Context Assembly

```
run_inputs.grounding_docs = [
    { text_content: "Brand Guidelines: Use blue (#1A73E8)...", ... },
    { text_content: "Campaign Brief: Q3 Summer Launch...", ... },
]

      │ _assemble_grounding_context()
      ▼

"Brand Guidelines: Use blue (#1A73E8)...

---

Campaign Brief: Q3 Summer Launch..."

      │ Injected into every agent dispatch as:
      ▼

payload.brief_context = "<grounding text>"
```

**Why inject into every node?** Agents are stateless. Each dispatch is independent — a creative director agent has no memory of what the strategist said unless we explicitly include it. Grounding context provides the shared brief, brand guidelines, and reference materials that tie all agent outputs together into a coherent campaign.

**Source reference:** CoreAgents' `/v1/dispatch` endpoint accepts `brief_context` in the payload. This was designed for the Ops Console's magic_brief flow but works identically for pipeline execution.

### Manifest Import (CoreAgents → Pipeliner)

```
CoreAgents "Send to Pipeline" button
         │
         ▼
Redirect to: pipeline.mf4g.studio?source=core-agents&session_id={id}&manifest=ready
         │
         ▼
Pipeliner detects URL params on init
         │
         ▼
Import dialog: "Import your working manifest?"
         │ [Accept]
         ▼
GET core-agents.mf4g.studio/v1/sessions/{id}/manifest
   (credentials: 'include' — IAP cookie handles auth)
         │
         ▼
Map agent_outputs → pre-configured pipeline nodes
Attach grounding_docs as shared context
Set session title from manifest
```

## Authentication & Authorization

### Layer Model

| Layer | Mechanism | Notes |
|-------|-----------|-------|
| User → Pipeliner UI | IAP session cookie | Automatic after Google login |
| UI → own backend | IAP cookie forwarded | `withCredentials: true` in HttpClient |
| UI → CoreAgents | IAP cookie via `credentials: 'include'` | Cross-domain, same IAP org |
| Backend → CoreAgents | ID token from Cloud Run SA | `roles/iap.httpsResourceAccessor` |
| Row-level security | `created_by` from `x-goog-authenticated-user-email` | IAP header, trusted |

**Constraint:** The frontend never handles OAuth tokens for authentication. IAP does all of it. OAuth tokens only appear for Google Workspace operations (Drive file access, Docs export) where the user explicitly grants scope via the Drive Picker.

**Constraint:** Access tokens for Workspace operations are ephemeral — passed per-request, never stored in Spanner or cookies. Filtered from agent dispatch payloads to prevent accidental forwarding.

## Data Model

### Spanner Tables

All three tables live in the `innovation` database on the `innovation-graph` Spanner instance (shared with Ops Console and CoreAgents).

```sql
-- Template: a saved workflow graph
ops_pipeline_templates
  template_id   STRING(36) PK    -- UUID
  name          STRING(256)
  description   STRING(MAX)
  nodes         JSON              -- [{id, type, configuration, metadata}]
  edges         JSON              -- [{from_node, to_node, out, inp, optional}]
  graph_metadata JSON             -- viewport position, zoom level, etc.
  created_by    STRING(256)       -- email from IAP header
  created_at    TIMESTAMP         -- COMMIT_TIMESTAMP
  updated_at    TIMESTAMP         -- COMMIT_TIMESTAMP

-- Run: a single execution of a template
ops_pipeline_runs
  run_id        STRING(36) PK
  template_id   STRING(36)        -- FK to templates (application-level)
  status        STRING(32)        -- pending | running | paused | completed | failed
  inputs        JSON              -- grounding_docs, access_token, etc.
  outputs       JSON              -- final aggregated outputs
  node_runs     JSON              -- per-node execution records
  error         STRING(MAX)
  created_by    STRING(256)
  started_at    TIMESTAMP
  completed_at  TIMESTAMP
  created_at    TIMESTAMP
  updated_at    TIMESTAMP

-- Node run: execution record for a single node within a run
ops_pipeline_node_runs
  node_run_id   STRING(36) PK
  run_id        STRING(36)
  node_id       STRING(256)       -- matches node.id in template
  agent_id      STRING(128)       -- CoreAgents agent identifier
  status        STRING(32)        -- pending | running | completed | failed | skipped
  inputs        JSON              -- what was sent to the agent
  outputs       JSON              -- what the agent returned
  error         STRING(MAX)
  started_at    TIMESTAMP
  completed_at  TIMESTAMP
```

**Native JSON columns with Python serialization layer.**
The DDL uses Spanner's native `JSON` type (see `migrations/001_pipeline_tables.sql`). On read, the Python Spanner client (>= 3.x) returns `JsonObject` — a dict subclass that requires `.serialize()` + `json.loads()` to convert to plain Python types. On write, `json.dumps()` is still required because the mutation API doesn't accept raw Python dicts/lists. This serialize/deserialize layer lives in `spanner.py` and must not be removed.

## Agent Registry

The canonical agent list lives in CoreAgents. The Pipeliner consumes it two ways:

1. **Runtime fetch:** `GET /v1/agents` — fresh metadata on editor load
2. **Baked-in fallback:** `AGENT_REGISTRY` array hardcoded in `pipeline-editor.component.ts` — used if CoreAgents is unreachable

UI-specific metadata (Material icons, hex colors, group labels, display order) is mapped client-side by agent ID. This keeps the repos independent.

**Current agents (19 total: 1 I/O, 10 content, 8 operational):**

| Agent | Group | Purpose |
|-------|-------|---------|
| Google Drive | io | Import from / export to Google Drive |
| Persona | content | Micro-persona generation with psychographics |
| Strategy | content | Creative strategy frameworks and platform approaches |
| Creative Director | content | Scored creative concepts with visual direction |
| Copy | content | Platform-optimized copy — headlines, body, CTAs |
| Storyboard | content | Frame-by-frame visual storyboards |
| Image | content | Campaign image generation via Imagen 4 |
| Video | content | Video production via Veo 3.1 (7 sub-agents) |
| Audio | content | Voiceovers, background music, audio mixing |
| Briefing | operational | Transform unstructured inputs into structured briefs |
| Proposal | operational | Strategic proposals with territories and budgets |
| Production Planner | operational | Per-asset production manifests |
| Quality Gate | operational | ABCD framework scoring (Attract, Brand, Connect, Direct) |
| Producer | operational | Final QA, asset validation, delivery manifests |
| Optimizer | operational | Creative optimization analysis |

## File I/O System

### Upload Flow

```
User drops file → POST /api/io/upload (multipart, 50MB max)
    │
    ├── Extract text: PDF → PyPDF2, DOCX → python-docx, PPTX → python-pptx
    ├── Upload raw file to GCS: gs://pipeliner-uploads/{uuid}{ext}
    ├── Generate signed URL (1 hour expiry)
    └── Return: { uri, signed_url, mime_type, name, size, text_content }
```

### Google Drive Import Flow

```
User picks file via Drive Picker → POST /api/io/import-drive
    │
    ├── Google Workspace files: export via Drive API v3
    │   ├── Docs → text/plain
    │   ├── Sheets → text/csv
    │   └── Slides → text/plain
    ├── Non-Workspace files: download raw bytes
    ├── Upload to GCS
    └── Return same format as upload
```

### Google Docs Export Flow

```
User clicks "Export to Docs" → POST /api/io/export-doc
    │
    └── Proxy to CoreAgents POST /v1/export/docs
        (CoreAgents handles markdown → Google Docs API formatting)
        Returns: { doc_id, doc_url, title }
```

**Why proxy export through CoreAgents?** Google Docs API formatting (headings, bullets, tables, markdown conversion) is ~300 lines of non-trivial code that CoreAgents already maintains. Pipeline execution already calls CoreAgents for every agent node, so the export call adds zero new coupling.

## Deployment

### Container Architecture

```
┌─────────────────────────────────────┐
│         Cloud Run container          │
│                                       │
│  supervisord (PID 1)                  │
│    ├── nginx (port 8080)              │
│    │   ├── /           → ui/dist/ui/  │
│    │   └── /api, /health → :8000      │
│    └── uvicorn (port 8000)            │
│        └── src.main:app               │
└─────────────────────────────────────┘
```

**Constraint:** Cloud Run exposes exactly one port. nginx on 8080 serves the Angular static build and reverse-proxies `/api` and `/health` to uvicorn on 8000. This is the same pattern used by CoreAgents (`/Coreagents/Dockerfile.combined`).

### Build Pipeline

```
Cloud Build (cloudbuild.yaml)
    │
    ├── Stage 1: npm install && ng build → ui/dist/ui/
    ├── Stage 2: pip install → Python deps
    ├── Stage 3: Copy Angular build + Python app + nginx/supervisord configs
    └── Push to Artifact Registry → Deploy to Cloud Run
```

### IAM Requirements

| Principal | Role | Resource |
|-----------|------|----------|
| Cloud Run SA | `spanner.databaseUser` | `innovation` database |
| Cloud Run SA | `roles/iap.httpsResourceAccessor` | CoreAgents backend service |
| `domain:mediamonks.com` | `run.invoker` | Pipeliner Cloud Run service |
| IAP SA | `run.invoker` | Pipeliner Cloud Run service |
