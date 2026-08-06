from __future__ import annotations

import re
import tomllib
from pathlib import Path
from typing import cast

ROOT = Path(__file__).resolve().parents[1]
EXACT_PIN = re.compile(r"^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==([^;\s]+)$")
LOCK_PIN = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def direct_pins(requirements: list[str]) -> dict[str, str]:
    pins: dict[str, str] = {}
    for requirement in requirements:
        match = EXACT_PIN.fullmatch(requirement)
        if not match:
            raise SystemExit(f"pyproject dependency is not exactly pinned: {requirement}")
        pins[normalize(match.group(1))] = match.group(2)
    return pins


def locked_pins(path: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in path.read_text(encoding="utf8").splitlines():
        match = LOCK_PIN.match(line)
        if match:
            pins[normalize(match.group(1))] = match.group(2)
    return pins


def string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise SystemExit(f"{label} must be a list of dependency strings")
    return cast(list[str], value)


def verify(path: Path, expected: dict[str, str]) -> None:
    actual = locked_pins(path)
    mismatches = [
        f"{name}: expected {version}, locked {actual.get(name, 'missing')}"
        for name, version in expected.items()
        if actual.get(name) != version
    ]
    if mismatches:
        raise SystemExit(f"{path.name} is stale:\n" + "\n".join(mismatches))


def main() -> None:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf8"))
    project = config.get("project")
    if not isinstance(project, dict):
        raise SystemExit("pyproject.toml is missing [project]")
    production = direct_pins(string_list(project.get("dependencies"), "project.dependencies"))

    optional = project.get("optional-dependencies")
    if not isinstance(optional, dict):
        raise SystemExit("pyproject.toml is missing [project.optional-dependencies]")
    development = {
        **production,
        **direct_pins(string_list(optional.get("dev"), "project.optional-dependencies.dev")),
    }

    verify(ROOT / "requirements.lock", production)
    verify(ROOT / "requirements-dev.lock", development)
    print("Python dependency locks match every direct pyproject pin.")


if __name__ == "__main__":
    main()
