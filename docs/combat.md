# NPC Combat Automation

> *This guide covers the NPC-side combat automation handled by Vagabond Crawler: NPC abilities, flanking, countdown dice, morale, animation FX. Player-side combat (class resources, character action menus, etc.) is handled by the Character Enhancer module — see its docs.*

---

## NPC Abilities

<!-- gif: docs/assets/npc-abilities.png -->

### What it does

Passive combat hooks that make NPC abilities fire automatically — no GM effort required during combat. The module registers wraps and hooks (at Foundry's `setup` stage so they layer correctly with the Character Enhancer module's wrap chain) and then watches for casts, attacks, and save rolls targeting affected NPCs.

| Ability | Effect |
|---|---|
| **Magic Ward I-VI** | Each level adds +N Mana surcharge to any spell cast at a warded target (first time per round). I through VI = +1 through +6 Mana. Displays live in the Cast Spell Dialog mana total. |
| **Pack Instincts / Pack Tactics / Pack Hunter** | Saves against attacks from a packing NPC get Hinder when the NPC has an ally adjacent to the target. Same mechanic, three flavored names. |
| **Nimble** | Clamps favor to *none* against the NPC while it can still move — no gang-up Favor, no situational Favor. Suspended when the NPC is Incapacitated, Paralyzed, Restrained, or Unconscious. |
| **Soft Underbelly** | Zeroes the NPC's armor while it has the Prone condition. The damage helper reads `actor.system.armor` directly, so Active Effects using the `system.armor` OVERRIDE mode kick in transparently. |

### Automation in the Monster Creator

The [Monster Creator's](exploration.md#monster-creator) Ability Quick-Picks show a green ✓ badge next to any name that matches a `PASSIVE_ABILITIES` entry — that's the indicator that picking the ability actually wires it up. A ⚠ badge means the Quick Pick is catalogued but not yet automated; 📖 means it's flavor only. Picking an unbadged ability still attaches it to the NPC's sheet for GM reference, but nothing fires at the table.

For the full dashboard of which abilities are automated across every monster in the bestiary, see [`docs/audit/abilities.md`](audit/abilities.md) — that file is regenerated from the compendium via `scripts/audit/analyze.mjs`, so it's the ground-truth automation coverage report.

> **VCE wrap-chain note:** `vagabond-character-enhancer` wraps the system's spell and damage helpers in its `ready` hook. To run *after* VCE's favor-combine logic, this module wraps in `setup` so our handlers sit *innermost*. See CLAUDE.md's wrap-chain section for details if you're extending the automation.

---

### Flanking Checker

<!-- gif: docs/assets/flanking.png -->

> **Vagabond 5.38 and later handle flanking natively** (a **Flanked** status with the same Vulnerable effects plus +2 damage, applied automatically as tokens move). On those versions Crawler's checker stays idle so tokens don't get Vulnerable twice; the rest of this section describes the checker on older system versions.

Automatic flanking detection during combat. When two or more allied tokens are Close (within 5 ft) to a foe — and the foe is no more than one size larger than the flankers — the foe gains the **Vulnerable** condition. Bidirectional: heroes flank NPCs *and* NPCs flank heroes. Only the GM client evaluates (to avoid races); the checker tracks an actor flag `flankedBy` so it only removes Vulnerable it actually applied — a Vulnerable pushed on by a spell or ability stays put. Size hierarchy (small < medium < large < huge < giant < colossal) is resolved from `actor.system.size` for NPCs and `actor.system.attributes.size` for PCs. For unlinked tokens, the checker also mirrors `outgoingSavesModifier` changes back to the world actor so saves still work correctly.

### Countdown Dice Auto-Roller

<!-- gif: docs/assets/countdown-dice.png -->

Auto-rolls every combat-linked countdown die at the start of each round. Replicates the Vagabond system's `CountdownDice._onRollDice` logic from combat hooks, so burning, poison, bleeding, recharge timers, and any other system-recognized countdown die tick without the GM clicking a dozen overlays. A roll of 1 shrinks or expires the die; tick damage applies to the carrier via the system's `StatusHelper`; chat cards post through `VagabondChatCard`. Dice So Nice animations get a 2.5-second pad between rolls so results don't overlap visually. On combat end, the roller cleans up any lingering combat-linked dice so they don't persist to the next encounter. The hook is always on — no enable/disable toggle.

### Morale Check

<!-- gif: docs/assets/morale.png -->

Auto-triggers morale checks in three cases: (1) first NPC death in a group fight, (2) half of the starting NPC count is defeated, (3) a *solo* NPC drops to half HP or below. The module counts the initial NPC combatant list at combat start and tracks which triggers have fired with in-memory flags, so a rapid double-kill only fires the "first death" prompt once. Each prompt is a simple GM dialog — "The goblins check morale?" — with yes/no buttons that roll the morale check per the Vagabond rules. Morale interacts with the [Encounter System](exploration.md#encounter-system): failed checks usually mean the surviving NPCs flee, turning a combat back into an exploration beat.

### Animation FX

<!-- gif: docs/assets/animation-fx.png -->

Unified animation resolver and playback for weapons, alchemical items, gear, and NPC actions. A single chat hook watches for attack / action / cast messages and plays the configured animation through Sequencer + JB2A if both are installed. Per-item and per-action override flags (`item.system.itemFx`) let you author custom FX without touching global config; the config window (**Animation FX Config** — `game.vagabondCrawler.animationFx.open()`) provides six tabs covering Weapons, Skill Fallbacks, Alchemical, Gear, NPC Actions, and Settings. JB2A-aware defaults ship in `animation-fx-defaults.mjs` and activate automatically when JB2A is installed. For persistent light-on/light-off effects, see `game.vagabondCrawler.animationFx.startPersistent()` / `stopPersistent()`. See the [dev reference](dev/combat-tools.md) for the trigger setting and full config surface.

### Chat Dice Tooltips

Hover any rolled die in a chat card to see its formula and individual roll results — e.g. hovering `2d6` damage reveals `2d6 → [4, 2]` as a tooltip. Attack-roll tooltips show the d20 and every modifier (favor/hinder, stat, proficiency, item bonus, etc.). Registered on the v13 `renderChatMessageHTML` hook; also enriches any messages already rendered at module load so the tooltips persist through refreshes.
