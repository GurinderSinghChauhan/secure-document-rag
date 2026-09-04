from pathlib import Path

import pytest
from fastapi import Request, Response

from app.config import Settings
from app.main import admin_ui, ask_ui, chat_ui, insights_ui, security_headers, super_admin_ui


FRONTEND = Path("frontend")


@pytest.mark.asyncio
async def test_all_application_routes_use_the_shared_spa_entrypoint():
    responses = [
        await chat_ui(),
        await ask_ui(),
        await insights_ui("field_service.service_invoice"),
        await admin_ui(),
        await super_admin_ui(),
    ]

    assert {Path(response.path) for response in responses} == {Path("app/static/spa/index.html")}


def test_frontend_uses_the_approved_framework_foundation():
    package = (FRONTEND / "package.json").read_text(encoding="utf-8")

    for dependency in ("react", "react-router-dom", "@tanstack/react-query", "@radix-ui/react-tabs", "vite", "typescript"):
        assert f'"{dependency}"' in package
    assert '"check": "npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build"' in package


def test_route_modules_are_lazy_loaded_and_role_guarded():
    application = (FRONTEND / "src/app/App.tsx").read_text(encoding="utf-8")

    assert 'import("../routes/ask/AskRoute")' in application
    assert 'import("../routes/dashboard/DashboardRoute")' in application
    assert 'import("../routes/admin/AdminRoute")' in application
    assert 'import("../routes/platform-admin/PlatformAdminRoute")' in application
    assert 'path="/admin"' in application
    assert 'role="admin"' in application
    assert 'path="/super-admin"' in application
    assert 'role="super-admin"' in application


def test_react_features_preserve_existing_backend_workflows():
    sources = "\n".join(path.read_text(encoding="utf-8") for path in (FRONTEND / "src/features").rglob("*.ts*"))

    for endpoint in (
        "/v1/query/stream",
        "/v1/chats",
        "/v1/documents/stream",
        "/v1/admin/documents",
        "/v1/dashboard",
        "/v1/document-schemas",
        "/v1/admin/ingestion-jobs?state=held_for_compute",
        "/v1/admin/compute-sessions",
        "/v1/admin/organization/members",
        "/v1/admin/organization/invitations",
        "/v1/super-admin/organizations",
        "/v1/super-admin/chat-responses",
    ):
        assert endpoint in sources


def test_frontend_is_feature_first_and_route_composed():
    expected = (
        "src/app/App.tsx",
        "src/api/client.ts",
        "src/components/layout/AppShell.tsx",
        "src/components/ui/PasswordField.tsx",
        "src/features/auth/index.ts",
        "src/features/chat/index.ts",
        "src/features/compute/index.ts",
        "src/features/documents/index.ts",
        "src/features/dashboard/index.ts",
        "src/features/organization/index.ts",
        "src/features/platform-oversight/index.ts",
        "src/routes/ask/AskRoute.tsx",
        "src/routes/admin/AdminRoute.tsx",
        "src/routes/dashboard/DashboardRoute.tsx",
        "src/routes/platform-admin/PlatformAdminRoute.tsx",
    )

    assert all((FRONTEND / path).is_file() for path in expected)


def test_production_build_is_node_free_and_uses_hashed_asset_caching():
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8")
    server = Path("app/main.py").read_text(encoding="utf-8")
    vite = (FRONTEND / "vite.config.ts").read_text(encoding="utf-8")

    assert "FROM node:" in dockerfile
    assert "COPY --from=frontend" in dockerfile
    assert dockerfile.rindex("FROM python:") > dockerfile.index("FROM node:")
    assert 'command === "build" ? "/assets/spa/" : "/"' in vite
    assert 'request.url.path.startswith("/assets/spa/assets/")' in server
    assert '"public, max-age=31536000, immutable"' in server
    assert "sourcemap: false" in vite


def test_container_build_preserves_release_identity_and_minimizes_build_context():
    dockerfile = Path("Dockerfile").read_text(encoding="utf-8")
    dockerignore = Path(".dockerignore").read_text(encoding="utf-8").splitlines()

    assert "ARG APP_COMMIT" in dockerfile
    assert "org.opencontainers.image.revision=$APP_COMMIT" in dockerfile
    assert "uv cache clean" in dockerfile
    assert "--no-server-header" in dockerfile
    assert ".env" in dockerignore
    assert ".git" in dockerignore


@pytest.mark.asyncio
async def test_customer_responses_receive_defensive_security_headers(monkeypatch):
    settings = Settings()
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "query_string": b"",
            "headers": [],
            "scheme": "http",
            "server": ("localhost", 8080),
            "client": ("127.0.0.1", 10000),
        }
    )

    async def empty_response(_: Request) -> Response:
        return Response()

    response = await security_headers(request, empty_response)

    assert response.headers["Content-Security-Policy"].startswith("default-src 'self'")
    assert response.headers["Permissions-Policy"]
    assert response.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert response.headers["Cross-Origin-Resource-Policy"] == "same-origin"
    assert "Strict-Transport-Security" not in response.headers

    settings.environment = "production"
    production_response = await security_headers(request, empty_response)
    assert production_response.headers["Strict-Transport-Security"] == (
        "max-age=63072000; includeSubDomains"
    )


def test_platform_migration_adds_only_explicit_authority_fields():
    migration = Path("migrations/versions/20260819_02_platform_admin.py").read_text(encoding="utf-8")

    assert 'op.add_column("organizations"' in migration
    assert 'op.add_column("users"' in migration
    assert '"is_super_admin"' in migration
