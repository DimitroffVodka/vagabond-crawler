/**
 * Vagabond Crawler — Party Inventory View
 *
 * Shows all party members' inventories side by side.
 * GM tool for redistributing loot and seeing who's carrying what.
 */

import { MODULE_ID, getTotalOccupiedSlots } from "./vagabond-crawler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Format a cost object as short string. */
function _fmtCost(c) {
  const p = [];
  if (c?.gold) p.push(`${c.gold}g`);
  if (c?.silver) p.push(`${c.silver}s`);
  if (c?.copper) p.push(`${c.copper}c`);
  return p.length ? p.join(" ") : "—";
}

/* ── Singleton ─────────────────────────────────────────── */

export const PartyInventory = {
  _app: null,

  open() {
    if (!this._app) this._app = new PartyInventoryApp();
    this._app.render(true);
  },
};

/* ── ApplicationV2 ─────────────────────────────────────── */

class PartyInventoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-party-inventory",
    tag: "div",
    window: { title: "Party Inventory", resizable: true },
    position: { width: 820, height: 620 },
    classes: ["vagabond-crawler-party-inventory"],
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/party-inventory.hbs" },
  };

  async _prepareContext() {
    // Get player characters with FRIENDLY tokens on the active scene
    const scene = game.scenes.active;
    const sceneActorIds = new Set();
    if (scene) {
      for (const token of scene.tokens) {
        if (token.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY && token.actor?.type === "character") {
          sceneActorIds.add(token.actorId);
        }
      }
    }

    const members = game.actors
      .filter(a => sceneActorIds.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    const columns = members.map(actor => {
      const currency = actor.system.currency ?? { gold: 0, silver: 0, copper: 0 };
      const items = actor.items
        .filter(i => i.type === "equipment")
        .map(i => ({
          id: i.id,
          actorId: actor.id,
          name: i.name,
          img: i.img,
          quantity: i.system.quantity ?? 1,
          equipped: i.system.equipped,
          baseCost: _fmtCost(i.system.baseCost),
          isJunk: !!i.getFlag(MODULE_ID, "junk"),
          slots: i.system.slots || i.system.baseSlots || 0,
        }))
        .sort((a, b) => {
          // Equipped first, then by name
          if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      // Use the shared count, not a local sum. The old `slots × quantity` reduce
      // over `type === "equipment"` disagreed with the sheet on three counts: it
      // charged for gear stowed in containers, ignored the Weightless flag, and
      // skipped `container`-type items entirely.
      const totalSlots = getTotalOccupiedSlots(actor) ?? 0;
      const maxSlots = actor.system.inventory?.maxSlots ?? actor.system.inventory?.slots ?? "?";

      return {
        actorId: actor.id,
        name: actor.name,
        img: actor.img,
        wallet: _fmtCost(currency),
        items,
        itemCount: items.length,
        totalSlots,
        maxSlots,
      };
    });

    return { columns, hasMembers: columns.length > 0 };
  }

  _onRender() {
    // No special events needed for now — read-only view
  }
}
