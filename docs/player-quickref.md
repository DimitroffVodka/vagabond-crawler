# Player Quick Reference — Foundry VTT + Vagabond Crawler

## Keyboard Shortcuts

### Navigation
| Key | Action |
|---|---|
| Arrow Keys / Numpad | Pan the map |
| E / Numpad + | Zoom in |
| Q / Numpad - | Zoom out |
| Tab | Cycle between scenes |
| Space | Pause/unpause (GM only) |

### Token Controls
| Key | Action |
|---|---|
| T | Target a token (click token while holding T, or select + press T) |
| C | Open your character sheet |
| R | Activate the ruler (measure distance) |
| F | Place a waypoint while using the ruler |
| M | Move selected token to cursor (Hover Distance module) |
| Delete | Delete selected object |

### Rolling
| Modifier | Effect |
|---|---|
| Normal click | Roll normally |
| Shift + click | Roll with Favor (advantage) |
| Ctrl + click | Roll with Hinder (disadvantage) |

### Macro Bar
| Key | Action |
|---|---|
| 1-0 | Execute macro in slot 1-10 |
| Alt + 1-5 | Switch macro page |

### General
| Key | Action |
|---|---|
| Escape | Close open dialog/window |
| Ctrl + Z | Undo |
| Ctrl + C / V / X | Copy / Paste / Cut |
| Alt (hold) | Highlight objects on current layer |

---

## Mouse Controls

| Action | How |
|---|---|
| **Select token** | Left-click on token |
| **Move token** | Left-click and drag, or double-click destination |
| **Target token** | Hold T + left-click on token, or double-right-click |
| **Pan map** | Right-click and drag |
| **Zoom** | Scroll wheel |
| **Open character sheet** | Double-click your token |
| **Measure distance** | Hold R + click and drag |
| **Rotate token** | Shift + scroll wheel on selected token |
| **Place waypoint (ruler)** | Left-click while ruler is active |

---

## Foundry VTT Basics

### Sidebar Tabs (right side)
| Icon | Tab | What it does |
|---|---|---|
| Chat bubble | **Chat** | Chat messages, dice rolls, damage cards |
| Swords | **Combat** | Turn order during encounters |
| People | **Actors** | Character and NPC sheets |
| Suitcase | **Items** | World items |
| Book | **Journals** | Notes, handouts, countdown dice |
| Tables | **Roll Tables** | Random tables (loot, encounters) |
| Music note | **Playlists** | Audio and music |
| Puzzle | **Compendiums** | Pre-built content packs |
| Gear | **Settings** | Game settings and module config |

### Chat Commands
| Command | What it does |
|---|---|
| `/r 1d20` | Roll dice |
| `/r 2d6+3` | Roll with modifier |
| `/w [name] message` | Whisper to a player |
| `/ic message` | Speak in character |
| `/ooc message` | Out of character message |

### Targeting
- **Why target?** Targeting tells the system WHO your attack/spell is aimed at. Saves, damage, and status effects use this.
- **How:** Hold T + click the enemy token, OR double-right-click the token.
- **Clear targets:** Press T on empty space, or Escape.
- Orange arrows on a token = you're targeting it.

### Saves (Damage Cards)
When you take damage, the chat shows save buttons:
- **Reflex** (dodge) — Hindered in heavy armor, or vs ranged/cast attacks
- **Endure** (block) — Shield negates ranged hinder
- **Will** (resist) — Mental/psychic effects

Click the appropriate save button. Shift+click for Favor, Ctrl+click for Hinder.

---

## Vagabond Crawler — Player Features

### Crawl Strip (top of screen)
- Shows all party members with HP, speed, and status
- Your portrait appears with current HP and movement remaining
- During **Heroes Turn**: you can move your token (speed is enforced)
- During **GM Turn**: the GM controls the action
- During **Combat**: movement tracks both normal speed and Rush

### Inventory
- **Right-click** an item in inventory for context menu (Light, Use Scroll, etc.)
- **Stacking**: Duplicate items auto-merge when added. Quantity shown as ×N badge.
- **Zero-slot items** (rations, coins, backpacks): free, same as the core rules.
- **Stacks cost slots**: a stack of N costs N × the item's slot value (2 torches = 2 slots).
- Slot cost comes from the item, not its name — a plain **Candle** is zero-slot (free), an alchemical **Candle, Basic** costs 1.
- **Spell Scrolls**: Right-click → "Use Scroll" to cast. No mana, no roll. Scroll is consumed.

### Light Sources
- Right-click a torch, lantern, candle, or sunrod → **Light** to activate
- Light sources burn in real-time during the crawl
- **Torches**: 1 hour, consumed when burned out
- **Lanterns**: require oil. 1 flask = 1 hour. Auto-refuel if you have more oil.
- **Candles**: 1 hour, 5ft radius (dim light)
- Extinguish by right-clicking → **Extinguish**. Remaining time is saved.

### Combat
- **Countdown dice** auto-roll at the start of each round (burning, poison, etc.)
- **Flanking**: If 2+ allies are adjacent to an enemy, it becomes Vulnerable
- **Movement**: Enforced during crawl and combat. Rush allows 2× speed in combat.

### Weapons & Attacks
- Click a weapon in the crawl strip action menu to attack
- **Target first**, then attack — the system checks Vulnerable, Favor/Hinder automatically
- Shift+click for Favor, Ctrl+click for Hinder on any roll

---

## See also

- [Crawl Loop](crawl-loop.md) — how the turn structure and movement budget work
- [NPC Combat Automation](combat.md#flanking-checker) — why your character sometimes gets Vulnerable automatically
- [Crafting & Loot — Item Drops](crafting-loot.md#item-drops) — picking up items from the canvas
- [Session Recap](session-tracking.md#session-recap) — type `!recap` in chat to see session stats
