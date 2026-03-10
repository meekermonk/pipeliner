# Pipeliner

Visual pipeline builder for Monks.Flow agent orchestration. Drag-and-drop DAG editor that dispatches agents to CoreAgents for execution.

## Quick Start

```bash
# Backend
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000

# Frontend
cd ui
npm install
ng serve --port 4200
```

## Deployment

```bash
gcloud builds submit --config=cloudbuild.yaml --project=meekerexperiments
```

Deploys to Cloud Run at `https://pipeline.mf4g.studio`.
