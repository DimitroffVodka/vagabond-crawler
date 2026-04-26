# Exploration

Crawl-phase tools: random encounters, monster creation, lighting, traps.

---

## Encounter System

<!-- gif: docs/assets/encounter-roller.gif -->

### What it does

Two tools that feed each other: the **Encounter Check** is a d6 roll against a configurable threshold, triggered by the GM from the Crawl Bar; the **Encounter Roller** is a four-tab authoring window for building, browsing, rolling, and creating encounters.

When an encounter check hits, the roller auto-opens and pre-rolls whatever table is currently marked active — the GM sees a result card in one click, not five. When it misses, the roll is posted to chat ("No Encounter — the dungeon is quiet…") and the crawl continues. Result cards show enemy **count** (rolled from each slot's "appearing" formula), **distance** (Close / Near / Far), and **reaction** (Violent → Friendly on a 2d6), each with its own re-roll button so you can spin any facet without re-rolling the others. Post to chat for player visibility or place tokens directly onto the scene.

### How to use

1. **Check.** Click **Encounter Check** on the Crawl Bar — rolls a d6 against the threshold. Right-click the bar button to set the threshold (1-in-6 through 5-in-6) or clear the active table. On a hit, the roller opens automatically and rolls the table.
2. **Build Table.** Pick a die formula (d4, d6, 2d6, d8…), name the table, then drag NPC actors from a compendium, world, or the Browse NPCs tab onto the numbered slots. Set "appearing" per slot (e.g. `1d4`). Save as a world RollTable, post to chat, or place tokens directly.
3. **Browse NPCs.** Filter a source (World, Scene, Bestiary, Humanlike, or any module pack) by name, creature type, and tech-level range. Sort by any column. Click **+** on a row to add the NPC to the next empty slot on the Build Table tab.
4. **Roll Tables.** Pick any world RollTable (grouped by folder — excluded folders are hidden) and roll it. Any existing table works, not just ones authored here. Use **Set as Active** to wire a table to the Encounter Check so hits auto-roll it.
5. **Monster Creator.** Opens the [Monster Creator](#monster-creator) panel inline. Build or mutate an NPC on-the-fly during an encounter, then return to Browse or Build to drop the new actor into a slot.

Each result card has separate **reroll count / distance / reaction** buttons and **Post to Chat / Place Tokens** actions. Placed tokens use the active scene; morale checks fire independently through the [Morale Check](combat.md#morale-check) subsystem once the encounter enters combat.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Encounter Roll: GM Only | Whisper check results to the GM instead of broadcasting | On |
| Default Encounter Threshold | N-in-6 chance on check (right-click the bar button to set) | 1 |
| Active Encounter Table | Table UUID auto-rolled on hit (set via "Set as Active" in the roller) | — |
| Excluded Table Folders | Folder IDs hidden from the Roll Tables tab (manage-folders button in the roller) | none |

### Tips & Gotchas

- **Browse NPCs reads any compendium pack.** Both the core `vagabond.bestiary` and `vagabond.humanlike` are wired in; `vagabond-character-enhancer.vce-beasts` appears automatically when VCE is installed. Your own module packs can be added via the source dropdown.
- **Filter state persists across tab switches** — swapping to Build and back keeps your search, type, and TL filters intact.
- **"Set as Active"** is the bridge between the Check and the Roller — without an active table, the Check just reports hit/miss and waits for you to pick something manually.
- For monster variants created inline, see [Monster Creator](#monster-creator) — mutations recalculate HP and DPR, and saved NPCs live as world actors (the source compendium is never modified).

---

## Monster Creator

<!-- gif: docs/assets/monster-creator.gif -->

### What it does

A dedicated ApplicationV2 window for authoring NPC actors from scratch or by pre-filling from a bestiary monster. Ten collapsible sections cover the full NPC sheet — Bestiary loader, Identity, Stats, Damage Immunities, Weaknesses, Status Immunities, Actions, Abilities, Mutations, and Description — with live HP and Threat-Level recalculation as you edit. Saved NPCs land as world actors; the source compendium is never modified.

The creator absorbs what used to be a standalone **Monster Mutator**. Apply one or more of 64 mutations with stat recalculation and auto-generated naming ("Ember Plaguewyrm"), or hand-edit every field. Action and Ability **Quick Picks** come from curated catalogs (`scripts/monster-creator/action-templates.mjs` / `ability-templates.mjs`) — drop in "Claws 2d6 piercing" or "Magic Ward II" in one click. Abilities with a green ✓ badge are live-automated by the module; ⚠ means the Quick Pick is not yet automated; 📖 marks flavor-only abilities that exist for GM reference.

### How to use

1. **Open.** Encounter Roller → Monster Creator tab, or call `game.vagabondCrawler.monsterCreator.open()`. The panel mounts inline in the roller window, so you can hop between Build Table and Creator without losing state.
2. **Load from Bestiary (optional).** Pick a source (Bestiary, Humanlike, VCE Beasts, your own packs), filter by name / creature type / TL, and click a row to pre-fill every Creator section with that monster's data. Portrait, token image, senses (parsed into Foundry sight modes), speed modes, actions, and abilities all come across.
3. **Fill Identity.** Name, size, being type, zone (frontline / midline / backline), HD, morale, appearing, speed, senses, armor, portrait, and token images.
4. **Tune Stats.** Base stats (might / dexterity / awareness / reason / presence / luck) feed the live HP and TL preview. Crank a stat up and watch HP + DPR shift in real time.
5. **Set Immunities & Weaknesses.** Damage immunities, weaknesses (including `coldIron` and `silver`), and status immunities are checkbox lists pulled from the canonical Vagabond vocabulary.
6. **Build Actions.** Use a Quick Pick (Claws, Bite, Bow Shot, Venom Spit, etc.) or author from scratch — name, damage formula, damage type, range, status rider, countdown, drain, target count. Quick Picks live-update the action list.
7. **Build Abilities.** Quick Picks cover the whole [NPC Abilities](combat.md#npc-abilities) catalog: Magic Ward I-VI, Pack Instincts / Tactics / Hunter, Nimble, Soft Underbelly, and narrative options like Regeneration or Flight. The automation badge tells you at a glance whether picking this ability actually *does* anything at the table.
8. **Apply Mutations.** The Mutations section picks from 64 mutation templates — each applies stat deltas, new actions, new abilities, and name fragments (Elder, Blighted, Corrupted…). Conflicts between mutations are detected automatically. Full boon/bane lists are in [`docs/audit/abilities.md`](audit/abilities.md).
9. **Save.** One click creates a new world NPC actor with the full Vagabond `npc` system shape. The sheet opens immediately; drop the actor into the scene or onto a Build Table slot.

### Settings

No user-facing settings — the Creator uses per-session UI state for open/closed sections (restored on re-render) and the audit dataset in `docs/audit/` for ability automation status.

### Tips & Gotchas

- **Green ✓ means automated.** Passing an ability through Quick Pick doesn't guarantee automation — check the badge. ✓ = `scripts/npc-abilities.mjs` actively hooks that ability name; ⚠ = planned but not wired; 📖 = flavor only.
- **Saving never modifies the compendium.** The creator explicitly creates a *new* world actor. If you want to update a bestiary entry, do it in the compendium directly.
- **Mutations recalculate HP and DPR** — mutated stat boosts flow through `calculateHP` / `calculateDPR` from `scripts/monster-mutator.mjs`, and mutated names are generated via `generateMutatedName` so "Elder Orc Warlord" is one click.
- **Senses parse automatically.** Loading from a monster whose senses text says "Darksight 60'" sets the token's Darkvision to 60 ft. Edit the senses field and re-save to tweak.
- For a full dashboard of which abilities are implemented across all 348 bestiary monsters, see [`docs/audit/abilities.md`](audit/abilities.md) — that's the ground truth for automation coverage.

---

## Hit Die Configuration

Vagabond's default HP formula is `HD × 4.5`. The Crawler lets you swap that out per monster:

- **Hit Die selector** (Monster Creator → Stats): pick `d4`–`d14`, or leave on `From Size` to follow the global size→die map.
- **Roll on spawn**: when checked, every unlinked token of that monster rolls fresh HP (`HD × 1die`) at drop time. The GM gets a whispered roll. Linked tokens are skipped (they share HP with the world actor).
- **Hit Die Configuration window**: open from the Forge & Loot button (right-click) or Module Settings → Vagabond Crawler. The size→die map controls the default die for every monster set to `From Size` — change it to update everyone using "From Size" automatically.
- **Bestiary fallback** (in the config window): when ON, compendium NPCs without authored flags also follow the size→die map and roll on spawn. OFF by default — legacy bestiary drops keep the deterministic `HD × 4.5` formula.

Small monsters always use `HP = max(1, HD)` regardless of die — small things are fragile.

---

## Light Tracker

<!-- gif: docs/assets/light-tracker.gif -->

### What it does

Tracks burn time and Foundry light settings for every torch, candle, and lantern the party carries. Twelve source types ship with the module, each with its own bright/dim radius, color, animation, and fuel behavior. Burn time deducts from the world time — either per crawl turn (`Time Passes` button) or in real time while Foundry is unpaused. Lanterns consume oil when burn time reaches zero (and auto-refuel if the carrier has more oil), while torches and candles simply go out.

### How to use

1. **Light a source.** Right-click any supported item in inventory → **Light**. The token's Foundry light properties switch to the configured bright/dim/color/animation, and burn time starts counting down.
2. **Advance time.** Either click **Time Passes** on the Crawl Bar (default 10 minutes) or enable **Real-Time Light Burn** to have 1 real second equal 1 game second while the scene is active.
3. **Extinguish.** Right-click the item again → **Extinguish**. Burn time pauses; any remaining fuel carries over to the next light.
4. **Drop on canvas.** Drag a lit light source from the character sheet onto the scene — a temporary Actor token materializes at the drop point, carrying the light with it. Token HUD shows a **Pick Up** button for any owner.
5. **Transfer to a party token.** Merging characters into a party token transfers carried lights; extracting a character takes their lights back.

### Source Types

| Source | Bright | Dim | Duration | Notes |
|---|---:|---:|---|---|
| Torch | 15 ft | 30 ft | 1 hr | Standard hand-carried; consumed on burnout |
| Lantern, Hooded | 15 ft | 30 ft | 1 hr | 90° cone; needs oil |
| Lantern, Bullseye | 30 ft | 60 ft | 1 hr | Longer reach; needs oil |
| Candle (Basic) | 5 ft | 10 ft | 1 hr | Quiet, short radius |
| Candle, Calming | 5 ft | 10 ft | 1 hr | Blue flame, flavor |
| Candle, Insectbane | 5 ft | 10 ft | 1 hr | Green flame, flavor |
| Candle, Restful | 5 ft | 10 ft | 1 hr | Warm flame, flavor |
| Sunrod | 15 ft | 30 ft | 1 hr | Bright daylight-style sunburst |
| Torch, Tindertwig | 15 ft | 30 ft | ∞ | Never burns out |
| Torch, Sentry | 15 ft | 30 ft | 1 hr | Suspends Invisible in its light |
| Torch, Repel Beast | 15 ft | 30 ft | 1 hr | Red flame |
| Torch, Frigidflame | 15 ft | 30 ft | 1 hr | Cold blue flame |

Want to tweak the Foundry light properties (color, animation, angle)? Open the **Light Sources Configuration** window via `game.vagabondCrawler.lightTracker.openSourcesConfig()` — stored as world overrides on top of the module defaults.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Real-Time Light Burn | 1 real second = 1 game second while unpaused | Off |

Per-source properties (dim/bright/color/animation) live in the **Light Sources Configuration** window (no CLI toggle — use the window or `game.vagabondCrawler.lightTracker.getLightSourcesConfig()` to inspect current overrides).

### Tips & Gotchas

- **Lighting a stacked torch splits one off.** If you have 5 torches stacked, lighting one creates a "Torch (lit)" item and leaves 4 unlit behind — the inventory auto-stack rule recognizes lit state.
- **Tindertwig torches never burn out** — longevity is effectively infinite, so they show their burn time counting down but never actually zero.
- **Sentry torches suppress Invisible** — any creature with the Invisible condition loses it while inside the sentry torch's light radius. Flavor text in chat confirms when a target breaks invisibility.
- **Lantern fuel preference is explicit.** When a lantern runs dry, the tracker searches inventory for oil and prefers "Oil, flask" (plain) over "Oil, Basic" (alchemical). A chat card reports the remaining oil count.
- **Dropped lights are real actors.** They live on the scene until picked up — you can illuminate a room by drag-dropping a lit torch onto a brazier sprite, for example.
- **Party tokens carry lights correctly** even when unlinked. The tracker walks the party actor's member list and re-applies lights to whichever token is currently visible.

---

### Trap Builder

<!-- gif: docs/assets/trap-builder.png -->

A macro-based trap authoring flow that rides Foundry v13's **Scene Regions** system. Open the builder from the GM control layer, sketch the trap zone on canvas, then fill in the config dialog: save type (Dex / Awareness / any Vagabond save), VFX (Sequencer + JB2A effect path), damage formula and type, status effects to apply on failure, countdown dice to spawn on the victim, tick damage, and resource drain (fatigue / mana / luck). The builder auto-creates a Scene Region with an **Execute Macro** behavior that fires on token-enter, so any token stepping in triggers the whole chain — save roll, damage, status, VFX — without the GM clicking. A **one-shot** checkbox disables the region behavior after the first trigger, turning a reusable trap into a single-fire trap. VFX integration uses Sequencer directly; JB2A asset paths slot into the VFX picker.