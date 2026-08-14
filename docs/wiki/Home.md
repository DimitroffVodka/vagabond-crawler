# Vagabond Crawler

Vagabond Crawler adds dungeon-crawl tools to the **Vagabond RPG** system in Foundry VTT. It handles crawl turns, movement, encounters, light, morale, combat automation, crafting, and loot from the game canvas.

---

## What it adds

- **[Crawl Strip](Crawl-Loop#crawl-strip):** a top-of-screen party HUD with portraits, HP, status, actions, movement budgets, and combat controls.
- **[Encounter System](Exploration#encounter-system):** random checks, a RollTable builder, an NPC browser, and Monster Creator in one window.
- **[Monster Creator](Exploration#monster-creator):** build or mutate world NPCs and see which abilities Crawler can automate.
- **[Hit Die Configuration](Exploration#hit-die-configuration):** choose a Hit Die from `d4` to `d14`, roll fresh HP on spawn, or map dice by creature size.
- **[Light Tracker](Exploration#light-tracker):** track 12 light sources, lantern oil, burn time, and lights left behind on the canvas.
- **[Loot Generator](Crafting-and-Loot#loot-generator):** roll the core Vagabond Level 1–10 tables, show the result in chat, or give it to a player-owned character.
- **[Relic Forge](Crafting-and-Loot#relic-forge):** add relic powers and equipment-dependent effects to weapons, armor, and gear.
- **[Spell Scroll Forge](Crafting-and-Loot#spell-scroll-forge):** create one-use spell scrolls from `vagabond.spells` that cost no mana and skip the Cast Check.
- **[Merchant Shop](Crafting-and-Loot#merchant-shop):** run a curated shop or sell directly from an NPC's inventory. Optional tabs cover player sales, catalogs, and gambling.
- **[Session Recap](Session-Tracking#session-recap):** keep combat, loot, merchant, XP, and player statistics, then copy the recap as Markdown.
- **[NPC Abilities](NPC-Combat-Automation#npc-abilities):** automate Magic Ward, the Pack abilities, Nimble, and Soft Underbelly.
- **[Flanking and Countdown Dice](NPC-Combat-Automation#flanking-checker):** apply Vulnerable when a foe is flanked and roll supported countdowns at round start.

---

## Requirements

- **Foundry VTT** v14
- **Vagabond** system v4.1.0+

### Optional integrations

- **vagabond-character-enhancer:** class feature automation and alchemy.
- **Sequencer + JB2A:** visual effects for supported items and actions.
- **PSFX:** sound support for configured effects.

### Recommended integration

- **Damage Log:** supplies damage and some kill data to Session Recap.

---

## Install

Paste the following manifest URL into Foundry's module installer:

```
https://github.com/DimitroffVodka/vagabond-crawler/releases/latest/download/module.json
```

---

## Guides

- [Crawl Loop](Crawl-Loop): Crawl Strip, movement, clock, rest.
- [NPC Combat Automation](NPC-Combat-Automation): abilities, flanking, morale, countdowns.
- [Exploration](Exploration): encounters, Monster Creator, light.
- [Crafting and Loot](Crafting-and-Loot): Relic Forge, Scroll Forge, loot, merchants, and inventory.
- [Session Tracking](Session-Tracking): recap and XP.
- [Player Quick Reference](Player-Quick-Reference)
- [Contributor Reference](https://github.com/DimitroffVodka/vagabond-crawler/tree/main/docs/dev/): architecture and internals.

---

## Author

- **DimitroffVodka**

---

*This module is an independent community project for the Vagabond RPG system and is not affiliated with Land of the Blind, LLC.*
