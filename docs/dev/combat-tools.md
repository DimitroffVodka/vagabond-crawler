# Combat Tools — Technical Reference

Module: `vagabond-crawler`
System: Vagabond v4.x (Foundry VTT v13)

---

## Architecture

| File | Role |
|---|---|
| `scripts/npc-action-menu.mjs` | Action/spell menus on crawl strip cards, spell casting dialog |
| `scripts/npc-abilities.mjs` | NPC passive ability automation (Magic Ward, target modifiers) |
| `scripts/flanking-checker.mjs` | Auto-flanking detection and Vulnerable application |
| `scripts/chat-tooltips.mjs` | Hover tooltips on damage/roll dice in chat cards |

---

## Action Menu

During combat, hovering a card on the crawl strip reveals a dropdown panel with the actor's available actions.

### Tab Layout

| Actor Type | Tab A | Tab B | Tab C |
|---|---|---|---|
| NPC | Actions | Abilities | — |
| Player | Weapons | Spells | Craft (if Alchemist) |

### Menu Data

- **NPC Actions**: Read from `actor.system.actions[]` — name + damage preview
- **NPC Abilities**: Read from `actor.system.abilities[]` — name only
- **Weapons**: Equipped items with `equipmentType === "weapon"` and `equipmentState !== "unequipped"` — name + damage (one-hand or two-hand)
- **Spells**: All items with `type === "spell"` — shows "effect" or "spell" tag
- **Craft**: Alchemist's known formulae — each shows "5s" cost

### Panel Positioning

The floating panel is appended to `#vagabond-crawler-strip` (not inside the card) to avoid `overflow:hidden` clipping. It's positioned absolutely relative to the card wrap.

Hide/show uses a 200ms timer — hovering the card or panel keeps it alive, leaving both schedules hide.

### Action Firing

| Type | Behavior |
|---|---|
| `action` | `VagabondChatCard.npcAction(actor, action, index, targets)` |
| `ability` | `VagabondChatCard.npcAction(actor, ability, index)` |
| `weapon` | `item.rollAttack()` → `item.rollDamage()` → `VagabondChatCard.weaponAttack()` + FX |
| `spell` | Opens `CrawlerSpellDialog` |
| `craft` | `craftItem(actor, craftName, true)` (5s quick craft) |

Weapon attacks respect the actor's `favorHinder` state and trigger alchemical post-attack hooks automatically via `createChatMessage`.

### Spell Dialog (`CrawlerSpellDialog`)

ApplicationV2 window for casting spells with full control over:

- **Damage Dice**: Increment/decrement d6 count (extra dice cost +1 mana each)
- **Include Effect**: Toggle spell effect on/off (+1 mana if combined with damage)
- **Delivery Type**: Select from system's `CONFIG.VAGABOND.deliveryTypes` — each has a base cost (reduced by `bonuses.deliveryManaCostReduction`)
- **Delivery Increase**: Expand area/targets (+cost per increment from `CONFIG.VAGABOND.deliveryIncreaseCost`)
- **Template Preview/Place**: Sphere, cube, aura, cone, line templates on the canvas
- **Focus**: Toggle sustained spell tracking after cast
- **Mana Display**: Shows total cost vs current mana vs casting max

#### Cast Flow

1. Validate delivery type, mana sufficiency, casting max
2. Import `VagabondRollBuilder` for d20 roll with favor/hinder
3. Set `_isCastCheck = true` so cast-check target modifiers + Nimble apply to the roll
4. On success: deduct mana, apply focus if toggled
5. Roll damage via `VagabondDamageHelper.rollSpellDamage()`
6. Create chat card via `VagabondChatCard.spellCast()`
7. Play spell FX via `VagabondSpellSequencer`
8. Reset dialog state and close

---

## NPC Abilities (`npc-abilities.mjs`)

### Passive Abilities Table

```js
PASSIVE_ABILITIES = {
  "Magic Ward I":    { type: "manaSurcharge", surcharge: 1 },  // I–VI: +1…+6 mana
  "Pack Instincts":  { type: "packInstincts" },                // also Pack Tactics / Pack Hunter
  "Nimble":          { type: "nimble" },
  "Soft Underbelly": { type: "softUnderbelly" },
}
```

Keyed by exact `actor.system.abilities[].name` string.

### Magic Ward Implementation

Magic Ward is a **mana surcharge**: the first time each combat round a warded
being is unwillingly affected by a spell, the caster pays +N extra mana (out of
combat, every cast triggers it). It is **not** a roll penalty die.

The system's current spell flow computes cost via the *static*
`SpellCastDialog.calculateCosts` (used by both the dialog preview/validation and
the real deduction in `SpellHandler._executeCast`); `SpellHandler.castSpell` now
only opens the dialog. Implemented by prototype-wrapping (see `_wrapSystemClasses`):

1. **`SpellCastDialog.calculateCosts` (static)** — wrapped to add the surcharge to
   `totalCost`. Single cost authority: feeds the dialog preview, the built-in
   mana/castingMax validation (an unaffordable cast is blocked), and the actual
   deduction in `_executeCast`.
2. **`vagabond.spellCastMessages` hook** — surfaces the surcharge in the cast
   dialog's message panel (display-only).
3. **`SpellHandler._executeCast`** — the actual cast chokepoint for both the
   dialog and legacy direct-cast flows. Wrapped to (a) hold `_isCastCheck` true
   across the spell roll, and (b) detect a successful cast (mana decreased) and
   flag each triggered ward so it doesn't charge again this round.
4. **`SpellHandler._calculateSpellCost`** — still wrapped, but only the inline
   favorited-spell row on the actor sheet reads it now; kept surcharge-aware so
   the row matches the dialog.
5. **`VagabondRollBuilder.buildAndEvaluateD20WithRollData`** — wrapped at `setup`
   (innermost vs. VCE) to apply target `incomingAttacksModifier` (Vulnerable,
   Prone, etc.) and the Nimble "can't be Favored" clamp to cast checks, gated on
   `_isCastCheck`. The system applies target modifiers for weapon attacks but not
   spell casts; this patches that gap.

The strongest ward among all targets is used (highest surcharge wins).

### External Integration

`setCastCheckFlag(val)`, `computeWardSurcharge`, and `flagWardsTriggered` are
exported so the crawl strip's own NPC spell dialog (`CrawlerSpellDialog` in
`npc-action-menu.mjs`) can bracket its rolls with the same flag and run the same
ward-surcharge flow for NPC casts.

---

## Flanking Checker

### Settings

| Setting | Default | Description |
|---|---|---|
| `flankingEnabled` | `true` | Enable automatic flanking detection |

### Rules

A token is **flanked** (gains Vulnerable) when:
1. 2+ enemy tokens are **Close** (edge-to-edge distance = 0, i.e., adjacent/overlapping)
2. The target is **no more than one size larger** than the smallest flanker

Size hierarchy: small(0) < medium(1) < large(2) < huge(3) < giant(4) < colossal(5)

Bidirectional — heroes can flank NPCs and NPCs can flank heroes.

### Distance Calculation

`_distanceFt()` computes edge-to-edge Chebyshev distance between token bounding boxes, supporting multi-square tokens (Large 2×2, Huge 3×3, etc.).

### Vulnerable Effect

```js
{
  name: "Vulnerable (Flanked)",
  statuses: ["vulnerable"],
  origin: "module.vagabond-crawler.flanking",
  changes: [
    { key: "system.favorHinder",            mode: OVERRIDE, value: "hinder" },
    { key: "system.incomingAttacksModifier", mode: OVERRIDE, value: "favor"  },
    { key: "system.outgoingSavesModifier",   mode: OVERRIDE, value: "favor"  },
  ]
}
```

Tracked via `actor.flags.vagabond-crawler.flankedBy` to distinguish flanking-applied Vulnerable from other sources.

### Evaluation Triggers

- Token position changes (`updateToken`, `refreshToken`)
- Combat start, turn/round changes
- Combatant added/removed/defeated

Debounced at 250ms. Only runs on the GM client.

### Cleanup

All flanking Vulnerable effects are removed when combat ends (`deleteCombat` hook).

---

## Chat Tooltips

### Damage Dice Tooltips

Walks `.damage-dice-list` containers in chat messages, collects `.vb-die-wrapper` elements, and builds tooltips like:

```
2d6 → [4, 2]
```

Applied to each individual die wrapper on hover.

### Roll Dice Tooltips

Walks `.roll-dice-container` elements, reconstructs the formula from child elements (operators, modifiers, die wrappers), and displays:

```
1d20 + 1d6[favored]
d20 → [14] + d6 → [3]
= 17
```

Uses the `message.rolls[0]` object for formula and total when available.

### Registration

`renderChatMessageHTML` hook enriches new messages. A 1-second delayed scan enriches messages already on screen at load time.
