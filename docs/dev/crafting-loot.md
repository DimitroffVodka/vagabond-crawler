# Crafting & Loot — Developer Reference

> Contributor notes for the Relic Forge and the code that consumes forged relics. GM-facing usage lives in [`docs/crafting-loot.md`](../crafting-loot.md).

## Relics

| File | Role |
|---|---|
| `relic-powers.mjs` | `RELIC_POWERS` definitions (AE changes, `{input}` name formats, module flags) and `buildRelicPowerData(itemData, powers, inputs)` — the one builder the Forge and the Loot Generator share |
| `relic-forge.mjs` | `RelicForgeApp` (ApplicationV2) |
| `relic-effects.mjs` | Passive consumers: bonus dice, lifesteal / manasteal, cursed saves, damage-helper wraps, token senses and light |
| `relic-activations.mjs` | Activated powers on the inventory context menu, Benediction, use tracking |
| `loot-generator.mjs` | `_applyRelicPower(itemData, powerText)` maps loot-table power text ("Fabled, Vicious", "Bane of Goblin (Niche)", "Protection vs Undead") onto the same forge data |

### Item data written by the builder

- `flags.vagabond-crawler.relicForge` — `{ forged, powers: [id], userInputs: { id: text }, powerCost, forgedAt }`. Every consumer gates on `forged`; an item without it is not a relic.
- `effects[]` — one Active Effect per power, `name: "Relic: <power>"`, `flags.vagabond-crawler.relicPower` plus power-specific flags (`baneTarget`, `damageResistance`, `wardTarget` …).
- `system.*` — `applicationMode`, added `properties`, on-hit `causedStatuses`, `statusResistances`.

### System methods wrapped (`relic-effects.mjs`)

| Wrap | Power |
|---|---|
| `VagabondItem.prototype.rollDamage` | Strike / Bane / Vicious dice, lifesteal, manasteal |
| `VagabondDamageHelper.rollDamageFromButton` | chat-card damage button (resolves UUID actor refs) |
| `VagabondDamageHelper.calculateFinalDamageDetailed` | Resistance — typed damage halved before Armor |
| `VagabondDamageHelper._hasStatusResistanceForSave` | Protection — Favor on saves vs its Being type |
| `VagabondDamageHelper.handleApplyRestorative` + `preDamageApply` hook | Cursed Doom — chat-card healing capped at 1 per die |
| `StatusHelper.applyStatus` | Cursed Anger / Cowardice / Gullibility skip the save |

Wraps are idempotent through `isWrapped` / `markWrapped`, so VCE's outer wraps and a repeated `init()` cannot double-apply. Every wrap target is listed in the system-contract suite's `PATCH_TARGETS`.

### Token sync (`relic-effects.mjs`)

Senses (Nightvision → `darkvision`, Truesight → `seeAll`, Tremors → `feelTremor`, Echolocation / Sense Life → `senseAll`) and light powers (Darkness / Moonlit / Radiant; Far = 60 ft is an assumption, the system has no Far value) are written onto the wielder's tokens from `appliedEffects`. GM-only hooks on effect, item and token changes plus `canvasReady`. What the module manages is recorded in `flags.vagabond-crawler.relicToken` as a JSON string (flag merges keep stale keys); the flag is deleted when nothing is managed. Relic light only applies to an unlit token; a system torch doused over it restores it through the system's `prevLight`.

### Activated powers (`relic-activations.mjs`)

| Power | Mechanism |
|---|---|
| Blast | `VagabondChatCard.createActionCard` with saves, 6d6, targets within Close range |
| Precision | `rollAttack` wrap (`rollAttack:precision`) forces one hit; armed through `flags.vagabond-crawler.precisionArmed` on the item |
| After-Image I / II | unlinked, translucent token copy with `flags.vagabond-crawler.afterImage = { combatId, expiresRound, expiresAt }`; I = 1 round, II = 10 rounds (assumption — the text says short / longer). Expired by the active GM on `updateCombat` / `deleteCombat` / `updateWorldTime`. Players relay creation over the module socket (`action: "afterImage"`) |
| Wish-Granting | confirm dialog, once ever |
| Benediction | `preUpdateActor` clamps HP 0 → 1; an in-memory pending set stops a second hit in the same tick spending it twice |
| Store Spell | AE `system.mana.bonus` ADD −cost (cost from `SpellCastDialog.calculateCosts`) recorded in `flags.vagabond-crawler.storedSpell`; release creates a temporary spell item (`storedSpellTemp`, removed on Rest) and calls `SpellHandler._executeCast` with `manaOverrideDelta` |

**Uses.** `item.flags.vagabond-crawler.relicUses = { [power]: { at: worldTime } }`. Per-day powers reset on Crawler Rest (`RestBreather` → `RelicActivations.onRest`) or after 24 h of world time; Benediction after 7 days; Wish never. "Reset relic uses" on the menu clears the flag.

**Menu.** Inventory cards get a `contextmenu` listener on `renderVagabondCharacterSheet` / `renderVagabondNPCSheet` / `renderActorSheet`; the system's `.inventory-context-menu` is polled for and entries are prepended (the same pattern the scroll and light menus use). Entries are `role="menuitem"`, focusable, and activate on Enter / Space.
