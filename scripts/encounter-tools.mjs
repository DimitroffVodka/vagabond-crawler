/**
 * Vagabond Crawler — Encounter Tools
 *
 * Encounter Check: d6 roll, on 1 post to GM chat.
 * Encounter Roller: full Application window matching vagabond-extras UX:
 *   - Build Table tab: drag NPCs onto slots, save as RollTable
 *   - Roll Tables tab: pick any world RollTable and roll it
 *   - Result panel: monster × count, distance, reaction with reroll buttons
 *   - Post to Chat / Place Tokens actions
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { confirmDialog } from "./dialog-helpers.mjs";

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
    const roll   = await new Roll("1d6").evaluate();
    const hit    = roll.total === 1;
    const gmOnly = game.settings.get(MODULE_ID, "encounterRollGMOnly");

    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat ${hit ? "encounter-hit" : "encounter-miss"}">
        <h3><i class="fas ${hit ? "fa-dragon" : "fa-dice-d6"}"></i>
          ${hit ? "Encounter!" : "No Encounter"}
        </h3>
        <p>Rolled <strong>${roll.total}</strong> on d6 —
          ${hit ? "something stirs in the dark." : "the dungeon is quiet… for now."}
        </p>
        ${hit ? `<p><em>Use the Encounter! button to roll the table.</em></p>` : ""}
      </div>`,
      speaker: { alias: "Crawler" },
      rolls:   [roll],
      whisper: gmOnly ? game.users.filter(u => u.isGM).map(u => u.id) : [],
    });
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
  }

  async _prepareContext() {
    return this.getData();
  }

  getData() {
    const dieSize = parseInt(this._dieType.replace("d", ""));
    while (this._slots.length < dieSize)  this._slots.push(null);
    while (this._slots.length > dieSize)  this._slots.pop();

    return {
      isBuildMode: this._mode === "build",
      dieTypes: ["d4","d6","d8","d10","d12"].map(d => ({ value: d, selected: d === this._dieType })),
      tableName: this._tableName,
      slots: this._slots.map((s, i) => ({
        index:     i,
        number:    i + 1,
        name:      s?.name      ?? "",
        appearing: s?.appearing ?? "",
        uuid:      s?.uuid      ?? "",
      })),
      worldTables:    game.tables.map(t => ({ id: t.id, name: t.name, selected: t.id === this._selectedTableId })),
      hasWorldTables: game.tables.size > 0,
      selectedTablePreview: this._getTablePreview(this._selectedTableId),
      lastResult:     this._lastResult,
      registeredTable: this._getRegisteredTableName(),
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
        <h3><i class="fas fa-dragon"></i> Random Encounter</h3>
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

}
