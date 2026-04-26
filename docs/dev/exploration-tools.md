# Exploration Tools — Technical Reference

Module: `vagabond-crawler`
System: Vagabond v4.x (Foundry VTT v13)

---

## Architecture

| File | Role |
|---|---|
| `scripts/encounter-tools.mjs` | Encounter check rolls, encounter roller ApplicationV2 window |
| `scripts/light-tracker.mjs` | Light source management — burn timers, drop/pickup, inventory context menu |
| `scripts/morale-checker.mjs` | Automatic morale checks on NPC death/damage |
| `scripts/rest-breather.mjs` | Rest (full recovery) and Breather (ration heal) dialog |

---

## Encounter Tools

### Encounter Check

`rollEncounterCheck()`:
1. Rolls 1d6
2. Compares against `encounterThreshold` setting (1-in-6 through 5-in-6, configurable via right-click popover on the Enc. Check button)
3. Posts result to chat (GM-only whisper if `encounterRollGMOnly` is enabled)
4. On hit: auto-opens Encounter Roller and rolls the active table

### Encounter Roller (`EncounterRollerApp`)

HandlebarsApplicationMixin(ApplicationV2) window with two tabs:

#### Build Table Tab

- Die type selector (d4, d6, d8, d10, d12) — determines number of slots
- Drag NPC actors onto numbered slots
- Each slot has a name and "appearing" formula (e.g., "2d4")
- "Save as RollTable" creates a Foundry RollTable with:
  - One result per slot, range [i+1, i+1]
  - Actor portrait as image (not token texture, avoiding wildcard paths)
  - Appearing formula stored as `[[/r formula]]` in description
  - Auto-registers as the active encounter table

#### Roll Tables Tab

- Dropdown of all world RollTables, grouped by folder
- Folder exclusion management (hide irrelevant folders)
- Table preview showing all entries with ranges and appearing formulas
- "Set as Active" assigns the table to the crawl bar drop zone
- "Roll Registered" rolls whatever table is currently active

#### Result Panel

After any roll, displays:
- **Monster**: name × count (appearing formula evaluated)
- **Distance**: d6 → Close (1), Near (2-4), Far (5-6)
- **Reaction**: 2d6 → Violent (2-3), Hostile (4-6), Untrusting (7-9), Neutral (10-11), Friendly (12)

Each has a reroll button. Plus:
- **Post to Chat** — sends the result as a formatted chat message
- **Place Tokens** — creates token documents on the canvas at the current viewport center, 5-wide grid layout. Compendium actors are auto-imported to the world.

### Settings

| Setting | Default | Description |
|---|---|---|
| `encounterThreshold` | `1` | N-in-6 chance (1-5) |
| `encounterRollGMOnly` | `true` | Whisper encounter check results to GM |
| `encounterTableUuid` | `""` | Active encounter table UUID |
| `excludedTableFolders` | `"[]"` | JSON array of folder IDs to hide |

---

## Hit Die Configuration

Per-monster Hit Die selector authored in the Monster Creator (Stats section), plus a global size→die map and a bestiary-fallback toggle that lets compendium NPCs without authored flags follow the same rules. A `preCreateToken` hook writes the configured-die HP into the token's actor delta on drop — necessary because the system recomputes `system.health.max` from `HD × 4.5` on every load, so the delta override is what makes a `d12` monster actually have d12-based HP on the canvas.

`HitDieConfigApp` is a HandlebarsApplicationMixin(ApplicationV2) window opened from the Forge & Loot right-click menu OR Module Settings → Vagabond Crawler.

### Settings

| Setting | Default | Description |
|---|---|---|
| `hitDieSizeMap` | `{ medium:"d6", large:"d8", huge:"d10", giant:"d12", colossal:"d14" }` | Default hit die per creature size. Used when an actor's `flags.vagabond-crawler.hitDie` is `"fromSize"`. Edited via `HitDieConfigApp`. |
| `bestiaryHitDieFallback` | `false` | When `true`, compendium NPCs without authored hit-die flags also use the size→die map and roll fresh HP per spawn. |

### Actor Flags (`flags.vagabond-crawler`)

| Flag | Type | Values | Purpose |
|---|---|---|---|
| `hitDie` | string | `"d4"`–`"d14"`, or `"fromSize"` | Per-actor hit die used by `calculateHP` and the spawn override hook. |
| `rollHpOnSpawn` | boolean | `true` / `false` | When `true`, the `preCreateToken` hook rolls fresh HP for unlinked tokens; when `false` with a non-default die, the hook still overrides via delta to apply the configured die's deterministic average. |

### Notes

- Small monsters always use `HP = max(1, HD)` regardless of die.
- `calculateHP(hd, size, die = "d8")` keeps full back-compat — the new `die` argument defaults to `d8`.
- Linked tokens are skipped by the spawn-roll path; they share HP with the world actor.

---

## Light Tracker

### Light Sources

| Key | Matches | Duration | Consumable | Bright/Dim |
|---|---|---|---|---|
| `torch` | "Torch" | 1 hour | Yes (burns up) | 15/30 ft |
| `lantern-hooded` | "Lantern, Hooded" | 1 hour | No (needs refuel) | 15/30 ft |
| `lantern-bullseye` | "Lantern, Bullseye" | 1 hour | No (needs refuel) | 15/30 ft |
| `candle` | "Candle" | 1 hour | Yes (burns up) | 5/10 ft |

Each has custom color, intensity, and animation settings applied to the token's `light` property.

### Item Flags

Light state is stored on individual items:

| Flag | Type | Description |
|---|---|---|
| `lit` | boolean | Currently burning |
| `remainingSecs` | number | Seconds of fuel remaining |
| `sourceKey` | string | Key into LIGHT_SOURCES table |

### Toggle Light

Right-click context menu injected on inventory cards matching a light source name:
- **Light**: Sets `lit=true`, initializes remaining time, applies token light config
- **Extinguish**: Sets `lit=false`, applies dark light config (all zeros)

Uses a MutationObserver to detect inventory card additions and re-bind.

### Burn Time

Two modes:

1. **Manual** (default): Burns only when "Time Passes" is clicked in the Light Tracker window
2. **Real-time** (`realtimeTracking` setting): `setInterval` accumulates seconds, flushes to `game.time.advance()` every 6 seconds. Pauses when Foundry is paused.

`advanceTime(secs)` iterates all player-owned actors and dropped-light actors, deducting from `remainingSecs`.

### Burn Out

When remaining reaches 0:
- **Consumable** (torch, candle): Decrements quantity. If last one, deletes the item. Chat notification.
- **Non-consumable** (lanterns): Chat notification to refuel. Item remains.

### Drop Light on Canvas

Drag a light source item from inventory onto the canvas:
1. Creates a temporary half-size Actor with `vlt-light-actor` flag
2. Places a token at the snap-to-grid position
3. Transfers lit state and remaining time
4. Removes the token's light from the original carrier
5. Deletes the item from inventory

### Pick Up Dropped Light

Token HUD button on dropped-light tokens:
- **GM**: Dialog to choose which player character receives the light
- **Player**: Sends socket request to GM to execute pickup

Creates a new item on the target actor, transfers lit state, deletes the temporary actor/token.

### Light Tracker Window (`LightTrackerApp`)

HandlebarsApplicationMixin(ApplicationV2):
- Lists all currently lit light sources with remaining time and percentage bar
- Includes dropped lights with a "Dropped" label
- "Time Passes" buttons: +/- configurable minutes (updates crawl elapsed time + burns lights)
- Individual "Douse" buttons per light

### Settings

| Setting | Default | Description |
|---|---|---|
| `realtimeTracking` | `false` | Burn light sources in real time |
| `timePassesMinutes` | `10` | Minutes per Time Passes click |

---

## Morale Checker

Automatic morale checks following Vagabond RPG rules.

### Triggers

| Condition | Trigger | Hook |
|---|---|---|
| **Group — First Death** | First NPC combatant defeated | `updateCombatant` (defeated=true) |
| **Group — Half Dead** | ≥ 50% of initial NPCs defeated | `updateCombatant` (defeated=true) |
| **Solo — Half HP** | Solo NPC drops to ≤ 50% max HP | `updateActor` (health.value change) |

Each trigger fires only once per combat (tracked by `_state` flags).

### Check Mechanics

1. Find the alive NPC with the highest `threatLevel` → becomes leader
2. Read leader's `morale` value (default 7)
3. Roll 2d6
4. Pass if roll ≤ morale, fail if roll > morale
5. Post result to chat (GM whisper only)

Result messages:
- **Pass**: "HOLDS — The group stands firm!"
- **Fail**: "FAILS — The group retreats or surrenders!"

### Initialization

State resets on `combatStart` and `createCombat`. A 300ms deferred `createCombatant` handler catches programmatic combat creation where combatants are added after the combat document.

### Manual Check

`MoraleChecker.manualCheck(reason)` — callable from console via `game.vagabondCrawler.morale.manualCheck("reason")`.

---

## Rest & Breather

### Dialog

Shows a table of all player characters with:
- HP, Luck, Mana, Fatigue, Might, Rations

Two action buttons:

#### Rest (Full Recovery)

For each character:
- If HP < max: restore HP to max
- If HP = max and fatigue > 0: remove 1 fatigue
- Restore Luck to max
- Restore Mana to max (if applicable)

Posts individual results to chat.

#### Breather (Ration Heal)

For each character:
- Requires at least 1 ration (items with `isSupply = true`)
- Deducts 1 ration (deletes item if last one)
- Heals HP equal to Might stat (capped at max HP)

Posts individual results to chat.

Characters without rations are skipped with a warning.
