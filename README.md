# Vagabond Crawler

![Foundry v13](https://img.shields.io/badge/foundry-v13-green?style=for-the-badge)
![System](https://img.shields.io/badge/system-vagabond-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/version-0.2.121-orange?style=for-the-badge)

A comprehensive dungeon crawl management module for the **Vagabond RPG** system in Foundry VTT. Everything you need to run a crawl — turn tracking, movement enforcement, random encounters, light management, morale, and combat integration — all from a unified interface.

---

## Features

### 🗺️ Crawl Bar (GM Only)
A persistent bottom bar that drives the entire crawl loop. Visible only to the GM.

- **Start / End Crawl** — Activates the crawl state and populates the tracker
- **Two-phase turn structure** — Heroes Turn → GM Turn → repeat
- **Next Turn** — Advances the phase and increments the turn counter
- **Add Tokens** — Select tokens on the canvas and add them to the tracker with one click
- **Time Passes** — Advances in-world time by a configurable number of minutes (default 10)
- **Encounter Check** — Rolls a d6; on a 1, posts an encounter alert to chat (GM-only whisper optional)
- **Encounter Roller** — Opens a full encounter builder with drag-and-drop NPC table creation, RollTable integration, distance and reaction rolls, and token placement
- **Light Tracker** — Opens the light management panel
- **Start Combat** — Transitions the crawl into combat mode, pausing crawl movement
- **Rest / Breather** — Opens the rest dialog for full recovery or ration-based healing
- **Resume Crawl** — Returns from combat back to crawl mode
- **Drag-and-drop reordering** — Reorder tracker members by dragging

---

### 🎴 Crawl Strip (All Players)
A top-of-screen HUD bar showing all combatants at a glance. Visible to all players during an active crawl.

- **Portrait cards** for every hero and NPC with HP bar, status pills, and name
- **Hero cards** show Luck, remaining movement, and HP
- **Active/dim state** — Cards highlight when it's that faction's turn, fade when not
- **Current turn indicator** — The active combatant gets a chevron badge
- **Defeated indicator** — Skull overlay on defeated tokens (or auto-hide if enabled in settings)
- **Click to select** — Single-click a card to select and pan to that token
- **Double-click to open sheet** — Opens the actor's character sheet
- **Groups swap sides** — When all heroes have acted, NPCs move to the left and heroes to the right
- **Sorted by combat order** — During combat, cards match the order in the Combat Tracker
- **Responsive sizing** — Cards scale to fit available screen space between the scene controls and sidebar

#### Combat Mode (Strip)
When combat is active the strip gains additional controls:

- **Round indicator** — Shows current combat round (R1, R2, etc.) in the left badge
- **Navigation arrows** — Previous Round / Previous Turn / Next Turn / Next Round buttons in the left badge
- **Activate / End Turn button** — Hover over any card to reveal a green play button; click to activate that combatant's turn. Button turns red while their turn is active; click again to end it

#### NPC Action Menu
During combat, hovering a card reveals a tab strip with quick-access action menus:

- **Weapons** — Roll attacks directly from the HUD
- **Spells** — Opens the spell cast dialog (see below)
- **Actions** — One-click NPC actions
- **Abilities** — NPC special abilities

---

### ✨ Spell Cast Dialog
Launched from the NPC Action Menu spell tab. A compact popup for configuring and casting spells without opening the full character sheet.

- Select delivery type (Touch, Remote, Cone, Line, Sphere, Aura, etc.)
- Adjust damage dice count
- Toggle include effect on/off
- Increase delivery range/area
- Preview and place area templates directly on the canvas
- Mana cost calculated live
- **Focus Spell toggle** — Mark a spell to be focused after a successful cast, adding it to the caster's Focus track and applying the Focusing status effect

---

### 👣 Movement Tracker
Enforces Vagabond's movement rules on tracked tokens.

**Crawl mode:**
- Hard-blocks movement beyond the token's crawl speed
- Deducts movement as the token moves
- Movement resets at the start of each crawl turn

**Combat mode:**
- Deducts movement as the token moves
- Color-coded ruler: green (within speed), yellow (using double move), red (over limit)
- Does not hard-block in combat — players can choose to exceed their speed

Movement remaining is displayed on each hero's card in the strip.

---

### 💡 Light Tracker
Tracks light source burn time for torches, lanterns, and candles carried by party members.

- Automatically detects torches, hooded lanterns, bullseye lanterns, and candles in actor inventories
- Burns time when **Time Passes** is clicked
- **Real-time burn** option (configurable) — burns light in real time at 1 real second = 1 game second, pausing when Foundry is paused
- Lights-out warning when a source is about to expire
- Drop a light source on the canvas as a temporary illumination token
- Pick up dropped lights via the Token HUD
- Toggle lights on/off from the inventory right-click context menu

Supported light sources: Torch, Lantern (Hooded), Lantern (Bullseye), Candle

---

### ⚔️ Morale Checker
Automatically triggers morale checks at the correct moments during combat.

- **First death** — Triggers when the first NPC is defeated
- **Half the group defeated** — Triggers when 50% of NPCs are down
- **Solo morale** — For single-enemy encounters, triggers when the enemy drops to half HP
- Posts morale check prompts to chat at the right time without manual GM tracking

---

### 🍖 Rest & Breather
A combined dialog for managing recovery between encounters.

- Shows all player characters with current HP, Luck, Mana, Fatigue, Might, and Ration count
- **Breather** — Consume a ration to heal; calculates healing based on Might
- **Rest** — Full recovery of HP, Luck, and Mana; reduces Fatigue; consumes rations
- Warns when characters have no rations
- Applies all updates in one click

---

### 🎲 Encounter Tools
**Encounter Check** — A quick d6 roll. On a 1, posts an encounter alert to chat. Configurable as GM-only whisper or visible to all players.

**Encounter Roller** — A full encounter building and rolling tool:
- **Build Table tab** — Drag NPC actors onto numbered slots to build a custom encounter table, then save it as a Foundry RollTable
- **Roll Tables tab** — Select any world RollTable and roll it for an encounter result
- **Result panel** — Shows monster type and count, rolls distance (Close / Near / Far) and reaction (Violent through Friendly) automatically
- Reroll distance or reaction independently
- Post the result to chat or place tokens directly on the canvas

---

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Default Time Passes (minutes) | How many minutes advance per Time Passes click | 10 |
| Encounter Roll: GM Only | Whisper encounter check results to GM only | On |
| Hide NPC Names in Strip | Remove NPC names from cards in the top bar | Off |
| Auto-Hide Defeated Tokens | Hide defeated tokens from the strip instead of showing a skull | Off |
| NPC Action Menu | Show weapon/spell/action hover menus on cards during combat | On |
| Real-Time Light Burn | Burn light sources in real time (1 real sec = 1 game sec) | Off |
| Movement Enforcement | Block or warn when tokens exceed their movement allowance | On |

---

## Requirements

- **Foundry VTT** v13+
- **Vagabond** system v4.1.0+

### Optional
- **vagabond-extras** — Some features complement the extras module
- **lib-wrapper** — Recommended for compatibility with other movement-modifying modules

---

## Installation

Paste the following manifest URL into Foundry's module installer:

```
https://github.com/DimitroffVodka/vagabond-crawler/releases/latest/download/module.json
```

Or search for **Vagabond Crawler** in the Foundry module browser.

---

## Authors

- **Patrick**
- **DimitroffVodka**

---

*This module is an independent community project for the Vagabond RPG system and is not affiliated with Land of the Blind, LLC.*
