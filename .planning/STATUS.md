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

- [claude, 2026-09-16 20:30 CT] Addressed both PR #4 reviews. **PR #4 merged** 2026-09-16 20:29 CT (merge commit f9f7033 into review/base-v1.18.2; fixes committed as 3b5108a, pushed to review/vagabond-5.38 and origin/main; CI 4/4 green). Fixed: After-Image token creation relayed to the active GM over the module socket (players can't create tokens); Loot Generator "Fabled, X" / "Bane of X" / "Protection vs X" now reach `buildRelicPowerData` (tier from niche suffix / comma); party-light gather/release serialised (two members no longer overwrite each other's `partyLights`) and an expired-while-gathered release clears the snapshot's `litItems`; system hour clocks tick per crawl turn even with Crawler realtime mode on; loot claim cards and the public claimed line price via `itemValue` (base × metal); Store Spell dialog inputs labelled, relic menu items keyboard-operable; `worldActor` alias dropped in Pack Instincts. AGENTS.md is now a symlink to CLAUDE.md (the two had drifted, incl. the world-actor mirroring rule). Docs: strip casting/Cleave rules in crawl-loop + wiki + dev/combat-tools; new docs/dev/crafting-loot.md (relic flags, wraps, hooks, uses). Tests: flanked-status canary in system-contract, loot power-text mapping, two-member gather. Skipped: storing hook IDs in `_hookIds` (118 `Hooks.on` in the module, 3 stored; no teardown path exists for these singletons). Live: `await game.vagabondCrawler.test.run()` → `total: 121, passed: 121, failed: 0`; socket handler driven with a synthetic afterImage message created 1 token; console errors 0; sweep 0/0. Uncommitted — not mine: VCE Cleave-lend/Spin-to-Win edit in npc-action-menu.mjs + its CHANGELOG bullet.

- [hermes-reviewer, 2026-09-16 20:08 CT] Reviewed PR #4 against v1.18.2 on separate Standards and Spec axes: 9 standards findings and 4 spec findings. Blocking issues: After-Image bypasses the GM socket path; generated dynamic/Fabled relic powers miss forge data; party-light transfer can lose state and preserve stale litItems. Review-only; no implementation files changed. Runtime smoke command returned `total: 118, passed: 118, failed: 0`; `verify.sh` returned exit 0 on the pinned PR head archive.

- [claude, 2026-09-16] Light Tracker window lists system lights (clock rows + no-timer litItems), + / − time burns/adds on their clocks (hour/quarter segments, realtime startTime shift), douse deletes the clock. Fixed pickup ordering (token before clock) that made the system's clock-delete hook update a deleted token; test fixtures skip deleting already-deleted tokens/actors. Live: suite 118/118, no errors from this work.

- [claude, 2026-09-16] System light sources: canvas drop/pickup (light + remaining clock carried, holder not consumed) and party gather/release (light + clocks move to the party token and back; burn-out while gathered stays out). ItemDrops asks LightTracker.claimsDrop — also ends the old double drop for Crawler lights outside ItemDrops' name list. Live: suite 117/117, no orphans.

- [claude, 2026-09-16] Activated relic powers (scripts/relic-activations.mjs): Blast (6d6 Close, save buttons), Precision (next attack hits), After-Image I/II (unlinked token copy, 1/10 rounds), Wish-Granting (once ever), Benediction (1 HP once per week), Store Spell (Max Mana reserve → free cast). Uses reset on Crawler Rest / world time. Live: suite 115/115; sheet right-click menu shows the entries; Store Spell cast Burn for 0 Mana on Drako and restored Max Mana.

- [claude, 2026-09-16] Mechanical relic powers built: Resistance (typed, half before Armor), Protection (Favor on saves vs Being type), Cursed Doom (restorative cap per die), Nightvision/Truesight/Tremors/Echolocation/Sense Life (token vision/detection modes), Darkness/Moonlit/Radiant (token light, Far = 60 ft). Left to the GM: movement, Telepathy/Detection/Valuables/Ambassador/Aqua-Lung/Warning, once-per-day powers, Jumping (system has no jump field). Live: suite 113/113; Drako's real Darksight shield + Darkening trinket now apply.

- [claude, 2026-09-16] User's design calls implemented. Vicious crit = 2×HD (NPC) / 2×Level (PC). Relic Bravery/Clarity/Repulsing → system.statusResistances, Burning I-III → item causedStatuses, cursed auto-fail saves → StatusHelper.applyStatus wrap; Loot Generator relics now carry relicForge/applicationMode/properties (shared buildRelicPowerData). Strip Imbue casts through the system's native Imbue (VCE ImbueManager removed). System light items (5.23+ macro) light through game.vagabond.lightSource; Crawler adds oil, keeps burned-out lanterns, ticks hour clocks on crawl turns, drives light FX. VCE Monk Martial Arts Cleave borrows the Cleave property (5.38 rule). Live: suite 109/109, VCE smoke 230/0/2.

- [claude, 2026-09-16] Metal item prices: merchant buy/sell/restock, party inventory and loot/gamble cards now use the system's derived cost (baseCost × metal multiplier); relic loot no longer multiplies power value by the metal. Live: silver Longsword sold at 50% for 2g (400s cost), loot itemValue matched derived cost on 12/12 items, suite 107/107.

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
