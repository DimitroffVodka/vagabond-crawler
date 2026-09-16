# Vagabond Crawler — Active Status

Live cross-agent work tracker. Read at session start. Update when starting
or completing work.

Entry format: `- [agent, YYYY-MM-DD HH:MM CT] description`

---

## In Progress

(nothing)

## Awaiting Review

- [claude, 2026-09-16 12:35 CT] Design calls surfaced by the 5.38 drift audit (not changed):
  1. Relic powers on KNOWN_DEAD_AE_PATHS (26 keys: autoFailSaveVs, movement.*, senses.*, …) apply AEs nothing reads — implement consumers or strip them.
  2. Fabled Vicious crit dice read actor.system.hitDie (no such field) → always 2d6.
  3. VCE Monk Martial Arts Cleave still uses the pre-5.38 half-damage split (and its damage-total regex no longer matches, so it's inert).
  4. VCE Imbue replaces the system's new native Imbue (imbue-helper, weapon.system.imbuedSpell) — decide which owns it.

## Blocked

(nothing)

## Recently Completed (last 7 days)

- [claude, 2026-09-16] Vagabond 5.38.1 drift audit + fixes, Crawler and VCE, each verified live. Crawler: rollAttack/rollDamage wraps forward all args; strip weapon attacks (favor/hinder, roll-damage setting, targets/skill, Cleave), strip spell cost via SpellCastDialog.calculateCosts, Place Template via Regions; relic Roll Damage UUID, Manasteal mana.current, Cold Iron metal key, rest maxLuck, delivery label i18n, weapon damage types, Bane vs PCs, loot prices; flanking defers to native `flanked`; Pack Instincts on token actor; FX hit/miss + NPC ⚡ placement; v14 deprecations (AE type strings, displace). Crawler suite 107/107. VCE fixes on its v14 branch (see its log).
- [claude, 2026-09-16] Inventory slots on vagabond 5.38.1: system now counts stacks natively, Crawler was double-counting; Weightless items excluded from the zero-slot pool; converted VCE Materials cost 1 slot per 1g (ceil). Live-tested: inventory-slots suite 15/15.

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
