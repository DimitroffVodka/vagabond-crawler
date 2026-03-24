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

/* -------------------------------------------- */
/*  Loot Drops Singleton                        */
/* -------------------------------------------- */

export const LootDrops = {

  registerSettings() {
    game.settings.register(MODULE_ID, "lootDropEnabled", {
      name: "Loot Drops",
      hint: "Automatically generate loot bags from defeated NPCs when combat ends.",
      scope: "world", config: true, type: Boolean, default: false,
    });

    game.settings.register(MODULE_ID, "lootDropChance", {
      name: "Loot Drop Chance (%)",
      hint: "Default percentage chance (0-100) for an NPC to drop loot. Individual NPCs can override this.",
      scope: "world", config: true, type: Number, default: 50,
    });
  },

  init() {
    Hooks.on("deleteCombat", (combat) => this._onCombatEnd(combat));

    // Intercept double-click on loot bag tokens to show loot UI instead of NPC sheet
    Hooks.on("renderActorSheet", (sheet, html, data) => {
      const actor = sheet.actor;
      if (!actor?.getFlag(MODULE_ID, "lootBag")) return;
      // Close the sheet immediately and show loot dialog instead
      sheet.close();
      const token = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
      if (token) this._showLootDialog(actor, token);
    });

    // TokenHUD: show loot bag interaction button
    Hooks.on("renderTokenHUD", (hud, html, tokenData) => this._onRenderTokenHUD(hud, html, tokenData));

    // Socket: handle player loot requests
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      if (!game.user.isGM) return;
      if (data.action === "lootDrop:takeAll") {
        await this._handleTakeAll(data);
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
      const chance = (lootConfig.chance >= 0) ? lootConfig.chance : globalChance;
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

    const actor = await Actor.create({
      name: `Loot: ${npc.name}`,
      type: "npc",
      img: LOOT_BAG_ICON,
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

    // Chat notification (don't reveal specific loot)
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
              <p>A loot bag has appeared! Click it to see your share.</p>
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

    // Get this player's share only
    const myShare = allLoot[recipient.id];
    if (!myShare) {
      ui.notifications.info("This loot bag has nothing for you.");
      return;
    }
    if (myShare.claimed) {
      ui.notifications.info("You've already claimed your loot from this bag.");
      return;
    }

    // Build loot display for this player only
    const currencyLines = [];
    if (myShare.currency.gold > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:gold;"></i> ${myShare.currency.gold} Gold</span>`);
    if (myShare.currency.silver > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:silver;"></i> ${myShare.currency.silver} Silver</span>`);
    if (myShare.currency.copper > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:#b87333;"></i> ${myShare.currency.copper} Copper</span>`);

    const itemLines = myShare.items.map(item => {
      const img = item.img || "icons/svg/item-bag.svg";
      return `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
        <img src="${img}" width="28" height="28" style="border:1px solid #999; border-radius:3px;">
        <span>${item.name}</span>
      </div>`;
    }).join("");

    const content = `
      <div style="padding:4px;">
        <p><strong>Your loot from ${lootActor.getFlag(MODULE_ID, "sourceNpc")}</strong></p>
        ${currencyLines.length > 0 ? `<div style="display:flex; gap:12px; padding:6px 0;">${currencyLines.join("")}</div>` : ""}
        ${itemLines ? `<div style="border-top:1px solid #ddd; margin-top:6px; padding-top:6px;">${itemLines}</div>` : ""}
        ${!currencyLines.length && !itemLines ? "<p>Nothing here for you.</p>" : ""}
      </div>
    `;

    const choice = await Dialog.prompt({
      title: "Your Loot",
      content,
      label: "Take All",
      callback: () => "takeAll",
      rejectClose: false,
    });

    if (choice === "takeAll") {
      const data = {
        lootActorId: lootActor.id,
        lootTokenId: lootToken.id,
        recipientId: recipient.id,
        sceneId: canvas.scene.id,
      };

      if (game.user.isGM) {
        await this._handleTakeAll(data);
      } else {
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "lootDrop:takeAll",
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
    const { lootActorId, lootTokenId, recipientId, sceneId } = data;

    const lootActor = game.actors.get(lootActorId);
    if (!lootActor) return;

    const allLoot = lootActor.getFlag(MODULE_ID, "lootContents");
    if (!allLoot) return;

    const myShare = allLoot[recipientId];
    if (!myShare || myShare.claimed) return;

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

    // Mark this player's share as claimed
    allLoot[recipientId].claimed = true;
    await lootActor.setFlag(MODULE_ID, "lootContents", allLoot);

    // Post chat message (only visible to the player)
    const parts = [];
    if (myShare.currency.gold > 0) parts.push(`${myShare.currency.gold}g`);
    if (myShare.currency.silver > 0) parts.push(`${myShare.currency.silver}s`);
    if (myShare.currency.copper > 0) parts.push(`${myShare.currency.copper}c`);
    if (myShare.items.length > 0) parts.push(`${myShare.items.length} item${myShare.items.length > 1 ? "s" : ""}`);

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
                <div class="meta-tag"><span>${parts.join(", ")}</span></div>
              </div>
            </div>
          </header>
        </div>
      </div>`,
    });

    // Log to loot tracker
    const sourceName = lootActor.getFlag(MODULE_ID, "sourceNpc") || "Unknown";
    await LootTracker.logClaim(recipient.name, sourceName, myShare.currency, myShare.items);

    // Check if all shares are claimed — auto-delete bag
    const allClaimed = Object.values(allLoot).every(share => share.claimed);
    if (allClaimed) {
      const scene = game.scenes.get(sceneId) || canvas.scene;
      const token = scene?.tokens.get(lootTokenId);
      if (token) await token.delete();
      await lootActor.delete();
      console.log(`${MODULE_ID} | Loot bag fully claimed and deleted.`);
    }

    console.log(`${MODULE_ID} | ${recipient.name} claimed their loot: ${parts.join(", ")}`);
  },

  /**
   * Get the current user's character.
   */
  _getRecipientActor() {
    if (game.user.character) return game.user.character;
    return game.actors.find(a => a.type === "character" && a.isOwner);
  },
};
