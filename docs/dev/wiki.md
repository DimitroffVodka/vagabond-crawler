# Wiki

The GitHub Wiki is a **second, separate repository**. Clicking the "Wiki" tab on
GitHub reads from `vagabond-crawler.wiki.git`, not from this repo. Files under
`docs/wiki/` in this repo are the tracked source; publishing means copying them
into a clone of that other repo and pushing.

```
github.com/DimitroffVodka/vagabond-crawler          this repo — code + docs/wiki/
github.com/DimitroffVodka/vagabond-crawler.wiki.git the wiki — what /wiki serves
```

## Two guide tracks, both hand-written

| Track | Audience | Depth |
|---|---|---|
| `docs/*.md` | GMs who want the full picture | Complete — settings tables, edge cases, gotchas |
| `docs/wiki/*.md` | GMs skimming for one answer mid-session | Condensed, task-phrased headings |

They cover the same six topics in **deliberately different prose** — roughly 8%
sentence overlap. The wiki's brevity is intentional, so neither side is generated
from the other. Both are edited by hand.

`docs/dev/*.md` (this file's neighbours) is a third track for contributors, and
is not mirrored to the wiki.

## Page pairs

| Guide page | Wiki page |
|---|---|
| `README.md` | `Home.md` |
| `docs/crawl-loop.md` | `Crawl-Loop.md` |
| `docs/combat.md` | `NPC-Combat-Automation.md` |
| `docs/exploration.md` | `Exploration.md` |
| `docs/crafting-loot.md` | `Crafting-and-Loot.md` |
| `docs/session-tracking.md` | `Session-Tracking.md` |
| `docs/player-quickref.md` | `Player-Quick-Reference.md` |

`_Sidebar.md` and `_Footer.md` are wiki navigation and have no guide counterpart.

## Drift check

Because both sides are hand-maintained, they drift. `scripts/check-wiki-drift.mjs`
catches it, and `.github/workflows/wiki-drift.yml` runs it on every push to `main`
and every PR touching `README.md`, `docs/`, or the script itself.

```sh
node scripts/check-wiki-drift.mjs                # HEAD~1...HEAD
node scripts/check-wiki-drift.mjs --base main    # whole branch
node scripts/check-wiki-drift.mjs --staged       # before committing
```

What it enforces:

- **Guide changed, wiki page didn't** → fails. A behaviour change almost always
  needs both sides updated.
- **Wiki page changed, guide didn't** → passes with a note. Tightening the
  condensation rarely implies a guide change.
- **A `docs/*.md` or `docs/wiki/*.md` file missing from the pair table** → fails,
  so a new page can't slip in unchecked. Add it to `PAIRS` in the script.

Escape hatch: put `[wiki-ok]` in a commit message in the range when a one-sided
edit is genuinely correct — a typo fix, or a detail the skim layer omits on
purpose. The check reports what it waived rather than staying silent.

## Link conventions differ

The two tracks cannot share link syntax, so don't copy links across.

- `docs/` uses relative paths and anchors: `[Light Tracker](exploration.md#light-tracker)`
- `docs/wiki/` uses bare wiki page names: `[Light Tracker](Exploration#light-tracker)`,
  and absolute `blob/main` URLs to reach anything outside the wiki, such as
  `docs/dev/` or `scripts/relic-powers.mjs`.

## Publishing

`scripts/publish-wiki.mjs` clones the wiki repo to a temp directory, copies
`docs/wiki/*.md` over, commits, and pushes. It uses your existing git
credentials for github.com.

```sh
node scripts/publish-wiki.mjs                 # dry run — print the plan, change nothing
node scripts/publish-wiki.mjs --push          # publish
node scripts/publish-wiki.mjs --push -m "..." # custom commit message
```

**Dry run is the default**, because a push updates a public page. Run it first
and read the plan: each page is listed as `add`, `update`, `same`, or `orphan`.
Re-running after a successful publish reports "already matches" and pushes
nothing, so it is safe to run repeatedly.

### Orphans

A page on the wiki with no counterpart in `docs/wiki/` is reported as `orphan`
and **left alone**. That usually means someone wrote it in GitHub's web editor,
which commits straight to the wiki repo and never touches this one. Copy it into
`docs/wiki/` to bring it under version control, or delete it deliberately:

```sh
node scripts/publish-wiki.mjs --push --prune   # deletes orphans
```

Never reach for `--prune` to "clean up" without reading the orphan list first —
it is the one flag here that destroys content.

### Direction

Sync is **one-way**: `docs/wiki/` → wiki. Nothing pulls web-editor changes back,
so edits made on github.com are silently overwritten the next time someone
publishes. Treat this repo as the source and the wiki as a rendering of it.

### The clone location

The script uses a temp directory and deletes it afterwards (kept on failure, or
with `--keep`, so a failed push can be retried). If you clone the wiki by hand
instead, keep it **outside** this repo — nesting it under `docs/wiki/` would turn
the directory into a stray gitlink.
