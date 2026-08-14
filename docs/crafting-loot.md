# Crafting & Loot

Item generation, distribution, and inventory management.

---

## The Forge & Loot Panel

*Orientation: left-click the Forge & Loot button on the Crawl Bar to open the tool picker. Right-click for quick settings.*

- **Relic Forge** — see [Relic Forge](#relic-forge)
- **Scroll Forge** — see [Spell Scroll Forge](#spell-scroll-forge)
- **Loot Manager** — see [Loot Generator](#loot-generator)
- **Session Recap** — see [Session Recap](session-tracking.md#session-recap)
- **Loot Generator** — see [Loot Generator](#loot-generator)
- **Merchant Shop** — see [Merchant Shop](#merchant-shop)
- **Party Inventory** — see [Party Inventory](#party-inventory)

---

## Loot Generator

<!-- gif: docs/assets/loot-generator.gif -->

### What it does

Three cooperating tools that take loot from "I need treasure for room 7" to items in the party's inventory:
- **Loot Generator** — explicit GM roll on the core Vagabond loot tables (Levels 1-10, p.186+) with compendium item creation and per-roll "Give to Player" buttons.
- **Loot Manager** — authoring + assignment window. Build world RollTables, assign them to NPCs (world actor flags or compendium-level config), and tweak drop chances.
- **Loot Drops** (background subsystem) — fires on `deleteCombat`, walks the defeated NPCs, rolls each one's assigned table independently for each player, and spawns labelled loot-bag actors on the canvas.

Loot Generator is a deterministic "I'll decide what's here" tool. Loot Manager + Loot Drops together automate the "combat ends, loot materializes" path.

### How to use

#### Loot Generator

1. Open from the Crawl Bar → **Forge & Loot** → **Loot Generator**, or `game.vagabondCrawler.lootGenerator.open()`.
2. Pick a **level** (1-10). Level 1 uses the weighted p.186 table baked into the module; Levels 2-10 chain through currency, trade goods, art, jewelry, alchemy, armor/weapon enchants, and relics using `LEVEL_FORMULAS` from `scripts/loot-data.mjs`.
3. Click **Roll** — each roll appends a history entry with the resolved roll chain (so you can see *why* you got what you got) plus the resulting compendium item(s).
4. In each history card, **pick a player** from the dropdown and click **Give to Player** to transfer the item into their inventory. A chat card posts to the table; the **Session Recap** loot log picks it up automatically.
5. **Post to chat** drops the roll card into chat for the party without handing out the item yet — useful when you want players to negotiate who gets what.

#### Loot Manager + Loot Drops

1. Open **Forge & Loot** → **Loot Manager**. Filter any NPC source (World, Scene, Bestiary, Humanlike, or module packs) by name/type/TL.
2. For each NPC, pick a RollTable and set a drop chance (0-100). Per-world-actor assignments override compendium-level defaults; compendium-level assignments apply to every future clone of that bestiary entry.
3. Enable **Loot Drops** in settings (off by default). Now when combat ends, every defeated NPC rolls its assigned table against its drop chance. Appearing-based default chance is `1 / (maxAppearing × 2) × 100` — a 2d6 enemy has a ~4% per-corpse drop chance, a unique has 50%.
4. Loot bags appear as actor tokens on the canvas with chest icons. Double-click to open the pickup dialog; players can only see their own share (loot is rolled independently per player).

### Settings

| Setting | Effect | Default |
|---|---|---|
| Loot Drops | Auto-generate loot bags from defeated NPCs at combat end | Off |
| Loot Drop Chance (%) | Default per-NPC drop chance when no override is set | 50 |

Per-NPC table + chance overrides live as actor flags (`vagabond-crawler.lootTable` / `lootDropChance`) or compendium-level in the `compendiumLootConfig` world setting — edited through the Loot Manager UI, not directly.

### Tips & Gotchas

- **Generator vs Manager.** Generator rolls core Vagabond tables *right now* and routes the result to a player. Manager+Drops assigns tables to NPCs for automatic payout at combat end. Use whichever matches your prep style — or both.
- **Compendium items are created with Owner permission** for all players (via `loot-drops.mjs`) so players can pick up without GM relay.
- **"Give to Player" auto-logs to Session Recap.** The loot log entry records the source ("Loot Generator"), recipient, and items; inspect in the Recap window's Loot tab.
- **Relic powers from the Generator auto-apply.** When a roll produces a relic, `_findRelicPower` matches the power text to a `RELIC_POWERS` entry and attaches the relevant Active Effects to the generated item — no manual enchanting step.
- **Loot Drops is opt-in.** Flip the setting on when you're ready. If it's off, defeated NPCs drop nothing regardless of assigned tables.

---

## Relic Forge

<!-- gif: docs/assets/relic-forge.gif -->

### What it does

A three-column workbench for upgrading any weapon, armor, trinket, or other equipment into a magical relic. The **left column** is the power browser — 11 categories (Ace, Bane, Bonus, Cursed, Fabled, Movement, Protection, Resistance, Senses, Strike, Utility) containing the full Vagabond Relic Naming Procedure catalog. The **middle column** holds the base item plus user-input fields for parameterized powers (creature type for Bane, damage type for Resistance, spell name for utility scrolls). The **right column** is the selection list with per-power costs and a running total.

Forging updates the item in place: rename follows each power's `nameFormat` (prefix "Brutal", suffix "of Climbing", or wrap template like "Goblin's Bane Shortsword"), Active Effects attach with `transfer: true` so the bonuses flow onto whoever equips it, and the item's `properties` array grows to include anything the relic conveys (Brutal, Cleave, etc.). Effects are **equip-gated** — a forged `+2` cuirass doesn't grant its bonus while it's in the rogue's backpack.

### How to use

1. Open via **Forge & Loot** → **Relic Forge**, or click the forge icon on any equipment item's sheet (shortcut for `RelicForge.open(item)`).
2. Drag an equipment item into the middle column, or use the **Base Item Browser** (search across all world items) to pick one. Non-equipment item types are rejected.
3. Browse the left column by category. Click a power to add it to the right column; click again to remove. Powers with a `requiresInput: true` flag prompt for text (creature type, damage type, etc.) before they're valid.
4. The right column shows each selected power's description, any required input field, and its gold cost. Running total at the bottom includes the base item cost plus every power.
5. Optionally add **Custom Powers** — free-form name + description + changes array for homebrew effects not in the catalog.
6. Click **Forge** — the item is renamed using all the prefix/suffix fragments in order, Active Effects are created as embedded documents, costs update on `system.baseCost`, and the item's properties array grows. A chat card posts the newly forged relic.

### Settings

No world settings. The power catalog lives in `scripts/relic-powers.mjs` (`RELIC_POWERS`) — add new entries there and they appear in the browser automatically. Categories are defined in the same file under `RELIC_POWER_CATEGORIES`. The Forge cleans up its own state between sessions; there's no persistence between Foundry loads beyond whatever you've saved onto items.

### Tips & Gotchas

- **Equip-gating is automatic.** The module hooks `updateItem` on the equipped flag — toggle an item equipped and its relic effects enable; unequip and they disable. You don't need to do anything special.
- **Loot Generator relics auto-forge.** When the Loot Generator rolls a relic from a Level 2+ table, it matches the power text against `RELIC_POWERS` via the alias table and attaches the Active Effects automatically, without a Forge round-trip. This means most treasure items are functional out of the box.
- **Rename templates stack.** Adding Brutal (prefix), "of Climbing" (suffix), and Goblin Bane (wrap) produces something like "Brutal Shortsword of Climbing — Goblin's Bane". Power order in the right column dictates the order in the final name.
- **Custom powers need explicit `changes`.** Foundry's Active Effect change format — `{ key, mode, value }` — is the right shape. Use `"{input}"` as a placeholder that the Forge replaces with user-supplied text.
- **Relics are per-item.** Forging the same template twice produces two independent items with independent effects; nothing links them back to the catalog entry, so editing `RELIC_POWERS` later doesn't retroactively update existing forged items.
- For the full catalog of powers (names, descriptions, costs, application modes), see [`scripts/relic-powers.mjs`](../scripts/relic-powers.mjs).

---

## Spell Scroll Forge

<!-- gif: docs/assets/spell-scroll-forge.gif -->

### What it does

Creates one-shot consumable **spell scrolls** from any entry in the `vagabond.spells` compendium. Pick a spell, configure its delivery/dice/effects exactly as if casting it, and the Forge produces a **Scroll of [Spell]** item — gear-type, consumable, with a baked-in chat-card subtitle (delivery text + dice). Anyone can use it: right-click the scroll in their inventory → **Use Scroll** — no mana cost, no Cast Check, auto-success, plays the configured spell FX, rolls damage, posts a full chat card, then vaporizes.

The cost formula is simple: **5g + 5g × mana cost**. A zero-mana spell scroll is 5 gold. A 2-mana spell is 15 gold. A heavily-boosted 7-mana Fireball scroll is 40 gold. The scroll stores every piece of cast configuration (damage dice, delivery type, delivery increase, FX flag, status riders, crit status riders, explode values) at forge time, so every use produces identical output.

### How to use

1. Open via **Forge & Loot** → **Scroll Forge**, or `game.vagabondCrawler.scrollForge.open()`.
2. Optionally **drop an actor** onto the Forge window to target that actor's inventory; otherwise the created scroll lands in World Items.
3. Pick a spell from the sorted dropdown (populated from `vagabond.spells`).
4. Configure:
   - **Delivery type** — touch, ranged, area, cone, etc. (from `CONFIG.VAGABOND.deliveryTypes`).
   - **Delivery increase** — +/- buttons to extend range or area; cost scales per type.
   - **Damage dice** — for damaging spells, how many d6 are rolled. Dice above 1 cost extra mana.
   - **FX** — checkbox for the spell's visual effect (adds 1 mana on damaging spells).
5. Live gold value updates as you adjust. Click **Forge Scroll** — the item is created with `skipStack: true` (so it never merges with existing scrolls), a chat card posts, and a notification confirms destination.
6. In play: right-click the scroll in inventory → **Use Scroll**. The module loads the stored spell, rolls damage if configured, plays FX via `VagabondSpellSequencer`, posts the chat card, then deletes the scroll (or decrements quantity if it somehow stacked).

### Settings

No dedicated settings — the Forge reads `CONFIG.VAGABOND.deliveryTypes`, `deliveryDefaults`, `deliveryIncreaseCost`, and `deliveryIncrement` from the Vagabond system. Anything that affects spell costs there (module extensions, homebrew) flows into Scroll pricing automatically.

The **Use Scroll** context menu entry is added by the scroll-forge module as part of the inventory item context-menu patch in `scripts/vagabond-crawler.mjs` — no toggle, always on for items carrying the `vagabond-crawler.spellScroll` flag.

### Tips & Gotchas

- **Scrolls don't stack.** Creation uses `skipStack: true` and each scroll's flag payload is unique (even two "Scroll of Fireball" entries differ if you configured different dice), so they remain separate items. The inventory slot rule still pools scrolls into a single "Scrolls" slot for encumbrance.
- **Use Scroll bypasses Cast Check.** There's no attack roll, no targeting requirement on the caster — scrolls auto-hit. Targets are read from `game.user.targets` at use time, so the player still picks whom to aim at via the standard target tool.
- **Spell FX play on use.** If the spell ships with Sequencer data, the sequencer plays from the user's token. Missing the systems/vagabond spell-sequencer module means the scroll still works but without the VFX.
- **Status riders carry through.** Crit status riders (e.g., Burning on a damage crit) and explode-values (dice explosion on max) from the source spell are preserved in the scroll's flag payload, so consumables behave identically to the first-party cast.
- **Looted scrolls just work.** Loot Generator rolls that produce scrolls use the same flag shape, so any scroll — bought, forged, or looted — is usable via the same context-menu action.
- For the source spell list, `vagabond.spells` compendium is the authoritative source — add or edit entries there and they appear in the Forge dropdown on next render.

---

## Merchant Shop

<!-- gif: docs/assets/merchant-shop.gif -->

### What it does

A shared shop window the GM opens for the whole table. Two modes:
- **Compendium mode** — the shop sells from a GM-curated global inventory stored in world settings. Prices, stock, and markup are authored up front.
- **Actor mode** — point the shop at any NPC actor and it sells that NPC's `items` collection. Drop a wizard onto the window and it's suddenly a magic shop. The inventory refreshes on the actor's next update, so restocking is "edit the NPC's items".

Buy, sell, and a third mode — **Gamble** — rolls on the core Vagabond loot tables (Levels 1-10) for a fixed price per level (1g / 2g / 3g / 4g / 5g / 6g / 8g / 12g / 15g / 50g by default, tunable per entry). It's a loot-table-as-mystery-box: your 5g gets you one roll on the Level 5 table, whatever comes up.

Transactions route through the GM via socket (`shop:buy`, `shop:sell`, `shop:gamble`) so players can't write to GM-owned data directly. Everything is logged to a shop transaction history (`shopLog` setting) with time, buyer, item, and price — Discord-exportable.

### How to use

1. **Configure.** In Settings, set **Merchant Shop Name**, **Sell Ratio %** (50% default), and optionally pre-author the gamble options. Build the compendium-mode inventory by GM actions in the window (or by editing the `shopInventory` setting directly if you're scripting).
2. **Open as GM.** Crawl Bar → **Forge & Loot** → **Merchant Shop**. Pick mode: **Compendium** (global inventory) or drop an NPC onto the window for **Actor** mode.
3. **Open for players.** Click **Open for Party** — a `shop:open` socket broadcast makes the shop appear simultaneously on every player's client.
4. **Players buy.** Click Buy on an item card, optionally adjust quantity, confirm. The socket handler on the GM client validates currency, deducts the cost, and creates the item on the player's actor with `skipStack: true`.
5. **Players sell.** Drag an item from the character sheet onto the shop window. The GM handler applies the Sell Ratio, refunds currency, deletes the item from the seller's inventory, and logs the trade.
6. **Players gamble.** In the Gamble tab, pick a level, pay the cost, and the Loot Generator resolves that level's table — the result drops into the player's inventory as if rolled from the Forge & Loot → Loot Generator path (same history, same relic-power hydration).
7. **Close shop.** GM clicks **Close** — `shop:close` broadcast tears down the window on every client.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Merchant Shop Name | Window title + in-chat label | "The Merchant" |
| Merchant Sell Ratio (%) | Refund percentage when players sell items back | 50 |
| Gamble Options | Per-level entries (source + cost) used by the Gamble tab | 10 preset levels (1g-50g) |
| Shop Inventory | Compendium-mode global stock (edited via the window, not the settings UI) | empty |
| Shop Log | Transaction history (time, buyer, item, price) | empty |

### Tips & Gotchas

- **GM must be online for transactions.** All buy/sell/gamble requests route through the GM socket handler; if the GM is offline, the window is read-only.
- **Actor mode is live.** Editing the actor's items during a shop session updates the shop on next render — handy when the merchant dynamically restocks after a storyline beat.
- **Gamble is a feature, not a bug.** It turns the Loot Generator into an in-world mechanic: PCs spend coin, they get the loot, and you didn't have to place anything on the map. Use it for shady bazaar stalls, wizardly mystery boxes, gambling dens.
- **Sell ratio is per-shop-session.** Changing the ratio mid-session only applies to subsequent sells; previously-sold items stay at their old price.
- **Skip-stack on buy.** Purchased items use `skipStack: true`, so a freshly-bought torch doesn't silently merge with the lit torch already on the character. The [Inventory System](#inventory-system) auto-stack rule handles it sanely on the next item touch.
- **Discord export.** The shop log (and the Session Recap's loot log) are both Discord-exportable — drop the chronology straight into your table's channel for record-keeping.

---

### Inventory System

<!-- gif: docs/assets/inventory-system.png -->

Sheet-level patches that make the Vagabond inventory behave the way Vagabond tables actually want it to. New items with a `quantity` field **auto-stack** with matching items (same name, same type) on creation, merging `quantity` and `baseCost` instead of producing duplicates — unless called with `skipStack: true` (lit torches, picked-up items, scrolls). **Quantity badges** render on items with `quantity > 1` in the inventory list. Slot counting deviates from the base system on **exactly one axis: quantity**. Vagabond charges each item its slot cost once and never reads `quantity`, so two torches occupy one slot. Crawler makes a stack of N cost `baseSlots × N`, adding `baseSlots × (quantity − 1)` on top of the system's number — two torches cost two slots. Everything else matches the system: **zero-slot items are free** (a Backpack, rations, coins, Unarmed), items **stowed inside a container** cost nothing because the container's own slots represent them, and the item-type filter mirrors the system's inventory set. Note that slot cost comes from the item's own `baseSlots`, not its name — the core `Candle` is zero-slot and therefore free, while the alchemical variants (`Candle, Basic` and friends) cost one each. Items flagged `trueZeroSlot` ("Weightless") never contribute extra slots at any quantity. Ammunition, torches, and alchemical items all behave sensibly.

### Party Inventory

<!-- gif: docs/assets/party-inventory.png -->

A side-by-side inventory view for the whole party, launched from Forge & Loot or `game.vagabondCrawler.partyInventory.open()`. Each party member gets a column showing items, quantity, slot usage, and sell price. Drag an item from one column to another to transfer it (currency included, with the shared sell ratio from Merchant Shop applied if configured). GM-only — intended for post-session loot redistribution where the party needs to move a relic off the rogue (who's already at 12/12 slots) and onto the fighter. Reads live actor data, so edits from any sheet show up on next render. Supports unlinked party tokens too.

### Item Drops

<!-- gif: docs/assets/item-drops.png -->

Drag any inventory item onto the canvas to create a pickup-able item token. Other characters walk up and click **Pick Up** on the token HUD to transfer the item into their inventory. Drops create the pickup actor with **Owner permission for all players** so the flow works without GM relay. On pickup, the recreated item uses `skipStack: true` so lit torches, partially-filled oil flasks, and configured relics keep their state rather than merging with generic stacks. Light sources are excluded from this flow — torches, candles, and lanterns go through the [Light Tracker](exploration.md#light-tracker) drop/pickup path instead. Toggle via the **Item Drops** setting (on by default).
