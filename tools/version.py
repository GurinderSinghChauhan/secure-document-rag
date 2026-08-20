"""Check or update the repository's semantic version declarations."""

import argparse
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", nargs="?", help="new stable semantic version, for example 0.4.0")
    parser.add_argument("--check", action="store_true", help="verify all version declarations match")
    args = parser.parse_args()
    if bool(args.version) == bool(args.check):
        parser.error("provide either a version or --check")
    update(args.version) if args.version else check()


if __name__ == "__main__":
    main()
