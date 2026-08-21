import tomllib
from pathlib import Path

import pytest

from app.main import app, version
from app.version import APP_VERSION


def test_runtime_and_package_versions_match():
    with open("pyproject.toml", "rb") as source:
        package_version = tomllib.load(source)["project"]["version"]

    assert APP_VERSION == package_version
    assert app.version == APP_VERSION


@pytest.mark.asyncio
async def test_version_endpoint_reports_build_identity():
    payload = await version()

    assert payload.version == APP_VERSION
    assert payload.commit


def test_release_workflow_auto_tags_successful_main_builds():
    workflow = Path(".github/workflows/ci.yml").read_text()

    assert "needs: validate" in workflow
    assert "github.ref == 'refs/heads/main'" in workflow
    assert 'git tag -a "$tag" "$GITHUB_SHA"' in workflow
    assert 'git push origin "$tag"' in workflow
    assert 'echo "publish=false"' in workflow
