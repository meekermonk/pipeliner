"""GCS upload utility."""

from __future__ import annotations

import datetime
import uuid
from pathlib import Path

from google.cloud import storage

from src.config import settings


def upload_bytes(
    data: bytes,
    filename: str,
    content_type: str,
    prefix: str = "pipeliner/uploads",
) -> tuple[str, str]:
    """Upload bytes to GCS. Returns (gcs_uri, signed_url)."""
    client = storage.Client(project=settings.gcp_project_id)
    bucket = client.bucket(settings.gcs_bucket)

    ext = Path(filename).suffix or ""
    blob_path = f"{prefix}/{uuid.uuid4()}{ext}"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(data, content_type=content_type)

    gcs_uri = f"gs://{settings.gcs_bucket}/{blob_path}"
    signed_url = blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(hours=1),
        method="GET",
    )
    return gcs_uri, signed_url
