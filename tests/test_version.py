import tomllib
from pathlib import Path

import pytest

from app.main import app, version
from app.version import APP_VERSION
from tools.version import bump_kind, finalized_changelog, increment


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


@pytest.mark.parametrize(
    ("messages", "expected"),
    [
        ("fix: correct quota", "patch"),
        ("Update documentation", "patch"),
        ("feat(chat): add quotas", "minor"),
        ("feat!: replace API\n\nBREAKING CHANGE: new contract", "major"),
        ("fix(api)!: remove field", "major"),
    ],
)
def test_conventional_commit_messages_select_increment(messages, expected):
    assert bump_kind(messages) == expected


@pytest.mark.parametrize(
    ("current", "part", "expected"),
    [
        ("1.2.3", "patch", "1.2.4"),
        ("1.2.3", "minor", "1.3.0"),
        ("1.2.3", "major", "2.0.0"),
    ],
)
def test_semantic_version_increment(current, part, expected):
    assert increment(current, part) == expected


def test_automatic_bump_finalizes_unreleased_changelog():
    content = "# Changelog\n\n## Unreleased\n\n- Added bulk selection.\n\n## 0.3.3 - 2026-08-21\n"

    result = finalized_changelog(content, "0.4.0", "2026-08-22")

    assert "## Unreleased\n\n## 0.4.0 - 2026-08-22\n\n- Added bulk selection." in result


def test_release_workflow_auto_versions_and_tags_successful_main_builds():
    workflow = Path(".github/workflows/ci.yml").read_text()

    assert "needs: validate" in workflow
    assert "github.ref == 'refs/heads/main'" in workflow
    assert 'python tools/version.py --bump auto --since "$tag"' in workflow
    assert 'git push origin HEAD:main' in workflow
    assert 'git tag -a "$tag" "$release_sha"' in workflow
    assert 'git push origin "$tag"' in workflow
