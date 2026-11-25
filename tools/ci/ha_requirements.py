"""Print the Python packages Luma Home's Home Assistant dependencies need.

Reads the pinned requirements of HA's voice and frontend components from the
installed Home Assistant, so CI installs versions that match it.
"""
import importlib.resources
import json

ROOTS = ("assist_pipeline", "assist_satellite", "frontend", "http", "websocket_api")


def main() -> None:
    seen, requirements = set(), set()

    def walk(domain: str) -> None:
        if domain in seen:
            return
        seen.add(domain)
        try:
            manifest = json.loads(
                (importlib.resources.files("homeassistant.components") / domain / "manifest.json").read_text()
            )
        except (FileNotFoundError, ModuleNotFoundError):
            return
        requirements.update(manifest.get("requirements", []))
        for dependency in manifest.get("dependencies", []):
            walk(dependency)

    for domain in ROOTS:
        walk(domain)
    print("\n".join(sorted(requirements)))


if __name__ == "__main__":
    main()
