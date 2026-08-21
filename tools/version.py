"""Check, update, or automatically bump the repository's semantic version."""

import argparse
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
CONVENTIONAL_HEADER = re.compile(r"^[a-z]+(?:\([^\n)]*\))?(!?):", re.MULTILINE)
FEATURE_HEADER = re.compile(r"^feat(?:\([^\n)]*\))?!?:", re.MULTILINE)


def declared_versions() -> tuple[str, str, str]:
    canonical = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    pyproject = re.search(r'^version = "([^"]+)"$', (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.MULTILINE)
    lock = re.search(
        r'\[\[package\]\]\nname = "secure-document-rag"\nversion = "([^"]+)"',
        (ROOT / "uv.lock").read_text(encoding="utf-8"),
    )
    if pyproject is None or lock is None:
        raise SystemExit("Unable to find the project version declarations")
    return canonical, pyproject.group(1), lock.group(1)


def check() -> None:
    versions = declared_versions()
    if not SEMVER.fullmatch(versions[0]):
        raise SystemExit(f"VERSION must contain stable semantic version X.Y.Z, found {versions[0]!r}")
    if len(set(versions)) != 1:
        raise SystemExit(f"Version mismatch: VERSION={versions[0]}, pyproject={versions[1]}, uv.lock={versions[2]}")
    print(versions[0])


def bump_kind(messages: str) -> str:
    breaking_header = any(match.group(1) for match in CONVENTIONAL_HEADER.finditer(messages))
    if breaking_header or re.search(r"^BREAKING[ -]CHANGE:", messages, re.MULTILINE | re.IGNORECASE):
        return "major"
    if FEATURE_HEADER.search(messages):
        return "minor"
    return "patch"


def increment(version: str, part: str) -> str:
    match = SEMVER.fullmatch(version)
    if match is None:
        raise ValueError(f"Invalid semantic version: {version}")
    major, minor, patch = (int(value) for value in match.groups())
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown version increment: {part}")


def git_messages(since: str | None = None) -> str:
    revision = f"{since}..HEAD" if since else "HEAD"
    return subprocess.check_output(["git", "log", revision, "--format=%B"], cwd=ROOT, text=True)


def update(new_version: str) -> None:
    if not SEMVER.fullmatch(new_version):
        raise SystemExit("Version must use stable semantic version X.Y.Z")
    pyproject_path = ROOT / "pyproject.toml"
    pyproject = pyproject_path.read_text(encoding="utf-8")
    pyproject = re.sub(r'^version = "[^"]+"$', f'version = "{new_version}"', pyproject, count=1, flags=re.MULTILINE)
    (ROOT / "VERSION").write_text(f"{new_version}\n", encoding="utf-8")
    pyproject_path.write_text(pyproject, encoding="utf-8")
    subprocess.run(["uv", "lock"], cwd=ROOT, check=True)
    check()


def bump(part: str, since: str | None = None) -> None:
    current = declared_versions()
    if len(set(current)) != 1:
        raise SystemExit(f"Version mismatch: VERSION={current[0]}, pyproject={current[1]}, uv.lock={current[2]}")
    selected_part = bump_kind(git_messages(since)) if part == "auto" else part
    update(increment(current[0], selected_part))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", nargs="?", help="new stable semantic version, for example 0.4.0")
    parser.add_argument("--check", action="store_true", help="verify all version declarations match")
    parser.add_argument("--bump", choices=("auto", "major", "minor", "patch"), help="increment the current version")
    parser.add_argument("--since", help="with --bump auto, inspect commits after this Git revision")
    args = parser.parse_args()
    if sum((bool(args.version), args.check, bool(args.bump))) != 1:
        parser.error("provide exactly one of version, --check, or --bump")
    if args.since and args.bump != "auto":
        parser.error("--since requires --bump auto")
    if args.version:
        update(args.version)
    elif args.bump:
        bump(args.bump, args.since)
    else:
        check()


if __name__ == "__main__":
    main()
