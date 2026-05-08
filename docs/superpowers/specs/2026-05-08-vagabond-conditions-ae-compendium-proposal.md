# Proposal: Modernize the `effects` Compendium for Foundry V14

**Audience:** Vagabond system maintainer.
**Date:** 2026-05-08.
**Status:** Modernization plan — design is already done on `old-v14`; this captures what changes to bring it forward to V14-native.
**Context:** Drafted during the Foundry V14 migration of vagabond-crawler. After confirming live V14 behavior, an inventory of the system fork at `DimitroffVodka/vagabond` showed substantial prior work on `old-v14` that pre-dates V14's primary-AE-document support and never landed on `main`. The `v14-test` branch is identical to `main` (used as a clean V14 test sandbox); `old-v14` is the actual abandoned design work.

---

## Existing prior work (do not redo)

The `old-v14` branch already contains everything needed in terms of *content design*:

| File | LoC | Purpose |
|---|---|---|
| `module/helpers/effects-compendium.mjs` | 2647 | 70 effect definitions across 5 categories, plus a `populate()` helper |
| `module/data/item-effect.mjs` | 54 | Custom Item subtype `effect` — a wrapper that holds embedded AEs (V13-era pattern) |
| `module/documents/active-effect.mjs` | +50 vs main | Custom `VagabondActiveEffect` with formula support (`@attributes.level.value`, `floor()`, etc.) and an attribute-key autocomplete returning every valid `system.X` path the system understands |
| `system.json` | (registers pack) | `{ name: "effects", type: "Item", path: "packs/effects" }` |

**Inventory of defined effects (70 total):**

| Category | Count | Examples |
|---|---|---|
| condition | 19 | Dazed, Prone, Frightened, Sickened, Confused, **Vulnerable**, Blinded, Invisible, Restrained, Incapacitated, Paralyzed, Unconscious, Dead, Berserk, Burning, Charmed, Focusing, Fatigued, Suffocating |
| buff | 23 | Damage / armor / speed / HP bonuses, ancestry buffs (Orc Hulking, Dwarf Tough, Elf Naturally Attuned, Nimble, Draken Scale), perk buffs (Tough, Pack Mule, Metamagic, Secret of Mana), gear buffs (Backpack), Brawl Check Favor, Spell-related |
| classFeature | 22 | Sorcerer Spell-Slinger Lv2/Lv10, Wizard Sculpt Spell Lv2/Lv10, Barbarian Rage chain (Rage, DR 1/die, DR 2/die, Rip and Tear, Aggressor, Fearmonger, Mindless Rancor, Bloodthirsty), Rogue (Sneak Attack 1d4/2d4/3d4, Lethal Weapon, Evasive), Bard (Bravado, Climax), Fisticuffs |
| debuff | 3 | Hindered (All Rolls), Damage Penalty (-2), Speed Penalty (-10ft) |
| material | 3 | Adamant (Weapon), Adamant (Armor), Mythral |

The mechanics are correct. The change keys (`system.favorHinder`, `system.armor`, `system.universalDamageBonus`, etc.) match what modules already read. **Nothing about the design itself needs to change.**

What needs to change is the **technical shape** so it loads as a V14-native AE compendium that modules can `fromUuid` and that GMs can drag from compendium directly onto tokens.

---

## Why V14 changes the picture

V14 promoted ActiveEffect to a top-level compendium document type. Before V14, AEs could only exist as embedded children of Actors/Items — the `old-v14` wrapper-Item-of-subtype-`effect` is the V13-era workaround. With V14:

- AE compendiums are first-class. `type: "ActiveEffect"` in `system.json` packs.
- Drag-from-compendium onto a token applies the effect directly — no script needed.
- Modules can do `fromUuid("Compendium.vagabond.effects.ActiveEffect.<id>")` and clone the document instead of constructing AE data inline.
- The wrapper Item subtype becomes obsolete — its only job was "carry an AE through a compendium" which V14 does natively.

The Crawler currently builds these inline (from `flanking-checker.mjs` and `npc-abilities.mjs`):

| Crawler-built effect | Equivalent in `old-v14` effects-compendium |
|---|---|
| Vulnerable (Flanked) | **Vulnerable** (already defined, identical changes) |
| Vulnerable — Saves (Flanked) | system-internal plumbing — no public equivalent |
| Pack Instincts (active) | not in compendium (NPC ability transient) |
| Soft Underbelly (Prone) | not in compendium (NPC ability transient) |

If the system ships Vulnerable with a stable UUID, the Crawler's flanking-checker reduces from a 15-line `_makeEffectData()` to a 3-line `fromUuid → toObject → tag`. Net code reduction across the migration: ~40 lines.

---

## What changes vs `old-v14`

### A. `system.json` pack type

```diff
   {
     "name": "effects",
     "label": "Effects",
     "path": "packs/effects",
-    "type": "Item",
+    "type": "ActiveEffect",
     "system": "vagabond"
   }
```

### B. Drop the wrapper Item subtype

`module/data/item-effect.mjs` (the `VagabondEffect` Item subtype with `category` and `durationHint` fields) becomes obsolete. The `category` field is replaced by either:
- Compendium folders (V14 supports folders inside compendiums, organized via the `_folder` field on each document), OR
- A `flags.vagabond.category` string that the directory UI groups by.

Either works. Folders are more native and surface in the compendium directory tree; flags require a UI helper to group.

`durationHint` becomes irrelevant — V14's expanded duration model (rounds + seconds + turns + new units in `CONST.ACTIVE_EFFECT_TIME_DURATION_UNITS`) covers what the hint was approximating, and the AE config UI already shows duration text from those fields.

If anything still references the `effect` Item subtype anywhere (sheets, rolls, item handlers), audit those before deleting.

### C. Keep `VagabondActiveEffect` (with adjustments)

`module/documents/active-effect.mjs` is **valuable and forward-compatible**. The formula support (`@attributes.level.value`, `floor()`, etc.) and the `getAttributeChoices()` autocomplete dropdown are V14-friendly and used by the Active Effect config sheet. Keep this class as the registered `CONFIG.ActiveEffect.documentClass`.

Two small adjustments:

1. **Drop the deprecated `Hooks.on("renderChatMessage", ...)` pattern** if it appears anywhere. V14 deprecated the jQuery-arg version in favor of `renderChatMessageHTML` (HTMLElement). 15 listeners on the deprecated hook were observed firing in the live V14 console — most are from VCE, but if any are in core, migrate them at the same time.

2. **`origin` is now a `DocumentUUIDField`** that silently nulls non-UUID strings on persist. Confirmed live in 14.361 — `origin: "module.vagabond-crawler.flanking"` round-trips as `null`, breaking the Crawler's effect-lookup-by-origin pattern. The fix on the Crawler side is migrating to `flags.vagabond-crawler.tag` (already done). On the system side, audit any code that reads `effect.origin === "system.vagabond.X"` or that sets a non-UUID origin string when creating effects. **This is not specific to the compendium effort — it's a general V14 concern that affects the whole system.**

### D. Per-entry data-shape migration

The existing entry shape:

```js
{
  name: 'Vulnerable',
  img: 'icons/svg/downgrade.svg',
  category: 'condition',
  description: 'Attacks and saves have Hinder. Attacks targeting it have Favor. Saves against its attacks have Favor.',
  effects: [{
    name: 'Vulnerable',
    img: 'icons/svg/downgrade.svg',
    statuses: ['vulnerable'],
    changes: [
      { key: 'system.favorHinder',             mode: 5, value: 'hinder' },
      { key: 'system.incomingAttacksModifier', mode: 5, value: 'favor'  },
      { key: 'system.outgoingSavesModifier',   mode: 5, value: 'favor'  }
    ]
  }]
}
```

V14-native shape (single document, no wrapper, `type:` strings, `system.changes`, stable `_id`):

```js
{
  _id: 'vulnerable000000',          // stable, hand-picked
  name: 'Vulnerable',
  img: 'icons/svg/downgrade.svg',
  description: 'Attacks and saves have Hinder. Attacks targeting it have Favor. Saves against its attacks have Favor.',
  statuses: ['vulnerable'],
  showIcon: 'always',
  system: {
    changes: [
      { key: 'system.favorHinder',             type: 'override', value: 'hinder' },
      { key: 'system.incomingAttacksModifier', type: 'override', value: 'favor'  },
      { key: 'system.outgoingSavesModifier',   type: 'override', value: 'favor'  }
    ]
  },
  duration: { rounds: null, seconds: null, turns: null, startRound: null },
  flags: {
    vagabond: { canonicalId: 'vulnerable', category: 'condition' }
  },
  transfer: false
}
```

Differences from old-v14:
- The outer wrapper (`name`, `img`, `category`, `description`, `effects: [...]`) collapses. There's only one document — the AE itself.
- `category` moves to `flags.vagabond.category` (or to a compendium folder).
- `mode: 5` (numeric OVERRIDE) → `type: 'override'` (string). Mapping table:

| Old `mode` | New `type` |
|---|---|
| 0 (CUSTOM) | `'custom'` |
| 1 (MULTIPLY) | `'multiply'` |
| 2 (ADD) | `'add'` |
| 3 (DOWNGRADE) | `'downgrade'` |
| 4 (UPGRADE) | `'upgrade'` |
| 5 (OVERRIDE) | `'override'` |

Note: `subtract` exists in V14 (`type: 'subtract'`) but `subtract` and `add` share the same numeric value 20 in `CONST.ACTIVE_EFFECT_CHANGE_TYPES` — the string is what disambiguates. Confirmed live in 14.361.

- `changes:` lifts up into `system.changes:`. (V14's back-compat shim populates both `effect.changes` and `effect.system.changes` regardless of where you write — confirmed live — but new content should target `system.changes` to survive the v16 shim removal.)
- `_id` becomes hand-picked stable. Pick a 16-char base64-ish identifier you'll never change. Modules will hardcode references; ID drift breaks them.
- `showIcon: 'always'` makes the token icon appear when applied. For purely-mechanical-no-icon effects (like the saves-mirror plumbing), use `'never'`.
- `flags.vagabond.canonicalId` lets modules find the right effect even if a GM duplicates the compendium for editing. Optional but cheap insurance.
- `transfer: false` — these are stand-alone library entries, not Item-attached buffs that auto-transfer to actors holding the item.

### E. The `populate()` script

The seeding logic in `effects-compendium.mjs` already iterates `EFFECT_DEFINITIONS` and creates documents in the pack. It needs three changes:

1. **Use the AE document class, not the Item document class.**
   ```diff
   - const itemData = { ...def, type: 'effect' };
   - const item = await pack.documentClass.create(itemData, { pack: pack.collection });
   + const aeData = transformDef(def);   // strip wrapper, lift mode→type, add _id
   + const ae = await pack.documentClass.create(aeData, { pack: pack.collection, keepId: true });
   ```

2. **`{ keepId: true }` so the hand-picked `_id` survives.** Without it, Foundry generates a fresh ID and your stable references break.

3. **Run idempotently.** If the populate script is re-run, it should `find` existing entries by `_id` (or `flags.vagabond.canonicalId`) and `update` instead of `create` — otherwise you get duplicates.

The category-to-folder mapping (currently `FOLDER_LABELS[cat]`) carries over: create folders inside the compendium and assign each AE document's `_folder` field to the folder ID.

### F. Verify `VagabondActiveEffect` is the documentClass

Whatever registers `CONFIG.ActiveEffect.documentClass = VagabondActiveEffect` needs to keep doing so in V14. The compendium documents are AE instances — they should use the system's custom AE class so the formula support and attribute autocomplete still work for GMs editing entries from the compendium.

---

## Tier 3 — Crawler-internal effects (optional inclusion)

These are created/destroyed by Crawler game logic (not user-driven), so they aren't natural drag-from-compendium candidates. But shipping them with stable IDs lets the Crawler `fromUuid` instead of building inline, which collapses ~40 lines of code:

| Name | Source | Current call site | Migration if shipped |
|---|---|---|---|
| Vulnerable (Flanked) | flanking-checker | `_makeEffectData()` constructs 3-change AE | Replace with `fromUuid` + clone + tag (could even subclass / clone the canonical Vulnerable and add the flag — same effect, different identifier) |
| Vulnerable — Saves (Flanked) | flanking-checker | saves-mirror for unlinked tokens; pure plumbing | Could ship with `showIcon: 'never'`, or keep inline |
| Pack Instincts (active) | npc-abilities | per-attacker effect with `outgoingSavesModifier=hinder` | Same pattern as Vulnerable — fromUuid + clone + tag |
| Soft Underbelly (Prone) | npc-abilities | `system.armor=0` priority 999 | Same pattern |

Cleaner alternative: **don't ship Tier 3 separately**. Have the Crawler clone the canonical `Vulnerable` AE, stamp a `flags.vagabond-crawler.tag: 'flanking'` discriminator, and apply. One canonical Vulnerable in the compendium; modules differentiate their instances via flags. Same approach for Pack Instincts (clone Vulnerable, tweak the changes — but at that point you might as well construct inline). Only Soft Underbelly is truly distinct.

Decide based on whether you want a "Pack Instincts" entry visible in the compendium directory or not.

---

## How modules consume after modernization

Module-side pattern (Crawler, VCE, others):

```js
// Constants file (per module)
const COND_VULNERABLE   = "Compendium.vagabond.effects.ActiveEffect.vulnerable000000";
const COND_FRIGHTENED   = "Compendium.vagabond.effects.ActiveEffect.frightened00000";
const COND_PRONE        = "Compendium.vagabond.effects.ActiveEffect.prone0000000000";

// Apply with module-specific tag for later identification
async function applyTaggedCondition(actor, uuid, tag) {
  const tpl = await fromUuid(uuid);
  if (!tpl) return null;
  const data = tpl.toObject();
  foundry.utils.setProperty(data, `flags.vagabond-crawler.tag`, tag);
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created;
}

// Lookup by tag
const myFlankingEffect = actor.effects.find(e =>
  e.flags?.["vagabond-crawler"]?.tag === "flanking"
);
```

This works because `fromUuid` returns the compendium document, `.toObject()` gives a plain JSON copy, and `flags` is a free-form area modules can stamp without modifying the source.

The Crawler's V14 migration on its end is already done — it identifies effects by `flags.vagabond-crawler.tag` instead of `origin` strings. Once the system compendium has stable Vulnerable / Pack Instincts / Soft Underbelly IDs, the inline `_makeEffectData()` calls swap to `fromUuid` clones in a single follow-up commit (~1 hour of work).

---

## Open questions for the system author

1. **Folders vs flags for category grouping?** V14 supports folders inside compendiums (the `_folder` document field). Folders are user-visible in the directory tree, flags require a UI helper to group. Recommendation: folders.
2. **Status-icon ↔ AE coupling.** Today the system probably has paths that call `actor.toggleStatusEffect("vulnerable")` independently of any AE. After this compendium ships, those paths could either migrate to compendium-AE-application (one source of truth) or stay separate (status icons for cosmetic flags, AEs for mechanical effects). Worth deciding before too many call sites depend on the current pattern.
3. **Crawler Tier 3 inclusion** — see the alternative above. Drop separate Pack-Instincts/Soft-Underbelly entries and let modules clone Vulnerable + tag? Or include them so they're visible in the directory?
4. **Schema versioning.** If a Tier 1 effect's mechanics change in v5.5.0, modules pinned to v5.4.x silently get the new behavior. A `flags.vagabond.schemaVersion` per AE lets modules sanity-check. Cheap, optional.
5. **Why was `old-v14` abandoned?** Was there a known-bad reason (broke something, V14 wasn't ready, performance issue), or just stalled before completion? If the latter, the modernization plan above should land cleanly. If the former, the reason needs to be addressed in this revision.

---

## Effort estimate

**System-side:**
- ~half a day to migrate `effects-compendium.mjs` entries to V14-native shape (mostly mechanical: lift `effects[0]` up, swap `mode` numbers for `type` strings, lift `changes` to `system.changes`, hand-pick stable `_id`s, set `showIcon`)
- ~1 hour for the populate script changes (`pack.documentClass` swap, `keepId: true`, idempotent upsert)
- ~1 hour to delete `module/data/item-effect.mjs` and audit any references to the `effect` Item subtype
- ~1 hour to flip `system.json` pack type and verify the populate script seeds correctly
- ~1 hour to add Soft Underbelly (Tier 3) if including it

**Crawler-side (follow-up after stable IDs ship):**
- ~1 hour to switch `flanking-checker.mjs` and `npc-abilities.mjs` from inline `_makeEffectData()` to `fromUuid`-clone-and-tag

**Total system-side: ~1 working day** for a complete migration of the existing design. The actual hard work — designing the conditions, writing accurate descriptions, deciding mechanics — is already done on `old-v14`.

---

## Live V14 ground-truth notes

These came out of the Crawler's V14 probe at Foundry 14.361 / vagabond 5.4.1, and inform the recommendations above:

- **`CONST.ACTIVE_EFFECT_MODES` still exists** in V14 with the same numeric values (CUSTOM=0 … OVERRIDE=5). Old code works via the back-compat shim. New content should be v14-native (`type:` strings + `system.changes`) to avoid deprecation warnings and survive the v16 shim removal.
- **`CONST.ACTIVE_EFFECT_CHANGE_TYPES.add` and `.subtract` both equal 20** in 14.361. Not a doc typo — confirmed live. The string key disambiguates.
- **The back-compat shim normalizes both shapes on read.** Any AE in V14 has BOTH `effect.changes` and `effect.system.changes` populated regardless of which form was passed at create time. New compendium content should write to `system.changes`.
- **`ActiveEffect.origin` is a `DocumentUUIDField` and silently nulls non-UUID strings on persist.** This bit the Crawler hard — `origin: "module.vagabond-crawler.X"` round-tripped as `null`, breaking effect-lookup-by-origin. Crawler migrated to flag-based identification. **Affects the system too** if any system code sets non-UUID origins or queries `effect.origin === "..."` strings.
- **MeasuredTemplate creation still works in V14** (deprecated but functional, contradicting some third-party migration guides that claim it was hard-removed). Region migration is optional cleanup, not a V14 blocker.
- **`renderChatMessage` (jQuery) hook deprecated since V13, removed in V15.** Live console showed 15 listeners on the deprecated hook, all from VCE (and possibly system code — couldn't disambiguate from stack alone). All sites need migration to `renderChatMessageHTML` (HTMLElement arg). Out of scope for the conditions compendium but worth bundling into the same V14 PR if convenient.
