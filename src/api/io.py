"""File upload, Google Drive import, and export routes."""

from __future__ import annotations

import mimetypes
from typing import Optional

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from src.config import settings
from src.services.file_parser import extract_text
from src.services.storage import upload_bytes

router = APIRouter(prefix="/api/io", tags=["io"])

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file, extract text, store in GCS."""
    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large (max 50 MB)")

    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    filename = file.filename or "upload"

    uri, signed_url = upload_bytes(data, filename, content_type)
    text_content = extract_text(data, content_type)

    return {
        "uri": uri,
        "signed_url": signed_url,
        "mime_type": content_type,
        "name": filename,
        "size": len(data),
        "text_content": text_content[:50000],  # Cap at 50K chars
    }


class ImportDriveRequest(BaseModel):
    file_id: str
    file_name: str
    mime_type: str
    access_token: str


@router.post("/import-drive")
async def import_from_drive(body: ImportDriveRequest):
    """Import a file from Google Drive using user's OAuth token."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(token=body.access_token)
    drive = build("drive", "v3", credentials=creds)

    # Export Google Workspace files to plain text formats
    google_mime_map = {
        "application/vnd.google-apps.document": ("text/plain", ".txt"),
        "application/vnd.google-apps.spreadsheet": ("text/csv", ".csv"),
        "application/vnd.google-apps.presentation": ("text/plain", ".txt"),
    }

    if body.mime_type in google_mime_map:
        export_mime, ext = google_mime_map[body.mime_type]
        data = drive.files().export(fileId=body.file_id, mimeType=export_mime).execute()
        if isinstance(data, str):
            data = data.encode("utf-8")
        content_type = export_mime
    else:
        data = drive.files().get_media(fileId=body.file_id).execute()
        content_type = body.mime_type
        ext = ""

    filename = body.file_name + ext if ext and not body.file_name.endswith(ext) else body.file_name
    uri, signed_url = upload_bytes(data, filename, content_type)
    text_content = extract_text(data, content_type) if isinstance(data, bytes) else data.decode("utf-8", errors="replace")

    return {
        "uri": uri,
        "signed_url": signed_url,
        "mime_type": content_type,
        "name": filename,
        "size": len(data),
        "text_content": text_content[:50000],
    }


class ExportDocRequest(BaseModel):
    title: str
    content: str
    folder_id: Optional[str] = None
    access_token: str


@router.post("/export-doc")
async def export_to_doc(body: ExportDocRequest):
    """Proxy to CoreAgents to create a Google Doc from content."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{settings.coreagents_base_url}/export/docs",
                json={
                    "title": body.title,
                    "content": body.content,
                    "folder_id": body.folder_id,
                    "access_token": body.access_token,
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Failed to create Google Doc: {exc}")
