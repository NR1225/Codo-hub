"""Site config API - static/site configuration for frontend"""
import json
import os
from pathlib import Path
from fastapi import APIRouter, HTTPException

from config import SITE_CONFIG_FILE

router = APIRouter()


def _load_site_config() -> dict:
    path = Path(SITE_CONFIG_FILE)
    if not path.exists():
        return {
            "appName": "Codo Hub",
            "contact": {"email": "", "phone": "", "address": "", "addressEn": "Kazakhstan"},
            "externalLinks": [],
            "fileConfig": {
                "maxFileSizeBytes": 31457280,
                "maxFileSizeMB": 30,
                "supportedExtensions": [".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cpp", ".c", ".h", ".html", ".css", ".json", ".md", ".xml", ".yaml", ".yml"]
            },
            "apiDisplayUrl": "http://127.0.0.1:3000/api"
        }
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(status_code=500, detail="Configuration unavailable. Please try again later.")


@router.get("/config", response_model=dict)
async def get_config():
    """Return site configuration (app name, contact, external links, file limits, features, etc.) for frontend."""
    config = _load_site_config()

    # Add Firebase config from environment variables (not stored in JSON for security)
    firebase_config = {}
    fb_api_key = os.getenv("FIREBASE_API_KEY", "")
    fb_auth_domain = os.getenv("FIREBASE_AUTH_DOMAIN", "")
    fb_project_id = os.getenv("FIREBASE_PROJECT_ID", "")
    fb_storage_bucket = os.getenv("FIREBASE_STORAGE_BUCKET", "")
    fb_messaging_sender_id = os.getenv("FIREBASE_MESSAGING_SENDER_ID", "")
    fb_app_id = os.getenv("FIREBASE_APP_ID", "")
    fb_measurement_id = os.getenv("FIREBASE_MEASUREMENT_ID", "")

    # Only include Firebase config if all required values are present
    if all([fb_api_key, fb_auth_domain, fb_project_id, fb_storage_bucket, fb_messaging_sender_id, fb_app_id]):
        firebase_config = {
            "apiKey": fb_api_key,
            "authDomain": fb_auth_domain,
            "projectId": fb_project_id,
            "storageBucket": fb_storage_bucket,
            "messagingSenderId": fb_messaging_sender_id,
            "appId": fb_app_id,
        }
        if fb_measurement_id:
            firebase_config["measurementId"] = fb_measurement_id

    if firebase_config:
        config["firebaseConfig"] = firebase_config

    # Add Google Client ID from environment variable
    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if google_client_id:
        config["googleClientId"] = google_client_id

    return config