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

# Shipped to users. CLAUDE.md is deliberately absent — it is 30KB of internal
# agent instructions, not user documentation.
FOLDERS = ["scripts", "styles", "templates", "languages", "icons"]
ROOT_FILES = ["module.json", "CHANGELOG.md", "README.md"]

# Inside FOLDERS but NOT for users. Paths are repo-relative, "/" separated.
#   scripts/ci — release/CI tooling, including this script. Never runs in Foundry.
# NOTE: scripts/test IS shipped on purpose — it is lazy-loaded and only imports
# when a GM calls game.vagabondCrawler.test.run(), so production sessions stay
# clean. See the Smoke Test Runner section in CLAUDE.md.
EXCLUDE_DIRS = ["scripts/ci"]

# Individual dev-only files that sit beside shipped code, so a directory rule
# cannot catch them. Keep this list rather than relocating the files, because
# their paths appear in CLAUDE.md, AGENTS.md and CI workflows.
#   scripts/audit/status-vocabulary.mjs is NOT here — monster-creator-app.mjs
#   imports it at runtime, so excluding it breaks the Monster Creator.
EXCLUDE_FILES = [
    "scripts/check-wiki-drift.mjs",
    "scripts/publish-wiki.mjs",
    "scripts/audit/analyze.mjs",
    "scripts/audit/extract.mjs",
    "scripts/audit/markdown.mjs",
    "scripts/audit/migrate-riders.mjs",
]

# Belt and braces: nothing matching these may ever end up in the archive, at any
# depth. Checked per path segment — an earlier version tested only the segment
# directly under the wrapper, which is always one of FOLDERS, so the guard never
# fired for the nested case it existed to catch.
FORBIDDEN = (".git", ".playwright-mcp", ".repowise", ".gemini", ".claude",
             "docs", "dev", ".planning", "node_modules")


def excluded(rel: str) -> bool:
    """True when a repo-relative path must not ship."""
    if rel in EXCLUDE_FILES:
        return True
    return any(rel == d or rel.startswith(d + "/") for d in EXCLUDE_DIRS)


def main() -> int:
    if not os.path.isfile("module.json"):
        print("✗ run from the repo root (module.json not found)", file=sys.stderr)
        return 1

    with open("module.json", encoding="utf-8") as fh:
        version = json.load(fh)["version"]

    written, skipped, links = [], [], []
    if os.path.exists(OUT):
        os.remove(OUT)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder in FOLDERS:
            for root, dirs, files in os.walk(folder):
                dirs.sort()                       # deterministic traversal
                for f in sorted(files):
                    rel = os.path.join(root, f).replace(os.sep, "/")
                    if excluded(rel):
                        skipped.append(rel)
                        continue
                    # Symlinks are dereferenced by zf.write, which would ship a
                    # copy of the target under a name the exclusion rules never
                    # see — and a dangling link crashes the build outright.
                    if os.path.islink(rel):
                        links.append(rel)
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
        parts = n.split("/")[1:]                  # drop the wrapper
        if any(p in FORBIDDEN for p in parts):
            problems.append(f"forbidden path shipped: {n}")

    for required in (f"{MODULE_ID}/module.json", f"{MODULE_ID}/scripts/{MODULE_ID}.mjs"):
        if required not in names:
            problems.append(f"missing required entry: {required}")

    # Derived from the exclusion rules, so adding an entry above automatically
    # enforces it here. Hardcoding "/scripts/ci/" is what let the wiki CLIs and
    # the audit dev scripts through.
    leaked = [n for n in names if excluded(n[len(MODULE_ID) + 1:])]
    if leaked:
        problems.append(f"excluded path leaked into the archive: {leaked}")

    size_kb = os.path.getsize(OUT) / 1024
    print(f"{OUT}  v{version}  {len(names)} entries  {size_kb:.0f}K")
    if skipped:
        print(f"excluded {len(skipped)} dev-only file(s): {', '.join(sorted(skipped))}")
    if links:
        print(f"skipped {len(links)} symlink(s): {', '.join(sorted(links))}")

    if problems:
        for p in problems:
            print(f"✗ {p}", file=sys.stderr)
        return 1
    print("✓ archive layout verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
