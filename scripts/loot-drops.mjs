/**
 * Vagabond Crawler — Loot Drops
 *
 * When combat ends, defeated NPCs can drop loot bags. Each player
 * rolls independently from the loot table and only sees their own share.
 * Clicking a loot bag token opens the loot UI directly.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { generateLoot } from "./loot-tables.mjs";
import { LootManager } from "./loot-manager.mjs";
import { LootTracker } from "./loot-tracker.mjs";

const LOOT_BAG_ICON = "icons/containers/chest/chest-worn-oak-tan.webp";

/**
 * Format an item's cost object into a readable price string.
 * @param {{gold?: number, silver?: number, copper?: number}} cost
 * @returns {string} e.g. "2g 50s", "10c", or "" if no cost
 */
function _formatPrice(cost) {
  if (!cost) return "";
  const parts = [];
  if (cost.gold > 0) parts.push(`${cost.gold}g`);
  if (cost.silver > 0) parts.push(`${cost.silver}s`);
  if (cost.copper > 0) parts.push(`${cost.copper}c`);
  return parts.join(" ");
}

/**
 * Calculate loot drop chance from an NPC's appearing formula.
 * Formula: 1 / (maxAppearing * 2) * 100
 * More monsters appearing = lower individual drop chance.
 * @param {string} formula - The appearing formula (e.g. "2d6", "d4+1", "1")
 * @returns {number} Drop chance percentage (0-100)
 */
function _dropChanceFromAppearing(formula) {
  if (!formula || formula === "Unique") return 50;
  const f = String(formula).toLowerCase().trim();
  const match = f.match(/^(\d*)d(\d+)(?:\+(\d+))?$/);
  if (!match) {
    const num = parseInt(f);
    return isNaN(num) || num <= 0 ? 50 : Math.round((1 / (num * 2)) * 10000) / 100;
  }
  const count = match[1] ? parseInt(match[1]) : 1;
  const faces = parseInt(match[2]);
  const bonus = match[3] ? parseInt(match[3]) : 0;
  const max = count * faces + bonus;
  return max <= 0 ? 50 : Math.round((1 / (max * 2)) * 10000) / 100;
}

/* -------------------------------------------- */
/*  Loot Drops Singleton                        */
/* -------------------------------------------- */

export const LootDrops = {

  registerSettings() {
    game.settings.register(MODULE_ID, "lootDropEnabled", {
      name: "Loot Drops",
      hint: "Automatically generate loot bags from defeated NPCs when combat ends.",
      scope: "world", config: false, type: Boolean, default: false,
    });

    game.settings.register(MODULE_ID, "lootDropChance", {
      name: "Loot Drop Chance (%)",
      hint: "Default percentage chance (0-100) for an NPC to drop loot. Individual NPCs can override this.",
      scope: "world", config: false, type: Number, default: 50,
    });
  },

  init() {
    Hooks.on("deleteCombat", (combat) => this._onCombatEnd(combat));

    // Patch token double-click to open loot dialog for loot bag tokens
    const self = this;
    const Token = CONFIG.Token.objectClass;
    const origClickLeft2 = Token.prototype._onClickLeft2;
    Token.prototype._onClickLeft2 = function (event) {
      if (this.actor?.getFlag(MODULE_ID, "lootBag")) {
        event.stopPropagation();
        self._showLootDialog(this.actor, this);
        return;
      }
      return origClickLeft2.call(this, event);
    };
    console.log(`${MODULE_ID} | Patched Token._onClickLeft2 for loot bags.`);

    // TokenHUD: keep as additional access method
    Hooks.on("renderTokenHUD", (hud, html, tokenData) => this._onRenderTokenHUD(hud, html, tokenData));

    // Socket: handle player loot requests
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      if (!game.user.isGM) return;
      if (data.action === "lootDrop:takeAll") {
        await this._handleTakeAll(data);
      } else if (data.action === "lootDrop:pass") {
        await this._handlePass(data);
      }
    });

    console.log(`${MODULE_ID} | Loot Drops initialized.`);
  },

  /* -------------------------------------------- */
  /*  Combat End: Generate Per-Player Loot        */
  /* -------------------------------------------- */

  async _onCombatEnd(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "lootDropEnabled")) return;

    const scene = combat.scene || canvas.scene;
    if (!scene) return;

    const defeated = combat.combatants.filter(c => {
      if (!c.actor || c.actor.type !== "npc") return false;
      if (c.defeated) return true;
      const hp = c.actor.system.health;
      return hp && hp.value <= 0;
    });

    if (defeated.length === 0) return;

    // Get player characters who were in combat
    const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    if (pcs.length === 0) return;

    const globalChance = game.settings.get(MODULE_ID, "lootDropChance");

    for (const combatant of defeated) {
      const npc = combatant.actor;
      const token = combatant.token;

      const lootConfig = LootManager.getLootConfig(npc);
      // Priority: explicit override → auto-calc from appearing formula
      const chance = (lootConfig.chance >= 0)
        ? lootConfig.chance
        : _dropChanceFromAppearing(npc.system.appearing || "1");
      const roll = Math.random() * 100;
      if (roll > chance) continue;

      const customTable = lootConfig.table || null;

      // Roll loot independently for each PC
      const perPlayerLoot = {};
      let anyLoot = false;

      for (const pc of pcs) {
        const loot = await generateLoot(npc, customTable);
        const hasLoot = loot.currency.gold > 0 || loot.currency.silver > 0 ||
                        loot.currency.copper > 0 || loot.items.length > 0;
        if (hasLoot) {
          perPlayerLoot[pc.id] = {
            currency: loot.currency,
            items: loot.items,
            claimed: false,
          };
          anyLoot = true;
        }
      }

      if (!anyLoot) continue;

      await this._createLootBag(npc, token, perPlayerLoot, scene);
    }
  },

  /**
   * Create a loot bag with per-player shares.
   */
  async _createLootBag(npc, combatantToken, perPlayerLoot, scene) {
    const x = combatantToken?.x ?? 0;
    const y = combatantToken?.y ?? 0;

    // All players get Owner so they can interact with the Token HUD pickup button
    const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };

    const actor = await Actor.create({
      name: `Loot: ${npc.name}`,
      type: "npc",
      img: LOOT_BAG_ICON,
      ownership,
      prototypeToken: {
        name: `Loot: ${npc.name}`,
        texture: { src: LOOT_BAG_ICON },
        width: 0.5,
        height: 0.5,
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        actorLink: true,
      },
      flags: {
        [MODULE_ID]: {
          lootBag: true,
          lootContents: perPlayerLoot,
          sourceNpc: npc.name,
        },
      },
    });

    await scene.createEmbeddedDocuments("Token", [{
      actorId: actor.id,
      name: `Loot: ${npc.name}`,
      texture: { src: LOOT_BAG_ICON },
      x, y,
      width: 0.5,
      height: 0.5,
    }]);

    // Public chat notification
    await ChatMessage.create({
      speaker: { alias: "Loot" },
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${LOOT_BAG_ICON}" alt="Loot Bag">
            </div>
            <div class="header-info">
              <h3 class="header-title">Loot Dropped</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${npc.name}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="text-align:center; padding:4px 0;">
              <p>A loot bag has appeared! Click it to claim your share.</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    // GM whisper with full loot breakdown per player
    const gmLines = [];
    for (const [pcId, share] of Object.entries(perPlayerLoot)) {
      const pc = game.actors.get(pcId);
      if (!pc) continue;
      const parts = [];
      if (share.currency.gold > 0) parts.push(`${share.currency.gold}g`);
      if (share.currency.silver > 0) parts.push(`${share.currency.silver}s`);
      if (share.currency.copper > 0) parts.push(`${share.currency.copper}c`);
      for (const item of share.items) {
        const qty = item.system?.quantity > 1 ? ` ×${item.system.quantity}` : "";
        const price = _formatPrice(item.system?.cost);
        parts.push(`${item.name}${qty}${price ? ` (${price})` : ""}`);
      }
      gmLines.push(`<b>${pc.name}:</b> ${parts.join(", ") || "nothing"}`);
    }
    await ChatMessage.create({
      speaker: { alias: "Loot" },
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${LOOT_BAG_ICON}" alt="Loot">
            </div>
            <div class="header-info">
              <h3 class="header-title">Loot Details — ${npc.name}</h3>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              ${gmLines.join("<br>")}
            </div>
          </section>
        </div>
      </div>`,
    });

    console.log(`${MODULE_ID} | Loot bag created for ${npc.name} (${Object.keys(perPlayerLoot).length} player shares)`);
  },

  /* -------------------------------------------- */
  /*  TokenHUD: Loot Interaction                  */
  /* -------------------------------------------- */

  _onRenderTokenHUD(hud, html, tokenData) {
    const token = hud.object;
    const actor = token?.actor;
    if (!actor) return;
    if (!actor.getFlag(MODULE_ID, "lootBag")) return;

    const el = html instanceof jQuery ? html[0] : html;
    const col = el.querySelector(".col.right") || el.querySelector(".right");
    if (!col) return;

    const btn = document.createElement("div");
    btn.classList.add("control-icon");
    btn.title = "Open Loot Bag";
    btn.innerHTML = `<i class="fas fa-treasure-chest" style="font-size:1.2em;"></i>`;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this._showLootDialog(actor, token);
      canvas.hud.token.clear();
    });

    col.appendChild(btn);
  },

  /**
   * Show loot dialog — player only sees their own share.
   */
  async _showLootDialog(lootActor, lootToken) {
    const allLoot = lootActor.getFlag(MODULE_ID, "lootContents");
    if (!allLoot) {
      ui.notifications.warn("This loot bag is empty.");
      return;
    }

    const recipient = this._getRecipientActor();
    if (!recipient) {
      ui.notifications.warn("No character assigned — cannot take loot.");
      return;
    }

    // Get this player's share, or unclaimed pool if their share is already taken/passed
    let myShare = allLoot[recipient.id];
    let isUnclaimed = false;
    if (!myShare || myShare.claimed) {
      // Check for unclaimed loot (passed by another player)
      const unclaimed = allLoot._unclaimed;
      if (unclaimed && (unclaimed.currency.gold > 0 || unclaimed.currency.silver > 0 ||
          unclaimed.currency.copper > 0 || unclaimed.items.length > 0)) {
        myShare = unclaimed;
        isUnclaimed = true;
      } else {
        ui.notifications.info(myShare?.claimed
          ? "You've already claimed your loot from this bag."
          : "This loot bag has nothing for you.");
        return;
      }
    }

    // Build loot display for this player only
    const sourceName = lootActor.getFlag(MODULE_ID, "sourceNpc");
    const currencyLines = [];
    if (myShare.currency.gold > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:gold;"></i> ${myShare.currency.gold} Gold</span>`);
    if (myShare.currency.silver > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:silver;"></i> ${myShare.currency.silver} Silver</span>`);
    if (myShare.currency.copper > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:#b87333;"></i> ${myShare.currency.copper} Copper</span>`);

    const itemLines = myShare.items.map(item => {
      const img = item.img || "icons/svg/item-bag.svg";
      const qty = item.system?.quantity > 1 ? ` ×${item.system.quantity}` : "";
      const price = item.system?.costDisplay || _formatPrice(item.system?.cost) || "";
      const slots = item.system?.slots ?? item.system?.baseSlots ?? "";
      return `<div style="display:flex; align-items:center; gap:6px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
        <img src="${img}" width="28" height="28" style="border:1px solid #999; border-radius:3px;">
        <span style="flex:1;">${item.name}${qty}</span>
        ${slots ? `<span style="color:#aaa; font-size:0.8em;" title="Inventory Slots"><i class="fas fa-box"></i> ${slots}</span>` : ""}
        ${price ? `<span style="color:#d4a843; font-size:0.85em;" title="Value"><i class="fas fa-coins"></i> ${price}</span>` : ""}
      </div>`;
    }).join("");

    const content = `
      <div style="padding:4px;">
        <p><strong>Your loot from ${sourceName}</strong></p>
        ${currencyLines.length > 0 ? `<div style="display:flex; gap:12px; padding:6px 0;">${currencyLines.join("")}</div>` : ""}
        ${itemLines ? `<div style="margin-top:6px;">${itemLines}</div>` : ""}
        ${!currencyLines.length && !itemLines ? "<p>Nothing here for you.</p>" : ""}
      </div>
    `;

    const choice = await Dialog.wait({
      title: "Your Loot",
      content,
      buttons: {
        take: { icon: '<i class="fas fa-hand-holding"></i>', label: "Take All", callback: () => "takeAll" },
        pass: { icon: '<i class="fas fa-arrow-right-arrow-left"></i>', label: "Pass", callback: () => "pass" },
      },
      close: () => null,
    });

    if (choice === "takeAll") {
      const data = {
        lootActorId: lootActor.id,
        lootTokenId: lootToken.id,
        recipientId: recipient.id,
        sceneId: canvas.scene.id,
        isUnclaimed,
      };

      if (game.user.isGM) {
        await this._handleTakeAll(data);
      } else {
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "lootDrop:takeAll",
          ...data,
        });
      }
    } else if (choice === "pass") {
      // Pass: unassign this player's share so the next person to click can take it
      const data = {
        lootActorId: lootActor.id,
        recipientId: recipient.id,
      };

      if (game.user.isGM) {
        await this._handlePass(data);
      } else {
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "lootDrop:pass",
          ...data,
        });
      }
    }
  },

  /**
   * Transfer this player's share and mark as claimed.
   * Auto-delete bag when all shares are claimed.
   */
  async _handleTakeAll(data) {
    const { lootActorId, lootTokenId, recipientId, sceneId, isUnclaimed } = data;

    const lootActor = game.actors.get(lootActorId);
    if (!lootActor) return;

    const allLoot = lootActor.getFlag(MODULE_ID, "lootContents");
    if (!allLoot) return;

    let myShare;
    if (isUnclaimed) {
      myShare = allLoot._unclaimed;
      if (!myShare) return;
    } else {
      myShare = allLoot[recipientId];
      if (!myShare || myShare.claimed) return;
    }

    const recipient = game.actors.get(recipientId);
    if (!recipient) return;

    // Transfer currency
    const updates = {};
    if (myShare.currency.gold > 0) {
      updates["system.currency.gold"] = (recipient.system.currency?.gold ?? 0) + myShare.currency.gold;
    }
    if (myShare.currency.silver > 0) {
      updates["system.currency.silver"] = (recipient.system.currency?.silver ?? 0) + myShare.currency.silver;
    }
    if (myShare.currency.copper > 0) {
      updates["system.currency.copper"] = (recipient.system.currency?.copper ?? 0) + myShare.currency.copper;
    }
    if (Object.keys(updates).length > 0) {
      await recipient.update(updates);
    }

    // Transfer items
    for (const itemData of myShare.items) {
      await Item.create(itemData, { parent: recipient });
    }

    // Mark as claimed
    if (isUnclaimed) {
      // Clear the unclaimed pool
      allLoot._unclaimed = { currency: { gold: 0, silver: 0, copper: 0 }, items: [] };
    } else {
      allLoot[recipientId].claimed = true;
    }
    await lootActor.setFlag(MODULE_ID, "lootContents", allLoot);

    // Post public chat message so all players see what was looted
    const currencyParts = [];
    if (myShare.currency.gold > 0) currencyParts.push(`${myShare.currency.gold}g`);
    if (myShare.currency.silver > 0) currencyParts.push(`${myShare.currency.silver}s`);
    if (myShare.currency.copper > 0) currencyParts.push(`${myShare.currency.copper}c`);

    const itemParts = myShare.items.map(item => {
      const qty = item.system?.quantity > 1 ? ` ×${item.system.quantity}` : "";
      const price = item.system?.costDisplay || _formatPrice(item.system?.cost) || "";
      return `${item.name}${qty}${price ? ` (${price})` : ""}`;
    });

    const allParts = [...currencyParts, ...itemParts];
    const sourceName = lootActor.getFlag(MODULE_ID, "sourceNpc") || "Unknown";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: recipient }),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${LOOT_BAG_ICON}" alt="Loot">
            </div>
            <div class="header-info">
              <h3 class="header-title">Loot Collected</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${sourceName}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              ${allParts.map(p => `<p style="margin:2px 0;">${p}</p>`).join("")}
            </div>
          </section>
        </div>
      </div>`,
    });

    // Log to loot tracker
    await LootTracker.logClaim(recipient.name, sourceName, myShare.currency, myShare.items);

    // Check if all shares are claimed and unclaimed pool is empty — auto-delete bag
    const unclaimed = allLoot._unclaimed;
    const unclaimedEmpty = !unclaimed || (unclaimed.currency.gold === 0 && unclaimed.currency.silver === 0 &&
      unclaimed.currency.copper === 0 && unclaimed.items.length === 0);
    const allClaimed = unclaimedEmpty && Object.entries(allLoot)
      .filter(([k]) => k !== "_unclaimed")
      .every(([, share]) => share.claimed);
    if (allClaimed) {
      const scene = game.scenes.get(sceneId) || canvas.scene;
      const token = scene?.tokens.get(lootTokenId);
      if (token) await token.delete();
      await lootActor.delete();
      console.log(`${MODULE_ID} | Loot bag fully claimed and deleted.`);
    }

    console.log(`${MODULE_ID} | ${recipient.name} claimed their loot: ${allParts.join(", ")}`);
  },

  /**
   * Pass on loot — make this player's share available to anyone who clicks next.
   */
  async _handlePass(data) {
    const { lootActorId, recipientId } = data;
    const lootActor = game.actors.get(lootActorId);
    if (!lootActor) return;

    const allLoot = lootActor.getFlag(MODULE_ID, "lootContents");
    if (!allLoot || !allLoot[recipientId]) return;

    const recipient = game.actors.get(recipientId);
    const share = allLoot[recipientId];

    // Move this share to a special "unclaimed" pool that anyone can take
    if (!allLoot._unclaimed) allLoot._unclaimed = { currency: { gold: 0, silver: 0, copper: 0 }, items: [] };
    allLoot._unclaimed.currency.gold += share.currency.gold;
    allLoot._unclaimed.currency.silver += share.currency.silver;
    allLoot._unclaimed.currency.copper += share.currency.copper;
    allLoot._unclaimed.items.push(...share.items.map(i => foundry.utils.deepClone(i)));

    // Mark original share as claimed (passed)
    allLoot[recipientId].claimed = true;
    await lootActor.setFlag(MODULE_ID, "lootContents", allLoot);

    // Chat notification
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: recipient }),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${LOOT_BAG_ICON}" alt="Loot">
            </div>
            <div class="header-info">
              <h3 class="header-title">Loot Passed</h3>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="text-align:center; padding:4px 0;">
              <p>${recipient?.name ?? "Someone"} passed on their loot. Click the bag to claim it!</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    console.log(`${MODULE_ID} | ${recipient?.name} passed on their loot.`);
  },

  /**
   * Get the current user's character.
   */
  _getRecipientActor() {
    if (game.user.character) return game.user.character;
    return game.actors.find(a => a.type === "character" && a.isOwner);
  },
};
