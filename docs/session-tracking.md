# Session Tracking

Cross-session data: combat stats, loot, XP awards.

---

## Session Recap

<!-- gif: docs/assets/session-recap.gif -->

### What it does

A cross-session tracking layer that captures everything that matters at the table and presents it in a five-tab window: **Overview**, **Combat**, **Loot**, **XP**, **History**. Auto-captures happen in the background whenever a session is marked *active* — there is no tracking while a session is paused or inactive, which keeps out-of-game clicks from polluting the record.

The five tabs:
- **Overview** — session duration, combat count, enemies defeated, and a per-player summary table (kills, damage dealt, damage taken, XP).
- **Combat** — one collapsible card per encounter with round count, duration, enemy list with kill credits, and a per-player stats table (hit rate, nat 20s / nat 1s, average d20, save pass/fail split, damage dealt / taken, kills).
- **Loot** — reverse-chronological log of every item handout from the Loot Generator, Loot Drops, Merchant Shop, and manual "Give to Player" actions, with the source tagged on each entry.
- **XP** — per-player award cards showing the level-up questionnaire breakdown (which questions got marked, sub-XP per question, total for the award). Fed by the [XP Counter Patch](#xp-counter-patch).
- **History** — every ended session, listed with date, duration, top stats, and a preview. Click to drill in (the active tabs swap to viewing that archive), **Export to Discord** for a markdown copy, or **Delete**.

The Discord export also produces two extra sections when the merchant shop saw activity: **Sales** and **Purchases**, grouped by player with per-player subtotals and a party total. Sales show the sell ratio in parentheses when it isn't 100% (so a `(75%)` tag flags discounted sales at a glance).

A session moves through four states: `inactive` (no tracking), `active` (everything is captured), `paused` (data preserved, capture suspended), and the transient "viewing history" mode when you click into an archived session. Crawl start/end events prompt the GM with a **waitDialog** for the right state transition.

### How to use

1. **Start tracking.** When a crawl starts (`Hooks.on("vagabondCrawler.crawlStart")`), the GM sees a popup: **Start New Session** (fresh slate) or **Continue Paused Session** (append to whatever was paused last). The popup only appears to the GM; players don't see it.
2. **Play normally.** Every roll goes through the player-stats hook — attack rolls credit hits/misses/nat 20s/nat 1s, saves credit passes/fails, and `combatHooks` tracks combat-level stats. Damage Log module (if installed) feeds damage-dealt and damage-taken. Loot hands from Generator/Drops/Shop log automatically; the XP questionnaire Counter logs each award as you confirm it.
3. **End of crawl.** When the crawl ends, the GM is prompted: **End & Save** (archives to history), **Pause Session** (keeps data for later continue), or **Discard** (only shown when data exists). Closing the dialog without choosing defaults to Pause.
4. **Open the window.** Anyone can open the recap via Crawl Bar → **Forge & Loot** → **Session Recap**, or type `!recap` in chat. It opens for that user only (not a shared window).
5. **Export.** In the History tab, any archived session has an **Export to Discord** button that copies a markdown summary to the clipboard — paste straight into your table's Discord channel.

### Settings

No user-facing config settings. Persisted world state lives in two settings:

| Setting | Purpose |
|---|---|
| `sessionRecap` | Current session data (state, sessionStart, loot, sales, purchases, xp, combats, playerStats, encounterChecks) |
| `sessionHistory` | Archive array of ended sessions |

Toggles are driven by lifecycle events, not config — start/pause/discard/save is always a deliberate choice in the dialog at crawl start or end.

### Tips & Gotchas

- **Damage Log integration is soft.** Without the `damage-log` module, Loot, XP, and basic kill credit still work, but damage-dealt / damage-taken go unfilled. The Overview tab shows a "Damage Log not installed" note when the dependency is missing.
- **Auto-capture is gated on session state.** If the session is `inactive` or `paused`, nothing logs. This is intentional — test rolls at the start of the night don't pollute the table.
- **Crawl lifecycle drives prompts.** If you skip the crawl system entirely and just run combats manually, no prompts fire — you'd need to call `SessionRecap.startSession()` / `endAndSave()` via the console or a macro.
- **The `!recap` chat command** is a user-facing shortcut — anyone can type it to open their own recap view. No permission gating; the window is read-only for non-GMs.
- **History survives world reload.** The `sessionHistory` setting is persisted per-world, so a session archived last month is still in the History tab today. Delete unwanted entries directly from the UI.
- **Player stats aggregate per-actor, not per-user.** A player who switches characters mid-session gets one row per character, not one merged row; matches the way XP and loot are tracked — the character is the accounting unit.
- **Loot log entries tag their source.** "Loot Generator", "Loot Drops", "Merchant Shop", and manual hand-offs each appear with a distinct source label, so you can answer "where did this relic come from?" in the History tab three months later.
- **Combat rollup** snapshots stats at the end of each combat into that combat's card — the per-combat view is immutable after the combat ends, so a later combat's stats don't retroactively rewrite an earlier card.
- **Combats still in the tracker at session end are flushed automatically.** If you click **End & Save** while an encounter is still open, the recap captures the latest snapshot (rounds, enemy roster, kill credits) before clearing state. Same on **Pause Session**.
- **Merchant transactions feed Sales and Purchases.** Every buy and sell that flows through the Merchant Shop (regular shop, catalog buy, gamble, sell) auto-logs to the recap. Sales include the sell-ratio applied at the time, so a later ratio change doesn't rewrite history.
- **Discord export is markdown.** Headings and tables are plain GFM, so the same string renders cleanly in GitHub, Notion, Obsidian, or anywhere else that speaks markdown.

---

### XP Counter Patch

<!-- gif: docs/assets/xp-counter.png -->

Monkey-patches the Vagabond system's **Level Up Dialog** so each XP questionnaire entry is an unlimited numeric counter instead of a simple on/off checkbox. **Left-click** a question to increment the count; **right-click** to decrement (clamped at 0). A badge shows the current count next to each question, and the per-question XP subtotal is shown right-aligned so the GM can see exactly how much each answer contributes. Total XP awarded updates live as counts change. When the dialog is confirmed, the final award is auto-logged to **Session Recap → XP** with the full per-question breakdown, the character, and the awarding user — so you always know where every XP point came from during the post-game review.
