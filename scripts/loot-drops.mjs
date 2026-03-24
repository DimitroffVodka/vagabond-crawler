/**
 * Vagabond Crawler — Loot Drops
 *
 * When combat ends, defeated NPCs can drop loot bags containing
 * currency and items. Players interact with loot bags via a
 * Take/Pass dialog triggered by clicking the loot bag token.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { generateLoot } from "./loot-tables.mjs";

const LOOT_BAG_ICON = "icons/containers/chest/chest-worn-oak-tan.webp";

/* -------------------------------------------- */
/*  Loot Drops Singleton                        */
/* -------------------------------------------- */

export const LootDrops = {

  registerSettings() {
    game.settings.register(MODULE_ID, "lootDropEnabled", {
      name: "Loot Drops",
      hint: "Automatically generate loot bags from defeated NPCs when combat ends.",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });

    game.settings.register(MODULE_ID, "lootDropChance", {
      name: "Loot Drop Chance (%)",
      hint: "Default percentage chance (0-100) for an NPC to drop loot. Individual NPCs can override this.",
      scope: "world",
      config: true,
      type: Number,
      default: 50,
    });
  },

  init() {
    // Always register hooks — they check the setting internally
    Hooks.on("deleteCombat", (combat) => this._onCombatEnd(combat));

    // TokenHUD: show loot bag interaction button
    Hooks.on("renderTokenHUD", (hud, html, tokenData) => this._onRenderTokenHUD(hud, html, tokenData));

    // Socket: handle player loot requests
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      if (!game.user.isGM) return;
      if (data.action === "lootDrop:take") {
        await this._handleTake(data);
      }
      if (data.action === "lootDrop:takeAll") {
        await this._handleTakeAll(data);
      }
    });

    console.log(`${MODULE_ID} | Loot Drops initialized.`);
  },

  /* -------------------------------------------- */
  /*  Combat End: Generate Loot                   */
  /* -------------------------------------------- */

  async _onCombatEnd(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "lootDropEnabled")) return;

    const scene = combat.scene || canvas.scene;
    if (!scene) return;

    // Find defeated NPC combatants
    const defeated = combat.combatants.filter(c => {
      if (!c.actor || c.actor.type !== "npc") return false;
      if (c.defeated) return true;
      const hp = c.actor.system.health;
      return hp && hp.value <= 0;
    });

    if (defeated.length === 0) return;

    // Get active player characters for loot distribution
    const pcs = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    if (pcs.length === 0) return;

    const globalChance = game.settings.get(MODULE_ID, "lootDropChance");

    for (const combatant of defeated) {
      const npc = combatant.actor;
      const token = combatant.token;

      // Check drop chance (per-NPC override or global)
      const npcChance = npc.getFlag(MODULE_ID, "lootDropChance");
      const chance = (npcChance !== undefined && npcChance >= 0) ? npcChance : globalChance;
      const roll = Math.random() * 100;
      if (roll > chance) continue;

      // Check for custom loot table
      const customTable = npc.getFlag(MODULE_ID, "lootTable") || null;

      // Generate loot
      const loot = await generateLoot(npc, customTable);

      // Skip if nothing dropped
      if (loot.currency.gold === 0 && loot.currency.silver === 0 &&
          loot.currency.copper === 0 && loot.items.length === 0) continue;

      // Create loot bag
      await this._createLootBag(npc, token, loot, scene);
    }
  },

  /**
   * Create a loot bag actor + token at the defeated NPC's position.
   */
  async _createLootBag(npc, combatantToken, loot, scene) {
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
          lootContents: loot,
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

    // Post chat notification
    const currencyParts = [];
    if (loot.currency.gold > 0) currencyParts.push(`${loot.currency.gold} gold`);
    if (loot.currency.silver > 0) currencyParts.push(`${loot.currency.silver} silver`);
    if (loot.currency.copper > 0) currencyParts.push(`${loot.currency.copper} copper`);
    const currencyText = currencyParts.length > 0 ? currencyParts.join(", ") : "no currency";
    const itemCount = loot.items.length;

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
              <p>${currencyText}${itemCount > 0 ? ` and ${itemCount} item${itemCount > 1 ? "s" : ""}` : ""}</p>
              <p style="color:#888; font-size:0.85em;">Click the loot bag token to collect.</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    console.log(`${MODULE_ID} | Loot bag created for ${npc.name}: ${currencyText}, ${itemCount} items`);
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
   * Show the loot dialog for a loot bag.
   */
  async _showLootDialog(lootActor, lootToken) {
    const loot = lootActor.getFlag(MODULE_ID, "lootContents");
    if (!loot) {
      ui.notifications.warn("This loot bag is empty.");
      return;
    }

    const recipient = this._getRecipientActor();
    if (!recipient) {
      ui.notifications.warn("No character assigned — cannot take loot.");
      return;
    }

    // Build loot display
    const currencyLines = [];
    if (loot.currency.gold > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:gold;"></i> ${loot.currency.gold} Gold</span>`);
    if (loot.currency.silver > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:silver;"></i> ${loot.currency.silver} Silver</span>`);
    if (loot.currency.copper > 0) currencyLines.push(`<span><i class="fas fa-coins" style="color:#b87333;"></i> ${loot.currency.copper} Copper</span>`);

    const itemLines = loot.items.map((item, i) => {
      const img = item.img || "icons/svg/item-bag.svg";
      return `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
        <img src="${img}" width="28" height="28" style="border:1px solid #999; border-radius:3px;">
        <span>${item.name}</span>
      </div>`;
    }).join("");

    const content = `
      <div style="padding:4px;">
        <p><strong>Loot from ${lootActor.getFlag(MODULE_ID, "sourceNpc")}</strong></p>
        ${currencyLines.length > 0 ? `<div style="display:flex; gap:12px; padding:6px 0;">${currencyLines.join("")}</div>` : ""}
        ${itemLines ? `<div style="border-top:1px solid #ddd; margin-top:6px; padding-top:6px;">${itemLines}</div>` : ""}
        ${!currencyLines.length && !itemLines ? "<p>Nothing left to take.</p>" : ""}
      </div>
    `;

    const choice = await Dialog.prompt({
      title: "Loot Bag",
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
   * Transfer all loot to the recipient and clean up.
   * GM-only execution.
   */
  async _handleTakeAll(data) {
    const { lootActorId, lootTokenId, recipientId, sceneId } = data;

    const lootActor = game.actors.get(lootActorId);
    if (!lootActor) return;

    const loot = lootActor.getFlag(MODULE_ID, "lootContents");
    if (!loot) return;

    const recipient = game.actors.get(recipientId);
    if (!recipient) return;

    // Transfer currency
    const updates = {};
    if (loot.currency.gold > 0) {
      updates["system.currency.gold"] = (recipient.system.currency?.gold ?? 0) + loot.currency.gold;
    }
    if (loot.currency.silver > 0) {
      updates["system.currency.silver"] = (recipient.system.currency?.silver ?? 0) + loot.currency.silver;
    }
    if (loot.currency.copper > 0) {
      updates["system.currency.copper"] = (recipient.system.currency?.copper ?? 0) + loot.currency.copper;
    }
    if (Object.keys(updates).length > 0) {
      await recipient.update(updates);
    }

    // Transfer items
    for (const itemData of loot.items) {
      await Item.create(itemData, { parent: recipient });
    }

    // Clean up: delete token and actor
    const scene = game.scenes.get(sceneId) || canvas.scene;
    const token = scene?.tokens.get(lootTokenId);
    if (token) await token.delete();
    await lootActor.delete();

    ui.notifications.info(`${recipient.name} collected all loot.`);

    // Post chat message
    const parts = [];
    if (loot.currency.gold > 0) parts.push(`${loot.currency.gold}g`);
    if (loot.currency.silver > 0) parts.push(`${loot.currency.silver}s`);
    if (loot.currency.copper > 0) parts.push(`${loot.currency.copper}c`);
    if (loot.items.length > 0) parts.push(`${loot.items.length} item${loot.items.length > 1 ? "s" : ""}`);

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

    console.log(`${MODULE_ID} | ${recipient.name} took all loot: ${parts.join(", ")}`);
  },

  /**
   * Handle taking a specific item (future expansion).
   */
  async _handleTake(data) {
    // TODO: Individual item take (for now, takeAll is the primary flow)
  },

  /**
   * Get the current user's character.
   */
  _getRecipientActor() {
    if (game.user.character) return game.user.character;
    return game.actors.find(a => a.type === "character" && a.isOwner);
  },
};
