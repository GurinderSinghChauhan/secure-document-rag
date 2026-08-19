from pathlib import Path

import pytest

from app.main import admin_ui, chat_ui


@pytest.mark.asyncio
async def test_chat_and_admin_pages_are_served_separately():
    chat_response = await chat_ui()
    admin_response = await admin_ui()

    assert Path(chat_response.path).name == "index.html"
    assert Path(admin_response.path).name == "admin.html"


def test_chat_page_links_to_admin_without_embedding_admin_controls():
    html = Path("app/static/index.html").read_text()

    assert 'href="/admin" data-admin-only' in html
    assert 'id="auth-gate" class="auth-gate" aria-labelledby="auth-title" hidden' in html
    assert 'id="upload-form"' not in html
    assert 'id="held-jobs"' not in html
    assert 'id="invite-form"' not in html


def test_admin_page_is_role_gated_and_contains_management_workflows():
    html = Path("app/static/admin.html").read_text()
    script = Path("app/static/admin.js").read_text()

    assert 'id="upload-form"' in html
    assert 'id="held-jobs"' in html
    assert 'id="invite-form"' in html
    assert 'payload.user?.role !== "admin"' in script
    assert 'location.replace("/")' in script
