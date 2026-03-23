/**
 * Vagabond Crawler — Relic Forge
 *
 * GM tool to upgrade equipment items into magical relics by selecting
 * powers, computing costs, and generating Active Effects.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

/* -------------------------------------------- */
/*  Relic Powers Database                       */
/* -------------------------------------------- */

/**
 * Each power definition:
 *   category: string — grouping for UI
 *   cost: number — gold cost to add this power
 *   nameFormat: { position: "prefix"|"suffix"|"wrap", text: string }
 *     — how this power affects the relic's name. {input} is replaced by user input.
 *   effects: Array<{key, mode, value}> — Active Effect changes. {input} replaced by user input.
 *   requiresInput: boolean — if true, shows an input field in the UI
 *   inputType: "text"|"select" — type of input (default "text")
 *   inputOptions: string[] — options for select input
 *   inputLabel: string — label for the input field
 *   description: string — tooltip description
 */
const RELIC_POWERS = {
  // ── Weapon Enhancement ─────────────────────────
  "Keen": {
    category: "Weapon Enhancement",
    cost: 200,
    nameFormat: { position: "prefix", text: "Keen" },
    effects: [
      { key: "system.properties", mode: 2, value: "keen" },
    ],
    description: "This weapon's crit range is expanded by 1.",
  },
  "Vicious": {
    category: "Weapon Enhancement",
    cost: 150,
    nameFormat: { position: "prefix", text: "Vicious" },
    effects: [
      { key: "system.damageBonus", mode: 2, value: "2" },
    ],
    description: "+2 bonus to damage rolls with this weapon.",
  },
  "Thundering": {
    category: "Weapon Enhancement",
    cost: 300,
    nameFormat: { position: "prefix", text: "Thundering" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.thundering", mode: 5, value: "true" },
    ],
    description: "On crit, deal an extra 1d8 thunder damage.",
  },
  "Flaming": {
    category: "Weapon Enhancement",
    cost: 250,
    nameFormat: { position: "prefix", text: "Flaming" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.flaming", mode: 5, value: "true" },
    ],
    description: "This weapon deals an extra 1d6 fire damage on hit.",
  },
  "Frost": {
    category: "Weapon Enhancement",
    cost: 250,
    nameFormat: { position: "prefix", text: "Frost" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.frost", mode: 5, value: "true" },
    ],
    description: "This weapon deals an extra 1d6 cold damage on hit.",
  },

  // ── Bane ───────────────────────────────────────
  "Bane": {
    category: "Bane",
    cost: 200,
    nameFormat: { position: "suffix", text: "of {input} Bane" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.bane", mode: 5, value: "{input}" },
    ],
    requiresInput: true,
    inputType: "select",
    inputOptions: ["Undead", "Beast", "Dragon", "Fey", "Fiend", "Giant", "Humanoid", "Monstrosity", "Ooze", "Plant", "Construct", "Elemental", "Aberration", "Celestial"],
    inputLabel: "Creature Type",
    description: "Deal extra damage dice against the chosen creature type.",
  },

  // ── Protection ─────────────────────────────────
  "Protection": {
    category: "Protection",
    cost: 200,
    nameFormat: { position: "suffix", text: "of Protection from {input}" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.protection", mode: 5, value: "{input}" },
    ],
    requiresInput: true,
    inputType: "select",
    inputOptions: ["Undead", "Beast", "Dragon", "Fey", "Fiend", "Giant", "Humanoid", "Monstrosity"],
    inputLabel: "Protected From",
    description: "Favor on saves against the chosen creature type.",
  },

  // ── Resistance ─────────────────────────────────
  "Resistance": {
    category: "Resistance",
    cost: 300,
    nameFormat: { position: "suffix", text: "of {input} Resistance" },
    effects: [
      { key: "system.resistances", mode: 2, value: "{input}" },
    ],
    requiresInput: true,
    inputType: "select",
    inputOptions: ["Fire", "Cold", "Lightning", "Thunder", "Poison", "Necrotic", "Radiant", "Psychic", "Acid"],
    inputLabel: "Damage Type",
    description: "Resistance to the chosen damage type (half damage).",
  },

  // ── Fortification ──────────────────────────────
  "Fortified": {
    category: "Fortification",
    cost: 300,
    nameFormat: { position: "prefix", text: "Fortified" },
    effects: [
      { key: "system.armorBonus", mode: 2, value: "1" },
    ],
    description: "+1 Armor bonus while this item is equipped.",
  },
  "Warding": {
    category: "Fortification",
    cost: 250,
    nameFormat: { position: "prefix", text: "Warding" },
    effects: [
      { key: "system.universalCheckBonus", mode: 2, value: "1" },
    ],
    description: "+1 bonus to all saves while this item is equipped.",
  },

  // ── Enchanted ──────────────────────────────────
  "Lucky": {
    category: "Enchanted",
    cost: 400,
    nameFormat: { position: "prefix", text: "Lucky" },
    effects: [
      { key: "system.bonusLuck", mode: 2, value: "1" },
    ],
    description: "+1 Luck while this item is equipped.",
  },
  "Swift": {
    category: "Enchanted",
    cost: 200,
    nameFormat: { position: "prefix", text: "Swift" },
    effects: [
      { key: "system.speed.bonus", mode: 2, value: "10" },
    ],
    description: "+10 Speed while this item is equipped.",
  },

  // ── Miscellaneous ──────────────────────────────
  "Lifesteal": {
    category: "Miscellaneous",
    cost: 500,
    nameFormat: { position: "prefix", text: "Vampiric" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.lifesteal", mode: 5, value: "true" },
    ],
    description: "On kill, heal 1d6 HP.",
  },
  "Returning": {
    category: "Miscellaneous",
    cost: 100,
    nameFormat: { position: "prefix", text: "Returning" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.returning", mode: 5, value: "true" },
    ],
    description: "This thrown weapon returns to your hand after being thrown.",
  },
  "Glamoured": {
    category: "Miscellaneous",
    cost: 100,
    nameFormat: { position: "prefix", text: "Glamoured" },
    effects: [
      { key: "flags.vagabond-crawler.relicPower.glamoured", mode: 5, value: "true" },
    ],
    description: "This item can change its appearance at will.",
  },
};

/**
 * Metal cost multipliers (from system config).
 */
const METAL_MULTIPLIERS = {
  none: 1,
  common: 1,
  adamant: 50,
  coldIron: 20,
  silver: 10,
  mythral: 50,
  orichalcum: 50,
  magical: 1, // Magical metal has no extra multiplier
};

/* -------------------------------------------- */
/*  Relic Forge Singleton                       */
/* -------------------------------------------- */

export const RelicForge = {
  _app: null,

  registerSettings() {
    game.settings.register(MODULE_ID, "relicForgeEnabled", {
      name: "Relic Forge",
      hint: "Enable the Relic Forge tool for upgrading equipment into magical relics.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
  },

  init() {
    console.log(`${MODULE_ID} | Relic Forge initialized.`);
  },

  /**
   * Open the Relic Forge dialog.
   * @param {Item|null} item — Optional item to pre-load into the forge.
   */
  open(item = null) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can use the Relic Forge.");
      return;
    }
    if (!this._app) {
      this._app = new RelicForgeApp();
    }
    if (item) {
      this._app.loadItem(item);
    }
    this._app.render(true);
  },
};

/* -------------------------------------------- */
/*  Relic Forge ApplicationV2                   */
/* -------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class RelicForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "vagabond-crawler-relic-forge",
    window:   { title: "Relic Forge", resizable: true },
    position: { width: 700, height: "auto" },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/relic-forge.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._item = null;
    this._itemData = null;
    this._selectedPowers = new Map(); // powerName → { userInput: string|null }
    this._categoryFilter = null;
  }

  /* ---- Data for template ---- */

  async _prepareContext() {
    return this.getData();
  }

  getData() {
    // Group powers by category
    const categoryMap = {};
    for (const [name, power] of Object.entries(RELIC_POWERS)) {
      if (!categoryMap[power.category]) categoryMap[power.category] = [];
      categoryMap[power.category].push(name);
    }

    const categories = Object.keys(categoryMap).map(name => ({
      name,
      active: this._categoryFilter === name,
    }));

    // Visible powers (filtered by category)
    const visibleEntries = this._categoryFilter
      ? (categoryMap[this._categoryFilter] || [])
      : Object.keys(RELIC_POWERS);

    const powers = visibleEntries.map(name => {
      const power = RELIC_POWERS[name];
      const selected = this._selectedPowers.has(name);
      const userInput = this._selectedPowers.get(name)?.userInput || "";
      return {
        name,
        cost: power.cost,
        description: power.description,
        selected,
        showInput: power.requiresInput && selected,
        isSelect: power.inputType === "select",
        inputLabel: power.inputLabel || "Value",
        inputOptions: power.inputOptions || [],
        userInput,
      };
    });

    // Compute summary
    let hasPowers = false, relicName = "", baseCostDisplay = "", powerCost = 0, totalDisplay = "";
    if (this._item && this._selectedPowers.size > 0) {
      hasPowers = true;
      const costObj = this._itemData.system?.cost ?? { gold: 0, silver: 0, copper: 0 };
      const baseGold = costObj.gold ?? 0;
      const baseSilver = costObj.silver ?? 0;
      const nameParts = { prefix: [], base: this._itemData.name, suffix: [] };

      for (const [name, data] of this._selectedPowers) {
        const power = RELIC_POWERS[name];
        if (!power) continue;
        powerCost += power.cost;
        const input = data.userInput || "";
        const formatted = power.nameFormat.text.replace("{input}", input);
        if (power.nameFormat.position === "prefix") nameParts.prefix.push(formatted);
        else if (power.nameFormat.position === "suffix") nameParts.suffix.push(formatted);
      }

      relicName = [...nameParts.prefix, nameParts.base, ...nameParts.suffix].join(" ");
      baseCostDisplay = baseSilver > 0 ? `${baseGold}g ${baseSilver}s` : `${baseGold}g`;
      const totalGold = baseGold + powerCost;
      totalDisplay = baseSilver > 0 ? `${totalGold}g ${baseSilver}s` : `${totalGold}g`;
    }

    return {
      item: this._item ? {
        img: this._itemData.img || "icons/svg/item-bag.svg",
        name: this._itemData.name,
        metal: this._itemData.system?.metal || "none",
        type: this._itemData.system?.equipmentType || "gear",
      } : null,
      categoryFilter: this._categoryFilter,
      categories,
      powers,
      hasPowers,
      relicName,
      baseCostDisplay,
      powerCost,
      totalDisplay,
    };
  }

  /* ---- Event binding ---- */

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const $$ = (sel) => [...el.querySelectorAll(sel)];
    const on = (sel, evt, fn) => $$(sel).forEach(n => n.addEventListener(evt, fn));

    // Drop zone
    const dropZone = el.querySelector(".forge-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", ev => { ev.preventDefault(); dropZone.classList.add("drag-over"); });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
      dropZone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        dropZone.classList.remove("drag-over");
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Item") return;
        const item = await fromUuid(data.uuid);
        if (!item || item.type !== "equipment") {
          ui.notifications.warn("Only equipment items can be forged into relics.");
          return;
        }
        this.loadItem(item);
        this.render();
      });
    }

    // Clear item
    el.querySelector(".forge-clear-item")?.addEventListener("click", () => {
      this._item = null;
      this._itemData = null;
      this._selectedPowers.clear();
      this._categoryFilter = null;
      this.render();
    });

    // Category tabs
    on(".forge-cat-tab", "click", ev => {
      this._categoryFilter = ev.currentTarget.dataset.category || null;
      this.render();
    });

    // Power checkboxes
    on(".forge-power-check", "change", ev => {
      const name = ev.currentTarget.dataset.power;
      if (ev.currentTarget.checked) {
        this._selectedPowers.set(name, { userInput: "" });
      } else {
        this._selectedPowers.delete(name);
      }
      this.render();
    });

    // Set select values (can't do equality check in Handlebars easily)
    el.querySelectorAll("select.forge-power-input").forEach(sel => {
      const name = sel.dataset.power;
      const entry = this._selectedPowers.get(name);
      if (entry?.userInput) sel.value = entry.userInput;
    });

    // Power inputs
    on(".forge-power-input", "change", ev => {
      const name = ev.currentTarget.dataset.power;
      const entry = this._selectedPowers.get(name);
      if (entry) entry.userInput = ev.currentTarget.value;
      this.render();
    });

    // Forge button
    el.querySelector(".forge-btn")?.addEventListener("click", () => this._forgeRelic());
  }

  loadItem(item) {
    this._item = item;
    this._itemData = item.toObject();
    this._selectedPowers.clear();
    this._categoryFilter = null;
  }

  /**
   * Forge the relic: update the item with selected powers.
   */
  async _forgeRelic() {
    if (!this._item) return;

    const item = this._item;
    const updates = {};
    const effects = [];
    const nameParts = { prefix: [], base: this._itemData.name, suffix: [] };
    let powerCost = 0;

    // Note: system schema restricts metal choices and equipmentType,
    // so we track "forged relic" status via flags instead of changing those fields.

    // Build effects and name from selected powers
    const userInputs = {};
    for (const [name, data] of this._selectedPowers) {
      const power = RELIC_POWERS[name];
      if (!power) continue;
      powerCost += power.cost;
      userInputs[name] = data.userInput || "";

      const input = data.userInput || "";
      const formatted = power.nameFormat.text.replace("{input}", input);
      if (power.nameFormat.position === "prefix") nameParts.prefix.push(formatted);
      else if (power.nameFormat.position === "suffix") nameParts.suffix.push(formatted);

      const changes = power.effects.map(e => ({
        key: e.key.replace("{input}", input),
        mode: e.mode,
        value: String(e.value).replace("{input}", input),
      }));
      effects.push({
        name: `Relic: ${name}${input ? ` (${input})` : ""}`,
        icon: item.img || "icons/svg/item-bag.svg",
        changes,
        disabled: false,
        transfer: true,
        flags: { [MODULE_ID]: { relicPower: name, managed: true } },
      });
    }

    const relicName = [...nameParts.prefix, nameParts.base, ...nameParts.suffix].join(" ");
    updates.name = relicName;
    updates[`flags.${MODULE_ID}.relicForge`] = {
      forged: true,
      powers: [...this._selectedPowers.keys()],
      userInputs,
      powerCost,
      forgedAt: Date.now(),
    };

    await item.update(updates);
    if (effects.length > 0) {
      await item.createEmbeddedDocuments("ActiveEffect", effects);
    }

    const powerList = [...this._selectedPowers.keys()].join(", ");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${item.img || 'icons/svg/item-bag.svg'}" alt="${relicName}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Relic Forged</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${relicName}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="text-align:center; padding:4px 0;">
              <p><strong>Powers:</strong> ${powerList}</p>
              <p style="color:#888;">Total power cost: ${powerCost}g</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    ui.notifications.info(`${relicName} has been forged!`);
    this._item = null;
    this._itemData = null;
    this._selectedPowers.clear();
    this.close();
  }
}
