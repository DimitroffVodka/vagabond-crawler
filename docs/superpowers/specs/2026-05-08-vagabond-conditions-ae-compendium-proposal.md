# Proposal: `vagabond.conditions` ActiveEffect Compendium for V14

**Audience:** Vagabond system maintainer.
**Date:** 2026-05-08.
**Status:** Request — awaiting system-author response.
**Context:** Drafted during Foundry V14 migration of vagabond-crawler (`v14-migration` branch). After verifying live V14 behavior, an opportunity emerged to consolidate ActiveEffect definitions at the system level rather than per-module.

---

## Why this matters

V14 promoted ActiveEffect to a top-level compendium document type. Before V14, AEs only existed as embedded children of Actors/Items — modules that needed reusable effects had to either recreate them inline at every call site or piggyback on Items. V14 lets the system ship an `ActiveEffect` compendium the same way it ships Items: stable UUIDs, GM-editable, draggable from compendium directly onto tokens.

The value of doing this at the system level rather than per-module:

1. **Single source of truth for mechanical effects.** Today, the Crawler defines its own "Vulnerable" inside `flanking-checker.mjs`, VCE may define its own variant for class features, and a third-party module might define yet another. Different `system.favorHinder` keys, different status-icon associations, drift over time. Centralizing in `vagabond.conditions` means everyone reads the same numbers.
2. **GMs can homebrew.** Drop a custom AE compendium that overrides yours; GMs flip a toggle and their Vulnerable now does Y instead of X. No code patches.
3. **Cross-module references via UUID.** When VCE and Crawler both want to apply Vulnerable, both call `fromUuid("Compendium.vagabond.conditions.ActiveEffect.<stable-id>")`. The system owns the canonical definition; modules don't duplicate it.
4. **Module code shrinks.** Replace 5–15 lines of inline effect construction per call site with a 3-line lookup-and-clone.
5. **Drag-to-apply UX for free.** GMs can open the compendium and drag a "Frightened" effect onto a token in the middle of combat without scripting — V14 wires this up automatically for AE compendiums.

## What V14 added that the system will use

- **`ActiveEffect` as a top-level compendium type.** Set `"type": "ActiveEffect"` on the pack entry in `system.json`.
- **`system.changes` array** instead of root `changes`. Use `type: "override"` (string) instead of `mode: 5` (number). Both shapes still work in 14.x via shim, but new content should be v14-native.
- **`ActiveEffect#showIcon`** — `"always"`, `"never"`, or conditional. Lets you ship effects that have mechanics but don't clutter the token row.
- **New duration units** beyond rounds/seconds — see `CONST.ACTIVE_EFFECT_TIME_DURATION_UNITS`.
- **Expiry events** — see `CONST.ACTIVE_EFFECT_EXPIRY_EVENTS` (e.g. expire on combat end, on rest, on save).
- **Two-phase application** — `phase: "initial"` vs `phase: "final"` per change, useful for ordering when multiple effects compete.
- **`origin` is now `DocumentUUIDField`** — non-UUID strings get nulled. Don't put `"system.vagabond.condition.frightened"` as origin; use `flags` or leave origin blank for compendium-templates.

## Compendium structure

```json
// system.json snippet
"packs": [
  {
    "name": "conditions",
    "label": "Conditions & Effects",
    "path": "packs/conditions",
    "type": "ActiveEffect",
    "system": "vagabond"
  }
]
```

**Conventions to lock in:**

| Aspect | Recommendation |
|---|---|
| **Stable IDs** | Use deterministic IDs (e.g. set `_id` explicitly when creating). Modules will hardcode references — IDs must not regenerate on rebuild. |
| **Compendium label** | "Conditions & Effects" or similar — surfaces in the directory cleanly |
| **Flags namespace** | `flags.vagabond.canonicalId: "vulnerable"` on every entry. Lets modules find the canonical version even if a GM duplicates the compendium for editing. |
| **Status linkage** | Where applicable, set `statuses: ["frightened"]` so the AE both applies mechanics AND surfaces the standard token-icon overlay. |
| **`showIcon`** | Default to `"always"` for player-visible conditions (Vulnerable, Frightened), `"never"` for plumbing effects (the saves-mirror, ward bookkeeping). |
| **Naming** | Match the canonical noun the system uses elsewhere — "Vulnerable" not "Vuln", "Frightened" not "Scared". |

## Recommended Tier 1 — standard conditions

These are the bread-and-butter effects most adventures need. Most are paired with existing token-icon statuses:

| Name | `statuses` | `system.changes` (v14 shape) | `showIcon` | Notes |
|---|---|---|---|---|
| Vulnerable | `["vulnerable"]` | `favorHinder=hinder` (override), `incomingAttacksModifier=favor` (override), `outgoingSavesModifier=favor` (override) | always | The canonical Vulnerable. Crawler's flanking, any other module that wants to apply it, references this. |
| Frightened | `["frightened"]` | `favorHinder=hinder` (override) | always | |
| Stunned | `["stunned"]` | mechanics depend on system rules | always | |
| Paralyzed | `["paralyzed"]` | | always | |
| Restrained / Grappled | `["restrained"]` | speed override 0, attacker favor | always | |
| Hidden / Invisible | `["hidden"]` | `incomingAttacksModifier=hinder` (override) | always | |
| Prone | `["prone"]` | (system defines) | always | Triggers Soft Underbelly on creatures with that ability. |
| Bleeding | `["bleeding"]` | tick damage via duration | always | If vagabond has bleeding |
| Burning | `["burning"]` | tick damage | always | |
| Concentrating | `["concentrating"]` | (system defines) | always | |
| Inspired | `["inspired"]` | `favorHinder=favor` (override), expires on next d20 roll | always | Bardic boon — perfect candidate for a one-roll-and-expire AE using V14's expiry events |
| Bless | — | `favorHinder=favor` (override), 10-round duration | always | Spell effect; reusable |
| Bane | — | `favorHinder=hinder` (override), 10-round duration | always | |
| Shield | — | `armor` += 2 (or system equivalent) | always | |

## Tier 2 — vagabond-specific

| Name | Mechanics | Why it belongs here |
|---|---|---|
| Magic Ward I / II / III | per-cast surcharge per ward tier (read-only marker; logic stays in modules) | Crawler + VCE both inspect ward state; canonicalize the markers |
| Encumbered | speed `crawl=base/2`, no Rush | Crawler movement-tracker reads load-state; canonical condition makes it cross-module-readable |
| Overloaded | speed=0 in non-combat, no Rush in combat | Same — current Crawler check at `movement-tracker.mjs` would simplify |
| Focused | (system defines) — Hunter's Mark / Virtuoso target marker | VCE owns the trigger logic but the marker AE could be system-canonical |
| Inspired | covered above | |
| Defensive Stance | +1 armor or similar temp buff | Common combat option |

## Tier 3 — Crawler-specific transients

These are created/destroyed by Crawler game logic. Including them in the system compendium is OPTIONAL — only worth it if the system author wants the Crawler to read canonical definitions instead of building them inline:

| Name | Source | Current call site | Migration if shipped |
|---|---|---|---|
| Vulnerable (Flanked) | flanking-checker | `_makeEffectData()` constructs 3-change AE | Replace with `fromUuid` + clone + tag |
| Vulnerable — Saves (Flanked) | flanking-checker | saves-mirror for unlinked tokens; could be omitted from compendium since it's pure plumbing | Could keep inline OR ship with `showIcon: "never"` |
| Pack Instincts (active) | npc-abilities | `outgoingSavesModifier=hinder` per-attacker effect | Same migration as Vulnerable |
| Soft Underbelly (Prone) | npc-abilities | `armor=0` priority 999 | Same migration |

If the system ships these, the Crawler will switch its three inline `_makeEffectData()` / `createEmbeddedDocuments` paths to compendium clones in a single follow-up PR. Code reduction roughly 40 lines net.

## Sample AE document — Vulnerable (V14-native shape)

```json
{
  "_id": "vulnerable000000",
  "name": "Vulnerable",
  "img": "icons/svg/downgrade.svg",
  "statuses": ["vulnerable"],
  "showIcon": "always",
  "system": {
    "changes": [
      { "key": "system.favorHinder",             "type": "override", "value": "hinder", "phase": "final" },
      { "key": "system.incomingAttacksModifier", "type": "override", "value": "favor",  "phase": "final" },
      { "key": "system.outgoingSavesModifier",   "type": "override", "value": "favor",  "phase": "final" }
    ]
  },
  "duration": {
    "rounds": null,
    "seconds": null,
    "turns": null,
    "startRound": null
  },
  "flags": {
    "vagabond": { "canonicalId": "vulnerable" }
  },
  "transfer": false
}
```

Stable `_id`, canonical flag, V14-native change shape. Modules can do:
```js
const tpl = await fromUuid("Compendium.vagabond.conditions.ActiveEffect.vulnerable000000");
const data = tpl.toObject();
foundry.utils.setProperty(data, "flags.vagabond-crawler.tag", "flanking");
await actor.createEmbeddedDocuments("ActiveEffect", [data]);
```

## How modules will consume

After the compendium ships with stable IDs, the consumption pattern is identical for every module:

```js
// Constants file
const COND_VULNERABLE = "Compendium.vagabond.conditions.ActiveEffect.vulnerable000000";
const COND_FRIGHTENED = "Compendium.vagabond.conditions.ActiveEffect.frightened00000";
const COND_INSPIRED   = "Compendium.vagabond.conditions.ActiveEffect.inspired0000000";

// Apply path
async function applyCondition(actor, uuid, { tag, sourceModule } = {}) {
  const tpl = await fromUuid(uuid);
  if (!tpl) return null;
  const data = tpl.toObject();
  if (tag) foundry.utils.setProperty(data, `flags.${sourceModule}.tag`, tag);
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created;
}

// Lookup path (find effects this module owns)
const myFlanking = actor.effects.find(e => e.flags?.["vagabond-crawler"]?.tag === "flanking");
```

## Open questions for the system author

1. **Source-of-truth for `system.favorHinder` semantics.** If two effects both override it, last-write-wins by `priority`? Or does the system have a "favor + hinder = neutral" reduction rule that runs after AE application? Affects whether modules need to apply with priority hints.
2. **Status-icon ↔ AE coupling.** Today the system probably calls `actor.toggleStatusEffect("vulnerable")` for some flows. After this compendium ships, should those calls migrate to compendium-AE-application, or stay separate (status icons for cosmetic flags, AEs for mechanical effects)?
3. **Versioning the compendium.** If a Tier 1 effect's mechanics change in v5.5.0, modules pinned to v5.4.x would silently get the new behavior. Worth a `flags.vagabond.schemaVersion` per AE so modules can sanity-check?
4. **Crawler Tier 3 inclusion.** Any objection to shipping the three Crawler-internal effects in the system compendium? It's a courtesy — the Crawler can keep building them inline if the maintainer would rather not pollute a "user-facing conditions" pack with internal plumbing.

## Effort estimate

**System-side:**
- ~1 day to build the compendium with Tier 1 (15 entries)
- ~half a day for Tier 2 (vagabond-specific)
- The actual mechanics are mostly already encoded in the system's status-effects config — most of the work is choosing stable IDs and writing the changes arrays in V14 shape

**Crawler-side (follow-up):**
- ~1 hour to switch the three inline `_makeEffectData` / `createEmbeddedDocuments` sites to compendium clones, once the IDs are stable

## Ground-truth observations from the live V14 probe

While drafting this proposal, the Crawler's V14 migration probed live ActiveEffect behavior at Foundry 14.361. Notes that informed the recommendations above:

- `CONST.ACTIVE_EFFECT_MODES` still exists in V14 with the same numeric values (CUSTOM=0 … OVERRIDE=5). Old code works via the back-compat shim. New content should be v14-native (`type:` strings + `system.changes`) to avoid deprecation warnings and survive the v16 shim removal.
- `CONST.ACTIVE_EFFECT_CHANGE_TYPES.add` and `.subtract` *both equal 20* in 14.361 — not a doc typo. The string key disambiguates.
- The back-compat shim normalizes both shapes on read: any AE in V14 has BOTH `effect.changes` and `effect.system.changes` populated regardless of which form was passed at create time.
- `ActiveEffect.origin` is a `DocumentUUIDField` and silently nulls non-UUID strings on persist. The Crawler hit this hard — flanking/Pack-Instincts/Soft-Underbelly all used `origin: "module.vagabond-crawler.X"` strings as identifiers and stopped working in V14 until migrated to flag-based identification. **Affects the system too** — anywhere `vagabond` core sets a non-UUID origin or queries `effect.origin === "..."` with a non-UUID string, those break in V14. Worth a system-side audit.
- MeasuredTemplate creation still works in V14 (deprecated but functional, contradicting some third-party migration guides that claim it was hard-removed). Region migration is optional cleanup, not a V14 blocker.
