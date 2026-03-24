/**
 * Vagabond Crawler — Loot Manager
 *
 * ApplicationV2 for building loot tables, assigning them to NPCs,
 * and managing loot configuration.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LOOT_TABLE_FLAG = "isLootTable";

const COMPENDIUM_PACKS = [
  { id: "vagabond.weapons",          label: "Weapons",    icon: "fas fa-sword" },
  { id: "vagabond.armor",            label: "Armor",      icon: "fas fa-shield" },
  { id: "vagabond.gear",             label: "Gear",       icon: "fas fa-toolbox" },
  { id: "vagabond.alchemical-items", label: "Alchemical", icon: "fas fa-flask" },
  { id: "vagabond.relics",           label: "Relics",     icon: "fas fa-gem" },
];

/* -------------------------------------------- */
/*  Loot Manager Singleton                      */
/* -------------------------------------------- */

let _app = null;

export const LootManager = {

  init() {
    console.log(`${MODULE_ID} | Loot Manager initialized.`);
  },

  open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can manage loot tables.");
      return;
    }
    if (!_app) _app = new LootManagerApp();
    _app.render(true);
  },
};

/* -------------------------------------------- */
/*  Loot Manager ApplicationV2                  */
/* -------------------------------------------- */

class LootManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-loot-manager",
    window: { title: "Loot Manager", resizable: true },
    position: { width: 700, height: 600 },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/loot-manager.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._mode = "build";       // "build" | "assign" | "tables"
    this._tableName = "";
    this._slots = Array.from({ length: 10 }, () => null); // { name, uuid, img, weight }
    this._browsingPack = null;
    this._browsingItems = [];
    this._selectedTableId = null;
    this._compendiumCache = {};
  }

  /* ---- Data ---- */

  async _prepareContext() {
    return this.getData();
  }

  getData() {
    const isBuildMode = this._mode === "build";
    const isAssignMode = this._mode === "assign";
    const isTablesMode = this._mode === "tables";

    // Slots for build mode
    const slots = this._slots.map((s, i) => ({
      index: i,
      number: i + 1,
      name: s?.name || null,
      uuid: s?.uuid || null,
      img: s?.img || null,
      weight: s?.weight ?? 1,
    }));

    // Loot tables (RollTables flagged as loot tables)
    const lootTables = game.tables
      .filter(t => t.getFlag(MODULE_ID, LOOT_TABLE_FLAG))
      .map(t => ({
        id: t.id,
        uuid: t.uuid,
        name: t.name,
        formula: t.formula,
        selected: t.id === this._selectedTableId,
      }));

    // NPC actors for assign mode
    const npcs = isAssignMode ? game.actors
      .filter(a => a.type === "npc")
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        currentTable: a.getFlag(MODULE_ID, "lootTable") || "",
        dropChance: a.getFlag(MODULE_ID, "lootDropChance") ?? -1,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) : [];

    // Selected table preview
    let selectedTablePreview = null;
    if (isTablesMode && this._selectedTableId) {
      const table = game.tables.get(this._selectedTableId);
      if (table) {
        selectedTablePreview = {
          name: table.name,
          formula: table.formula,
          rows: table.results.map(r => ({
            range: `${r.range[0]}–${r.range[1]}`,
            name: r.text || r.name || "???",
            img: r.img || null,
          })),
        };
      }
    }

    // Browsing pack items
    let browsingPackLabel = null;
    if (this._browsingPack) {
      const packDef = COMPENDIUM_PACKS.find(p => p.id === this._browsingPack);
      browsingPackLabel = packDef?.label || this._browsingPack;
    }

    return {
      isBuildMode, isAssignMode, isTablesMode,
      tableName: this._tableName,
      slots,
      compendiumPacks: COMPENDIUM_PACKS,
      browsingPack: this._browsingPack,
      browsingPackLabel,
      browsingItems: this._browsingItems,
      lootTables,
      hasLootTables: lootTables.length > 0,
      npcs,
      selectedTablePreview,
    };
  }

  /* ---- Events ---- */

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const $ = (sel) => el.querySelector(sel);
    const on = (sel, evt, fn) => [...el.querySelectorAll(sel)].forEach(n => n.addEventListener(evt, fn));

    // Tab switching
    on(".tab-btn", "click", ev => {
      this._mode = ev.currentTarget.dataset.mode;
      this.render();
    });

    // Table name input
    const nameInput = $(".table-name-input");
    if (nameInput) nameInput.addEventListener("input", () => { this._tableName = nameInput.value; });

    // Slot drag-drop
    on(".encounter-slot", "dragover", ev => ev.preventDefault());
    on(".encounter-slot", "drop", async ev => {
      ev.preventDefault();
      const idx = parseInt(ev.currentTarget.dataset.index);
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Item") { ui.notifications.warn("Drop an item here."); return; }
        const item = await fromUuid(data.uuid);
        if (!item) return;
        this._slots[idx] = { name: item.name, uuid: data.uuid, img: item.img, weight: 1 };
        this.render();
      } catch (e) { console.error(`${MODULE_ID} | Drop error:`, e); }
    });

    // Weight inputs
    on(".weight-input", "change", ev => {
      const idx = parseInt(ev.currentTarget.dataset.index);
      if (this._slots[idx]) this._slots[idx].weight = parseInt(ev.currentTarget.value) || 1;
    });

    // Clear slot
    on(".clear-slot", "click", ev => {
      const idx = parseInt(ev.currentTarget.dataset.index);
      this._slots[idx] = null;
      this.render();
    });

    // Save as loot table
    $(".save-table")?.addEventListener("click", () => this._saveAsLootTable());

    // Browse compendium packs
    on(".loot-browse-pack", "click", async ev => {
      const packId = ev.currentTarget.dataset.pack;
      await this._browseCompendium(packId);
    });

    // Close browser
    $(".close-browser")?.addEventListener("click", () => {
      this._browsingPack = null;
      this._browsingItems = [];
      this.render();
    });

    // Add item from browser
    on(".add-item-btn", "click", ev => {
      const uuid = ev.currentTarget.dataset.uuid;
      const name = ev.currentTarget.dataset.name;
      const img = ev.currentTarget.dataset.img;
      // Find first empty slot
      const idx = this._slots.findIndex(s => s === null);
      if (idx === -1) {
        ui.notifications.warn("All slots are full. Clear a slot first.");
        return;
      }
      this._slots[idx] = { name, uuid, img, weight: 1 };
      this.render();
    });

    // NPC table assignment
    on(".npc-table-select", "change", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const tableUuid = ev.currentTarget.value;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      if (tableUuid) {
        await actor.setFlag(MODULE_ID, "lootTable", tableUuid);
      } else {
        await actor.unsetFlag(MODULE_ID, "lootTable");
      }
    });

    // NPC drop chance
    on(".npc-chance-input", "change", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const chance = parseInt(ev.currentTarget.value);
      const actor = game.actors.get(actorId);
      if (!actor) return;
      if (chance < 0) {
        await actor.unsetFlag(MODULE_ID, "lootDropChance");
      } else {
        await actor.setFlag(MODULE_ID, "lootDropChance", chance);
      }
    });

    // Bulk assign
    $(".bulk-assign-btn")?.addEventListener("click", async () => {
      const tableUuid = $(".bulk-table-select")?.value;
      if (!tableUuid) { ui.notifications.warn("Select a table first."); return; }
      const checked = [...el.querySelectorAll(".npc-select:checked")];
      if (!checked.length) { ui.notifications.warn("Select NPCs first."); return; }
      for (const cb of checked) {
        const actor = game.actors.get(cb.dataset.actorId);
        if (actor) await actor.setFlag(MODULE_ID, "lootTable", tableUuid);
      }
      ui.notifications.info(`Assigned table to ${checked.length} NPC(s).`);
      this.render();
    });

    // Table preview (click on existing table row)
    on(".loot-table-row", "click", ev => {
      this._selectedTableId = ev.currentTarget.dataset.tableId;
      this.render();
    });

    // Remove loot flag from table
    on(".delete-loot-table", "click", async ev => {
      ev.stopPropagation();
      const tableId = ev.currentTarget.dataset.tableId;
      const table = game.tables.get(tableId);
      if (table) {
        await table.unsetFlag(MODULE_ID, LOOT_TABLE_FLAG);
        ui.notifications.info(`Removed loot flag from "${table.name}".`);
        this.render();
      }
    });
  }

  /* ---- Compendium Browsing ---- */

  async _browseCompendium(packId) {
    if (!this._compendiumCache[packId]) {
      const pack = game.packs.get(packId);
      if (!pack) { ui.notifications.warn("Pack not found."); return; }
      const index = await pack.getIndex({ fields: ["img"] });
      this._compendiumCache[packId] = index.map(entry => ({
        name: entry.name,
        img: entry.img || "icons/svg/item-bag.svg",
        uuid: `Compendium.${packId}.Item.${entry._id}`,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    this._browsingPack = packId;
    this._browsingItems = this._compendiumCache[packId];
    this.render();
  }

  /* ---- Save as Loot Table ---- */

  async _saveAsLootTable() {
    const filled = this._slots.filter(s => s !== null);
    if (!filled.length) { ui.notifications.warn("Add at least one item."); return; }
    const name = this._tableName.trim() || "Unnamed Loot Table";

    // Build results with weighted ranges
    const totalWeight = filled.reduce((sum, s) => sum + s.weight, 0);
    const results = [];
    let rangeStart = 1;
    for (const slot of filled) {
      const rangeEnd = rangeStart + slot.weight - 1;
      results.push({
        type: CONST.TABLE_RESULT_TYPES.DOCUMENT,
        weight: slot.weight,
        range: [rangeStart, rangeEnd],
        text: slot.name,
        img: slot.img,
        documentCollection: "Item",
        documentId: slot.uuid.split(".").pop(),
        flags: { [MODULE_ID]: { itemUuid: slot.uuid } },
      });
      rangeStart = rangeEnd + 1;
    }

    const table = await RollTable.create({
      name,
      formula: `1d${totalWeight}`,
      results,
      flags: { [MODULE_ID]: { [LOOT_TABLE_FLAG]: true } },
    });

    ui.notifications.info(`Loot table "${name}" created.`);

    // Reset
    this._tableName = "";
    this._slots = Array.from({ length: 10 }, () => null);
    this._mode = "tables";
    this._selectedTableId = table.id;
    this.render();
  }
}
