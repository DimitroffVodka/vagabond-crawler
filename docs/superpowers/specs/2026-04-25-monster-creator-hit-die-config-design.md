# Monster Creator — Hit Die Configuration — Design Spec

**Date:** 2026-04-25
**Status:** Design (awaiting implementation plan)
**Module:** `vagabond-crawler`

## Problem

Today every NPC's HP is locked to `floor(HD × 4.5)` for medium+ creatures via [`calculateHP`](../../../scripts/monster-mutator.mjs) (Small monsters use `max(1, HD)`). The 4.5 multiplier is the average of a `d8`, hard-coded across the codebase. GMs running Vagabond want:

1. **Variance** — roll fresh HP per token spawn (`HD × 1d8`, e.g. a HD 6 NPC rolls `6d8`) instead of the deterministic average, so identical mooks do not all share the same HP pool.
2. **Tunability** — pick a different hit die per monster (d4 / d6 / d8 / d10 / d12 / d14, …), since not every creature is a d8 in feel.
3. **Convention by size** — a configurable mapping (Small=d4, Medium=d6, Large=d8, Huge=d10, Giant=d12, Colossal=d14 by default) so authors can leave the die alone in most cases and only override when needed.

## Goals

1. Add per-monster **Hit Die** and **Roll HP on spawn** fields in the Monster Creator.
2. Add a GM-only **Hit Die Configuration** window (table-based, ApplicationV2) that lets the GM edit the size→die map.
3. Roll fresh HP for unlinked NPC tokens at drop time when the monster opts in.
4. Stay backward-compatible: every existing actor and every existing call to `calculateHP` behaves identically with no migration.

## Non-Goals

- Any change to PC HP. Characters are out of scope.
- Linked-token HP rolling (linked tokens share HP with the world actor and would mutate world state on every drop). Linked tokens always use the deterministic average.
- A re-roll button on the token HUD or actor sheet. Could come later, not part of this spec.
- Changing the Small rule. Small stays `max(1, HD)` — see "Open decisions" if this turns out to be wrong.

## Data Model

### New world-scoped settings

| Key | Type | Default | Purpose |
|---|---|---|---|
| `hitDieSizeMap` | object | `{ medium: "d6", large: "d8", huge: "d10", giant: "d12", colossal: "d14" }` (Small omitted — see below) | Size → die map. Edited in the new config window. |
| `bestiaryHitDieFallback` | boolean | `false` | When ON, bestiary/compendium NPCs that lack the authored flags below use the size-map + roll-on-spawn rules anyway. When OFF (default), legacy compendium NPCs behave exactly as today. |

### New per-actor flags

Stored on the world actor under `flags.vagabond-crawler`:

| Flag | Type | Values | Purpose |
|---|---|---|---|
| `hitDie` | string | `"d4"` … `"d14"`, or `"fromSize"` | The die used for HP. `"fromSize"` resolves at compute time via the size map, so editing the map updates everyone using that mode automatically. |
| `rollHpOnSpawn` | boolean | `true` / `false` | When `true`, HP is rolled fresh per unlinked token spawn. When `false` (default), HP is the deterministic average. |

### Updated `calculateHP`

```js
calculateHP(hd, size, die = "d8")
  if (size === "small") return max(1, hd)            // unchanged
  return floor(hd * dieAvg(die))                     // d6 → 3.5, d10 → 5.5, d14 → 7.5
```

Default `die = "d8"` keeps every existing 2-arg call site behaviorally identical (back-compat). New `dieAvg(die)` helper exported alongside.

## UX

### Monster Creator — Basic Info form

Two new fields next to the existing HD field, in a "Hit Points" group:

- **Hit Die** dropdown — d4, d6, d8, d10, d12, d14, plus a "From Size" option that uses the size map. **Default = "From Size"** for new monsters.
- **Roll on spawn** checkbox — default OFF.
- Live **preview line**: `22 HP (5d8 avg)`, with `[rolled at spawn]` appended when the checkbox is on.
- Small **"⚙ Configure size→die map"** link below, opens the config window.

### `HitDieConfigApp` — new ApplicationV2 window

Same shape as `LightSourcesConfigApp` / `AnimationFxConfigApp`. Single tab, two sections:

**Section A — Size → Die Map**

| SIZE | DIE | AVG |
|---|---|---|
| Small | (special: HP = HD, min 1) | — |
| Medium | `[ d6 ▾ ]` | 3.5 |
| Large | `[ d8 ▾ ]` | 4.5 |
| Huge | `[ d10 ▾ ]` | 5.5 |
| Giant | `[ d12 ▾ ]` | 6.5 |
| Colossal | `[ d14 ▾ ]` | 7.5 |

- Rows fixed (one per size). No add/delete.
- Small row is read-only — the Small rule is hard-coded in `calculateHP`.
- AVG column is read-only and recomputes live as the dropdown changes.
- Die dropdown options: d4, d6, d8, d10, d12, d14, d16, d20.

**Section B — Bestiary Fallback**

A single labelled checkbox bound to the `bestiaryHitDieFallback` setting, with explanatory helper text.

**Footer**: `[Reset to Defaults]` `[Save]` `[Save & Close]` `[Cancel]` — matches the existing Homebrew Configuration pattern.

**Discoverability**: registered both as `game.settings.registerMenu` (so it appears in Foundry's *Configure Settings → Module Settings*) AND as a tool entry in the Crawl Bar's Forge & Loot tool picker.

## Behavior

### Roll-on-spawn flow

`Hooks.on("preCreateToken", ...)`, GM-only:

1. Resolve actor; bail if it is a `character`.
2. Resolve effective config:
   - `rollOnSpawn` = actor flag, OR (`bestiaryHitDieFallback` setting && actor has no flag).
   - `die` = actor flag's die (`"fromSize"` → look up size-map), default `"d8"`.
3. If `!rollOnSpawn` → bail.
4. If `tokenDoc.actorLink === true` (linked) → bail.
5. If `size === "small"` → skip the roll, set `HP = max(1, HD)`. Otherwise roll `${hd}${die}`.
6. Write the rolled value to `data.delta.system.health.value` and `data.delta.system.health.max` via `tokenDoc.updateSource`.
7. Whisper a short roll summary to the GM: e.g. `Goblin spawned with 12 HP (4d6: 3,4,2,3)`.

### Mutations integration

Mutations bake into the saved actor's HD at author time in the Creator. The spawn hook reads post-mutation HD. No special-casing.

### Encounter Roller display

The two `calculateHP` callsites in [encounter-tools.mjs:883](../../../scripts/encounter-tools.mjs:883) and [encounter-tools.mjs:919](../../../scripts/encounter-tools.mjs:919) gain the new `die` argument. For monsters with the flags, show the configured die's average; for legacy monsters, fall back to d8 (= today's behavior). Append a `(rolled)` suffix to the HP cell when `rollHpOnSpawn` is set.

## File Map

| File | Change |
|---|---|
| `scripts/monster-mutator.mjs` | `calculateHP` gains optional `die` param; export `dieAvg(die)` helper. |
| `scripts/monster-creator/monster-creator-app.mjs` | Add `hitDie` + `rollHpOnSpawn` fields, preview wiring, "Configure" link. Persist flags on save. Read flags on load. |
| `templates/monster-creator.hbs` | New form fields. |
| `scripts/hit-die-config.mjs` | **NEW** — `HitDieConfigApp` ApplicationV2 + settings registration. |
| `templates/hit-die-config.hbs` | **NEW** — config window template. |
| `scripts/vagabond-crawler.mjs` | Settings registration, `preCreateToken` hook, expose `game.vagabondCrawler.hitDieConfig`. |
| `scripts/crawl-bar.mjs` | Add tool entry to the Forge & Loot picker. |
| `scripts/encounter-tools.mjs` | Pass `die` to the two `calculateHP` calls; optional `(rolled)` suffix. |
| `styles/vagabond-crawler.css` | New `vcb-hitdie-*` rules; reuse existing tokens. |
| `languages/en.json` | i18n strings for the new UI. |
| `docs/exploration.md` (user) + `docs/dev/*.md` (contributor) | Sync both tracks per CLAUDE.md. |
| `CHANGELOG.md` | Entry. |

## Testing

- Save new monster with `Roll on spawn = ON`, `Hit Die = "From Size"`, drop unlinked → token gets fresh rolled HP, GM sees roll whisper.
- Same monster set as **linked** prototype → drop → no roll, deterministic max HP.
- Existing world actor (no flags) with `bestiaryHitDieFallback = OFF` → drop → legacy `4.5` behavior, byte-for-byte.
- Same with the setting ON → roll happens against size-map die.
- Encounter Roller table preview matches the chosen die's average for flagged actors and the legacy 4.5 for unflagged actors.
- Config window: change Medium die → `From Size` monsters' previews update live → spawn rolls the new die.
- Mutations: `+2 HD` mutation → spawn rolls the bumped HD count.
- Small monster with `Roll on spawn = ON` → no roll, HP = `max(1, HD)`.

## Open decisions

- d14 is non-standard but Foundry rolls arbitrary dice fine — using literal `1d14` for Colossal default unless flagged.
- Small special-case is preserved as today. If GMs later want Small to roll too, that's a follow-up.

## Out of Scope (Follow-ups)

- Re-roll HP button on token HUD / actor sheet.
- Migration tool to set flags in bulk on existing world actors.
- Per-Monster Creator JSON import/export of the size-die map.
