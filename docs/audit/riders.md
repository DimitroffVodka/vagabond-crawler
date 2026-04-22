# NPC Action/Ability Rider Survey

**Generated:** 2026-04-22 (survey against committed `monsters.json` dataset, 348 NPCs)

Rider = the "*pass [Save] or &lt;effect&gt;*" clause that rides on top of an action or ability's attack roll. This doc inventories every rider across the bestiary so schema design and automation coverage can be scoped from data instead of guesswork.

---

## Headline numbers

| Category         | Total | With text | With `[Save]` rider | % |
|------------------|------:|----------:|--------------------:|--:|
| Actions          |   800 |  505 (63%)|                  49 | **6.1%** |
| Abilities        |   446 |  441 (98%)|                  34 | **7.6%** |
| **Total riders** | **—** |     **—** |              **83** |    — |

**Out of 1,246 action+ability entries, only 83 have a save rider.** That's a manageable audit surface — every rider can be hand-reviewed against whatever schema we land on.

## Save-type distribution

|          | Endure | Will | Reflex |
|----------|-------:|-----:|-------:|
| Actions  |     44 |    5 |      1 |
| Abilities|     11 |   21 |      2 |

- **Action riders are overwhelmingly Endure** (90%) — hits, bites, physical contact → body saves.
- **Ability riders skew Will** (62%) — gazes, fear auras, charms → mind saves.
- Only 3 total Reflex saves across the whole dataset.

## Payload frequency (what the rider applies on save-fail)

### Actions (49 riders)
| Payload        | Count | Notes |
|----------------|------:|-------|
| **Sickened**   |    31 | **The canonical rider effect** — ~63% of all action riders |
| **CountdownDie** |  31 | `Cd4`/`Cd6`/`Cd8` timer on the status |
| Fatigue        |    11 | `+1 Fatigue` flat, or `+1 Fatigue each Round` while Sickened |
| Cursed         |     8 | Often with a text description (*"turned to stone until this Being dies"*, *"Vampirism"*, *"Lycanthropy"*) |
| Paralyzed      |     7 | Usually nested: *"Sickened (Cd4, Paralyzed)"* |
| Dazed          |     3 | Usually 1-round duration |
| Unconscious    |     3 | Nested under Sickened |
| NegativeMod    |     3 | `-1 penalty` on the save itself (Pit Fiend), `-3 penalty` (Viper Tree), etc. |
| Dead           |     2 | Basilisk / Mummy curse → stone or HP drain to zero |
| Prone          |     2 | Gibbering Mouther, Catoblepas |
| Burning        |     1 | Magmot |
| Charmed        |     1 | Tarantella witness-Charm |
| Blinded        |     1 | Necromancer Necrotic Blast |
| Deafened       |     1 | Necromancer Necrotic Blast |
| Vulnerable     |     1 | Tarantella dance |

### Abilities (34 riders)
| Payload        | Count | Notes |
|----------------|------:|-------|
| **CountdownDie** |  22 | Same timer pattern as actions |
| **Frightened** |    16 | Gaze and aura abilities — the ability-rider archetype |
| Restrained     |     6 | Web/grasp abilities |
| Sickened       |     4 | Less common in abilities than actions |
| ExtraDmg       |     3 | Raw damage riders |
| Burning        |     2 | |
| Dead           |     2 | Death gaze effects |
| Fatigue        |     2 | |
| Prone, Cursed, Charmed, NegativeMod | 1 each | |

### Co-occurrence (actions only — which payloads pair on the same rider)
| Pair                          | Count |
|-------------------------------|------:|
| **CountdownDie + Sickened**   |    10 |
| **Fatigue + Sickened**        |     8 |
| **Paralyzed + Sickened**      |     5 |
| Sickened + Unconscious        |     3 |
| CountdownDie + Paralyzed      |     2 |

**This is the canonical action-rider shape:** `Sickened (Cd[4/6/8], [secondary effect])`.

## The 80% case

Overwhelmingly, action riders look like:

> **and pass [Endure] or become Sickened (Cd6 [unit], [modifier/nested status]).**

Variants differ in:
- **Save type** (Endure / Will / Reflex)
- **Save modifier** (`-1 penalty`, `-3 penalty`, `+2 bonus` — rare, 3 of 49)
- **Countdown die** (`Cd4`/`Cd6`/`Cd8`/`Cd12`) + unit (`days`/`rounds`/`minutes`/`damage`/none)
- **Primary status** (Sickened most common, also Paralyzed / Cursed / Charmed / etc.)
- **Nested secondary effect** while the status lasts (`+1 Fatigue each Round`, `Paralyzed`, `drops to 0 HP`, etc.)

## Proposed rider schema

```jsonc
{
  "rider": {
    "save":        "endure" | "reflex" | "will",
    "saveModifier": 0,               // or -3..+2 for the handful that diverge
    "trigger":     "onDamage",       // default — fires if any damage lands
                                      // (Vagabond's die-drop defense makes onHit ≡ onDamage)
                                      // alternatives: "onCrit", "onUse" (for gazes/auras)
    "onFail": {
      "fatigue":   0,                // +1 / +2 flat fatigue
      "statuses":  ["sickened"],     // one primary + optional secondary
      "countdown": {                 // timer for the status
        "die":  "d6",                // d4 / d6 / d8 / d12
        "unit": "rounds"             // rounds / days / minutes / damage / none
      },
      "description": ""              // free-text for bespoke effects that don't fit structurally
                                      // (e.g. "turned to stone", "cursed with Lycanthropy")
    }
  }
}
```

Covers ≥80% of the dataset with five fields. The `description` escape hatch handles bespoke curses (Lycanthropy, Vampirism, "turned to stone") without forcing us to model every unique status.

## Edge cases worth knowing up front (not blockers)

These are the ~10% that deserve special handling or may not fit the schema cleanly:

| Monster | Rider | Why it's weird |
|---------|-------|----------------|
| **Spider, Giant Tarantella** | Bite | Multi-save cascade — *witnesses* must also save vs Charmed when the primary target is dancing. Nested rider. |
| **Vampire** | Bite | Two simultaneous effects: attacker heals + target saves vs Lycanthropy-style curse. Life-drain + rider. |
| **Shadow** | Life Drain | On-death transformation — if this kills the target, it rises as a Shadow. |
| **Gibbering Mouther** | Bite | Size-gated rider — only Medium or smaller. |
| **Otyugh** | Tentacle (Restraining) | Conditional rider — only if target is already Restrained. |
| **Scorpion, Giant** / **Spider, Giant** | Bite | "*pass [Endure] against Sickened or …*" phrasing — reads like save-vs-becoming-Sickened but structurally ambiguous. |
| **Zombie, Boomer** | Boom | Self-destruct — *"This Being dies"* after the attack. |
| **Medusa** | Snakebite | Payload is *"Sickened (drops to 0 HP)"* — severity unique. |
| **Living Statue, Iron** | Iron Absorption (ability) | Attacker's *weapon* becomes absorbed. Unique "on-get-hit" reaction ability. |
| **Achaierai** | Smoky Escape | AoE zone (10-ft sphere) — all targets in area save, not the direct attack target. |
| **Pit Fiend** | Symbol of Pain (ability) | Passive aura — `Cursed (Cd6, -4 penalty to Attack Checks and a -2 to [Reflex] Saves)`. Rider on the *cursed status itself*, not on a save. |
| **Pit Fiend / Viper Tree / Giant Crab Spider** | Bite | Save has a modifier (`-1`, `-3`, `+2`) — trivial schema extension (`saveModifier: -3`). |

## Scope recommendation

1. **Phase 1 — build the schema + Save-or-Else panel + resolver for the 80% case.** `save` + `saveModifier` + `trigger: onDamage` + `onFail: { fatigue, statuses, countdown, description }`. Covers ~72 of 83 riders cleanly.
2. **Phase 2 — migrate the bestiary.** Parse `extraInfo` text with the regex patterns documented above and populate the new fields. For the ~11 edge cases, populate `description` with the raw text and leave `statuses`/`countdown` empty so the GM narrates it manually.
3. **Phase 3 — special-case handlers.** Only implement after Phase 1/2 are shipped and the common path is battle-tested. Each edge case (multi-save cascade, on-death transform, AoE saves, size-gate) is its own small feature.

The key insight: the dataset is **far more uniform than it looks**. One schema with five fields and an escape-hatch `description` covers the canonical pattern. The bestiary text already mostly adheres to a template — the heavy lift is the parser, not the schema.

## Full rider list — actions (49)

*See [riders-actions.md](riders-actions.md) for the complete dump if needed — omitted here for brevity.*

## Full rider list — abilities (34)

*See [riders-abilities.md](riders-abilities.md) for the complete dump if needed — omitted here for brevity.*
