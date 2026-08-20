from pathlib import Path

import pytest

from app.main import admin_ui, chat_ui, super_admin_ui


@pytest.mark.asyncio
async def test_chat_and_admin_pages_are_served_separately():
    chat_response = await chat_ui()
    admin_response = await admin_ui()
    super_admin_response = await super_admin_ui()

    assert Path(chat_response.path).name == "index.html"
    assert Path(admin_response.path).name == "admin.html"
    assert Path(super_admin_response.path).name == "super_admin.html"


def test_chat_page_links_to_admin_without_embedding_admin_controls():
    html = Path("app/static/index.html").read_text()

    assert 'href="/admin" data-admin-only' in html
    assert 'id="auth-gate" class="auth-gate" aria-labelledby="auth-title" hidden' in html
    assert 'id="upload-form"' not in html
    assert 'id="held-jobs"' not in html
    assert 'id="invite-form"' not in html


def test_chat_composer_supports_voice_and_enter_to_send():
    html = Path("app/static/index.html").read_text()
    script = Path("app/static/app.js").read_text()

    assert 'id="voice-input-button"' in html
    assert "window.SpeechRecognition || window.webkitSpeechRecognition" in script
    assert 'event.key === "Enter" && !event.shiftKey' in script
    assert "form.requestSubmit()" in script


def test_admin_page_is_role_gated_and_contains_management_workflows():
    html = Path("app/static/admin.html").read_text()
    script = Path("app/static/admin.js").read_text()

    assert 'id="upload-form"' in html
    assert 'id="held-jobs"' in html
    assert 'id="invite-form"' in html
    assert 'payload.user?.role !== "admin"' in script
    assert 'location.replace("/")' in script


def test_super_admin_page_is_platform_gated_and_contains_safe_controls():
    html = Path("app/static/super_admin.html").read_text()
    script = Path("app/static/super_admin.js").read_text()

    assert "Organizations and access" in html
    assert "/v1/super-admin/organizations" in script
    assert "payload.user?.is_super_admin" in script
    assert "Revoke every active session" in script
    assert 'location.replace("/")' in script


def test_hidden_role_navigation_cannot_be_overridden_by_component_display():
    stylesheet = Path("app/static/app.css").read_text()

    assert "[hidden] {\n  display: none !important;\n}" in stylesheet


def test_platform_migration_adds_only_explicit_authority_fields():
    migration = Path("migrations/versions/20260819_02_platform_admin.py").read_text()

    assert 'op.add_column("organizations"' in migration
    assert 'op.add_column("users"' in migration
    assert '"is_super_admin"' in migration
