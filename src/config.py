"""Environment-driven configuration."""

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

    # CoreAgents service URL
    coreagents_base_url: str = "https://core-agents.mf4g.studio/v1"

    # CORS
    allowed_origins: list[str] = [
        "http://localhost:4200",
        "https://pipeline.mf4g.studio",
    ]


settings = Settings()
