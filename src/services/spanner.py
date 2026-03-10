"""Spanner service — pipeline tables only.

Provides async CRUD operations for the three pipeline tables in the shared
Spanner instance (innovation-graph / innovation database).

Architectural decision: Spanner instead of Firestore because the Ops Console
and CoreAgents already use this instance. Sharing avoids provisioning overhead
and enables future cross-app queries. The tradeoff is that Spanner's JSON
support requires manual serialization (json.dumps/loads at this layer).

Constraint: JSON columns (nodes, edges, inputs, outputs, etc.) are stored as
STRING(MAX), not Spanner's native JSON type, for consistency with the existing
Ops Console schema. All JSON handling happens in _split_fields / _row_to_dict.

Constraint: created_at and updated_at use COMMIT_TIMESTAMP — Spanner sets the
value at commit time, ensuring globally consistent timestamps. These columns
cannot be set by application code.

Source reference: Table DDL in migrations/001_pipeline_tables.sql.
"""

import asyncio
import json
import uuid
from typing import Optional

from google.cloud import spanner

from src.config import settings

TABLE_PK_MAP = {
    "ops_pipeline_templates": "template_id",
    "ops_pipeline_runs": "run_id",
    "ops_pipeline_node_runs": "node_run_id",
}

TABLE_COLUMNS = {
    "ops_pipeline_templates": {
        "template_id", "name", "description", "nodes", "edges",
        "graph_metadata", "created_by", "created_at", "updated_at",
    },
    "ops_pipeline_runs": {
        "run_id", "template_id", "status", "inputs", "outputs",
        "node_runs", "started_at", "completed_at", "created_by", "error",
        "created_at", "updated_at",
    },
    "ops_pipeline_node_runs": {
        "node_run_id", "run_id", "node_id", "agent_id", "status",
        "inputs", "outputs", "started_at", "completed_at", "error",
    },
}

JSON_COLUMNS = {
    "ops_pipeline_templates": {"nodes", "edges", "graph_metadata"},
    "ops_pipeline_runs": {"inputs", "outputs", "node_runs"},
    "ops_pipeline_node_runs": {"inputs", "outputs"},
}

COMMIT_TS_COLUMNS = {"created_at", "updated_at"}


def _pk_col(table: str) -> str:
    return TABLE_PK_MAP.get(table, "id")


class SpannerService:

    def __init__(self) -> None:
        self._client: spanner.Client | None = None
        self._db = None

    @property
    def client(self) -> spanner.Client:
        if self._client is None:
            self._client = spanner.Client(project=settings.gcp_project_id)
        return self._client

    @property
    def db(self):
        if self._db is None:
            instance = self.client.instance(settings.spanner_instance)
            self._db = instance.database(settings.spanner_database)
        return self._db

    def _split_fields(self, table: str, data: dict, doc_id: str) -> tuple[list[str], list]:
        pk_col = _pk_col(table)
        known = TABLE_COLUMNS.get(table, set())
        json_cols = JSON_COLUMNS.get(table, set())

        columns = [pk_col]
        values: list = [doc_id]

        for key, val in data.items():
            if key == pk_col or key == "id" or key in COMMIT_TS_COLUMNS:
                continue
            if key in known:
                if key in json_cols and val is not None:
                    val = json.dumps(val)
                columns.append(key)
                values.append(val)

        for ts_col in ("created_at", "updated_at"):
            if ts_col in known:
                columns.append(ts_col)
                values.append(spanner.COMMIT_TIMESTAMP)

        return columns, values

    def _row_to_dict(self, table: str, columns: list[str], row) -> dict:
        pk_col = _pk_col(table)
        json_cols = JSON_COLUMNS.get(table, set())
        result: dict = {}
        for col, val in zip(columns, row):
            if col in json_cols and val is not None:
                try:
                    val = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pass
            result[col] = val
        if pk_col in result:
            result["id"] = result[pk_col]
        return result

    async def create_document(self, table: str, data: dict, doc_id: str | None = None) -> str:
        if doc_id is None:
            doc_id = str(uuid.uuid4())
        columns, values = self._split_fields(table, data, doc_id)

        def _insert(transaction):
            transaction.insert(table, columns=columns, values=[values])

        await asyncio.to_thread(self.db.run_in_transaction, _insert)
        return doc_id

    async def get_document(self, table: str, doc_id: str) -> Optional[dict]:
        pk_col = _pk_col(table)
        known = TABLE_COLUMNS.get(table, set())
        read_columns = sorted(known) if known else [pk_col]

        def _read():
            with self.db.snapshot() as snapshot:
                rows = list(snapshot.read(table, columns=read_columns, keyset=spanner.KeySet(keys=[[doc_id]])))
            return rows

        rows = await asyncio.to_thread(_read)
        if not rows:
            return None
        return self._row_to_dict(table, read_columns, rows[0])

    async def update_document(self, table: str, doc_id: str, data: dict) -> None:
        pk_col = _pk_col(table)
        known = TABLE_COLUMNS.get(table, set())
        json_cols = JSON_COLUMNS.get(table, set())

        columns = [pk_col]
        values: list = [doc_id]

        for key, val in data.items():
            if key == pk_col or key == "id" or key in COMMIT_TS_COLUMNS:
                continue
            if key in known:
                if key in json_cols and val is not None:
                    val = json.dumps(val)
                columns.append(key)
                values.append(val)

        if "updated_at" in known and "updated_at" not in columns:
            columns.append("updated_at")
            values.append(spanner.COMMIT_TIMESTAMP)

        def _update(transaction):
            transaction.update(table, columns=columns, values=[values])

        await asyncio.to_thread(self.db.run_in_transaction, _update)

    async def delete_document(self, table: str, doc_id: str) -> None:
        keyset = spanner.KeySet(keys=[[doc_id]])

        def _delete(transaction):
            transaction.delete(table, keyset)

        await asyncio.to_thread(self.db.run_in_transaction, _delete)

    async def list_documents(
        self, table: str, filters: dict | None = None,
        order_by: str = "updated_at", limit: int = 50,
    ) -> list[dict]:
        known = TABLE_COLUMNS.get(table, set())
        select_columns = sorted(known) if known else ["*"]
        col_list = ", ".join(select_columns)

        sql = f"SELECT {col_list} FROM {table}"
        params: dict = {}
        param_types: dict = {}

        if filters:
            clauses = []
            for i, (field, value) in enumerate(filters.items()):
                clauses.append(f"{field} = @p{i}")
                params[f"p{i}"] = value
                param_types[f"p{i}"] = spanner.param_types.STRING
            sql += " WHERE " + " AND ".join(clauses)

        sql += f" ORDER BY {order_by} DESC LIMIT {limit}"

        def _query():
            with self.db.snapshot() as snapshot:
                rows = list(snapshot.execute_sql(sql, params=params, param_types=param_types))
            return rows

        rows = await asyncio.to_thread(_query)
        return [self._row_to_dict(table, select_columns, row) for row in rows]


spanner_service = SpannerService()
