-- Pipeline tables (shared Spanner database with Ops Console)

CREATE TABLE IF NOT EXISTS ops_pipeline_templates (
    template_id   STRING(36) NOT NULL,
    name          STRING(256) NOT NULL,
    description   STRING(MAX),
    nodes         JSON,
    edges         JSON,
    graph_metadata JSON,
    created_by    STRING(256),
    created_at    TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp = true),
    updated_at    TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp = true),
) PRIMARY KEY (template_id);

CREATE TABLE IF NOT EXISTS ops_pipeline_runs (
    run_id        STRING(36) NOT NULL,
    template_id   STRING(36) NOT NULL,
    status        STRING(32) NOT NULL,
    inputs        JSON,
    outputs       JSON,
    node_runs     JSON,
    started_at    TIMESTAMP,
    completed_at  TIMESTAMP,
    created_by    STRING(256),
    error         STRING(MAX),
    created_at    TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp = true),
    updated_at    TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp = true),
) PRIMARY KEY (run_id);

CREATE TABLE IF NOT EXISTS ops_pipeline_node_runs (
    node_run_id   STRING(36) NOT NULL,
    run_id        STRING(36) NOT NULL,
    node_id       STRING(256) NOT NULL,
    agent_id      STRING(128),
    status        STRING(32) NOT NULL,
    inputs        JSON,
    outputs       JSON,
    started_at    TIMESTAMP,
    completed_at  TIMESTAMP,
    error         STRING(MAX),
) PRIMARY KEY (node_run_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_template ON ops_pipeline_runs (template_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_node_runs_run ON ops_pipeline_node_runs (run_id);
