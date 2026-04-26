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
import { MonsterCreator } from "./monster-creator/monster-creator-app.mjs";
import { calculateHP, calculateDPR } from "./monster-mutator.mjs";
import { SessionRecap } from "./session-recap.mjs";
import { CrawlState } from "./crawl-state.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a die formula like "d6" or "2d6" into { count, faces, min, max,
 *  slotCount }. For `2d6` the reachable sums are 2..12 so slotCount is 11
 *  and the first slot's displayed number is min (2), not 1.
 *  Fallback is d6 on any malformed input so callers always get a table. */
function parseDieFormula(formula) {
  const m = String(formula ?? "").match(/^(\d*)d(\d+)$/i);
  if (!m) return { count: 1, faces: 6, min: 1, max: 6, slotCount: 6 };
  const count = Math.max(1, Number(m[1] || "1"));
  const faces = Math.max(2, Number(m[2]));
  return { count, faces, min: count, max: count * faces, slotCount: count * faces - count + 1 };
}

function rollDistance() {
  const v = Math.floor(Math.random() * 6) + 1;
  return {
    roll: v,
    label: v === 1 ? "Close (within 10ft)"
         : v <= 4  ? "Near (30–60ft)"
         :           "Far (100ft+, if possible)",
  };
}

function rollReaction() {
  const v = Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
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

    // Session Recap log. Captures every check, not just hits, so the
    // recap can show hit rate, average, and escalation across cycles.
    // Clock label is best-effort — CrawlState.clockFilled reflects
    // whatever the clock reads at roll time (may or may not have ticked
    // yet this scene, depending on GM workflow). Six-segment clock is
    // hard-coded in crawl-clock.mjs (CRAWL_CLOCK_SEGMENTS).
    if (game.user.isGM) {
      const filled = CrawlState?.clockFilled ?? null;
      SessionRecap.logEncounterCheck({
        roll: roll.total,
        threshold,
        hit,
        clockLabel: filled !== null ? `${filled}/6` : null,
      }).catch(err => console.warn(`${MODULE_ID} | logEncounterCheck failed:`, err));
    }

    // Auto-open encounter roller and roll the active table on hit
    if (hit) {
      // Pause the game (if enabled) so the GM can prep before the encounter
      // materializes. Only GMs have permission to pause, so guard the call.
      if (game.user.isGM && game.settings.get(MODULE_ID, "pauseOnEncounter") && !game.paused) {
        game.togglePause(true, { broadcast: true });
      }
      this.rollInstantEncounter();
    }
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

      const allNpcs = await this._getBrowseNPCs(this._browseSource);

      // Collect types before any filters are applied
      ctx.browseBeingTypes = [...new Set(allNpcs.map(n => n.beingType).filter(t => t && t !== "—"))].sort();

      // Type filter
      let npcs = allNpcs;
      if (this._browseType) npcs = npcs.filter(n => n.beingType === this._browseType);

      // TL range
      const tlMin = this._browseTlMin !== "" ? parseFloat(this._browseTlMin) : null;
      const tlMax = this._browseTlMax !== "" ? parseFloat(this._browseTlMax) : null;
      if (tlMin !== null) npcs = npcs.filter(n => n.threatLevel >= tlMin);
      if (tlMax !== null) npcs = npcs.filter(n => n.threatLevel <= tlMax);

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

    // ── Monster Creator tab ──
    // No context data to build here — the tab's <div id="…">  empty placeholder
    // is filled in `_onRender` by calling MonsterCreator.mountPanel, which
    // renders the full Creator UI into the placeholder.

    return ctx;
  }

  getData() {
    const { min: dieMin, slotCount } = parseDieFormula(this._dieType);
    while (this._slots.length < slotCount) this._slots.push(null);
    while (this._slots.length > slotCount) this._slots.pop();

    return {
      isBuildMode: this._mode === "build",
      isBrowseMode: this._mode === "browse",
      isExistingMode: this._mode === "existing",
      isMonsterCreatorMode: this._mode === "monsterCreator",
      dieTypes: ["d4","d6","2d6","d8","2d8","d10","d12"].map(d => ({ value: d, selected: d === this._dieType })),
      tableName: this._tableName,
      slots: this._slots.map((s, i) => ({
        index:     i,
        number:    i + dieMin, // starts at 1 for d6, at 2 for 2d6, etc.
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

    // Abort previous listeners to prevent accumulation on re-render
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    // Helper — querySelector with optional warn
    const $  = (sel)      => el.querySelector(sel);
    const $$ = (sel)      => [...el.querySelectorAll(sel)];
    const on = (sel, evt, fn) => $$( sel).forEach(n => n.addEventListener(evt, fn, { signal }));

    // Tabs
    on(".tab-btn", "click", ev => {
      const newMode = ev.currentTarget.dataset.mode;
      // Switching AWAY from the Monster Creator tab tears the panel down so
      // its DOM doesn't linger (and its handler subscriptions don't pile up
      // across re-mounts).
      if (this._mode === "monsterCreator" && newMode !== "monsterCreator") {
        MonsterCreator.unmountPanel();
      }
      this._mode = newMode;
      this.render();
    });

    // Die select — update _dieType then re-render to resize slots
    const dieSelect = $(".die-select");
    if (dieSelect) {
      dieSelect.value = this._dieType;
      dieSelect.addEventListener("change", ev => {
        this._dieType = ev.currentTarget.value;
        this.render();
      }, { signal });
    }

    // Table name — persist on input (not just change, so it survives re-render)
    const nameInput = $(".table-name-input");
    if (nameInput) {
      nameInput.addEventListener("input", ev => { this._tableName = ev.currentTarget.value; }, { signal });
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
      }, { signal });
    }

    // Action buttons
    const btn = (sel, fn) => { const b = $(sel); if (b) b.addEventListener("click", fn, { signal }); };
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
      if (this._lastResult?.isMultiGroup && this._lastResult.groups?.length) {
        await EncounterRollerApp._evaluateGroupCounts(this._lastResult.groups);
        this._lastResult.count = this._lastResult.groups.reduce((sum, g) => sum + g.count, 0);
        this.render();
      } else if (this._lastResult?.countFormula) {
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
      slotEl.addEventListener("dragover", ev => ev.preventDefault(), { signal });
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
      }, { signal });
    });

    // ── Browse tab events ──
    $(".browse-source-filter")?.addEventListener("change", ev => {
      this._browseSource = ev.currentTarget.value;
      this._browseType = "";
      this.render();
    }, { signal });

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
      }, { signal });
    }

    $(".browse-type-filter")?.addEventListener("change", ev => {
      this._browseType = ev.currentTarget.value;
      this.render();
    }, { signal });

    $(".browse-tl-min")?.addEventListener("change", ev => {
      this._browseTlMin = ev.currentTarget.value;
      this.render();
    }, { signal });
    $(".browse-tl-max")?.addEventListener("change", ev => {
      this._browseTlMax = ev.currentTarget.value;
      this.render();
    }, { signal });

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
      }, { signal });
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
      if (nameCell) nameCell.addEventListener("dblclick", handler, { signal });
      if (imgCell) imgCell.addEventListener("dblclick", handler, { signal });
    });

    // ── Monster Creator tab ──
    // When this tab is active, mount the full Monster Creator UI into the
    // placeholder <div>. The Creator lives as its own instance (panel mode)
    // so its state persists across Roller re-renders as long as we don't
    // remount unnecessarily. Unmount is handled by the tab switch below.
    if (this._mode === "monsterCreator") {
      const container = el.querySelector("#vagabond-crawler-monster-creator");
      if (container && !container.dataset.mounted) {
        container.dataset.mounted = "1";
        MonsterCreator.mountPanel(container);
      }
    }
  }

  // ── Roll methods ────────────────────────────────────────────────────────────

  async _rollFromBuiltTable() {
    const filled = this._slots.map((s, i) => s ? i : null).filter(i => i !== null);
    if (!filled.length) { ui.notifications.warn("No monsters in the table."); return; }

    const { min } = parseDieFormula(this._dieType);
    const roll  = await new Roll(this._dieType).evaluate();
    const idx   = roll.total - min; // slot 0 corresponds to the minimum possible roll
    // Pick closest filled slot
    const chosen = this._slots[idx]
      ?? this._slots[filled.reduce((p, c) => Math.abs(c - idx) < Math.abs(p - idx) ? c : p)];

    let count = 1;
    try { count = Math.max(1, (await new Roll(chosen.appearing || "1").evaluate()).total); }
    catch (e) { console.warn(`${MODULE_ID} | Invalid appearing formula for ${chosen.name}:`, e); }

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
    await this._rollTable(table);
  }

  async _rollTable(table) {
    if (!table) return;
    const draw   = await table.draw({ displayChat: false, resetTable: false });
    const result = draw.results[0];
    if (!result) return;

    // Native format: documentUuid on result, appearing formula in description as [[XdY]]
    const uuid = result.documentUuid ?? result.flags?.[MODULE_ID]?.uuid ?? null;
    const descText = result.description ?? "";

    // Check for multi-group result (no documentUuid, but @UUID refs in description)
    const multiGroups = !uuid ? EncounterRollerApp._parseMultiGroupDescription(descText) : null;

    if (multiGroups) {
      // Multi-group encounter
      await EncounterRollerApp._evaluateGroupCounts(multiGroups);
      const totalCount = multiGroups.reduce((sum, g) => sum + g.count, 0);

      this._lastResult = {
        monsterName:   multiGroups.map(g => g.name).join(" + "),
        monsterUuid:   null,
        count:         totalCount,
        countFormula:  null,
        isMultiGroup:  true,
        groups:        multiGroups,
        distance:      rollDistance(),
        reaction:      rollReaction(),
      };
    } else {
      // Single-monster encounter (existing flow)
      const appearing = result.flags?.[MODULE_ID]?.appearing
        ?? (descText.match(/\[\[(?:\/r\s+)?([^\]]+)\]\]/)?.[1]?.trim())
        ?? "1";

      let count = 1;
      try { count = Math.max(1, (await new Roll(appearing).evaluate()).total); }
      catch (e) { console.warn(`${MODULE_ID} | Invalid appearing formula in table result:`, e); }

      this._lastResult = {
        monsterName:  result.name ?? result.text ?? "Unknown",
        monsterUuid:  uuid,
        count,
        countFormula: appearing,
        distance:     rollDistance(),
        reaction:     rollReaction(),
      };
    }
    this.render();
  }

  async _rollFromRegisteredTable() {
    const uuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    if (!uuid) { ui.notifications.warn("No active encounter table set."); return; }
    const table = await fromUuid(uuid);
    if (!table) { ui.notifications.warn("Active encounter table not found."); return; }
    await this._rollTable(table);
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
    }

    const { min: dieMin, slotCount } = parseDieFormula(this._dieType);
    const results = [];
    for (let i = 0; i < slotCount; i++) {
      const s = this._slots[i];
      const appearing = s?.appearing?.trim() || "1";

      // Use actor portrait — always a valid image path unlike token textures (which may be wildcards)
      let img = "icons/svg/d20-grey.svg";
      if (s?.uuid) {
        try {
          const actor = await fromUuid(s.uuid);
          const src = actor?.img ?? "";
          if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(src)) img = src;
        } catch (e) { console.warn(`${MODULE_ID} | Failed to resolve actor UUID ${s.uuid}:`, e); }
      }

      const slotRoll = i + dieMin; // 2d6 → slots are 2..12
      results.push({
        type:         s ? CONST.TABLE_RESULT_TYPES.DOCUMENT : CONST.TABLE_RESULT_TYPES.TEXT,
        weight:       1,
        range:        [slotRoll, slotRoll],
        name:         s?.name ?? "(Empty)",
        img,
        documentUuid: s?.uuid ?? null,
        description:  s ? `<p>[[${appearing}]]</p>` : "",
        drawn:        false,
        flags:        {},
      });
    }

    let table;
    if (existing) {
      // Update in-place to avoid losing the table if creation fails
      await existing.deleteEmbeddedDocuments("TableResult", existing.results.map(r => r.id));
      await existing.update({
        formula: this._dieType,
        flags: { [MODULE_ID]: { isEncounterTable: true } },
      });
      await existing.createEmbeddedDocuments("TableResult", results);
      table = existing;
    } else {
      table = await RollTable.create({
        name,
        formula:     `1${this._dieType}`,
        results,
        replacement: true,
        displayRoll: true,
        flags: { [MODULE_ID]: { isEncounterTable: true } },
      });
    }
    if (!table) { ui.notifications.error("Failed to create table — check console for details."); return; }
    ui.notifications.info(`Table "${name}" ${existing ? "updated" : "created"}.`);

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

    let monsterLines;
    if (r.isMultiGroup && r.groups?.length) {
      monsterLines = `<p><strong>Monsters:</strong></p><ul style="margin:2px 0 6px 16px; padding:0; list-style:disc;">`
        + r.groups.map(g => `<li>${g.name} × ${g.count}</li>`).join("")
        + `</ul>`;
    } else {
      monsterLines = `<p><strong>Monster:</strong> ${r.monsterName} × ${r.count}</p>`;
    }

    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat encounter-result">
        <h3>${ICONS.encounterChat} Random Encounter</h3>
        <div class="encounter-details">
          ${monsterLines}
          <p><strong>Distance:</strong> ${r.distance.label} <small>(${r.distance.roll})</small></p>
          <p><strong>Reaction:</strong> ${r.reaction.label} <small>(${r.reaction.roll})</small></p>
        </div>
      </div>`,
      speaker: { alias: "Crawler" },
    });
  }

  async _placeTokens() {
    const r = this._lastResult;

    // Multi-group placement
    if (r?.isMultiGroup && r.groups?.length) {
      const scene = canvas.scene;
      if (!scene) { ui.notifications.warn("No active scene."); return; }

      const gs = scene.grid.size;
      const cx = Math.round(canvas.stage.pivot.x / gs) * gs;
      const cy = Math.round(canvas.stage.pivot.y / gs) * gs;
      const docs = [];
      let tokenIdx = 0;

      for (const group of r.groups) {
        if (!group.uuid) continue;
        const actor = await fromUuid(group.uuid);
        if (!actor) { ui.notifications.warn(`Could not find actor: ${group.name}`); continue; }

        let worldActor = actor;
        if (actor.pack) {
          worldActor = game.actors.find(a => a.flags?.core?.sourceId === group.uuid)
            ?? game.actors.find(a => a.name === actor.name && a.type === "npc")
            ?? await Actor.create(actor.toObject());
        }

        const tokenDoc = await worldActor.getTokenDocument();
        for (let i = 0; i < group.count; i++) {
          const td = tokenDoc.toObject();
          td.x = cx + (tokenIdx % 5) * Math.round(gs * 1.5);
          td.y = cy + Math.floor(tokenIdx / 5) * Math.round(gs * 1.5);
          td.actorId = worldActor.id;
          delete td._id;
          docs.push(td);
          tokenIdx++;
        }
      }

      if (docs.length === 0) { ui.notifications.warn("No valid actors to place."); return; }
      await scene.createEmbeddedDocuments("Token", docs);
      ui.notifications.info(`Placed ${docs.length} tokens (${r.groups.map(g => `${g.count} × ${g.name}`).join(", ")}).`);
      return;
    }

    // Single-monster placement (existing flow)
    if (!r?.monsterUuid) { ui.notifications.warn("No actor UUID — cannot place tokens."); return; }

    const actor = await fromUuid(r.monsterUuid);
    if (!actor) { ui.notifications.error("Could not find actor."); return; }

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

  /**
   * Parse a description containing multiple @UUID references into monster groups.
   * Format: [[formula]]@UUID[Actor.id]{Name}  (formula is optional, defaults to "1")
   * @param {string} descText - The raw description HTML
   * @returns {Array<{uuid: string, name: string, formula: string}>|null} Parsed groups or null
   */
  static _parseMultiGroupDescription(descText) {
    if (!descText?.includes("@UUID")) return null;
    const re = /(?:\[\[(?:\/r\s+)?([^\]]+)\]\])?\s*@UUID\[([^\]]+)\]\{([^}]+)\}/g;
    const groups = [];
    let m;
    while ((m = re.exec(descText)) !== null) {
      groups.push({ uuid: m[2], name: m[3], formula: m[1]?.trim() || "1" });
    }
    return groups.length > 0 ? groups : null;
  }

  /**
   * Evaluate appearing formulas for each group and attach count.
   * @param {Array<{uuid: string, name: string, formula: string}>} groups
   * @returns {Promise<Array<{uuid: string, name: string, formula: string, count: number}>>}
   */
  static async _evaluateGroupCounts(groups) {
    for (const g of groups) {
      try { g.count = Math.max(1, (await new Roll(g.formula).evaluate()).total); }
      catch (e) { console.warn(`${MODULE_ID} | Invalid count formula "${g.formula}":`, e); g.count = 1; }
    }
    return groups;
  }

  _getRegisteredTableName() {
    const uuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    if (!uuid) return null;
    return fromUuidSync(uuid)?.name ?? null;
  }

  _getGroupedTables() {
    let excludedIds;
    try { excludedIds = new Set(JSON.parse(game.settings.get(MODULE_ID, "excludedTableFolders"))); }
    catch (e) { console.warn(`${MODULE_ID} | Failed to parse excludedTableFolders:`, e); excludedIds = new Set(); }

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
    catch (e) { console.warn(`${MODULE_ID} | Failed to parse excludedTableFolders:`, e); excludedIds = new Set(); }

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
        const appearing = r.description?.match(/\[\[(?:\/r\s+)?([^\]]+)\]\]/)?.[1]?.trim()
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
    const mapActor = (a, uuid) => {
      const s = a.system ?? {};
      const die = (
        a.flags?.["vagabond-crawler"]?.hitDie
        ?? (game.settings.get("vagabond-crawler", "bestiaryHitDieFallback") ? "fromSize" : "d8")
      );
      const rolled = (
        a.flags?.["vagabond-crawler"]?.rollHpOnSpawn === true
        || (
          game.settings.get("vagabond-crawler", "bestiaryHitDieFallback")
          && !a.flags?.["vagabond-crawler"]?.hitDie
        )
      );
      const hp = calculateHP(s.hd ?? 1, s.size ?? "medium", die);
      return {
        id: a.id || a._id, name: a.name, img: a.img,
        uuid: uuid || a.uuid,
        beingType: s.beingType || "—",
        threatLevel: s.threatLevel ?? 0,
        threatLevelDisplay: s.threatLevelFormatted ?? s.threatLevel ?? "—",
        appearing: s.appearing || s.appearingFormatted || "1",
        hp,
        hpDisplay: rolled ? `${hp} (rolled)` : String(hp),
        dpr: calculateDPR(s.actions ?? []),
      };
    };

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

    // Compendium. We fetch full documents (not just the index) because HP
    // needs size + hd and DPR needs the actions array — neither lives in the
    // index. First load is ~2-3s for 300 monsters but we cache so it's one-time.
    if (!this._browseCache[sourceId]) {
      const pack = game.packs.get(sourceId);
      if (!pack) return [];
      const docs = await pack.getDocuments();
      this._browseCache[sourceId] = docs.map((d) => {
        const die = (
          d.flags?.["vagabond-crawler"]?.hitDie
          ?? (game.settings.get("vagabond-crawler", "bestiaryHitDieFallback") ? "fromSize" : "d8")
        );
        const rolled = (
          d.flags?.["vagabond-crawler"]?.rollHpOnSpawn === true
          || (
            game.settings.get("vagabond-crawler", "bestiaryHitDieFallback")
            && !d.flags?.["vagabond-crawler"]?.hitDie
          )
        );
        const hp = calculateHP(d.system?.hd ?? 1, d.system?.size ?? "medium", die);
        return {
          id: d.id, name: d.name,
          img: d.img || "icons/svg/mystery-man.svg",
          uuid: d.uuid,
          beingType: d.system?.beingType || "—",
          threatLevel: d.system?.threatLevel ?? 0,
          threatLevelDisplay: d.system?.threatLevelFormatted ?? d.system?.threatLevel ?? "—",
          appearing: d.system?.appearing || "1",
          hp,
          hpDisplay: rolled ? `${hp} (rolled)` : String(hp),
          dpr: calculateDPR(d.system?.actions ?? []),
        };
      });
    }
    return [...this._browseCache[sourceId]];
  }

}
