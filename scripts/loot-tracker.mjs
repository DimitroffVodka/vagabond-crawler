/**
 * Vagabond Crawler — Loot Tracker
 *
 * Logs all item pickups and loot claims during a session.
 * Provides a "Copy for Discord" button that formats the log as markdown.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------- */
/*  Loot Tracker Singleton                      */
/* -------------------------------------------- */

export const LootTracker = {

  _app: null,

  registerSettings() {
    game.settings.register(MODULE_ID, "lootLog", {
      scope: "world",
      config: false,
      type: Array,
      default: [],
    });
  },

  init() {
    console.log(`${MODULE_ID} | Loot Tracker initialized.`);
  },

  /**
   * Log a loot event.
   * @param {Object} entry
   * @param {string} entry.player — Character name
   * @param {string} entry.source — Where the loot came from (NPC name, "dropped item", etc.)
   * @param {string} entry.type — "currency" | "item" | "pickup"
   * @param {string} entry.detail — Human-readable detail (e.g. "5 Gold", "Longsword")
   * @param {string} [entry.img] — Item icon path
   */
  async log(entry) {
    const log = game.settings.get(MODULE_ID, "lootLog") || [];
    log.push({
      ...entry,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    await game.settings.set(MODULE_ID, "lootLog", log);

    // Refresh the app if it's open
    if (this._app?.rendered) this._app.render();
  },

  /**
   * Log a full loot claim (currency + items).
   */
  async logClaim(playerName, sourceName, currency, items) {
    const parts = [];
    if (currency.gold > 0) parts.push(`${currency.gold} Gold`);
    if (currency.silver > 0) parts.push(`${currency.silver} Silver`);
    if (currency.copper > 0) parts.push(`${currency.copper} Copper`);

    if (parts.length > 0) {
      await this.log({
        player: playerName,
        source: sourceName,
        type: "currency",
        detail: parts.join(", "),
      });
    }

    for (const item of items) {
      await this.log({
        player: playerName,
        source: sourceName,
        type: "item",
        detail: item.name,
        img: item.img,
      });
    }
  },

  /**
   * Log an item pickup (from ItemDrops).
   */
  async logPickup(playerName, itemName, itemImg) {
    await this.log({
      player: playerName,
      source: "Ground",
      type: "pickup",
      detail: itemName,
      img: itemImg,
    });
  },

  /**
   * Get the current log.
   */
  getLog() {
    return game.settings.get(MODULE_ID, "lootLog") || [];
  },

  /**
   * Clear the log.
   */
  async clearLog() {
    await game.settings.set(MODULE_ID, "lootLog", []);
    if (this._app?.rendered) this._app.render();
  },

  /**
   * Format the log as Discord markdown.
   */
  formatForDiscord() {
    const log = this.getLog();
    if (log.length === 0) return "No loot recorded this session.";

    // Group by player
    const byPlayer = {};
    for (const entry of log) {
      if (!byPlayer[entry.player]) byPlayer[entry.player] = [];
      byPlayer[entry.player].push(entry);
    }

    const lines = ["# Loot Summary", ""];

    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`## ${player}`);

      // Group currency vs items
      const currencyEntries = entries.filter(e => e.type === "currency");
      const itemEntries = entries.filter(e => e.type === "item" || e.type === "pickup");

      if (currencyEntries.length > 0) {
        // Sum up currency
        let totalGold = 0, totalSilver = 0, totalCopper = 0;
        for (const e of currencyEntries) {
          const goldMatch = e.detail.match(/(\d+)\s*Gold/i);
          const silverMatch = e.detail.match(/(\d+)\s*Silver/i);
          const copperMatch = e.detail.match(/(\d+)\s*Copper/i);
          if (goldMatch) totalGold += parseInt(goldMatch[1]);
          if (silverMatch) totalSilver += parseInt(silverMatch[1]);
          if (copperMatch) totalCopper += parseInt(copperMatch[1]);
        }
        const currParts = [];
        if (totalGold > 0) currParts.push(`${totalGold}g`);
        if (totalSilver > 0) currParts.push(`${totalSilver}s`);
        if (totalCopper > 0) currParts.push(`${totalCopper}c`);
        if (currParts.length > 0) lines.push(`- **Currency:** ${currParts.join(", ")}`);
      }

      if (itemEntries.length > 0) {
        lines.push("- **Items:**");
        for (const e of itemEntries) {
          const source = e.source !== "Ground" ? ` *(from ${e.source})*` : " *(picked up)*";
          lines.push(`  - ${e.detail}${source}`);
        }
      }

      lines.push("");
    }

    return lines.join("\n");
  },

  /**
   * Open the loot tracker window.
   */
  open() {
    if (!this._app) this._app = new LootTrackerApp();
    this._app.render(true);
  },
};

/* -------------------------------------------- */
/*  Loot Tracker Application                    */
/* -------------------------------------------- */

class LootTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-loot-tracker",
    window: { title: "Loot Log", resizable: true },
    position: { width: 500, height: 500 },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/loot-tracker.hbs" },
  };

  async _prepareContext() {
    const log = LootTracker.getLog();

    // Build entries in reverse chronological order
    const entries = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      const iconHtml = entry.type === "currency"
        ? '<i class="fas fa-coins" style="color:gold;"></i>'
        : entry.img
          ? `<img src="${entry.img}" width="20" height="20" style="border-radius:2px;">`
          : '<i class="fas fa-box" style="color:#aaa;"></i>';

      const typeColor = entry.type === "currency" ? "#daa520"
        : entry.type === "pickup" ? "#4caf50"
        : "#ccc";

      entries.push({ ...entry, iconHtml, typeColor });
    }

    return { entries };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    // Copy for Discord
    el.querySelector(".lt-copy-btn")?.addEventListener("click", async () => {
      const text = LootTracker.formatForDiscord();
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Loot log copied to clipboard!");
    });

    // Clear log
    el.querySelector(".lt-clear-btn")?.addEventListener("click", async () => {
      const ok = await Dialog.confirm({
        title: "Clear Loot Log",
        content: "Clear all loot log entries?",
      });
      if (ok) {
        await LootTracker.clearLog();
      }
    });
  }
}
