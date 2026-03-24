/**
 * Vagabond Crawler — Loot Manager
 *
 * Build loot tables and assign them to NPCs with an actor-browser-style
 * filterable NPC list (source dropdown + search + table assignment).
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const LOOT_TABLE_FLAG = "isLootTable";

const NPC_SOURCES = [
  { id: "world",             label: "World NPCs" },
  { id: "scene",             label: "Scene NPCs" },
  { id: "vagabond.bestiary", label: "Bestiary" },
  { id: "vagabond.humanlike", label: "Humanlike" },
];

let _app = null;

export const LootManager = {
  init() { console.log(`${MODULE_ID} | Loot Manager initialized.`); },
  open() {
    if (!game.user.isGM) { ui.notifications.warn("Only the GM can manage loot tables."); return; }
    if (!_app) _app = new LootManagerApp();
    _app.render(true);
  },
};

/* -------------------------------------------- */

class LootManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-loot-manager",
    window: { title: "Loot Manager", resizable: true },
    position: { width: 860, height: 550 },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/loot-manager.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._mode = "build";
    this._tableName = "";
    this._slots = Array.from({ length: 10 }, () => null);
    this._sourceFilter = "scene";
    this._searchName = "";
    this._selectedAssignTableUuid = "";
    this._npcCache = {};  // packId → actor[]
  }

  async _prepareContext() { return this.getData(); }

  async getData() {
    const isBuildMode = this._mode === "build";

    // Build slots
    const slots = this._slots.map((s, i) => ({
      index: i, number: i + 1,
      name: s?.name || null, uuid: s?.uuid || null,
      img: s?.img || null, weight: s?.weight ?? 1,
    }));

    // All world RollTables (any table can be used as loot)
    const lootTables = game.tables
      .map(t => ({ id: t.id, uuid: t.uuid, name: t.name, formula: t.formula }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Sources
    const sources = NPC_SOURCES.map(s => ({
      ...s, selected: s.id === this._sourceFilter,
    }));

    // NPCs based on source filter
    let npcs = await this._getNPCsForSource(this._sourceFilter);

    // Enrich with current loot assignments
    npcs = npcs.map(n => {
      const actor = game.actors.get(n.id);
      return {
        ...n,
        currentTable: actor?.getFlag(MODULE_ID, "lootTable") || "",
        dropChance: actor?.getFlag(MODULE_ID, "lootDropChance") ?? -1,
      };
    });

    // Preview the currently selected assign table
    let selectedTablePreview = null;
    if (this._selectedAssignTableUuid) {
      // UUID format: RollTable.id or similar — extract the ID
      const tableId = this._selectedAssignTableUuid.split(".").pop();
      const table = game.tables.get(tableId);
      if (table) {
        selectedTablePreview = {
          name: table.name, formula: table.formula,
          rows: table.results.map(r => ({
            range: `${r.range[0]}–${r.range[1]}`,
            name: r.text || "???",
            img: r.img || null,
          })),
        };
      }
    }

    return {
      isBuildMode, tableName: this._tableName, slots,
      lootTables, hasLootTables: lootTables.length > 0,
      sources, searchName: this._searchName,
      npcs, selectedTablePreview,
    };
  }

  async _getNPCsForSource(sourceId) {
    if (sourceId === "world") {
      return game.actors
        .filter(a => a.type === "npc")
        .map(a => ({ id: a.id, name: a.name, img: a.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    if (sourceId === "scene") {
      const seen = new Set();
      return canvas.tokens?.placeables
        .filter(t => t.actor?.type === "npc")
        .map(t => {
          if (seen.has(t.actor.id)) return null;
          seen.add(t.actor.id);
          return { id: t.actor.id, name: t.actor.name, img: t.actor.img };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name)) || [];
    }

    // Compendium pack
    if (!this._npcCache[sourceId]) {
      const pack = game.packs.get(sourceId);
      if (!pack) return [];
      const index = await pack.getIndex({ fields: ["img"] });
      this._npcCache[sourceId] = index.map(entry => ({
        id: entry._id,
        name: entry.name,
        img: entry.img || "icons/svg/mystery-man.svg",
        isCompendium: true,
        packId: sourceId,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return this._npcCache[sourceId];
  }

  /* ---- Events ---- */

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const $ = (sel) => el.querySelector(sel);
    const on = (sel, evt, fn) => [...el.querySelectorAll(sel)].forEach(n => n.addEventListener(evt, fn));

    // Tabs
    on(".tab-btn", "click", ev => { this._mode = ev.currentTarget.dataset.mode; this.render(); });

    // Build tab
    const nameInput = $(".table-name-input");
    if (nameInput) nameInput.addEventListener("input", () => { this._tableName = nameInput.value; });

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

    on(".appearing-input", "change", ev => {
      const idx = parseInt(ev.currentTarget.dataset.index);
      if (this._slots[idx]) this._slots[idx].weight = parseInt(ev.currentTarget.value) || 1;
    });

    on(".clear-slot", "click", ev => {
      ev.stopPropagation();
      this._slots[parseInt(ev.currentTarget.dataset.index)] = null;
      this.render();
    });

    $(".save-table")?.addEventListener("click", () => this._saveAsLootTable());

    // NPC Loot tab — filters
    $(".loot-source-filter")?.addEventListener("change", ev => {
      this._sourceFilter = ev.currentTarget.value;
      this.render();
    });

    const searchInput = $(".loot-search-input");
    if (searchInput) {
      // Filter NPC rows in-place without re-rendering (preserves focus)
      searchInput.value = this._searchName;
      searchInput.addEventListener("input", () => {
        this._searchName = searchInput.value;
        const search = this._searchName.toLowerCase();
        el.querySelectorAll(".loot-npc-row").forEach(row => {
          const name = row.querySelector(".loot-npc-name")?.textContent?.toLowerCase() || "";
          row.style.display = search && !name.includes(search) ? "none" : "";
        });
      });
    }

    // Select all checkbox
    $(".loot-select-all")?.addEventListener("change", ev => {
      const checked = ev.currentTarget.checked;
      el.querySelectorAll(".npc-select").forEach(cb => { cb.checked = checked; });
    });

    // Apply to selected
    $(".loot-apply-btn")?.addEventListener("click", async () => {
      const tableUuid = $(".loot-assign-table")?.value || "";
      const chance = parseInt($(".loot-assign-chance")?.value ?? -1);
      const checked = [...el.querySelectorAll(".npc-select:checked")];
      if (!checked.length) { ui.notifications.warn("Select NPCs first."); return; }

      for (const cb of checked) {
        const actor = game.actors.get(cb.dataset.actorId);
        if (!actor) continue;
        if (tableUuid) {
          await actor.setFlag(MODULE_ID, "lootTable", tableUuid);
        } else {
          await actor.unsetFlag(MODULE_ID, "lootTable");
        }
        if (chance >= 0) {
          await actor.setFlag(MODULE_ID, "lootDropChance", chance);
        } else {
          await actor.unsetFlag(MODULE_ID, "lootDropChance");
        }
      }
      ui.notifications.info(`Updated loot config for ${checked.length} NPC(s).`);
      this.render();
    });

    // Per-NPC table assignment (inline)
    on(".npc-table-select", "change", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const tableUuid = ev.currentTarget.value;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      if (tableUuid) await actor.setFlag(MODULE_ID, "lootTable", tableUuid);
      else await actor.unsetFlag(MODULE_ID, "lootTable");
    });

    on(".npc-chance-input", "change", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const chance = parseInt(ev.currentTarget.value);
      const actor = game.actors.get(actorId);
      if (!actor) return;
      if (chance >= 0) await actor.setFlag(MODULE_ID, "lootDropChance", chance);
      else await actor.unsetFlag(MODULE_ID, "lootDropChance");
    });

    // Assign table select — also updates preview
    $(".loot-assign-table")?.addEventListener("change", ev => {
      this._selectedAssignTableUuid = ev.currentTarget.value;
      this.render();
    });
  }

  /* ---- Save ---- */

  async _saveAsLootTable() {
    const filled = this._slots.filter(s => s !== null);
    if (!filled.length) { ui.notifications.warn("Add at least one item."); return; }
    const name = this._tableName.trim() || "Unnamed Loot Table";

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
      flags: { [MODULE_ID]: { isLootTable: true } },
    });

    ui.notifications.info(`Loot table "${name}" created.`);
    this._tableName = "";
    this._slots = Array.from({ length: 10 }, () => null);
    this._selectedPreviewTableId = table.id;
    this._mode = "tables";
    this.render();
  }
}
