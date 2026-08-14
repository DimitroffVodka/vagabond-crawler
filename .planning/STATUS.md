# Vagabond Crawler — Active Status

Live cross-agent work tracker. Read at session start. Update when starting
or completing work.

Entry format: `- [agent, YYYY-MM-DD HH:MM CT] description`

---

## In Progress

(nothing)

## Awaiting Review

(nothing)

## Blocked

(nothing)

## Recently Completed (last 7 days)

- [hermes-wiki-writer, 2026-08-11] Published the accepted README-led GitHub Wiki as seven separate content pages plus shared sidebar/footer navigation. Strict validation returned 9 pages, 0 errors, and 0 warnings; every content page rendered; all seven live Wiki pages returned HTTP 200; sidebar entries and key section anchors were observed in the rendered GitHub HTML. The Wiki `main` and live `master` refs point to the same fast-forwarded publication commit. The separate Wiki checkout is clean, and unrelated module worktree changes were not included.
- [claude, 2026-05-19 17:00 CT] Bootstrapped dev tooling scaffold (verify.sh, dev/, .planning/, CLAUDE.md and AGENTS.md verification rules) — ported from shadowdark-extras patterns. Local-only (no git repo).

## Notes & Shared Context

### Module facts

- Module ID: `vagabond-crawler`
- System: Vagabond v4.1.0+ (system id `vagabond`)
- Architecture: singleton subsystems registered on `game.vagabondCrawler`
- No build step — raw `.mjs` ES modules, single CSS, Handlebars templates
- Optional dep: `vagabond-character-enhancer` (VCE)
- Not a git repo (local working copy only)

### Vagabond system specifics (TO BE DISCOVERED)

The shadowdark-extras work in May 2026 mapped SD's spell-cast pipeline,
`Roll.safeEval` sandbox, socketlib auth, etc. The Vagabond equivalents
have NOT yet been mapped. When you need a Vagabond fact, discover via
MCP `evaluate` and add it here:

- Vagabond's roll API path (likely something on `globalThis.vagabond`)
- Vagabond actor data model paths (level, abilities, etc.)
- Vagabond's "powered character" / class equivalent (how does the
  system know if an actor can use a power/ability?)
- Whether socketlib is used (probably not)

### Foundry v14 contracts (verified in shadowdark-extras, should apply here)

- `Roll.safeEval` sandbox exposes bare `floor`/`ceil`/etc. — NOT `Math.*`.
- `renderChatMessage` is legacy in v14; use `renderChatMessageHTML`.
- ActiveEffect `change.type` is a string in v14.
- ApplicationV2 supersedes Application.

### Tooling that exists

- `./verify.sh` — block/warn grep wall + `node --check`. Grep patterns
  reference SD bugs; most are universal v14/JS hygiene and apply.
- `dev/probes/README.md` — scaffold for module-specific probes.
- `dev/fixtures/README.md` — scaffold for module-specific test data.
- This file.

---

## How to use this file

**At session start:** read it. Don't ask the user what's going on.

**When starting work:** add an `In Progress` entry.

**When completing:** move to `Recently Completed`. (No commit SHAs —
module isn't in git.)

**When stuck:** move to `Blocked` with the specific obstacle.

**Notes section:** add short-lived shared context. Prune when stale.
