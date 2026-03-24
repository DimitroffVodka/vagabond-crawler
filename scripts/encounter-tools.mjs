/**
 * Vagabond Crawler — Encounter Tools
 *
 * Encounter Check: d6 roll, configurable threshold (1-in-6 through 5-in-6).
 * On hit, auto-opens the encounter roller and rolls the active table.
 * Encounter Roller: full Application window matching vagabond-extras UX:
 *   - Build Table tab: drag NPCs onto slots, save as RollTable
 *   - Roll Tables tab: pick any world RollTable (grouped by folder) and roll it
 *   - Result panel: monster × count, distance, reaction with reroll buttons
 *   - Post to Chat / Place Tokens actions
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { confirmDialog } from "./dialog-helpers.mjs";
import { ICONS } from "./icons.mjs";
import { MUTATIONS, MUTATION_CATEGORIES, getMutation, getBoons, getBanes } from "./mutation-data.mjs";
import { getStatSummary, applyMutations, generateMutatedName, generatePrompt, createMutatedActor, calculateHP, calculateDPR, calculateTL } from "./monster-mutator.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function rollDistance() {
  const v = Math.ceil(Math.random() * 6);
  return {
    roll: v,
    label: v === 1 ? "Close (within 10ft)"
         : v <= 4  ? "Near (30–60ft)"
         :           "Far (100ft+, if possible)",
  };
}

function rollReaction() {
  const v = Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
  const label =
    v <= 3  ? "Violent — attacks immediately"
  : v <= 6  ? "Hostile — likely to attack"
  : v <= 9  ? "Untrusting, possibly confused"
  : v <= 11 ? "Neutral, open to leaving peacefully"
  :           "Friendly, willing to become an Ally";
  return { roll: v, label };
}

// ── Encounter Check ───────────────────────────────────────────────────────────

export const EncounterTools = {

  _app: null,

  async rollEncounterCheck() {
    const roll      = await new Roll("1d6").evaluate();
    const threshold = game.settings.get(MODULE_ID, "encounterThreshold");
    const hit       = roll.total <= threshold;
    const gmOnly    = game.settings.get(MODULE_ID, "encounterRollGMOnly");

    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat ${hit ? "encounter-hit" : "encounter-miss"}">
        <h3>${hit ? ICONS.encounterChat : '<i class="fas fa-dice-d6"></i>'}
          ${hit ? "Encounter!" : "No Encounter"}
        </h3>
        <p>Rolled <strong>${roll.total}</strong> on d6 (encounter on ${threshold} or less) —
          ${hit ? "something stirs in the dark." : "the dungeon is quiet… for now."}
        </p>
      </div>`,
      speaker: { alias: "Crawler" },
      rolls:   [roll],
      whisper: gmOnly ? game.users.filter(u => u.isGM).map(u => u.id) : [],
    });

    // Auto-open encounter roller and roll the active table on hit
    if (hit) this.rollInstantEncounter();
  },

  rollInstantEncounter() {
    this.openTableBuilder();
    // If a table is already registered, pre-roll it
    const uuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    if (uuid && this._app) {
      setTimeout(() => this._app?._rollFromRegisteredTable(), 200);
    }
  },

  openTableBuilder() {
    if (!this._app) this._app = new EncounterRollerApp();
    this._app.render(true);
  },
};

// ── Encounter Roller App ──────────────────────────────────────────────────────

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class EncounterRollerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       `vagabond-crawler-encounter-roller`,
    window:   { title: "Random Encounter", resizable: true },
    position: { width: 700, height: "auto" },
  };

  static PARTS = {
    form: { template: `modules/vagabond-crawler/templates/encounter-roller.hbs` },
  };

  constructor(...args) {
    super(...args);
    this._mode            = "build";
    this._dieType         = "d6";
    this._tableName       = "";
    this._slots           = [];
    this._lastResult      = null;
    this._selectedTableId = game.tables.size > 0 ? game.tables.contents[0].id : null;
    // Browse tab state
    this._browseSource    = "vagabond.bestiary";
    this._browseSearch    = "";
    this._browseType      = "";
    this._browseTlMin     = "";
    this._browseTlMax     = "";
    this._browseSortCol   = "name";
    this._browseSortAsc   = true;
    this._browseCache     = {};
    // Mutate tab state
    this._mutateSource    = "vagabond.bestiary";
    this._mutateBaseUuid  = "";
    this._mutateBaseData  = null;
    this._mutateSelected  = new Set();
    this._mutateCustomName = "";
  }

  async _prepareContext() {
    const ctx = this.getData();

    if (ctx.isBrowseMode) {
      const sources = [
        { id: "world", label: "World NPCs" },
        { id: "scene", label: "Scene NPCs" },
        { id: "vagabond.bestiary", label: "Bestiary" },
        { id: "vagabond.humanlike", label: "Humanlike" },
      ];
      ctx.browseSources = sources.map(s => ({ ...s, selected: s.id === this._browseSource }));

      let npcs = await this._getBrowseNPCs(this._browseSource);

      // Type filter
      if (this._browseType) npcs = npcs.filter(n => n.beingType === this._browseType);

      // TL range
      const tlMin = this._browseTlMin !== "" ? parseFloat(this._browseTlMin) : null;
      const tlMax = this._browseTlMax !== "" ? parseFloat(this._browseTlMax) : null;
      if (tlMin !== null) npcs = npcs.filter(n => n.threatLevel >= tlMin);
      if (tlMax !== null) npcs = npcs.filter(n => n.threatLevel <= tlMax);

      // Collect types before search filter
      const allNpcs = await this._getBrowseNPCs(this._browseSource);
      ctx.browseBeingTypes = [...new Set(allNpcs.map(n => n.beingType).filter(t => t && t !== "—"))].sort();

      // Sort
      const col = this._browseSortCol;
      const dir = this._browseSortAsc ? 1 : -1;
      npcs.sort((a, b) => {
        const av = a[col], bv = b[col];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av || "").localeCompare(String(bv || "")) * dir;
      });

      ctx.browseNpcs = npcs;
    }

    // ── Mutate tab ──
    if (ctx.isMutateMode) {
      const sources = [
        { id: "vagabond.bestiary", label: "Bestiary", active: this._mutateSource === "vagabond.bestiary" },
        { id: "vagabond.humanlike", label: "Humanlike", active: this._mutateSource === "vagabond.humanlike" },
        { id: "world", label: "World NPCs", active: this._mutateSource === "world" },
      ];
      ctx.mutateSources = sources;

      // Load monster list (reuse browse cache)
      const monsters = await this._getBrowseNPCs(this._mutateSource);
      monsters.sort((a, b) => a.name.localeCompare(b.name));
      ctx.mutateMonsters = monsters.map(m => ({
        ...m,
        selected: m.uuid === this._mutateBaseUuid,
      }));

      // If a base monster is selected, prepare mutation data
      if (this._mutateBaseUuid && this._mutateBaseData) {
        const baseSystem = this._mutateBaseData.system;
        const baseSummary = getStatSummary(baseSystem);
        ctx.mutateBase = baseSummary;

        // Calculate mutated stats
        const mutatedData = foundry.utils.deepClone(this._mutateBaseData);
        const { appliedMutations, prefixes, suffixes, tlDelta } = applyMutations(mutatedData, [...this._mutateSelected]);
        const mutatedSystem = mutatedData.system;
        const mutatedSummary = getStatSummary(mutatedSystem);
        ctx.mutateNew = mutatedSummary;

        const hasMutations = this._mutateSelected.size > 0;
        ctx.mutateDelta = hasMutations;
        ctx.mutateDeltaPositive = (mutatedSummary.tl - baseSummary.tl) >= 0;
        const delta = mutatedSummary.tl - baseSummary.tl;
        ctx.mutateDeltaDisplay = (delta >= 0 ? "+" : "") + delta.toFixed(2);

        // Name
        const genName = generateMutatedName(this._mutateBaseData.name, prefixes, suffixes);
        ctx.mutateGeneratedName = this._mutateCustomName || genName;

        // Prompt
        ctx.mutatePrompt = generatePrompt(this._mutateBaseData.name, mutatedSystem, [...this._mutateSelected]);

        // Boons & Banes
        ctx.mutateBoons = getBoons().map(m => ({
          ...m,
          checked: this._mutateSelected.has(m.id),
          isOnFormula: m.tlDelta !== 0,
          tlDisplay: m.tlDelta !== 0 ? `${m.tlDelta > 0 ? "+" : ""}${m.tlDelta.toFixed(1)}` : "off",
        }));
        ctx.mutateBanes = getBanes().map(m => ({
          ...m,
          checked: this._mutateSelected.has(m.id),
          isOnFormula: m.tlDelta !== 0,
          tlDisplay: m.tlDelta !== 0 ? `${m.tlDelta.toFixed(1)}` : "off",
        }));
      }
    }

    return ctx;
  }

  getData() {
    const dieSize = parseInt(this._dieType.replace("d", ""));
    while (this._slots.length < dieSize)  this._slots.push(null);
    while (this._slots.length > dieSize)  this._slots.pop();

    return {
      isBuildMode: this._mode === "build",
      isBrowseMode: this._mode === "browse",
      isExistingMode: this._mode === "existing",
      isMutateMode:   this._mode === "mutate",
      dieTypes: ["d4","d6","d8","d10","d12"].map(d => ({ value: d, selected: d === this._dieType })),
      tableName: this._tableName,
      slots: this._slots.map((s, i) => ({
        index:     i,
        number:    i + 1,
        name:      s?.name      ?? "",
        appearing: s?.appearing ?? "",
        uuid:      s?.uuid      ?? "",
      })),
      worldTableGroups: this._getGroupedTables(),
      hasWorldTables:   game.tables.size > 0,
      selectedTablePreview: this._getTablePreview(this._selectedTableId),
      lastResult:     this._lastResult,
      registeredTable: this._getRegisteredTableName(),
      // Browse tab data (populated async in _prepareContext)
      browseSources: [],
      browseNpcs: [],
      browseBeingTypes: [],
      browseTypeFilter: this._browseType,
      browseTlMin: this._browseTlMin,
      browseTlMax: this._browseTlMax,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    // Helper — querySelector with optional warn
    const $  = (sel)      => el.querySelector(sel);
    const $$ = (sel)      => [...el.querySelectorAll(sel)];
    const on = (sel, evt, fn) => $$( sel).forEach(n => n.addEventListener(evt, fn));

    // Tabs
    on(".tab-btn", "click", ev => {
      this._mode = ev.currentTarget.dataset.mode;
      this.render();
    });

    // Die select — update _dieType then re-render to resize slots
    const dieSelect = $(".die-select");
    if (dieSelect) {
      dieSelect.value = this._dieType;
      dieSelect.addEventListener("change", ev => {
        this._dieType = ev.currentTarget.value;
        this.render();
      });
    }

    // Table name — persist on input (not just change, so it survives re-render)
    const nameInput = $(".table-name-input");
    if (nameInput) {
      nameInput.addEventListener("input", ev => { this._tableName = ev.currentTarget.value; });
    }

    // Appearing inputs
    on(".appearing-input", "change", ev => {
      const idx = parseInt(ev.currentTarget.dataset.index);
      if (this._slots[idx]) this._slots[idx].appearing = ev.currentTarget.value;
    });

    // Clear slot
    on(".clear-slot", "click", ev => {
      this._slots[parseInt(ev.currentTarget.dataset.index)] = null;
      this.render();
    });

    // Track selected world table so it survives re-renders
    const tableSelect = $(".world-table-select");
    if (tableSelect) {
      if (this._selectedTableId) tableSelect.value = this._selectedTableId;
      tableSelect.addEventListener("change", ev => {
        this._selectedTableId = ev.currentTarget.value;
        this.render();
      });
    }

    // Action buttons
    const btn = (sel, fn) => { const b = $(sel); if (b) b.addEventListener("click", fn); };
    btn(".save-table",       () => this._saveAsRollTable());
    btn(".roll-encounter",   () => this._rollFromBuiltTable());
    btn(".roll-world-table", () => {
      const sel = $(".world-table-select");
      if (sel) { this._selectedTableId = sel.value; this._rollFromWorldTable(sel.value); }
    });
    btn(".roll-registered",  () => this._rollFromRegisteredTable());
    btn(".set-as-active",    () => {
      const sel = $(".world-table-select");
      if (sel) { this._selectedTableId = sel.value; this._setAsActive(sel.value); }
    });
    btn(".manage-folders",   () => this._openFolderExclusions());
    btn(".reroll-count",    async () => {
      if (this._lastResult?.countFormula) {
        const r = await new Roll(this._lastResult.countFormula).evaluate();
        this._lastResult.count = Math.max(1, r.total);
        this.render();
      }
    });
    btn(".reroll-distance", () => {
      if (this._lastResult) { this._lastResult.distance = rollDistance(); this.render(); }
    });
    btn(".reroll-reaction", () => {
      if (this._lastResult) { this._lastResult.reaction = rollReaction(); this.render(); }
    });
    btn(".post-to-chat",  () => this._postToChat());
    btn(".place-tokens",  () => this._placeTokens());

    // Drag-drop onto slots
    $$(".encounter-slot").forEach(slotEl => {
      slotEl.addEventListener("dragover", ev => ev.preventDefault());
      slotEl.addEventListener("drop", async ev => {
        ev.preventDefault();
        const idx = parseInt(slotEl.dataset.index);
        try {
          const data  = JSON.parse(ev.dataTransfer.getData("text/plain"));
          let actor = data.uuid ? await fromUuid(data.uuid) : null;
          if (!actor && data.id) actor = game.actors.get(data.id);
          if (!actor || actor.type !== "npc") {
            ui.notifications.warn("Drop an NPC actor onto the slot.");
            return;
          }
          this._slots[idx] = {
            name:      actor.name,
            uuid:      actor.uuid,
            appearing: actor.system.appearing || "1",
          };
          this.render();
        } catch (e) { console.error(`${MODULE_ID} | Drop error:`, e); }
      });
    });

    // ── Browse tab events ──
    $(".browse-source-filter")?.addEventListener("change", ev => {
      this._browseSource = ev.currentTarget.value;
      this._browseType = "";
      this.render();
    });

    const browseSearch = $(".browse-search-input");
    if (browseSearch) {
      browseSearch.value = this._browseSearch;
      browseSearch.addEventListener("input", () => {
        this._browseSearch = browseSearch.value;
        const search = this._browseSearch.toLowerCase();
        $$(".browse-npc-row").forEach(row => {
          const name = row.querySelector(".loot-npc-name")?.textContent?.toLowerCase() || "";
          row.style.display = search && !name.includes(search) ? "none" : "";
        });
      });
    }

    $(".browse-type-filter")?.addEventListener("change", ev => {
      this._browseType = ev.currentTarget.value;
      this.render();
    });

    $(".browse-tl-min")?.addEventListener("change", ev => {
      this._browseTlMin = ev.currentTarget.value;
      this.render();
    });
    $(".browse-tl-max")?.addEventListener("change", ev => {
      this._browseTlMax = ev.currentTarget.value;
      this.render();
    });

    // Browse sort
    on(".loot-sortable", "click", ev => {
      const col = ev.currentTarget.dataset.sort;
      if (this._browseSortCol === col) this._browseSortAsc = !this._browseSortAsc;
      else { this._browseSortCol = col; this._browseSortAsc = true; }
      this.render();
    });

    // Browse "+" button — add NPC to next empty Build Table slot
    on(".browse-add-btn", "click", ev => {
      ev.stopPropagation();
      const row = ev.currentTarget.closest(".browse-npc-row");
      const uuid = row.dataset.uuid;
      const name = row.dataset.name;
      const appearing = row.dataset.appearing || "1";

      const emptyIdx = this._slots.findIndex(s => s === null);
      if (emptyIdx === -1) {
        ui.notifications.warn("All slots are full. Increase the die size or clear a slot.");
        return;
      }
      this._slots[emptyIdx] = { name, uuid, appearing };
      ui.notifications.info(`Added ${name} to slot ${emptyIdx + 1}.`);
    });

    // Browse drag — make rows draggable as Actor type
    $$(".browse-npc-row").forEach(row => {
      row.addEventListener("dragstart", ev => {
        const uuid = row.dataset.uuid;
        ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
      });
    });

    // Browse double-click to inspect
    $$(".browse-npc-row").forEach(row => {
      const nameCell = row.querySelector(".loot-npc-name");
      const imgCell = row.querySelector(".loot-npc-img");
      const handler = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const uuid = row.dataset.uuid;
        if (uuid) {
          const doc = await fromUuid(uuid);
          if (doc) doc.sheet.render(true);
        }
      };
      if (nameCell) nameCell.addEventListener("dblclick", handler);
      if (imgCell) imgCell.addEventListener("dblclick", handler);
    });

    // ── Mutate tab ──

    // Source selector
    const mutSrcSelect = el.querySelector(".mutate-source-select");
    if (mutSrcSelect) {
      mutSrcSelect.addEventListener("change", () => {
        this._mutateSource = mutSrcSelect.value;
        this._mutateBaseUuid = "";
        this._mutateBaseData = null;
        this._mutateSelected.clear();
        this._mutateCustomName = "";
        this.render();
      });
    }

    // Monster selector
    const mutMonSelect = el.querySelector(".mutate-monster-select");
    if (mutMonSelect) {
      mutMonSelect.addEventListener("change", async () => {
        this._mutateBaseUuid = mutMonSelect.value;
        this._mutateSelected.clear();
        this._mutateCustomName = "";
        if (this._mutateBaseUuid) {
          const actor = await fromUuid(this._mutateBaseUuid);
          if (actor) this._mutateBaseData = actor.toObject();
        } else {
          this._mutateBaseData = null;
        }
        this.render();
      });
    }

    // Mutation checkboxes
    on(".mutate-check", "change", (ev) => {
      const id = ev.currentTarget.dataset.mutationId;
      if (ev.currentTarget.checked) {
        this._mutateSelected.add(id);
      } else {
        this._mutateSelected.delete(id);
      }
      this.render();
    });

    // Custom name
    const mutNameInput = el.querySelector(".mutate-custom-name");
    if (mutNameInput) {
      mutNameInput.addEventListener("change", () => {
        this._mutateCustomName = mutNameInput.value.trim();
      });
    }

    // Copy prompt
    el.querySelector(".mutate-copy-prompt")?.addEventListener("click", async () => {
      const textarea = el.querySelector(".mutate-prompt-text");
      if (textarea) {
        await navigator.clipboard.writeText(textarea.value);
        ui.notifications.info("AI art prompt copied to clipboard!");
      }
    });

    // Create Monster
    el.querySelector(".mutate-create-btn")?.addEventListener("click", async () => {
      if (!this._mutateBaseUuid) return;
      try {
        const actor = await createMutatedActor(
          this._mutateBaseUuid,
          [...this._mutateSelected],
          this._mutateCustomName || null
        );
        ui.notifications.info(`Created: ${actor.name}`);
      } catch (e) {
        console.error(`${MODULE_ID} | Mutation failed:`, e);
        ui.notifications.error("Failed to create mutated monster.");
      }
    });

    // Reset
    el.querySelector(".mutate-reset-btn")?.addEventListener("click", () => {
      this._mutateSelected.clear();
      this._mutateCustomName = "";
      this.render();
    });
  }

  // ── Roll methods ────────────────────────────────────────────────────────────

  async _rollFromBuiltTable() {
    const filled = this._slots.map((s, i) => s ? i : null).filter(i => i !== null);
    if (!filled.length) { ui.notifications.warn("No monsters in the table."); return; }

    const roll  = await new Roll(`1${this._dieType}`).evaluate();
    const idx   = roll.total - 1;
    // Pick closest filled slot
    const chosen = this._slots[idx]
      ?? this._slots[filled.reduce((p, c) => Math.abs(c - idx) < Math.abs(p - idx) ? c : p)];

    let count = 1;
    try { count = Math.max(1, (await new Roll(chosen.appearing || "1").evaluate()).total); } catch {}

    this._lastResult = {
      monsterName:   chosen.name,
      monsterUuid:   chosen.uuid,
      count,
      countFormula:  chosen.appearing || "1",
      dieRoll:       roll.total,
      distance:      rollDistance(),
      reaction:      rollReaction(),
    };
    this.render();
  }

  async _rollFromWorldTable(tableId) {
    if (!tableId) return;
    const table = game.tables.get(tableId);
    if (!table) return;

    const draw   = await table.draw({ displayChat: false, resetTable: false });
    const result = draw.results[0];
    if (!result) return;

    // Native format: documentUuid on result, appearing formula in description as [[/r XdY]]
    const uuid = result.documentUuid ?? result.flags?.[MODULE_ID]?.uuid ?? null;

    // Extract appearing formula from description e.g. "<p>[[/r 2d6]]</p>"
    const descText   = result.description ?? "";
    const appearing  = result.flags?.[MODULE_ID]?.appearing
      ?? (descText.match(/\[\[\/r\s+([^\]]+)\]\]/)?.[1]?.trim())
      ?? "1";

    let count = 1;
    try { count = Math.max(1, (await new Roll(appearing).evaluate()).total); } catch {}

    this._lastResult = {
      monsterName:  result.name ?? result.text ?? "Unknown",
      monsterUuid:  uuid,
      count,
      countFormula: appearing,
      distance:     rollDistance(),
      reaction:     rollReaction(),
    };
    this.render();
  }

  async _rollFromRegisteredTable() {
    const uuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    if (!uuid) { ui.notifications.warn("No active encounter table set."); return; }
    const id = uuid.split(".").pop();
    await this._rollFromWorldTable(id);
  }

  // ── Save table ───────────────────────────────────────────────────────────────

  async _saveAsRollTable() {
    const name = this._tableName.trim();
    if (!name) { ui.notifications.warn("Enter a table name."); return; }
    const filled = this._slots.filter(Boolean);
    if (!filled.length) { ui.notifications.warn("Add at least one monster."); return; }

    const existing = game.tables.find(t => t.name === name);
    if (existing) {
      const ok = await confirmDialog({ title: "Overwrite?", content: `Table "${name}" exists. Overwrite?` });
      if (!ok) return;
      await existing.delete();
    }

    const dieSize = parseInt(this._dieType.replace("d", ""));
    const results = [];
    for (let i = 0; i < dieSize; i++) {
      const s = this._slots[i];
      const appearing = s?.appearing?.trim() || "1";

      // Use actor portrait — always a valid image path unlike token textures (which may be wildcards)
      let img = "icons/svg/d20-grey.svg";
      if (s?.uuid) {
        try {
          const actor = await fromUuid(s.uuid);
          const src = actor?.img ?? "";
          if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(src)) img = src;
        } catch {}
      }

      results.push({
        type:         s ? CONST.TABLE_RESULT_TYPES.DOCUMENT : CONST.TABLE_RESULT_TYPES.TEXT,
        weight:       1,
        range:        [i + 1, i + 1],
        name:         s?.name ?? "(Empty)",
        img,
        documentUuid: s?.uuid ?? null,
        description:  s ? `<p>[[/r ${appearing}]]</p>` : "",
        drawn:        false,
        flags:        {},
      });
    }

    const table = await RollTable.create({
      name,
      formula:     `1${this._dieType}`,
      results,
      replacement: true,
      displayRoll: true,
      flags: { [MODULE_ID]: { isEncounterTable: true } },
    });
    if (!table) { ui.notifications.error("Failed to create table — check console for details."); return; }
    ui.notifications.info(`Table "${name}" created.`);

    await game.settings.set(MODULE_ID, "encounterTableUuid", table.uuid);
    this.render();

    const { CrawlBar } = await import("./crawl-bar.mjs");
    CrawlBar.render();
  }

  async _setAsActive(tableId) {
    const table = game.tables.get(tableId);
    if (!table) return;
    await game.settings.set(MODULE_ID, "encounterTableUuid", table.uuid);
    ui.notifications.info(`Active table: "${table.name}"`);
    const { CrawlBar } = await import("./crawl-bar.mjs");
    CrawlBar.render();
    this.render();
  }

  // ── Post & place ──────────────────────────────────────────────────────────────

  async _postToChat() {
    const r = this._lastResult;
    if (!r) return;
    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat encounter-result">
        <h3>${ICONS.encounterChat} Random Encounter</h3>
        <div class="encounter-details">
          <p><strong>Monster:</strong> ${r.monsterName} × ${r.count}</p>
          <p><strong>Distance:</strong> ${r.distance.label} <small>(${r.distance.roll})</small></p>
          <p><strong>Reaction:</strong> ${r.reaction.label} <small>(${r.reaction.roll})</small></p>
        </div>
      </div>`,
      speaker: { alias: "Crawler" },
    });
  }

  async _placeTokens() {
    const r = this._lastResult;
    if (!r?.monsterUuid) { ui.notifications.warn("No actor UUID — cannot place tokens."); return; }

    const actor = await fromUuid(r.monsterUuid);
    if (!actor) { ui.notifications.error("Could not find actor."); return; }

    // If from a compendium, import to world first (or find existing world copy)
    let worldActor = actor;
    if (actor.pack) {
      worldActor = game.actors.find(a => a.flags?.core?.sourceId === r.monsterUuid)
        ?? game.actors.find(a => a.name === actor.name && a.type === "npc")
        ?? await Actor.create(actor.toObject());
    }

    const scene = canvas.scene;
    if (!scene) { ui.notifications.warn("No active scene."); return; }

    const tokenDoc = await worldActor.getTokenDocument();
    const gs = scene.grid.size;
    const cx = Math.round(canvas.stage.pivot.x / gs) * gs;
    const cy = Math.round(canvas.stage.pivot.y / gs) * gs;

    const docs = [];
    for (let i = 0; i < r.count; i++) {
      const td = tokenDoc.toObject();
      td.x = cx + (i % 5) * Math.round(gs * 1.5);
      td.y = cy + Math.floor(i / 5) * Math.round(gs * 1.5);
      td.actorId = worldActor.id;
      delete td._id;
      docs.push(td);
    }
    await scene.createEmbeddedDocuments("Token", docs);
    ui.notifications.info(`Placed ${r.count} × ${worldActor.name}.`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _getRegisteredTableName() {
    const uuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    if (!uuid) return null;
    return game.tables.get(uuid.split(".").pop())?.name ?? null;
  }

  _getGroupedTables() {
    let excludedIds;
    try { excludedIds = new Set(JSON.parse(game.settings.get(MODULE_ID, "excludedTableFolders"))); }
    catch { excludedIds = new Set(); }

    const groups = new Map();
    const unfolderedTables = [];

    for (const table of game.tables) {
      const folder = table.folder;
      if (folder && excludedIds.has(folder.id)) continue;

      const entry = { id: table.id, name: table.name, selected: table.id === this._selectedTableId };
      if (folder) {
        if (!groups.has(folder.id)) groups.set(folder.id, { label: folder.name, tables: [] });
        groups.get(folder.id).tables.push(entry);
      } else {
        unfolderedTables.push(entry);
      }
    }

    for (const g of groups.values()) g.tables.sort((a, b) => a.name.localeCompare(b.name));
    unfolderedTables.sort((a, b) => a.name.localeCompare(b.name));

    const result = [];
    if (unfolderedTables.length) result.push({ label: null, tables: unfolderedTables });
    const sorted = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
    result.push(...sorted);
    return result;
  }

  async _openFolderExclusions() {
    const tableFolders = game.folders.filter(f => f.type === "RollTable");
    if (!tableFolders.length) { ui.notifications.info("No table folders found."); return; }

    let excludedIds;
    try { excludedIds = new Set(JSON.parse(game.settings.get(MODULE_ID, "excludedTableFolders"))); }
    catch { excludedIds = new Set(); }

    const checkboxes = tableFolders
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;">
        <input type="checkbox" name="folder-${f.id}" value="${f.id}" ${excludedIds.has(f.id) ? "checked" : ""} />
        <span>${f.name}</span>
      </label>`).join("");

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Exclude Folders" },
      content: `<div style="font-family:var(--vcb-font);font-size:13px;padding:4px;">
        <p style="color:#7a7060;margin-bottom:8px;">Check folders to <strong>hide</strong> from the encounter table dropdown:</p>
        ${checkboxes}
      </div>`,
      ok: {
        label: "Save",
        icon: "fas fa-save",
        callback: (event, button) => {
          const checked = [...button.form.querySelectorAll('input[type="checkbox"]:checked')];
          return checked.map(cb => cb.value);
        },
      },
      rejectClose: false,
    });

    if (result) {
      await game.settings.set(MODULE_ID, "excludedTableFolders", JSON.stringify(result));
      this.render();
    }
  }

  _getTablePreview(tableId) {
    if (!tableId) return null;
    const table = game.tables.get(tableId);
    if (!table) return null;
    const rows = table.results.contents
      .slice()
      .sort((a, b) => a.range[0] - b.range[0])
      .map(r => {
        const appearing = r.description?.match(/\[\[\/r\s+([^\]]+)\]\]/)?.[1]?.trim()
          ?? r.flags?.[MODULE_ID]?.appearing
          ?? "1";
        return {
          range:     r.range[0] === r.range[1] ? `${r.range[0]}` : `${r.range[0]}–${r.range[1]}`,
          name:      r.name ?? r.text ?? "?",
          appearing,
        };
      });
    return { formula: table.formula, rows };
  }

  // ── Browse NPCs ──────────────────────────────────────────────────────────────

  async _getBrowseNPCs(sourceId) {
    const mapActor = (a, uuid) => ({
      id: a.id || a._id, name: a.name, img: a.img,
      uuid: uuid || a.uuid,
      beingType: a.system?.beingType || "—",
      threatLevel: a.system?.threatLevel ?? 0,
      threatLevelDisplay: a.system?.threatLevelFormatted ?? a.system?.threatLevel ?? "—",
      appearing: a.system?.appearing || a.system?.appearingFormatted || "1",
    });

    if (sourceId === "world") {
      return game.actors.filter(a => a.type === "npc").map(a => mapActor(a, a.uuid));
    }

    if (sourceId === "scene") {
      const seen = new Set();
      return (canvas.tokens?.placeables || [])
        .filter(t => t.actor?.type === "npc")
        .map(t => {
          if (seen.has(t.actor.id)) return null;
          seen.add(t.actor.id);
          return mapActor(t.actor, t.actor.uuid);
        })
        .filter(Boolean);
    }

    // Compendium
    if (!this._browseCache[sourceId]) {
      const pack = game.packs.get(sourceId);
      if (!pack) return [];
      const index = await pack.getIndex({ fields: ["img", "system.beingType", "system.threatLevel", "system.threatLevelFormatted", "system.appearing"] });
      this._browseCache[sourceId] = index.map(entry => ({
        id: entry._id, name: entry.name,
        img: entry.img || "icons/svg/mystery-man.svg",
        uuid: `Compendium.${sourceId}.Actor.${entry._id}`,
        beingType: entry.system?.beingType || "—",
        threatLevel: entry.system?.threatLevel ?? 0,
        threatLevelDisplay: entry.system?.threatLevelFormatted ?? entry.system?.threatLevel ?? "—",
        appearing: entry.system?.appearing || "1",
      }));
    }
    return [...this._browseCache[sourceId]];
  }

}
