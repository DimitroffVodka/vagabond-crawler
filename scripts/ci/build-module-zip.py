#!/usr/bin/env python3
"""Build module.zip for a Foundry release.

Replaces the inline `python -c "..."` blob that used to live in CLAUDE.md AND
AGENTS.md. Duplicating it in two documents is how it drifted: `scripts/ci/` was
added for the drift canary and neither copy of the recipe knew to skip it, so
v1.18.0 shipped build tooling to every user.

Foundry requires every path inside the archive to sit under a `vagabond-crawler/`
wrapper folder — without it the install silently fails.

Usage:  python3 scripts/ci/build-module-zip.py
"""

import json
import os
import sys
import zipfile

MODULE_ID = "vagabond-crawler"
OUT = "module.zip"

# Shipped to users.
FOLDERS = ["scripts", "styles", "templates", "languages", "icons"]
ROOT_FILES = ["module.json", "CHANGELOG.md", "README.md", "CLAUDE.md"]

# Inside FOLDERS but NOT for users. Paths are repo-relative, "/" separated.
#   scripts/ci — release/CI tooling, including this script. Never runs in Foundry.
# NOTE: scripts/test IS shipped on purpose — it is lazy-loaded and only imports
# when a GM calls game.vagabondCrawler.test.run(), so production sessions stay
# clean. See the Smoke Test Runner section in CLAUDE.md.
EXCLUDE_DIRS = ["scripts/ci"]

# Belt and braces: nothing matching these may ever end up in the archive.
FORBIDDEN = (".git", ".playwright-mcp", ".repowise", ".gemini", ".claude",
             "docs", "dev", ".planning", "node_modules")


def excluded(rel: str) -> bool:
    return any(rel == d or rel.startswith(d + "/") for d in EXCLUDE_DIRS)


def main() -> int:
    if not os.path.isfile("module.json"):
        print("✗ run from the repo root (module.json not found)", file=sys.stderr)
        return 1

    version = json.load(open("module.json"))["version"]

    written, skipped = [], []
    if os.path.exists(OUT):
        os.remove(OUT)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder in FOLDERS:
            for root, _dirs, files in os.walk(folder):
                for f in files:
                    rel = os.path.join(root, f).replace(os.sep, "/")
                    if excluded(rel):
                        skipped.append(rel)
                        continue
                    zf.write(rel, f"{MODULE_ID}/{rel}")
                    written.append(rel)
        for f in ROOT_FILES:
            if os.path.exists(f):
                zf.write(f, f"{MODULE_ID}/{f}")
                written.append(f)

    # Self-verify rather than trusting the loop above.
    problems = []
    with zipfile.ZipFile(OUT) as zf:
        names = zf.namelist()
    outside = [n for n in names if not n.startswith(f"{MODULE_ID}/")]
    if outside:
        problems.append(f"{len(outside)} entr(y/ies) outside the {MODULE_ID}/ wrapper: {outside[:3]}")
    for n in names:
        parts = n.split("/")[1:]           # drop the wrapper
        if parts and parts[0] in FORBIDDEN:
            problems.append(f"forbidden path shipped: {n}")
    for required in (f"{MODULE_ID}/module.json", f"{MODULE_ID}/scripts/{MODULE_ID}.mjs"):
        if required not in names:
            problems.append(f"missing required entry: {required}")
    leaked = [n for n in names if "/scripts/ci/" in n]
    if leaked:
        problems.append(f"build tooling leaked into the archive: {leaked}")

    size_kb = os.path.getsize(OUT) / 1024
    print(f"{OUT}  v{version}  {len(names)} entries  {size_kb:.0f}K")
    if skipped:
        print(f"excluded {len(skipped)} build-tooling file(s): {', '.join(sorted(skipped))}")

    if problems:
        for p in problems:
            print(f"✗ {p}", file=sys.stderr)
        return 1
    print("✓ archive layout verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
