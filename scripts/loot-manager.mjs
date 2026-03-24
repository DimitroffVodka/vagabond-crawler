/**
 * Vagabond Crawler — Loot Manager
 *
 * Build loot tables and assign them to NPCs with an actor-browser-style
 * filterable NPC list (source, type, TL range, search, sortable columns).
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    position: { width: 900, height: 580 },
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
    this._sortColumn = "name";
    this._sortAsc = true;
    this._typeFilter = "";
    this._tlMin = "";
    this._tlMax = "";
    this._npcCache = {};
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

    // All world RollTables grouped by folder
    const tableGroups = this._getTableGroups();
    const flatTables = tableGroups.flatMap(g => g.tables);

    // Sources
    const sources = NPC_SOURCES.map(s => ({
      ...s, selected: s.id === this._sourceFilter,
    }));

    // NPCs
    let npcs = await this._getNPCsForSource(this._sourceFilter);

    // Type filter
    if (this._typeFilter) {
      npcs = npcs.filter(n => n.beingType === this._typeFilter);
    }

    // TL range filter
    const tlMin = this._tlMin !== "" ? parseFloat(this._tlMin) : null;
    const tlMax = this._tlMax !== "" ? parseFloat(this._tlMax) : null;
    if (tlMin !== null) npcs = npcs.filter(n => n.threatLevel >= tlMin);
    if (tlMax !== null) npcs = npcs.filter(n => n.threatLevel <= tlMax);

    // Collect unique being types for filter dropdown
    const allNpcs = await this._getNPCsForSource(this._sourceFilter);
    const beingTypes = [...new Set(allNpcs.map(n => n.beingType).filter(t => t && t !== "—"))].sort();

    // Sort
    const col = this._sortColumn;
    const dir = this._sortAsc ? 1 : -1;
    npcs.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av || "").localeCompare(String(bv || "")) * dir;
    });

    // Enrich with current loot assignments — mark selected option in table list
    npcs = npcs.map(n => {
      const actor = game.actors.get(n.id);
      const currentTable = actor?.getFlag(MODULE_ID, "lootTable") || "";
      return {
        ...n,
        currentTable,
        dropChance: actor?.getFlag(MODULE_ID, "lootDropChance") ?? -1,
        // Pre-build table options with selected state
        tableOptions: flatTables.map(t => ({
          uuid: t.uuid, name: t.name,
          selected: t.uuid === currentTable,
        })),
      };
    });

    // Preview
    let selectedTablePreview = null;
    if (this._selectedAssignTableUuid) {
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
      tableGroups, hasWorldTables: flatTables.length > 0,
      sources, searchName: this._searchName,
      npcs, selectedTablePreview,
      beingTypes, typeFilter: this._typeFilter,
      tlMin: this._tlMin, tlMax: this._tlMax,
    };
  }

  _getTableGroups() {
    const excluded = JSON.parse(game.settings.get(MODULE_ID, "excludedTableFolders") || "[]");
    const groups = [];

    // Ungrouped
    const ungrouped = game.tables.filter(t => !t.folder);
    if (ungrouped.length > 0) {
      groups.push({ label: null, tables: ungrouped.map(t => ({ id: t.id, uuid: t.uuid, name: t.name })) });
    }

    // By folder
    const folders = game.folders.filter(f => f.type === "RollTable" && !excluded.includes(f.id));
    for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
      const tables = game.tables.filter(t => t.folder?.id === folder.id);
      if (tables.length > 0) {
        groups.push({ label: folder.name, tables: tables.map(t => ({ id: t.id, uuid: t.uuid, name: t.name })) });
      }
    }
    return groups;
  }

  async _getNPCsForSource(sourceId) {
    const mapActor = (a) => ({
      id: a.id, name: a.name, img: a.img,
      nameLower: a.name.toLowerCase(),
      beingType: a.system?.beingType || "—",
      threatLevel: a.system?.threatLevel ?? 0,
      threatLevelDisplay: a.system?.threatLevelFormatted ?? a.system?.threatLevel ?? "—",
    });

    if (sourceId === "world") {
      return game.actors.filter(a => a.type === "npc").map(mapActor);
    }

    if (sourceId === "scene") {
      const seen = new Set();
      return (canvas.tokens?.placeables || [])
        .filter(t => t.actor?.type === "npc")
        .map(t => {
          if (seen.has(t.actor.id)) return null;
          seen.add(t.actor.id);
          return mapActor(t.actor);
        })
        .filter(Boolean);
    }

    // Compendium
    if (!this._npcCache[sourceId]) {
      const pack = game.packs.get(sourceId);
      if (!pack) return [];
      const index = await pack.getIndex({ fields: ["img", "system.beingType", "system.threatLevel", "system.threatLevelFormatted"] });
      this._npcCache[sourceId] = index.map(entry => ({
        id: entry._id, name: entry.name,
        img: entry.img || "icons/svg/mystery-man.svg",
        nameLower: entry.name.toLowerCase(),
        beingType: entry.system?.beingType || "—",
        threatLevel: entry.system?.threatLevel ?? 0,
        threatLevelDisplay: entry.system?.threatLevelFormatted ?? entry.system?.threatLevel ?? "—",
        isCompendium: true, packId: sourceId,
      }));
    }
    return [...this._npcCache[sourceId]]; // return copy so filters don't mutate cache
  }

  /* ---- Events ---- */

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const $ = (sel) => el.querySelector(sel);
    const on = (sel, evt, fn) => [...el.querySelectorAll(sel)].forEach(n => n.addEventListener(evt, fn));

    // Tabs
    on(".tab-btn", "click", ev => { this._mode = ev.currentTarget.dataset.mode; this.render(); });

    // ── Build tab ──
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

    // ── NPC Loot tab ──

    // Source filter
    $(".loot-source-filter")?.addEventListener("change", ev => {
      this._sourceFilter = ev.currentTarget.value;
      this._typeFilter = ""; // reset type filter on source change
      this.render();
    });

    // Search — filter in DOM
    const searchInput = $(".loot-search-input");
    if (searchInput) {
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

    // Type filter
    $(".loot-type-filter")?.addEventListener("change", ev => {
      this._typeFilter = ev.currentTarget.value;
      this.render();
    });

    // TL range
    $(".loot-tl-min")?.addEventListener("change", ev => {
      this._tlMin = ev.currentTarget.value;
      this.render();
    });
    $(".loot-tl-max")?.addEventListener("change", ev => {
      this._tlMax = ev.currentTarget.value;
      this.render();
    });

    // Sortable columns
    on(".loot-sortable", "click", ev => {
      const col = ev.currentTarget.dataset.sort;
      if (this._sortColumn === col) this._sortAsc = !this._sortAsc;
      else { this._sortColumn = col; this._sortAsc = true; }
      this.render();
    });

    // Select all
    $(".loot-select-all")?.addEventListener("change", ev => {
      const checked = ev.currentTarget.checked;
      el.querySelectorAll(".npc-select").forEach(cb => { cb.checked = checked; });
    });

    // Assign table dropdown — also updates preview
    $(".loot-assign-table")?.addEventListener("change", ev => {
      this._selectedAssignTableUuid = ev.currentTarget.value;
      this.render();
    });

    // Apply to selected
    $(".loot-apply-btn")?.addEventListener("click", async () => {
      const tableUuid = $(".loot-assign-table")?.value || "";
      const checked = [...el.querySelectorAll(".npc-select:checked")];
      if (!checked.length) { ui.notifications.warn("Select NPCs first."); return; }

      for (const cb of checked) {
        const actor = game.actors.get(cb.dataset.actorId);
        if (!actor) continue;
        if (tableUuid) await actor.setFlag(MODULE_ID, "lootTable", tableUuid);
        else await actor.unsetFlag(MODULE_ID, "lootTable");
      }
      ui.notifications.info(`Assigned table to ${checked.length} NPC(s).`);
      this.render();
    });

    // Per-NPC table select
    on(".npc-table-select", "change", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const tableUuid = ev.currentTarget.value;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      if (tableUuid) await actor.setFlag(MODULE_ID, "lootTable", tableUuid);
      else await actor.unsetFlag(MODULE_ID, "lootTable");
    });

    // Double-click NPC row to open actor sheet
    on(".loot-npc-row", "dblclick", async ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      const actor = game.actors.get(actorId);
      if (actor) {
        actor.sheet.render(true);
      }
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
    this._selectedAssignTableUuid = table.uuid;
    this._mode = "tables";
    this.render();
  }
}
