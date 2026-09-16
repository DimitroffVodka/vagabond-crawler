/**
 * Vagabond Crawler — Relic Activations
 *
 * The relic powers a wielder *uses* rather than wears: Blasting, Precision,
 * After-Image I/II, Wish-Granting, Benediction and Store Spell. Activated from
 * the item's right-click menu on the sheet (or the API); uses are tracked on
 * the item in flags.vagabond-crawler.relicUses.
 *
 *   per day  — resets on a Crawler Rest, or once 24 hours of world time pass
 *   per week — (Benediction) resets once 7 days of world time pass
 *   ever     — (Wish-Granting) never resets
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { isWrapped, markWrapped } from "./wrap-guard.mjs";
import { distanceFt } from "./combat-helpers.mjs";

const DAY = 86400;

/** relicPower flag → activation definition. */
const POWERS = {
  "blasting":      { label: "Blast",            icon: "fa-explosion", period: "day",  use: (i, f) => RelicActivations.blast(i, f) },
  "precision":     { label: "Precision",        icon: "fa-bullseye",  period: "day",  use: i => RelicActivations.armPrecision(i) },
  "after-image-1": { label: "After-Image",      icon: "fa-clone",     period: "day",  use: i => RelicActivations.afterImage(i, 1) },
  "after-image-2": { label: "After-Image",      icon: "fa-clone",     period: "day",  use: i => RelicActivations.afterImage(i, 10) },
  "wish-granting": { label: "Invoke the Wish",  icon: "fa-star",      period: "ever", use: i => RelicActivations.wish(i) },
  "benediction":   { label: "Benediction",      icon: "fa-cross",     period: "week", use: null },  // fires itself at 0 HP
};

const PERIOD_SECS = { day: DAY, week: 7 * DAY, ever: Infinity };

/** Spends not yet written to the item (Benediction fires from a sync hook, and
 *  a second hit can land before the flag write finishes). */
const _pendingSpends = new Set();

/** Relic power flags on an item's effects (forged or generated relics). */
function _itemPowers(item) {
  if (!item?.getFlag(MODULE_ID, "relicForge")?.forged) return [];
  return [...item.effects].map(e => e.flags?.[MODULE_ID]).filter(f => f?.relicPower);
}

function _token(actor) {
  return actor?.token?.object ?? actor?.getActiveTokens?.()[0] ?? null;
}

export const RelicActivations = {

  /** Uses left for a power on an item (0 when spent this period). */
  usesLeft(item, powerKey) {
    const def = POWERS[powerKey];
    if (!def || _pendingSpends.has(`${item.uuid}:${powerKey}`)) return 0;
    const rec = item.getFlag(MODULE_ID, "relicUses")?.[powerKey];
    if (!rec) return 1;
    if (def.period !== "ever" && game.time.worldTime - (rec.at ?? 0) >= PERIOD_SECS[def.period]) return 1;
    return 0;
  },

  async _spend(item, powerKey) {
    const key = `${item.uuid}:${powerKey}`;
    _pendingSpends.add(key);
    try { await item.setFlag(MODULE_ID, "relicUses", { [powerKey]: { at: game.time.worldTime } }); }
    finally { _pendingSpends.delete(key); }
  },

  /** Crawler Rest: per-day powers come back; temporary stored-spell items go away. */
  async onRest(actors) {
    for (const actor of actors) {
      for (const item of actor.items) {
        const uses = item.getFlag(MODULE_ID, "relicUses");
        if (uses && Object.keys(uses).some(k => POWERS[k]?.period === "day")) {
          const kept = Object.fromEntries(Object.entries(uses).filter(([k]) => POWERS[k]?.period !== "day"));
          await item.unsetFlag(MODULE_ID, "relicUses");
          if (Object.keys(kept).length) await item.setFlag(MODULE_ID, "relicUses", kept);
        }
        if (item.getFlag(MODULE_ID, "storedSpellTemp")) await item.delete();
      }
    }
  },

  /** Right-click menu entries for an item. */
  menuEntries(item) {
    const entries = [];
    for (const f of _itemPowers(item)) {
      const def = POWERS[f.relicPower];
      if (def?.use) {
        const left = this.usesLeft(item, f.relicPower);
        entries.push({ icon: def.icon, label: left ? def.label : `${def.label} (spent)`, disabled: !left,
          run: async () => { if (await def.use(item, f) !== false) await this._spend(item, f.relicPower); } });
      }
      if (f.relicPower === "store-spell") {
        const stored = item.getFlag(MODULE_ID, "storedSpell");
        entries.push(stored
          ? { icon: "fa-wand-sparkles", label: `Cast stored ${stored.spellName}`, run: () => this.releaseSpell(item) }
          : { icon: "fa-wand-sparkles", label: "Store a casting", run: () => this.storeSpell(item) });
      }
    }
    if (game.user.isGM && item.getFlag(MODULE_ID, "relicUses")) {
      entries.push({ icon: "fa-rotate-left", label: "Reset relic uses", run: () => item.unsetFlag(MODULE_ID, "relicUses") });
    }
    return entries;
  },

  /* ── Blasting ─────────────────────────────────────────────────────────── */

  /** 6d6 to every other token in Close range, with the system's save buttons. */
  async blast(item, flags) {
    const actor = item.parent;
    const origin = _token(actor);
    if (!origin) { ui.notifications.warn(`${actor?.name ?? "The wielder"} needs a token on the scene to Blast.`); return false; }
    const close = CONFIG.VAGABOND?.closeRangeFeet ?? 5;
    const targets = canvas.tokens.placeables
      .filter(t => t !== origin && t.actor && !t.document.hidden && distanceFt(origin, t) <= close)
      .map(t => ({ tokenId: t.id, sceneId: t.scene.id, actorId: t.actor.id, actorName: t.name, actorImg: t.document.texture.src }));
    const roll = await new Roll(flags.blastDamage || "6d6").evaluate();
    const { VagabondChatCard } = globalThis.vagabond.utils;
    await VagabondChatCard.createActionCard({
      actor, item, title: `${item.name} — Blasting`, subtitle: actor.name,
      damageRoll: roll, damageType: "-", hasDefenses: true, attackType: "melee",
      description: `<p>A blast of energy erupts in a Close area around ${actor.name}.</p>`,
      targetsAtRollTime: targets,
    });
  },

  /* ── Precision ────────────────────────────────────────────────────────── */

  async armPrecision(item) {
    await item.setFlag(MODULE_ID, "precisionArmed", true);
    ui.notifications.info(`${item.name}: the next attack with it hits.`);
  },

  /* ── After-Image ──────────────────────────────────────────────────────── */

  /** An unlinked, translucent copy of the wielder's token beside them. Lasts
   *  `rounds` combat rounds (6 s of world time each outside combat). */
  async afterImage(item, rounds) {
    const actor = item.parent;
    const origin = _token(actor);
    if (!origin) { ui.notifications.warn(`${actor?.name ?? "The wielder"} needs a token on the scene.`); return false; }
    const data = origin.document.toObject();
    delete data._id;
    const gs = canvas.grid.size;
    Object.assign(data, {
      x: data.x + gs, name: `${origin.name} (After-Image)`, alpha: 0.55, actorLink: false,
      light: { dim: 0, bright: 0 },
    });
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.afterImage`, {
      combatId: game.combat?.id ?? null,
      expiresRound: game.combat ? game.combat.round + rounds : null,
      expiresAt: game.time.worldTime + rounds * 6,
    });
    // ponytail: I = 1 round, II = 10 rounds (1 minute) — the power text only says short/longer.
    await canvas.scene.createEmbeddedDocuments("Token", [data]);
  },

  _expireAfterImages() {
    if (game.user !== game.users.activeGM) return;
    const now = game.time.worldTime;
    for (const scene of game.scenes) {
      const gone = scene.tokens.filter(t => {
        const ai = t.getFlag(MODULE_ID, "afterImage");
        if (!ai) return false;
        const combat = ai.combatId ? game.combats.get(ai.combatId) : null;
        if (ai.combatId) return !combat || combat.round >= ai.expiresRound;
        return now >= ai.expiresAt;
      }).map(t => t.id);
      if (gone.length) scene.deleteEmbeddedDocuments("Token", gone);
    }
  },

  /* ── Wish-Granting ────────────────────────────────────────────────────── */

  async wish(item) {
    const actor = item.parent;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Wish-Granting" },
      content: `<p>Invoke ${item.name}'s single wish? It can never be used again.</p>`,
    });
    if (!ok) return false;
    await ChatMessage.create({
      content: `<p><i class="fas fa-star"></i> <strong>${actor?.name}</strong> invokes the wish of <strong>${item.name}</strong>. The GM decides what it grants.</p>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  },

  /* ── Benediction ──────────────────────────────────────────────────────── */

  /** preUpdateActor: a hit that would drop the wearer to 0 HP leaves them at 1
   *  instead, once per week, while the relic is equipped. */
  _onPreUpdateActor(actor, changes, _options, userId) {
    if (userId !== game.userId) return;
    const hp = foundry.utils.getProperty(changes, "system.health.value");
    if (hp === undefined || hp > 0 || (actor.system.health?.value ?? 0) <= 0) return;
    const effect = actor.appliedEffects.find(e => e.flags?.[MODULE_ID]?.relicPower === "benediction"
      && this.usesLeft(e.parent, "benediction"));
    if (!effect) return;
    foundry.utils.setProperty(changes, "system.health.value", 1);
    this._spend(effect.parent, "benediction");
    ChatMessage.create({
      content: `<p><i class="fas fa-cross"></i> <strong>${effect.parent.name}</strong> refuses to let <strong>${actor.name}</strong> die — they cling on at 1 HP.</p>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  },

  /* ── Store Spell ──────────────────────────────────────────────────────── */

  _storedSpellName(item) {
    const input = item.getFlag(MODULE_ID, "relicForge")?.userInputs?.["utility-store-spell"];
    if (input) return input;
    const eff = item.effects.find(e => e.flags?.[MODULE_ID]?.relicPower === "store-spell");
    return eff?.name.match(/\(([^)]+)\)/)?.[1] ?? null;
  },

  async _findSpell(name) {
    const pack = game.packs.get("vagabond.spells");
    const entry = pack?.index.find(e => e.name.toLowerCase() === name.toLowerCase());
    return entry ? pack.getDocument(entry._id) : null;
  },

  /** The owner pays by lowering their Max Mana by the casting's cost until it's cast. */
  async storeSpell(item) {
    const caster = item.parent;
    const name = this._storedSpellName(item);
    const spell = name ? await this._findSpell(name) : null;
    if (!spell) return ui.notifications.warn(`${item.name}: no spell named for Store Spell.`);
    if (!caster?.system?.mana?.max) return ui.notifications.warn(`${caster?.name ?? "The owner"} has no Mana to store a casting.`);

    const deliveries = Object.entries(CONFIG.VAGABOND.deliveryTypes)
      .map(([k, l]) => `<option value="${k}">${game.i18n.localize(l)}</option>`).join("");
    const state = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Store ${spell.name}` },
      content: `<div class="form-group"><label>Damage dice</label><input type="number" name="dice" value="${spell.system.damageType === "-" ? 0 : 1}" min="0"></div>
        <div class="form-group"><label>Delivery</label><select name="delivery">${deliveries}</select></div>
        <div class="form-group"><label>Effect</label><input type="checkbox" name="fx" ${spell.system.damageType === "-" ? "checked" : ""}></div>`,
      ok: { label: "Store", callback: (_e, button) => {
        const f = button.form.elements;
        return { damageDice: Number(f.dice.value) || 0, deliveryType: f.delivery.value, deliveryIncrease: 0, useFx: f.fx.checked };
      } },
    }).catch(() => null);
    if (!state) return;

    const { SpellCastDialog } = await import("/systems/vagabond/module/applications/spell-cast-dialog.mjs");
    const cost = SpellCastDialog.calculateCosts(spell, caster, state).totalCost;
    if (cost > caster.system.mana.max) return ui.notifications.warn(`Storing that casting costs ${cost} Mana — more than ${caster.name}'s Max Mana.`);

    const [ae] = await caster.createEmbeddedDocuments("ActiveEffect", [{
      name: `Stored Spell: ${spell.name}`, img: spell.img,
      changes: [{ key: "system.mana.bonus", mode: 2, value: String(-cost) }],
      flags: { [MODULE_ID]: { storedSpellFor: item.uuid } },
    }]);
    await item.setFlag(MODULE_ID, "storedSpell", { spellName: spell.name, spellUuid: spell.uuid, casterUuid: caster.uuid, cost, state, effectId: ae.id });
    ChatMessage.create({ content: `<p><i class="fas fa-wand-sparkles"></i> <strong>${caster.name}</strong> stores a casting of <strong>${spell.name}</strong> in ${item.name} (Max Mana −${cost}).</p>`,
      speaker: ChatMessage.getSpeaker({ actor: caster }) });
  },

  /** The wielder casts the stored spell with no Mana; the caster's Max Mana returns. */
  async releaseSpell(item) {
    const stored = item.getFlag(MODULE_ID, "storedSpell");
    const wielder = item.parent;
    if (!stored || !wielder) return;
    const spell = await fromUuid(stored.spellUuid);
    if (!spell) return ui.notifications.warn(`${item.name}: the stored spell can't be found.`);

    // The cast needs the spell on the wielder; it stays (for its chat-card buttons) until their next Rest.
    const [temp] = await wielder.createEmbeddedDocuments("Item", [foundry.utils.mergeObject(spell.toObject(), {
      name: `${spell.name} (${item.name})`, [`flags.${MODULE_ID}.storedSpellTemp`]: true,
    })]);
    const { SpellHandler } = await import("/systems/vagabond/module/sheets/handlers/spell-handler.mjs");
    const handler = new SpellHandler({ actor: wielder });
    handler.spellStates = {};
    handler._saveSpellStates = () => {};
    handler._updateSpellDisplay = () => {};
    handler._trinketGateStatus = () => ({ status: "ok" });  // the relic is the focus
    const { SpellCastDialog } = await import("/systems/vagabond/module/applications/spell-cast-dialog.mjs");
    const cost = SpellCastDialog.calculateCosts(temp, wielder, stored.state).totalCost;
    const messagesBefore = game.messages.size;
    await handler._executeCast({ preventDefault() {}, altKey: false }, temp.id, { ...stored.state }, -cost);

    // _executeCast returns nothing; the charge is spent only if a cast card went out.
    if (game.messages.size === messagesBefore) { await temp.delete(); return; }
    const caster = await fromUuid(stored.casterUuid);
    await caster?.effects.get(stored.effectId)?.delete();
    await item.unsetFlag(MODULE_ID, "storedSpell");
  },

  /* ── Wiring ───────────────────────────────────────────────────────────── */

  async init() {
    // Precision: the next attack with an armed relic hits.
    const { VagabondItem } = await import("/systems/vagabond/module/documents/item.mjs");
    if (VagabondItem?.prototype?.rollAttack && !isWrapped(VagabondItem.prototype, "rollAttack:precision")) {
      const orig = VagabondItem.prototype.rollAttack;
      VagabondItem.prototype.rollAttack = async function (...args) {
        const result = await orig.apply(this, args);
        if (result && this.getFlag?.(MODULE_ID, "precisionArmed")) {
          result.isHit = true;
          await this.unsetFlag(MODULE_ID, "precisionArmed");
        }
        return result;
      };
      markWrapped(VagabondItem.prototype, "rollAttack:precision");
    }

    Hooks.on("preUpdateActor", this._onPreUpdateActor.bind(this));
    Hooks.on("updateCombat", () => this._expireAfterImages());
    Hooks.on("deleteCombat", () => this._expireAfterImages());
    Hooks.on("updateWorldTime", () => this._expireAfterImages());

    const attach = (sheet) => {
      const el = sheet.element;
      const actor = sheet.actor;
      if (!el || !actor) return;
      for (const card of el.querySelectorAll(".inventory-card[data-item-id]")) {
        if (card.dataset.vcRelicBound) continue;
        const item = actor.items.get(card.dataset.itemId);
        if (!_itemPowers(item).some(f => POWERS[f.relicPower]?.use || f.relicPower === "store-spell")) continue;
        card.dataset.vcRelicBound = "1";
        card.addEventListener("contextmenu", () => {
          let attempts = 0;
          const poll = setInterval(() => {
            const menu = document.querySelector(".inventory-context-menu");
            if (!menu) { if (++attempts >= 10) clearInterval(poll); return; }
            clearInterval(poll);
            if (menu.querySelector(".vc-relic-ctx")) return;
            for (const entry of this.menuEntries(item).reverse()) {
              const li = document.createElement("div");
              li.className = "context-menu-item vc-relic-ctx";
              if (entry.disabled) li.style.opacity = "0.5";
              li.innerHTML = `<i class="fas ${entry.icon}"></i><span>${entry.label}</span>`;
              li.addEventListener("click", async ev => {
                ev.stopPropagation();
                menu.remove();
                if (!entry.disabled) await entry.run();
              });
              menu.insertBefore(li, menu.firstChild);
            }
          }, 10);
        });
      }
    };
    for (const hook of ["renderVagabondCharacterSheet", "renderVagabondNPCSheet", "renderActorSheet"]) Hooks.on(hook, attach);
  },
};
