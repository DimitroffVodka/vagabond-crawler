/**
 * Vagabond Crawler — Action Menu
 *
 * During combat, NPC and player cards show a visible tab strip BELOW the card:
 *   NPCs:    [Actions] [Abilities]
 *   Players: [Weapons] [Spells]
 *
 * Hovering the card or the tab strip reveals a dropdown panel.
 * The panel is appended to #vagabond-crawler-strip (NOT inside the card)
 * so it is never clipped by overflow:hidden on parent containers.
 *
 * Damage previewed inline: "Claws  2d6 piercing"
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { setCastCheckFlag } from "./npc-abilities.mjs";

// ─── Spell State ──────────────────────────────────────────────────────────────

const _spellStates = new Map();

function _getSpellState(actor, spell) {
  const key = `${actor.id}.${spell.id}`;
  if (!_spellStates.has(key)) {
    _spellStates.set(key, {
      damageDice: 1, deliveryType: null, deliveryIncrease: 0,
      useFx: spell.system?.damageType === "-",
      previewActive: false,
      focusAfterCast: false,
    });
  }
  return _spellStates.get(key);
}
function _saveSpellState(actor, spell, state) {
  _spellStates.set(`${actor.id}.${spell.id}`, state);
}

// ─── Mana Cost Calculator ─────────────────────────────────────────────────────

function _calcSpellCost(actor, spell, state) {
  const hasDamage = spell.system?.damageType !== "-" && state.damageDice >= 1;
  const damageCost = hasDamage && state.damageDice > 1 ? state.damageDice - 1 : 0;
  const fxCost = state.useFx && hasDamage ? 1 : 0;
  const deliveryDefs = CONFIG.VAGABOND?.deliveryDefaults ?? {};
  const increaseCost = CONFIG.VAGABOND?.deliveryIncreaseCost ?? {};
  const deliveryRed = actor.system?.bonuses?.deliveryManaCostReduction ?? 0;
  const spellRed    = actor.system?.bonuses?.spellManaCostReduction ?? 0;
  const deliveryBaseCost = state.deliveryType
    ? Math.max(0, (deliveryDefs[state.deliveryType]?.cost ?? 0) - deliveryRed) : 0;
  const deliveryIncreaseCost = state.deliveryType
    ? state.deliveryIncrease * (increaseCost[state.deliveryType] ?? 0) : 0;
  const totalCost = Math.max(0, damageCost + fxCost + deliveryBaseCost + deliveryIncreaseCost - spellRed);
  return { damageCost, fxCost, deliveryBaseCost, deliveryIncreaseCost, totalCost };
}

function _getSizeHint(state) {
  const { deliveryType: dt, deliveryIncrease: di } = state;
  if (!dt || di === 0) return "";
  const base = CONFIG.VAGABOND?.deliveryBaseRanges?.[dt];
  const inc  = CONFIG.VAGABOND?.deliveryIncrement?.[dt];
  if (!base?.value || !inc) return "";
  const v = base.value + inc * di;
  if (base.type === "count")  return `(${v} ${base.unit}${v > 1 ? "s" : ""})`;
  if (base.type === "radius") return `(${v}-${base.unit} radius)`;
  return `(${v}-${base.unit})`;
}

// ─── Spell Dialog ─────────────────────────────────────────────────────────────

// ─── Spell Dialog ─────────────────────────────────────────────────────────────

export class CrawlerSpellDialog extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-spell-dialog", tag: "div",
    window: { title: "Cast Spell", resizable: false },
    position: { width: 360 }, classes: ["vagabond-crawler-spell-dialog"],
  };
  constructor(actor, spell) {
    super();
    this.actor      = actor;
    this.spell      = spell;
    this.spellState = _getSpellState(actor, spell);
  }
  static show(actor, spell) {
    const existing = Object.values(foundry.applications.instances ?? {})
      .find(a => a instanceof CrawlerSpellDialog && a.actor?.id === actor.id && a.spell?.id === spell.id);
    if (existing) { existing.bringToFront(); return; }
    new CrawlerSpellDialog(actor, spell).render(true);
  }
  async _prepareContext() {
    const s     = this.spellState;
    const spell = this.spell;
    const costs = _calcSpellCost(this.actor, spell, s);
    const hasDamage = spell.system?.damageType !== "-";
    const deliveryOptions = Object.entries(CONFIG.VAGABOND?.deliveryTypes ?? {}).map(([k, v]) => ({
      value: k, label: game.i18n.localize(v), selected: k === s.deliveryType,
    }));
    const canIncrease = s.deliveryType && (CONFIG.VAGABOND?.deliveryIncreaseCost?.[s.deliveryType] ?? 0) > 0;
    const currentMana = this.actor.system?.mana?.current   ?? 0;
    const castingMax  = this.actor.system?.mana?.castingMax ?? 0;
    const canCast     = s.deliveryType !== null && costs.totalCost <= currentMana && costs.totalCost <= castingMax;
    const noTemplate  = ['touch', 'remote', 'imbue', 'glyph'];
    const hasTemplate = s.deliveryType && !noTemplate.includes(s.deliveryType);
    return { spell, s, costs, hasDamage, deliveryOptions, canIncrease,
      sizeHint: _getSizeHint(s), currentMana, castingMax, canCast, hasTemplate };
  }
  async _renderHTML(context) {
    const { spell, s, costs, hasDamage, deliveryOptions, canIncrease, sizeHint, currentMana, castingMax, canCast, hasTemplate } = context;
    const deliverySelectOptions = `<option value="">-- Select Delivery --</option>` +
      deliveryOptions.map(o => `<option value="${o.value}" ${o.selected ? "selected" : ""}>${o.label}</option>`).join("");
    const damageSection = hasDamage ? `
      <div class="csd-row"><label>Damage Dice</label>
        <div class="csd-controls">
          <button type="button" class="csd-btn csd-dmg-down">−</button>
          <span class="csd-val ${s.damageDice > 1 ? "csd-highlight" : ""}">${s.damageDice}d6</span>
          <button type="button" class="csd-btn csd-dmg-up">+</button>
        </div>
        <span class="csd-badge">${costs.damageCost > 0 ? `+${costs.damageCost}` : "free"}</span>
      </div>
      <div class="csd-row"><label>Include Effect</label>
        <button type="button" class="csd-btn csd-fx-toggle ${s.useFx ? "csd-active" : ""}">
          <i class="fas fa-sparkles"></i> ${s.useFx ? "On" : "Off"}
        </button>
        <span class="csd-badge">${costs.fxCost > 0 ? `+${costs.fxCost}` : "free"}</span>
      </div>` :
      `<div class="csd-row csd-muted"><i class="fas fa-sparkles"></i> Effect-only spell</div>`;
    const templateRow = hasTemplate ? `
      <div class="csd-row"><label>Template</label>
        <div class="csd-controls" style="gap:6px">
          <button type="button" class="csd-btn csd-preview-btn ${s.previewActive ? "csd-active" : ""}">
            <i class="fas fa-eye"></i> Preview ${s.previewActive ? "On" : "Off"}
          </button>
          <button type="button" class="csd-btn csd-place-btn">
            <i class="fas fa-ruler-combined"></i> Place
          </button>
        </div>
      </div>` : "";
    const html = `
      <div class="csd-header">
        <img src="${spell.img}" width="36" height="36" style="border-radius:4px">
        <div><strong>${spell.name}</strong><div class="csd-muted">${spell.system?.effect ?? ""}</div></div>
      </div>
      <div class="csd-section">${damageSection}</div>
      <div class="csd-section">
        <div class="csd-row"><label>Delivery</label>
          <select class="csd-delivery-select">${deliverySelectOptions}</select>
        </div>
        ${s.deliveryType ? `
        <div class="csd-row"><label>Increase</label>
          <div class="csd-controls">
            <button type="button" class="csd-btn csd-inc-down" ${s.deliveryIncrease === 0 ? "disabled" : ""}>−</button>
            <span class="csd-val">${s.deliveryIncrease} <span class="csd-muted">${sizeHint}</span></span>
            <button type="button" class="csd-btn csd-inc-up" ${!canIncrease ? "disabled" : ""}>+</button>
          </div>
          <span class="csd-badge">+${costs.deliveryBaseCost + costs.deliveryIncreaseCost}</span>
        </div>
        ${templateRow}` : ""}
      </div>
      <div class="csd-section csd-mana">
        Mana: <strong class="${costs.totalCost > currentMana ? "csd-error" : ""}">${costs.totalCost}</strong>
        / ${currentMana} (max cast: ${castingMax})
      </div>
      <div class="csd-section">
        <div class="csd-row csd-focus-row">
          <label><i class="fas fa-eye"></i> Focus Spell</label>
          <button type="button" class="csd-btn csd-focus-toggle ${s.focusAfterCast ? "csd-active" : ""}">
            ${s.focusAfterCast ? "On" : "Off"}
          </button>
          <span class="csd-muted" style="font-size:10px">sustain after cast</span>
        </div>
      </div>
      <div class="csd-footer">
        <button type="button" class="csd-btn csd-cast-btn ${canCast ? "" : "csd-disabled"}" ${canCast ? "" : "disabled"}>
          <i class="fas fa-wand-sparkles"></i> Cast
        </button>
        <button type="button" class="csd-btn csd-cancel-btn">Cancel</button>
      </div>`;
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
  _attachFrameListeners() {
    super._attachFrameListeners();
    this.element.addEventListener("change", async e => {
      if (!e.target.classList.contains("csd-delivery-select")) return;
      this.spellState.deliveryType    = e.target.value || null;
      this.spellState.deliveryIncrease = 0;
      this.spellState.previewActive   = false;
      await this._clearPreview();
      _saveSpellState(this.actor, this.spell, this.spellState);
      this.render();
    });
    this.element.addEventListener("click", async e => {
      const btn = e.target.closest("button"); if (!btn) return;
      if      (btn.classList.contains("csd-dmg-up"))     { if (this.spellState.damageDice === 0) this.spellState.useFx = false; this.spellState.damageDice++; }
      else if (btn.classList.contains("csd-dmg-down"))   { if (this.spellState.damageDice > 0) { this.spellState.damageDice--; if (this.spellState.damageDice === 0) this.spellState.useFx = true; } }
      else if (btn.classList.contains("csd-fx-toggle"))  { this.spellState.useFx = !this.spellState.useFx; }
      else if (btn.classList.contains("csd-inc-up"))     { this.spellState.deliveryIncrease++; await this._refreshPreview(); }
      else if (btn.classList.contains("csd-inc-down"))   { if (this.spellState.deliveryIncrease > 0) this.spellState.deliveryIncrease--; await this._refreshPreview(); }
      else if (btn.classList.contains("csd-preview-btn")){ this.spellState.previewActive = !this.spellState.previewActive; await this._refreshPreview(); }
      else if (btn.classList.contains("csd-place-btn"))  { await this._placeTemplate(); return; }
      else if (btn.classList.contains("csd-focus-toggle")) { this.spellState.focusAfterCast = !this.spellState.focusAfterCast; }
      else if (btn.classList.contains("csd-cast-btn") && !btn.disabled) { await this._cast(); return; }
      else if (btn.classList.contains("csd-cancel-btn")) { this.close(); return; }
      else return;
      _saveSpellState(this.actor, this.spell, this.spellState);
      this.render();
    });
  }
  async _clearPreview() {
    const mgr = globalThis.vagabond?.managers?.templates;
    if (mgr) await mgr.clearPreview(this.actor.id, this.spell.id);
  }
  async _refreshPreview() {
    const s = this.spellState;
    if (!s.previewActive || !s.deliveryType) { await this._clearPreview(); return; }
    const base = CONFIG.VAGABOND.deliveryBaseRanges?.[s.deliveryType];
    const inc  = CONFIG.VAGABOND.deliveryIncrement?.[s.deliveryType];
    const dist = base?.value ? base.value + inc * s.deliveryIncrease : 0;
    if (!dist) { await this._clearPreview(); return; }
    // Self-target for sphere/cube if no target
    const needsTarget = ['sphere', 'cube'].includes(s.deliveryType);
    let tempTarget = null;
    if (needsTarget && game.user.targets.size === 0) {
      const token = this.actor.token?.object || this.actor.getActiveTokens()[0];
      if (token) { token.setTarget(true, { user: game.user, releaseOthers: false, groupSelection: false }); tempTarget = token; }
    }
    try {
      const mgr = globalThis.vagabond?.managers?.templates;
      if (mgr) await mgr.updatePreview(this.actor, this.spell.id, s.deliveryType, dist);
    } finally {
      if (tempTarget) tempTarget.setTarget(false, { user: game.user, releaseOthers: false, groupSelection: false });
    }
  }
  async _placeTemplate() {
    const s = this.spellState;
    if (!s.deliveryType) { ui.notifications.warn("Select a delivery type first!"); return; }
    const noTemplate = ['touch', 'remote', 'imbue', 'glyph'];
    if (noTemplate.includes(s.deliveryType)) { ui.notifications.info(`${s.deliveryType} delivery does not use an area template.`); return; }
    // If preview exists, make it permanent
    const mgr = globalThis.vagabond?.managers?.templates;
    const key = `${this.actor.id}-${this.spell.id}`;
    const previewId = mgr?.activePreviews?.get(key);
    if (previewId) {
      const template = canvas.scene.templates.get(previewId);
      if (template) {
        await template.update({ "flags.vagabond.isPreview": false });
        mgr.activePreviews.delete(key);
        this.spellState.previewActive = false;
        _saveSpellState(this.actor, this.spell, this.spellState);
        this.render();
        ui.notifications.info("Template placed.");
        return;
      }
    }
    // No preview — create from caster position
    const base = CONFIG.VAGABOND.deliveryBaseRanges?.[s.deliveryType];
    const inc  = CONFIG.VAGABOND.deliveryIncrement?.[s.deliveryType];
    const dist = base?.value ? base.value + inc * s.deliveryIncrease : 0;
    if (!dist) return;
    const token = this.actor.token?.object || this.actor.getActiveTokens()[0];
    const templateData = {
      distance: dist, fillColor: game.user.color || '#FF0000',
      direction: token?.document?.rotation || 0,
      flags: { vagabond: { spellId: this.spell.id, actorId: this.actor.id } },
    };
    switch (s.deliveryType) {
      case 'aura':   templateData.t = 'circle'; templateData.x = token?.center?.x ?? 0; templateData.y = token?.center?.y ?? 0; break;
      case 'cone':   templateData.t = 'cone'; templateData.angle = 90; templateData.x = token?.center?.x ?? 0; templateData.y = token?.center?.y ?? 0; break;
      case 'line':   templateData.t = 'ray'; templateData.width = canvas.scene?.grid?.distance ?? 5; templateData.x = token?.center?.x ?? 0; templateData.y = token?.center?.y ?? 0; break;
      case 'sphere': { templateData.t = 'circle'; const tgt = game.user.targets.first(); templateData.x = tgt?.center?.x ?? token?.center?.x ?? 0; templateData.y = tgt?.center?.y ?? token?.center?.y ?? 0; break; }
      case 'cube': {
        templateData.t = 'rect'; templateData.distance = dist * Math.sqrt(2); templateData.direction = 45;
        const tgt2 = game.user.targets.first();
        const cx = tgt2?.center?.x ?? token?.center?.x ?? 0; const cy = tgt2?.center?.y ?? token?.center?.y ?? 0;
        const gridPx = canvas.grid?.size ?? 100; const gridDist = canvas.scene?.grid?.distance ?? 5;
        const sidePx = (dist / gridDist) * gridPx;
        templateData.x = cx - sidePx / 2; templateData.y = cy - sidePx / 2; break;
      }
      default: ui.notifications.warn(`No template for delivery type: ${s.deliveryType}`); return;
    }
    try { await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [templateData]); ui.notifications.info("Template placed."); }
    catch (err) { console.error("Vagabond Crawler | Template placement failed:", err); }
  }
  async _cast() {
    const s     = this.spellState;
    const actor = this.actor;
    const spell = this.spell;
    const costs = _calcSpellCost(actor, spell, s);

    if (!s.deliveryType)                                          { ui.notifications.warn("Select a delivery type first!"); return; }
    if (costs.totalCost > (actor.system?.mana?.current   ?? 0))  { ui.notifications.error(`Not enough mana! Need ${costs.totalCost}.`); return; }
    if (costs.totalCost > (actor.system?.mana?.castingMax ?? 0)) { ui.notifications.error(`Exceeds casting max of ${actor.system?.mana?.castingMax}!`); return; }

    const manaSkillKey = actor.system?.classData?.manaSkill;
    if (!manaSkillKey)                          { ui.notifications.error("No mana skill configured!"); return; }
    if (!actor.system?.classData?.isSpellcaster){ ui.notifications.warn("Your class cannot cast spells!"); return; }
    if (actor.system?.autoFailAllRolls) {
      const { VagabondChatCard } = globalThis.vagabond.utils;
      await VagabondChatCard.autoFailRoll(actor, "spell", spell.name);
      return;
    }

    const targets = Array.from(game.user.targets).map(t => ({
      tokenId: t.id, sceneId: t.scene.id, actorId: t.actor?.id, actorName: t.name, actorImg: t.document.texture.src,
    }));

    try {
      // ── Roll ──────────────────────────────────────────────────────────────
      const skill = actor.system.skills[manaSkillKey];
      const difficulty = skill.difficulty;
      let roll = null, isSuccess = false, isCritical = false;

      if (spell.system?.noRollRequired) {
        isSuccess = true;
      } else {
        const { VagabondRollBuilder } = await import("/systems/vagabond/module/helpers/roll-builder.mjs");
        const rollData = actor.getRollDataWithItemEffects(spell);

        // Read actor's favor/hinder state (e.g. from Vulnerable/flanking)
        const favorHinder = VagabondRollBuilder.calculateEffectiveFavorHinder(
          actor.system.favorHinder || "none", false, false
        );

        // Set cast-check flag so Magic Ward penalty is injected
        setCastCheckFlag(true);
        try {
          roll = await VagabondRollBuilder.buildAndEvaluateD20WithRollData(rollData, favorHinder);
        } finally {
          setCastCheckFlag(false);
        }

        isSuccess  = roll.total >= difficulty;
        const critNum = VagabondRollBuilder.calculateCritThreshold(rollData, "spell");
        const d20 = roll.terms.find(t => t.constructor.name === "Die" && t.faces === 20);
        isCritical = (d20?.results?.[0]?.result ?? 0) >= critNum;
      }

      if (isSuccess) {
        await actor.update({ "system.mana.current": Math.max(0, actor.system.mana.current - costs.totalCost) });
        // Apply focus if requested
        if (s.focusAfterCast) {
          const current = actor.system.focus?.spellIds ?? [];
          const focusMax = actor.system.focus?.max ?? 5;
          if (!current.includes(spell.id) && current.length < focusMax) {
            const next = [...current, spell.id];
            await actor.update({ "system.focus.spellIds": next });
            if (next.length === 1) {
              await actor.toggleStatusEffect("focusing", { active: true });
            }
          }
        }
      }

      // ── Delivery text ─────────────────────────────────────────────────────
      const deliveryName = game.i18n.localize(CONFIG.VAGABOND.deliveryTypes[s.deliveryType]);
      const base     = CONFIG.VAGABOND.deliveryBaseRanges?.[s.deliveryType];
      const inc      = CONFIG.VAGABOND.deliveryIncrement?.[s.deliveryType];
      const totalVal = base?.value ? base.value + inc * s.deliveryIncrease : null;
      const areaText = totalVal
        ? (base.type === "count" ? `${totalVal} target${totalVal > 1 ? "s" : ""}` : `${totalVal}'`)
        : "";
      const deliveryText = areaText ? `${deliveryName} ${areaText}` : deliveryName;

      // ── Damage roll ───────────────────────────────────────────────────────
      const { VagabondDamageHelper } = await import("/systems/vagabond/module/helpers/damage-helper.mjs");
      const manaSkill = actor.system.skills[manaSkillKey];
      let damageRoll = null;
      if (spell.system?.damageType !== "-" && s.damageDice > 0 && VagabondDamageHelper.shouldRollDamage(isSuccess)) {
        damageRoll = await VagabondDamageHelper.rollSpellDamage(actor, spell, s, isCritical, manaSkill?.stat ?? "reason");
      }

      // ── Chat card ─────────────────────────────────────────────────────────
      const { VagabondChatCard } = globalThis.vagabond.utils;
      await VagabondChatCard.spellCast(actor, spell, {
        roll, difficulty, isSuccess, isCritical,
        manaSkill, manaSkillKey,
        spellState: s, costs, deliveryText,
      }, damageRoll, targets);

      // ── Spell FX ──────────────────────────────────────────────────────────
      try {
        const { VagabondSpellSequencer } = await import("/systems/vagabond/module/helpers/spell-sequencer.mjs");
        const casterToken = actor.token?.object ?? actor.getActiveTokens(true)[0];
        VagabondSpellSequencer.play(spell, s.deliveryType, s.deliveryIncrease, casterToken, Array.from(game.user.targets));
      } catch { /* non-fatal */ }

      // ── Cleanup ───────────────────────────────────────────────────────────
      await this._clearPreview();
      s.damageDice       = 1;
      s.deliveryIncrease = 0;
      s.useFx            = spell.system?.damageType === "-";
      s.previewActive    = false;
      s.focusAfterCast   = false;
      _saveSpellState(actor, spell, s);
      this.close();

    } catch (err) {
      console.error("Vagabond Crawler | Spell cast failed:", err);
      ui.notifications.error("Spell cast failed — check console.");
    }
  }
}
// ─── Damage Label Helpers ─────────────────────────────────────────────────────

function _npcDmgLabel(action) {
  const dmg = action.rollDamage || action.flatDamage;
  if (!dmg) return "";
  const type = action.damageType && action.damageType !== "-" ? ` ${action.damageType}` : "";
  return `<span class="vcs-menu-dmg">${dmg}${type}</span>`;
}

function _weaponDmgLabel(item) {
  const dmg = item.system?.damageTwoHands || item.system?.damageOneHand;
  if (!dmg) return "";
  const type = item.system?.damageType && item.system.damageType !== "-" ? ` ${item.system.damageType}` : "";
  return `<span class="vcs-menu-dmg">${dmg}${type}</span>`;
}

function _spellDmgLabel(item) {
  const type = item.system?.damageType;
  if (!type || type === "-") return `<span class="vcs-menu-dmg">effect</span>`;
  return `<span class="vcs-menu-dmg">spell</span>`;
}

// ─── Menu Data Builder ────────────────────────────────────────────────────────

function _buildMenuData(actor, isNPC) {
  if (isNPC) {
    const actions   = (actor.system?.actions   ?? []).map((a, i) => ({
      label: a.name || "Unnamed", dmg: _npcDmgLabel(a), type: "action", index: i,
    }));
    const abilities = (actor.system?.abilities ?? []).map((a, i) => ({
      label: a.name || "Unnamed", dmg: "", type: "ability", index: i,
    }));
    return { tabA: "Actions", tabB: "Abilities", itemsA: actions, itemsB: abilities };
  } else {
    const weapons = (actor.items?.filter(i =>
      i.type === "equipment" && i.system?.equipmentType === "weapon" && i.system?.equipmentState !== "unequipped"
    ) ?? []).map(item => ({
      label: item.name, dmg: _weaponDmgLabel(item), type: "weapon", itemId: item.id,
    }));
    const spells = (actor.items?.filter(i => i.type === "spell") ?? []).map(item => ({
      label: item.name, dmg: _spellDmgLabel(item), type: "spell", itemId: item.id,
    }));

    // Alchemist craft tab — known formulae for quick 5s crafting
    // Uses vagabond-character-enhancer API (gracefully degrades if not installed)
    let craftItems = [];
    const alchemyAPI = game.vagabondCharacterEnhancer?.alchemy;
    if (alchemyAPI?.getAlchemistData) {
      const alcData = alchemyAPI.getAlchemistData(actor);
      if (alcData?.tools && alcData.formulae.length > 0) {
        craftItems = alcData.formulae.map(name => ({
          label: name, dmg: `<span class="vcs-menu-dmg">5s</span>`,
          type: "craft", craftName: name,
        }));
      }
    }

    const result = { tabA: "Weapons", tabB: "Spells", itemsA: weapons, itemsB: spells };
    if (craftItems.length > 0) {
      result.tabC = "Craft";
      result.itemsC = craftItems;
    }

    // Beast form actions — polymorphed druid gets beast attacks in a new tab
    // Uses vagabond-character-enhancer API (gracefully degrades if not installed)
    const polymorphAPI = game.vagabondCharacterEnhancer?.polymorph;
    if (polymorphAPI?.getPolymorphMenuData) {
      const polyData = polymorphAPI.getPolymorphMenuData(actor);
      if (polyData?.actions?.length > 0) {
        // If polymorphed, beast actions replace weapons tab (beasts don't use weapons)
        result.tabA = "Beast";
        result.itemsA = [...polyData.actions, ...weapons];
      }
    }

    return result;
  }
}

// ─── Tab Strip HTML (injected BELOW card, outside overflow:hidden) ────────────

/**
 * Returns HTML for the visible tab strip that sits below the card.
 * This is rendered as a sibling to .vcs-member inside a .vcs-card-wrap div.
 */
export function buildTabStripHTML(actor, isNPC) {
  if (!actor) return "";
  const menu = _buildMenuData(actor, isNPC);
  const { tabA, tabB, itemsA, itemsB } = menu;
  const hasA = itemsA.length > 0;
  const hasB = itemsB.length > 0;
  const hasC = (menu.itemsC ?? []).length > 0;
  if (!hasA && !hasB && !hasC) return "";
  return `
    <div class="vcs-action-tabs" data-actor-id="${actor.id}">
      ${hasA ? `<button class="vcs-atab vcs-atab-active" data-tab="a">${tabA}</button>` : ""}
      ${hasB ? `<button class="vcs-atab ${!hasA ? "vcs-atab-active" : ""}" data-tab="b">${tabB}</button>` : ""}
      ${hasC ? `<button class="vcs-atab ${!hasA && !hasB ? "vcs-atab-active" : ""}" data-tab="c">${menu.tabC}</button>` : ""}
    </div>`;
}

// ─── Floating Panel (appended to strip root, absolutely positioned) ───────────

let _activePanel = null;
let _hideTimer   = null;

function _clearHideTimer() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

function _scheduleHide() {
  _clearHideTimer();
  _hideTimer = setTimeout(() => { _removePanel(); }, 200);
}

function _removePanel() {
  if (_activePanel) { _activePanel.remove(); _activePanel = null; }
}

function _showPanel(stripEl, cardWrap, actor, isNPC, activeTab) {
  _clearHideTimer();

  // Re-use existing panel for same actor
  if (_activePanel && _activePanel.dataset.actorId === actor.id) {
    // Switch tab if needed
    if (activeTab) _switchTab(_activePanel, activeTab);
    return;
  }

  _removePanel();

  const menu = _buildMenuData(actor, isNPC);
  const { tabA, tabB, itemsA, itemsB } = menu;
  const itemsC = menu.itemsC ?? [];
  const hasC = itemsC.length > 0;
  const startTab = activeTab ?? (itemsA.length ? "a" : itemsB.length ? "b" : "c");

  const renderItems = (items) => items.length
    ? items.map(it => {
        const dataAttrs = it.itemId
          ? `data-item-id="${it.itemId}"`
          : it.craftName
          ? `data-craft-name="${it.craftName}"`
          : `data-index="${it.index}"`;
        return `<div class="vcs-panel-item" data-type="${it.type}" ${dataAttrs}>
          <span class="vcs-panel-name">${it.label}</span>${it.dmg}
        </div>`;
      }).join("")
    : `<div class="vcs-panel-empty">None</div>`;

  const panel = document.createElement("div");
  panel.className = "vcs-action-panel";
  panel.dataset.actorId = actor.id;
  panel.dataset.tokenId = cardWrap.querySelector(".vcs-member")?.dataset.tokenId ?? "";
  panel.innerHTML = `
    <div class="vcs-panel-tabs">
      ${itemsA.length ? `<button class="vcs-ptab ${startTab === "a" ? "vcs-ptab-active" : ""}" data-tab="a">${tabA}</button>` : ""}
      ${itemsB.length ? `<button class="vcs-ptab ${startTab === "b" ? "vcs-ptab-active" : ""}" data-tab="b">${tabB}</button>` : ""}
      ${hasC ? `<button class="vcs-ptab ${startTab === "c" ? "vcs-ptab-active" : ""}" data-tab="c">${menu.tabC}</button>` : ""}
    </div>
    ${itemsA.length ? `<div class="vcs-panel-body" data-panel="a" style="${startTab !== "a" ? "display:none" : ""}">${renderItems(itemsA)}</div>` : ""}
    ${itemsB.length ? `<div class="vcs-panel-body" data-panel="b" style="${startTab !== "b" ? "display:none" : ""}">${renderItems(itemsB)}</div>` : ""}
    ${hasC ? `<div class="vcs-panel-body" data-panel="c" style="${startTab !== "c" ? "display:none" : ""}">${renderItems(itemsC)}</div>` : ""}`;

  // Position: align with cardWrap, below the tab strip
  stripEl.appendChild(panel);
  _activePanel = panel;

  // Position it
  _positionPanel(panel, cardWrap, stripEl);

  // Tab switching
  panel.querySelectorAll(".vcs-ptab").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); _switchTab(panel, btn.dataset.tab); });
  });

  // Item clicks
  panel.querySelectorAll(".vcs-panel-item").forEach(item => {
    item.addEventListener("click", async e => {
      e.stopPropagation();
      const tokenId = panel.dataset.tokenId;
      const token   = tokenId ? canvas.tokens?.get(tokenId) : null;
      const resolvedActor = token?.actor ?? game.actors.get(actor.id);
      if (!resolvedActor?.isOwner) { ui.notifications.warn("You don't control this character."); return; }
      await _fireAction(resolvedActor, item.dataset.type, item.dataset.index, item.dataset.itemId ?? item.dataset.craftName);
      _removePanel();
    });
  });

  // Keep panel alive while hovering it
  panel.addEventListener("mouseenter", _clearHideTimer);
  panel.addEventListener("mouseleave", _scheduleHide);
}

function _switchTab(panel, tab) {
  panel.querySelectorAll(".vcs-ptab").forEach(b => b.classList.toggle("vcs-ptab-active", b.dataset.tab === tab));
  panel.querySelectorAll(".vcs-panel-body").forEach(b => b.style.display = b.dataset.panel === tab ? "block" : "none");
}

function _positionPanel(panel, cardWrap, stripEl) {
  const wrapRect  = cardWrap.getBoundingClientRect();
  const stripRect = stripEl.getBoundingClientRect();
  // Position relative to strip (which is position:relative)
  const left = wrapRect.left - stripRect.left;
  const top  = wrapRect.bottom - stripRect.top + 2;
  panel.style.left = `${left}px`;
  panel.style.top  = `${top}px`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a target descriptor to its token actor (handles unlinked tokens). */
function _resolveTokenActor(target) {
  if (!target) return null;
  if (target.tokenId && target.sceneId) {
    const scene = game.scenes.get(target.sceneId);
    const tokenDoc = scene?.tokens?.get(target.tokenId);
    if (tokenDoc?.actor) return tokenDoc.actor;
  }
  return target.actorId ? game.actors.get(target.actorId) : null;
}

// ─── Action Firing ────────────────────────────────────────────────────────────

async function _fireAction(actor, type, indexStr, itemId) {
  const index = indexStr !== undefined ? parseInt(indexStr) : null;
  const targets = Array.from(game.user.targets).map(t => ({
    tokenId: t.id, sceneId: t.scene.id,
    actorId: t.actor?.id, actorName: t.name, actorImg: t.document.texture.src,
  }));
  const { VagabondChatCard } = globalThis.vagabond.utils;

  try {
    if (type === "action") {
      const action = actor.system?.actions?.[index]; if (!action) return;
      await VagabondChatCard.npcAction(actor, action, index, targets);

    } else if (type === "ability") {
      const ability = actor.system?.abilities?.[index]; if (!ability) return;
      await VagabondChatCard.npcAction(actor, ability, index);

    } else if (type === "weapon") {
      const item = actor.items.get(itemId); if (!item) return;
      const { VagabondChatCard } = globalThis.vagabond.utils;
      const favorHinder = actor.system?.favorHinder || "none";
      const attackResult = await item.rollAttack(actor, favorHinder);
      if (!attackResult) return;
      // FX
      try {
        const { VagabondItemSequencer } = await import("/systems/vagabond/module/helpers/item-sequencer.mjs");
        const casterToken = actor.token?.object ?? actor.getActiveTokens(true)[0] ?? null;
        VagabondItemSequencer.play(item, casterToken, Array.from(game.user.targets), attackResult.isHit);
      } catch { /* non-fatal */ }
      // Damage roll if hit
      let damageRoll = null;
      const isHit = attackResult.isHit ?? false;
      if (isHit || attackResult.isCritical) {
        damageRoll = await item.rollDamage(actor, attackResult.isCritical, attackResult.weaponSkill?.stat ?? null);
      }
      await VagabondChatCard.weaponAttack(actor, item, attackResult, damageRoll, targets);

      // NOTE: All alchemical post-attack effects (countdown dice, statuses,
      // splash damage, oil bonus) are handled by registerAlchemicalAttackHook()
      // and registerOilBonusDamageHook() in alchemy-helpers.mjs.
      // They fire via createChatMessage hook for BOTH crawl strip and character sheet attacks.

      await item.handleConsumption?.();

    } else if (type === "spell") {
      const item = actor.items.get(itemId); if (!item) return;
      CrawlerSpellDialog.show(actor, item);

    } else if (type === "beastaction") {
      // Beast form action — delegate to polymorph sheet's roll handler
      const { PolymorphSheet } = await import("/modules/vagabond-character-enhancer/scripts/polymorph/polymorph-sheet.mjs");
      const polyData = actor.getFlag("vagabond-character-enhancer", "polymorphData");
      if (polyData && index !== null) {
        await PolymorphSheet._rollBeastAction(actor, index, polyData);
      }

    } else if (type === "craft") {
      const craftName = itemId; // craftName passed via itemId parameter path
      await game.vagabondCharacterEnhancer?.alchemy?.craftItem?.(actor, craftName, true);
    }
  } catch (err) {
    console.error(`Vagabond Crawler | Action fire error (${type}):`, err);
    ui.notifications.error("Action failed — check console.");
  }
}

// ─── Event Binding ────────────────────────────────────────────────────────────

/**
 * Call this after each strip render.
 * Attaches hover listeners to .vcs-card-wrap elements that have a tab strip.
 */
export function bindActionMenuEvents(stripEl) {
  if (!stripEl) return;
  if (!game.settings.get(MODULE_ID, "npcActionMenu")) return;

  stripEl.querySelectorAll(".vcs-card-wrap[data-has-menu]").forEach(wrap => {
    const actorId = wrap.dataset.actorId;
    const isNPC   = wrap.dataset.isNpc === "1";
    const member  = wrap.querySelector(".vcs-member");
    const actor   = (() => {
      const tokenId = member?.dataset.tokenId;
      const token   = tokenId ? canvas.tokens?.get(tokenId) : null;
      return token?.actor ?? game.actors.get(actorId);
    })();
    if (!actor) return;

    const showMenu = () => _showPanel(stripEl, wrap, actor, isNPC, null);

    wrap.addEventListener("mouseenter", showMenu);
    wrap.addEventListener("mouseleave", _scheduleHide);

    // Tab clicks inside the tab strip also trigger correct tab
    wrap.querySelectorAll(".vcs-atab").forEach(btn => {
      btn.addEventListener("mouseenter", () => _showPanel(stripEl, wrap, actor, isNPC, btn.dataset.tab));
    });
  });
}

// Re-export old name so crawl-strip.mjs import still works
// (crawl-strip uses buildNPCMenuHTML + bindNPCMenuEvents — we redirect them below)
export function buildNPCMenuHTML(_actor) { return ""; } // no-op, menu is now in wrapCard
export function bindNPCMenuEvents(stripEl) { bindActionMenuEvents(stripEl); }
