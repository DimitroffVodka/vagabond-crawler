# Crawl Loop

The turn-to-turn core of Vagabond Crawler — phase tracking, movement, combat, rest.

---

## The Crawl Bar

*Orientation: the bottom bar is the GM control surface. Each button takes you to a feature in one of these guides.*

- **Start / End Crawl** — begin or end a crawl session
- **Next Turn** — advance the phase (Heroes → GM → Heroes)
- **Add Tokens** — add selected tokens to the tracker
- **Time Passes** — advance in-world time
- **Encounter Check / Roller** — see [Encounter System](exploration.md#encounter-system)
- **Light Tracker** — see [Light Tracker](exploration.md#light-tracker)
- **Combat** — add heroes and NPCs to the combat tracker
- **Rest / Breather** — see [Rest & Breather](#rest--breather)
- **Forge & Loot** — see [Crafting & Loot](crafting-loot.md)

---

## Crawl Strip

<!-- gif: docs/assets/crawl-strip.gif -->

### What it does

The Crawl Strip is a top-of-screen HUD visible to all players while a crawl is active. Each party member — heroes on the left, NPCs and the GM on the right — gets a portrait card with HP bar, status icons, name, and (for PCs and combat NPCs) pills for Luck and remaining movement. Disposition drives the split, not actor type: a friendly NPC summon appears on the Heroes side.

Cards highlight or dim based on phase — hero cards glow during the Heroes phase, NPC cards during the GM phase, and in combat the highlight follows whose turn it is plus whether each combatant has acted. Once every hero has acted, the two sides swap so the next-up side is always on the left. Combat also swaps the turn counter for a round badge with prev/next round arrows and adds Activate / End-Turn buttons on hover.

### How to use

1. Select tokens and click **Add Tokens** on the Crawl Bar — they appear as cards. The strip auto-sorts by combat turn order once combat starts.
2. **Single-click** a card to select and pan to the token. Shift-click to add to the selection. **Double-click** opens the sheet.
3. Hover a card during combat to reveal the tab-strip dropdown (see [Combat Dropdown](#combat-dropdown)).
4. GM-only hover buttons: red × removes the card, activate/end-turn drives the combat tracker, round arrows step round or turn without opening the tracker panel.

#### Movement Tracker

Movement is budgeted and color-coded on the token ruler. During the Heroes phase the budget is the actor's **crawl speed**; exceed it and the move is blocked with a warning. Terrain difficulty multiplies distance when crossing a Scene Region with a **Modify Movement Cost** behavior (up to 3× for walk). The "Treads Lightly" perk bypasses walk terrain difficulty.

In combat the budget is the **effective mode speed** — the fastest of walk, fly, swim, climb, phase, or cling. A Bat (walk 5 / fly 30) gets 30; a Dragon (walk 40 / fly 80) gets 80. The GM can pin a mode via the Token HUD movement-action buttons — the strip's pill icon mirrors that override. Combat allows up to **2× base speed** (move + Rush): the ruler turns red past base speed and hard-blocks at 2×. `moveRemaining` goes negative to show Rush spent.

**Rollback.** Each turn the module snapshots every tracked token's turn-start position. A rollback button appears on the Token HUD — PCs see it during the Heroes phase and combat, the GM during the GM phase and combat. One click teleports the token back (walls ignored, no animation) and refunds full base movement. Players relay to the GM via socket.

#### Combat Dropdown

Hover a card during combat and a tab strip slides down. PC cards show **Weapons** and **Spells**, plus situational tabs — Craft (alchemist), Beast (polymorphed druid), Step Up (dancer), Virtuoso (bard), Specialty. NPC cards show **Actions** and **Abilities**.

One-click a weapon or NPC action to roll it through the system's normal attack path, so VCE's favor/hinder chain still resolves. Spells open the shared **Cast Spell Dialog** — pick delivery, adjust damage dice, toggle FX, raise area/range; live mana cost updates as you tweak, including Magic-Ward surcharges against targeted wards. A Focus toggle marks the cast as a focus action. Rolls from the strip match the sheet on Vagabond 5.38: weapon attacks carry favor/hinder, the roll-damage setting, targets and Cleave (the damage die steps down per extra target); spell costs come from the system's own calculator, the Trinket gate and the mana-on-failed-cast setting apply, Imbue runs through the system's Imbue, and Place Template creates a Region. Only card owners see the menu; the **NPC Action Menu** setting can disable it entirely.

#### HP + Stats Quick Reference

Every card shows HP bar (green → yellow → orange → red), current-turn chevron, and defeated skull overlay. Hero cards add the active status-effect icon row (round countdown on hover) and pills for Luck and remaining movement (`moveRemaining/activeSpeed ft` with the mode icon). NPC cards in combat show the movement pill too, unless **Hide NPC Health Bar from Players** is on — that hides both the bar and the pill from non-GM clients. A crown overlay marks the GM entry.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Hide NPC Names in Strip | Remove NPC names from strip cards | Off |
| Hide NPC Health Bar from Players | Players can't see NPC HP bars or movement pills; GM still sees them | Off |
| Auto-Hide Defeated Tokens | Defeated tokens disappear from the strip instead of showing a skull | Off |
| NPC Action Menu | Show hover dropdown with Actions/Abilities during combat | On |
| Enforce Crawl Movement | Block tokens from exceeding crawl speed during the Heroes phase | On |
| Enforce Combat Movement | Block tokens from exceeding 2× base speed during combat | On |
| Enforce NPC Movement | Apply movement enforcement to hostile NPCs too (off = only players are enforced) | Off |

### Tips & Gotchas

- **Unlinked tokens work natively** — the strip reads HP from `token.actor`, so a cloned unlinked NPC shows its own HP, not the world actor's.
- **Friendly NPC summons appear on the Heroes side** — classification is by disposition, not actor type.
- **Party tokens** display speed correctly — `system.speed` is a flat number on party actors, an object on characters; the strip handles both.
- **Auto-hide hides, it doesn't remove** — clearing the defeated flag brings the card back without re-adding the token.
- **Rollback is GM-authoritative** — if players can't trigger it, confirm the GM client is online; players relay via socket.

---

### Crawl Clock

<!-- gif: docs/assets/crawl-clock.png -->

An SVG 6-segment progress clock anchored to the canvas, driven by the Vagabond system's `ProgressClock` API. Each segment represents one Scene of dungeon time; filling a segment triggers the Encounter Check, and at 6/6 the clock resets. Size (Tiny / Small / Medium / Large / Huge) and default position (bottom-left, bottom-right, etc.) persist in the `clockConfig` world setting, so the clock stays put across deletion, combat hiding, and new crawls. The clock hides itself during combat to free up canvas space and returns when combat ends. A GM-only right-click menu exposes size and position toggles.

### Rest & Breather

<!-- gif: docs/assets/rest-breather.png -->

One combined recovery dialog that rolls up every PC's current state — HP, Luck, Mana, Fatigue, Might, and ration count — into a single table, then offers two choices. **Rest** restores HP, Luck, and Mana to max; if HP was already full it also removes one stack of Fatigue. **Breather** deducts a ration and heals HP equal to the character's Might stat. Rations are auto-detected by scanning every PC for `equipment` items with `system.isSupply` — if a character has no rations, Breather is still available but their row shows "None!" in red so the GM can see at a glance who's going hungry. Cancel closes the dialog with no changes. Launched from the Crawl Bar's **Rest / Breather** button.
