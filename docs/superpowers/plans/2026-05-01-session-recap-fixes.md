# Session Recap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three production bugs in Session Recap — XP breakdown lost, last combat dropped, and missing sales/purchases tracking.

**Architecture:** Three independent fixes inside the existing Session Recap singleton. No new files for fixes 1 and 2 (edit-in-place); fix 3 adds two new logger methods, two new data arrays, and two new render sections. All call sites for sales/purchases route through the existing `MerchantShop.logTransaction()` chokepoint, so we only need one new integration point in `merchant-shop.mjs`.

**Tech Stack:** Foundry VTT v13 ESM modules, ApplicationV2, Foundry Hooks API, world-scoped `game.settings`. No build step. Tests run live in Foundry via the foundry-mcp-bridge MCP tools (per `CLAUDE.md`).

**Spec:** `docs/superpowers/specs/2026-05-01-session-recap-fixes-design.md`

---

## File Structure

| File | Role | Change Type |
|---|---|---|
| `scripts/xp-counter-patch.mjs` | XP award handler — reset bug | Edit (4 lines) |
| `scripts/session-recap.mjs` | Recap singleton — combat snapshot/flush + sales/purchases loggers + Discord render | Edit (multiple sections) |
| `scripts/merchant-shop.mjs` | Single hook in `logTransaction()` to fan out to recap | Edit (1 method) |
| `docs/dev/session-recap.md` | Architectural reference — new APIs and flush behavior | Edit |
| `docs/session-tracking/recap.md` | User-facing reference — new Sales/Purchases sections | Edit (path TBD — verify in step 0) |
| `CHANGELOG.md` | Version entry | Edit |

---

## Task 0: Confirm doc paths and capture baseline

**Goal:** Resolve the user-facing recap doc path (the spec says "session-tracking/*" but the exact file isn't fixed) and snapshot current behavior so we can verify each fix didn't regress unrelated paths.

**Files:**
- Read: `docs/session-tracking/` (or wherever the user-facing recap doc lives)
- Read: `docs/dev/session-recap.md`

**Acceptance Criteria:**
- [ ] Identified the exact user-facing recap doc file path
- [ ] Recorded current `DEFAULT_DATA` shape from `session-recap.mjs:14-22` for reference

**Verify:** Both file paths exist on disk.

**Steps:**

- [ ] **Step 1: List user docs**

```bash
ls docs/session-tracking/ 2>/dev/null || ls docs/ | grep -i recap
```

If `docs/session-tracking/` doesn't exist, the user-facing recap doc may live under `docs/crawl-loop/` or `docs/session-tracking/recap.md`. Use whatever exists. If nothing exists, note that and skip the user-facing doc edits in Task 8 (only update `docs/dev/session-recap.md`).

- [ ] **Step 2: Confirm recap.mjs DEFAULT_DATA**

Read `scripts/session-recap.mjs:14-22`. Note the current shape — Tasks 5 and 6 will extend it.

- [ ] **Step 3: No commit**

This is a read-only orientation task.

---

## Task 1: Fix XP breakdown snapshot order (Bug 1)

**Goal:** XP entries logged to the recap include the per-question breakdown instead of `_(breakdown not recorded)_`.

**Files:**
- Modify: `scripts/xp-counter-patch.mjs:76-113` (the `awardXP` action handler)

**Acceptance Criteria:**
- [ ] `questionSnapshot` is built from a copy of `this.questions` taken **before** the reset
- [ ] No other behavior in `awardXP` changes (XP is still awarded, dialog still resets, notification still fires, render still happens)

**Verify (live Foundry):**
1. In Foundry MCP, open the level-up dialog on a test PC
2. Increment 2 questions (e.g. one to count=1, another to count=2)
3. Click Award XP
4. Open Session Recap, confirm the player's XP entry shows the per-question lines (e.g. `- Defeated a Boss — ×2 = 2 XP`)

**Steps:**

- [ ] **Step 1: Read current code**

Read `scripts/xp-counter-patch.mjs:76-113`.

- [ ] **Step 2: Edit `awardXP` to snapshot before reset**

Replace the body of `awardXP` (the `cls.DEFAULT_OPTIONS.actions.awardXP = async function ...` from line 76 onward) so the snapshot is built first:

```js
cls.DEFAULT_OPTIONS.actions.awardXP = async function (_event, _target) {
  _ensureNumeric(this);
  const xpQuestions = CONFIG.VAGABOND?.homebrew?.leveling?.xpQuestions ?? [];
  const xpGained = xpQuestions.reduce(
    (sum, q, i) => sum + (this.questions[i] || 0) * (q.xp || 1), 0,
  );

  if (xpGained === 0) {
    ui.notifications.warn("No XP to award — answer at least one question.");
    return;
  }

  // Snapshot BEFORE reset — fixes recap "breakdown not recorded" regression
  const questionSnapshot = xpQuestions
    .map((q, i) => ({ label: q.question, xp: q.xp || 1, count: this.questions[i] || 0 }))
    .filter(q => q.count > 0);

  const currentXP = this.actor.system.attributes.xp || 0;
  const newXP = currentXP + xpGained;

  await this.actor.update({ "system.attributes.xp": newXP });
  this.xpAwarded = true;
  this.questions = new Array(xpQuestions.length || 5).fill(0);

  ui.notifications.info(`Awarded ${xpGained} XP to ${this.actor.name}. Total: ${newXP}`);

  SessionRecap.logXp({
    player: this.actor.name,
    actorId: this.actor.id,
    questions: questionSnapshot,
    totalXp: xpGained,
  });

  this.render();
};
```

- [ ] **Step 3: Live test via Foundry MCP**

```js
// 1. Confirm session is active
game.settings.get("vagabond-crawler", "sessionRecap")?.sessionState
// → expect "active"; if not, start one via the crawl bar test path

// 2. Open level-up dialog on a test PC, increment 2 questions, click Award XP
// (manual — drive via the live dialog)

// 3. Inspect recap data
const data = game.settings.get("vagabond-crawler", "sessionRecap");
const lastXp = data.xp[data.xp.length - 1];
return { player: lastXp.player, totalXp: lastXp.totalXp, questions: lastXp.questions };
// Expect: questions array has 2 entries with non-zero count
```

- [ ] **Step 4: Commit**

```bash
git add scripts/xp-counter-patch.mjs
git commit -m "fix(recap): snapshot XP questions before resetting in awardXP

The awardXP handler reset this.questions to zeros before building the
recap snapshot, so every XP entry showed '(breakdown not recorded)'.
Snapshot the question counts first, then perform the reset."
```

---

## Task 2: Snapshot enemy roster & rounds during active combats (Bug 2 prep)

**Goal:** Each entry in `_activeCombats` carries enough info to log a complete combat record even if the live combat document is gone by the time we flush.

**Files:**
- Modify: `scripts/session-recap.mjs:255-305` (the `combatStart`/`deleteCombat` hooks in `_initCombatHooks`)

**Acceptance Criteria:**
- [ ] `_activeCombats[combatId]` shape is `{ startTime, participants, rounds, enemies, lastSnapshotAt }`
- [ ] `enemies` is rebuilt from the live combat doc on `combatStart` and refreshed on every `updateCombat`
- [ ] `rounds` is updated on every `updateCombat` to reflect `combat.round`
- [ ] Existing `deleteCombat` flow continues to work (no regression for normal end-combat)

**Verify (live Foundry):**
1. Start session, start combat with 2 enemies
2. Advance 3 rounds, kill one enemy on round 2
3. End combat
4. Recap shows that combat with 3 rounds, 2 enemies (1 defeated)

**Steps:**

- [ ] **Step 1: Read current `_initCombatHooks`**

Read `scripts/session-recap.mjs:219-362` to confirm structure.

- [ ] **Step 2: Extract enemy snapshot helper**

Add this private method to the `SessionRecap` singleton (place it just above `_initCombatHooks`, ~line 218):

```js
/**
 * Build a fresh enemy roster snapshot from a Foundry Combat document.
 * Used on combatStart for the initial roster and on every updateCombat
 * to refresh defeated state and HP. The killer attribution from
 * `_killMap` is overlaid at flush time, not here.
 */
_snapshotEnemies(combat) {
  const enemies = [];
  for (const c of combat.combatants) {
    if (!c.actor) continue;
    const disp = c.token?.disposition ?? c.token?.document?.disposition;
    if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;

    const hp = c.actor.system?.health;
    const defeated = c.defeated || (hp && hp.value <= 0);
    const tokenId = c.token?.id ?? c.token?.document?.id;
    enemies.push({
      name: c.actor.name,
      defeated: !!defeated,
      tokenId,                      // retained so flush can resolve killer from _killMap
      killedBy: null,               // filled in at flush from _killMap
    });
  }
  return enemies;
},
```

- [ ] **Step 3: Extend `combatStart` to capture enemy snapshot**

Replace the existing `combatStart` hook handler at `session-recap.mjs:256-270` with:

```js
// ── Combat start ───────────────────────────────────────
Hooks.on("combatStart", (combat) => {
  if (this.getData().sessionState !== "active") return;
  const participants = [];
  for (const c of combat.combatants) {
    if (!c.actor || !c.token) continue;
    const disp = c.token.disposition ?? c.token.document?.disposition;
    if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY && c.actor.hasPlayerOwner) {
      participants.push({ name: c.actor.name, actorId: c.actor.id });
    }
  }
  this._activeCombats.set(combat.id, {
    startTime: Date.now(),
    participants,
    rounds: combat.round ?? 1,
    enemies: this._snapshotEnemies(combat),
    lastSnapshotAt: Date.now(),
  });
});
```

- [ ] **Step 4: Add `updateCombat` hook to refresh snapshot**

Add this new hook handler immediately after the `combatStart` block:

```js
// ── Combat round / state changes — refresh snapshot ──────
Hooks.on("updateCombat", (combat, _changes) => {
  if (this.getData().sessionState !== "active") return;
  const active = this._activeCombats.get(combat.id);
  if (!active) return;
  active.rounds = combat.round ?? active.rounds;
  active.enemies = this._snapshotEnemies(combat);
  active.lastSnapshotAt = Date.now();
});
```

- [ ] **Step 5: Verify normal end-combat still works (regression check)**

The existing `deleteCombat` handler doesn't yet use the new snapshot fields — Task 3 will refactor it. After this task, end-combat behavior should be unchanged.

Live Foundry MCP test:
```js
// Start a brief combat, advance one round, end it
// Then inspect recap.combats — should have a new entry, same as before this task
const data = game.settings.get("vagabond-crawler", "sessionRecap");
return data.combats[data.combats.length - 1];
```

- [ ] **Step 6: Commit**

```bash
git add scripts/session-recap.mjs
git commit -m "feat(recap): snapshot enemy roster during active combats

Adds _snapshotEnemies helper and extends _activeCombats entries with
{ rounds, enemies, lastSnapshotAt }. Refreshed on every updateCombat
so a flush at session-end (next commit) can log a complete record
even if the combat document is already gone."
```

---

## Task 3: Flush active combats on session end/pause + loosen deleteCombat guard (Bug 2 fix)

**Goal:** A combat that's still open in the tracker when the session ends, or one that's deleted after `sessionState` flips to inactive, still appears in the recap.

**Files:**
- Modify: `scripts/session-recap.mjs:273-305` (the `deleteCombat` hook)
- Modify: `scripts/session-recap.mjs:769-795` (the `endAndSave` and `pauseSession` methods)

**Acceptance Criteria:**
- [ ] `_flushActiveCombats()` private method walks `_activeCombats`, calls `logCombat` for each, then clears the map
- [ ] `endAndSave()` calls `_flushActiveCombats()` **before** anything else (must complete before `clear()` flips state)
- [ ] `pauseSession()` calls `_flushActiveCombats()` before flipping state
- [ ] `deleteCombat` handler proceeds when `_activeCombats.has(combat.id)` is true, even if `sessionState !== "active"` (catches the late-delete race)
- [ ] After flushing in `deleteCombat`, the entry is removed from `_activeCombats` so a subsequent flush call doesn't double-log

**Verify (live Foundry):** Three scenarios under "Verification" in spec Bug 2.

**Steps:**

- [ ] **Step 1: Add `_flushActiveCombats` private method**

Add this method on the `SessionRecap` singleton, place it just below `logCombat` (~line 165 area):

```js
/**
 * Log every entry in `_activeCombats` to the recap and clear the map.
 * Called from endAndSave / pauseSession to catch combats that were
 * still open when the session ended. Uses the live combat doc when
 * available, otherwise falls back to the snapshot.
 */
async _flushActiveCombats() {
  for (const [combatId, active] of this._activeCombats.entries()) {
    const live = game.combats.get(combatId);
    const rounds = live?.round ?? active.rounds ?? 0;
    const enemies = (live ? this._snapshotEnemies(live) : (active.enemies ?? []))
      .map(e => ({
        name: e.name,
        defeated: e.defeated,
        killedBy: e.defeated ? (this._killMap.get(e.tokenId) ?? null) : null,
      }));

    await this.logCombat({
      id: combatId,
      rounds,
      startTime: active.startTime,
      endTime: Date.now(),
      enemies,
      participants: active.participants,
    });
  }
  this._activeCombats.clear();
  this._killMap.clear();
},
```

- [ ] **Step 2: Refactor `deleteCombat` to share the same flush logic**

Replace the existing `Hooks.on("deleteCombat", ...)` handler at `session-recap.mjs:273-305` with:

```js
// ── Combat end ─────────────────────────────────────────
// Proceed when we have an active snapshot for this combat even if
// sessionState has already flipped to inactive (the late-delete race
// when the GM ends the session before/while the combat is being
// deleted). Combats we never tracked from start are not logged here —
// _flushActiveCombats handles the in-flight case from end-session.
Hooks.on("deleteCombat", async (combat) => {
  const active = this._activeCombats.get(combat.id);
  if (!active) return;

  const enemies = this._snapshotEnemies(combat).map(e => ({
    name: e.name,
    defeated: e.defeated,
    killedBy: e.defeated ? (this._killMap.get(e.tokenId) ?? null) : null,
  }));

  await this.logCombat({
    id: combat.id,
    rounds: combat.round ?? active.rounds ?? 0,
    startTime: active.startTime,
    endTime: Date.now(),
    enemies,
    participants: active.participants,
  });

  this._activeCombats.delete(combat.id);
  this._killMap.clear();
});
```

- [ ] **Step 3: Wire `_flushActiveCombats` into `endAndSave`**

Find `endAndSave` at `session-recap.mjs:769`. Insert a flush call **before** any state mutation:

```js
async endAndSave() {
  // Flush any combats still open in the tracker so combat 3 doesn't
  // get dropped when the GM ends the session before deleting the
  // encounter.
  await this._flushActiveCombats();

  const data = this.getData();
  const now = Date.now();
  // ... rest unchanged
}
```

- [ ] **Step 4: Wire `_flushActiveCombats` into `pauseSession`**

Find `pauseSession` at `session-recap.mjs:763`. Insert flush before the state change:

```js
async pauseSession() {
  await this._flushActiveCombats();
  const data = this.getData();
  data.sessionState = "paused";
  await this._save(data);
},
```

- [ ] **Step 5: Live test — three scenarios via Foundry MCP**

For each, start fresh: clear recap state, start session, run scenario, inspect `data.combats`.

```js
// Scenario A: normal end-combat then end-session
// Expected: combat appears in data.combats (regression check)

// Scenario B: end session while combat is open in tracker
// (Crawl Bar's End-Crawl deletes the combat as part of the flow)
// Expected: combat appears

// Scenario C: leave combat in tracker, end session via Crawl Bar
// (manually skip End Combat — go straight to End)
// Expected: combat appears with last-known round count and enemy state
```

- [ ] **Step 6: Commit**

```bash
git add scripts/session-recap.mjs
git commit -m "fix(recap): flush active combats on session end/pause

Adds _flushActiveCombats() called from endAndSave and pauseSession to
log any combats still open in the tracker. Loosens the deleteCombat
guard so late-delete (after sessionState flips inactive) still logs
the combat when we have an active snapshot for it. Fixes combat 3
being silently dropped when the session ended before the encounter
was removed from the tracker."
```

---

## Task 4: Extract shared currency formatter (refactor for Task 5/6)

**Goal:** Pull the gold/silver/copper formatting helper into a reusable function so the new sales/purchases sections render consistently with the existing loot section.

**Files:**
- Modify: `scripts/session-recap.mjs` — add `_formatCurrency` helper near `_formatDuration`

**Acceptance Criteria:**
- [ ] `_formatCurrency(copperTotal)` returns strings like `"500g 40s"`, `"1g"`, `"50s"`, `"5c"`, or `"0c"` for zero
- [ ] Existing loot currency rendering at `session-recap.mjs:600-617` and `:640-653` is refactored to use the helper
- [ ] Output is byte-identical to current rendering for the same input

**Verify:** Run a recap export with currency loot before and after — string output must match.

**Steps:**

- [ ] **Step 1: Add the helper**

Just below `_formatDuration` at `session-recap.mjs:450`, add:

```js
/**
 * Format a copper total as a short g/s/c string. Vagabond currency
 * uses 100c = 1s, 100s = 1g.
 */
_formatCurrency(copperTotal) {
  copperTotal = Math.max(0, Math.round(copperTotal));
  if (copperTotal === 0) return "0c";
  const gold = Math.floor(copperTotal / 10000);
  const silver = Math.floor((copperTotal % 10000) / 100);
  const copper = copperTotal % 100;
  const parts = [];
  if (gold)   parts.push(`${gold}g`);
  if (silver) parts.push(`${silver}s`);
  if (copper) parts.push(`${copper}c`);
  return parts.join(" ");
},
```

- [ ] **Step 2: Add a copper conversion helper**

Add immediately above `_formatCurrency`:

```js
/**
 * Convert a {gold, silver, copper} cost object to a single copper total.
 * Tolerates missing fields.
 */
_toCopper(cost) {
  return (cost?.gold ?? 0) * 10000 + (cost?.silver ?? 0) * 100 + (cost?.copper ?? 0);
},
```

- [ ] **Step 3: Refactor existing loot currency render**

In `formatForDiscordFromData` at `session-recap.mjs:600-617`, replace the inline parts-building with:

```js
if (currencyEntries.length > 0) {
  let totalCopper = 0;
  for (const e of currencyEntries) {
    const gm = e.detail.match(/(\d+)\s*Gold/i);
    const sm = e.detail.match(/(\d+)\s*Silver/i);
    const cm = e.detail.match(/(\d+)\s*Copper/i);
    if (gm) totalCopper += parseInt(gm[1]) * 10000;
    if (sm) totalCopper += parseInt(sm[1]) * 100;
    if (cm) totalCopper += parseInt(cm[1]);
  }
  if (totalCopper > 0) lines.push(`- **Currency:** ${this._formatCurrency(totalCopper)}`);
}
```

Do the same refactor for the unclaimed-loot block at `session-recap.mjs:640-653`:

```js
if (currencyEntries.length > 0) {
  let totalCopper = 0;
  for (const e of currencyEntries) {
    const gm = e.detail.match(/(\d+)\s*Gold/i);
    const sm = e.detail.match(/(\d+)\s*Silver/i);
    const cm = e.detail.match(/(\d+)\s*Copper/i);
    if (gm) totalCopper += parseInt(gm[1]) * 10000;
    if (sm) totalCopper += parseInt(sm[1]) * 100;
    if (cm) totalCopper += parseInt(cm[1]);
  }
  if (totalCopper > 0) bits.push(this._formatCurrency(totalCopper));
}
```

- [ ] **Step 4: Live verification**

```js
// Snapshot a recap with currency loot before this commit (manually save
// the .formatForDiscord() output). After the change, run again and diff.
return game.vagabondCrawler.sessionRecap.formatForDiscord();
```

For a live test: pick up some currency in-game (or seed the recap manually), export, compare. The currency lines must be byte-identical.

- [ ] **Step 5: Commit**

```bash
git add scripts/session-recap.mjs
git commit -m "refactor(recap): extract _formatCurrency / _toCopper helpers

Pulls currency formatting out of the loot render block into reusable
methods on SessionRecap. Sales and purchases sections (next commits)
will share these helpers for consistent output."
```

---

## Task 5: Add `logSale` / `logPurchase` data layer (Bug 3 part 1)

**Goal:** Recap singleton accepts and persists sale and purchase entries; new fields default cleanly on existing worlds.

**Files:**
- Modify: `scripts/session-recap.mjs:14-22` (DEFAULT_DATA)
- Modify: `scripts/session-recap.mjs:51-53` (`getData` migration)
- Modify: `scripts/session-recap.mjs:769-790` (`endAndSave` snapshot)
- Modify: `scripts/session-recap.mjs` — add `logSale` and `logPurchase` next to `logLoot`

**Acceptance Criteria:**
- [ ] `DEFAULT_DATA` includes `sales: []` and `purchases: []`
- [ ] `getData()` adds these arrays in-place if missing on a loaded object (covers existing worlds)
- [ ] `endAndSave()` snapshot includes `sales` and `purchases`
- [ ] `logSale({ player, item, qty, price, ratio })` and `logPurchase({ player, item, qty, price })` both push entries with `timestamp` and `time`, guarded on `sessionState === "active"`
- [ ] Both methods are no-ops (no error) when state is not active

**Verify (live Foundry):**
```js
// 1. Check DEFAULT_DATA migration
const data = game.settings.get("vagabond-crawler", "sessionRecap");
return { hasSales: Array.isArray(data.sales), hasPurchases: Array.isArray(data.purchases) };
// → { hasSales: true, hasPurchases: true }

// 2. Test logSale
await game.vagabondCrawler.sessionRecap.logSale({
  player: "TestPlayer", item: "Test Sword", qty: 1,
  price: { gold: 5, silver: 0, copper: 0 }, ratio: 100,
});
const after = game.settings.get("vagabond-crawler", "sessionRecap");
return after.sales[after.sales.length - 1];
// → { player: "TestPlayer", item: "Test Sword", qty: 1, price: {...}, ratio: 100, timestamp, time }
```

**Steps:**

- [ ] **Step 1: Extend `DEFAULT_DATA`**

At `session-recap.mjs:14-22`, replace with:

```js
const DEFAULT_DATA = {
  sessionState: "inactive",
  sessionStart: null,
  loot: [],
  sales: [],
  purchases: [],
  xp: [],
  combats: [],
  encounterChecks: [],
  playerStats: {},
};
```

- [ ] **Step 2: Migrate `getData` for existing worlds**

Replace `getData` at `session-recap.mjs:51-53` with:

```js
getData() {
  const data = game.settings.get(MODULE_ID, SETTING_KEY) ?? foundry.utils.deepClone(DEFAULT_DATA);
  // Migrate older worlds that pre-date these fields. In-place is safe
  // because the next _save will persist them.
  if (!Array.isArray(data.sales))     data.sales = [];
  if (!Array.isArray(data.purchases)) data.purchases = [];
  return data;
},
```

- [ ] **Step 3: Add `logSale` and `logPurchase`**

Insert directly after `logDrop` at `session-recap.mjs:99` (just before the XP Logging section comment):

```js
// ── Sale Logging ───────────────────────────────────────────

/**
 * Log a player sale to the merchant.
 * `price` is a {gold, silver, copper} object — the actual currency the
 * player received after sell-ratio. `ratio` is the percentage applied
 * (50, 75, 100, etc.) so the recap can flag non-100% sales.
 */
async logSale({ player, item, qty, price, ratio }) {
  if (this.getData().sessionState !== "active") return;
  const data = this.getData();
  this._ensureStart(data);
  data.sales.push({
    player, item,
    qty: qty ?? 1,
    price: price ?? { gold: 0, silver: 0, copper: 0 },
    ratio: ratio ?? 100,
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  await this._save(data);
},

// ── Purchase Logging ───────────────────────────────────────

/**
 * Log a player purchase from the merchant.
 * `price` is the actual {gold, silver, copper} cost paid (with any
 * buyMultiplier already applied by merchant-shop).
 */
async logPurchase({ player, item, qty, price }) {
  if (this.getData().sessionState !== "active") return;
  const data = this.getData();
  this._ensureStart(data);
  data.purchases.push({
    player, item,
    qty: qty ?? 1,
    price: price ?? { gold: 0, silver: 0, copper: 0 },
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  await this._save(data);
},
```

- [ ] **Step 4: Include sales/purchases in `endAndSave` snapshot**

Find the `snapshot.data` object at `session-recap.mjs:779-784`. Replace with:

```js
data: {
  loot: data.loot,
  sales: data.sales,
  purchases: data.purchases,
  xp: data.xp,
  combats: data.combats,
  playerStats: data.playerStats,
},
```

- [ ] **Step 5: Live test via Foundry MCP**

Run the verify snippet in the task header.

- [ ] **Step 6: Commit**

```bash
git add scripts/session-recap.mjs
git commit -m "feat(recap): add sale and purchase loggers + data migration

Adds sales[] and purchases[] to DEFAULT_DATA, logSale / logPurchase
methods following the logLoot pattern, and an in-place migration in
getData for existing worlds. endAndSave snapshot includes both new
arrays so historical sessions can be re-rendered with the new
sections (empty for past sessions). No call sites yet — wired up in
the next commit."
```

---

## Task 6: Wire merchant-shop into recap loggers (Bug 3 part 2)

**Goal:** Every buy and sell that goes through the merchant shop appears in the recap.

**Files:**
- Modify: `scripts/merchant-shop.mjs:855-864` (the `logTransaction` chokepoint)

**Acceptance Criteria:**
- [ ] All four call sites (`_handleBuy`, `_handleCatalogBuy`, `_handleGamble`, `_handleSell`) flow through `logTransaction` and into the recap automatically
- [ ] Sales call `SessionRecap.logSale` with the actual `ratio` from settings (not hard-coded)
- [ ] Purchases call `SessionRecap.logPurchase`
- [ ] No double-logging if the recap is inactive (the recap methods self-guard)
- [ ] Gamble entries log as purchases with the descriptive item string already built upstream

**Verify (live Foundry):**
```js
// Pre: session active, open shop, GM-side buy + sell + gamble
// Post: inspect recap
const data = game.settings.get("vagabond-crawler", "sessionRecap");
return {
  sales: data.sales.length,
  purchases: data.purchases.length,
  lastSale: data.sales[data.sales.length - 1],
  lastPurchase: data.purchases[data.purchases.length - 1],
};
```

**Steps:**

- [ ] **Step 1: Import SessionRecap into merchant-shop**

At the top of `scripts/merchant-shop.mjs`, just below the `MODULE_ID` import on line 11:

```js
import { MODULE_ID } from "./vagabond-crawler.mjs";
import { SessionRecap } from "./session-recap.mjs";
```

- [ ] **Step 2: Extend `logTransaction` to forward to recap**

Replace `logTransaction` at `scripts/merchant-shop.mjs:855-864` with:

```js
async logTransaction(entry) {
  const log = game.settings.get(MODULE_ID, "shopLog") || [];
  log.push({
    ...entry,
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  await game.settings.set(MODULE_ID, "shopLog", log);
  if (this._app?.rendered) this._app.render();

  // Forward to Session Recap. The recap loggers self-guard on
  // sessionState, so we don't need to check here.
  if (entry.action === "sell") {
    const ratio = this._app?._sellRatio ?? game.settings.get(MODULE_ID, "shopSellRatio") ?? 100;
    SessionRecap.logSale({
      player: entry.player,
      item: entry.item,
      qty: entry.quantity,
      price: entry.price,
      ratio,
    });
  } else if (entry.action === "buy") {
    SessionRecap.logPurchase({
      player: entry.player,
      item: entry.item,
      qty: entry.quantity,
      price: entry.price,
    });
  }
},
```

- [ ] **Step 3: Live test via Foundry MCP — full transaction flow**

```js
// 1. Ensure session is active
const before = game.settings.get("vagabond-crawler", "sessionRecap");
const beforeSales = before.sales.length;
const beforePurchases = before.purchases.length;

// 2. Drive a buy + a sell from a test PC through the merchant shop
//    (manual via the shop UI, or call _handleBuy / _handleSell directly)

// 3. Verify
const after = game.settings.get("vagabond-crawler", "sessionRecap");
return {
  newSales:     after.sales.length - beforeSales,
  newPurchases: after.purchases.length - beforePurchases,
  lastSale:     after.sales[after.sales.length - 1],
  lastPurchase: after.purchases[after.purchases.length - 1],
};
```

- [ ] **Step 4: Commit**

```bash
git add scripts/merchant-shop.mjs
git commit -m "feat(recap): forward merchant transactions to session recap

logTransaction is the single chokepoint for buy / catalog buy /
gamble / sell — fan it out into SessionRecap.logSale and
logPurchase. Recap loggers self-guard on sessionState so this is
safe when no session is tracking."
```

---

## Task 7: Render Sales and Purchases sections (Bug 3 part 3)

**Goal:** The Discord export and the recap UI show the new Sales and Purchases sections, grouped by player with subtotals and a party total.

**Files:**
- Modify: `scripts/session-recap.mjs` — `formatForDiscordFromData` (insert two new sections after the Loot block at ~line 665)

**Acceptance Criteria:**
- [ ] Sales section renders only when `data.sales.length > 0`
- [ ] Purchases section renders only when `data.purchases.length > 0`
- [ ] Each section is grouped by player, items listed with `qty`, formatted price, and `(ratio%)` if ratio ≠ 100
- [ ] Per-player subtotal line printed
- [ ] Party total line printed at the section end
- [ ] Currency rendered via `_formatCurrency` (Task 4 helper)

**Verify (live Foundry):**

```js
// Seed test data
const recap = game.vagabondCrawler.sessionRecap;
await recap.logSale({ player: "Alice", item: "Sword",  qty: 1, price: { gold: 50,  silver: 0,  copper: 0 }, ratio: 100 });
await recap.logSale({ player: "Alice", item: "Shield", qty: 2, price: { gold: 20,  silver: 50, copper: 0 }, ratio: 75  });
await recap.logSale({ player: "Bob",   item: "Bow",    qty: 1, price: { gold: 30,  silver: 0,  copper: 0 }, ratio: 100 });
await recap.logPurchase({ player: "Alice", item: "Healing Potion", qty: 3, price: { gold: 15, silver: 0, copper: 0 } });
return recap.formatForDiscord();
// Expect: ## Sales section with Alice (Sword + Shield ×2 (75%) + subtotal),
// Bob (Bow + subtotal), and a Party total. ## Purchases with Alice subtotal.
```

**Steps:**

- [ ] **Step 1: Add the Sales render block**

After the Loot section in `formatForDiscordFromData` (immediately following the unclaimed-loot block ending at `session-recap.mjs:665`), and before the XP section, insert:

```js
// ── Sales ──────────────────────────────────────────────
if (Array.isArray(data.sales) && data.sales.length > 0) {
  lines.push("## Sales");
  const byPlayer = {};
  for (const s of data.sales) {
    if (!byPlayer[s.player]) byPlayer[s.player] = [];
    byPlayer[s.player].push(s);
  }
  let partyCopper = 0;
  for (const [player, entries] of Object.entries(byPlayer)) {
    lines.push(`### ${player}`);
    let playerCopper = 0;
    for (const e of entries) {
      const qtyStr = (e.qty ?? 1) > 1 ? ` ×${e.qty}` : "";
      const ratioStr = (e.ratio ?? 100) !== 100 ? ` (${e.ratio}%)` : "";
      const lineCopper = this._toCopper(e.price);
      playerCopper += lineCopper;
      lines.push(`- ${e.item}${qtyStr} — ${this._formatCurrency(lineCopper)}${ratioStr}`);
    }
    lines.push(`- **Subtotal:** ${this._formatCurrency(playerCopper)}`);
    partyCopper += playerCopper;
    lines.push("");
  }
  lines.push(`**Party total:** ${this._formatCurrency(partyCopper)}`);
  lines.push("");
}
```

- [ ] **Step 2: Add the Purchases render block**

Immediately after the Sales block:

```js
// ── Purchases ──────────────────────────────────────────
if (Array.isArray(data.purchases) && data.purchases.length > 0) {
  lines.push("## Purchases");
  const byPlayer = {};
  for (const p of data.purchases) {
    if (!byPlayer[p.player]) byPlayer[p.player] = [];
    byPlayer[p.player].push(p);
  }
  let partyCopper = 0;
  for (const [player, entries] of Object.entries(byPlayer)) {
    lines.push(`### ${player}`);
    let playerCopper = 0;
    for (const e of entries) {
      const qtyStr = (e.qty ?? 1) > 1 ? ` ×${e.qty}` : "";
      const lineCopper = this._toCopper(e.price);
      playerCopper += lineCopper;
      lines.push(`- ${e.item}${qtyStr} — ${this._formatCurrency(lineCopper)}`);
    }
    lines.push(`- **Subtotal:** ${this._formatCurrency(playerCopper)}`);
    partyCopper += playerCopper;
    lines.push("");
  }
  lines.push(`**Party total:** ${this._formatCurrency(partyCopper)}`);
  lines.push("");
}
```

- [ ] **Step 3: Live test via Foundry MCP**

Run the verify snippet from the task header. Confirm both sections render correctly with subtotals and party totals.

- [ ] **Step 4: Commit**

```bash
git add scripts/session-recap.mjs
git commit -m "feat(recap): render Sales and Purchases sections in export

Two new Discord-format sections after Loot, grouped by player with
per-player subtotals and a party grand total. Sell ratio shown in
parentheses only when non-100. Renders only when the corresponding
array is non-empty so unaffected sessions look unchanged."
```

---

## Task 8: Update documentation

**Goal:** Architectural notes and (if applicable) user-facing docs reflect the new APIs and sections.

**Files:**
- Modify: `docs/dev/session-recap.md` — note new `logSale`/`logPurchase` APIs, the `_flushActiveCombats` lifecycle behavior, and the extended data shape
- Modify: user-facing recap doc (path from Task 0 — only if it exists)
- Modify: `CHANGELOG.md`

**Acceptance Criteria:**
- [ ] `docs/dev/session-recap.md` data-shape table includes `sales` and `purchases`
- [ ] `docs/dev/session-recap.md` mentions the flush-on-end behavior and the new logger APIs
- [ ] User-facing doc (if it exists) describes the Sales and Purchases sections
- [ ] `CHANGELOG.md` entry describes the three fixes

**Verify:** Read the modified docs back and confirm they match the implementation.

**Steps:**

- [ ] **Step 1: Update `docs/dev/session-recap.md`**

Add the new fields to the data-shape table. Add a paragraph describing flush behavior. Add `logSale` and `logPurchase` signatures to the API section.

- [ ] **Step 2: Update user-facing doc** (skip if Task 0 found no such file)

Add a short paragraph describing the new Sales and Purchases sections in the recap export.

- [ ] **Step 3: Append `CHANGELOG.md` entry**

Under the next unreleased version (or a new entry):

```markdown
### Fixed
- Session Recap: XP question breakdown is no longer lost (regression — the dialog reset the question counts before the recap snapshot was built).
- Session Recap: Combats still open in the tracker when a session ends are now flushed into the recap instead of being silently dropped.

### Added
- Session Recap: New Sales and Purchases sections in the Discord export, grouped by player with subtotals and party totals.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ CHANGELOG.md
git commit -m "docs(recap): document new sales/purchases APIs and combat flush

Updates dev reference for the new logger APIs, data-shape additions,
and the flush-on-end behavior. CHANGELOG entry covers all three
fixes from this branch."
```

---

## Self-Review Notes (filled during writing)

**Spec coverage:**
- Bug 1 → Task 1 ✓
- Bug 2 → Tasks 2 + 3 ✓ (snapshot then flush)
- Bug 3 → Tasks 4 (helper) + 5 (data) + 6 (call sites) + 7 (render) ✓
- Docs → Task 8 ✓

**Type consistency:**
- `logSale` and `logPurchase` parameter names match between Task 5 (definition) and Task 6 (call sites).
- `_flushActiveCombats` referenced by Task 3 step 3, 4 — defined in step 1.
- `_snapshotEnemies` defined in Task 2, reused in Task 3.
- `_formatCurrency` / `_toCopper` defined in Task 4, used in Tasks 7.

**Placeholder scan:**
- Task 0 acknowledges the user-doc path as "TBD — verify in step 0" but has a concrete fallback (skip if missing). Not a true TBD.
- All other tasks have concrete code blocks for every code change.
