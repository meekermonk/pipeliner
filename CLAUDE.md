# Pipeliner — CLAUDE.md

## Project Structure

```
ui/                  # Angular 19 frontend (standalone components)
  src/app/
    pipeline/        # Editor, list, shell components
    services/        # API service, manifest service
    models/          # TypeScript interfaces
src/                 # Python FastAPI backend
  api/               # Route handlers
  models/            # Pydantic models
  services/          # Spanner client, pipeline executor
deploy/              # nginx, supervisord configs
migrations/          # Spanner DDL
```

## Commands

```bash
# Frontend
cd ui && ng serve                        # Dev server (port 4200)

# Backend
uvicorn src.main:app --reload            # API server (port 8000)

# Tests
pytest                                    # Python tests

# Lint
ruff check .                              # Lint Python
ruff format .                             # Format Python
```

## Conventions

- **Standalone Angular components** — All components use `standalone: true`. No NgModules.
- **IAP auth only** — No Firebase Auth. IAP handles login, session cookies, access control.
- **Agents live in CoreAgents** — This app dispatches to CoreAgents over HTTP, never hosts agents.
- **Spanner for storage** — Pipeline templates and runs stored in Cloud Spanner.
