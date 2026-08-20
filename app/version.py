import os
from pathlib import Path


APP_VERSION = (Path(__file__).resolve().parent.parent / "VERSION").read_text(encoding="utf-8").strip()
APP_COMMIT = os.getenv("APP_COMMIT", "unknown")
