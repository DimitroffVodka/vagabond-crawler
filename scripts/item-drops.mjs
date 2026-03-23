/**
 * Vagabond Crawler — Item Drops
 *
 * Players drag items from their inventory onto the canvas to create
 * pickup-able item tokens. Other characters can pick them up via TokenHUD.
 *
 * Light sources (torch, lantern, candle) are excluded — they're handled
 * by the LightTracker system.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

/* -------------------------------------------- */
/*  Light Source Detection (exclude from drops)  */
/* -------------------------------------------- */

const LIGHT_NAMES = [
  /^torch$/i,
  /^candle$/i,
  /^lantern,?\s*(hooded|bullseye)?$/i,
  /^oil\s*lamp$/i,
];

function _isLightSource(itemName) {
  return LIGHT_NAMES.some(re => re.test(itemName?.trim()));
}

/* -------------------------------------------- */
/*  Item Drops Singleton                        */
/* -------------------------------------------- */

export const ItemDrops = {

  registerSettings() {
    game.settings.register(MODULE_ID, "itemDropsEnabled", {
      name: "Item Drops",
      hint: "Allow players to drag items from inventory onto the canvas as pickup-able tokens.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
  },

  init() {
    if (!game.settings.get(MODULE_ID, "itemDropsEnabled")) return;

    // Hook: intercept item drops on canvas
    Hooks.on("dropCanvasData", (canvas, data) => this._onDropCanvas(canvas, data));

    // Hook: add pickup button to TokenHUD for dropped items
    Hooks.on("renderTokenHUD", (hud, html, tokenData) => this._onRenderTokenHUD(hud, html, tokenData));

    // Socket: handle player requests (they can't create actors/tokens)
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      if (!game.user.isGM) return;
      if (data.action === "itemDrop:create") {
        await this._createDroppedItemToken(data);
      }
      if (data.action === "itemDrop:pickup") {
        await this._handlePickup(data);
      }
    });

    console.log(`${MODULE_ID} | Item Drops initialized.`);
  },

  /* -------------------------------------------- */
  /*  Drop: Canvas Drop Handler                   */
  /* -------------------------------------------- */

  async _onDropCanvas(canvas, data) {
    if (data.type !== "Item") return;
    if (!game.settings.get(MODULE_ID, "itemDropsEnabled")) return;

    // Resolve the item
    let item;
    if (data.uuid) {
      item = await fromUuid(data.uuid);
    } else if (data.actorId && data.data?._id) {
      const actor = game.actors.get(data.actorId);
      item = actor?.items.get(data.data._id);
    }
    if (!item) return;

    // Only equipment items
    if (item.type !== "equipment") return;

    // Exclude light sources — handled by LightTracker
    if (_isLightSource(item.name)) return;

    // Prevent dropping if not owned
    const sourceActor = item.actor;
    if (!sourceActor) return;

    const dropData = {
      itemData: item.toObject(),
      sourceActorId: sourceActor.id,
      sourceItemId: item.id,
      x: data.x,
      y: data.y,
      sceneId: canvas.scene.id,
    };

    if (game.user.isGM) {
      await this._createDroppedItemToken(dropData);
    } else {
      // Player: relay to GM via socket
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "itemDrop:create",
        ...dropData,
      });
    }

    // Prevent default Foundry item drop behavior
    return false;
  },

  /**
   * Create a token on the canvas representing a dropped item.
   * GM-only execution (players relay via socket).
   */
  async _createDroppedItemToken(data) {
    const { itemData, sourceActorId, sourceItemId, x, y, sceneId } = data;

    // Remove item from source actor (or decrement quantity)
    const sourceActor = game.actors.get(sourceActorId);
    if (sourceActor) {
      const sourceItem = sourceActor.items.get(sourceItemId);
      if (sourceItem) {
        const qty = sourceItem.system.quantity ?? 1;
        if (qty <= 1) {
          await sourceItem.delete();
        } else {
          await sourceItem.update({ "system.quantity": qty - 1 });
          // Set dropped item quantity to 1
          itemData.system.quantity = 1;
        }
      }
    }

    // Create a temporary NPC actor to represent the dropped item
    const actor = await Actor.create({
      name: itemData.name,
      type: "npc",
      img: itemData.img || "icons/svg/item-bag.svg",
      prototypeToken: {
        name: itemData.name,
        texture: { src: itemData.img || "icons/svg/item-bag.svg" },
        width: 0.5,
        height: 0.5,
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        actorLink: true,
      },
      flags: {
        [MODULE_ID]: {
          droppedItem: true,
          droppedItemData: itemData,
          droppedBy: sourceActorId,
        },
      },
    });

    // Place token on the scene
    const scene = game.scenes.get(sceneId) || canvas.scene;
    await scene.createEmbeddedDocuments("Token", [{
      actorId: actor.id,
      x: x - 25, // Center the 0.5-size token
      y: y - 25,
      width: 0.5,
      height: 0.5,
    }]);

    console.log(`${MODULE_ID} | Item dropped: ${itemData.name} at (${x}, ${y})`);
  },

  /* -------------------------------------------- */
  /*  Pickup: TokenHUD Button                     */
  /* -------------------------------------------- */

  _onRenderTokenHUD(hud, html, tokenData) {
    if (!game.settings.get(MODULE_ID, "itemDropsEnabled")) return;

    const token = hud.object;
    const actor = token?.actor;
    if (!actor) return;

    // Only show pickup button for dropped-item tokens
    if (!actor.getFlag(MODULE_ID, "droppedItem")) return;

    const el = html instanceof jQuery ? html[0] : html;
    const col = el.querySelector(".col.right") || el.querySelector(".right");
    if (!col) return;

    const btn = document.createElement("div");
    btn.classList.add("control-icon");
    btn.title = `Pick up ${actor.name}`;
    btn.innerHTML = `<i class="fas fa-hand-holding" style="font-size:1.2em;"></i>`;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      // Find the player's character to receive the item
      const recipient = this._getRecipientActor();
      if (!recipient) {
        ui.notifications.warn("No character assigned — cannot pick up item.");
        return;
      }

      if (game.user.isGM) {
        await this._handlePickup({
          tokenId: token.id,
          actorId: actor.id,
          recipientId: recipient.id,
          sceneId: canvas.scene.id,
        });
      } else {
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "itemDrop:pickup",
          tokenId: token.id,
          actorId: actor.id,
          recipientId: recipient.id,
          sceneId: canvas.scene.id,
        });
      }

      // Close the HUD
      canvas.hud.token.clear();
    });

    col.appendChild(btn);
  },

  /**
   * Transfer the dropped item to the recipient and clean up.
   * GM-only execution.
   */
  async _handlePickup(data) {
    const { tokenId, actorId, recipientId, sceneId } = data;

    const dropActor = game.actors.get(actorId);
    if (!dropActor) return;

    const itemData = dropActor.getFlag(MODULE_ID, "droppedItemData");
    if (!itemData) return;

    const recipient = game.actors.get(recipientId);
    if (!recipient) return;

    // Create the item on the recipient
    await Item.create(itemData, { parent: recipient });

    // Remove the token from the scene
    const scene = game.scenes.get(sceneId) || canvas.scene;
    const token = scene.tokens.get(tokenId);
    if (token) await token.delete();

    // Delete the temporary actor
    await dropActor.delete();

    // Notify
    ui.notifications.info(`${recipient.name} picked up ${itemData.name}.`);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: recipient }),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${itemData.img || 'icons/svg/item-bag.svg'}" alt="${itemData.name}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Picked Up</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${itemData.name}</span></div>
              </div>
            </div>
          </header>
        </div>
      </div>`,
    });

    console.log(`${MODULE_ID} | ${recipient.name} picked up ${itemData.name}`);
  },

  /**
   * Get the current user's character (for item pickup).
   */
  _getRecipientActor() {
    // Use the user's assigned character
    if (game.user.character) return game.user.character;
    // Fallback: first owned character
    return game.actors.find(a => a.type === "character" && a.isOwner);
  },
};
