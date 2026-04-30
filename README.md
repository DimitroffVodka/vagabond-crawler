# Vagabond Crawler

![Foundry v13](https://img.shields.io/badge/foundry-v13-green?style=for-the-badge)
![System](https://img.shields.io/badge/system-vagabond-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.16.1-orange?style=for-the-badge)

A comprehensive dungeon crawl management module for the **Vagabond RPG** system in Foundry VTT. Everything you need to run a crawl — turn tracking, movement enforcement, random encounters, light management, morale, combat automation, crafting, loot, and more — from a unified interface.

---

<!-- hero-gifs-grid: sub-project 2 fills this block with 3-4 hero gifs -->

---

## Headline Features

- **[Crawl Strip](docs/crawl-loop.md#crawl-strip)** — Top-of-screen HUD for all players. Portraits, HP, status, one-click actions, movement budgets, combat dropdown.
- **[Encounter System](docs/exploration.md#encounter-system)** — Random checks, Roll Table builder, NPC browser with filters, inline Monster Creator.
- **[Monster Creator](docs/exploration.md#monster-creator)** — Build or mutate NPCs in a dedicated window with automation-status badges on abilities.
- **[Hit Die Configuration](docs/exploration.md#hit-die-configuration)** — Per-monster Hit Die (`d4`–`d14`), optional roll-on-spawn for fresh HP each token drop, and a size→die config window with bestiary fallback.
- **[Light Tracker](docs/exploration.md#light-tracker)** — 12 light sources, lantern fuel, real-time burn, canvas drop/pickup, party token transfer.
- **[Loot Generator](docs/crafting-loot.md#loot-generator)** — Roll on core Vagabond Level 1-10 tables; "Give to Player" chat buttons; auto-drop on NPC defeat.
- **[Relic Forge](docs/crafting-loot.md#relic-forge)** — Craft custom equipment with relic powers, auto-generated names, equip-gated effects.
- **[Spell Scroll Forge](docs/crafting-loot.md#spell-scroll-forge)** — One-shot spell scrolls from any compendium spell; no mana, no Cast Check.
- **[Merchant Shop](docs/crafting-loot.md#merchant-shop)** — Compendium or NPC merchants; players buy, sell, and gamble on loot tables.
- **[Session Recap](docs/session-tracking.md#session-recap)** — Combat stats, loot log, XP tracking, per-player breakdowns, Discord export.
- **[NPC Abilities](docs/combat.md#npc-abilities)** — Magic Ward, Pack Instincts/Tactics/Hunter, Nimble, Soft Underbelly — automated at the table.
- **[Flanking & Countdown Dice](docs/combat.md#flanking-checker)** — Auto-apply Vulnerable on flanks; auto-roll round-start countdown dice with tick damage.
- **[Trap Builder](docs/exploration.md#trap-builder)** — Visual authoring for Scene-Region macro traps with save, VFX, damage, status effects.

---

## Requirements

- **Foundry VTT** v13+
- **Vagabond** system v4.1.0+

### Optional
- **vagabond-character-enhancer** — Class feature automation, alchemy
- **Sequencer + JB2A** — Visual effects for spells, traps, and attacks

### Recommended
- **Damage Log** — Enables damage and kill tracking in Session Recap

---

## Installation

Paste the following manifest URL into Foundry's module installer:

```
https://github.com/DimitroffVodka/vagabond-crawler/releases/latest/download/module.json
```

---

## Documentation

- [Crawl Loop](docs/crawl-loop.md) — Crawl Strip, Movement, Clock, Rest
- [NPC Combat Automation](docs/combat.md) — Abilities, flanking, morale, countdown
- [Exploration](docs/exploration.md) — Encounters, Monster Creator, Light
- [Crafting & Loot](docs/crafting-loot.md) — Relic/Scroll Forge, Loot Generator, Merchant
- [Session Tracking](docs/session-tracking.md) — Recap, XP
- [Player Quick Reference](docs/player-quickref.md)
- [Contributor Reference](docs/dev/) — architecture and internals

---

## Authors

- **DimitroffVodka**

---

*This module is an independent community project for the Vagabond RPG system and is not affiliated with Land of the Blind, LLC.*
