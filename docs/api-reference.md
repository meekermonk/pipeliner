# Pipeliner — API Reference

## Base URL

- **Local:** `http://localhost:8000`
- **Production:** `https://pipeliner-app-coluam67dq-uc.a.run.app` (via nginx reverse proxy on `/api`; eventually `https://pipeline.mf4g.studio`)

## Authentication

All endpoints are behind IAP. The `x-goog-authenticated-user-email` header (set by IAP) identifies the user. No API keys or bearer tokens needed for CRUD operations.

Google Workspace operations (Drive import, Docs export) require the user's OAuth `access_token`, passed in the request body. This token is ephemeral and never stored.

---

## Pipeline Templates

Templates represent saved workflow graphs. Each template contains nodes (agents, I/O modules) and edges (data connections) serialized as JSON.

### `POST /api/pipelines/`

Create a new pipeline template.

**Request:**
```json
{
  "name": "Q3 Campaign Pipeline",
  "description": "Brief → Strategy → Creative → Delivery",
  "nodes": [
    {
      "id": "node-1",
      "type": "ops-agent-briefing",
      "configuration": { "agent_id": "briefing", "mode": "pipeline" },
      "metadata": { "position": { "x": 100, "y": 200 } }
    }
  ],
  "edges": [
    { "from_node": "node-1", "to_node": "node-2" }
  ],
  "graph_metadata": { "viewport": { "x": 0, "y": 0, "zoom": 1 } }
}
```

**Response (201):**
```json
{ "id": "a1b2c3d4-...", "status": "created" }
```

**Constraints:**
- `name` is required. Templates without a name get "Untitled Workflow" from the UI.
- `created_by` is set automatically from the IAP header. Cannot be overridden.
- Node and edge validation happens at the executor level, not on save. Invalid graphs are caught at run time.

### `GET /api/pipelines/`

List all pipeline templates, ordered by last update.

**Response (200):**
```json
[
  {
    "id": "a1b2c3d4-...",
    "template_id": "a1b2c3d4-...",
    "name": "Q3 Campaign Pipeline",
    "description": "...",
    "nodes": [...],
    "edges": [...],
    "created_by": "dave@mediamonks.com",
    "created_at": "2026-03-10T10:00:00Z",
    "updated_at": "2026-03-10T14:30:00Z"
  }
]
```

**Constraint:** Returns max 50 results. No pagination implemented yet — sufficient for current team size.

### `GET /api/pipelines/{template_id}`

Get a single template by ID.

**Response (200):** Full template object.
**Response (404):** `{ "detail": "Pipeline template not found" }`

### `PUT /api/pipelines/{template_id}`

Update an existing template. Only provided fields are updated (partial update).

**Request:**
```json
{
  "name": "Updated Name",
  "nodes": [...],
  "edges": [...]
}
```

**Response (200):** `{ "id": "...", "updated": true }`
**Response (404):** Template not found.

### `DELETE /api/pipelines/{template_id}`

Delete a template. Hard delete — no soft delete or trash.

**Response (204):** No content.
**Response (404):** Template not found.

---

## Pipeline Runs

Runs represent a single execution of a template. The executor walks the DAG topologically and records outputs per node.

### `POST /api/pipelines/{template_id}/run`

Start a new pipeline run.

**Request:**
```json
{
  "inputs": {
    "grounding_docs": [
      {
        "text_content": "Brand brief content...",
        "uri": "gs://pipeliner-uploads/abc.pdf",
        "name": "Campaign Brief.pdf"
      }
    ],
    "access_token": "ya29.a0AfH6SM..."
  }
}
```

**Response (201):**
```json
{ "id": "run-uuid-...", "status": "pending" }
```

**Constraints:**
- `access_token` is required only if the pipeline contains `io-google-drive` nodes.
- `grounding_docs` is optional. When provided, all `text_content` values are concatenated and injected as `brief_context` into every agent dispatch.
- The access token is filtered from agent dispatch payloads — it never reaches CoreAgents.
- Run execution happens asynchronously. Poll `GET /api/pipelines/runs/{id}` for status.

**Source reference:** The `grounding_docs` format matches the manifest schema returned by CoreAgents `GET /v1/sessions/{id}/manifest`. This allows manifest imports to feed directly into pipeline runs.

### `GET /api/pipelines/runs/{run_id}`

Get run status and outputs.

**Response (200):**
```json
{
  "id": "run-uuid-...",
  "template_id": "template-uuid-...",
  "status": "completed",
  "inputs": { ... },
  "outputs": { ... },
  "node_runs": [ ... ],
  "started_at": "2026-03-10T15:00:00Z",
  "completed_at": "2026-03-10T15:03:42Z",
  "error": null
}
```

**Run statuses:** `pending` → `running` → `completed` | `failed` | `paused`

### `GET /api/pipelines/{template_id}/runs`

List runs for a specific template.

**Response (200):** Array of run objects, ordered by last update, max 50.

---

## I/O Endpoints

### `POST /api/io/upload`

Upload a file, extract text, store in GCS.

**Request:** `multipart/form-data` with `file` field.

**Response (200):**
```json
{
  "uri": "gs://pipeliner-uploads/abc123.pdf",
  "signed_url": "https://storage.googleapis.com/...",
  "mime_type": "application/pdf",
  "name": "Campaign Brief.pdf",
  "size": 245678,
  "text_content": "Executive Summary: Q3 campaign targets..."
}
```

**Constraints:**
- Max file size: 50 MB. Returns 413 if exceeded.
- Text extraction supports: PDF (PyPDF2), DOCX (python-docx), PPTX (python-pptx), TXT, MD, CSV.
- `text_content` capped at 50,000 characters. Truncation is silent.
- Signed URL expires after 1 hour.
- Unsupported file types are stored in GCS but return empty `text_content`.

### `POST /api/io/import-drive`

Import a file from Google Drive using the user's OAuth token.

**Request:**
```json
{
  "file_id": "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  "file_name": "Campaign Brief",
  "mime_type": "application/vnd.google-apps.document",
  "access_token": "ya29.a0AfH6SM..."
}
```

**Response (200):** Same format as upload.

**Google Workspace file handling:**

| MIME Type | Export Format |
|-----------|-------------|
| `application/vnd.google-apps.document` | `text/plain` |
| `application/vnd.google-apps.spreadsheet` | `text/csv` |
| `application/vnd.google-apps.presentation` | `text/plain` |
| Other (PDF, images, etc.) | Raw binary download |

**Constraints:**
- `access_token` must have `drive.readonly` scope (or `drive.file` if the file was created by the app).
- Token is used for the single API call and never stored.
- Workspace files are exported (converted), not downloaded as-is. A Google Doc becomes plain text, not a `.docx`.

### `POST /api/io/export-doc`

Create a Google Doc from text content. Proxied through CoreAgents.

**Request:**
```json
{
  "title": "Q3 Campaign — Pipeline Output",
  "content": "# Strategy\n\nTarget audience: 25-34 urban professionals...",
  "folder_id": "1FolderIdHere",
  "access_token": "ya29.a0AfH6SM..."
}
```

**Response (200):**
```json
{
  "doc_id": "1NewDocIdHere",
  "doc_url": "https://docs.google.com/document/d/1NewDocIdHere",
  "title": "Q3 Campaign — Pipeline Output"
}
```

**Response (502):** `{ "detail": "Failed to create Google Doc: ..." }` — CoreAgents unreachable.

**Constraints:**
- `folder_id` is optional. If omitted, the doc is created in the user's Drive root.
- `access_token` must have `drive.file` scope.
- Content is markdown — CoreAgents converts it to Google Docs formatting (headings, bullets, tables).
- This is the only endpoint that proxies to CoreAgents. Upload and Drive import are handled directly.

---

## Agent Registry

### `GET /api/agents/registry`

Proxy to CoreAgents to fetch the live agent registry.

**Response (200):** Array of agent definitions from CoreAgents.
**Response (502):** CoreAgents unreachable. The frontend falls back to its baked-in `AGENT_REGISTRY`.

---

## Health Check

### `GET /health`

**Response (200):**
```json
{ "status": "ok", "service": "pipeliner" }
```

Used by Cloud Run health checks and load balancer probes.
