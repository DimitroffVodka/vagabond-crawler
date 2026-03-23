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

class RelicForgeApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-relic-forge",
    window: { title: "Relic Forge", resizable: true },
    position: { width: 700, height: "auto" },
    classes: ["vagabond-crawler-relic-forge"],
  };

  constructor(...args) {
    super(...args);
    this._item = null;
    this._itemData = null;
    this._selectedPowers = new Map(); // powerName → { userInput: string|null }
    this._categoryFilter = null;
  }

  async _renderHTML() {
    const html = document.createElement("div");
    html.classList.add("relic-forge-container");
    html.style.cssText = "padding:12px; display:flex; flex-direction:column; gap:12px;";

    // Drop zone / Item preview
    html.innerHTML = this._buildDropZoneHTML() + this._buildPowerSelectorHTML() + this._buildSummaryHTML();
    return html;
  }

  _replaceHTML(result, content, options) {
    const target = this.element;
    if (!target) return;
    target.innerHTML = "";
    target.appendChild(result);
    this._bindEvents(target);
  }

  _buildDropZoneHTML() {
    if (!this._item) {
      return `
        <div class="forge-drop-zone" style="border:2px dashed #999; border-radius:8px; padding:30px; text-align:center; cursor:pointer;">
          <i class="fas fa-hammer" style="font-size:2em; color:#999;"></i>
          <p style="color:#888; margin-top:8px;">Drop an equipment item here to begin forging.</p>
        </div>
      `;
    }

    const item = this._itemData;
    const metal = item.system?.metal || "none";
    return `
      <div class="forge-item-preview" style="display:flex; align-items:center; gap:12px; border:1px solid #666; border-radius:6px; padding:10px; background:rgba(0,0,0,0.05);">
        <img src="${item.img || 'icons/svg/item-bag.svg'}" width="48" height="48" style="border:1px solid #999; border-radius:4px;">
        <div style="flex:1;">
          <strong style="font-size:1.1em;">${item.name}</strong><br>
          <span style="color:#888;">Metal: ${metal} | Type: ${item.system?.equipmentType || "gear"}</span>
        </div>
        <button class="forge-clear-item" style="background:none; border:none; cursor:pointer; font-size:1.2em; color:#c00;" title="Remove item">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  }

  _buildPowerSelectorHTML() {
    if (!this._item) return "";

    // Group powers by category
    const categories = {};
    for (const [name, power] of Object.entries(RELIC_POWERS)) {
      if (!categories[power.category]) categories[power.category] = [];
      categories[power.category].push({ name, ...power });
    }

    // Build category tabs
    const catNames = Object.keys(categories);
    const tabs = catNames.map(cat => {
      const active = this._categoryFilter === cat ? "font-weight:bold; border-bottom:2px solid #7b5ea7;" : "";
      return `<button class="forge-cat-tab" data-category="${cat}" style="background:none; border:none; padding:4px 8px; cursor:pointer; ${active}">${cat}</button>`;
    }).join("");
    const allActive = !this._categoryFilter ? "font-weight:bold; border-bottom:2px solid #7b5ea7;" : "";

    // Build power list (filtered by category)
    const visiblePowers = this._categoryFilter
      ? (categories[this._categoryFilter] || [])
      : Object.entries(RELIC_POWERS).map(([name, p]) => ({ name, ...p }));

    const powerRows = visiblePowers.map(power => {
      const selected = this._selectedPowers.has(power.name);
      const bgColor = selected ? "rgba(123,94,167,0.1)" : "transparent";
      const userInput = this._selectedPowers.get(power.name)?.userInput || "";

      let inputHTML = "";
      if (power.requiresInput && selected) {
        if (power.inputType === "select" && power.inputOptions) {
          const options = power.inputOptions.map(opt =>
            `<option value="${opt}" ${userInput === opt ? "selected" : ""}>${opt}</option>`
          ).join("");
          inputHTML = `<select class="forge-power-input" data-power="${power.name}" style="margin-left:8px; padding:2px;">
            <option value="">-- ${power.inputLabel || "Select"} --</option>
            ${options}
          </select>`;
        } else {
          inputHTML = `<input class="forge-power-input" data-power="${power.name}" type="text" value="${userInput}" placeholder="${power.inputLabel || "Enter value"}" style="margin-left:8px; width:120px; padding:2px;">`;
        }
      }

      return `
        <div class="forge-power-row" style="display:flex; align-items:center; gap:8px; padding:4px 8px; background:${bgColor}; border-radius:4px;">
          <input type="checkbox" class="forge-power-check" data-power="${power.name}" ${selected ? "checked" : ""}>
          <div style="flex:1;">
            <strong>${power.name}</strong>
            <span style="color:#888; font-size:0.85em;"> (${power.cost}g)</span>
            ${inputHTML}
            <div style="color:#666; font-size:0.8em;">${power.description}</div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="forge-powers" style="border:1px solid #ddd; border-radius:6px; overflow:hidden;">
        <div style="display:flex; flex-wrap:wrap; gap:2px; padding:6px; border-bottom:1px solid #ddd; background:#f5f5f5;">
          <button class="forge-cat-tab" data-category="" style="background:none; border:none; padding:4px 8px; cursor:pointer; ${allActive}">All</button>
          ${tabs}
        </div>
        <div style="max-height:300px; overflow-y:auto; padding:4px;">
          ${powerRows}
        </div>
      </div>
    `;
  }

  _buildSummaryHTML() {
    if (!this._item || this._selectedPowers.size === 0) return "";

    const item = this._itemData;
    const baseCost = item.system?.cost ?? 0;
    const metal = item.system?.metal || "none";
    const metalMult = METAL_MULTIPLIERS[metal] || 1;
    let powerCost = 0;
    const nameParts = { prefix: [], base: item.name, suffix: [] };

    for (const [name, data] of this._selectedPowers) {
      const power = RELIC_POWERS[name];
      if (!power) continue;
      powerCost += power.cost;

      // Build name
      const input = data.userInput || "";
      const formatted = power.nameFormat.text.replace("{input}", input);
      if (power.nameFormat.position === "prefix") nameParts.prefix.push(formatted);
      else if (power.nameFormat.position === "suffix") nameParts.suffix.push(formatted);
    }

    const totalCost = (baseCost * metalMult) + powerCost;
    const relicName = [...nameParts.prefix, nameParts.base, ...nameParts.suffix].join(" ");

    return `
      <div class="forge-summary" style="border:1px solid #7b5ea7; border-radius:6px; padding:10px; background:rgba(123,94,167,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="font-size:1.1em; color:#7b5ea7;">${relicName}</strong><br>
            <span style="color:#888;">Base: ${baseCost}g × ${metalMult} + Powers: ${powerCost}g = <strong>${totalCost}g</strong></span>
          </div>
          <button class="forge-btn" style="background:#7b5ea7; color:white; border:none; padding:8px 16px; border-radius:4px; cursor:pointer; font-size:1em;">
            <i class="fas fa-hammer"></i> Forge Relic
          </button>
        </div>
      </div>
    `;
  }

  _bindEvents(el) {
    // Drop zone
    const dropZone = el.querySelector(".forge-drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", ev => { ev.preventDefault(); dropZone.style.borderColor = "#7b5ea7"; });
      dropZone.addEventListener("dragleave", () => { dropZone.style.borderColor = "#999"; });
      dropZone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        dropZone.style.borderColor = "#999";
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Item") return;
        const item = await fromUuid(data.uuid);
        if (!item || item.type !== "equipment") {
          ui.notifications.warn("Only equipment items can be forged into relics.");
          return;
        }
        this.loadItem(item);
        this.render(true);
      });
    }

    // Clear item
    el.querySelector(".forge-clear-item")?.addEventListener("click", () => {
      this._item = null;
      this._itemData = null;
      this._selectedPowers.clear();
      this._categoryFilter = null;
      this.render(true);
    });

    // Category tabs
    el.querySelectorAll(".forge-cat-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        this._categoryFilter = tab.dataset.category || null;
        this.render(true);
      });
    });

    // Power checkboxes
    el.querySelectorAll(".forge-power-check").forEach(cb => {
      cb.addEventListener("change", () => {
        const name = cb.dataset.power;
        if (cb.checked) {
          this._selectedPowers.set(name, { userInput: "" });
        } else {
          this._selectedPowers.delete(name);
        }
        this.render(true);
      });
    });

    // Power inputs (select/text)
    el.querySelectorAll(".forge-power-input").forEach(input => {
      input.addEventListener("change", () => {
        const name = input.dataset.power;
        const entry = this._selectedPowers.get(name);
        if (entry) entry.userInput = input.value;
        this.render(true);
      });
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

    // Upgrade metal to magical if common/none
    const currentMetal = item.system?.metal || "none";
    if (currentMetal === "none" || currentMetal === "common") {
      updates["system.metal"] = "magical";
    }

    // Set equipment type to relic
    updates["system.equipmentType"] = "relic";

    // Build effects and name from selected powers
    const userInputs = {};
    for (const [name, data] of this._selectedPowers) {
      const power = RELIC_POWERS[name];
      if (!power) continue;
      powerCost += power.cost;
      userInputs[name] = data.userInput || "";

      // Build name
      const input = data.userInput || "";
      const formatted = power.nameFormat.text.replace("{input}", input);
      if (power.nameFormat.position === "prefix") nameParts.prefix.push(formatted);
      else if (power.nameFormat.position === "suffix") nameParts.suffix.push(formatted);

      // Build Active Effect
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
        flags: {
          [MODULE_ID]: { relicPower: name, managed: true },
        },
      });
    }

    const relicName = [...nameParts.prefix, nameParts.base, ...nameParts.suffix].join(" ");
    updates.name = relicName;

    // Store forge metadata
    updates[`flags.${MODULE_ID}.relicForge`] = {
      forged: true,
      powers: [...this._selectedPowers.keys()],
      userInputs,
      powerCost,
      forgedAt: Date.now(),
    };

    // Apply updates
    await item.update(updates);

    // Create Active Effects on the item
    if (effects.length > 0) {
      await item.createEmbeddedDocuments("ActiveEffect", effects);
    }

    // Post chat card
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

    // Reset and close
    this._item = null;
    this._itemData = null;
    this._selectedPowers.clear();
    this.close();
  }
}
