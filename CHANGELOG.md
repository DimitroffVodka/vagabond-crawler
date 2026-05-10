# Changelog

## v1.17.0

### Loot Drops — Chat-card flow replaces canvas loot bags

- **Defeated NPCs now whisper a per-player chat card** instead of spawning a "Loot: <NPC>" actor + token on the canvas. Each PC owner + GM gets a card with `[Claim Loot] [Pass Loot]` buttons; state lives in `ChatMessage` flags so it survives reload, world export, and zero orphan documents.
- **Pass Loot emits a public pool card** that the first player to click can claim. Race-protected via flag `claimedBy` null-check on the GM-side socket handler.
- **Removed entirely:** `Token._onClickLeft2` core patch, the `renderTokenHUD` injection, the `Dialog.wait` modal. Cleaner UX, no canvas litter, no walking-to-pickup ceremony.
- **Recap integration preserved 1:1** — `LootTracker.logClaim()` still fires from both Claim and Pool-Claim paths, so loot history feeds Session Recap as before.

### Loot Generator — Unified card style + dice trace across all 3 flows

- **All three loot flows now look identical:** Roll Loot ("Post to Chat"), Roll for Selected Token, and the new Loot Drops cards share the same `vagabond-chat-card-v2` outer + `vcl-gen-claim-item` rows + `[Claim Loot] [Pass Loot]` button row.
- **Dice trace shown on every card.** `generateLevelLoot` was instrumented with a `_R(formula, label)` roller that records every roll (~30 sites across levels 1-10), returns `{ currency, items, trace }`. New shared `renderTraceHtml(trace)` helper renders the monospace `→ Label (formula=total)` block consistently.
- **Roll Loot's GM "Give to: [Player]" inline buttons replaced** with a Claim popup that picks a recipient via DialogV2 dropdown. Pass emits the same public pool card as Loot Drops.

### Browse NPCs — Multi-select chip filters + at-a-glance icon columns

- **Four new chip-style multi-select filters:** Senses, Weaknesses, Immunities, and Abilities (with search box for the 170+ ability list). Click chips to toggle; OR within each group, AND across groups.
- **"Has Cast Attacks" checkbox toggle** matches NPCs with any action whose `attackType` is `castClose` or `castRanged` — actual schema, not name fuzz.
- **4 new compact icon columns** in the NPC table: **Atk** (⚔ melee / 🏹 ranged / ✨ cast counts), **Sns** / **Wk** / **Imm** (FontAwesome glyphs, color-coded blue/red/gold) with hover tooltips. Senses normalized — case/whitespace duplicates collapsed, parenthetical annotations dropped for the dropdown but kept on the actor.
- **Browse table font bumped 0.85rem → 1.13rem (+33%)**, token icons 12 → 16px to match.

### V14 Compatibility & Fixes

- **Real-Time Light Burn (Shadowdark rules):** Setting now correctly toggles the burn engine on change — previously the onChange handler destructured `LightTracker` (PascalCase) off `game.vagabondCrawler` but the singleton lives at `lightTracker` (camelCase), causing silent no-op. Turn changes (Hero ↔ GM) skip the per-turn 10-min torch deduction when realtime is ON; torches burn solely on the real-time tick. Progress clock + session timer still advance per turn.
- **Lit-item delete cleanup.** Deleting a lit torch from inventory now clears the token's light + persistent FX (`preDeleteItem` hook gated on `game.user.id === userId`). Previously left phantom glow on the token until you also deleted the token.
- **Heroes auto-join Combat Tracker** when the GM right-clicks an NPC to toggle combat state, instead of waiting for explicit "Begin Encounter". Drops the `combat.started` gate; reentrancy lock + tokenId dedup already prevent the duplicate-combatant race the gate was guarding against.
- **Animation FX ⚡ button visible inline** in the V14 weapon item header. V14 ApplicationV2 collapses "extra" header controls under the ⋮ Toggle Controls dropdown by default, hiding the registered control. Mirrored the NPC-action-row injection pattern on `renderVagabondItemSheet` so the override dialog stays one click away.
- **Loot Manager UX fixes.** `.loot-npc-panel`'s `max-height: 460px` hard cap and `.browse-list-fill`'s `min-height: 480px` floor both removed — the NPC list now actually fills the resized window. `.loot-apply-btn` given inline-flex layout + `white-space: nowrap` so the "Apply to Selected" button stops wrapping.
- **"The Merchant is Closed" chat card** no longer truncates its descriptor — moved the "no longer available" text out of a meta-tag into a centered card-description block to match the "open" card structure.

### Module manifest

- **Optional dependency renamed:** `vagabond-extras` → `vagabond-character-enhancer` in `module.json`, `CLAUDE.md`, and historical-attribution comments in `encounter-tools` / `morale-checker` / `rest-breather`.
- **Compatibility verified bumped** to V14.361 alongside V13 minimum.

## v1.16.8

### Animation FX — single owner for weapon / alchemical / gear FX

- **The chat-message hook is now the sole trigger for weapon FX.** `AnimationFx._onChatMessage` previously bailed on weapons (`if (item.system?.equipmentType === "weapon") return;`) on the assumption that the system's `VagabondItemSequencer.play` would handle them — but that call only fires from the sheet path, so attacks via TAH, ECH, macros, and the NPC action menu had no FX at all. The bail-out is gone; the chat hook resolves and plays for every weapon attack regardless of UI path.
- **NPC action menu no longer double-fires FX.** With the chat hook now weapon-aware, the explicit `VagabondItemSequencer.play(...)` call inside `_fireAction`'s weapon branch (`scripts/npc-action-menu.mjs`) was redundant — every NPC-menu weapon attack played its hit/miss animation twice (once from the explicit call, once from the chat hook). Dropped the explicit call; the chat hook handles it once. Verified live: `Sequence.prototype.play` invocation count drops from 2 to 1 for the same attack flow.
- **Permanent GM warning when known double-fire sources are also active.** `_warnIfSystemFxConflict` runs once at `ready` and posts a notification listing each detected conflict — the system's `vagabond.useItemAnimations` setting (sheet-click double-fire) and the standalone `vagabond-item-fx` module (chat-hook double-fire on every UI path). Names the offender, includes a working `game.settings.set` snippet for the system case, and tells the GM to disable both. Plurality grammar (`is` vs `are`) flips correctly when both are detected.

### Light Sources — preview a config on a token before saving

- **New "Test on Token" workflow.** The Light Sources Configuration window can now overlay a working config onto the selected token in real time — adjust dim/bright/color/animation, click Test on Token, see the result on the canvas without saving. A "Stop Test" button (and auto-cleanup on window close) restores the original light. The pre-test light data is snapshotted to a `lightTestSnapshot` flag on the token document so restoration is exact even after canvas refresh.
- **Cross-scene-aware cleanup.** Tested tokens are tracked as `"<sceneId>:<tokenId>"` keys and resolved via `game.scenes.get(sceneId).tokens.get(tokenId)` at restore time. Testing a token on Scene A then navigating to Scene B before closing the window now still restores Scene A's token cleanly. Previous tracking (token-id only, resolved through `canvas.tokens` which is current-scene scoped) silently leaked the test light when the GM swapped scenes mid-test.
- **Silent close path.** Closing the config window without ever clicking Test no longer pops a stray "No active light test to stop." notification — the toast is reserved for the explicit Stop Test button, where it acts as user feedback. The success-path "Restored light on N token(s)." toast is unchanged.

### Smoke Test Runner — live-runtime test framework at `scripts/test/`

- **Tests run inside Foundry against synthetic actors.** `await game.vagabondCrawler.test.run()` from the GM console exercises every registered suite. Each case spins up cloned actors / tokens, hits the real hook chain + wrap stack + document lifecycle, then auto-cleans. Surfaces the bugs unit tests miss — hook ordering, socket desync, stale state across linked/unlinked tokens.
- **Lazy-loaded — zero overhead at session ready.** Test code never imports until `run()` or `sweep()` is called, so production sessions stay clean. `sweep()` deletes orphan fixtures left behind by an interrupted run.
- **12 suites covering animation-fx (happy + adversarial), crawl-state, crawl-strip, exploration-tools, flanking-countdown, light-tracker, loot-spell-scroll, merchant-recap, movement-tracker, npc-abilities, relic-effects.** See `CLAUDE.md` § Smoke Test Runner for the harness API and gotchas.

## v1.16.7

### Relic Forge — Universal-bonus relics no longer leak across other equipped weapons

- **The bug.** Relic powers like Weapon +1, Trinket +1, Strike I/II/III, Cursed Weakness, and Bane were forged as Active Effects with `transfer: true` and Crawler's homemade `disabled: !equipped` gate. The AE changes target actor-level "universal" fields (`system.universalWeaponDamageBonus`, `system.universalWeaponDamageDice`, `system.universalSpellDamageBonus`), so wearing a Striking +1 Dagger and a regular dagger meant the regular dagger also rolled `+1d4 + 1` damage. The bonus followed the actor, not the weapon. The same leak existed for spell foci and weapon-bane interactions.
- **The fix — system-native applicationMode.** The Vagabond system already implements full scoping via `flags.vagabond.applicationMode = 'permanent' | 'when-equipped' | 'on-use'`. The actor's effect pass filters `'on-use'` AEs out entirely; instead the system applies them as a temporary roll-data overlay (`actor.getRollDataWithItemEffects(item)`) only for rolls **from that specific item**. The Forge now writes the right mode onto every relic AE, and Crawler's homemade equip-gating + `_syncRelicEffectsForItem` hook are gone.
- **Per-power audit.** Switched to `'on-use'` so the bonus only fires for that weapon's rolls: `bonus-weapon-1/2/3` (+1/+2/+3), `bonus-trinket-1/2/3` (Spell +N), `cursed-weakness-1/2/3`, `strike-1/2/3` (Striking dice), `bane-niche/specific/general`, `utility-burning-1/2/3`, `utility-lifesteal-1/2/3`, `utility-manasteal-1/2/3`, `utility-invisibility-1`. Kept as `'when-equipped'` (correctly actor-wide while worn): all Armor +/-, Protection (saves), Movement (speed/fly/climb/etc.), Senses (darksight/truesight/etc.), Resistances, cursed auto-fail-saves, `utility-ambassador`, `utility-aqua-lung`, `utility-holding`, `utility-warning`, `utility-invisibility-2`, `movement-displacement`, jumping, light-emitting / store-spell / loyalty / infinite. Already `'on-use'`: all Fabled (Blasting / Precision / Vicious / Vorpal / Wish-Granting), After-Image I/II.
- **Strike I/II/III re-shaped to flag-based.** The system's roll-data overlay does numeric ADD on rollData fields, which mangles dice strings (`Number('1d4') = NaN` → corrupted `"NaN"` in the formula). Strike now drops its AE `changes` and rides on a `bonusDamageDice` + `bonusDamageLabel` flag pair; the existing damage-helper monkey-patch (the same one Bane and Vicious use) reads the flag at damage-roll time and injects the dice into `button.dataset.damageFormula`. Weapon-scoped without going through the broken overlay.
- **Auto-migration.** A one-time GM-side pass (gated by setting `relicAppModeMigrationV2`) walks every owned and world-level forged item, stamps `flags.vagabond.applicationMode` on each relic AE from the catalog, drops `disabled: false` (system handles gating now), and re-shapes any pre-existing Strike I/II/III AEs (drops `changes`, adds the flag pair). Posts a one-line `ui.notifications.info` summarizing how many effects on how many items were migrated. Pre-existing customizations on AEs (custom application modes, hand-edited fields) are preserved unless they conflict with the catalog.
- **Verified live.** Forged a "+1 Dagger" (`bonus-weapon-1`) and a "Striking Dagger" (`strike-1`) on the same actor, both equipped. The actor's `system.universalWeaponDamageBonus` reads `0` and `system.universalWeaponDamageDice` reads `""` — no leak. Rolling damage from the +1 Dagger gets `+1` only; rolling from the Striking Dagger gets the `1d4` injected by the damage-helper patch only. Bane regression-tested: still flag-driven, still per-target.

## v1.16.6

### Crawl Strip — Teleport-region scene transitions actually work now

- **v1.16.5's rebind missed Foundry's real teleport flow.** The previous fix searched all scenes for a surviving token of the same actor, but skipped any token whose id matched the deleted one — that filter was meant to avoid re-finding the deleted document, but Foundry's `RegionDocument.teleportToken` deliberately uses `keepId: true` so the new destination token has the same id as the source. Result: every party member who walked through a stair / portal region got kicked off the strip, even though their replacement token already existed on the destination scene with a matching `actorId`.
- **Drop the same-id filter** — by the time the `deleteToken` hook fires, the source token has been removed from its scene's collection, so a token with the same id on a different scene is guaranteed to be the keepId replacement, not the original. The rebind now finds it.
- **Honor `opts.replacements`** — Foundry passes a `{ oldId → newUuid }` map on the delete options for teleport-style flows. The handler reads this directly via `fromUuidSync` for an exact, robust rebind without scanning. The all-scenes search remains as the fallback for non-teleport flows.

## v1.16.5

### Crawl Strip — Splitting the party between scenes no longer kicks members

- **The strip rebinds to a surviving token instead of kicking blindly.** The `deleteToken` cleanup at `crawl-strip.mjs` used to drop the matching member as soon as one specific tokenId was deleted, with no awareness of whether the same actor had another live token elsewhere. Sending the party from Scene A to Scene B (the typical "delete on A, create on B" workflow that most party-move macros use) deleted the Scene A tokens and silently kicked the heroes off the strip — even when their replacement tokens already existed on Scene B. The cleanup now searches all scenes for another token of the same `actorId`. If one exists, the member's `tokenId` / `id` / `name` / `img` rebind to it. Only when the actor has no surviving token anywhere does the member get kicked, preserving the original summon-despawn / orphan-cleanup behavior.
- **Short defer to handle delete-then-recreate flows.** The handler waits 250ms before deciding so that the replacement token has time to land for macros that delete first and create second. If another path (`deleteCombatant`, manual remove) already dropped the member during the wait, the rebind is skipped — no double-kick.
- **Duplicate handling.** If a surviving token is found but another member already tracks it, the orphan member falls through to the kick path (no merge, no id collision).

## v1.16.4

### Movement — Overloaded characters can no longer Rush in combat

- **The "you can't take the Rush action" warning is now enforced.** v1.16.3 made the warning visible for stacked-item overload, but the movement tracker still let overloaded tokens move into Rush territory (up to 2× base speed). It now caps an overloaded character's combat movement at base speed — any move past base is blocked with `"<name>: overloaded — can't Rush. Only Xft remaining."` The token ruler waypoint label also flips from `Rush: -Xft` to `OVER: -Xft (overloaded — no Rush)` so the constraint is visible while planning the move.
- **Overload check uses Crawler's stack-aware slot math.** The system's `inventory.occupiedSlots` ignores stacks (counts each item as `baseSlots × 1`), so a character at "12 / 12" with a 2-stack of slot-1 items is *actually* 13 / 12. Both the inventory banner (v1.16.3) and the new movement gate now share `isOverloaded()` / `getExtraOccupiedSlots()` helpers so the displayed warning and the enforced rule never disagree. NPCs are unaffected — the rule applies only to character actors.
- **Tied to the existing "Enforce Combat Movement" setting** — no new toggle. If you have combat enforcement off, the overload-no-Rush rule is skipped along with the rest.

## v1.16.3

### Inventory — Overload state now reflects stacked-item slot count

- **Stacked items inflated the displayed slot count, but the overload warning never fired.** `_patchInventory` correctly added per-stack slot weight to the slot total (so a stack of 5 torches showed as 5 slots, not 1), but the system's `.overloaded` class and the red `inventory-overload-warning` banner are gated by Handlebars on the system's own `occupiedSlots` calc — which counts each item as `baseSlots × 1` and ignores stacking. Sheets read e.g. `12 / 10` with no visual warning. The slot-field now re-evaluates against the adjusted total, toggling `.overloaded` and injecting / updating the banner inside `.inventory-grid-container` so overload state matches the displayed count.

## v1.16.2

### Session Recap — Bug fixes and merchant tracking

- **Last combat no longer dropped from the recap.** Previously, ending a session while a combat was still open in the tracker (or having the crawl-end flow auto-delete the combat after `sessionState` flipped inactive) silently dropped that combat from the recap — the Apr 30 session lost the Orichalcum Golem fight to this race. The recap now snapshots enemy roster + round count on `combatStart` / `updateCombat`, and `endAndSave` / `pauseSession` flush every entry still in `_activeCombats` before changing state. The `deleteCombat` handler also no longer guards on `sessionState`, so late-deletes still log when the combat was tracked from start.
- **XP question breakdown is no longer lost.** The XP Counter Patch's `awardXP` handler reset `this.questions` to zeros *before* building the recap snapshot, so every XP entry showed `_(breakdown not recorded)_`. Snapshot is now taken before the reset; per-question lines (e.g. `Defeated a Boss — ×2 = 2 XP`) appear in the recap as intended.
- **Combat enemy list no longer fragments comma-named bestiary entries.** Names like `"Bat, Giant"` or `"Centipede, Giant"` collided with the `, ` join separator in the Combat section's enemy and defeated lines, so a single Giant Bat rendered as two enemies (`Bat`, `Giant`). Switched the inter-enemy separator to ` · ` (middle dot) — matches the convention already used for encounter checks. Killer attribution inside the parentheses still uses commas (no ambiguity inside grouping marks).

### Session Recap — Sales and Purchases tracking

- **Merchant Shop transactions now feed the recap.** `MerchantShop.logTransaction` is the single chokepoint for buy / catalog buy / gamble / sell — it now also calls `SessionRecap.logSale` or `logPurchase`. No call-site changes needed in the four merchant handlers.
- **Two new Discord export sections** — `## Sales` and `## Purchases`, grouped by player with per-player subtotals and a party total. Sales show the sell ratio in parentheses when it isn't 100% (so `(75%)` flags a discount at a glance). Sections only render when non-empty.
- **In-place data migration.** `SessionRecap.getData` backfills `sales: []` / `purchases: []` on existing worlds so this version drops in cleanly. `endAndSave` snapshots include both new arrays so future archived sessions can re-render with the new sections.
- **Currency formatting consolidated.** New `_formatCurrency` and `_toCopper` helpers on the recap singleton; sales/purchases sections use them for consistent g/s/c output. The existing loot-currency render is untouched (preserves byte-identical output for existing recaps).

### Loot Generator — Trade-goods baseCost was per-stack, should be per-unit

- **Stack baseCost was per-stack, should be per-unit (trade goods + gems).** A loot drop of `Rare Spice ×11` (10g per spice) used to set `baseCost = { gold: 110 }` (the full stack value) AND `system.quantity = 11`. The merchant code reads `baseCost` as a **per-unit** price and multiplies by sale quantity — so selling that stack paid out 110g per spice instead of 10g per spice (and selling all 11 paid out 1,210g instead of 110g). Same bug in `_gemItem` (`Uncommon Gem ×2` got `baseCost = 10g` for a 5g/gem stack). Both `_tradeGoodItem` and `_gemItem` now store `baseCost = unitVal` (per-unit) and let `quantity` alone scale the stack value, matching the system convention used by every compendium gear item. Affects: Common/Exotic/Rare Spice, Copper/Silver/Gold/Platinum Ingot, Uncommon/Rare/Very Rare Gems.
- **`_lootItem` now accepts a baseCost object** (in addition to the legacy flat-gold number) so future callers can express silver/copper prices precisely without forcing every value into gold. Backward compatible — all 16 existing call sites still work unchanged.
- **No more "×N ×N" doubled-quantity display in inventory.** `_gemItem` and `_tradeGoodItem` used to bake `×N` directly into the item name, but the inventory render patch already adds an `×N` badge from `system.quantity` — so the merchant card showed "Copper Ingot ×20 ×12" (name has ×20, badge adds ×12). Item names now stay clean (`Copper Ingot`, `Uncommon Gem`); the quantity badge alone shows stack size. Recap loot log still surfaces qty via `loot-tracker.logDrop` appending `×N` to the detail string when `system.quantity > 1`, so the session recap reads "Exotic Spice ×11" as before. Loot card display also adds `×N` next to the item name so players can see the qty at a glance.

### Merchant Shop — opt-in shop visibility for players

- **Shop is now player-opt-in, not force-popup.** "Open Shop for All Players" used to forcibly render the shop window on every connected player's screen the moment the GM clicked it. Renamed to **"Make Shop Available"** — instead, the shop becomes *available* and players choose when to open / close their own window. Two opt-in surfaces:
  1. A chat card posted by the merchant when the shop opens, with an **Open Shop** button players click to launch their window.
  2. A small storefront button (🏪) on the Crawl Strip that appears for everyone when the shop is available — players can use it to reopen the shop after closing their window, or to open it for the first time if they missed the chat card.
- **GM keeps full control.** "Make Shop Available" → players can open · "Close Shop" → all open player windows close, strip button disappears, the chat card's Open Shop button grays out as superseded. Both transitions post a fresh chat card so the scrollback always announces the latest state.
- **Reload-safe.** New world settings `shopAvailableToPlayers` and `shopAvailabilityData` persist the open state and an inventory snapshot, so a player who reloads while the shop is open still sees the strip button and can reopen with current inventory.
- **GM workflow unchanged.** The GM still opens / configures the shop from Crawl Bar → Forge & Loot. The Make Available toggle is the only player-visibility change.

## v1.16.1

### Relic Forge — Power Database Search, Custom Library, Quick-fill

- **Search box** above the Power Database list — live, focus-preserving filter on name + description, composes with the category tabs. Empty-state placeholder when nothing matches.
- **Custom category** — saved-custom powers get their own tab next to the built-ins.
- **Save Custom** button alongside the existing **Add Once**. Description input added to the builder. "Save" persists the power to a world setting (`customRelicPowers`) and auto-selects it on the current relic; saving by id replaces the previous version so iterating doesn't require deleting first.
- **Quick-fill targets** — pick from a Stat / Skill / Save dropdown and a +/- value, the raw key/mode/value fields auto-populate (path = `system.stats.<key>.bonus` etc., mode = Add since bonus is an array, value preserves sign). The Effect Name + Relic Name Word also pre-fill from the chosen label so a one-click save is the path of least resistance. Targets are read live from `CONFIG.VAGABOND.stats` / `homebrew.skills` / `homebrew.saves` so per-world homebrew lists are respected.
- **Delete saved customs** — hover any saved custom-power card to reveal a trash icon on the right. Click it, confirm, and the entry is dropped from the world setting and from any active selection. Built-in powers never get the icon.

### Relic Forge — Bug fixes

- **Compendium-cloned base item.** The inline weapons-and-equipment search (and drag/drop from a compendium) used to call `update()` on the locked compendium document and throw `"You may not update documents in the locked compendium"`. Forging now clones the loaded item data into `game.items` at forge time (not load time, so cancelling leaves no clutter) and applies the relic to the world copy. The compendium document is never touched.
- **Search past the 200-row cap.** The browser cache held all 400+ pack entries but the rendered list was sliced to 200, then live-search only toggled rows already in the DOM — items past position 200 (Light Armor at 210, Medium Armor at 241, late-alphabet weapons, much of the gear pack) were unreachable. The list now rebuilds on every keystroke against the full cache (cap 500) and clicks are delegated on the list root so newly-inserted rows still work.

## v1.16.0

### Monster Creator — Hit Die Configuration

- **Per-monster Hit Die selector.** Monster Creator → Stats. Pick `d4`–`d14`, or leave on `From Size` to follow the global size→die map.
- **Roll HP on spawn.** Per-monster checkbox. Every unlinked token rolls fresh HP (`HD × 1die`) at drop time; both **value AND max** are set to the rolled total (a token rolling `36` shows `36/36`, not `36/avg`). The GM sees a whispered roll with the per-die results. Linked tokens still share HP with the world actor.
- **Hit Die Configuration window.** New ApplicationV2 window — opens from the Forge & Loot right-click menu and from Module Settings. Edits the size→die map (Small special: HP = HD; Medium = d6, Large = d8, Huge = d10, Giant = d12, Colossal = d14 by default) and a bestiary-fallback toggle. When the fallback is ON, compendium NPCs without authored flags also use the size→die map and roll on spawn.
- **System-side Max HP wrap.** Wraps the Vagabond NPC data model's `prepareDerivedData` in `setup` so `flags.vagabond-crawler.hitDie` actually drives `system.health.max` on the actor sheet too — without the wrap, the system's hardcoded `HD × 4.5` would clobber the configured die's average every load. The wrap composes correctly with Active Effects (subtracts the system's base, adds ours) and respects a per-token `rolledMaxHp` flag so rolled-on-spawn tokens keep their rolled max across reloads.
- **Bestiary load — wildcard token fallback.** Bestiary entries with `prototypeToken.randomImg = true` store their token path as `.../*`, which `<img src>` can't render. The Monster Creator now substitutes the portrait when it sees a wildcard so the Token slot shows actual artwork instead of a broken-image icon.
- **Panel-mode save no longer kills the form.** When the Monster Creator is mounted as a tab inside the Encounter Roller, save no longer calls `close()` — that used to abort the form's listeners while the DOM stayed visible, so a second Create World Actor click silently no-oped. Panel mode now stays interactive across back-to-back saves.
- **Back-compat.** Every existing call to `calculateHP(hd, size)` keeps its current behavior — the new die argument defaults to `d8`. Existing world actors and bestiary monsters with no flags are unchanged when the bestiary fallback is OFF (which is the default).

## v1.15.0

### Crawl Strip — Psychic Talents Tab

- **New "Talents" tab on the per-card combat dropdown for Psychic actors.** When a player hovers their portrait during combat, the Talents tab now sits alongside Weapons / Spells / Craft / etc. Click a damage or effect Talent → Vagabond Character Enhancer's TalentCastDialog opens with the full RAW configurability (damage dice, delivery, effect toggle). Click a buff Talent (Absence, Evade, Shield, Transvection) → Focus toggles directly; an accent stripe on the row marks the currently-focused state. No more bouncing back to the character sheet just to cast.
- **Slot priority follows the existing C/D overflow chain** used by Craft / Step Up / Virtuoso / Summon / Gold Sink. Vanilla Psychic gets `[Weapons] [Talents]`. Magical-Secret-multiclass Psychic with a real spell gets `[Weapons] [Spells] [Talents]`. Same auto-hide-when-empty behavior as every other tab.
- **Detection is "actor has talent items," not class name.** Multiclass-friendly without any extra logic.
- **Graceful no-op when VCE is missing or older than the matching API release.** The Talents tab simply doesn't appear; the rest of the strip is untouched. Requires a VCE build that exposes `getTalentData`, `castTalent`, and `toggleTalentFocus` on `game.vagabondCharacterEnhancer` — wait for the matching VCE release before expecting the tab to appear.

## v1.14.0

### NPC Action Riders — Fatigue Payload

- **`fatigueOnFail` and `fatigueOnTick` on the rider schema.** The Vagabond system's `causedStatuses` entries (per-NPC-action save-or-status riders) now carry two optional numeric fields. On a failed save, any entry with `fatigueOnFail > 0` adds that much fatigue to the target (capped at 5). While a status with a `fatigueOnTick > 0` is active, every roll of its linked countdown die applies that much additional fatigue per tick. Covers the common *"pass [Endure] or +1 Fatigue"* (Pseudopod, Shadow Life Drain) and *"Sickened (Cd4, +1 Fatigue each Round)"* (Ettercap, Spider, Tarantella) patterns the bestiary has been carrying as `extraInfo` text only.
- **Monster Creator UI.** Two new `+Fat` / `+Fat/tick` number inputs (0–5) appear on every rider row in the On-Hit Effects and Crit On-Hit Effects editors. Existing riders stay at 0; editing populates and persists through save/reload.
- **`_patchCreateStatusCountdown` runtime wrap.** The system's `StatusHelper._createStatusCountdown` doesn't natively persist `fatigueOnTick` to the countdown die's flags (literal `// TODO` comment at `status-helper.mjs:246`). Crawler's `countdown-roller` wraps `_createStatusCountdown` and `CountdownDice.create` at init so the rider entry's `fatigueOnTick` is stamped onto `flags.vagabond.countdownDice.fatigueOnTick`. Then `_rollDie` reads the flag and applies the fatigue on each roll, alongside the existing tick-damage flow.
- **Bestiary migration — parser only, no application yet.** New `scripts/audit/migrate-riders.mjs` parses every NPC action's `extraInfo` in `monsters.json` and proposes structured `causedStatuses` entries matching the canonical *"pass [Save] or become Status (CdN unit[, +K Fatigue each Round])"* shapes. Dry-run only — writes `docs/audit/riders-migration-proposed.json` (12 proposed entries across 12 monsters) and `docs/audit/riders-migration-unmatched.md` (8 genuinely bespoke cases like Basilisk petrification, Mummy curses, Pit Fiend aura). No actor data is modified. Applying to world actors or shipping a `preCreateActor` patcher for compendium imports is deferred pending play review of the proposals.

## v1.13.0

Inventory stack split/merge, a complete settings-panel reorganization (28 scattered settings → 7 grouped submenu buttons), crawl-strip ↔ combat-tracker reconciliation, and a batch of friendly-NPC fixes (summons, familiars, beast companions, hirelings). Plus the context-menu structural fix and the strip HP-bar anchoring fix.

### Inventory Stack Split / Merge

- **Drag a stacked item onto an empty slot → peels one off.** Source quantity drops by 1, a new qty-1 item lands in the first empty slot. The new piece is a full clone (flags, effects, custom fields preserved) and is created with `skipStack: true` so the auto-stack hook doesn't immediately merge it back.
- **Right-click → "Split Stack…"** on any stacked item opens a dialog with a number input (1 to qty−1, default half). Splits off the chosen amount in one action.
- **Drag one stack onto another of the same identity → merges.** The dragged item is absorbed into the target (target quantity += source quantity; source deleted). "Same identity" means name + type + matching lit/junk flags — lit torches stay separate from unlit, junk-marked stacks stay separate from clean ones, with a warning toast if the drop is blocked by an identity mismatch the user clearly intended as a merge.
- **Drop interception is scoped.** Plain drag-to-reorder on the grid still works unchanged — only drops that target empty slots (for stacks with qty > 1) or same-identity cards trigger the split/merge path. Everything else falls through to the system's reorder handler.
- **Owner-gated, no socket needed.** Any actor owner (players on their own sheet, GM on any sheet) can split and merge. All mutations go through direct `updateEmbeddedDocuments` / `createEmbeddedDocuments` — Foundry handles the client sync.
- **Shared identity helper.** The auto-stack `preCreateItem` hook now delegates to `StackSplit.sameStackIdentity` instead of its old inline name+type+lit check, so the "what counts as the same stack" rule lives in one place.

### Context Menu Cleanup

- **Module-injected inventory entries now match the system's layout exactly.** Mark as Junk, Split Stack…, Use Scroll, and Use Enchantment Scroll were being injected as `<li>` elements, but the Vagabond system builds its context menu from `<div class="context-menu-item"><i/><span/></div>`. The mismatched element type meant our entries rendered with wrong height, wrong kerning, and a hand-rolled amber tint that didn't match anything else. All four now use the system's structure and inherit its CSS verbatim — indistinguishable from native entries except by position.

### Crawl Strip ↔ Combat Tracker Sync

- **`CrawlState.syncCombatMembers()` — bidirectional reconciler.** The crawl strip and the combat encounter tracker could drift out of sync in every direction: a combatant added before the crawl was active never made it into the strip; a hero in the strip was never pushed into the tracker when combat started; a participant removed from one side stayed on the other. The new method walks both lists and makes them match — adds missing combatants to the strip, removes strip members whose combatant is gone, and pushes any strip hero (type `player`) missing from the tracker into the combat. Handles sceneless v13 combats by deriving the target scene from existing combatants or the canvas fallback. Exposed as `game.vagabondCrawler.state.syncCombatMembers()` for manual reconcile from the console.
- **Reentrancy guard.** `createCombatant` fires a hook per newly-created combatant; without a guard, the reconciler's own `createEmbeddedDocuments` call re-entered the function before prior creates landed in the snapshot, pushing each hero 2× (4 Drakos / 4 Sassafrass in the tracker). Now `_syncing` short-circuits re-entry.
- **Duplicate hero combatants on Toggle Combat State fixed.** When a GM right-clicked a token and picked Toggle Combat State, Foundry created the combat and added the token as a combatant in parallel. The crawler's `createCombat` hook fired before the combatant landed in the `combat.combatants` snapshot, so the reconciler saw the hero as "missing" and pushed a second combatant — leaving both a Foundry-created combatant and a crawler-pushed duplicate in the tracker. The Combat ← Strip push now gates on `combat.started === true`, so the reconciler only pushes heroes from the strip into the tracker at Begin Encounter time (when combat actually begins). On mere combat *creation*, it only pulls combatants into the strip, never pushes.
- **Hooked onto every combat event.** `createCombat`, `combatStart`, `createCombatant`, `deleteCombatant` all go through the shared `_syncCombatToStrip` path, so no timing hole leaves stale state.
- **Add Tokens now joins combat.** `_addSelectedTokens` (crawl bar's "Add Tokens" button) pushes the newly-added tokens into `game.combat` via `TokenDocument.implementation.createCombatants(...)` when a combat is active. Mid-combat reinforcements and summons land in the turn order immediately instead of only showing on the strip.
- **Strip X → combat cascade.** `CrawlState.removeMember` now also deletes the matching combatant if one exists. Strip removal happens first so the reconciler's Combat←Strip re-push can't immediately re-add a hero back.
- **Combat right-click Remove → strip cascade.** `deleteCombatant` hook now drops the matching strip member (using a direct splice that bypasses `removeMember` so we don't try to delete a combatant that's already being deleted). Works for heroes and NPCs alike.
- **Hidden tokens stay hidden on the strip.** If a combatant is hidden in the tracker AND its token is hidden on the scene, the strip card is dropped for everyone (including the GM) — enemies the party hasn't spotted don't clutter the strip. Hidden on only one side = hidden from non-GM players only; GM sees a partially-hidden card so the in-between state stays visible to them.
- **Token ↔ combatant visibility sync.** Toggling a token's `hidden` flag on the canvas updates the combatant's `hidden` in the tracker, and vice versa. Guarded with a `tokenDoc.hidden === changes.hidden` check to prevent the two hooks from looping.
- **Stale strip members purged on every sync.** An old summon whose token was deleted without its combatant being cleaned up could leave a strip entry with a tokenId that no longer resolves to any scene. When the next sync tried to push that hero to combat, Foundry's backend threw `undefined id [...] does not exist in the EmbeddedCollection collection` during parent-UUID resolution. New defense-in-depth pass: on every `syncCombatMembers` call, any member whose tokenId isn't on any scene gets removed.
- **Combat-created strip members always tagged `source: "combat"`.** Previously only `type: "npc"` members got the tag; friendly NPCs (type `"player"` on the strip because they share the Heroes side) were left untagged and survived the combat-source orphan sweep indefinitely. Now all combat-created entries get the tag, so removing a combatant cleanly removes the strip member too.
- **`deleteToken` hook** — any time a token is deleted from any scene, the matching strip member is immediately spliced out. Closes the last avenue for orphan strip entries (e.g. the token was removed via a macro, a third-party module, or Gather Party's hide-and-delete flow).
- **Defensive try/catch on auto-defeat at 0 HP.** Our `updateActor` auto-defeat logic wraps both `combatant.update({ defeated: true })` and the dead-status `toggleStatusEffect` in try/catch. If the underlying token has been deleted by a module that also listens to the death event (e.g. VCE's summon banish), the create throw no longer crashes our hook — just logs a warn and continues.

### Crawl Strip — Layout & Visibility

- **HP bar no longer drifts to the top.** `.vcs-overlay` uses `justify-content: space-between`, which only distributes across ≥2 children. When the name was hidden AND no status effects were active, `.vcs-bottom` (with the HP bar + pills) was the only child and flex parked it at the top of the card. `.vcs-bottom` now has `margin-top: auto`, which pins it to the bottom regardless of sibling count — single-child case resolves to `margin-top: 126.8px`, glued to the card floor.
- **"Hide NPC Names in Strip" → "Hide NPC Names from Players".** Renamed and rescoped: GM always sees NPC names in the strip; the toggle now only affects players. Matches the existing "Hide NPC Health Bar from Players" pattern.
- **Dropdown scrollbar bug fixed.** An older tablet-responsive fix added `overflow-x: auto` + `overflow-y: visible` to `.vcs-inner`. Browsers compute `overflow-y` as `auto` whenever `overflow-x` isn't `visible` — so the absolutely-positioned `.vcs-action-tabs` dropdown (which sits below the card at `top: 100%`) was being treated as overflowing content, triggering a stray vertical scrollbar every time a card was hovered. Reverted the overflow changes on `.vcs-inner` (tablet horizontal-scroll use case is no longer supported; the trade-off is worth it).

### Settings Panel Reorganization

- **28 settings collapsed into 7 submenu buttons** via `game.settings.registerMenu`. The new `SettingsGroupApp` (a generic ApplicationV2 driven by a spec) renders a form for any named group and writes back via `game.settings.set`. Each group has a subclass baked at registration time so Foundry's one-class-per-menu contract is satisfied. World-scoped fields gate themselves (disabled + `(GM only)` tag for non-GMs); client-scoped fields are always editable.
- **GM sees 7 submenus**: *Light & Time* (2 settings), *Encounters* (2), *Crawl Strip* (3), *Combat* (2), *Movement* (3), *Loot & Merchant* (5), plus the existing *Animation FX Configuration* (full preset editor, unchanged).
- **Players see 3 flat settings** in the main module settings panel: Animation FX (on/off), Animation FX: Sound, Animation FX: Master Volume. All world-scoped submenus are `restricted: true` (hidden from non-GMs). Advanced per-client controls like Global Scale remain accessible inside the GM-only Animation FX Config window.
- **`npcActionMenu` setting removed.** The hover action dropdown on NPC cards during combat is core UX, not an opt-out — the per-world toggle is gone. Owner-check still gates which actors a player can trigger actions on, so players can't accidentally puppet other heroes.

### Friendly NPCs — Summons, Familiars, Beast Companions, Hirelings

- **Morale no longer triggers on friendly NPC deaths.** The morale checker's "first death / half-dead / solo half-HP" filters counted every NPC-type combatant, including summons and familiars on the party's side. A dying summon is sad, not a morale problem for the enemy squad. New `_isEnemyNpc(combatant)` helper excludes FRIENDLY disposition from all five filter sites (`initialNPCCount`, `isSolo` detection, group-death trigger, solo half-HP trigger, leader selection in `_check`). Console log now reads "N enemy NPCs" so the scope is unambiguous during debugging.
- **Friendly NPC crawl speed defaults to `base × 3`.** NPC sheets have no dedicated crawl-speed field — when the crawl phase asked for one, summons/familiars returned 0 and couldn't move overland. `_getBaseSpeed` (movement-tracker) and `_extractData` (crawl-strip, for display) now detect FRIENDLY disposition on NPCs with zero explicit crawl speed and fall back to `system.speed × 3`. Hostile NPCs unchanged (still return 0 if they have no crawl field, as they shouldn't be on the crawl phase anyway).
- **Gather Friendlies — per-hero right-click on the token HUD.** New button (paw icon) next to Foundry's default token controls on any character token. Teleports friendly NPC tokens on the scene that share a non-GM owner with the hero to free adjacent squares around the hero. Ownership filter prevents one player's summons from being pulled by another hero's gather. Already-near friendlies (within 2 squares) stay put. Uses 8-then-16 adjacency offsets; falls back to stacking on the hero if all 24 slots are occupied.

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
