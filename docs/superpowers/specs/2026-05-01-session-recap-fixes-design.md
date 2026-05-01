# Session Recap Fixes — Design Spec

**Date:** 2026-05-01
**Status:** Draft
**Scope:** Three production bugs surfaced after the Apr 30 session recap landed empty/wrong:
1. XP "breakdown not recorded" for every award (regression)
2. Last combat dropped from recap (timing race)
3. Sales and purchases not tracked at all (missing categories)

**Out of scope:** Companion/familiar attribution. Tracked separately — fixing it touches the roll-stats hook and `_unwrapToPC` in different ways than the bugs in this spec.

---

## Bug 1 — XP Breakdown Lost

### Symptom

Every player's XP entry in the recap reads `_(breakdown not recorded)_` even though the player answered XP questions in the level-up dialog. Total XP is correct, but the per-question detail is missing.

### Root Cause

In [`scripts/xp-counter-patch.mjs`](../../scripts/xp-counter-patch.mjs), the `awardXP` action handler resets `this.questions` to an array of zeros on line 93, **then** snapshots `this.questions` on line 102. The snapshot reads zeros, the `.filter(q => q.count > 0)` returns `[]`, and `SessionRecap.logXp` receives an empty `questions` array.

Order of operations in the buggy code:
```js
await this.actor.update({ "system.attributes.xp": newXP });
this.xpAwarded = true;
this.questions = new Array(...).fill(0);   // ← reset here
ui.notifications.info(...);
const questionSnapshot = ... map(... count: this.questions[i] || 0 )  // ← reads zeros
                            .filter(q => q.count > 0);                // ← always []
SessionRecap.logXp({ ..., questions: questionSnapshot });
```

### Fix

Snapshot `this.questions` into a local before any mutation. Build `questionSnapshot` from the local. Reset `this.questions` afterward. No new APIs.

```js
const xpQuestionsCfg = CONFIG.VAGABOND?.homebrew?.leveling?.xpQuestions ?? [];
const questionSnapshot = xpQuestionsCfg
  .map((q, i) => ({ label: q.question, xp: q.xp || 1, count: this.questions[i] || 0 }))
  .filter(q => q.count > 0);

await this.actor.update({ "system.attributes.xp": newXP });
this.xpAwarded = true;
this.questions = new Array(xpQuestions.length || 5).fill(0);
ui.notifications.info(...);
SessionRecap.logXp({ ..., questions: questionSnapshot, totalXp: xpGained });
```

### Verification

Award XP to a test character with 2-3 questions answered. Open the recap; XP section must show the per-question breakdown lines (e.g. `- Defeated a Boss — ×2 = 2 XP`) instead of the `_breakdown not recorded_` fallback.

---

## Bug 2 — Last Combat Dropped

### Symptom

The Apr 30 session had three combats; the recap only logged two. Combat 3 (Orichalcum Golem) ran 8:29-8:44 PM, sales started at 8:50 PM, but the combat never appeared in the recap.

### Root Cause

`SessionRecap.logCombat` is only called from `Hooks.on("deleteCombat")` in [`scripts/session-recap.mjs:273`](../../scripts/session-recap.mjs:273). Two failure modes:

- **(a) Late delete:** GM ends the session via the Crawl Bar, which deletes the active combat. The session-end flow runs `clear()` → `sessionState = "inactive"`. The `deleteCombat` handler then fires, hits its guard `if (sessionState !== "active") return`, and bails.
- **(b) Never deleted:** GM ends the session with the combat still open in the tracker. `deleteCombat` never fires. `_activeCombats` is discarded along with the rest of transient state.

### Fix

Three changes:

1. **Snapshot enemy roster on `combatStart`/`updateCombat`.** Today `_activeCombats[combatId]` only stores `{ startTime, participants }`. Extend it to also keep `{ rounds, enemies, lastSnapshotAt }`. On `combatStart` capture the initial roster; on `updateCombat` (when round bumps or `combat.combatant` changes) refresh `rounds` and re-walk `combat.combatants` to update enemy HP/defeated state.

2. **Flush on session end/pause.** Add a private `_flushActiveCombats()` method that walks `_activeCombats` and calls `logCombat` for each, using the live combat doc if it still exists, otherwise the snapshot. Call it from `endAndSave()` and `pauseSession()` before any state mutation. After flushing, clear `_activeCombats`.

3. **Loosen the deleteCombat guard.** Change the early-return: if `_activeCombats.has(combat.id)` then proceed regardless of `sessionState`. This catches the late-delete case where the session has already gone inactive but we still know the combat was a session combat. (If neither active nor known to us, still bail.)

### Open question — resolved

User confirmed: only flush on End & Save / Pause. Continuing a paused session that left a stale `_activeCombats` is rare enough that we can let it ride.

### Verification

Test scenarios via Foundry MCP:
- **(a) Normal flow:** Start session → start combat → end combat → end session. Combat appears in recap. (Regression check.)
- **(b) Late delete:** Start session → start combat → end session (which auto-deletes combat). Combat appears in recap.
- **(c) Never deleted:** Start session → start combat → leave it open → end session. Combat appears in recap with last-seen state.

---

## Bug 3 — Sales and Purchases Not Tracked

### Symptom

The Apr 30 session had ~3,189g of player sales and ~159g of purchases at Skrit's Curios. None of it appears in the recap. Players have no record of what they bought or sold.

### Root Cause

[`scripts/merchant-shop.mjs`](../../scripts/merchant-shop.mjs) posts `Item Purchased` and `Item Sold` chat messages but never calls `SessionRecap`. The recap data model has no `sales` or `purchases` arrays.

### Fix

Mirror the existing loot pattern.

**Data model additions** (in `DEFAULT_DATA` and `formatForDiscordFromData`):
```js
sales: [
  { player, item, qty, price, ratio, timestamp, time }
],
purchases: [
  { player, item, qty, price, timestamp, time }
],
```

`price` stored as the raw cost object the merchant uses (currency parts), not a pre-formatted string, so the recap can sum and re-format.

**API additions** on `SessionRecap`:
- `async logSale({ player, item, qty, price, ratio })`
- `async logPurchase({ player, item, qty, price })`

Both follow the same shape as `logLoot` — call `_ensureStart`, push the entry with timestamp + time, `_save`. Guarded on `sessionState === "active"` (consistent with other loggers, no flush needed since these are atomic events).

**Call sites** in `merchant-shop.mjs`:
- `_handleBuy` — after the purchase chat message, before restocking
- `_handleSell` — after the sell chat message, before restocking
- Any other transaction paths (trade-in, etc.) — audit the file for additional `ChatMessage.create` sites with `Item Purchased` / `Item Sold` headers

**Discord render** — two new sections after Loot in `formatForDiscordFromData`:

```
## Sales
### <Player>
- <item> ×<qty> — <price> (<ratio>%)
**Player total:** <sum>
...
**Party total:** <grand sum>

## Purchases
### <Player>
- <item> ×<qty> — <price>
**Player total:** <sum>
...
**Party total:** <grand sum>
```

`ratio` only printed when ≠ 100. Currency totals use the same gold/silver/copper formatter as the existing loot currency code (extract to a shared helper if not already one — `formatCurrency(copperTotal)` returning `"500g 40s"`).

**Migration:** `getData()` does `?? deepClone(DEFAULT_DATA)` for the whole object, so adding `sales: []`/`purchases: []` to `DEFAULT_DATA` covers fresh worlds. Existing worlds with a saved `sessionRecap` need a migration: in `getData`, if the loaded object lacks `sales`/`purchases`, add them as empty arrays before returning. Same for `endAndSave`'s snapshot — include the new arrays so historical sessions render the new sections (empty for past sessions, populated for future ones).

### Verification

- Buy 2 items at Skrit's. Open recap. Purchases section lists both with correct prices and player attribution.
- Sell 2 items, one at non-100% ratio. Sales section shows both with the ratio noted on the discounted one.
- Player totals and party totals sum correctly across mixed currencies (gold + silver + copper).

---

## Cross-Cutting

### Files touched

- `scripts/xp-counter-patch.mjs` — Bug 1
- `scripts/session-recap.mjs` — Bugs 2 + 3 (data model, loggers, formatter, flush)
- `scripts/merchant-shop.mjs` — Bug 3 (call sites)

### No new dependencies

All three fixes work within the existing module surface. No `module.json` changes.

### Documentation updates (per CLAUDE.md split)

- `docs/dev/session-recap.md` — update data shape + the new flush behavior + new logger APIs
- `docs/session-tracking/*` — note the new Sales/Purchases sections in the user-facing recap docs

### Test plan via Foundry MCP

For each bug, drive the live game to reproduce the original failure, apply the fix, verify the recap reflects it. For combat 2 specifically, test all three scenarios (a/b/c). All tests run on the local dev Foundry, not the user's prod server.
