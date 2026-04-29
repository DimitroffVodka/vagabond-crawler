/**
 * Vagabond Crawler — Relic Forge
 *
 * GM tool to upgrade equipment items into magical relics by selecting
 * powers, computing costs, and generating Active Effects.
 * 3-column layout: Power Browser | Base Item + Config | Selected Powers
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { RELIC_POWERS, RELIC_POWER_CATEGORIES, METAL_DISPLAY_NAMES, getRelicPower, getPowersByCategory, getCustomRelicPowers } from "./relic-powers.mjs";
import { confirmDialog } from "./dialog-helpers.mjs";

/* -------------------------------------------- */
/*  Relic Forge Singleton                       */
/* -------------------------------------------- */

export const RelicForge = {
  _app: null,

  init() {
    console.log(`${MODULE_ID} | Relic Forge initialized (${RELIC_POWERS.length} powers).`);
  },

  open(item = null) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can use the Relic Forge.");
      return;
    }
    if (!this._app) this._app = new RelicForgeApp();
    if (item) this._app.loadItem(item);
    this._app.render(true);
  },

  /**
   * Compute the relic name from a base item + selected powers.
   *
   * Pure function — used by the live preview, the App's submit handler,
   * and external modules (e.g. vgbnd-importer auto-forging on import).
   *
   * @param {object} itemData    Item.toObject() of the base item
   * @param {object[]} powers    Power defs (from RELIC_POWERS or custom)
   * @param {Object<string,string>} [userInputs]  Per-power-id user-typed text
   * @returns {string}
   */
  computeRelicName(itemData, powers, userInputs = {}) {
    const baseName = itemData?.name || "[Item]";
    const metal = itemData?.system?.metal || "none";
    const prefixes = [];
    const suffixes = [];
    let wrapTemplate = null;

    for (const power of (powers || [])) {
      if (!power) continue; // tolerate null/undefined entries from failed id lookups
      const fmt = power.nameFormat;
      if (!fmt) {
        if (power.nameLabel) prefixes.push(power.nameLabel);
        continue;
      }

      let text = fmt.text || fmt.template || "";
      const input = userInputs[power.id] ?? power._userInput ?? "";
      if (power.requiresInput && input) text = text.replace("{input}", input);
      else if (power.requiresInput)     text = text.replace("{input}", "???");

      if      (fmt.position === "prefix") prefixes.push(text);
      else if (fmt.position === "suffix") suffixes.push(text);
      else if (fmt.position === "wrap")   wrapTemplate = text;
    }

    let name;
    if (wrapTemplate) {
      name = wrapTemplate.replace("{item}", baseName);
      if (prefixes.length) name = prefixes.join(" ") + " " + name;
      if (suffixes.length) name = name + " " + suffixes.join(" ");
    } else {
      name = [...prefixes, baseName].join(" ");
      if (suffixes.length) name = name + " " + suffixes.join(" ");
    }

    if (metal && metal !== "none" && metal !== "common") {
      name += ` (${METAL_DISPLAY_NAMES[metal] || metal})`;
    }

    return name;
  },

  /**
   * Apply relic powers to an item — pure side-effect function with no UI.
   *
   * The App's "Forge" button calls this and then emits a chat card itself.
   * External modules (vgbnd-importer auto-forging) call this directly and
   * stay silent — caller owns user-facing notifications.
   *
   * @param {Item} item                    World Item document (must NOT be a compendium ref)
   * @param {object[]} powers              Power defs (from RELIC_POWERS or custom)
   * @param {object} [opts]
   * @param {Object<string,string>} [opts.userInputs]  power.id → user input text
   * @returns {Promise<{relicName: string, powerCost: number, effectsCreated: number}>}
   */
  async forgeItem(item, powers, { userInputs = {} } = {}) {
    if (!item) throw new Error("RelicForge.forgeItem: item is required");
    if (item.pack) throw new Error("RelicForge.forgeItem: cannot forge a compendium item directly — copy it to the world first");
    if (!Array.isArray(powers) || powers.length === 0) {
      return { relicName: item.name, powerCost: 0, effectsCreated: 0 };
    }

    const updates = {};
    const effectDocs = [];
    let powerCost = 0;
    const inputsRecord = {};

    for (const power of powers) {
      powerCost += power.cost || 0;
      const input = userInputs[power.id] ?? power._userInput ?? "";
      if (power.id) inputsRecord[power.id] = input;

      const changes = (power.changes || []).map(e => ({
        key:   e.key.replace("{input}", input),
        mode:  e.mode,
        value: String(e.value).replace("{input}", input),
      }));

      const moduleFlags = { relicPower: power.id || power.name, managed: true };
      if (power.flags) {
        for (const [k, v] of Object.entries(power.flags)) {
          moduleFlags[k] = typeof v === "string" ? v.replace("{input}", input) : v;
        }
      }

      effectDocs.push({
        name:     `Relic: ${power.name}${input ? ` (${input})` : ""}`,
        icon:     item.img || "icons/svg/item-bag.svg",
        changes,
        disabled: !item.system?.equipped,
        transfer: true,
        flags:    { [MODULE_ID]: { ...moduleFlags, equipGated: true } },
      });
    }

    const relicName = this.computeRelicName(item.toObject(), powers, userInputs);
    updates.name = relicName;
    updates[`flags.${MODULE_ID}.relicForge`] = {
      forged:      true,
      powers:      powers.map(p => p.id || p.name),
      userInputs:  inputsRecord,
      powerCost,
      forgedAt:    Date.now(),
    };

    const existingProps = new Set(item.system.properties || []);
    for (const power of powers) {
      if (power.addProperties) {
        for (const prop of power.addProperties) existingProps.add(prop);
      }
    }
    updates["system.properties"] = Array.from(existingProps);

    await item.update(updates);
    if (effectDocs.length > 0) {
      await item.createEmbeddedDocuments("ActiveEffect", effectDocs);
    }

    return { relicName, powerCost, effectsCreated: effectDocs.length };
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
    position: { width: 820, height: 780 },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/relic-forge.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._item = null;
    this._itemData = null;
    this._selectedPowers = new Map(); // id → { ...powerDef, _userInput?: string }
    this._customPowers = [];
    this._categoryFilter = "all";
    // Power-database search — applied client-side via DOM toggle so typing
    // never loses focus. Composes with the category filter (which still
    // server-side filters in _prepareContext).
    this._powerSearchQuery = "";
    this._compendiumCache = null;
    // Base-item browser state (alternative to drag/drop).
    this._browserQuery = "";
    this._browserItemCache = null; // lazy-populated on first render
  }

  /* ---- Data for template ---- */

  async _prepareContext() {
    // Load compendium names for dropdown powers (cached after first load)
    if (!this._compendiumCache) {
      this._compendiumCache = {};
      this._compendiumCache.bestiary = [];
      for (const packId of ["vagabond.bestiary", "vagabond.humanlike"]) {
        const pack = game.packs.get(packId);
        if (pack) {
          const index = await pack.getIndex();
          for (const entry of index) {
            if (!this._compendiumCache.bestiary.includes(entry.name)) {
              this._compendiumCache.bestiary.push(entry.name);
            }
          }
        }
      }
      this._compendiumCache.bestiary.sort();

      this._compendiumCache.spells = [];
      const spellPack = game.packs.get("vagabond.spells");
      if (spellPack) {
        const index = await spellPack.getIndex();
        for (const entry of index) {
          this._compendiumCache.spells.push(entry.name);
        }
        this._compendiumCache.spells.sort();
      }
    }

    // Warm the browser cache (cheap after first render)
    await this._loadBrowserItems();

    return this.getData();
  }

  getData() {
    // Categories
    const categories = [
      { key: "all", label: "All", icon: "fas fa-globe", active: this._categoryFilter === "all" },
      ...Object.entries(RELIC_POWER_CATEGORIES).map(([key, cat]) => ({
        key, label: cat.label, icon: cat.icon, active: this._categoryFilter === key,
      })),
    ];

    // Filtered powers — mark user-saved custom powers so the template can
    // render a per-card delete affordance for them. Built-in powers from
    // RELIC_POWERS never get the delete icon.
    const customIds = new Set(getCustomRelicPowers().map(p => p.id));
    const filtered  = getPowersByCategory(this._categoryFilter);
    const powers    = filtered.map(p => ({
      ...p,
      selected:     this._selectedPowers.has(p.id),
      costDisplay:  p.cost > 0 ? `${p.cost.toLocaleString()}g` : (p.cost === 0 ? "Free" : "Special"),
      isUserCustom: customIds.has(p.id),
    }));

    // Selected powers (right panel) — resolve input options
    const selectedPowers = Array.from(this._selectedPowers.values()).map(p => {
      const resolved = {
        ...p,
        costDisplay: p.cost > 0 ? `${p.cost.toLocaleString()}g` : (p.cost === 0 ? "Free" : "Special"),
        userInput: p._userInput || "",
        isSelect: p.inputType === "select" || p.inputType === "compendium",
      };

      // Resolve input options
      if (p.inputType === "compendium" && p.inputSource) {
        resolved.inputOptions = this._compendiumCache?.[p.inputSource] || [];
      } else if (p.inputType === "select" && p.inputOptions) {
        resolved.inputOptions = p.inputOptions;
      }

      return resolved;
    });

    const customPowers = this._customPowers.map((cp, i) => ({ ...cp, index: i }));

    // Base item
    let baseItem = null;
    let baseCostDisplay = "-";
    let baseMetalDisplay = "Common";
    if (this._item) {
      const metal = this._itemData.system?.metal || "none";
      baseItem = {
        img: this._itemData.img || "icons/svg/item-bag.svg",
        name: this._itemData.name,
        type: this._itemData.system?.equipmentType || "gear",
        metal: (metal !== "none" && metal !== "common") ? (METAL_DISPLAY_NAMES[metal] || metal) : "Common",
      };
      baseCostDisplay = this._itemData.system?.costDisplay || "-";
    }

    // Base-item browser (alternative to drag/drop). Only build when no
    // base is selected yet — the <unless baseItem> guard in the template
    // hides the browser while an item is active.
    let browserResults = [];
    let browserEmptyMessage = "Loading…";
    if (!this._item && this._browserItemCache) {
      const q = (this._browserQuery ?? "").trim().toLowerCase();
      browserResults = this._browserItemCache
        .filter((it) => !q || it.name.toLowerCase().includes(q))
        .slice(0, 200);
      browserEmptyMessage = q ? `No items match "${this._browserQuery}".` : "No equipment found in compendium.";
    }

    // Quick-fill targets for the Custom Power builder — read live from
    // CONFIG.VAGABOND so homebrew stat / skill / save lists are respected
    // without needing to hardcode them. Each entry produces a dotted path
    // ending in `.bonus` (system stats / skills / saves all expose a bonus
    // array that AEs append to via mode=ADD).
    const statLabels = CONFIG?.VAGABOND?.stats ?? {};
    const homebrew   = CONFIG?.VAGABOND?.homebrew ?? {};
    const quickFillGroups = [
      {
        label: "Stat",
        targets: Object.entries(statLabels).map(([key, label]) => ({
          key, label, path: `system.stats.${key}.bonus`,
        })),
      },
      {
        label: "Skill",
        targets: (homebrew.skills ?? []).map(({ key, label }) => ({
          key, label, path: `system.skills.${key}.bonus`,
        })),
      },
      {
        label: "Save",
        targets: (homebrew.saves ?? []).map(({ key, label }) => ({
          key, label, path: `system.saves.${key}.bonus`,
        })),
      },
    ].filter(g => g.targets.length > 0);

    return {
      baseItem,
      baseCostDisplay,
      baseMetalDisplay,
      categories,
      powers,
      selectedPowers,
      customPowers,
      canForge: this._item && (this._selectedPowers.size > 0 || this._customPowers.length > 0),
      previewName: this._computeName(),
      totalCostDisplay: this._computeCostDisplay(),
      browserQuery: this._browserQuery,
      browserResults,
      powerSearchQuery: this._powerSearchQuery,
      browserEmptyMessage,
      quickFillGroups,
    };
  }

  /** Lazy-load every equipment / weapon entry from the standard Vagabond
   *  packs so the browser has something to search against. One-shot cache
   *  per app instance; sort alphabetically. */
  async _loadBrowserItems() {
    if (this._browserItemCache) return this._browserItemCache;
    const out = [];
    const packs = [
      { id: "vagabond.weapons", kind: "Weapon" },
      { id: "vagabond.armor",   kind: "Armor"  },
      { id: "vagabond.gear",    kind: "Gear"   },
    ];
    for (const { id, kind } of packs) {
      const pack = game.packs.get(id);
      if (!pack) continue;
      const index = await pack.getIndex();
      for (const e of index) {
        out.push({
          uuid: `Compendium.${id}.Item.${e._id}`,
          name: e.name,
          img:  e.img || "icons/svg/item-bag.svg",
          kind,
        });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    this._browserItemCache = out;
    return out;
  }

  /* ---- Name computation ---- */

  _computeName() {
    // Live preview delegates to the pure helper — keeps in sync with whatever
    // the actual forge step will produce.
    const allPowers = [...this._selectedPowers.values(), ...this._customPowers];
    return RelicForge.computeRelicName(this._itemData, allPowers);
  }

  _computeCostDisplay() {
    const baseCostGold = this._itemData?.system?.baseCost?.gold || this._itemData?.system?.cost?.gold || 0;
    const allPowers = [...this._selectedPowers.values(), ...this._customPowers];
    const powerCost = allPowers.reduce((sum, p) => sum + (p.cost || 0), 0);
    const metalMultiplier = this._itemData?.system?.metalMultiplier || 1;
    const totalGold = (baseCostGold * metalMultiplier) + powerCost;
    return totalGold > 0 ? `${totalGold.toLocaleString()}g` : "-";
  }

  /* ---- Event binding ---- */

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;
    const $$ = (sel) => [...el.querySelectorAll(sel)];
    const on = (sel, evt, fn) => $$(sel).forEach(n => n.addEventListener(evt, fn, { signal }));

    // Drop zone
    const dropZone = el.querySelector(".drop-zone");
    if (dropZone) {
      dropZone.addEventListener("dragover", ev => { ev.preventDefault(); dropZone.classList.add("drag-hover"); }, { signal });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-hover"), { signal });
      dropZone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        dropZone.classList.remove("drag-hover");
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "Item") return;
        const item = await fromUuid(data.uuid);
        if (!item || item.type !== "equipment") {
          ui.notifications.warn("Only equipment items can be forged into relics.");
          return;
        }
        this.loadItem(item);
        this.render();
      }, { signal });
    }

    // Clear item
    el.querySelector(".clear-btn")?.addEventListener("click", () => {
      this._item = null;
      this._itemData = null;
      this._selectedPowers.clear();
      this._customPowers = [];
      this._categoryFilter = "all";
      this.render();
    }, { signal });

    // Base-item browser — search input rebuilds the list HTML on each
    // keystroke against the FULL cache (not just rows already in the DOM),
    // so items past the initial render slice (e.g. "Light Armor", "Medium
    // Armor" alphabetically beyond the first ~200 entries) still surface
    // when the user searches for them. The input is outside the list so
    // its focus / cursor stays intact across rebuilds. Clicks are wired
    // via delegation on the list root so newly-inserted rows still work.
    const browserSearch = el.querySelector(".forge-browser-search");
    const browserList   = el.querySelector(".forge-browser-list");

    const _rebuildBrowserList = () => {
      if (!browserList || !this._browserItemCache) return;
      const q = (this._browserQuery ?? "").trim().toLowerCase();
      const matches = this._browserItemCache
        .filter((it) => !q || it.name.toLowerCase().includes(q))
        .slice(0, 500);
      if (matches.length === 0) {
        browserList.innerHTML = `<div class="forge-browser-empty">${
          q ? `No items match "${this._browserQuery}".` : "No equipment found in compendium."
        }</div>`;
        return;
      }
      browserList.innerHTML = matches.map((it) => `
        <div class="forge-browser-row" data-uuid="${it.uuid}" title="Click to use as base">
          <img src="${it.img}" alt="" width="24" height="24" />
          <span class="forge-browser-name">${foundry.utils.escapeHTML?.(it.name) ?? it.name}</span>
          <span class="forge-browser-meta">${it.kind}</span>
        </div>
      `).join("");
    };

    if (browserSearch) {
      browserSearch.addEventListener("input", (ev) => {
        this._browserQuery = ev.currentTarget.value ?? "";
        _rebuildBrowserList();
      }, { signal });
    }

    // Delegated click — fires for current AND future rows (after rebuild).
    if (browserList) {
      browserList.addEventListener("click", async (ev) => {
        const row = ev.target.closest(".forge-browser-row");
        if (!row) return;
        const uuid = row.dataset.uuid;
        const item = await fromUuid(uuid);
        if (!item || item.type !== "equipment") {
          ui.notifications.warn("Only equipment items can be forged into relics.");
          return;
        }
        this.loadItem(item);
        this.render();
      }, { signal });
    }

    // Category tabs
    on(".category-tab", "click", ev => {
      this._categoryFilter = ev.currentTarget.dataset.category || "all";
      this.render();
    });

    // Power-database search — same focus-preserving DOM-toggle pattern as the
    // base-item browser. Filter both name and description, case-insensitive.
    // Re-applied at the bottom of activateListeners so category-tab clicks
    // (which trigger render) still honor the standing query.
    const _applyPowerSearchFilter = () => {
      const q = (this._powerSearchQuery ?? "").trim().toLowerCase();
      const cards = el.querySelectorAll(".power-card");
      let shown = 0;
      cards.forEach((card) => {
        const name = card.querySelector(".power-name")?.textContent ?? "";
        const desc = card.querySelector(".power-desc")?.textContent ?? "";
        const match = !q || name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
        card.toggleAttribute("hidden", !match);
        if (match) shown++;
      });
      // Empty-state placeholder so the panel never looks broken.
      const list = el.querySelector(".power-browser-list");
      let emptyNode = list?.querySelector(".power-browser-empty-dynamic");
      if (q && shown === 0) {
        if (!emptyNode && list) {
          emptyNode = document.createElement("div");
          emptyNode.className = "power-browser-empty-dynamic";
          list.appendChild(emptyNode);
        }
        if (emptyNode) emptyNode.textContent = `No powers match "${this._powerSearchQuery}".`;
      } else if (emptyNode) {
        emptyNode.remove();
      }
    };

    const powerSearch = el.querySelector(".power-browser-search");
    if (powerSearch) {
      powerSearch.addEventListener("input", (ev) => {
        this._powerSearchQuery = ev.currentTarget.value ?? "";
        _applyPowerSearchFilter();
      }, { signal });
    }
    // Apply once on every render so category switches keep honoring the query.
    _applyPowerSearchFilter();

    // Power cards (toggle) — bail when the click came from the saved-custom
    // delete button so removing a custom doesn't simultaneously toggle it.
    on(".power-card", "click", ev => {
      if (ev.target.closest(".power-delete-btn")) return;
      const id = ev.currentTarget.dataset.powerId;
      if (this._selectedPowers.has(id)) {
        this._selectedPowers.delete(id);
      } else {
        const power = getRelicPower(id);
        if (power) this._selectedPowers.set(id, foundry.utils.deepClone(power));
      }
      this.render();
    });

    // Delete saved custom power — only rendered for entries the user saved
    // via "Save Custom". Confirms first, then drops the entry from the
    // world setting and from the current relic's selected list (so a stale
    // selection doesn't survive the delete).
    on(".power-delete-btn", "click", async ev => {
      ev.stopPropagation();
      const id = ev.currentTarget.dataset.powerId;
      const all = getCustomRelicPowers();
      const target = all.find(p => p.id === id);
      if (!target) return;
      const ok = await confirmDialog({
        title:   "Delete Custom Power",
        content: `Delete <strong>${target.name}</strong> from your saved custom powers? This cannot be undone.`,
      });
      if (!ok) return;
      const remaining = all.filter(p => p.id !== id);
      await game.settings.set(MODULE_ID, "customRelicPowers", remaining);
      this._selectedPowers.delete(id);
      this.render();
      ui.notifications.info(`Deleted custom power "${target.name}".`);
    });

    // Remove power button (right panel)
    on(".remove-btn[data-power-id]", "click", ev => {
      ev.stopPropagation();
      const id = ev.currentTarget.dataset.powerId;
      this._selectedPowers.delete(id);
      this.render();
    });

    // Remove custom power
    on(".remove-btn[data-custom-index]", "click", ev => {
      ev.stopPropagation();
      const idx = parseInt(ev.currentTarget.dataset.customIndex);
      this._customPowers.splice(idx, 1);
      this.render();
    });

    // User input fields for powers
    on(".power-user-input", "change", ev => {
      const id = ev.currentTarget.dataset.powerId;
      const power = this._selectedPowers.get(id);
      if (power) {
        power._userInput = ev.currentTarget.value.trim();
        const nameEl = el.querySelector(".name-text");
        if (nameEl) nameEl.textContent = this._computeName();
        const costEl = el.querySelector(".cost-text");
        if (costEl) costEl.textContent = this._computeCostDisplay();
      }
    });

    // Set select values
    el.querySelectorAll("select.power-user-input").forEach(sel => {
      const id = sel.dataset.powerId;
      const power = this._selectedPowers.get(id);
      if (power?._userInput) sel.value = power._userInput;
    });

    // Quick-fill: when the user picks a stat/skill/save target, push the
    // dotted path into the raw key field, snap mode to Add (stats/skills/
    // saves all expose a bonus ARRAY that AEs append to via mode=ADD), and
    // — if the Effect Name + Relic Name Word are blank — pre-fill them
    // from the picked label so the user can save with one click. The raw
    // row stays fully editable so power users can override after.
    const _applyQuickFill = () => {
      const targetSel = el.querySelector(".custom-power-quickfill-target");
      const valueInp  = el.querySelector(".custom-power-quickfill-value");
      const path      = targetSel?.value ?? "";
      if (!path) return;
      const label     = targetSel.selectedOptions?.[0]?.dataset?.label
                     ?? targetSel.selectedOptions?.[0]?.textContent
                     ?? "";

      const keyField   = el.querySelector(".custom-power-key");
      const modeField  = el.querySelector(".custom-power-mode");
      const valueField = el.querySelector(".custom-power-value");
      const nameField  = el.querySelector(".custom-power-name");
      const labelField = el.querySelector(".custom-power-namelabel");

      if (keyField)   keyField.value   = path;
      if (modeField)  modeField.value  = "2"; // Add — bonus arrays append
      if (valueField) {
        const raw = (valueInp?.value ?? "").trim();
        // Preserve sign in the raw value field. "+1" displays as "+1" so
        // when AE pushes it onto the bonus array, formulas read cleanly.
        valueField.value = raw === "" ? "" : (Number(raw) > 0 ? `+${Number(raw)}` : `${Number(raw)}`);
      }

      // Friendly auto-name only when the user hasn't typed their own.
      if (nameField && !nameField.value.trim() && label) {
        const v = valueInp?.value?.trim();
        nameField.value = v ? `${label} ${Number(v) > 0 ? "+" : ""}${Number(v)}` : label;
      }
      if (labelField && !labelField.value.trim() && label) {
        labelField.value = label;
      }
    };
    el.querySelector(".custom-power-quickfill-target")?.addEventListener("change", _applyQuickFill, { signal });
    el.querySelector(".custom-power-quickfill-value") ?.addEventListener("input",  _applyQuickFill, { signal });

    // Read the current Custom Power form into a normalized object. Returns
    // null + warns when required fields are missing. `descInput` is optional
    // and falls back to a generated "key + value" summary so legacy entries
    // built before the description field still get a readable card.
    const _readCustomPowerForm = () => {
      const nameInput      = el.querySelector(".custom-power-name");
      const nameLabelInput = el.querySelector(".custom-power-namelabel");
      const keyInput       = el.querySelector(".custom-power-key");
      const modeInput      = el.querySelector(".custom-power-mode");
      const valueInput     = el.querySelector(".custom-power-value");
      const descInput      = el.querySelector(".custom-power-description");

      const name  = nameInput?.value?.trim();
      const key   = keyInput?.value?.trim();
      const value = valueInput?.value?.trim();
      if (!name || !key || !value) {
        ui.notifications.warn("Fill in name, key, and value before adding/saving a custom power.");
        return null;
      }
      const mode      = parseInt(modeInput?.value || "2");
      const nameLabel = nameLabelInput?.value?.trim() || name;
      const userDesc  = descInput?.value?.trim();
      const fallback  = `${key} ${mode === 2 ? "+" : mode === 5 ? "=" : "×"} ${value}`;
      // Slugify aggressively so saved-power IDs are stable, readable, and
      // safe in CSS / data attributes regardless of weird name input.
      const slug      = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "untitled";

      return {
        id:           `custom-${slug}`,
        name,
        nameLabel,
        nameFormat:   { position: "prefix", text: nameLabel },
        description:  userDesc || fallback,
        icon:         "fas fa-wand-magic-sparkles",
        category:     "custom",
        cost:         0,
        changes:      [{ key, mode, value }],
        flags:        { relicPower: `custom-${slug}` },
      };
    };

    const _clearCustomPowerForm = () => {
      [
        ".custom-power-name", ".custom-power-namelabel",
        ".custom-power-key",  ".custom-power-value",
        ".custom-power-description",
        ".custom-power-quickfill-target", ".custom-power-quickfill-value",
      ].forEach((sel) => { const node = el.querySelector(sel); if (node) node.value = ""; });
    };

    // "Add Once" — adds the custom power to THIS relic only (legacy
    // behavior). Does NOT persist to the saved-powers library.
    el.querySelector(".add-custom-btn")?.addEventListener("click", () => {
      const power = _readCustomPowerForm();
      if (!power) return;
      this._customPowers.push(power);
      _clearCustomPowerForm();
      this.render();
    }, { signal });

    // "Save Custom" — persists the power to the world setting so it shows
    // up under the new "Custom" category and can be reused on future
    // relics. Also adds it to the current relic's selected powers as a
    // convenience (the user was about to use it).
    el.querySelector(".save-custom-btn")?.addEventListener("click", async () => {
      const power = _readCustomPowerForm();
      if (!power) return;
      const existing = game.settings.get(MODULE_ID, "customRelicPowers") ?? [];
      // Replace by id so the user can iterate on a power without needing to
      // delete the previous version first.
      const filtered = existing.filter((p) => p.id !== power.id);
      filtered.push(power);
      await game.settings.set(MODULE_ID, "customRelicPowers", filtered);
      // Auto-select it for the current relic.
      this._selectedPowers.set(power.id, foundry.utils.deepClone(power));
      ui.notifications.info(`Saved custom power "${power.name}" to the Custom category.`);
      _clearCustomPowerForm();
      this.render();
    }, { signal });

    // Forge button
    el.querySelector(".forge-btn")?.addEventListener("click", () => this._forgeRelic(), { signal });
  }

  loadItem(item) {
    this._item = item;
    this._itemData = item.toObject();
    this._selectedPowers.clear();
    this._customPowers = [];
    this._categoryFilter = "all";
  }

  /* ---- Forge ---- */

  async _forgeRelic() {
    if (!this._item) return;

    // If the base was picked from a compendium (drag/drop OR the inline
    // weapons-and-equipment search), the source document is locked. Create
    // a fresh world copy from the loaded item data — the compendium stays
    // untouched, the new world item becomes the relic. We only do this at
    // forge time so cancelling the dialog leaves the world clean.
    let item = this._item;
    if (item.pack) {
      const data = foundry.utils.deepClone(this._itemData);
      delete data._id;
      const worldItem = await Item.create(data);
      if (!worldItem) {
        ui.notifications.error("Failed to import compendium item to the world — see console.");
        return;
      }
      item = worldItem;
    }

    const allPowers = [...this._selectedPowers.values(), ...this._customPowers];
    const userInputs = {};
    for (const power of allPowers) {
      if (power.id) userInputs[power.id] = power._userInput || "";
    }

    // Delegate the actual update + ActiveEffect creation to the pure helper.
    // This is the same code-path external callers (importer, etc.) use.
    const { relicName, powerCost } = await RelicForge.forgeItem(item, allPowers, { userInputs });

    const powerList = allPowers.map(p => p.name).join(", ");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${item.img || "icons/svg/item-bag.svg"}" alt="${relicName}">
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
              <p style="color:#888;">Total power cost: ${powerCost.toLocaleString()}g</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    ui.notifications.info(`${relicName} has been forged!`);
    this._item = null;
    this._itemData = null;
    this._selectedPowers.clear();
    this._customPowers = [];
    this.close();
  }
}
