# Session Tracking

Session Recap keeps the current crawl's combat, loot, merchant, XP, and player statistics, then archives saved sessions in the world.

---

## Session Recap

The recap window has five tabs:
- **Overview** shows duration, combat totals, enemies defeated, and a per-character summary.
- **Combat** stores encounter cards with rounds, duration, enemy outcomes, and available roll or damage statistics.
- **Loot** lists supported item claims and handoffs with their recipients and sources.
- **XP** shows each award and its questionnaire breakdown.
- **History** opens archived sessions for review.

Merchant activity also adds **Sales** and **Purchases** to the recap's Markdown copy, grouped by player with subtotals and a party total.

The stored lifecycle states are `inactive`, `active`, and `paused`. Opening an archived entry changes what the window displays without replacing the current recap.

### Record a session

1. Click **Start Crawl**. In the GM's **Session Tracking** prompt, choose **Start New Session**, **Continue Session**, or **No Tracking**.
2. Play normally. Attack and save hooks record supported roll statistics; combat hooks track encounter data. Damage Log supplies damage dealt and taken when that module is active. Supported loot, merchant, and XP paths add their own entries.
3. Open **Forge & Loot → Session Recap** as GM, or type `!recap` as any user, to inspect the current data.
4. Click **End** on the Crawl Bar. Choose **End & Save**, **Pause Session**, or **Discard** when that action is offered. Closing the prompt pauses the session.
5. Open **History** to review an archive. **Copy for Discord** copies the current or selected recap as Markdown.

### Settings

No user-facing config settings. Persisted world state lives in two settings:

| Setting | Purpose |
|---|---|
| `sessionRecap` | Current session data (state, sessionStart, loot, sales, purchases, xp, combats, playerStats, encounterChecks) |
| `sessionHistory` | Archive array of ended sessions |

The recap has no public Module Settings toggles. Crawl start and end prompts control its lifecycle.

### Limits and notes

- Without Damage Log, the recap can still keep supported loot, XP, rolls, combats, and merchant data, but damage columns remain empty and some kill attribution is unavailable.
- The start and end prompts only come from the crawl lifecycle. Running combat without starting a crawl does not show them.
- `!recap` opens a local recap view for any user. Lifecycle and destructive controls remain GM-only.
- History is stored in the world and survives a reload.
- Player statistics are keyed by actor, so switching characters creates separate rows.
- Saving or pausing flushes an open combat's latest snapshot into the recap first.
- The Markdown copy uses ordinary GFM headings and tables.

> **Version 1.17.2 tracking limitation:** most hook-driven data checks for an active session, but several direct loggers do not enforce that state themselves. Loot, XP, encounter checks, combat entries, or player-stat updates can therefore append while the recap is paused or inactive. Treat **No Tracking** and **Pause Session** as partial controls and inspect the recap before saving.

> **Archive limitation:** **End & Save** does not copy `encounterChecks` into the history snapshot. Copy the current recap before ending if those checks need to be retained.

---

### XP Counter Patch

Crawler changes Vagabond's **Level Up Dialog** from yes/no checks to numeric counters. Left-click a question to add one; right-click to subtract one, with a minimum of zero. The badge, per-question subtotal, and total award update with the count. Confirming the dialog adds the character and question breakdown to **Session Recap → XP**. Because the XP logger has no state guard in version `1.17.2`, it can add an entry while the recap is inactive or paused.
