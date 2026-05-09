/**
 * Vagabond Crawler — Loot Drops
 *
 * On combat end, defeated NPCs roll loot and whisper a per-player chat card
 * to each PC owner + GM. Each card has Claim Loot / Pass Loot buttons.
 * Pass moves the share to a public pool card — first player to click wins.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { generateLoot } from "./loot-tables.mjs";
import { LootManager } from "./loot-manager.mjs";
import { LootTracker } from "./loot-tracker.mjs";

const LOOT_ICON = "icons/containers/chest/chest-worn-oak-tan.webp";

function _formatPrice(cost) {
  if (!cost) return "";
  const parts = [];
  if (cost.gold > 0) parts.push(`${cost.gold}g`);
  if (cost.silver > 0) parts.push(`${cost.silver}s`);
  if (cost.copper > 0) parts.push(`${cost.copper}c`);
  return parts.join(" ");
}

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

function _renderShareBody(share) {
  // Mirror the Loot Generator's vcl-gen-claim-item row markup so the visual
  // style matches exactly (icon + name + qty + value parens).
  const currParts = [];
  if (share.currency.gold > 0) currParts.push(`${share.currency.gold} Gold`);
  if (share.currency.silver > 0) currParts.push(`${share.currency.silver} Silver`);
  if (share.currency.copper > 0) currParts.push(`${share.currency.copper} Copper`);
  const currencyLine = currParts.length
    ? `<div class="vcl-gen-claim-item"><i class="fas fa-coins" style="width:24px;text-align:center;color:inherit;"></i> <span>${currParts.join(", ")}</span></div>`
    : "";

  const itemLines = (share.items ?? []).map(item => {
    const bc = item.system?.cost;
    const valParts = [];
    if (bc?.gold) valParts.push(`${bc.gold}g`);
    if (bc?.silver) valParts.push(`${bc.silver}s`);
    if (bc?.copper) valParts.push(`${bc.copper}c`);
    const valStr = valParts.length ? ` (${valParts.join(" ")})` : "";
    const qty = item.system?.quantity ?? 1;
    const qtyStr = qty > 1 ? ` ×${qty}` : "";
    return `<div class="vcl-gen-claim-item">
      <img src="${item.img || "icons/svg/item-bag.svg"}" width="24" height="24" />
      <span>${item.name}${qtyStr}${valStr}</span>
    </div>`;
  }).join("");

  return `${currencyLine}${itemLines}`;
}

function _firstIcon(share) {
  return share.items?.[0]?.img || "icons/svg/item-bag.svg";
}

function _shareIsEmpty(share) {
  if (!share) return true;
  const c = share.currency ?? {};
  return (c.gold ?? 0) === 0 && (c.silver ?? 0) === 0 && (c.copper ?? 0) === 0
    && (share.items ?? []).length === 0;
}

function _summarizeShare(share) {
  const parts = [];
  if (share.currency.gold > 0) parts.push(`${share.currency.gold}g`);
  if (share.currency.silver > 0) parts.push(`${share.currency.silver}s`);
  if (share.currency.copper > 0) parts.push(`${share.currency.copper}c`);
  for (const item of share.items ?? []) {
    const qty = item.system?.quantity > 1 ? ` ×${item.system.quantity}` : "";
    parts.push(`${item.name}${qty}`);
  }
  return parts.join(", ") || "nothing";
}

/* -------------------------------------------- */
/*  Loot Drops Singleton                        */
/* -------------------------------------------- */

export const LootDrops = {

  registerSettings() {
    game.settings.register(MODULE_ID, "lootDropEnabled", {
      name: "Loot Drops",
      hint: "Automatically generate loot from defeated NPCs when combat ends.",
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

    // Wire chat-card button handlers
    Hooks.on("renderChatMessageHTML", (message, html) => this._wirePersonalCard(message, html));
    Hooks.on("renderChatMessageHTML", (message, html) => this._wirePoolCard(message, html));

    // GM-side socket handlers
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      if (!game.user.isGM) return;
      if (data.action === "lootDrop:claim") await this._handleClaim(data);
      else if (data.action === "lootDrop:pass") await this._handlePass(data);
      else if (data.action === "lootDrop:claimPool") await this._handleClaimPool(data);
    });

    console.log(`${MODULE_ID} | Loot Drops initialized.`);
  },

  /* -------------------------------------------- */
  /*  Combat End: Roll & Whisper                  */
  /* -------------------------------------------- */

  async _onCombatEnd(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "lootDropEnabled")) return;

    const defeated = combat.combatants.filter(c => {
      if (!c.actor || c.actor.type !== "npc") return false;
      if (c.defeated) return true;
      const hp = c.actor.system.health;
      return hp && hp.value <= 0;
    });
    if (defeated.length === 0) return;

    const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    if (pcs.length === 0) return;

    for (const combatant of defeated) {
      const npc = combatant.actor;
      const lootConfig = LootManager.getLootConfig(npc);
      const chance = (lootConfig.chance >= 0)
        ? lootConfig.chance
        : _dropChanceFromAppearing(npc.system.appearing || "1");
      if (Math.random() * 100 > chance) continue;

      const customTable = lootConfig.table || null;

      // Roll a share per PC; collect non-empty ones
      const shares = [];
      for (const pc of pcs) {
        const loot = await generateLoot(npc, customTable);
        const share = { currency: loot.currency, items: loot.items };
        if (!_shareIsEmpty(share)) shares.push({ pc, share });
      }
      if (shares.length === 0) continue;

      // Per-player whisper cards
      for (const { pc, share } of shares) {
        await this._emitPersonalCard(npc, pc, share);
      }

      // GM full-breakdown whisper
      await this._emitGmBreakdown(npc, shares);
    }
  },

  async _emitPersonalCard(npc, recipient, share) {
    const ownerIds = Object.entries(recipient.ownership ?? {})
      .filter(([uid, lvl]) => uid !== "default" && lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      .map(([uid]) => uid);
    const whisper = Array.from(new Set([
      ...ownerIds,
      ...game.users.filter(u => u.isGM).map(u => u.id),
    ]));

    const content = `
      <div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${_firstIcon(share)}" alt="Loot">
            </div>
            <div class="header-info">
              <h3 class="header-title">Loot from ${npc.name}</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${recipient.name}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 8px;">
              ${_renderShareBody(share)}
            </div>
            <div class="vcl-drops-actions" style="padding:4px 8px 8px;">
              <button type="button" class="vcl-gen-claim-btn vcl-drops-claim-btn">
                <i class="fas fa-hand-holding"></i> Claim Loot
              </button>
              <button type="button" class="vcl-gen-claim-btn vcl-drops-pass-btn">
                <i class="fas fa-arrow-right-arrow-left"></i> Pass Loot
              </button>
            </div>
          </section>
        </div>
      </div>`;

    await ChatMessage.create({
      speaker: { alias: "Loot" },
      whisper,
      content,
      flags: {
        [MODULE_ID]: {
          lootDropCard: true,
          recipientId: recipient.id,
          sourceNpc: npc.name,
          currency: share.currency,
          items: share.items,
          claimed: false,
          passed: false,
        },
      },
    });
  },

  async _emitGmBreakdown(npc, shares) {
    const lines = shares.map(({ pc, share }) => `<b>${pc.name}:</b> ${_summarizeShare(share)}`);
    await ChatMessage.create({
      speaker: { alias: "Loot" },
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon"><img src="${LOOT_ICON}" alt="Loot"></div>
            <div class="header-info">
              <h3 class="header-title">Loot Breakdown — ${npc.name}</h3>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">${lines.join("<br>")}</div>
          </section>
        </div>
      </div>`,
    });
  },

  /* -------------------------------------------- */
  /*  Render: Wire Card Buttons                   */
  /* -------------------------------------------- */

  _wirePersonalCard(message, html) {
    const flags = message.flags?.[MODULE_ID];
    if (!flags?.lootDropCard) return;

    const claimBtn = html.querySelector(".vcl-drops-claim-btn");
    const passBtn = html.querySelector(".vcl-drops-pass-btn");
    const actions = html.querySelector(".vcl-drops-actions");
    if (!actions) return;

    if (flags.claimed) {
      actions.innerHTML = `<span class="vcl-drops-status vcl-drops-status--claimed"><i class="fas fa-check"></i> Claimed</span>`;
      return;
    }
    if (flags.passed) {
      actions.innerHTML = `<span class="vcl-drops-status vcl-drops-status--passed"><i class="fas fa-arrow-right-arrow-left"></i> Passed to party</span>`;
      return;
    }

    const recipient = game.actors.get(flags.recipientId);
    const canAct = !!(recipient?.isOwner) || game.user.isGM;
    if (!canAct) {
      // Whispered to GM but viewer is neither owner nor GM (shouldn't happen, defensive)
      claimBtn?.setAttribute("disabled", "disabled");
      passBtn?.setAttribute("disabled", "disabled");
      return;
    }

    claimBtn?.addEventListener("click", async () => {
      claimBtn.disabled = true;
      passBtn.disabled = true;
      const payload = { action: "lootDrop:claim", messageId: message.id, userId: game.user.id };
      if (game.user.isGM) await this._handleClaim(payload);
      else game.socket.emit(`module.${MODULE_ID}`, payload);
    });

    passBtn?.addEventListener("click", async () => {
      claimBtn.disabled = true;
      passBtn.disabled = true;
      const payload = { action: "lootDrop:pass", messageId: message.id, userId: game.user.id };
      if (game.user.isGM) await this._handlePass(payload);
      else game.socket.emit(`module.${MODULE_ID}`, payload);
    });
  },

  _wirePoolCard(message, html) {
    const flags = message.flags?.[MODULE_ID];
    if (!flags?.lootDropPool) return;

    const btn = html.querySelector(".vcl-drops-pool-claim-btn");
    const actions = html.querySelector(".vcl-drops-actions");
    if (!actions) return;

    if (flags.claimedBy) {
      actions.innerHTML = `<span class="vcl-drops-status vcl-drops-status--claimed"><i class="fas fa-check"></i> Claimed by ${flags.claimedByName ?? "???"}</span>`;
      return;
    }
    if (!btn) return;

    btn.addEventListener("click", async () => {
      // Find a character this user can claim with
      const myChar = game.user.character ?? game.actors.find(a => a.type === "character" && a.isOwner);
      if (!myChar) {
        ui.notifications.warn("No character assigned — cannot claim loot.");
        return;
      }
      btn.disabled = true;
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Claiming…`;
      const payload = { action: "lootDrop:claimPool", messageId: message.id, userId: game.user.id, claimerId: myChar.id };
      if (game.user.isGM) await this._handleClaimPool(payload);
      else game.socket.emit(`module.${MODULE_ID}`, payload);
    });
  },

  /* -------------------------------------------- */
  /*  GM-Side Handlers                            */
  /* -------------------------------------------- */

  async _handleClaim({ messageId, userId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootDropCard || flags.claimed || flags.passed) return;

    const recipient = game.actors.get(flags.recipientId);
    if (!recipient) return;

    const user = game.users.get(userId);
    if (!user || !(user.isGM || recipient.testUserPermission(user, "OWNER"))) {
      console.warn(`${MODULE_ID} | Claim denied — user lacks ownership`);
      return;
    }

    // Mark claimed first to block races
    await message.update({
      [`flags.${MODULE_ID}.claimed`]: true,
    });

    await this._transferShare(recipient, flags.currency, flags.items);

    // Log to recap
    await LootTracker.logClaim(recipient.name, flags.sourceNpc, flags.currency, flags.items);

    // Public confirmation
    await this._postPublicClaimed(recipient, flags.sourceNpc, flags.currency, flags.items);

    console.log(`${MODULE_ID} | ${recipient.name} claimed loot from ${flags.sourceNpc}`);
  },

  async _handlePass({ messageId, userId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootDropCard || flags.claimed || flags.passed) return;

    const recipient = game.actors.get(flags.recipientId);
    if (!recipient) return;

    const user = game.users.get(userId);
    if (!user || !(user.isGM || recipient.testUserPermission(user, "OWNER"))) {
      console.warn(`${MODULE_ID} | Pass denied — user lacks ownership`);
      return;
    }

    await message.update({
      [`flags.${MODULE_ID}.passed`]: true,
    });

    // Emit public pool card
    await this._emitPoolCard(recipient, flags.sourceNpc, flags.currency, flags.items);

    console.log(`${MODULE_ID} | ${recipient.name} passed loot from ${flags.sourceNpc}`);
  },

  async _emitPoolCard(passer, sourceNpc, currency, items) {
    const share = { currency, items };
    const content = `
      <div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${_firstIcon(share)}" alt="Loot">
            </div>
            <div class="header-info">
              <h3 class="header-title">Passed Loot — ${sourceNpc}</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${passer.name} passed — first to click claims</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 8px;">
              ${_renderShareBody(share)}
            </div>
            <div class="vcl-drops-actions" style="padding:4px 8px 8px;">
              <button type="button" class="vcl-gen-claim-btn vcl-drops-pool-claim-btn">
                <i class="fas fa-hand-holding"></i> Claim
              </button>
            </div>
          </section>
        </div>
      </div>`;

    await ChatMessage.create({
      speaker: { alias: "Loot" },
      content,
      flags: {
        [MODULE_ID]: {
          lootDropPool: true,
          sourceNpc,
          currency,
          items,
          passerId: passer.id,
          passerName: passer.name,
          claimedBy: null,
          claimedByName: null,
        },
      },
    });
  },

  async _handleClaimPool({ messageId, userId, claimerId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootDropPool || flags.claimedBy) return;

    const claimer = game.actors.get(claimerId);
    if (!claimer) return;

    const user = game.users.get(userId);
    if (!user || !(user.isGM || claimer.testUserPermission(user, "OWNER"))) {
      console.warn(`${MODULE_ID} | Pool claim denied — user lacks ownership`);
      return;
    }

    // Lock first to block races
    await message.update({
      [`flags.${MODULE_ID}.claimedBy`]: claimer.id,
      [`flags.${MODULE_ID}.claimedByName`]: claimer.name,
    });

    await this._transferShare(claimer, flags.currency, flags.items);

    await LootTracker.logClaim(claimer.name, flags.sourceNpc, flags.currency, flags.items);

    await this._postPublicClaimed(claimer, flags.sourceNpc, flags.currency, flags.items);

    console.log(`${MODULE_ID} | ${claimer.name} claimed passed loot from ${flags.sourceNpc}`);
  },

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  async _transferShare(actor, currency, items) {
    const updates = {};
    if (currency?.gold > 0) updates["system.currency.gold"] = (actor.system.currency?.gold ?? 0) + currency.gold;
    if (currency?.silver > 0) updates["system.currency.silver"] = (actor.system.currency?.silver ?? 0) + currency.silver;
    if (currency?.copper > 0) updates["system.currency.copper"] = (actor.system.currency?.copper ?? 0) + currency.copper;
    if (Object.keys(updates).length > 0) await actor.update(updates);

    for (const itemData of items ?? []) {
      await Item.create(itemData, { parent: actor });
    }
  },

  async _postPublicClaimed(recipient, sourceNpc, currency, items) {
    const parts = [];
    if (currency.gold > 0) parts.push(`${currency.gold}g`);
    if (currency.silver > 0) parts.push(`${currency.silver}s`);
    if (currency.copper > 0) parts.push(`${currency.copper}c`);
    for (const item of items ?? []) {
      const qty = item.system?.quantity > 1 ? ` ×${item.system.quantity}` : "";
      const price = item.system?.costDisplay || _formatPrice(item.system?.cost) || "";
      parts.push(`${item.name}${qty}${price ? ` (${price})` : ""}`);
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: recipient }),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon"><img src="${LOOT_ICON}" alt="Loot"></div>
            <div class="header-info">
              <h3 class="header-title">Loot Collected</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${sourceNpc}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              ${parts.map(p => `<p style="margin:2px 0;">${p}</p>`).join("")}
            </div>
          </section>
        </div>
      </div>`,
    });
  },
};
