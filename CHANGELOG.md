# Changelog

## v1.12.1

Deep bug-fix pass on the Animation FX system — every sheet-level override path was broken in a different way, and several issues compounded (silent save failures, wrong animations playing for the wrong thing, projectiles that never fired). Also adds missing config parity between the sheet and global editors, category-level enable toggles, and asset-module availability checks.

### Sheet Overrides — now actually work

- **Save button was silently failing** — `DialogV2.prompt`'s callback used `dialog.querySelector("form")`, but `dialog` is the DialogV2 **instance**, not an HTMLElement. The returned `undefined` crashed `new FormDataExtended(undefined)` inside the callback, which DialogV2 swallowed as "user cancelled." Every sheet-level override save looked like it worked but wrote nothing. Now uses `button.form` — the canonical v13 pattern — and writes actually land.
- **Nested `<form>` inside the dialog content** — invalid HTML that caused browsers to misparse checkbox state. The template now uses a `<div>` since DialogV2 already wraps its content in a form.
- **Weapon sheet overrides had no effect** — the crawler's chat hook explicitly skips weapons (they're played by the Vagabond system's `system.itemFx` pipeline). Saving a per-weapon override only wrote to `flags.animationOverride`, which the system never reads. Now mirrors the preset to `system.itemFx` (and the `disabled` flag to `system.itemFx.enabled`) so sheet overrides take effect during actual weapon rolls.
- **Unlinked NPC tokens silently discarded the override** — the ⚡ dialog on a token's NPC sheet called `synthActor.setFlag(...)`. Synthetic actors don't propagate flags to their world actor, but `_onChatMessage` reads flags via `game.actors.get(flags.actorId)` (the world actor). Override invisible to playback → global config preset always won. Now redirects `setFlag` to the world actor via `game.actors.get(target.id)`.
- **Save-and-reopen dropped the disable state** — after checking "Disable animation entirely", saving, and unchecking, the checkbox re-rendered as checked because the DOM `checked` *attribute* stayed after the property flipped. Now every save calls `this.render()` so the template re-applies state from the persisted flag — DOM can't drift.
- **Dialog replaced with a dedicated ApplicationV2** — the minimalist DialogV2 is gone. New `AnimationFxOverrideApp` mirrors the global editor's preset block: label, disable, type, target, hit (file + picker, scale, duration, offset X, sound + picker, volume), collapsible miss block, **Preview** button (Shift-click for miss preview), **Promote to Global NPC Action** button.
- **Promote to Global** — on the NPC action editor, a new button copies the sheet preset into `config.npcActions` with an editable regex pattern. Applies automatically to any NPC whose action name matches thereafter.

### Animation Routing

- **Ability clicks fired action animations** — the system reuses `VagabondChatCard.npcAction(actor, <thing>, index)` for both actions (`system.actions[i]`) AND abilities (`system.abilities[i]`). The wrap blindly stamped `actionIndex` into flags → `_resolve` read `actor.system.actions[abilityIndex]` → wrong animation. Clicking Pack Hunter on a Wolf triggered Frost Breath's cone; clicking Pounce triggered Bite. Now verifies `actor.system.actions[actionIndex]` matches the passed-in object by identity or name before installing the stamping hook.
- **Pack Hunter pre-message swallowed the stamping hook** — the NPC-vs-NPC animation failure. `npc-abilities.mjs` posts a "Pack Hunter: target is Vulnerable..." chat message *before* the action card. My `preCreateChatMessage` listener's `Hooks.off` fired unconditionally on the first message, so the Pack Hunter message consumed the hook and the real action card arrived unstamped. Now the listener persists across non-matching messages and only deregisters after successfully stamping a matching one.
- **Most-specific pattern wins** — `_resolveNpcAction` iterated presets in insertion order and returned the first regex match, so a generic `breath|exhale|spray|cone of` preset beat a specific `Frost Breath` preset if it was registered first. New `_pickBestPattern` scores by the length of the matched substring: `Frost Breath` (12 chars) beats the generic `breath` match (6 chars). Works across `weapons` and `npcActions` tabs; `alchemical`/`gear` still use whole-name equality.
- **Generic NPC Action default removed** — an unmatched NPC action used to fall back to a generic sword-slash preset (`_default`), which played on everything the system didn't have a specific entry for. Now unmatched actions play nothing. A migration strips `_default` from existing saved configs.

### Projectile & Cone Targeting

- **`_getTargets` returned empty for NPC actions** — assumed `targetsAtRollTime` was an array of token-ID strings, but the system stores three different shapes depending on caller: raw ID strings, serialized `TokenDocument`s (with `_id`), and summary objects (`{tokenId, sceneId, actorId, actorName, actorImg}` — used by the NPC action path). `canvas.tokens.get({...})` returned undefined for the summary shape, so projectiles had nothing to stretch to. Now normalizes all three into ID strings before lookup.
- **Zero-distance `stretchTo` warnings** — projectile and cone animations with no distinct target fell back to `sourceToken` as their own target, triggering `Sequencer | stretchTo - You are stretching over a distance of 0`. Now filters out targets that share the source's ID and skips the whole animation with a debug message if no distinct target remains.

### Enable / Disable by Category

- **5 category toggles** — `animationFxCategory{Weapons,Skills,Alchemical,Gear,NpcActions}` registered as world-scoped, `config: true` booleans. They appear in Foundry's module settings panel **and** the Animation FX Configuration → Settings tab, writing to the same keys so edits in either place stay in sync.
- **Existing settings surfaced** — `animationFxEnabled`, `animationFxScale`, `animationFxTriggerOn`, `animationFxSoundEnabled`, `animationFxMasterVolume` all now appear in module settings with proper names/hints; previously they were `config: false` and only editable via the Animation FX Configuration window.
- **Resolvers short-circuit** — disabling a category returns `null` from the matching `_resolve*` method. No playback attempt, no console noise, no error.

### Asset Module Checks

- **`_fileReferencesMissingModule`** — pre-flight check at the top of `_play` and `_playSound`. Inspects the file path; if it's `modules/<id>/...` with `<id>` inactive, or `jb2a.<key>` with no JB2A pack active, the animation/sound is silently skipped with a `console.debug` line. `jb2a.xxx` database keys correctly accept either the free or patreon pack (Sequencer's database is shared). `modules/JB2A_DnD5e/...` and `modules/jb2a_patreon/...` are checked strictly against their own module IDs (they ship separate file trees). Same rules for PSFX (`psfx` vs `psfx-patreon`).
- **Availability panel** in the Settings tab — ✓/✗ next to Sequencer, JB2A (Free + Patreon), and PSFX (Free + Patreon), with path examples showing exactly which prefixes each pack serves.
- **Defensive `try/catch` around `_playOne`** — even if a preset slips past the availability check (typo, wrong DB key, custom upload missing, etc.), `seq.effect().file(...)` failures land in a console warning instead of bubbling out of the chat-message hook.

### Minor

- **`ui.notifications` confirmation** after each sheet-override save — `[Animation FX] Saved override for action 0: modules/...` toast so you can tell Save actually ran vs. silently failed.
- **Cleaner normalization** in the override app — optional fields (offsetX, sound, volume, miss block) are only written when set, keeping saved presets compact.

### Countdown Dice & Session Recap

- **Countdown dice auto-clean on NPC death** — Burning / Poisoned / Bleeding countdowns no longer keep ticking on a dead NPC. When an NPC's HP hits 0, every non-recharge countdown die linked to that actor is deleted (and its status icon cleared via the system's `deleteJournalEntry` hook). Scope is NPCs only — PCs at 0 HP are downed, not dead, and may be revived while their conditions are still supposed to matter.
- **Encounter check logging in the recap** — every random-encounter d6 is now logged to the session recap (not just hits), with roll, threshold, hit/miss, clock label, and timestamp. The new `## Encounter Checks` section shows rolls/hits/hit-rate/avg d6 plus a chronological list.
- **XP breakdown consolidation in the recap** — multiple XP awards to the same player over a session now merge into one list instead of repeating per-award. Preserves questionnaire order, shows `(3 XP ea)` rate tags for multi-point entries, and adds a per-event audit line when a player received awards in more than one sitting. Grand-total across all players still computed.

## v1.12.0

Bug-fix / QA pass on systems exercised during live play — attribution in the session recap, loot visibility, merchant purchases, DPR math, and a pair of new features (unclaimed-loot tracking, auto-pause on encounter, proper Relic: +1 Enchantment Scrolls).

### Session Recap

- **Correct attacker attribution** — the combat stats (damage dealt, kills, defeated-by credit) used `game.combat.combatant.actor` as the attacker, i.e. whoever's turn it currently was. This collapsed under AOE spells, reactions, and any initiative that put a familiar or polymorph between the acting PC and the damage-log message firing. Example from a live session: Seven's multi-target `Burn` killed 5 Ettercaps + a Giant Spider, all credited to his Bee familiar (next combatant in initiative) rather than to Seven. Now the recap tracks the speaker of each `HIT` chat card and uses that as the attacker for any damage-log message that fires within 60 seconds, falling back to the combat turn-holder only if nothing recent is tracked.
- **Familiar / polymorph unwrap** — damage dealt by a polymorph form (`flags.core.originalActor`) or a player-owned NPC (familiar, summon) now credits the controlling PC. Seven casting a spell while polymorphed into a Beetle no longer writes to a Beetle-named row.
- **Unclaimed loot tracking** — loot rolls are now logged the moment the claim card is posted, not just when the Claim button is clicked. A new `### Unclaimed` section in the recap lists rolls that were never claimed, grouped by original recipient. Claims flip the existing entry to `claimed: true` via the chat message id — no duplicates.
- **Legacy `lootLog` migration guard** — the old `sessionRecap.migrateFromLootLog()` read an unregistered world setting on `init`, throwing `"vagabond-crawler.lootLog" is not a registered game setting` for any world that never had the legacy setting. Now guards with `game.settings.settings.has(...)` before reading.

### Monster Creator

- **Combo / multi-attack checkbox** — each action now carries an explicit `Part of multi-attack routine` checkbox, displayed inline in the action grid and surfaced as a `COMBO` badge in the collapsed action summary. Replaces the fragile "type 'combo' into a note" legacy convention (which still works for old monsters).
- **DPR math fix** — `calculateDPR` used `_averageDice(roll) + flat`, treating `rollDamage` and `flatDamage` as additive when they're actually alternative presentations of the same damage (roll-based vs. pre-averaged). Every action was counting twice. Now computes `roll_avg OR flat` (prefer roll, fall back to flat) and partitions actions into combo and single routines, returning `max(comboSum, bestSingle)`.
- **Damage UI clarification** — the action row used a literal `+` between the rollDamage and flatDamage inputs, misreading as addition. Changed to `or`. The damage-summary helper likewise switched from `"1d6 +3"` to `"1d6 / 3"`, mirroring the Vagabond NPC sheet convention.
- **Combo persistence** — combo membership is stashed on the actor as `flags.vagabond-crawler.actionCombos` (array of action names), since the Vagabond action schema rejects unknown fields. `_fromCompendiumActor` rehydrates the checkboxes when editing an existing monster.

### Relic Forge & Enchantment Scrolls

- **Relic: +1 Enchantment Scroll — now a real item** — four call-sites in the loot generator (Lv1 table, ARMOR_BASE d20 entry 20, Lv2 armor chain, treasure chain) used to produce a random spell scroll via `_createSpellScroll(0)` and just rename it `"Enchantment Scroll"`. Since the spell pool includes a spell literally named `Enchant`, players periodically got a `Scroll of Enchant` labeled as an enchantment upgrade. They are two different items; the +N Enchantment Scroll is a consumable that permanently stamps a Weapon/Armor/Trinket +1 onto an existing item, not a one-shot spell cast. New `_createEnchantmentScroll(bonus)` helper produces a proper consumable with `flags.vagabond-crawler.enchantmentScroll = { bonus }` and the 100g price that matches the Relic Forge's `bonus-weapon-1` power.
- **Use flow** — new `EnchantmentScroll` subsystem with a right-click inventory context entry `Use Enchantment Scroll` → picker dialog grouped by slot (Weapons / Armor / Trinkets) → applies the chosen `bonus-<slot>-N` Relic Forge power (same AE key, same equip-gating, same `relicForge` flag) and consumes one scroll charge. Double-enchant guard (`_hasExistingBonus`) prevents stacking +N bonuses on the same item.

### Merchant Shop

- **Buying 1 item transferred the full stack** — in NPC-merchant mode, if the merchant had 3 Light Armors and a player bought 1, the buyer received a single stack of quantity 3 while the merchant's stock correctly decremented to 2. Root cause: `_handleBuy` cloned the merchant's item data (including its `system.quantity = 3`) and only overrode the quantity field when the buyer requested 2+ via an `if (quantity > 1)` guard. Now unconditional.

### Encounter Tools

- **Auto-pause on encounter hit** — when a random encounter check rolls a hit, the game now auto-pauses so the GM can prep before the encounter materializes. New world setting `Pause Game on Encounter Hit` (default on) for GMs who prefer to pause manually.

## v1.11.0

Community contributor release — first external PR lands, major design pass across the whole module, and the documentation is now release-ready.

### Merchant Shop Enhancements

Sell-back inventory sync bug fixed, and merchant configurations can now be saved as named presets. Thanks to [@Terra-Luna](https://github.com/Terra-Luna) for the contribution (PR #1).

- **Sell-back inventory sync** — when a player sold an item back to the merchant, the merchant's inventory was not restocking. Fixed: `_restockMerchantInventory` now re-adds the item to the shop's inventory (compendium mode) or the NPC's item collection (actor mode), with duplicate-detection on UUID or name+type.
- **Merchant preset save / load / delete** — save the current shop configuration (name, mode, inventory, buy multiplier, sell ratio, gamble options) as a named preset. Load it later from the dropdown. Delete presets you no longer need. Presets persist in the `savedShopConfigs` world setting.
- **Buy multiplier** — the sell ratio used to be the only configurable ratio. Now there's a separate buy multiplier (10–500%, default 100) alongside it. The underlying `shopSellRatio` setting refactored from a scalar to `{ sellRatio, buyMultiplier }` so presets capture both. Existing world data is preserved; fresh installs get the composite shape.
- **Full-inventory socket broadcast on sales** — non-GM clients now receive the entire post-transaction inventory rather than a single-item stock delta, eliminating stale-state rendering when multiple transactions fire in rapid succession.
- **Defensive deep-clone pass** — seven settings-read sites across the merchant app now wrap `game.settings.get(...)` in `foundry.utils.deepClone()` before mutating, following the CLAUDE.md pattern. Prevents in-memory cache corruption if a subsequent `set()` fails.

### Session Recap Visual Overhaul

The Overview tab was an anti-pattern: a SaaS-style dashboard of three stat cards (Session Duration / Combats / Enemies Defeated) that read like a Linear sprint view rather than a dungeon-crawl debrief. Replaced with a BG3-style chapter-framed session summary.

- **Chapter header** — status kicker ("IN PROGRESS" / "ARCHIVED") → large session title (auto-generated `2026.04.17 Session` for live, preserved name for history) → muted stat strip (duration · combats · defeated, middot-separated) → gradient gold rule. Reads as a session record, not a KPI widget.
- **Party record cards** — Player Summary rows were a flex-row of icon+number chips; now each player is a compact record card with their name as a heading and four labeled stats (Kills, Dealt, Taken, XP) in a grid. Auto-wraps at narrow widths via `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`.
- **Typographic hierarchy** — section titles (`.sr-section-title`) now carry an ornamental gold-dim bar prefix instead of dashboard-style uppercase letter-spacing. The `.sr-stats-table` column headers switched from uppercase+muted-gray to bold+accent-gold with an accent border-bottom — grimoire-style column markers rather than SaaS subtext.
- **Specificity fix** — the legacy `.sr-section h4 { text-transform: uppercase; ... }` base rule was silently overriding class-based styling due to higher specificity. Removed; all section headings are now class-based with explicit, predictable cascade.
- **`!recap` command** — chat command was already wired; session-recap module now picks up `sessionDisplayName`, `sessionStatusLabel`, and a pre-composed `sessionStats` array in the template context for cleaner render logic.

### Merchant Shop UI Cleanup

The Manage tab had a five-color button row (blue Load / red Delete / green Open / red Close / purple Save) — a classic rainbow-UI anti-pattern that didn't match the rest of the module's muted gold-on-charcoal palette.

- **Unified Manage-tab buttons** — all five buttons (Open Shop / Close Shop / Save / Load / Delete) now adopt the neutral `.vcb-btn` aesthetic used throughout the Crawl Bar. Icons + labels carry the semantic meaning. Delete keeps a subtle red border+text on hover as the only color callout (destructive-action convention).
- **Buy / Sell / Apply buttons** — were ghost-outline style (~15% opacity fill, thin border, colored text) and read as tags rather than primary CTAs. Now solid gradient fills matching `.forge-btn`: Buy green, Sell gold, Apply green. Dark text with subtle shadow, uppercase+letter-spacing CTA chrome, hover glow, 1px press transform.
- **Save button width fix** — the Save button in the broadcast row was rendering narrower than Open/Close because `.vcm-save-config-btn` lacked `flex: 1`. Now sized consistently.

### Accessibility Pass

Addresses WCAG AA compliance gaps and five P1 findings from a design audit.

- **Contrast fix** — `--vcb-text-muted` changed from `#666` (3.9:1 on `--vcb-bg`) to `#767676` (4.5:1). Meets WCAG AA for normal-weight text across ~30 usages throughout the module.
- **Reduced motion** — added global `@media (prefers-reduced-motion: reduce)` guard collapsing all transitions and animations to 0.01ms for users with vestibular sensitivity. Honors OS-level accessibility preferences.
- **Keyboard access to combat actions** — the NPC action panel (weapons / spells / actions / abilities) previously used plain `<div>`s with click handlers. Now native `<button>` elements, keyboard-accessible by default, with a CSS reset to preserve the existing visual styling.
- **Hover-only buttons reachable** — the Activate-turn and Remove-member buttons on Crawl Strip cards were `display: none` / `color: transparent` until mouse hover, unreachable via keyboard. Remove now visible at 18% opacity by default; Activate shows on `:focus-within` of its card wrap.
- **Focus-visible rings** — previously scoped only to Monster Creator and Encounter Roller; now applies to every module surface (Crawl Bar, Crawl Strip, Light Tracker, Spell Dialog, action panels, every `vagabond-crawler-*` ApplicationV2 window).

### Responsive & Touch Support

Tablet-companion play (iPad + Foundry web client at 1024×768) is a real slice of the Foundry user base. Three P1 findings addressed.

- **44px touch targets on primary controls** — the existing `@media (pointer: coarse)` block now covers `.vcb-btn`, `.vcs-cbtn`, `.vcs-ptab`, `.vcs-atab`, `.vlt-douse`, `.vcb-clock-menu-item` with a 44px minimum height (WCAG 2.5.5 / Apple HIG). Mouse users see no change.
- **CrawlStrip overflow handling** — a 5+ member party at ~900px was overflowing a 768px viewport with right-edge cards unreachable. `.vcs-inner` now has `max-width: 100vw` and `overflow-x: auto`; scrollbar appears only when content overflows.
- **Window default widths** — five ApplicationV2 windows (Animation FX Config, Light Sources Config, Loot Manager, Party Inventory, Relic Forge) defaulted to 900–960px, eating most of a 1024px viewport. Reduced to 820px. All five are `resizable: true`; wider screens can drag larger; Foundry preserves saved per-user positions.

### Theme System Expansion

The Relic Forge, Merchant Shop, Loot Manager, Party Inventory, and Monster Mutator sections were built with hardcoded hex values (~130 raw hex + ~60 raw rgba) bypassing the CSS custom property system entirely. Light theme was effectively broken across all five sections.

- **Tokenized 4 major sections** — ~260 hex references replaced with `var(--vcb-*)` calls. Matching light-theme overrides added for everything that needed them.
- **6 alias tokens** — `--vcb-text-primary`, `-secondary`, `-faint`, `--vcb-border-light`, `--vcb-bg-card`, `--vcb-input-hover`, `--vcb-tl-bg1` were referenced throughout the code as `var(token, #fallback)` but never actually defined. Now defined as aliases pointing at existing theme-aware tokens so the fallback never fires.
- **13 new semantic tokens** — `--vcb-action-buy` / `-buy-dim` / `-sell` / `-sell-dim` / `-save` / `-load` / `-ext-discord` / `-price-gold` / `-price-gold-hi` / `-forge-bg-1` / `-forge-bg-2` / `-mutator-bg` / `-bg-deep`, each with dark and light theme values.
- **HP gradient light-mode overrides** — `--vcb-hp-ok` / `-mid` / `-low` / `-critical` previously had no `body.theme-light` counterparts (only `--vcb-hp-dead` did). Added deeper-saturated variants for light theme.
- **Design context file** — new `.impeccable.md` at the repo root captures the five design principles (legibility over mood, phase semantics are sacred, atmosphere in the chrome, dark-is-the-pilot, WCAG AA + reduced motion), the BG3 / Pathfinder / Darkest Dungeon reference corpus, and anti-reference patterns. Plugin skills read this automatically. CLAUDE.md gets a summary section pointing at it.

### Performance

- **`transition: all` → explicit property lists** — 10 rules (forge-btn, category-tab, drop-zone, mutate-item, vcm-tab-btn, vcm-sell-all-junk, vcm-drop-zone, vcm-catalog-buy-btn, vcm-gamble-btn, power-card) now use explicit `transition: background, color, border-color, box-shadow` lists at their original durations. Eliminates browser overhead of watching every animatable property; no visual change.

### Documentation Overhaul

The repository documentation is now release-ready for the Foundry registry.

- **Dual-track structure** — GM-facing guide at top-level `docs/` (5 files: `crawl-loop.md`, `combat.md`, `exploration.md`, `crafting-loot.md`, `session-tracking.md`, plus the existing `player-quickref.md`). Contributor / technical reference moved to `docs/dev/` (the previous top-level reference files: `crawl-system.md`, `combat-tools.md`, `exploration-tools.md`, `utilities.md`).
- **10 headliner sections + 1 mini-headliner** — Crawl Strip, Encounter System, Monster Creator, Light Tracker, Loot Generator, Relic Forge, Spell Scroll Forge, Merchant Shop, Session Recap, plus NPC Abilities mini-headliner, each ~600–900 words following a consistent template (What it does / How to use / Settings / Tips & Gotchas) with embedded gif placeholders for the next release cycle.
- **13 stubs** — smaller features (Crawl Clock, Rest & Breather, Flanking, Countdown Dice, Morale, Animation FX, Chat Dice Tooltips, Trap Builder, Inventory System, Party Inventory, Item Drops, XP Counter, Rollback Movement) get tight 80–150 word entries.
- **README as landing page** — trimmed from 321 lines to 90 lines. Headline features grid with cross-links into the guide, install instructions, requirements, authors.
- **CLAUDE.md updated** — new Documentation section describing the dual-track structure; new Design Context summary pointing at `.impeccable.md`.
- **Stale content removed** — `docs/alchemist-cookbook.md` (the alchemy subsystem moved to the Character Enhancer module in an earlier release). `alchemistCookbook` setting row removed from the moved `docs/dev/utilities.md`.

## v1.10.0

### Animation FX System

Centralized animation configuration for weapon, alchemical, gear, and NPC action effects. Absorbs and extends the standalone `vagabond-item-fx` module. One place to tune; no more per-item sheet editing.

- **Unified config window** — ApplicationV2 with tabs for Weapons, Skill Fallbacks, Alchemical, Gear, NPC Actions, and Settings. Opens from the **Forge & Loot → Animation FX** button on the CrawlBar.
- **Curated defaults** — 50 weapons (imported from the `Weapon Animations.xlsx` preset library) with JB2A Melee/Ranged file paths and psfx sound pairings, 25 alchemical entries, 3 gear entries, 7 NPC action starters.
- **Hit + Miss blocks** — every preset supports separate file/scale/duration/sound for hit and miss outcomes.
- **Three animation types per preset** — `onToken` for swings/impacts, `projectile` for bolts/arrows (distance-aware Y-scale matching the system's `_beamEffect`), `cone` for breath weapons. Smart-default type detection when creating new NPC action presets.
- **Per-item + per-action overrides** — "Animation FX" header button on weapon/alchemical/gear item sheets and a ⚡ button next to each NPC action row. Writes to `flags.vagabond-crawler.animationOverride` or `actionOverrides[index]`.
- **Sync to Items** — one-click push of the crawler's matched preset data into each world weapon's `system.itemFx`, so the Vagabond system's built-in animation pipeline plays everything at the right size. ~49 weapons across ~18 actors synced per click.
- **Testing tools** — Test All in Tab (sequentially previews every preset with a 2.5s gap), Clear All FX (ends every lingering crawler-owned Sequencer effect on the scene).
- **Resolver chain** — per-item override flag → name-pattern regex (weapons/npcActions) or key-substring match (alchemical/gear) → weapon-skill fallback → `_default` → null. NPC actions always treated as hit (they don't roll to hit).
- **Retired the cone patch** in `npc-abilities.mjs`. All three animation types now flow through the unified playback.
- **Defensive transient cleanup** — every non-persistent effect is named and force-ended at duration + fade + 200ms buffer, preventing runaway lingering webms.
- **Master FX toggles** — per-client enable / global scale (0.25–3.0) / sound enable / master volume; world-scoped `triggerOn` = always | hit.

### Light Sources Configuration

Per-light-source Foundry light property editor.

- **Right-click** the CrawlBar **Lights** button to open the config window.
- Editable per-source (all 12 types — torch, hooded lantern, bullseye lantern, 4 candle variants, sunrod, 4 torch variants):
  - Dim / Bright radius, Emission Angle
  - Light Color (color picker) + Color Intensity
  - Priority + Is Darkness Source
  - Animation Type (sourced from `CONFIG.Canvas.lightAnimations` at runtime), Speed, Intensity, Reverse Direction
  - Longevity (seconds), Consumable flag
- **Test on Token** button — applies the config to a selected token's light so you can preview before saving.
- **Reset This Source** / **Reset All** with confirm.
- Hardcoded defaults become the initial world setting; `_getLightDef()` merges stored overrides on top, so `match` and `fuel` regex stay in code while Foundry light properties live in settings.

### Light-Tracker / Animation FX Integration

`_lightItem` / `_douseLight` / `_burnOut` / `_doPickup` now call `AnimationFx.startPersistent()` and `.stopPersistent()` on light transitions, so lighting a torch via the tracker also plays the flame webm (and extinguishing ends it). Both methods are idempotent — no accidental toggle-off on double-call.

### XP Counter Patch

Monkey-patches the base system's Level Up dialog so the XP questionnaire uses unlimited numeric counters instead of simple on/off checkboxes.

- **Left-click** a question to increment its count (1, 2, 3, ...)
- **Right-click** to decrement (minimum 0)
- Counter badge replaces checkbox; per-question subtotals shown when count > 1
- XP awarded = count x XP per question
- No changes to the base system files — purely a runtime patch

### Session Recap

New tabbed window that tracks combat stats, loot, XP, and roll stats across an entire session. Replaces the old Loot Log with a full session overview.

- **Overview tab** — Session duration, total combats, enemies defeated, per-player summary (kills, damage dealt/taken, XP)
- **Combat tab** — Per-encounter breakdown with collapsible sections (rounds, duration, enemy list with kill credit), per-player stats table (hit rate, nat 20s/1s, avg d20, saves, damage, kills). Damage and kill tracking requires the Damage Log module (recommended dependency).
- **Loot tab** — Same reverse-chronological loot view as before, now embedded in the recap window
- **XP tab** — Per-player XP award breakdown with question counts and totals
- **History tab** — View, export, and delete saved sessions
- **Copy for Discord** — Exports the full session recap as plain markdown
- **`!recap` chat command** — Opens the recap window for any user (not just the GM)

### Session Lifecycle

Managed session lifecycle tied to crawl start/stop.

- **Crawl start popup** — "Start New Session" / "Continue Session" (if paused) / "No Tracking"
- **Crawl end popup** — "End & Save" / "Pause Session" / "Discard"
- Sessions auto-named by date (e.g. `2026.04.16 Session`) with dedup suffix for multiple sessions per day
- Unlimited saved session history — view any past session read-only with full Discord export
- Auto-capture (combat, rolls, damage) only runs when a session is active

### Loot Tracker Absorption

The standalone Loot Log window has been replaced by the Session Recap's Loot tab. All existing loot logging API calls (`LootTracker.log`, `logClaim`, `logPickup`) continue to work — the LootTracker is now a thin facade over SessionRecap. Existing loot data is automatically migrated on first load.

## v1.9.1

### Bug Fixes

- **Rest & Breather dialog — Cancel fires Breather.** Clicking Cancel on the GM Rest menu was silently running the Breather action and posting a rest summary to chat. The dialog helper rewrites a `null` button value into the button's label-derived action (`"cancel"`), so our else-branch was catching it. Fix: match `"rest"` and `"breather"` explicitly, so Cancel / X / Escape all no-op.
- **Merchant Shop — compendium browser cut off at 50 entries.** Adding from the `vagabond.gear` compendium silently truncated at "Brewing tools" because the browser hard-capped results at 50. Raised to 500, which comfortably covers every Vagabond compendium.
- **Merchant Shop — search bar lost focus after each keystroke.** Typing into any of the three search inputs (Buy, Catalog, Compendium) triggered a full `this.render()` that rebuilt the DOM and killed the input's focus. New `renderKeepingFocus()` helper saves `selectionStart`, re-renders, then re-focuses the input and restores the caret position.
- **Relic Forge — armor / weapon enchantments applied without equipping.** Forged effects used `transfer: true` which copies the effect onto the actor as soon as the item is owned, regardless of equipment state. A +1 Armor relic was granting its bonus while sitting in the backpack. Fix: effects are created with `disabled: !item.system.equipped` and tagged with an `equipGated` flag. A new `updateItem` hook re-syncs every equip-gated effect's `disabled` state when the item's `equipped` toggles — the bonus lights up on equip, goes dark on unequip. Verified against a real `vagabond.armor` item: `armorBonus` went `0 → 1 → 0` across equip/unequip cycles.

### New Feature — Relic Forge Base Item Browser

Drag-and-drop still works, but you can now also search-and-click. Beneath the drop zone (hidden once a base item is loaded) is a compact compendium browser:

- Search input with live in-place filtering — no re-render per keystroke
- Pulls from `vagabond.weapons`, `vagabond.armor`, and `vagabond.gear`
- Each row shows icon · name · pack kind (Weapon / Armor / Gear)
- Click any row to load it as the base item

## v1.9.0

### Encounter Roller + Monster Creator — Consolidation

Major restructure: the Mutate tab is gone, the Monster Creator now lives inside the Encounter Roller as a fourth tab (**Build Table · Browse NPCs · Roll Tables · Monster Creator**). One window, one workflow. The right-click "Monster Creator" entry on the Encounter button has been removed since the Roller tab is now the primary entry point.

The Creator panel mounts its full UI inside the tab and shares the same instance across tab switches — state persists when you tab away and come back.

### Monster Creator — Stats

- **Armor Description** is now a dropdown with all 24 canonical Vagabond armor descriptors from the Core Rulebook (Unarmored → (+3) Plate plus Shield), each showing its armor value. Custom text from previously-saved actors is preserved as a one-off option.
- **Senses** is now a tight checkbox grid — boolean on/off per sense, infinite range by default. Darksight, Blindsight, Seismicsense, Allsight, Lightsight, Blindsense, Echolocation, plus a free-text "Other / Custom" field.
- **Token Vision** moved inside the Senses section. Vision Enabled is on by default. Mode (Basic / Darkvision / Tremorsense / Monochromatic / Light Amplification / Blindness) + Range only. Basic forces range 0; blank range on any non-basic mode = infinite (∞). Angle control removed.
- **Numeric fields** (HD, Armor, Morale, Speed, Appearing) have visible ▴▾ stepper buttons that increment by the input's `step` attribute — 1 for HD/Armor/Morale, 5 for Speed.
- **Tighter layout** — narrow flex-basis on numeric fields so Armor Description doesn't stretch to fill empty space.
- **Senses + Other Movement Modes** are collapsible sub-sections inside Stats.
- **Font size bumped 25%** inside the Monster Creator panel — everything reads more comfortably.

### Monster Creator — Actions

- **[+ New Action]** button creates a blank action from scratch and auto-expands it.
- **[+ From Template ▾]** popup with all 20 curated templates, grouped by attack type (Melee / Ranged / Cast Close / Cast Ranged). Compact left-aligned rows: name + damage preview, no tier dropdowns. Materializes with sensible defaults that you tweak in the expanded card.
- **Two-column action card grid** inside each `<details>` — Name · Type · Damage · Recharge · Weapon · Note · Extra all label-input aligned.
- **Weapon picker** per action, sourced from `vagabond.weapons` (53 weapons). Auto-populates name, roll damage, damage type, attack type. Reversible — picking "— No weapon —" restores previous values from a snapshot.
- **On-Hit Effects** (`causedStatuses`) + **Crit On-Hit Effects** (`critCausedStatuses`) editors. Status dropdown (Vagabond statuses only — Patrol's "Undetectable" filtered out), save type (Any / Reflex / Endure / Will / None), duration, Permanent toggle, If Hit (`requiresDamage`), Tick damage + damage type.
- **Permanent toggle fixed**: checking clears duration; unchecking restores a `d4` default. Typing any duration value clears the Permanent checkbox automatically.
- **Per-action card open state** persists across re-renders so editing doesn't collapse the card you're working on.

### Monster Creator — Abilities

Merged with the audit dataset (`docs/audit/abilities.json`) — **~180 unique abilities** across every compendium monster, plus the 20 curated Quick Picks with tiers.

- **Search box** filters the list in-place (no re-render per keystroke).
- **Filter tabs**: All · Automated ✓ · Not Automated ⚠ · Flavor — combine with search.
- **Info-per-line** layout: badge + name + short description + tier picker (if applicable) + `[+ Add]`.
- **"Used by N monsters" badge** per row. Hover for the full description and the list of monsters that use the ability.
- **Audit-sourced abilities** are addable like curated ones; they materialize with the representative text from the audit dataset as the description.

### Encounter Roller — Build Table

- **2d6 and 2d8** added to the die-type selector alongside d4/d6/d8/d10/d12. Slot counts and indices auto-adjust to the formula's range (e.g. 2d6 → 11 slots numbered 2..12).

### Encounter Roller — Browse NPCs

- **Sortable HP and Average DPR columns** added next to TL. Click any header to sort asc/desc.
- **Table fills the tab's vertical space** instead of leaving a large blank gap.

### Accessibility

- **Focus-visible ring** — every interactive surface shows a 2px gold outline when reached by keyboard (`:focus-visible` only, no ring on mouse click).
- **Tab bar roles** — `role="tablist"` + `role="tab"` + `aria-selected` + `tabindex` on every Encounter Roller tab.
- **Icon-only buttons** have `aria-label` attributes (stepper arrows, add-ability +, delete ×, remove-effect ×).
- **Label/input association** via `for`/`id` on the Stats section's separate label/input pairs.
- **Container queries + touch-target breakpoint** — at `< 520px` the 2-col action grid collapses to single-column; under `(pointer: coarse)` every interactive element is at least 32px tall.

### Theming

- **Dark-mode accent fixed** — was pure white (`#ffffff`, blank-canvas AI aesthetic). Now a tabletop gold (`#c9a54a`) that complements the rest of the ramp.
- **Active tab contrast** — was gold text on gold gradient (unreadable). Now near-black (`#1a1511`) text on gold for ~10:1 contrast.

### Bug fixes

- **Tokenizer fallback image** — passing empty avatar/token filenames triggered Tokenizer's broken fallback path (`/icons/mystery-man.png`, 404). Now always passes a valid `icons/svg/mystery-man.svg` so the Tokenizer UI opens cleanly.
- **Encounter Result panel** no longer appears at the bottom of the Monster Creator tab; it's scoped to the encounter-rolling tabs only.
- **Embedded Monster Creator scroll** — the `.mc-scrollable` body correctly overflows inside the Roller tab now that the height chain is bounded (form → tabpanel → panel host → mc-container).
- **`.mc-hint` color override** in the template popup — was inheriting the button's primary color, making damage previews unreadable.

## v1.8.12

### New Features — Monster Creator Action Editor Polish

Added the three features that were missing from the Monster Creator's Actions editor compared to the native Vagabond NPC character sheet:

- **Weapon picker dropdown** — each action card has a Weapon selector populated from the `vagabond.weapons` compendium (53 weapons). Picking a weapon auto-populates the action's name, roll damage (from `damageOneHand`), damage type, and attack type (melee/ranged inferred from `weaponSkill` / `range`). The original name and damage are snapshotted; picking "— No weapon —" restores them so an accidental link doesn't destroy the existing formula. `weaponId` and the previous-value snapshot persist through save/reload so a reopened actor keeps the linked weapon selected.
- **On-Hit Effects editor** (`causedStatuses`) — per-action rider rows with Status (full Vagabond status vocabulary), Save type (Any / Reflex / Endure / Will / None), Duration (free-form; e.g. `d4`, `Cd6`), and checkboxes for **Permanent** (clears duration), **If Hit** (`requiresDamage`), and **Tick** (enables `damageOnTick` + damage-type fields for DoT effects).
- **Crit On-Hit Effects editor** (`critCausedStatuses`) — same shape as on-hit, for rider effects that only apply on a crit.

### UX

- **Per-action collapsible cards** — each action is now its own `<details>` card with a summary line (name · attack type · damage · recharge · rider counts `🪱` / `💥`). The card's open state is tracked per-index and preserved across re-renders, so adding a rider or picking a weapon doesn't collapse the card you're editing.
- **Live summary updates** — typing in an action's name/damage/recharge fields updates the collapsed summary line in-place without re-rendering (preserves focus and the caret position for arrow-key numeric edits).
- **Rider round-trip** — loading a compendium monster preserves its existing `causedStatuses` and `critCausedStatuses` arrays verbatim. Saving writes them back in the same shape the native NPC sheet reads. Verified against the Lich's "4 - Death Touch" (Paralyzed / Endure / d6) and "5 - Fear" (Frightened / Any / d4).

## v1.8.11

### Bug Fixes
- **Monster Creator collapsibles no longer auto-close on interaction** — Every `<details>` section in the Creator now persists its open/closed state across re-renders. Previously, any action that triggered a full re-render (adding an action Quick Pick, switching Quick Pick tabs, picking a mutation, toggling the Infinite vision checkbox) would reset every section back to the template default, collapsing whatever the user had open. Now sections only reset explicitly:
  - **On fresh start**: Identity + Stats are open, everything else closed.
  - **On Load from Bestiary** / **Edit-in-Creator handoff**: everything closed, compact summary view.
  - Every other user interaction preserves exactly the sections the user had open.

## v1.8.10

### New Features — Monster Creator Token Vision

New collapsible **Token Vision** section in the Monster Creator. Controls the saved actor's `prototypeToken.sight` so placed tokens get the right vision settings without manual editing.

- **Vision Enabled** checkbox
- **Range** number input + "Infinite (∞)" checkbox (saves as `null` when infinite — Foundry renders this as ∞ in the token HUD)
- **Angle** (degrees, default 360)
- **Mode** — Basic Vision / Darkvision / Tremorsense / Monochromatic / Light Amplification / Blindness
- **Auto-populate from Senses** button — reads the narrative Senses field and fills the vision fields heuristically. Also runs automatically on bestiary load so compendium monsters inherit sensible vision settings the first time around (the compendium's own `prototypeToken.sight` is `enabled: false, range: 0, mode: basic` for every monster — this audit finding is what motivated the feature).

Heuristic:

| Senses text | → | Enabled | Mode | Range |
|---|---|---|---|---|
| (empty) | | false | basic | 0 |
| Darksight / Darkvision | | true | darkvision | 60 (or explicit "X ft") |
| Allsight / All-Sight / Truesight | | true | basic | ∞ |
| Blindsight | | true | basic | 30 |
| Blindsense / Echolocation | | true | basic | 15 |
| Seismicsense / Tremorsense | | true | tremorsense | 30 |

If the Senses text includes an explicit range like "Darksight 60'" or "Seismicsense 120 feet" the number is picked up instead of the default.

Verified round-trip: loading Goblin Mage (Darksight) → auto-sets Darkvision 60ft, 360°. Saving creates a world actor whose `prototypeToken.sight` matches, and tokens placed from it inherit vision correctly.

## v1.8.9

### New Features — Monster Creator Phase 5

#### Tokenizer integration
- When the `vtta-tokenizer` module is installed + active, a new **"Tokenize…"** button appears in the Monster Creator's Identity section next to the Portrait and Token pickers.
- Clicking it launches Tokenizer with the current portrait/token as starting points (plus the current monster name), lets the user crop / stack / upload, and writes **both the portrait and token paths** back to the form on save.
- If Tokenizer isn't active, the button is hidden — no error, no visual noise. Standard file-picker fallbacks remain fully functional.
- Integration is single-button because Tokenizer itself generates both images in one pass; two separate buttons would be confusing.

## v1.8.8

### New Features — Monster Creator Phase 4

#### Mutations Panel inside the Creator
- New collapsible "Mutations" section with a full browser of all 64 mutations from `mutation-data.mjs`, grouped by high-level tab: **All / Form / Attack / Special**
- Per-mutation card shows name, `boon`/`bane` badge, and TL delta
- **Conflict detection** — picking one mutation from a conflict family (e.g. `hp-bloated`) disables the conflicting siblings (e.g. `hp-massive`) with a grayed-out card so the user can't create invalid combinations
- **Roll Random** — picks one eligible boon plus its suggested bane (falls back to any eligible bane)
- **Live preview** — while mutations are selected, shows `HP 13→22 · Armor 2→2 · TL 2.1→2.3` delta in the collapsed header and a detailed 6-row breakdown (HP, armor, speed, TL, ability count, action count) inside the expanded panel
- **Apply Selected** — bakes the chosen mutations into the current form, clears the selection, and generates the mutated name (e.g. "Bloated Ironhide Goblin, Warrior"). Prefix/suffix dedupe ensures stacking the same mutation family twice doesn't produce "Bloated Bloated Goblin, Warrior"
- Stackable — apply multiple rounds of mutations sequentially, each building on the previous state

#### Edit-in-Creator handoff from the Encounter Roller's Mutate tab
- New **"Edit in Creator"** button in the existing Mutate tab alongside "Create Monster"
- Clicking it clones the selected base monster, applies the chosen mutations (including any prefix/suffix name changes), and opens the Monster Creator pre-filled with the resulting stats
- No world actor is created at this point — the user reviews and saves from the Creator's own footer. Lets the GM mutate-then-refine in a single workflow.

### Implementation Notes
- Mutations panel reuses `applyMutations` + `generateMutatedName` from `monster-mutator.mjs` as the canonical mutation logic
- `_dataToActorShape` / `_actorShapeToData` helpers convert between the Creator's form state and the raw actor-shape objects the mutation logic expects, so the Creator stays decoupled from actor documents
- `MonsterCreator.openWithData(actorObject)` entry point added for external callers that want to seed the Creator with a pre-computed actor shape (used by the Edit-in-Creator handoff)

## v1.8.7

### New Features

#### Monster Creator (Phases 1-3)
New GM tool for authoring NPC monsters: a dedicated ApplicationV2 window accessible from the **Encounter bar's right-click menu → Monster Creator**. Produces a valid Vagabond `npc` actor in the world — the compendium is never touched.

**Form layout** — every section is a collapsible `<details>` element with a live summary in the header. On fresh start Identity + Stats are open; after loading from bestiary everything collapses so the full monster fits in a 720-tall window.

- **Load from Bestiary** — collapsible filter panel with search, being-type, TL-range (0-1, 1-3, 3-5, 5-8, 8+), and source (Bestiary / Humanlike / VCE). Click any of the 328+ rows to pre-fill the form.
- **Identity** — name, being type, size, zone, Portrait picker, Token picker (separate images so sheet vs token can differ).
- **Stats** — HD, armor, armor description, morale, walk speed, appearing, senses, and a **Movement Modes** grid for climb / cling / fly / phase / swim with per-mode speed inputs.
- **Damage Immunities / Weaknesses / Status Immunities** — three collapsible checkbox grids (15 / 17 / 19 options). Each collapsed header shows a count pill + the first four selected values.
- **Actions editor** — 20 curated Quick-Pick templates grouped by attack type (Melee / Ranged / Cast Close / Cast Ranged). Tiered templates (Claw has Light / Medium / Heavy; Bite has Small / Medium / Heavy / Boss; Breath Attack has Small / Medium / Heavy) get a tier dropdown inside the card. Per-action edit surface for name, attack type, damage roll, flat bonus, damage type, recharge, note, extra info. Delete button per row. Live DPR fed to the footer preview.
- **Abilities editor** — 20 curated Quick-Pick templates with **automation status badges**: green ✓ Automated when the ability name matches `scripts/npc-abilities.mjs PASSIVE_ABILITIES`, orange ⚠ Not automated for known-mechanical abilities without automation, gray 📖 Flavor for narrative-only entries. Tiered (Magic Ward I–VI, Terror I–III, Regenerate I–III) and variant (Pack: Instincts / Tactics / Hunter) pickers built in. Badges update live as you rename abilities — automation-match drives the badge so users immediately see whether their chosen name will trigger existing automation.
- **Description** (collapsible textarea).
- **Footer** — live `HP · TL · DPR` preview + Cancel + Create World Actor buttons. Pinned to the bottom; the form body scrolls.

**Smart authoring UX:**
- Arrow-key number inputs work naturally — field edits update state and summaries in place without full re-renders, so focus stays on the input.
- Live summary preview updates on every edit: Identity shows `"Lich · Undead · Medium · Frontline"`, Stats shows `"HD 11 · Armor 4 · 20ft · + fly · Morale 8"`, Actions/Abilities show counts + first few values.
- Picking Quick-Pick tiers generates the canonical compendium names (`"Magic Ward III"`, `"Pack Hunter"`) so automation fires on the resulting world actor with zero manual reconciliation.

**Templates extracted from the standalone HTML Monster Creator tool** (`F:\Vagabond\vagabond-monster-creator.html`) — 60+ action templates collapsed into 20 curated entries with power tiers, ability tiers (Magic Ward I–VI instead of four separate entries, etc.), and variant selectors.

**Files added:**
- `scripts/monster-creator/monster-creator-app.mjs` — ApplicationV2 class
- `scripts/monster-creator/action-templates.mjs` — 20 curated action Quick Picks
- `scripts/monster-creator/ability-templates.mjs` — 20 curated ability Quick Picks
- `templates/monster-creator.hbs` — form template

### Changes
- `scripts/npc-abilities.mjs` now exports `PASSIVE_ABILITIES` so the Monster Creator can read the live automation table for its badges. No behavior change for existing users.

## v1.8.6

### New Features

#### NPC Movement — speed tracker, mode-aware icons, rollback
The movement system now treats NPCs as first-class citizens and understands monsters with multiple movement modes (fly, swim, climb, phase, cling).

- **NPC movement pill on the crawl strip** — NPC cards display a movement budget pill during combat (e.g. `🕊 30/30ft` for a flying Bat). Follows the existing "Hide NPC Health Bar from Players" setting — when HP is hidden, movement is too. GMs always see it.
- **Effective movement speed** — a new shared helper (`combat-helpers.mjs: getEffectiveMovement`) picks the fastest available movement mode per token, reading both formats of NPC speed data (`speedTypes: ["fly 80"]` inline, or `speedTypes: ["fly"]` + `speedValues.fly: 60`). A Bat (walk 5 / fly 30) now gets a 30ft budget, a Stolas Demon (walk 40 / fly 160) gets 160ft, a Hydra (walk 25 only) gets 25ft.
- **GM movement-mode override** — GMs can set `token.document.movementAction` from the token HUD (walk / fly / swim / climb / phase / cling) to force a specific mode. The override wins over the fastest-mode default, so a Bat explicitly walking shows 5ft and a walk icon.
- **Mode-aware pill icons** — walk (`🚶`), fly (`🕊`), swim (`🏊`), climb (`🤲`), phase (`👻`), cling (`🕷`). Pill updates live as `movementAction` changes.
- **NPC rollback** — the movement rollback button now appears on NPC tokens in the token HUD for the GM during GM phase or combat (same UX as the existing PC rollback during Heroes phase / combat). Rolls the token back to its turn-start position and refunds the full movement budget.
- **Tracker + display use the same effective speed** — previously the display and the enforcement would disagree for flyers. Now they agree: the ruler stops a flying Bat at 30ft, not 5ft.

### Fixes
- **Active effects row on the strip** — now shows only status-condition effects (effects with a non-empty `statuses` set), not every non-disabled effect. Hides passive buffs / module-managed helper effects from the icon strip, keeping the visual focus on conditions that matter tactically.

## v1.8.5

### New Features
- **Ability automation — 4 new / fixed abilities (82 monsters affected).**
  - **Magic Ward I–VI** — Fixed. Old behavior injected a `1d4`/`1d6`/`1d8` penalty die into the caster's d20 Cast Check. The compendium text actually says *"the Caster must spend an extra N Mana to affect it"* — a cost, not a roll penalty, and only on the first affecting spell per Round per warded being. New implementation adds the surcharge to `_calculateSpellCost.totalCost` so the cost preview, mana-available validation, and castingMax validation all see the inflated cost. If the caster lacks enough Mana for spell + surcharge, the cast is blocked outright (no roll). On success, each warded target is flagged as triggered for the current round and won't re-charge that caster (or any caster) that round. Flags reset on round advance and combat end. Applies to both the character sheet cast path and the crawl-strip spell dialog. Ward levels IV–VI (previously unimplemented silently) now work. 44 monsters.
  - **Nimble** — Implemented. *"Attacks against it can't be Favored if it can Move."* When any targeted actor has Nimble and is not Incapacitated / Paralyzed / Restrained / Unconscious, any computed `favor` on the attacker's d20 is clamped to `none`. Applies to both weapon attacks and spell cast checks. Clamps only `favor`; `hinder` and `none` pass through unchanged. The roll-builder wrap is now registered in a `setup` hook (not `ready`) so it runs innermost relative to `vagabond-character-enhancer`'s own roll-builder wrap — critical for flanked-vs-flanked targeting where VCE re-combines favor via `_rangeFavorHinder`. 15 monsters.
  - **Pack Hunter** — Implemented. *"Targets within 5 feet of one of this Being's Allies are Vulnerable to its attacks."* Shares the narrow `packInstincts` mechanic: transient Active Effect sets `outgoingSavesModifier: hinder` on the attacker (mirrored to world actor for unlinked tokens) so the defender's saves are Hindered. Does **not** grant favor on incoming attacks — Pack Hunter "Vulnerable to its attacks" is narrower than full Vulnerable. 15 monsters.
  - **Soft Underbelly** — Implemented. *"Its Armor is 0 while it is Prone."* When a Prone active effect is created on a being with Soft Underbelly, a transient module-owned effect applies `system.armor: 0` (OVERRIDE); when Prone is removed, the override is removed. `VagabondDamageHelper.calculateFinalDamage` reads `actor.system.armor` directly, so damage math is correct for every damage-resolution path. World-load catch-up hook covers pre-existing state. 5 monsters (Ankheg, Bulette, Carcass Crawler, Giant Fire Beetle, Giant Tiger Beetle).

### Fixes
- **`scripts/mutation-data.mjs`** — Magic Ward I and II mutation descriptions were wrong (claimed "Favored on saves against spells" and "Takes half damage from non-magical attacks" respectively). Corrected to match the compendium Mana-cost text so all three sources of truth (compendium, automation, mutation UI) agree.

### Audit Database
- Regenerated `docs/audit/*` — Magic Ward I–VI, Nimble, Pack Hunter, Pack Tactics, Pack Instincts, and Soft Underbelly now show `automationStatus: implemented`. Total findings drop from 426 to 397 (all 3 previous errors resolved).
- Added `docs/audit/automation-candidates.md` — prioritized triage of the 84 unimplemented abilities by feasibility tier (A–D), with shared-framework clusters identified for future ability-automation PRs.

## v1.8.4

### New Features
- **Hide NPC Health Bar from Players** — New world setting in module config. When enabled, players no longer see HP bars or HP values on NPC/GM cards in the crawl strip. The GM still sees them. Defaults off.
- **Monster Audit Database** — Dev/maintenance dataset covering every NPC across `vagabond.bestiary`, `vagabond.humanlike`, and `vagabond-character-enhancer.vce-beasts` (348 actors total). Ships as committed JSON under `docs/audit/` plus readable Markdown renderings (`abilities.md`, `actions.md`, `INDEX.md`, `by-type/*.md`). Includes 178 unique abilities with automation status and 245 unique actions with attack/damage breakdowns. Surfaces 426 findings for dead ability text and data inconsistencies — including a broken Magic Ward implementation (compendium says `+N Mana` cost; `scripts/npc-abilities.mjs` injects a `1d4/1d6/1d8` roll penalty instead; affects 35 monsters) and 9 monsters using Magic Ward IV/V/VI which are entirely unimplemented. Regenerates via `scripts/audit/*` (extract → analyze → render). No runtime behavior change.

### Changes
- **Relic Forge always enabled** — Removed the `relicForgeEnabled` setting. The Relic Forge is now always available; it remains GM-only at open.

## v1.8.3

### Bug Fixes
- **Crawl menu stuck after combat** — Fixed the crawl bar becoming unresponsive when ending an encounter and clicking "No" on the "Resume crawl mode?" prompt. Previously the bar stayed in a paused state with non-functional buttons because `game.combat` was already deleted. Now clicking "No" cleanly ends the crawl, and clicking "Yes" resumes it as before.

## v1.8.2

### Bug Fixes
- **Familiar & Summon action cast checks** — When a player clicks an action on a summoned creature or familiar in the CrawlStrip dropdown, the roll now routes through VCE's Arcana/Mysticism cast check (matching the character sheet behavior). Previously the action fired directly without the required check. Requires vagabond-character-enhancer v0.2.8+. Falls back to the plain NPC action handler when VCE is not installed or the summon/familiar cannot be matched to a caster.

## v1.8.1

### Bug Fixes
- **Gold Sink integration** — Added missing CrawlStrip action menu integration for the Merchant class Gold Sink feature (vagabond-character-enhancer). Favorited shop items now appear as a tab in the CrawlStrip action panel for Merchant characters, with prices and quick-buy. This code was present locally but was never committed to the release.

## v1.8.0

### New Features

#### Merchant Shop
- **Full buy/sell system** — GM stocks items from compendium packs or designates an NPC actor as a merchant. Players buy items (money deducted, item added to inventory) and sell items (item removed, money added at configurable sell ratio).
- **Catalog tab** — Browse 484 items across Gear, Weapons, Armor, and Alchemical Items compendium packs with search, pack/folder filters, and sort by name or value. GM can toggle catalog visibility per shop.
- **Gamble tab** — Players pay a flat gold fee to roll on loot tables. GM configures gamble options with custom names, table sources (built-in Loot Levels 1-10 or any world RollTable), and custom prices.
- **Buy markup/discount** — GM sets a percentage multiplier (10-500%) per shop. 100% = normal, 150% = shady markup, 80% = friendly discount. Applies to Buy and Catalog tab prices.
- **GM-controlled broadcast** — GM opens shop privately to configure, then clicks "Open Shop for All Players" to broadcast. Window title shows Open/Closed status.
- **Junk marking** — Right-click equipment on character sheet to "Mark as Junk." Junk items sort to top of Sell tab with red indicator. "Sell All Junk" button sells all marked items at once.
- **Transaction log** — All buy/sell/gamble transactions logged per player with Discord markdown export.
- **Session Summary** — Combined export merging loot tracker + merchant logs, grouped by player with per-player totals.
- **Item preview** — Single-click item rows to expand inline description. Double-click to open the full item sheet.

#### Party Inventory
- **New window** showing all player characters' inventories side by side in columns. Shows equipped status (green border), junk markers (red border), slot counts, wallet, and item values. Filters to characters with friendly tokens on the active scene.

#### Loot Generator — Relic Active Effects
Loot-generated relic items now have **functional Active Effects** that apply when equipped. Uses the same power definitions as the Relic Forge.

**Working AE powers (50 powers with direct system field changes):**
- **Weapon +1/+2/+3** — `system.universalWeaponDamageBonus` (+1/+2/+3 weapon damage)
- **Armor +1/+2/+3** — `system.armorBonus` (+1/+2/+3 armor)
- **Protection +1/+2/+3** — `system.saves.reflex/endure/will.bonus` (+1/+2/+3 to all saves)
- **Trinket +1/+2/+3** — `system.universalSpellDamageBonus` (+1/+2/+3 spell damage)
- **Strike I/II/III** — `system.universalWeaponDamageDice` (+1d4/+1d6/+1d8 bonus damage die)
- **Swiftness I/II/III** — `system.speed.bonus` (+5/+10/+15 speed)
- **Climbing** — `system.movement.climb` (grants Climb)
- **Clinging** — `system.movement.cling` (grants Cling)
- **Flying** — `system.movement.fly` (grants Fly)
- **Levitation** — `system.movement.levitate` (grants Levitate)
- **Blinking** — `system.movement.blink` (grants Blink teleport)
- **Waterwalk** — `system.movement.waterwalk` (walk on water)
- **Webwalk** — `system.movement.webwalk` (move through webs)
- **Displacement** — `system.defenderStatusModifiers.attackersAreBlinded` (attackers treated as blinded)
- **Nightvision** — `system.senses.darksight` (grants Darksight)
- **Echolocation** — `system.senses.echolocation` (grants Echolocation)
- **Tremors** — `system.senses.tremorsense` (grants Seismicsense)
- **Detection** — `system.senses.detection` (detect Being types)
- **Sense Life** — `system.senses.senseLife` (sense living creatures)
- **Sense Valuables** — `system.senses.senseValuables` (sense gold/gems)
- **Telepathy** — `system.senses.telepathy` (grants Telepathy)
- **True-Seeing** — `system.senses.allsight` (see through illusions)
- **Bravery** — `system.favorOnSaveVs.frightened` (Favor on Frightened saves)
- **Clarity** — `system.favorOnSaveVs.confused` (Favor on Confused saves)
- **Repulsing** — `system.favorOnSaveVs.charmed` (Favor on Charmed saves)
- **Ambassador** — `system.speakAllLanguages` (understand all languages)
- **Aqua Lung** — `system.breatheUnderwater` (breathe underwater)
- **Burning I/II/III** — `system.onHitBurningDice` (Burning status on hit, Cd4/Cd6/Cd8)
- **Warning** — `system.cannotBeSurprised` (cannot be surprised)
- **Invisibility II** — `system.defenderStatusModifiers.attackersAreBlinded` (permanent invisibility)
- **Cursed: Vulnerability -1/-2/-3** — `system.armorBonus` (-1/-2/-3 armor penalty)
- **Cursed: Weakness -1/-2/-3** — `system.universalWeaponDamageBonus` (-1/-2/-3 damage penalty)
- **Cursed: Anger** — `system.autoFailSaveVs.berserk` (auto-fail Berserk saves)
- **Cursed: Cowardice** — `system.autoFailSaveVs.frightened` (auto-fail Frightened saves)
- **Cursed: Gullibility** — `system.autoFailSaveVs.charmed` (auto-fail Charmed saves)
- **Cursed: Doom** — `system.healingCappedPerDie` (healing capped at 1 per die)

**Flag-based powers (39 powers — AE flags stored for runtime handling by relic-effects.mjs):**
- **Jumping I/II/III** — `jumpMultiplier` flag (x2/x3/x4 jump distance)
- **Elemental Resistance** (Acid/Cold/Fire/Poison/Shock) — `damageResistance` flag (half damage)
- **Darkness I/II/III** — `lightType`/`lightRange` flags (darken light)
- **Moonlight I/II/III** — `lightType`/`lightRange` flags (shed moonlight)
- **Radiant I/II/III** — `lightType`/`lightRange` flags (shed sunlight)
- **Lifesteal I/II/III** — `onKillHealDice` flag (heal on kill)
- **Manasteal I/II/III** — `onKillManaDice` flag (restore mana on kill)
- **After-Image I/II** — `usesPerDay` flag (illusory duplicate)
- **Invisibility I** — flag-only (skip Move to become invisible)
- **Blasting** — `blastDamage`/`usesPerDay` flags (6d6 blast, 1/day)
- **Precision** — `usesPerDay` flag (auto-hit, 1/day)
- **Benediction** — flag-only (revive on death, 1/week)
- **Soul Eater** — flag-only (killed creatures can't be resurrected)
- **Vicious** — flag-only (extra crit damage)
- **Vorpal** — flag-only (behead on crit)
- **Infinite** — flag-only (endless mundane item supply)
- **Loyalty** — flag-only (weapon returns when thrown)
- **Ace** — adds weapon property (Brutal/Cleave/Keen/etc.)

**Not yet implemented (require GM adjudication):**
- **Bane** (Niche/Specific/General) — `baneTarget`/`baneDice` flags stored but bonus damage requires manual tracking of target creature type during combat
- **Protection vs creature type** (Niche/Specific/General) — `wardTarget` flags stored but Favor on saves vs specific creatures requires runtime creature-type matching

#### Loot Generator — Item Generation Overhaul
- **Treasure chain** produces real items: gems (Uncommon/Rare/Very Rare with blue/red/green gem icons), trade goods (gold/silver/copper ingots, common/exotic/rare spices), art objects (tapestry, painting, figurine, bust, pottery, artifact), jewelry (amulet, ring, bracelet, pendant, circlet, etc.), clothing (belt, boots, cloak, etc.)
- **Spell Scrolls** generated as actual usable scroll items via the Scroll Forge pattern with random spells, proper flag data, and spell icons
- **Relic power values** from the core book added to weapon/armor `baseCost` — a Longsword +2 now correctly shows as 1250g 40s instead of just 40s
- **Enchantment Scrolls and Accessories** handled as proper items with correct sub-table rolls
- **Trinkets** always resolve to a compendium item
- **Reroll/Add meta-powers** properly implemented — higher-level rolls that hit "Reroll as d8, twice" or "Add d10 to this roll" entries now produce actual relic powers instead of empty results
- **Niche powers** pull NPC names from last combat or random world NPC instead of "Unknown Foe"
- **Chat cards** use system `vagabond-chat-card-v2` styling with parchment background, proper fonts, and black text
- **Item values** displayed in both the Loot Generator UI and chat cards, summed across all items per roll

### Bug Fixes
- **Currency math** — Fixed conversion rates: 100 copper = 1 silver, 100 silver = 1 gold (was incorrectly 10:1)
- **Compendium matching** — Curly apostrophe normalization for items like "Crone's Ire", "Alchemist's Fire"
- **Typo fixes** — "Tendertwig" → "Tindertwig", "Oil, Annointing" → "Oil, Anointing"
- **Stale UUIDs** — Poison Basic and Potion Healing I had truncated compendium UUIDs, with name-based fallback
- **Empty loot rolls eliminated** — Every roll path now produces items or currency
- **Resistance potion names** — "Potion, Resistance (Cold)" → "Potion, Cold Resistance" to match compendium
- **Weapon/Trinket +N naming** — Power entries now correctly say "Weapon/Trinket" per source spreadsheet
- **Missing Movement entry** — Added Jumping 3 (entry 14) to Movement table
- **Movement overflow** — d8+6 rolling 14 now correctly gives Jumping 3 instead of clamping
- **Resistance rerolls** — "reroll 4s" and "reroll 1-3s" instructions now implemented with correct clamping
- **Accessory sub-table** — Now properly rolls d4: 1-2 = Jewelry, 3-4 = Clothing per spreadsheet instructions
- **Relic power pricing** — Fixed case-insensitive matching, "Bane," comma prefix, "Protection vs" prefix
- **Pixie Dust** — Fixed compendium price from 10s to 10g
- **Golden Needle** — Fixed compendium price from 50s to 50g
- **Sell tab** — Removed filter that hid items with 0 sell value, all equipment now shows
- **Font sizes** — Increased across merchant shop and loot generator UI for readability
- **Session summary** — Fixed case mismatch (`LootTracker` vs `lootTracker`) that excluded loot claims
- **Give buttons** — Both chat card and in-app "Give" buttons now log to LootTracker

## v1.7.0

### Bug Fixes
- **Favor/Hinder 1-for-1 cancellation** — Multiple sources of Favor and Hinder now properly cancel 1-for-1 per the Vagabond rules. Previously, the system used sequential state-machine logic that collapsed same-direction sources (e.g. Prone + Vulnerable both granting Favor on incoming attacks counted as only 1 Favor instead of 2). Now each Active Effect is counted as a separate source, so a Flanked attacker (1 Hinder) attacking a Prone + Flanked target (2 Favor) correctly resolves to Favored.
- **Save rolls count AE sources** — Saves against unlinked token attacks now read the token actor's Active Effects instead of the world actor, which was missing combat-specific statuses like Prone and Vulnerable (Flanked).

### System Changes (vagabond system)
- Added `resolveMultipleFavorHinder()`, `countFavorHinderFromEffects()`, and `getFavorHinderSources()` to `VagabondRollBuilder` for counting-based Favor/Hinder resolution.
- Weapon attacks, spell casts, saves, stat checks, and initiative rolls all use the new counting logic.
- Save rolls now prefer the token actor over the world actor when resolving the attacker's outgoing modifiers.

## v1.6.4

### Bug Fixes
- **Release packaging** — Include `icons/` directory in module.zip (fixes missing shamrock.svg, dragon-head.svg, light-sabers.svg on fresh installs and updates).

## v1.6.3

### Bug Fixes
- **State sync isolation** — Deep clone socket state in `CrawlState.applySync` to prevent shared references across clients.
- **Scroll Forge chat** — `ChatMessage.create` now properly awaited so failures are caught.
- **Item drop permissions** — Use `CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER` instead of magic number.
- **Movement tracker leak** — Clear pending deduction when a move is blocked, preventing stale entries.
- **Loot pass mutation** — Deep clone items when moving to the unclaimed pool to prevent shared references.
- **Relic Forge mutation** — Deep clone power objects to prevent mutation of source definitions.
- **Light tracker interval** — Guard against rapid right-click creating leaked polling intervals.
- **Encounter roll bias** — Fix `Math.ceil(Math.random() * 6)` returning 0 in distance/reaction rolls.
- **Compendium encounter tables** — Use `fromUuid`/`fromUuidSync` so compendium RollTables work when set as the active encounter table (previously only world tables were found).
- **Table overwrite safety** — Update existing encounter tables in-place instead of delete-then-create, preventing data loss if creation fails.
- **Silent formula errors** — All encounter formula catch blocks now log warnings instead of swallowing errors silently.
- **Deprecated API** — Use `ActiveEffect#img` instead of deprecated `#icon` in crawl strip (eliminates v12 deprecation warning).

### Code Quality
- **Listener leak prevention** — All 7 ApplicationV2 windows now use AbortController to clean up event listeners on re-render, preventing accumulation over long sessions.
- **Shared distance utility** — Extracted duplicated `distanceFt()` from flanking-checker and npc-abilities into `combat-helpers.mjs`.
- **Browse NPC optimization** — Eliminated redundant double-fetch of compendium NPCs in encounter roller browse tab.
- **Null guards** — Added guards for crawl strip RAF callback and `game.user.targets` iteration in NPC abilities.
- **Dead code removal** — Removed orphaned alchemy-cookbook.mjs, alchemy-helpers.mjs, and alchemy-cookbook.hbs (~2,300 lines) — functionality moved to vagabond-character-enhancer.

## v1.6.2

### Bug Fixes
- **Loot claim chat message crash** — Fixed `sourceName` used before declaration (temporal dead zone) and undefined `parts` variable in `_handleTakeAll`, which caused a ReferenceError when claiming loot from a bag.

### Code Quality
- **Crawl bar menu helpers** — Extracted shared `_positionMenu`, `_attachDismiss`, and `_dismiss` helpers, replacing ~50 lines of duplicated menu positioning and click-away dismiss logic across three menu/panel builders.
- **Terrain difficulty early exit** — Movement cost calculation now exits early once max difficulty (3×) is found, skipping unnecessary region checks.

## v1.6.1

### New Features
- **Disposition-based hero/NPC split** — Crawl strip now sorts members by token disposition (Friendly vs Hostile) instead of actor type. Friendly NPC summons appear on the Heroes side.
- **NPC action menus on friendly NPCs** — Friendly NPC summons on the Heroes side now show Actions/Abilities tabs during combat.
- **Party token movement tracking** — Party-type actors (summon groups, vehicles) have their speed/crawl speed read correctly and movement enforced on the crawl strip.
- **Rollback Movement for players** — Players can now use the Rollback Movement button on their Token HUD. Relays to GM via socket.
- **Party token light support** — Lights work when characters are gathered into a party token. Lighting/dousing/burnout transfers to the party token automatically.

### Bug Fixes
- **Movement reset on phase change** — Movement budgets now reset on every phase transition (Heroes→GM and GM→Heroes), not just on new crawl turns.
- **Movement reset for unlinked tokens** — `resetAll` now finds the canvas token actor for unlinked tokens instead of the world actor, fixing stale movement flags.
- **Burnout party fallback** — Light burnout and refuel correctly apply/remove light from the party token when the character has no tokens on canvas.

### Docs
- **README.md** — Complete rewrite covering all features through v1.6.1.
- **CLAUDE.md** — Updated file map (32 files), added patterns for world/token actor handling, disposition-based sorting, party speed, skipStack, player socket relay, v13 render hooks.

## v1.6.0

### New Features
- **Forge & Loot Panel** — Left-clicking the "Forge & Loot" button now opens a tool picker panel with all five tools: Relic Forge, Scroll Forge, Loot Manager, Loot Log, and Loot Generator. Right-click still opens the settings menu.

### Bug Fixes
- **Dropped item pickup permissions** — Dropped items, loot bags, and dropped light sources now have Owner permission for all players, allowing them to interact with the Token HUD pickup button.
- **Lit torch stacking** — Lit light sources no longer auto-merge into unlit stacks when picked up. Fixes the infinite torch exploit where picking up a lit torch stacked it with unlit torches, leaving the ground token intact.
- **Light/item pickup cleanup** — Pickup operations now use `skipStack` to bypass the auto-merge hook, ensuring the dropped token and temporary actor are always cleaned up.

## v1.5.0

### New Features
- **Alchemical Torches** — Tindertwig (never burns out), Sentry (pale blue, suspends invisibility), Repel Beast (crimson), Frigidflame (ice blue). Each has distinct light color and animation.
- **Alchemical Candles** — Calming (soft blue), Insectbane (green), Restful (warm amber). All function as 5ft bright / 10ft dim light sources with 1-hour burn time.
- **Sunrod** — 15ft bright / 30ft dim with golden sunburst animation. Consumable, 1-hour duration.
- **Candle, Basic** — "Candle" and "Candle, Basic" now both match the candle light source.

### Bug Fixes
- **Flanking Vulnerable saves** — Players now correctly get Favor on saves against Vulnerable (flanked) monsters. The save system reads the attacker from the world actor, but flanking applied the effect to the synthetic token actor. Fixed by mirroring the `outgoingSavesModifier` to the world actor for unlinked tokens.
- **Flanking cleanup** — Combat-end cleanup now covers both world actors and synthetic token actors on the current scene.

## v1.4.0

### New Features
- **Spell Scroll Forge** — GM tool to create consumable Spell Scrolls. Pick a spell from the compendium, configure delivery type, damage dice, and effects. Scrolls cast the stored spell with no mana cost and no Cast Check, then vaporize. Value auto-calculated at 5g + 5g per mana equivalent. Accessible via "Forge & Loot" → "Open Scroll Forge" on the crawl bar.
- **Scroll Casting** — Right-click a spell scroll in inventory → "Use Scroll" to cast. Plays spell FX, rolls damage, posts chat card, and consumes the scroll.
- **Inventory Slot Rules** — Zero-slot items (scrolls, rations, candles, etc.) now follow the "10 per slot" rule: every 10 units of the same gear category occupy 1 inventory slot. Different scroll spells pool together under the "Scrolls" category. Stacked normal items correctly multiply slots by quantity.
- **Weightless Flag** — New "Weightless (no slot cost)" checkbox on zero-slot item sheets. Flagged items are truly zero-slot and never count toward inventory (e.g. backpacks, trinkets, quest items).

### Improvements
- Scroll Forge added to the "Forge & Loot" context menu on the crawl bar.
- Auto-stack system bypassed during light source splitting (prevents torches merging back into stacks).

## v1.3.0

### New Features
- **Countdown Dice Auto-Roller** — Automatically rolls all countdown dice at the start of each combat round. Applies tick damage (burning, poison, etc.), shrinks dice on a roll of 1, and cleans up all dice when combat ends. Toggleable via world setting.
- **Inventory Stacking** — Dragging a duplicate item onto a character auto-merges it by incrementing quantity instead of creating a separate item. Inventory cards show a ×N quantity badge. The Slots display correctly accounts for stacked item quantities.
- **Lantern Fuel System** — Hooded and Bullseye lanterns now consume Oil (flask or basic) as fuel. Oil is only consumed when the lantern has no burn time remaining. Lanterns auto-refuel from inventory when oil runs out. Prefers Oil, flask over Oil, Basic.
- **Lantern Light Profiles** — Hooded Lantern: 90° directional cone (15ft bright / 30ft dim). Bullseye Lantern: 30ft bright / 60ft dim (full radius).
- **Light Source Splitting** — Lighting a stacked torch (qty > 1) splits off one torch as a separate item and lights it, leaving the stack intact.

### Bug Fixes
- **Item Sequencer Cone Patch** — Workaround for system item-sequencer not supporting cone animations (e.g. Breath Attack). Temporary patch until system adds native support.
- **Selfless Trigger Fix** (character-enhancer) — Selfless no longer triggers on attack cards, only on actual damage application messages.

## v1.2.0

### New Features
- **Pack Instincts / Pack Tactics** — NPC passive ability automation. When an NPC with Pack Instincts attacks a target, and an ally of that NPC is adjacent to the target, saves against the attack are Hindered. Works from both the crawl strip action menu and the actor sheet. Effect auto-cleans on turn change.
- **Terrain Difficulty** — Movement tracker now queries Scene Region "Modify Movement Cost" behaviors. Tokens moving through difficult terrain have their movement cost multiplied accordingly.
- **Enforce Combat Movement setting** — New world setting to toggle movement enforcement during combat independently from crawl movement enforcement.

### Improvements
- Movement distance is now computed once per token move instead of twice (deduplication).
- Terrain difficulty function accepts elevation as a parameter instead of performing a canvas token lookup.

## v1.1.0
- Alchemist Cookbook, NPC abilities (Magic Ward), flanking checker, combat strip enhancements.
