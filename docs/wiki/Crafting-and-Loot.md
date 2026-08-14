# Crafting and Loot

The **Forge & Loot** menu covers treasure rolls, NPC drops, relics, scrolls, merchants, and party inventory.

---

## Forge & Loot panel

Left-click **Forge & Loot** on the GM's Crawl Bar to open the tool picker. Right-click it for Crawler configuration shortcuts.

- **Relic Forge:** see [Relic Forge](#relic-forge).
- **Scroll Forge:** see [Spell Scroll Forge](#spell-scroll-forge).
- **Loot Manager:** see [Loot Generator](#loot-generator).
- **Session Recap:** see [Session Recap](Session-Tracking#session-recap).
- **Loot Generator:** see [Loot Generator](#loot-generator).
- **Merchant Shop:** see [Merchant Shop](#merchant-shop).
- **Party Inventory:** see [Party Inventory](#party-inventory).

---

## Loot Generator

Three tools cover different loot jobs:

- **Loot Generator** rolls the core Vagabond Level 1–10 tables when the GM wants treasure now.
- **Loot Manager** builds world RollTables and assigns tables and drop chances to NPCs.
- **Loot Drops** checks defeated NPCs when Foundry combat is deleted and rolls a personal share for each player.

### Roll and give out loot

#### Loot Generator

1. Open from the Crawl Bar → **Forge & Loot** → **Loot Generator**, or `game.vagabondCrawler.lootGenerator.open()`.
2. Pick a **level** (1-10). Level 1 uses the weighted p.186 table baked into the module; Levels 2-10 chain through currency, trade goods, art, jewelry, alchemy, armor/weapon enchants, and relics using `LEVEL_FORMULAS` from `scripts/loot-data.mjs`.
3. Click **Roll Loot**. The history card shows the resolved roll chain and the items it produced.
4. Click **Post to Chat** if the party should see the result without receiving it yet.
5. To hand it out, choose a player-owned character and click **Give**. Crawler creates the item on that actor and logs the claim. Giving and posting are separate actions.

#### Loot Manager + Loot Drops

1. Open **Forge & Loot** → **Loot Manager**. Filter any NPC source (World, Scene, Bestiary, Humanlike, or module packs) by name/type/TL.
2. For each NPC, pick a RollTable and set a drop chance (0-100). Per-world-actor assignments override compendium-level defaults; compendium-level assignments apply to every future clone of that bestiary entry.
3. Set an explicit chance for each NPC, then enable **Loot Drops**. It is off by default.
4. When combat ends, each eligible defeated NPC rolls a separate share for each player. Personal chat cards offer **Claim Loot** or **Pass Loot**, and the GM receives a breakdown.

The current implementation does not create the labelled canvas loot bags described in the older guide.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Loot Drops | Offer per-player loot from eligible defeated NPCs at combat end | Off |
| Loot Drop Chance (%) | Registered global value; not used by the version `1.17.2` fallback path | 50 |

Per-NPC table and chance values live on actor flags or in the compendium loot configuration. Edit them through Loot Manager.

> **Version 1.17.2 limitation:** when an NPC has no explicit chance, combat-end resolution derives one from the NPC's appearing formula instead of using the registered global 50% value. Set the NPC percentage yourself when the chance matters.

### Loot notes

- Generator is the manual tool. Manager and Drops prepare automatic rewards for combat end.
- **Give** adds the claim to Session Recap when tracking accepts that log entry.
- Generated relics can receive matching Crawler effects when their text matches a catalogued power.
- If **Loot Drops** is off, assigned tables do nothing at combat end.

---

## Relic Forge

Relic Forge adds powers to a weapon, armor, trinket, or other equipment. The left column browses the 11 power categories. The middle holds the base item and any input required by a power, such as a creature type for Bane. The right column lists the selected powers and their displayed costs.

Forging can rename the item, add properties, stamp Crawler metadata, and create transfer Active Effects. Effects marked **when equipped** stay inactive while the relic is in a backpack.

### Forge a relic

1. Open **Forge & Loot → Relic Forge**.
2. Drag an equipment item into **Base Item**, or search the built-in browser. The browser reads `vagabond.weapons`, `vagabond.armor`, and `vagabond.gear`; it does not search existing world items.
3. Browse the left column by category. Click a power to add it to the right column; click again to remove. Powers with a `requiresInput: true` flag prompt for text (creature type, damage type, etc.) before they're valid.
4. The right column shows each selected power's description, any required input field, and its gold cost. Running total at the bottom includes the base item cost plus every power.
5. Optionally add **Custom Powers** with a free-form name, description, and changes array.
6. Click **Forge Relic**. Actor-owned and world items update in place. A compendium base item is copied into World Items first, leaving the source unchanged.

### Settings

Relic Forge has no world settings. The power catalog and categories live in `scripts/relic-powers.mjs`.

### Relic notes

- Equipping and unequipping an item controls effects that use the **when equipped** application mode.
- Loot Generator can match rolled relic text to the catalog and attach the same effects without opening Relic Forge.
- Prefixes, suffixes, and wrap templates build the final name in the order shown.
- Custom Active Effect changes use Foundry's `{ key, mode, value }` shape. The Forge replaces `"{input}"` with the text entered for that power.
- Forged items do not stay linked to the catalog. Editing `RELIC_POWERS` later does not update them.
- The displayed power total is reference information in version `1.17.2`; forging does not write it to `system.baseCost`.
- Crawler does not currently add a Relic Forge button to equipment sheets.
- For the full catalog of powers (names, descriptions, costs, application modes), see [`scripts/relic-powers.mjs`](https://github.com/DimitroffVodka/vagabond-crawler/blob/main/scripts/relic-powers.mjs).

---

## Spell Scroll Forge

Scroll Forge turns a spell from `vagabond.spells` into a one-use equipment item. The scroll stores its delivery, dice, and FX choices. Using it costs no mana, skips the Cast Check, rolls supported damage, posts a chat card, and consumes the item.

The value is **5g + 5g × mana equivalent**. A zero-mana spell is worth 5 gold, a 2-mana spell 15 gold, and a 7-mana spell 40 gold.

### Create and use a scroll

1. Open via **Forge & Loot** → **Scroll Forge**, or `game.vagabondCrawler.scrollForge.open()`.
2. Confirm that **Target** shows **World Items**. The ordinary Crawl Bar path does not accept an actor drop in version `1.17.2`.
3. Pick a spell from the sorted dropdown (populated from `vagabond.spells`).
4. Configure:
   - **Delivery type:** touch, ranged, area, cone, and the other types supplied by Vagabond.
   - **Delivery increase:** extend range or area; cost scales by type.
   - **Damage dice:** choose the number of d6 for a damaging spell. Dice above 1 cost extra mana.
   - **FX:** include the spell's visual effect. This adds 1 mana to a damaging spell's equivalent cost.
5. The value updates with your choices. Click **Create Scroll of _Spell Name_**. The item is created in World Items with stacking disabled.
6. In play: right-click the scroll in inventory → **Use Scroll**. The module loads the stored spell, rolls damage if configured, plays FX via `VagabondSpellSequencer`, posts the chat card, then deletes the scroll (or decrements quantity if it somehow stacked).

### Settings

Scroll Forge has no dedicated settings. It reads delivery types and their cost rules from Vagabond.

**Use Scroll** appears on inventory items carrying Crawler's spell-scroll flag.

### Scroll notes

- Created scrolls stay separate items and never merge into a stack.
- **Use Scroll** reads the current target set, so the player should still target the intended tokens first.
- Supported spell FX play from the user's token.
- **Use Scroll** re-reads the spell from the compendium rather than the snapshot taken when the scroll was scribed. Editing the spell later changes what its existing scrolls do, and deleting it makes them unusable. Still true in version `1.18.0`.
- A scroll never crits — version `1.18.0` fixes the cast to a non-critical success, so critical riders on the spell cannot fire. The status, critical, and explosion fields stored on the scroll are unused.
- Bought, forged, and generated Crawler scrolls use the same inventory action.
- Edit `vagabond.spells` to change the spell list shown by the Forge.

---

## Merchant Shop

Merchant Shop can sell from two inventories:

- **Compendium Inventory** uses stock and prices curated by the GM and stored in the world.
- **NPC Actor Inventory** sells the selected NPC's items and refreshes when that actor changes.

The GM can also enable **Player Catalog** or **Gamble Table**. Gamble charges the configured price for one roll on a selected Vagabond loot level.

Player requests go through the connected GM client and successful trades are written to the shop log.

### Run a shop

1. Open **Forge & Loot → Merchant Shop** and switch to **Manage**.
2. Set **Shop Name**, **Buy Markup (%)**, and **Sell Ratio (%)**.
3. Choose **Compendium Inventory** or **NPC Actor Inventory**, then add stock or select the NPC.
4. Enable **Player Catalog** or **Gamble Table** if the shop should offer them.
5. Click **Make Shop Available**. Crawler posts a chat card and adds a shop button to the Crawl Strip; it does not force a window open on every client.
6. Players open the shop from chat or the Crawl Strip. They buy from item cards, sell through the **Sell** tab, and use Catalog or Gamble when enabled.
7. Click **Close Shop** when trading is over.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Merchant Shop Name | Window title + in-chat label | "The Merchant" |
| Merchant Sell Ratio (%) | Refund percentage when players sell items back | 50 |
| Gamble Options | Per-level entries (source + cost) used by the Gamble tab | 10 preset levels (1g-50g) |
| Shop Inventory | Compendium-mode global stock (edited via the window, not the settings UI) | empty |
| Shop Log | Transaction history (time, buyer, item, price) | empty |

### Merchant notes

- A GM must remain connected to process player transactions.
- Actor inventory changes appear the next time the shop renders.
- Changing the sell ratio affects later sales, not transactions already logged.
- Purchases in version `1.17.2` do not use `skipStack`, despite the older guide's claim.
- Shop activity can appear in Session Recap and its Markdown copy.

> **Version 1.17.2 security limitation:** the GM socket handlers do not independently re-check actor ownership, shop availability, or every client-supplied pricing input. Use Merchant Shop only with trusted players until those checks are tightened.

---

### Inventory system

Crawler adjusts how Vagabond inventory stacks and counts items. New items with the same name and type can merge into one quantity unless the caller uses `skipStack`. Stacks larger than one receive quantity badges. Slot counting differs from the base system on one axis only — quantity. Vagabond charges an item its slot cost once and never reads quantity, so two torches use one slot; Crawler charges a stack of N `baseSlots × N`, so two torches use two. Everything else matches the system: zero-slot items are free, items stowed inside a container cost nothing because the container's own slots cover them, and slot cost comes from the item's `baseSlots` rather than its name — a core `Candle` is free, an alchemical `Candle, Basic` costs one. Items marked `trueZeroSlot` ("Weightless") never add slots at any quantity.

### Party Inventory

**Forge & Loot → Party Inventory** opens player-owned character inventories side by side. Each column shows item quantity, slot use, equipment state, and value. The window reads live actor data, so sheet changes appear on its next render.

> **Version 1.18.0 limitation:** Party Inventory is read-only. It does not implement the drag-transfer behavior described in the older guide — the window has no transfer controls at all.

### Item Drops

With **Item Drops** enabled, drag owned non-light equipment from an actor inventory onto the canvas. The GM client creates a temporary pickup actor and token, and the source stack loses one item. An eligible actor can then use **Pick Up** on the Token HUD. Pickup recreates the item with stacking disabled so its state stays independent. Supported torches, candles, and lanterns use the [Light Tracker](Exploration#light-tracker) drop path instead. **Item Drops** is on by default.
