# NPC Combat Automation

Vagabond Crawler handles NPC abilities, flanking, countdown dice, morale, and item or action FX. Player class resources and character action menus belong to Vagabond or the Character Enhancer module.

---

## NPC Abilities

Crawler watches casts, attacks, and saves for a small set of named NPC abilities. Most of them need no extra action from the GM once the ability is present on the actor.

| Ability | Effect |
|---|---|
| **Magic Ward I-VI** | Each level adds +N Mana to the first spell cast at that warded target each round. I through VI add 1 through 6 Mana. The Cast Spell Dialog shows the surcharge. |
| **Pack Instincts / Pack Tactics / Pack Hunter** | Saves against attacks from a packing NPC get Hinder when the NPC has an ally adjacent to the target. Same mechanic, three flavored names. |
| **Nimble** | Removes Favor against the NPC while it can still move. It is suspended while Incapacitated, Paralyzed, Restrained, or Unconscious. |
| **Soft Underbelly** | Zeroes the NPC's armor while it has the Prone condition. The damage helper reads `actor.system.armor` directly, so Active Effects using the `system.armor` OVERRIDE mode kick in transparently. |

### Automation in the Monster Creator

The [Monster Creator's](Exploration#monster-creator) Ability Quick Picks use badges to show what Crawler will do. A green ✓ means the ability is automated, ⚠ means it is catalogued but not automated, and 📖 marks reference text. An unautomated ability still appears on the NPC sheet, but Crawler does not run rules for it.

The generated [`docs/audit/abilities.md`](https://github.com/DimitroffVodka/vagabond-crawler/blob/main/docs/audit/abilities.md) report lists automation coverage across the bestiary.

<details>
<summary>Implementation note for module developers</summary>

`vagabond-character-enhancer` wraps the system's spell and damage helpers in its `ready` hook. Crawler registers its relevant wrap in `setup`, which lets it receive VCE's combined Favor and Hinder state. See the repository's contributor documentation before extending this chain.

</details>

---

### Flanking Checker

During combat, two allied tokens within 5 feet can flank a foe no more than one size larger than the flankers. The foe gains **Vulnerable**. This works in both directions: heroes can flank NPCs, and NPCs can flank heroes. The GM client evaluates the positions and records the effect Crawler added, so removing a flank does not remove Vulnerable from some other spell or ability. Unlinked NPC tokens are supported.

### Countdown Dice Auto-Roller

At the start of each round, Crawler rolls non-recharge countdown documents such as burning, poison, and bleeding. A roll of 1 shrinks or expires the die, and supported tick damage applies through Vagabond. Crawler spaces the rolls out when Dice So Nice is active so their animations do not overlap. **Auto-Roll Countdown Dice** is on by default and can be disabled in Crawler's Combat settings.

> **Version 1.18.0 limitation:** the round-start and combat-end queries do not check whether a countdown belongs to the active combat. An unrelated non-recharge countdown elsewhere in the world may roll or be removed.

### Morale Check

Crawler checks morale after the first enemy death in a group, when half the original enemy group has fallen, or when a solo enemy drops to half HP. It rolls `2d6` against the surviving leader's Morale and whispers **HOLDS** or **FAILS** to the GMs. Version `1.18.0` does not ask for confirmation first. What a failed check means at the table is still the GM's call.

### Animation FX

Crawler plays configured FX for weapons, alchemical items, gear, and NPC actions when Sequencer and JB2A are available. The config window has tabs for Weapons, Skill Fallbacks, Alchemical, Gear, NPC Actions, and Settings. Individual items and NPC actions can override those defaults. Spells remain the Vagabond system's responsibility, and `system.itemFx` synchronization is kept only as a legacy escape hatch. The [developer reference](https://github.com/DimitroffVodka/vagabond-crawler/blob/main/docs/dev/combat-tools.md) explains the ownership split.

### Chat Dice Tooltips

Hover a rolled die in a compatible chat card to see its formula and individual results. For example, a `2d6` damage roll can show `2d6 → [4, 2]`. Attack tooltips include the d20 and the modifiers captured by the message.
