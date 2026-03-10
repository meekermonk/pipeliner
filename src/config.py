"""Pipeliner configuration — environment-driven settings.

All settings are loaded from environment variables with sensible defaults
for the production environment (meekerexperiments project). Local development
typically needs no overrides — the defaults point to the shared Spanner
instance and CoreAgents production URL.

Constraint: The Spanner instance (innovation-graph) and database (innovation)
are shared with Ops Console and CoreAgents. All three apps read/write their
own tables in the same database. This was an intentional choice to avoid
Spanner provisioning overhead (Spanner bills per node, not per database).

Source reference: Deployment config in
docs/plans/2026-03-09-pipeliner-standalone-design.md.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    gcp_project_id: str = "meekerexperiments"
    gcp_region: str = "us-central1"

    # Spanner
    spanner_instance: str = "innovation-graph"
    spanner_database: str = "innovation"

    # Collection names (Spanner table names)
    pipeline_templates_collection: str = "ops_pipeline_templates"
    pipeline_runs_collection: str = "ops_pipeline_runs"
    pipeline_node_runs_collection: str = "ops_pipeline_node_runs"

    # GCS
    gcs_bucket: str = "pipeliner-uploads"

    # CoreAgents service URL
    coreagents_base_url: str = "https://core-agents.mf4g.studio/v1"

    # CORS
    allowed_origins: list[str] = [
        "http://localhost:4200",
        "https://pipeline.mf4g.studio",
    ]


settings = Settings()
