/**
 * Vagabond Crawler — Spell Scroll Forge
 *
 * GM tool to create consumable Spell Scrolls.  A scroll stores a
 * pre-configured spell (delivery, dice, effects) and lets any character
 * cast it once — no mana cost, no Cast Check.  The scroll vaporizes on use.
 *
 * Value formula: 5g + 5g per mana the spell would normally require.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

// ── Mana cost calculator (mirrors npc-action-menu.mjs _calcSpellCost) ───────

function _calcManaCost(spell, state) {
  const hasDamage = spell.system?.damageType !== "-" && state.damageDice >= 1;
  const damageCost = hasDamage && state.damageDice > 1 ? state.damageDice - 1 : 0;
  const fxCost = state.useFx && hasDamage ? 1 : 0;
  const deliveryDefs = CONFIG.VAGABOND?.deliveryDefaults ?? {};
  const increaseCost = CONFIG.VAGABOND?.deliveryIncreaseCost ?? {};
  const deliveryBaseCost = state.deliveryType
    ? (deliveryDefs[state.deliveryType]?.cost ?? 0) : 0;
  const deliveryIncreaseCost = state.deliveryType
    ? state.deliveryIncrease * (increaseCost[state.deliveryType] ?? 0) : 0;
  return Math.max(0, damageCost + fxCost + deliveryBaseCost + deliveryIncreaseCost);
}

// ── ScrollForgeApp ──────────────────────────────────────────────────────────

class ScrollForgeApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-scroll-forge",
    tag: "div",
    window: { title: "Scroll Forge", resizable: false },
    position: { width: 420 },
    classes: ["vagabond-crawler-scroll-forge"],
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/scroll-forge.hbs" },
  };

  constructor() {
    super();
    this._spellCache = null;
    this._state = {
      spellUuid: "",
      damageDice: 1,
      deliveryType: "touch",
      deliveryIncrease: 0,
      useFx: false,
    };
    this._targetActor = null;
  }

  // ── Data ────────────────────────────────────────────────────────────────

  async _prepareContext() {
    if (!this._spellCache) {
      const pack = game.packs.get("vagabond.spells");
      if (pack) {
        const index = await pack.getIndex();
        this._spellCache = index.contents
          .map(e => ({ name: e.name, uuid: e.uuid, img: e.img }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } else {
        this._spellCache = [];
      }
    }

    const s = this._state;
    const spell = s.spellUuid ? await fromUuid(s.spellUuid) : null;

    const manaCost = spell ? _calcManaCost(spell, s) : 0;
    const goldValue = 5 + 5 * manaCost;
    const hasDamage = spell?.system?.damageType !== "-";

    const deliveryOptions = Object.entries(CONFIG.VAGABOND?.deliveryTypes ?? {})
      .map(([k, v]) => ({ value: k, label: game.i18n.localize(v), selected: k === s.deliveryType }));

    return {
      spells: this._spellCache,
      state: s,
      spell,
      spellName: spell?.name ?? "(none)",
      spellImg: spell?.img ?? "icons/svg/scroll.svg",
      hasDamage,
      manaCost,
      goldValue,
      deliveryOptions,
      targetActorName: this._targetActor?.name ?? "World Items",
    };
  }

  // ── Events ──────────────────────────────────────────────────────────────

  _onRender() {
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    el.querySelector(".vcscr-spell-select")?.addEventListener("change", ev => {
      this._state.spellUuid = ev.currentTarget.value;
      // Reset state for new spell
      this._state.damageDice = 1;
      this._state.deliveryIncrease = 0;
      this._state.useFx = false;
      this.render();
    }, { signal });

    el.querySelector("[data-action='dice-up']")?.addEventListener("click", () => {
      this._state.damageDice++;
      this.render();
    }, { signal });
    el.querySelector("[data-action='dice-down']")?.addEventListener("click", () => {
      if (this._state.damageDice > 0) this._state.damageDice--;
      this.render();
    }, { signal });

    el.querySelector(".vcscr-delivery-select")?.addEventListener("change", ev => {
      this._state.deliveryType = ev.currentTarget.value;
      this._state.deliveryIncrease = 0;
      this.render();
    }, { signal });

    el.querySelector("[data-action='inc-up']")?.addEventListener("click", () => {
      this._state.deliveryIncrease++;
      this.render();
    }, { signal });
    el.querySelector("[data-action='inc-down']")?.addEventListener("click", () => {
      if (this._state.deliveryIncrease > 0) this._state.deliveryIncrease--;
      this.render();
    }, { signal });

    el.querySelector("[data-action='toggle-fx']")?.addEventListener("click", () => {
      this._state.useFx = !this._state.useFx;
      this.render();
    }, { signal });

    el.querySelector("[data-action='create-scroll']")?.addEventListener("click", () => {
      this._createScroll();
    }, { signal });
  }

  // ── Create Scroll Item ──────────────────────────────────────────────────

  async _createScroll() {
    const s = this._state;
    if (!s.spellUuid) { ui.notifications.warn("Select a spell first."); return; }
    if (!s.deliveryType) { ui.notifications.warn("Select a delivery type."); return; }

    const spell = await fromUuid(s.spellUuid);
    if (!spell) { ui.notifications.error("Could not load spell."); return; }

    const manaCost = _calcManaCost(spell, s);
    const goldValue = 5 + 5 * manaCost;

    const deliveryName = game.i18n.localize(CONFIG.VAGABOND?.deliveryTypes?.[s.deliveryType] ?? s.deliveryType);
    const base = CONFIG.VAGABOND?.deliveryBaseRanges?.[s.deliveryType];
    const inc  = CONFIG.VAGABOND?.deliveryIncrement?.[s.deliveryType];
    const totalVal = base?.value ? base.value + inc * s.deliveryIncrease : null;
    const areaText = totalVal
      ? (base.type === "count" ? `${totalVal} target${totalVal > 1 ? "s" : ""}` : `${totalVal}'`)
      : "";
    const deliveryText = areaText ? `${deliveryName} ${areaText}` : deliveryName;

    const hasDamage = spell.system?.damageType !== "-" && s.damageDice > 0;
    const diceText = hasDamage ? `${s.damageDice}d6` : "";
    const fxText = s.useFx ? " + Fx" : "";
    const subtitle = `${deliveryText}${diceText ? " — " + diceText : ""}${fxText}`;

    const scrollData = {
      spellName: spell.name,
      spellUuid: s.spellUuid,
      spellImg: spell.img,
      damageType: spell.system?.damageType ?? "-",
      damageDice: s.damageDice,
      deliveryType: s.deliveryType,
      deliveryIncrease: s.deliveryIncrease,
      useFx: s.useFx,
      manaCost,
      deliveryText,
      causedStatuses: spell.system?.causedStatuses ?? [],
      critCausedStatuses: spell.system?.critCausedStatuses ?? [],
      canExplode: spell.system?.canExplode ?? false,
      explodeValues: spell.system?.explodeValues ?? "",
    };

    const itemData = {
      name: `Scroll of ${spell.name}`,
      type: "equipment",
      img: spell.img,
      system: {
        description: `<p><strong>Spell Scroll</strong> (${subtitle})</p><p>${spell.system?.description ?? ""}</p><p><em>Reading this scroll casts the spell. No Mana cost, no Cast Check. The scroll vaporizes after use.</em></p>`,
        equipmentType: "gear",
        isConsumable: true,
        quantity: 1,
        baseSlots: 0,
        baseCost: { gold: goldValue, silver: 0, copper: 0 },
        gearCategory: "Scrolls",
        lore: "Relic Parchment",
      },
      flags: { [MODULE_ID]: { spellScroll: scrollData } },
    };

    if (this._targetActor) {
      await this._targetActor.createEmbeddedDocuments("Item", [itemData], { skipStack: true });
    } else {
      await Item.create(itemData);
    }

    const target = this._targetActor?.name ?? "world items";
    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat"><i class="fas fa-scroll"></i> <strong>Scroll of ${spell.name}</strong> created (${subtitle}). Value: ${goldValue}g. Added to ${target}.</div>`,
      speaker: { alias: "Scroll Forge" },
    });

    ui.notifications.info(`Scroll of ${spell.name} created.`);
  }
}

// ── Use Scroll (cast + consume) ─────────────────────────────────────────────

async function _useScroll(item) {
  const scrollData = item.getFlag(MODULE_ID, "spellScroll");
  if (!scrollData) return;

  const actor = item.parent;
  if (!actor) { ui.notifications.warn("Scroll must be on a character."); return; }

  // Load spell from compendium for full data
  let spell = await fromUuid(scrollData.spellUuid).catch(() => null);
  if (!spell) {
    // Fallback: search by name
    const pack = game.packs.get("vagabond.spells");
    if (pack) {
      const index = await pack.getIndex();
      const entry = index.find(e => e.name === scrollData.spellName);
      if (entry) spell = await pack.getDocument(entry._id);
    }
  }
  if (!spell) { ui.notifications.error(`Could not find spell: ${scrollData.spellName}`); return; }

  const s = {
    damageDice: scrollData.damageDice ?? 1,
    deliveryType: scrollData.deliveryType ?? "touch",
    deliveryIncrease: scrollData.deliveryIncrease ?? 0,
    useFx: scrollData.useFx ?? false,
  };

  const targets = Array.from(game.user.targets).map(t => ({
    tokenId: t.id, sceneId: t.scene.id, actorId: t.actor?.id,
    actorName: t.name, actorImg: t.document.texture.src,
  }));

  try {
    // No d20 roll, no mana cost — auto-success
    const isSuccess = true;
    const isCritical = false;

    // Damage roll
    let damageRoll = null;
    const hasDamage = spell.system?.damageType !== "-" && s.damageDice > 0;
    if (hasDamage) {
      const { VagabondDamageHelper } = await import("../../../systems/vagabond/module/helpers/damage-helper.mjs");
      if (VagabondDamageHelper.shouldRollDamage(isSuccess)) {
        damageRoll = await VagabondDamageHelper.rollSpellDamage(actor, spell, s, isCritical, "reason");
      }
    }

    // Delivery text
    const deliveryName = game.i18n.localize(CONFIG.VAGABOND?.deliveryTypes?.[s.deliveryType] ?? s.deliveryType);
    const base = CONFIG.VAGABOND?.deliveryBaseRanges?.[s.deliveryType];
    const inc  = CONFIG.VAGABOND?.deliveryIncrement?.[s.deliveryType];
    const totalVal = base?.value ? base.value + inc * s.deliveryIncrease : null;
    const areaText = totalVal
      ? (base.type === "count" ? `${totalVal} target${totalVal > 1 ? "s" : ""}` : `${totalVal}'`)
      : "";
    const deliveryText = areaText ? `${deliveryName} ${areaText}` : deliveryName;

    // Chat card
    const { VagabondChatCard } = globalThis.vagabond.utils;
    await VagabondChatCard.spellCast(actor, spell, {
      roll: null, difficulty: 0, isSuccess, isCritical,
      manaSkill: null, manaSkillKey: null,
      spellState: s,
      costs: { damageCost: 0, fxCost: 0, deliveryBaseCost: 0, deliveryIncreaseCost: 0, totalCost: 0 },
      deliveryText,
    }, damageRoll, targets);

    // Spell FX
    try {
      const { VagabondSpellSequencer } = await import("../../../systems/vagabond/module/helpers/spell-sequencer.mjs");
      const casterToken = actor.token?.object ?? actor.getActiveTokens(true)[0];
      VagabondSpellSequencer.play(spell, s.deliveryType, s.deliveryIncrease, casterToken, Array.from(game.user.targets));
    } catch { /* non-fatal */ }

    // Consume scroll
    const qty = item.system?.quantity ?? 1;
    if (qty <= 1) {
      await item.delete();
    } else {
      await item.update({ "system.quantity": qty - 1 });
    }

    ChatMessage.create({
      content: `<div class="vagabond-crawler-chat"><i class="fas fa-scroll"></i> <strong>Scroll of ${spell.name}</strong> vaporizes!</div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });

  } catch (err) {
    console.error(`${MODULE_ID} | Scroll cast failed:`, err);
    ui.notifications.error("Scroll cast failed — check console.");
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export const ScrollForge = {
  _app: null,

  open(actor = null) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can use the Scroll Forge.");
      return;
    }
    if (!this._app) this._app = new ScrollForgeApp();
    this._app._targetActor = actor;
    this._app.render(true);
  },

  useScroll: _useScroll,

  /** Returns true if the item is a spell scroll. */
  isScroll(item) {
    return !!item?.getFlag(MODULE_ID, "spellScroll");
  },
};
