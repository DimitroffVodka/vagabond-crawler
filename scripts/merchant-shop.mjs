/**
 * Vagabond Crawler — Merchant Shop
 *
 * Two-mode shop system: compendium-based global inventory or actor-based NPC
 * inventory.  GM opens the shop for all players simultaneously.  Players buy
 * items (money deducted, item created) and sell items (item removed, money
 * added at a configurable ratio).  All transactions logged and exportable
 * to Discord markdown.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Default gamble costs per loot level (in gold). */
const GAMBLE_COSTS = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5,
  6: 6, 7: 8, 8: 12, 9: 15, 10: 50,
};

// ── Currency helpers ──────────────────────────────────────────────────────────

/** Convert a { gold, silver, copper } object to a single copper value.
 *  Vagabond currency: 100 copper = 1 silver, 100 silver = 1 gold. */
function _toCopper(c) {
  return (c?.gold ?? 0) * 10000 + (c?.silver ?? 0) * 100 + (c?.copper ?? 0);
}

/** Convert a copper total back to { gold, silver, copper }. */
function _fromCopper(total) {
  total = Math.max(0, Math.round(total));
  const gold = Math.floor(total / 10000);
  const silver = Math.floor((total % 10000) / 100);
  const copper = total % 100;
  return { gold, silver, copper };
}

/** Format a cost object as a short string like "2g 5s" or "10c". */
function _formatPrice(c) {
  const parts = [];
  if (c.gold)   parts.push(`${c.gold}g`);
  if (c.silver) parts.push(`${c.silver}s`);
  if (c.copper) parts.push(`${c.copper}c`);
  return parts.length ? parts.join(" ") : "Free";
}

/** Check if an actor can afford a cost. */
function _canAfford(actor, cost) {
  return _toCopper(actor.system.currency) >= _toCopper(cost);
}

/** Apply the sell ratio to a cost, returning the adjusted price. */
function _applySellRatio(cost, ratio) {
  const total = Math.floor(_toCopper(cost) * ratio / 100);
  return _fromCopper(total);
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const MerchantShop = {

  _app: null,
  _isOpenForPlayers: false,

  // ── Settings ──────────────────────────────────────────────────────────────

  registerSettings() {
    game.settings.register(MODULE_ID, "shopInventory", {
      scope: "world", config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, "shopSellRatio", {
      name: "Merchant Sell Ratio (%)",
      hint: "Percentage of an item's value players receive when selling back to the shop.",
      scope: "world", config: false, type: Number, default: 50,
      range: { min: 0, max: 100, step: 5 },
    });
    game.settings.register(MODULE_ID, "shopLog", {
      scope: "world", config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, "gambleOptions", {
      scope: "world", config: false, type: Array, default: [
        { id: "gl1",  name: "Level 1 Loot",  source: "loot-level:1",  cost: { gold: 1,  silver: 0, copper: 0 } },
        { id: "gl2",  name: "Level 2 Loot",  source: "loot-level:2",  cost: { gold: 2,  silver: 0, copper: 0 } },
        { id: "gl3",  name: "Level 3 Loot",  source: "loot-level:3",  cost: { gold: 3,  silver: 0, copper: 0 } },
        { id: "gl4",  name: "Level 4 Loot",  source: "loot-level:4",  cost: { gold: 4,  silver: 0, copper: 0 } },
        { id: "gl5",  name: "Level 5 Loot",  source: "loot-level:5",  cost: { gold: 5,  silver: 0, copper: 0 } },
        { id: "gl6",  name: "Level 6 Loot",  source: "loot-level:6",  cost: { gold: 6,  silver: 0, copper: 0 } },
        { id: "gl7",  name: "Level 7 Loot",  source: "loot-level:7",  cost: { gold: 8,  silver: 0, copper: 0 } },
        { id: "gl8",  name: "Level 8 Loot",  source: "loot-level:8",  cost: { gold: 12, silver: 0, copper: 0 } },
        { id: "gl9",  name: "Level 9 Loot",  source: "loot-level:9",  cost: { gold: 15, silver: 0, copper: 0 } },
        { id: "gl10", name: "Level 10 Loot", source: "loot-level:10", cost: { gold: 50, silver: 0, copper: 0 } },
      ],
    });
    game.settings.register(MODULE_ID, "shopName", {
      name: "Merchant Shop Name",
      hint: "Display name shown on the shop window.",
      scope: "world", config: false, type: String, default: "The Merchant",
    });
    game.settings.register(MODULE_ID, "savedShopConfigs", {
      scope: "world", config: false, type: Object, default: {},
    });
  },

  // ── Init (socket listeners) ───────────────────────────────────────────────

  init() {
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      // GM-side: handle buy/sell requests from players
      if (game.user.isGM) {
        if (data.action === "shop:buy")        await this._handleBuy(data);
        if (data.action === "shop:sell")       await this._handleSell(data);
        if (data.action === "shop:catalogBuy") await this._handleCatalogBuy(data);
        if (data.action === "shop:gamble")     await this._handleGamble(data);
      }

      // All clients: handle broadcasts from GM
      if (data.action === "shop:open")   this._onRemoteOpen(data);
      if (data.action === "shop:close")  this._onRemoteClose();
      if (data.action === "shop:result") this._onResult(data);
    });

    console.log(`${MODULE_ID} | Merchant Shop initialized.`);
  },

  // ── Open / Close ──────────────────────────────────────────────────────────

  /**
   * GM opens the shop for all connected players.
   * @param {Object} [opts]
   * @param {"compendium"|"actor"} [opts.mode="compendium"]
   * @param {string} [opts.actorId] — NPC actor ID for actor mode
   */
  open(opts = {}) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open the Merchant Shop.");
      return;
    }

    const mode = opts.mode ?? "compendium";
    const actorId = opts.actorId ?? null;
    const shopName = game.settings.get(MODULE_ID, "shopName") || "The Merchant";
    const sellRatio = game.settings.get(MODULE_ID, "shopSellRatio") ?? 50;
    const inventory = this._buildInventory(mode, actorId);

    // Open locally for GM only — no broadcast until "Open for All" is clicked
    this._ensureApp();
    this._app._shopName = shopName;
    this._app._sellRatio = sellRatio;
    this._app._mode = mode;
    this._app._actorId = actorId;
    this._app._inventory = inventory;
    this._app._tab = "manage";
    this._app.render(true);
  },

  /** GM closes the shop on all clients. */
  close() {
    if (!game.user.isGM) return;
    if (this._isOpenForPlayers) {
      this._isOpenForPlayers = false;
      game.socket.emit(`module.${MODULE_ID}`, { action: "shop:close" });
    }
    this._app?.close();
  },

  _ensureApp() {
    if (!this._app) this._app = new MerchantShopApp();
  },

  // ── Inventory builders ────────────────────────────────────────────────────

  _buildInventory(mode, actorId) {
    if (mode === "actor" && actorId) {
      return this._buildActorInventory(actorId);
    }
    return this._buildCompendiumInventory();
  },

  _buildCompendiumInventory() {
    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
    return foundry.utils.deepClone(inv);
  },

  _buildActorInventory(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return [];
    return actor.items
      .filter(i => i.type === "equipment")
      .map(i => ({
        id: i.id,
        name: i.name,
        img: i.img,
        uuid: i.uuid,
        type: i.type,
        baseCost: foundry.utils.deepClone(i.system.baseCost ?? { gold: 0, silver: 0, copper: 0 }),
        stock: i.getFlag(MODULE_ID, "unlimitedStock") ? -1 : (i.system.quantity ?? 1),
        itemData: i.toObject(),
        category: i.system.gearCategory || i.system.equipmentType || "Other",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // ── Remote handlers (all clients) ─────────────────────────────────────────

  _onRemoteOpen(data) {
    // Don't re-open for the GM who initiated it
    if (game.user.isGM) return;

    this._ensureApp();
    this._app._shopName = data.shopName;
    this._app._sellRatio = data.sellRatio;
    this._app._mode = data.mode;
    this._app._actorId = data.actorId;
    this._app._inventory = foundry.utils.deepClone(data.inventory || []);
    this._app._catalogEnabled = data.catalogEnabled ?? true;
    this._app._buyMultiplier = data.buyMultiplier ?? 100;
    this._app._gambleEnabled = data.gambleEnabled ?? false;
    this._app._tab = data.catalogEnabled === false && (!data.inventory || data.inventory.length === 0) ? "catalog" : "buy";
    this._app.render(true);
  },

  _onRemoteClose() {
    if (game.user.isGM) return;
    this._app?.close();
  },

  _onResult(data) {
    // Show notification
    if (data.success) {
      const verb = data.txAction === "buy" ? "bought" : "sold";
      const qtyStr = data.quantity > 1 ? ` ×${data.quantity}` : "";
      ui.notifications.info(`${data.playerName} ${verb} ${data.itemName}${qtyStr} for ${_formatPrice(data.price)}.`);
    } else {
      // Only show error to the player who initiated
      if (data.userId === game.userId) {
        ui.notifications.warn(data.error || "Transaction failed.");
      }
    }

    // Update inventory stock in local app
    if (data.success && this._app?._inventory) {
      if (data.inventory) {
        this._app._inventory = foundry.utils.deepClone(data.inventory);
      } else if (data.stockUpdate) {
        const entry = this._app._inventory.find(e => e.id === data.stockUpdate.id);
        if (entry) entry.stock = data.stockUpdate.newStock;
      }
    }

    // Re-render the app if open
    if (this._app?.rendered) this._app.render();
  },

  // ── Buy handler (GM-side) ─────────────────────────────────────────────────

  async _handleBuy(data) {
    const { buyerActorId, shopItemId, quantity, buyMultiplier, userId } = data;
    const buyer = game.actors.get(buyerActorId);
    if (!buyer) return this._broadcastError("Actor not found.", userId);

    // Find item in inventory
    const inv = this._buildInventory(
      this._app?._mode ?? "compendium",
      this._app?._actorId ?? null,
    );
    const entry = inv.find(e => e.id === shopItemId);
    if (!entry) return this._broadcastError("Item not found in shop.", userId);

    // Check stock
    if (entry.stock !== -1 && entry.stock < quantity) {
      return this._broadcastError("Not enough stock.", userId);
    }

    // Calculate total cost (with buy multiplier)
    const mult = (buyMultiplier ?? this._app?._buyMultiplier ?? 100) / 100;
    const totalCopper = Math.round(_toCopper(entry.baseCost) * mult * quantity);
    const totalCost = _fromCopper(totalCopper);

    // Check funds
    if (!_canAfford(buyer, totalCost)) {
      return this._broadcastError("Insufficient funds.", userId);
    }

    // Execute: deduct currency
    const remaining = _fromCopper(_toCopper(buyer.system.currency) - totalCopper);
    await buyer.update({
      "system.currency.gold": remaining.gold,
      "system.currency.silver": remaining.silver,
      "system.currency.copper": remaining.copper,
    });

    // Execute: create item(s) on buyer. ALWAYS override quantity — the
    // source itemData is cloned from the merchant's inventory (NPC mode)
    // or the compendium entry, and its existing `quantity` reflects the
    // merchant's stack size, not what the buyer requested. Leaving the
    // original value in place on a single-item purchase used to transfer
    // the entire stack by accident.
    const itemData = foundry.utils.deepClone(entry.itemData);
    if (!itemData.system) itemData.system = {};
    itemData.system.quantity = quantity;
    await Item.create(itemData, { parent: buyer });

    // Execute: update stock
    let newStock = entry.stock;
    if (entry.stock !== -1) {
      newStock = entry.stock - quantity;
      await this._updateStock(entry.id, newStock);
    }

    // Log
    await this.logTransaction({
      player: buyer.name,
      action: "buy",
      item: entry.name,
      quantity,
      price: totalCost,
    });

    // Chat message
    const qtyStr = quantity > 1 ? ` ×${quantity}` : "";
    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${entry.img || "icons/svg/item-bag.svg"}" alt="${entry.name}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Purchased</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${buyer.name}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              <p><strong>${buyer.name}</strong> bought <strong>${entry.name}${qtyStr}</strong> for ${_formatPrice(totalCost)}.</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    // Broadcast result
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "shop:result",
      success: true,
      txAction: "buy",
      playerName: buyer.name,
      itemName: entry.name,
      quantity,
      price: totalCost,
      userId,
      stockUpdate: { id: entry.id, newStock },
    });
    // Also handle locally
    this._onResult({
      success: true, txAction: "buy",
      playerName: buyer.name, itemName: entry.name,
      quantity, price: totalCost, userId,
      stockUpdate: { id: entry.id, newStock },
    });
  },

  // ── Sell handler (GM-side) ────────────────────────────────────────────────

  async _handleSell(data) {
    const { sellerActorId, itemId, quantity, userId } = data;
    const seller = game.actors.get(sellerActorId);
    if (!seller) return this._broadcastError("Actor not found.", userId);

    const item = seller.items.get(itemId);
    if (!item) return this._broadcastError("Item not found in inventory.", userId);

    const sellRatio = this._app?._sellRatio ?? game.settings.get(MODULE_ID, "shopSellRatio") ?? 50;
    const baseCost = item.system.baseCost ?? { gold: 0, silver: 0, copper: 0 };
    const unitSellPrice = _applySellRatio(baseCost, sellRatio);
    const totalCopper = _toCopper(unitSellPrice) * quantity;
    const totalSellPrice = _fromCopper(totalCopper);

    const originalUuid = item.uuid;
    const itemData = foundry.utils.deepClone(item.toObject());
    delete itemData._id;
    delete itemData.uuid;
    itemData.system.quantity = quantity;

    // Remove item(s)
    const currentQty = item.system.quantity ?? 1;
    if (quantity >= currentQty) {
      await item.delete();
    } else {
      await item.update({ "system.quantity": currentQty - quantity });
    }

    // Add currency to seller
    const newTotal = _fromCopper(_toCopper(seller.system.currency) + totalCopper);
    await seller.update({
      "system.currency.gold": newTotal.gold,
      "system.currency.silver": newTotal.silver,
      "system.currency.copper": newTotal.copper,
    });

    // Restock the merchant with the sold item
    await this._restockMerchantInventory(itemData, quantity, originalUuid);

    // Refresh open shop inventory if applicable
    if (this._app?.rendered) {
      this._app._inventory = this._buildInventory(
        this._app._mode ?? "compendium",
        this._app._actorId ?? null,
      );
      this._app.render();
    }

    // Log
    await this.logTransaction({
      player: seller.name,
      action: "sell",
      item: item.name,
      quantity,
      price: totalSellPrice,
    });

    // Chat message
    const qtyStr = quantity > 1 ? ` ×${quantity}` : "";
    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${item.img || "icons/svg/item-bag.svg"}" alt="${item.name}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Sold</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${seller.name}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              <p><strong>${seller.name}</strong> sold <strong>${item.name}${qtyStr}</strong> for ${_formatPrice(totalSellPrice)} (${sellRatio}%).</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    const updatedInventory = this._buildInventory(
      this._app?._mode ?? "compendium",
      this._app?._actorId ?? null,
    );

    // Broadcast
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "shop:result",
      success: true,
      txAction: "sell",
      playerName: seller.name,
      itemName: item.name,
      quantity,
      price: totalSellPrice,
      userId,
      stockUpdate: null,
      inventory: updatedInventory,
    });
    this._onResult({
      success: true, txAction: "sell",
      playerName: seller.name, itemName: item.name,
      quantity, price: totalSellPrice, userId,
      stockUpdate: null,
      inventory: updatedInventory,
    });
  },

  // ── Catalog buy handler (GM-side) ──────────────────────────────────────────

  async _handleCatalogBuy(data) {
    const { buyerActorId, itemUuid, quantity, buyMultiplier, userId } = data;
    const buyer = game.actors.get(buyerActorId);
    if (!buyer) return this._broadcastError("Actor not found.", userId);

    // Load the item from compendium
    const doc = await fromUuid(itemUuid);
    if (!doc) return this._broadcastError("Item not found in compendium.", userId);

    const baseCost = doc.system.baseCost ?? { gold: 0, silver: 0, copper: 0 };
    const catMult = (buyMultiplier ?? this._app?._buyMultiplier ?? 100) / 100;
    const totalCopper = Math.round(_toCopper(baseCost) * catMult * quantity);
    const totalCost = _fromCopper(totalCopper);

    // Check funds
    if (!_canAfford(buyer, totalCost)) {
      return this._broadcastError("Insufficient funds.", userId);
    }

    // Deduct currency
    const remaining = _fromCopper(_toCopper(buyer.system.currency) - totalCopper);
    await buyer.update({
      "system.currency.gold": remaining.gold,
      "system.currency.silver": remaining.silver,
      "system.currency.copper": remaining.copper,
    });

    // Create item on buyer
    const itemData = doc.toObject();
    if (quantity > 1) itemData.system.quantity = quantity;
    await Item.create(itemData, { parent: buyer });

    // Log
    await this.logTransaction({
      player: buyer.name,
      action: "buy",
      item: doc.name,
      quantity,
      price: totalCost,
    });

    // Chat message
    const qtyStr = quantity > 1 ? ` ×${quantity}` : "";
    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${doc.img || "icons/svg/item-bag.svg"}" alt="${doc.name}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Purchased</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${buyer.name}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              <p><strong>${buyer.name}</strong> bought <strong>${doc.name}${qtyStr}</strong> for ${_formatPrice(totalCost)}.</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    const updatedInventory = this._buildInventory(
      this._app?._mode ?? "compendium",
      this._app?._actorId ?? null,
    );

    // Broadcast result
    const result = {
      action: "shop:result",
      success: true,
      txAction: "buy",
      playerName: buyer.name,
      itemName: doc.name,
      quantity,
      price: totalCost,
      userId,
      stockUpdate: null,
      inventory: updatedInventory,
    };
    game.socket.emit(`module.${MODULE_ID}`, result);
    this._onResult(result);
  },

  // ── Gamble handler (GM-side) ────────────────────────────────────────────

  async _handleGamble(data) {
    const { buyerActorId, gambleId, userId } = data;
    const buyer = game.actors.get(buyerActorId);
    if (!buyer) return this._broadcastError("Actor not found.", userId);

    // Find the gamble option
    const options = game.settings.get(MODULE_ID, "gambleOptions") || [];
    const option = options.find(o => o.id === gambleId);
    if (!option) return this._broadcastError("Gamble option not found.", userId);

    const costCopper = _toCopper(option.cost);

    // Check funds
    if (_toCopper(buyer.system.currency) < costCopper) {
      return this._broadcastError("Insufficient funds.", userId);
    }

    // Deduct cost
    const remaining = _fromCopper(_toCopper(buyer.system.currency) - costCopper);
    await buyer.update({
      "system.currency.gold": remaining.gold,
      "system.currency.silver": remaining.silver,
      "system.currency.copper": remaining.copper,
    });

    // Roll loot from the configured source
    const result = { currency: { gold: 0, silver: 0, copper: 0 }, items: [] };

    if (option.source.startsWith("loot-level:")) {
      // Built-in level loot
      const level = parseInt(option.source.split(":")[1]);
      const { generateLevelLoot } = await import("./loot-generator.mjs");
      const r = await generateLevelLoot(level);
      if (r) {
        result.currency = r.currency;
        result.items = r.items;
      }
    } else {
      // World RollTable
      const table = await fromUuid(option.source);
      if (table) {
        const draw = await table.draw({ displayChat: false, resetTable: false });
        const { generateLoot } = await import("./loot-tables.mjs");
        // Process table results into currency + items
        for (const r of draw.results) {
          if (r.documentUuid) {
            const doc = await fromUuid(r.documentUuid);
            if (doc) {
              if (doc instanceof RollTable) {
                // Sub-table: draw from it too
                const subDraw = await doc.draw({ displayChat: false, resetTable: false });
                for (const sr of subDraw.results) {
                  if (sr.documentUuid) {
                    const sdoc = await fromUuid(sr.documentUuid);
                    if (sdoc && !(sdoc instanceof RollTable)) result.items.push(sdoc.toObject());
                  }
                }
              } else {
                result.items.push(doc.toObject());
              }
            }
          }
        }
      }
    }

    // Add currency to buyer
    if (result.currency.gold || result.currency.silver || result.currency.copper) {
      const newTotal = _fromCopper(
        _toCopper(buyer.system.currency) + _toCopper(result.currency),
      );
      await buyer.update({
        "system.currency.gold": newTotal.gold,
        "system.currency.silver": newTotal.silver,
        "system.currency.copper": newTotal.copper,
      });
    }

    // Create items on buyer
    for (const itemData of result.items) {
      await Item.create(itemData, { parent: buyer });
    }

    // Build description
    const lootParts = [];
    if (result.currency.gold) lootParts.push(`${result.currency.gold} Gold`);
    if (result.currency.silver) lootParts.push(`${result.currency.silver} Silver`);
    if (result.currency.copper) lootParts.push(`${result.currency.copper} Copper`);
    for (const it of result.items) lootParts.push(it.name);
    const lootDesc = lootParts.join(", ") || "nothing";
    const costDisplay = _formatPrice(option.cost);

    // Log
    await this.logTransaction({
      player: buyer.name,
      action: "buy",
      item: `Gamble (${option.name}): ${lootDesc}`,
      quantity: 1,
      price: option.cost,
    });

    // Chat message
    const itemIcon = result.items[0]?.img || "icons/svg/dice-target.svg";
    const itemLines = result.items.map(it => {
      const bc = it.system?.baseCost;
      const vp = [];
      if (bc?.gold) vp.push(`${bc.gold}g`);
      if (bc?.silver) vp.push(`${bc.silver}s`);
      const valStr = vp.length ? ` (${vp.join(" ")})` : "";
      return `<strong>${it.name}</strong>${valStr}`;
    }).join("<br>");

    const currLine = (result.currency.gold || result.currency.silver || result.currency.copper)
      ? `<br><i class="fas fa-coins"></i> ${lootParts.filter(p => p.match(/Gold|Silver|Copper/)).join(", ")}`
      : "";

    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${itemIcon}" alt="Gamble">
            </div>
            <div class="header-info">
              <h3 class="header-title">Gamble — ${option.name}</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${buyer.name}</span></div>
                <div class="meta-tag"><span>Cost: ${costDisplay}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 8px;">
              <p>${itemLines || "<em>No items</em>"}${currLine}</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    // Broadcast result
    const resultData = {
      action: "shop:result",
      success: true,
      txAction: "buy",
      playerName: buyer.name,
      itemName: `Gamble (${option.name})`,
      quantity: 1,
      price: option.cost,
      userId,
      stockUpdate: null,
    };
    game.socket.emit(`module.${MODULE_ID}`, resultData);
    this._onResult(resultData);
  },

  // ── Stock management ──────────────────────────────────────────────────────

  async _updateStock(shopItemId, newStock) {
    if (this._app?._mode === "actor" && this._app?._actorId) {
      const actor = game.actors.get(this._app._actorId);
      const item = actor?.items.get(shopItemId);
      if (item && !item.getFlag(MODULE_ID, "unlimitedStock")) {
        if (newStock <= 0) await item.delete();
        else await item.update({ "system.quantity": newStock });
      }
    } else {
      const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
      const entry = inv.find(e => e.id === shopItemId);
      if (entry) {
        entry.stock = newStock;
        await game.settings.set(MODULE_ID, "shopInventory", inv);
      }
    }
  },

  async _restockMerchantInventory(itemData, quantity, originalUuid = null) {
    const mode = this._app?._mode ?? "compendium";
    if (mode === "actor" && this._app?._actorId) {
      const merchant = game.actors.get(this._app._actorId);
      if (!merchant) return;
      itemData.system.quantity = quantity;
      await Item.create(itemData, { parent: merchant });
      return;
    }

    const inv = foundry.utils.deepClone(game.settings.get(MODULE_ID, "shopInventory") || []);
    const existing = inv.find(
      e => (originalUuid && e.uuid === originalUuid) || (e.name === itemData.name && e.type === itemData.type),
    );
    if (existing) {
      if (existing.stock !== -1) {
        existing.stock = (existing.stock ?? 0) + quantity;
      }
    } else {
      itemData.system.quantity = quantity;
      inv.push({
        id: foundry.utils.randomID(),
        name: itemData.name,
        img: itemData.img,
        uuid: originalUuid,
        type: itemData.type,
        baseCost: foundry.utils.deepClone(itemData.system.baseCost ?? { gold: 0, silver: 0, copper: 0 }),
        stock: quantity,
        itemData,
        category: itemData.system?.gearCategory || itemData.system?.equipmentType || "Other",
      });
    }
    await game.settings.set(MODULE_ID, "shopInventory", inv);
  },

  _broadcastError(error, userId) {
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "shop:result",
      success: false,
      error,
      userId,
    });
    // Also show locally if the GM did the action
    if (userId === game.userId) {
      ui.notifications.warn(error);
    }
  },

  // ── Inventory management (GM) ─────────────────────────────────────────────

  async addItemToShop(uuid, stock = -1) {
    const doc = await fromUuid(uuid);
    if (!doc) { ui.notifications.warn("Item not found."); return; }

    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];

    // Check for duplicate
    if (inv.find(e => e.uuid === uuid)) {
      ui.notifications.info(`${doc.name} is already in the shop.`);
      return;
    }

    inv.push({
      id: foundry.utils.randomID(),
      name: doc.name,
      img: doc.img,
      uuid,
      type: doc.type,
      baseCost: foundry.utils.deepClone(doc.system.baseCost ?? { gold: 0, silver: 0, copper: 0 }),
      stock,
      itemData: doc.toObject(),
      category: doc.system?.gearCategory || doc.system?.equipmentType || "Other",
    });

    await game.settings.set(MODULE_ID, "shopInventory", inv);
    if (this._app?.rendered) this._app.render();
  },

  async removeItemFromShop(shopItemId) {
    const inv = (game.settings.get(MODULE_ID, "shopInventory") || [])
      .filter(e => e.id !== shopItemId);
    await game.settings.set(MODULE_ID, "shopInventory", inv);
    if (this._app?.rendered) this._app.render();
  },

  async setItemStock(shopItemId, stock) {
    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
    const entry = inv.find(e => e.id === shopItemId);
    if (entry) {
      entry.stock = stock;
      await game.settings.set(MODULE_ID, "shopInventory", inv);
      if (this._app?.rendered) this._app.render();
    }
  },

  async setItemPrice(shopItemId, baseCost) {
    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
    const entry = inv.find(e => e.id === shopItemId);
    if (entry) {
      entry.baseCost = baseCost;
      await game.settings.set(MODULE_ID, "shopInventory", inv);
      if (this._app?.rendered) this._app.render();
    }
  },

  // ── Transaction log ───────────────────────────────────────────────────────

  async logTransaction(entry) {
    const log = game.settings.get(MODULE_ID, "shopLog") || [];
    log.push({
      ...entry,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    await game.settings.set(MODULE_ID, "shopLog", log);
    if (this._app?.rendered) this._app.render();
  },

  getLog() {
    return game.settings.get(MODULE_ID, "shopLog") || [];
  },

  async clearLog() {
    await game.settings.set(MODULE_ID, "shopLog", []);
    if (this._app?.rendered) this._app.render();
  },

  formatForDiscord() {
    const log = this.getLog();
    if (log.length === 0) return "No merchant transactions recorded this session.";

    // Group by player
    const byPlayer = {};
    for (const e of log) {
      if (!byPlayer[e.player]) byPlayer[e.player] = [];
      byPlayer[e.player].push(e);
    }

    const lines = ["# Merchant Transactions", ""];

    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`## ${player}`);

      const buys = entries.filter(e => e.action === "buy");
      const sells = entries.filter(e => e.action === "sell");

      if (buys.length) {
        lines.push("**Purchases:**");
        for (const e of buys) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)}) — ${e.time}`);
        }
      }

      if (sells.length) {
        lines.push("**Sales:**");
        for (const e of sells) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)}) — ${e.time}`);
        }
      }

      // Per-player totals
      let spent = 0, earned = 0;
      for (const e of buys) spent += _toCopper(e.price);
      for (const e of sells) earned += _toCopper(e.price);
      const parts = [];
      if (spent) parts.push(`Spent: ${_formatPrice(_fromCopper(spent))}`);
      if (earned) parts.push(`Earned: ${_formatPrice(_fromCopper(earned))}`);
      if (parts.length) lines.push(`*${parts.join(" | ")}*`);

      lines.push("");
    }

    return lines.join("\n");
  },
  /**
   * Combined session summary: loot drops + merchant transactions, grouped by player.
   */
  formatSessionSummary() {
    const lootTracker = game.vagabondCrawler?.lootTracker;
    const lootLog = lootTracker?.getLog() ?? [];
    const shopLog = this.getLog();

    if (!lootLog.length && !shopLog.length) return "No activity recorded this session.";

    // Collect all player names
    const players = new Set();
    for (const e of lootLog) players.add(e.player);
    for (const e of shopLog) players.add(e.player);

    const lines = ["# Session Summary", ""];

    for (const player of [...players].sort()) {
      lines.push(`## ${player}`);

      // Loot gained
      const lootEntries = lootLog.filter(e => e.player === player);
      const currEntries = lootEntries.filter(e => e.type === "currency");
      const itemEntries = lootEntries.filter(e => e.type === "item" || e.type === "pickup");

      if (currEntries.length || itemEntries.length) {
        lines.push("**Loot Gained:**");
        if (currEntries.length) {
          let totalGold = 0, totalSilver = 0, totalCopper = 0;
          for (const e of currEntries) {
            const gm = e.detail.match(/(\d+)\s*Gold/i);
            const sm = e.detail.match(/(\d+)\s*Silver/i);
            const cm = e.detail.match(/(\d+)\s*Copper/i);
            if (gm) totalGold += parseInt(gm[1]);
            if (sm) totalSilver += parseInt(sm[1]);
            if (cm) totalCopper += parseInt(cm[1]);
          }
          const cp = [];
          if (totalGold) cp.push(`${totalGold}g`);
          if (totalSilver) cp.push(`${totalSilver}s`);
          if (totalCopper) cp.push(`${totalCopper}c`);
          if (cp.length) lines.push(`- Currency: ${cp.join(", ")}`);
        }
        for (const e of itemEntries) {
          const src = e.source !== "Ground" ? ` *(from ${e.source})*` : " *(picked up)*";
          lines.push(`- ${e.detail}${src}`);
        }
      }

      // Purchases
      const buys = shopLog.filter(e => e.player === player && e.action === "buy");
      if (buys.length) {
        lines.push("**Purchased:**");
        for (const e of buys) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)})`);
        }
      }

      // Sales
      const sells = shopLog.filter(e => e.player === player && e.action === "sell");
      if (sells.length) {
        lines.push("**Sold:**");
        for (const e of sells) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)})`);
        }
      }

      // Player totals
      let spent = 0, earned = 0;
      for (const e of buys) spent += _toCopper(e.price);
      for (const e of sells) earned += _toCopper(e.price);
      const parts = [];
      if (spent) parts.push(`Spent: ${_formatPrice(_fromCopper(spent))}`);
      if (earned) parts.push(`Earned: ${_formatPrice(_fromCopper(earned))}`);
      if (parts.length) lines.push(`*${parts.join(" | ")}*`);

      lines.push("");
    }

    return lines.join("\n");
  },
};

// ── ApplicationV2: MerchantShopApp ──────────────────────────────────────────

const ITEM_PACKS = [
  "vagabond.gear",
  "vagabond.weapons",
  "vagabond.armor",
  "vagabond.alchemical-items",
  "vagabond.relics",
];

/** Packs available in the Catalog tab (common items only, no relics). */
const CATALOG_PACKS = [
  "vagabond.gear",
  "vagabond.weapons",
  "vagabond.armor",
  "vagabond.alchemical-items",
];

class MerchantShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-merchant-shop",
    tag: "div",
    window: { title: "Merchant Shop", resizable: true },
    position: { width: 740, height: 620 },
    classes: ["vagabond-crawler-merchant-shop"],
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/merchant-shop.hbs" },
  };

  constructor() {
    super();
    this._mode = "compendium";
    this._actorId = null;
    this._inventory = [];
    this._sellRatio = 50;
    this._buyMultiplier = 100;  // percentage: 100 = normal, 150 = markup, 80 = discount
    this._shopName = "The Merchant";
    this._tab = "buy";
    this._searchFilter = "";
    this._categoryFilter = "all";
    this._compendiumCache = null;
    this._compendiumFilter = "";
    this._compendiumPack = ITEM_PACKS[0];
    // Catalog tab state
    this._catalogEnabled = true;
    this._gambleEnabled = false;
    this._catalogCache = null;
    this._catalogSearch = "";
    this._catalogPack = "all";
    this._catalogFolder = "all";
    this._catalogSort = "name";
  }

  get title() {
    const status = game.user.isGM
      ? (MerchantShop._isOpenForPlayers ? "Open" : "Closed")
      : null;
    return status ? `${this._shopName} — ${status}` : this._shopName;
  }

  // ── Data ────────────────────────────────────────────────────────────────

  async _prepareContext() {
    const isGM = game.user.isGM;
    const playerActor = this._getPlayerActor();
    const wallet = playerActor?.system?.currency ?? { gold: 0, silver: 0, copper: 0 };
    const walletCopper = _toCopper(wallet);

    // Build display inventory (apply buy multiplier to prices)
    const mult = this._buyMultiplier / 100;
    const inventory = (this._inventory || []).map(entry => {
      const adjustedCopper = Math.round(_toCopper(entry.baseCost) * mult);
      const adjustedCost = _fromCopper(adjustedCopper);
      const canAfford = walletCopper >= adjustedCopper;
      const outOfStock = entry.stock === 0;
      return {
        ...entry,
        priceDisplay: _formatPrice(adjustedCost),
        stockDisplay: entry.stock === -1 ? "∞" : String(entry.stock),
        canAfford: canAfford && !outOfStock,
        outOfStock,
        category: entry.category || "Other",
      };
    });

    // Filter
    let filteredInventory = inventory;
    if (this._searchFilter) {
      const s = this._searchFilter.toLowerCase();
      filteredInventory = filteredInventory.filter(e => e.name.toLowerCase().includes(s));
    }
    if (this._categoryFilter !== "all") {
      filteredInventory = filteredInventory.filter(e => e.category === this._categoryFilter);
    }

    // Categories for dropdown
    const categories = [...new Set(inventory.map(e => e.category))].sort();

    // Player inventory for Sell tab
    let sellItems = [];
    if (playerActor) {
      sellItems = playerActor.items
        .filter(i => i.type === "equipment")
        .map(i => {
          const baseCost = i.system.baseCost ?? { gold: 0, silver: 0, copper: 0 };
          const sellPrice = _applySellRatio(baseCost, this._sellRatio);
          return {
            id: i.id,
            name: i.name,
            img: i.img,
            quantity: i.system.quantity ?? 1,
            baseCostDisplay: _formatPrice(baseCost),
            sellPriceDisplay: _formatPrice(sellPrice),
            sellPriceCopper: _toCopper(sellPrice),
            isJunk: !!i.getFlag(MODULE_ID, "junk"),
          };
        })
        .sort((a, b) => {
          // Junk items first
          if (a.isJunk !== b.isJunk) return a.isJunk ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    }

    // Log for Log tab
    const log = MerchantShop.getLog();
    const logEntries = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
      logEntries.push({
        ...e,
        qtyStr,
        priceDisplay: _formatPrice(e.price),
        isBuy: e.action === "buy",
      });
    }

    // NPC actors for actor mode selector
    // Only actor types that support inventory (characters, constructs)
    const npcActors = isGM
      ? game.actors
          .filter(a => a.type === "character" || a.type === "construct")
          .map(a => ({ id: a.id, name: a.name, type: a.type, selected: a.id === this._actorId }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    // Compendium browser for manage tab
    let compendiumItems = [];
    if (isGM && this._tab === "manage") {
      compendiumItems = await this._loadCompendiumItems();
    }

    // Catalog tab data
    let catalogItems = [];
    let catalogPacks = [];
    let catalogFolders = [];
    if (this._tab === "catalog") {
      const catalog = await this._loadCatalog();

      // Filter
      let filtered = catalog;
      if (this._catalogPack !== "all") {
        filtered = filtered.filter(e => e.packId === this._catalogPack);
      }
      if (this._catalogFolder !== "all") {
        filtered = filtered.filter(e => e.folder === this._catalogFolder);
      }
      if (this._catalogSearch) {
        const s = this._catalogSearch.toLowerCase();
        filtered = filtered.filter(e => e.name.toLowerCase().includes(s));
      }

      // Sort
      if (this._catalogSort === "value-asc") {
        filtered.sort((a, b) => a.copperValue - b.copperValue);
      } else if (this._catalogSort === "value-desc") {
        filtered.sort((a, b) => b.copperValue - a.copperValue);
      } else {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
      }

      // Enrich with affordability
      catalogItems = filtered.map(e => {
        const adjCopper = Math.round(e.copperValue * mult);
        return {
          ...e,
          priceDisplay: _formatPrice(_fromCopper(adjCopper)),
          canAfford: walletCopper >= adjCopper,
        };
      });

      // Pack list for filter
      catalogPacks = CATALOG_PACKS.map(p => ({
        id: p,
        label: game.packs.get(p)?.metadata?.label ?? p,
        selected: p === this._catalogPack,
      }));

      // Folder list (only for the selected pack, or all gear folders if "all")
      const folderPack = this._catalogPack !== "all" ? this._catalogPack : "vagabond.gear";
      const pack = game.packs.get(folderPack);
      if (pack?.folders?.size) {
        catalogFolders = [...pack.folders]
          .map(f => ({ id: f.id, name: f.name, selected: f.id === this._catalogFolder }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    return {
      isGM,
      shopName: this._shopName,
      tab: this._tab,
      tabs: this._buildTabs(),
      wallet: _formatPrice(wallet),
      walletDetail: `${wallet.gold}g ${wallet.silver}s ${wallet.copper}c`,
      hasActor: !!playerActor,
      actorName: playerActor?.name ?? "No Character",
      inventory: filteredInventory,
      categories,
      categoryFilter: this._categoryFilter,
      searchFilter: this._searchFilter,
      sellItems,
      sellRatio: this._sellRatio,
      hasJunk: sellItems.some(i => i.isJunk),
      logEntries,
      mode: this._mode,
      actorId: this._actorId,
      npcActors,
      compendiumItems,
      compendiumPacks: ITEM_PACKS.map(p => ({
        id: p,
        label: game.packs.get(p)?.metadata?.label ?? p,
        selected: p === this._compendiumPack,
      })),
      compendiumFilter: this._compendiumFilter,
      catalogItems,
      catalogPacks,
      catalogFolders,
      catalogSearch: this._catalogSearch,
      catalogPack: this._catalogPack,
      catalogFolder: this._catalogFolder,
      catalogSort: this._catalogSort,
      showFolderFilter: catalogFolders.length > 0,
      catalogEnabled: this._catalogEnabled,
      buyMultiplier: this._buyMultiplier,
      gambleEnabled: this._gambleEnabled,
      gambleOptions: (game.settings.get(MODULE_ID, "gambleOptions") || []).map(o => ({
        ...o,
        costDisplay: _formatPrice(o.cost),
        canAfford: walletCopper >= _toCopper(o.cost),
      })),
      // Available sources for the gamble config on Manage tab
      gambleSources: [
        ...Array.from({ length: 10 }, (_, i) => ({ id: `loot-level:${i + 1}`, label: `Loot Level ${i + 1}` })),
        ...game.tables.contents.map(t => ({ id: t.uuid, label: t.name })),
      ],
      savedConfigs: game.settings.get(MODULE_ID, "savedShopConfigs") || {},
    };
  }

  _buildTabs() {
    const isGM = game.user.isGM;
    const showCatalog = this._catalogEnabled || isGM;
    const tabs = [
      { id: "buy",     label: "Buy",     icon: "fa-cart-shopping",  active: this._tab === "buy" },
    ];
    if (showCatalog) {
      tabs.push({ id: "catalog", label: "Catalog", icon: "fa-book-open", active: this._tab === "catalog" });
    }
    if (this._gambleEnabled || isGM) {
      tabs.push({ id: "gamble", label: "Gamble", icon: "fa-dice", active: this._tab === "gamble" });
    }
    tabs.push(
      { id: "sell",    label: "Sell",    icon: "fa-coins",           active: this._tab === "sell" },
      { id: "log",     label: "Log",    icon: "fa-clipboard-list",  active: this._tab === "log" },
    );
    if (isGM) {
      tabs.push({ id: "manage", label: "Manage", icon: "fa-cog", active: this._tab === "manage" });
    }
    return tabs;
  }

  _getPlayerActor() {
    // Prefer selected token's actor (works for both GM and players, handles unlinked tokens)
    const token = canvas?.tokens?.controlled?.[0];
    if (token?.actor) return token.actor;
    // Fall back to assigned character for players
    if (!game.user.isGM) return game.user.character ?? null;
    return null;
  }

  async _loadCompendiumItems() {
    const packId = this._compendiumPack;
    if (!this._compendiumCache || this._compendiumCache._packId !== packId) {
      const pack = game.packs.get(packId);
      if (!pack) return [];
      const index = await pack.getIndex();
      this._compendiumCache = index.contents
        .map(e => ({ name: e.name, uuid: e.uuid, img: e.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this._compendiumCache._packId = packId;
    }

    let items = this._compendiumCache;
    if (this._compendiumFilter) {
      const f = this._compendiumFilter.toLowerCase();
      items = items.filter(e => e.name.toLowerCase().includes(f));
    }

    // Cap at 500 to keep DOM rendering snappy on very large packs; every
    // real Vagabond pack is well under this. The earlier 50 cutoff was
    // silently truncating vagabond.gear (100+ items) mid-way through the
    // alphabet ("Brewing tools" was the visible last entry) — bumping this
    // restores the full catalogue.
    return items.slice(0, 500);
  }

  async _loadCatalog() {
    if (this._catalogCache) return this._catalogCache;

    const items = [];
    for (const packId of CATALOG_PACKS) {
      const pack = game.packs.get(packId);
      if (!pack) continue;

      const index = await pack.getIndex({ fields: ["system.baseCost", "system.gearCategory"] });
      const packLabel = pack.metadata.label;

      // Build folder name map
      const folderMap = {};
      if (pack.folders?.size) {
        for (const f of pack.folders) folderMap[f.id] = f.name;
      }

      for (const entry of index.contents) {
        const baseCost = entry.system?.baseCost ?? { gold: 0, silver: 0, copper: 0 };
        items.push({
          name: entry.name,
          uuid: entry.uuid,
          img: entry.img,
          baseCost,
          copperValue: _toCopper(baseCost),
          packId,
          packLabel,
          folder: entry.folder ?? null,
          folderName: entry.folder ? (folderMap[entry.folder] ?? "") : "",
        });
      }
    }

    this._catalogCache = items;
    return items;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  _onRender() {
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    const on = (sel, evt, fn) => el.querySelectorAll(sel).forEach(n =>
      n.addEventListener(evt, fn, { signal }));

    // Tab switching
    on(".vcm-tab-btn", "click", (ev) => {
      this._tab = ev.currentTarget.dataset.tab;
      this.render();
    });

    // ── Item row interactions (all tabs) ──

    // Single click: toggle inline description
    on(".vcm-item-row", "click", async (ev) => {
      // Ignore clicks on buttons, inputs, or actions area
      if (ev.target.closest(".vcm-item-actions") || ev.target.closest("button") || ev.target.closest("input")) return;

      const row = ev.currentTarget;
      const existing = row.querySelector(".vcm-item-desc");
      if (existing) {
        existing.remove();
        return;
      }

      // Get UUID from row
      const uuid = row.dataset.itemUuid || this._getUuidForRow(row);
      if (!uuid) return;

      const doc = await fromUuid(uuid);
      if (!doc) return;

      const desc = doc.system?.description;
      const enriched = desc
        ? await foundry.applications.ux.TextEditor.enrichHTML(desc, { relativeTo: doc })
        : "<em>No description.</em>";

      const descEl = document.createElement("div");
      descEl.className = "vcm-item-desc";
      descEl.innerHTML = enriched;
      row.appendChild(descEl);
    });

    // Double click: open the full item sheet
    on(".vcm-item-row", "dblclick", async (ev) => {
      if (ev.target.closest(".vcm-item-actions") || ev.target.closest("button") || ev.target.closest("input")) return;

      const row = ev.currentTarget;
      const uuid = row.dataset.itemUuid || this._getUuidForRow(row);
      if (!uuid) return;

      const doc = await fromUuid(uuid);
      if (doc) doc.sheet.render(true);
    });

    // ── Buy tab ──

    /** Re-render without losing text-input focus. ApplicationV2's render()
     * rebuilds the DOM, so an input that triggered the render loses its
     * `document.activeElement` status — every keystroke kicks the user out.
     * We remember which input the keystroke came from + the caret position
     * and re-apply them once the new DOM is in place. */
    const renderKeepingFocus = (selector) => {
      const cursor = document.activeElement?.selectionStart ?? null;
      this.render().then(() => {
        const next = this.element?.querySelector(selector);
        if (!next) return;
        next.focus();
        try { if (cursor != null) next.setSelectionRange(cursor, cursor); } catch (_) {}
      });
    };

    // Search filter
    el.querySelector(".vcm-search-input")?.addEventListener("input", (ev) => {
      this._searchFilter = ev.currentTarget.value;
      renderKeepingFocus(".vcm-search-input");
    }, { signal });

    // Category filter
    el.querySelector(".vcm-category-select")?.addEventListener("change", (ev) => {
      this._categoryFilter = ev.currentTarget.value;
      this.render();
    }, { signal });

    // Buy buttons
    on(".vcm-buy-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-shop-item-id]");
      const shopItemId = row.dataset.shopItemId;
      const qtyInput = row.querySelector(".vcm-qty-input");
      const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
      await this._doBuy(shopItemId, quantity);
    });

    // ── Catalog tab ──

    el.querySelector(".vcm-catalog-search")?.addEventListener("input", (ev) => {
      this._catalogSearch = ev.currentTarget.value;
      renderKeepingFocus(".vcm-catalog-search");
    }, { signal });

    el.querySelector(".vcm-catalog-pack")?.addEventListener("change", (ev) => {
      this._catalogPack = ev.currentTarget.value;
      this._catalogFolder = "all";  // reset folder when pack changes
      this.render();
    }, { signal });

    el.querySelector(".vcm-catalog-folder")?.addEventListener("change", (ev) => {
      this._catalogFolder = ev.currentTarget.value;
      this.render();
    }, { signal });

    el.querySelector(".vcm-catalog-sort")?.addEventListener("change", (ev) => {
      this._catalogSort = ev.currentTarget.value;
      this.render();
    }, { signal });

    on(".vcm-catalog-buy-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-item-uuid]");
      const itemUuid = row.dataset.itemUuid;
      const qtyInput = row.querySelector(".vcm-qty-input");
      const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
      await this._doCatalogBuy(itemUuid, quantity);
    });

    // ── Gamble tab ──

    on(".vcm-gamble-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-gamble-id]");
      const gambleId = row.dataset.gambleId;
      await this._doGamble(gambleId);
    });

    // ── Sell tab ──

    on(".vcm-sell-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-item-id]");
      const itemId = row.dataset.itemId;
      const qtyInput = row.querySelector(".vcm-qty-input");
      const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
      await this._doSell(itemId, quantity);
    });

    // Sell all junk
    el.querySelector(".vcm-sell-all-junk")?.addEventListener("click", async () => {
      const actor = this._getPlayerActor();
      if (!actor) { ui.notifications.warn("No character selected."); return; }

      const junkItems = actor.items.filter(i =>
        i.type === "equipment" && i.getFlag(MODULE_ID, "junk")
      );
      if (!junkItems.length) { ui.notifications.info("No junk items to sell."); return; }

      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Sell All Junk" },
        content: `<p>Sell ${junkItems.length} junk item(s)?</p>`,
        rejectClose: false,
      });
      if (!ok) return;

      for (const item of junkItems) {
        const qty = item.system.quantity ?? 1;
        await this._doSell(item.id, qty);
      }
    }, { signal });

    // ── Log tab ──

    el.querySelector(".vcm-copy-discord")?.addEventListener("click", async () => {
      const text = MerchantShop.formatForDiscord();
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Shop log copied to clipboard!");
    }, { signal });

    el.querySelector(".vcm-copy-session")?.addEventListener("click", async () => {
      const text = MerchantShop.formatSessionSummary();
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Session summary copied to clipboard!");
    }, { signal });

    el.querySelector(".vcm-clear-log")?.addEventListener("click", async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Clear Transaction Log" },
        content: "<p>Clear all merchant transaction log entries?</p>",
        rejectClose: false,
      });
      if (ok) await MerchantShop.clearLog();
    }, { signal });

    // ── Manage tab (GM) ──

    if (game.user.isGM) {
      // Mode selector
      on(".vcm-mode-radio", "change", (ev) => {
        this._mode = ev.currentTarget.value;
        this.render();
      });

      // Actor selector
      el.querySelector(".vcm-actor-select")?.addEventListener("change", (ev) => {
        this._actorId = ev.currentTarget.value || null;
        if (this._mode === "actor" && this._actorId) {
          this._inventory = MerchantShop._buildActorInventory(this._actorId);
        }
        this.render();
      }, { signal });

      // Shop name
      el.querySelector(".vcm-shop-name-input")?.addEventListener("change", async (ev) => {
        this._shopName = ev.currentTarget.value || "The Merchant";
        await game.settings.set(MODULE_ID, "shopName", this._shopName);
      }, { signal });

      // Sell ratio
      // Buy markup
      el.querySelector(".vcm-markup-input")?.addEventListener("change", (ev) => {
        this._buyMultiplier = Math.max(10, Math.min(500, parseInt(ev.currentTarget.value) || 100));
        this.render();
      }, { signal });

      el.querySelector(".vcm-ratio-input")?.addEventListener("change", async (ev) => {
        this._sellRatio = Math.max(0, Math.min(100, parseInt(ev.currentTarget.value) || 50));
        await game.settings.set(MODULE_ID, "shopSellRatio", this._sellRatio);
        this.render();
      }, { signal });

      // Catalog toggle
      el.querySelector(".vcm-gamble-toggle")?.addEventListener("change", (ev) => {
        this._gambleEnabled = ev.currentTarget.checked;
        this.render();
      }, { signal });

      // Gamble config: add option
      el.querySelector(".vcm-gamble-add-btn")?.addEventListener("click", async () => {
        const nameInput = el.querySelector(".vcm-gamble-new-name");
        const sourceSelect = el.querySelector(".vcm-gamble-new-source");
        const goldInput = el.querySelector(".vcm-gamble-new-gold");
        const name = nameInput?.value?.trim();
        const source = sourceSelect?.value;
        const gold = parseInt(goldInput?.value) || 5;
        if (!name || !source) { ui.notifications.warn("Enter a name and select a table."); return; }

        const opts = game.settings.get(MODULE_ID, "gambleOptions") || [];
        opts.push({
          id: foundry.utils.randomID(),
          name,
          source,
          cost: { gold, silver: 0, copper: 0 },
        });
        await game.settings.set(MODULE_ID, "gambleOptions", opts);
        this.render();
      }, { signal });

      // Gamble config: remove option
      on(".vcm-gamble-remove-btn", "click", async (ev) => {
        const id = ev.currentTarget.closest("[data-gamble-config-id]").dataset.gambleConfigId;
        const opts = (game.settings.get(MODULE_ID, "gambleOptions") || []).filter(o => o.id !== id);
        await game.settings.set(MODULE_ID, "gambleOptions", opts);
        this.render();
      });

      // Gamble config: edit cost
      on(".vcm-gamble-cost-gold", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-gamble-config-id]").dataset.gambleConfigId;
        const opts = game.settings.get(MODULE_ID, "gambleOptions") || [];
        const opt = opts.find(o => o.id === id);
        if (opt) { opt.cost.gold = Math.max(0, parseInt(ev.currentTarget.value) || 0); await game.settings.set(MODULE_ID, "gambleOptions", opts); }
      });
      on(".vcm-gamble-cost-silver", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-gamble-config-id]").dataset.gambleConfigId;
        const opts = game.settings.get(MODULE_ID, "gambleOptions") || [];
        const opt = opts.find(o => o.id === id);
        if (opt) { opt.cost.silver = Math.max(0, parseInt(ev.currentTarget.value) || 0); await game.settings.set(MODULE_ID, "gambleOptions", opts); }
      });

      el.querySelector(".vcm-catalog-toggle")?.addEventListener("change", (ev) => {
        this._catalogEnabled = ev.currentTarget.checked;
        this.render();
      }, { signal });

      // Compendium pack selector
      el.querySelector(".vcm-pack-select")?.addEventListener("change", (ev) => {
        this._compendiumPack = ev.currentTarget.value;
        this._compendiumCache = null;
        this._compendiumFilter = "";
        this.render();
      }, { signal });

      // Compendium search
      el.querySelector(".vcm-comp-search")?.addEventListener("input", (ev) => {
        this._compendiumFilter = ev.currentTarget.value;
        renderKeepingFocus(".vcm-comp-search");
      }, { signal });

      // Add item from compendium
      on(".vcm-add-item-btn", "click", async (ev) => {
        const uuid = ev.currentTarget.dataset.uuid;
        await MerchantShop.addItemToShop(uuid, -1);
        this._inventory = MerchantShop._buildCompendiumInventory();
        this.render();
      });

      // Remove item from shop
      on(".vcm-remove-item-btn", "click", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        await MerchantShop.removeItemFromShop(id);
        this._inventory = MerchantShop._buildCompendiumInventory();
        this.render();
      });

      // Stock change
      on(".vcm-stock-input", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const val = parseInt(ev.currentTarget.value);
        const stock = isNaN(val) || val < 0 ? -1 : val;
        await MerchantShop.setItemStock(id, stock);
        this._inventory = MerchantShop._buildCompendiumInventory();
      });

      // Price change (gold)
      on(".vcm-price-gold", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
        const entry = inv.find(e => e.id === id);
        if (entry) {
          entry.baseCost.gold = Math.max(0, parseInt(ev.currentTarget.value) || 0);
          await game.settings.set(MODULE_ID, "shopInventory", inv);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      });

      // Price change (silver)
      on(".vcm-price-silver", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
        const entry = inv.find(e => e.id === id);
        if (entry) {
          entry.baseCost.silver = Math.max(0, parseInt(ev.currentTarget.value) || 0);
          await game.settings.set(MODULE_ID, "shopInventory", inv);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      });

      // Price change (copper)
      on(".vcm-price-copper", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
        const entry = inv.find(e => e.id === id);
        if (entry) {
          entry.baseCost.copper = Math.max(0, parseInt(ev.currentTarget.value) || 0);
          await game.settings.set(MODULE_ID, "shopInventory", inv);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      });

      // Open for all players
      el.querySelector(".vcm-open-for-all")?.addEventListener("click", () => {
        this._inventory = this._mode === "actor" && this._actorId
          ? MerchantShop._buildActorInventory(this._actorId)
          : MerchantShop._buildCompendiumInventory();

        MerchantShop._isOpenForPlayers = true;

        game.socket.emit(`module.${MODULE_ID}`, {
          action: "shop:open",
          mode: this._mode,
          actorId: this._actorId,
          shopName: this._shopName,
          sellRatio: this._sellRatio,
          inventory: this._inventory,
          catalogEnabled: this._catalogEnabled,
          buyMultiplier: this._buyMultiplier,
          gambleEnabled: this._gambleEnabled,
        });
        ui.notifications.info("Shop opened for all players!");
        this.render();
      }, { signal });

      // Close for all players
      el.querySelector(".vcm-close-for-all")?.addEventListener("click", () => {
        MerchantShop._isOpenForPlayers = false;
        game.socket.emit(`module.${MODULE_ID}`, { action: "shop:close" });
        ui.notifications.info("Shop closed for all players.");
        this.render();
      }, { signal });

      // Load saved config
      el.querySelector(".vcm-load-merchant-btn")?.addEventListener("click", async () => {
        const select = el.querySelector(".vcm-load-config-select");
        const configName = select?.value;
        if (!configName) { ui.notifications.warn("Select a configuration to load."); return; }

        const configs = game.settings.get(MODULE_ID, "savedShopConfigs") || {};
        const config = configs[configName];
        if (!config) { ui.notifications.warn("Configuration not found."); return; }

        // Apply the config
        this._mode = config.mode || "compendium";
        this._actorId = config.actorId || null;
        this._shopName = config.shopName || "The Merchant";
        this._sellRatio = config.sellRatio ?? 50;
        this._buyMultiplier = config.buyMultiplier ?? 100;
        this._catalogEnabled = config.catalogEnabled ?? true;
        this._gambleEnabled = config.gambleEnabled ?? false;
        this._inventory = foundry.utils.deepClone(config.inventory || []);

        // Update settings
        await game.settings.set(MODULE_ID, "shopName", this._shopName);
        await game.settings.set(MODULE_ID, "shopSellRatio", this._sellRatio);
        if (this._mode === "compendium") {
          await game.settings.set(MODULE_ID, "shopInventory", this._inventory);
        }
        await game.settings.set(MODULE_ID, "gambleOptions", config.gambleOptions || []);

        ui.notifications.info(`Loaded configuration "${configName}".`);
        this.render();
      }, { signal });

      // Delete saved config
      el.querySelector(".vcm-delete-merchant-btn")?.addEventListener("click", async () => {
        const select = el.querySelector(".vcm-load-config-select");
        const configName = select?.value;
        if (!configName) { ui.notifications.warn("Select a configuration to delete."); return; }

        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Merchant Configuration" },
          content: `<p>Delete the configuration <strong>${configName}</strong>? This cannot be undone.</p>`,
          rejectClose: false,
        });
        if (!confirmed) return;

        const configs = foundry.utils.deepClone(game.settings.get(MODULE_ID, "savedShopConfigs") || {});
        delete configs[configName];
        await game.settings.set(MODULE_ID, "savedShopConfigs", configs);

        ui.notifications.info(`Deleted configuration "${configName}".`);
        this.render();
      }, { signal });

      // Save config (uses current shop name)
      el.querySelector(".vcm-save-config-btn")?.addEventListener("click", async () => {
        const configName = this._shopName;
        if (!configName) {
          ui.notifications.warn("Shop name is required to save configuration.");
          return;
        }

        const configs = foundry.utils.deepClone(game.settings.get(MODULE_ID, "savedShopConfigs") || {});
        configs[configName] = {
          name: configName,
          mode: this._mode,
          actorId: this._actorId,
          shopName: this._shopName,
          sellRatio: this._sellRatio,
          buyMultiplier: this._buyMultiplier,
          catalogEnabled: this._catalogEnabled,
          gambleEnabled: this._gambleEnabled,
          inventory: foundry.utils.deepClone(this._inventory),
          gambleOptions: foundry.utils.deepClone(game.settings.get(MODULE_ID, "gambleOptions") || []),
        };

        await game.settings.set(MODULE_ID, "savedShopConfigs", configs);
        ui.notifications.info(`Saved configuration "${configName}".`);
        this.render();
      }, { signal });

      // Drag-drop from compendium sidebar
      el.querySelector(".vcm-drop-zone")?.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const data = JSON.parse(ev.dataTransfer?.getData("text/plain") || "{}");
        if (data.type === "Item" && data.uuid) {
          await MerchantShop.addItemToShop(data.uuid, -1);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      }, { signal });

      el.querySelector(".vcm-drop-zone")?.addEventListener("dragover", (ev) => {
        ev.preventDefault();
      }, { signal });
    }
  }

  // ── Transaction methods ─────────────────────────────────────────────────

  async _doBuy(shopItemId, quantity) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected. Select a token or assign a character.");
      return;
    }

    // Client-side pre-check
    const entry = this._inventory.find(e => e.id === shopItemId);
    if (!entry) return;
    if (entry.stock !== -1 && entry.stock < quantity) {
      ui.notifications.warn("Not enough stock.");
      return;
    }
    const mult = this._buyMultiplier / 100;
    const totalCost = _fromCopper(Math.round(_toCopper(entry.baseCost) * mult * quantity));
    if (!_canAfford(actor, totalCost)) {
      ui.notifications.warn("Insufficient funds.");
      return;
    }

    if (game.user.isGM) {
      await MerchantShop._handleBuy({
        buyerActorId: actor.id,
        shopItemId,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      });
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:buy",
        buyerActorId: actor.id,
        shopItemId,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      });
    }
  }

  async _doSell(itemId, quantity) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected.");
      return;
    }

    if (game.user.isGM) {
      await MerchantShop._handleSell({
        sellerActorId: actor.id,
        itemId,
        quantity,
        userId: game.userId,
      });
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:sell",
        sellerActorId: actor.id,
        itemId,
        quantity,
        userId: game.userId,
      });
    }
  }

  /** Resolve a UUID for an item row that doesn't have data-item-uuid. */
  _getUuidForRow(row) {
    // Buy tab: look up from shop inventory
    const shopItemId = row.dataset.shopItemId;
    if (shopItemId) {
      const entry = this._inventory?.find(e => e.id === shopItemId);
      return entry?.uuid ?? null;
    }
    // Sell tab: get from actor's item
    const itemId = row.dataset.itemId;
    if (itemId) {
      const actor = this._getPlayerActor();
      const item = actor?.items.get(itemId);
      return item?.uuid ?? null;
    }
    return null;
  }

  async _doGamble(gambleId) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected. Select a token or assign a character.");
      return;
    }

    // Find option and check funds client-side
    const options = game.settings.get(MODULE_ID, "gambleOptions") || [];
    const option = options.find(o => o.id === gambleId);
    if (!option) return;

    if (_toCopper(actor.system.currency) < _toCopper(option.cost)) {
      ui.notifications.warn("Insufficient funds.");
      return;
    }

    if (game.user.isGM) {
      await MerchantShop._handleGamble({
        buyerActorId: actor.id,
        gambleId,
        userId: game.userId,
      });
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:gamble",
        buyerActorId: actor.id,
        gambleId,
        userId: game.userId,
      });
    }
  }

  async _doCatalogBuy(itemUuid, quantity) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected. Select a token or assign a character.");
      return;
    }

    // Client-side pre-check: find item in catalog cache for price check
    const catMult = this._buyMultiplier / 100;
    const entry = this._catalogCache?.find(e => e.uuid === itemUuid);
    if (entry) {
      const totalCost = _fromCopper(Math.round(entry.copperValue * catMult * quantity));
      if (!_canAfford(actor, totalCost)) {
        ui.notifications.warn("Insufficient funds.");
        return;
      }
    }

    if (game.user.isGM) {
      await MerchantShop._handleCatalogBuy({
        buyerActorId: actor.id,
        itemUuid,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      });
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:catalogBuy",
        buyerActorId: actor.id,
        itemUuid,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      });
    }
  }
}
