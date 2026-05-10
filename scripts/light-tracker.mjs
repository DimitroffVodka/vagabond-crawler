/**
 * Vagabond Crawler — Light Tracker
 *
 * Architecture:
 * - updateWorldTime hook is single source of truth for burn deduction
 * - Real-time: setInterval accumulates seconds locally, flushes to game.time every 6s
 * - Light state on items: lit, remainingSecs, sourceKey (flags)
 * - Dropped lights: temporary Actor on canvas with VLT_LIGHT_ACTOR flag
 * - Pick up dropped light via Token HUD button
 * - Toggle from inventory right-click context menu
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

const LIGHT_SOURCES = {
  torch: {
    match:         name => /^torch$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 15, dim: 30,
    color: "#ff9900", colorIntensity: 0.4,
    animation: { type: "torch", speed: 5, intensity: 5 },
  },
  "lantern-hooded": {
    match:         name => /^lantern,?\s*hooded$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    false,
    fuel:          name => /^oil/i.test(name.trim()),
    bright: 15, dim: 30, angle: 90,
    color: "#ffbb44", colorIntensity: 0.3,
    animation: { type: "torch", speed: 2, intensity: 3 },
  },
  "lantern-bullseye": {
    match:         name => /^lantern,?\s*bullseye$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    false,
    fuel:          name => /^oil/i.test(name.trim()),
    bright: 30, dim: 60, angle: 360,
    color: "#ffdd88", colorIntensity: 0.25,
    animation: { type: "torch", speed: 2, intensity: 2 },
  },
  candle: {
    match:         name => /^candle(,?\s*basic)?$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 5, dim: 10,
    color: "#ffcc44", colorIntensity: 0.5,
    animation: { type: "torch", speed: 3, intensity: 3 },
  },
  "candle-calming": {
    match:         name => /^candle,?\s*calming$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 5, dim: 10,
    color: "#aaddff", colorIntensity: 0.4,
    animation: { type: "torch", speed: 2, intensity: 2 },
  },
  "candle-insectbane": {
    match:         name => /^candle,?\s*insectbane$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 5, dim: 10,
    color: "#99ee77", colorIntensity: 0.45,
    animation: { type: "torch", speed: 3, intensity: 3 },
  },
  "candle-restful": {
    match:         name => /^candle,?\s*restful$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 5, dim: 10,
    color: "#eebb88", colorIntensity: 0.4,
    animation: { type: "torch", speed: 2, intensity: 2 },
  },
  sunrod: {
    match:         name => /^sunrod$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 15, dim: 30,
    color: "#ffffaa", colorIntensity: 0.6,
    animation: { type: "sunburst", speed: 2, intensity: 4 },
  },
  "torch-tindertwig": {
    match:         name => /^torch,?\s*tindertwig$/i.test(name.trim()),
    longevitySecs: 999999,  // effectively infinite — never burns out
    consumable:    false,
    bright: 15, dim: 30,
    color: "#ff9900", colorIntensity: 0.4,
    animation: { type: "torch", speed: 5, intensity: 5 },
  },
  "torch-sentry": {
    match:         name => /^torch,?\s*sentry$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 15, dim: 30,
    color: "#ddddff", colorIntensity: 0.5,
    animation: { type: "torch", speed: 4, intensity: 4 },
  },
  "torch-repel-beast": {
    match:         name => /^torch,?\s*repel\s*beast$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 15, dim: 30,
    color: "#cc2200", colorIntensity: 0.5,
    animation: { type: "torch", speed: 5, intensity: 6 },
  },
  "torch-frigidflame": {
    match:         name => /^torch,?\s*frigidflame$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 15, dim: 30,
    color: "#88ccff", colorIntensity: 0.45,
    animation: { type: "torch", speed: 3, intensity: 4 },
  },
};

/**
 * Build the default lightSourcesConfig object from the hardcoded LIGHT_SOURCES constant.
 * Only editable fields are included — `match` and `fuel` functions are excluded.
 */
function _buildDefaultLightSourcesConfig() {
  const cfg = {};
  for (const [key, def] of Object.entries(LIGHT_SOURCES)) {
    cfg[key] = {
      bright:         def.bright,
      dim:            def.dim,
      color:          def.color,
      colorIntensity: def.colorIntensity,
      angle:          def.angle ?? 360,
      animation: {
        type:      def.animation?.type      ?? "torch",
        speed:     def.animation?.speed     ?? 5,
        intensity: def.animation?.intensity ?? 5,
        reverse:   def.animation?.reverse   ?? false,
      },
      longevitySecs: def.longevitySecs,
      consumable:    def.consumable ?? false,
      priority:      def.priority    ?? 0,
      isDarkness:    def.isDarkness  ?? false,
    };
  }
  return cfg;
}

const VLT_LIGHT_ACTOR_FLAG = "vlt-light-actor";

const DARK_LIGHT = { bright: 0, dim: 0, color: "#000000", alpha: 0, animation: { type: "none" } };

function _getLightDef(itemName) {
  for (const [key, def] of Object.entries(LIGHT_SOURCES)) {
    if (def.match(itemName)) {
      // Merge stored overrides (editable fields only) on top of the hardcoded defaults.
      // `match` and `fuel` are intentionally kept from the hardcoded constant.
      let mergedDef = def;
      try {
        const stored = game.settings.get(MODULE_ID, "lightSourcesConfig");
        const overrides = stored?.[key];
        if (overrides) {
          mergedDef = foundry.utils.mergeObject(
            foundry.utils.deepClone(def),
            overrides,
            { inplace: false }
          );
          // Restore function properties that can't survive serialisation
          mergedDef.match = def.match;
          if (def.fuel) mergedDef.fuel = def.fuel;
        }
      } catch (_e) { /* settings not yet registered — use raw def */ }
      return { key, def: mergedDef };
    }
  }
  return null;
}

function _isLightSource(item) { return !!_getLightDef(item.name); }

/** Find the party token that contains this actor as a gathered member. */
function _findPartyToken(actor) {
  if (!actor) return null;
  const actorUuid = actor.uuid;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor?.type !== "party") continue;
    const members = token.actor.system?.members ?? [];
    if (members.includes(actorUuid)) return token;
  }
  return null;
}

/** Check if any other gathered member in the party token has a lit light source. */
function _anyGatheredMemberLit(partyToken, excludeActor) {
  const members = partyToken.actor?.system?.members ?? [];
  for (const uuid of members) {
    const actor = fromUuidSync(uuid);
    if (!actor || actor.id === excludeActor?.id) continue;
    for (const item of actor.items) {
      if (item.getFlag(MODULE_ID, "lit")) return true;
    }
  }
  return false;
}

/** Find a fuel item on the actor matching the light def's fuel predicate.
 *  Prefers "Oil, flask" (plain lamp oil) over "Oil, Basic" (alchemical). */
function _findFuel(actor, def) {
  if (!def?.fuel || !actor) return null;
  const candidates = actor.items.filter(i => def.fuel(i.name) && (i.system?.quantity ?? 0) > 0);
  if (!candidates.length) return null;
  // Prefer flask oil (cheaper) over alchemical oil
  return candidates.find(i => /flask/i.test(i.name)) ?? candidates[0];
}

/** Consume one unit of fuel. Deletes the item if quantity reaches 0. */
async function _consumeFuel(fuelItem) {
  const qty = fuelItem.system.quantity ?? 1;
  if (qty <= 1) await fuelItem.delete();
  else await fuelItem.update({ "system.quantity": qty - 1 });
}

function _lightConfig(def) {
  return {
    bright: def.bright, dim: def.dim,
    color: def.color, alpha: def.colorIntensity,
    animation: def.animation,
    luminosity: 0.5, attenuation: 0.5,
    angle: def.angle ?? 360, shadows: 0,
    darkness: { min: 0, max: 1 },
  };
}

// Only scan player actors and dropped-light actors — skip hundreds of NPCs
function _getActiveActors() {
  return game.actors.filter(a =>
    a.hasPlayerOwner || a.getFlag(MODULE_ID, VLT_LIGHT_ACTOR_FLAG)
  );
}

// ── Context menu injection ────────────────────────────────────────────────────

function _injectContextEntry(card, item) {
  card.addEventListener("contextmenu", () => {
    if (card._ctxPoll) clearInterval(card._ctxPoll);
    let attempts = 0;
    const poll = card._ctxPoll = setInterval(() => {
      const menu = document.querySelector(".inventory-context-menu");
      if (menu) {
        clearInterval(poll);
        delete card._ctxPoll;
        if (menu.querySelector(".vcl-ctx-item")) return;
        const isLit = !!item.getFlag(MODULE_ID, "lit");
        const secs  = item.getFlag(MODULE_ID, "remainingSecs") ?? 0;
        const li = document.createElement("li");
        li.className = "vcl-ctx-item";
        li.innerHTML = `<i class="fas fa-${isLit ? "wind" : "fire"}"></i> ${isLit ? `Extinguish (${LightTracker._formatTime(secs)} left)` : "Light"}`;
        li.addEventListener("click", async ev => {
          ev.stopPropagation();
          menu.remove();
          await LightTracker._toggleLight(item);
        });
        menu.insertBefore(li, menu.firstChild);
      } else if (++attempts >= 10) {
        clearInterval(poll);
        delete card._ctxPoll;
      }
    }, 10);
  });
}

const _sheetObservers = new WeakMap();

function _attachToSheet(root, actor) {
  const cards = root.querySelectorAll(".inventory-card[data-item-id]");
  for (const card of cards) {
    if (card.dataset.vclBound) continue;
    const item = actor?.items?.get(card.dataset.itemId);
    if (!item || !_isLightSource(item)) continue;
    card.dataset.vclBound = "1";
    _injectContextEntry(card, item);
  }
}

function _watchSheet(root, actor) {
  _sheetObservers.get(root)?.disconnect();
  _attachToSheet(root, actor);
  const obs = new MutationObserver(mutations => {
    const hasNewCards = mutations.some(m =>
      [...m.addedNodes].some(n =>
        n.nodeType === 1 &&
        (n.classList?.contains("inventory-card") || n.querySelector?.(".inventory-card"))
      )
    );
    if (!hasNewCards) return;
    obs.disconnect();
    _attachToSheet(root, actor);
    setTimeout(() => obs.observe(root, { childList: true, subtree: true }), 200);
  });
  _sheetObservers.set(root, obs);
  obs.observe(root, { childList: true, subtree: true });
}

// ── Drop light on canvas ──────────────────────────────────────────────────────

async function _dropLightOnCanvas(item, dropX, dropY) {
  const actor = item.parent;
  if (!actor) return;
  const match = _getLightDef(item.name);
  if (!match) return;
  const { key, def } = match;

  const wasLit    = !!item.getFlag(MODULE_ID, "lit");
  const remaining = item.getFlag(MODULE_ID, "remainingSecs") ?? def.longevitySecs;
  const tokenLight = wasLit ? _lightConfig(def) : DARK_LIGHT;

  // Snap drop position to grid
  const snapX = Math.round(dropX / canvas.grid.size) * canvas.grid.size;
  const snapY = Math.round(dropY / canvas.grid.size) * canvas.grid.size;

  const lightActor = await Actor.create({
    name:  `${item.name} (dropped)`,
    type:  actor.type,
    img:   item.img,
    flags: {
      [MODULE_ID]: {
        [VLT_LIGHT_ACTOR_FLAG]: true,
        sourceActorId: actor.id,
        itemName:      item.name,
        itemImg:       item.img,
        sourceKey:     key,
        remainingSecs: remaining,
        lit:           wasLit,
      },
    },
    prototypeToken: {
      name:        item.name,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      actorLink:   true,
      width:       0.5,
      height:      0.5,
      texture:     { src: item.img, scaleX: 1, scaleY: 1 },
      light:       tokenLight,
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
  });

  await canvas.scene.createEmbeddedDocuments("Token", [{
    actorId:   lightActor.id,
    actorLink: true,
    x: snapX, y: snapY,
    width: 0.5, height: 0.5,
    name:    item.name,
    texture: { src: item.img },
    light:   tokenLight,
    hidden:  false,
  }]);

  if (wasLit) {
    const origToken = actor.token?.object ?? actor.getActiveTokens(true)[0];
    if (origToken) await origToken.document.update({ light: DARK_LIGHT });
  }

  await item.delete();

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">🔦</span><span><strong>${actor.name}</strong> dropped their <strong>${item.name}</strong>.</span></div>`,
  });
}

// ── Pick up dropped light ─────────────────────────────────────────────────────

async function _pickupLight(lightActor, token) {
  let targetActor;
  if (game.user.isGM) {
    const playerActors = game.actors.filter(a => a.hasPlayerOwner);
    const options = playerActors.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
    const actorId = await foundry.applications.api.DialogV2.prompt({
      window:      { title: "Pick Up Light Source" },
      content:     `<p>Assign to which character?</p><select name="actor" style="width:100%">${options}</select>`,
      ok:          { callback: (event, button) => button.form.elements.actor?.value },
      rejectClose: false,
    });
    if (!actorId) return;
    targetActor = game.actors.get(actorId);
  } else {
    targetActor = game.user.character;
    if (!targetActor) return ui.notifications.warn("You have no assigned character to pick this up.");
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "pickupLight", lightActorId: lightActor.id,
      tokenId: token.id, targetActorId: targetActor.id,
    });
    return;
  }
  await _doPickup(lightActor, token, targetActor);
}

const _pickingUp = new Set();

async function _doPickup(lightActor, token, targetActor) {
  if (_pickingUp.has(lightActor.id)) return;
  _pickingUp.add(lightActor.id);
  try {
  const flags     = lightActor.flags?.[MODULE_ID] ?? {};
  const itemName  = flags.itemName      ?? "Torch";
  const itemImg   = flags.itemImg       ?? "icons/sundries/lights/torch-brown.webp";
  const sourceKey = flags.sourceKey     ?? "torch";
  const remaining = flags.remainingSecs ?? 0;
  const wasLit    = flags.lit           ?? false;
  const def       = LIGHT_SOURCES[sourceKey];

  // skipStack: light sources with burn state must stay separate from unlit stacks
  const [newItem] = await targetActor.createEmbeddedDocuments("Item", [{
    name: itemName, type: "equipment", img: itemImg,
    system: { quantity: 1, equipmentType: "gear", isConsumable: true },
    flags: { [MODULE_ID]: { lit: wasLit, remainingSecs: remaining, sourceKey, tokenId: null } },
  }], { skipStack: true });

  if (wasLit && def) {
    const targetToken = targetActor.token?.object ?? targetActor.getActiveTokens(true)[0];
    if (targetToken) {
      await targetToken.document.update({ light: _lightConfig(def) });
      await newItem.update({ [`flags.${MODULE_ID}.tokenId`]: targetToken.id });
      try {
        const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(sourceKey);
        if (preset) await game.vagabondCrawler.animationFx.startPersistent(preset, targetToken);
      } catch (e) { console.warn("[vagabond-crawler] light FX pickup start failed:", e); }
    }
  }

  // Delete the token first, then the actor
  // (actorLink:true tokens are NOT auto-deleted when the actor is deleted)
  const sceneToken = canvas.tokens?.placeables.find(t => t.id === token?.id || t.document.actorId === lightActor.id);
  if (sceneToken) await sceneToken.document.delete();
  await lightActor.delete();

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">🤲</span><span><strong>${targetActor.name}</strong> picked up <strong>${itemName}</strong>. ${LightTracker._formatTime(remaining)} remaining.</span></div>`,
  });
  } finally {
    _pickingUp.delete(lightActor.id);
  }
}

// ── LightTracker ──────────────────────────────────────────────────────────────

export const LightTracker = {

  _trackerApp: null,

  registerSettings() {
    game.settings.register(MODULE_ID, "lightSourcesConfig", {
      scope:   "world",
      config:  false,
      type:    Object,
      default: _buildDefaultLightSourcesConfig(),
    });
  },

  /**
   * Return the effective light sources config: stored overrides merged on top of defaults.
   */
  getLightSourcesConfig() {
    const defaults = _buildDefaultLightSourcesConfig();
    let stored = {};
    try { stored = game.settings.get(MODULE_ID, "lightSourcesConfig") ?? {}; } catch (_e) {}
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(defaults),
      stored,
      { inplace: false }
    );
  },

  /**
   * Expose the default config builder for use by LightSourcesConfigApp reset actions.
   */
  _getDefaultLightSourcesConfig() {
    return _buildDefaultLightSourcesConfig();
  },

  /**
   * Open the Light Sources Configuration window.
   */
  openSourcesConfig() {
    import("./light-sources-config.mjs").then(({ LightSourcesConfigApp }) => {
      new LightSourcesConfigApp().render(true);
    });
  },

  _intervalId: null,
  _tickAccum:  0,
  _TICK_FLUSH: 6,

  startRealTime() {
    if (!game.user.isGM || this._intervalId) return;
    this._tickAccum  = 0;
    this._intervalId = setInterval(() => this._tick(), 1000);
  },

  stopRealTime() {
    if (!this._intervalId) return;
    clearInterval(this._intervalId);
    this._intervalId = null;
    if (this._tickAccum > 0) { game.time.advance(this._tickAccum); this._tickAccum = 0; }
  },

  _tick() {
    if (game.paused || !game.user.isGM) return;
    this._tickAccum += 1;
    if (this._tickAccum >= this._TICK_FLUSH) {
      game.time.advance(this._tickAccum);
      this._tickAccum = 0;
    }
  },

  init() {
    for (const hookName of ["renderVagabondCharacterSheet", "renderVagabondActorSheet", "renderActorSheet"]) {
      Hooks.on(hookName, (app, html) => {
        const actor = app.actor ?? app.document;
        if (!actor) return;
        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (root) _watchSheet(root, actor);
      });
    }

    // When a token is removed (gathered into party), transfer its light to the party token
    Hooks.on("deleteToken", async (tokenDoc) => {
      if (!game.user.isGM) return;
      const actor = tokenDoc.actor ?? game.actors.get(tokenDoc.actorId);
      if (!actor) return;
      const hasLit = actor.items.some(i => i.getFlag(MODULE_ID, "lit"));
      if (!hasLit) return;
      // Short delay to let the party update its member list
      setTimeout(async () => {
        const partyToken = _findPartyToken(actor);
        if (!partyToken) return;
        // Find the best light config from the gathered member's lit sources
        const litItem = actor.items.find(i => i.getFlag(MODULE_ID, "lit"));
        if (!litItem) return;
        const match = _getLightDef(litItem.name);
        if (!match) return;
        await partyToken.document.update({ light: _lightConfig(match.def) });
      }, 500);
    });

    let _ticking = false;
    Hooks.on("updateWorldTime", async (_worldTime, delta) => {
      if (!game.user.isGM) return;
      if (!game.settings.get(MODULE_ID, "realtimeTracking")) return;
      if (_ticking || delta <= 0) return;
      _ticking = true;
      try { await this.advanceTime(delta); } finally { _ticking = false; }
    });

    // Deleting a lit light item leaves the token's glow in place because the
    // item-side `lit:false` setFlag never gets a chance to run. Mirror the
    // douse cleanup on preDelete so the token light + persistent FX are
    // cleared before the item disappears.
    Hooks.on("preDeleteItem", async (item, _options, userId) => {
      // Only the user who initiated the delete runs the cleanup, so we don't
      // get duplicate token-light updates from every connected client. The
      // initiator is always the actor owner (delete perm), so they can also
      // update the token's light config.
      if (game.user.id !== userId) return;
      const lit = item.getFlag(MODULE_ID, "lit");
      if (!lit) return;
      const actor = item.parent;
      if (!actor) return;
      const sourceKey = item.getFlag(MODULE_ID, "sourceKey");
      const tokens = actor.getActiveTokens();
      const fx = game.vagabondCrawler?.animationFx;
      const targets = tokens.length ? tokens : (() => {
        const pt = _findPartyToken(actor);
        return pt && !_anyGatheredMemberLit(pt, actor) ? [pt] : [];
      })();
      for (const token of targets) {
        try { await token.document.update({ light: DARK_LIGHT }); } catch (e) { /* token gone or perms */ }
        if (sourceKey && fx) {
          try {
            const preset = fx.resolveGearPresetByLightType(sourceKey);
            if (preset) await fx.stopPersistent(preset, token);
          } catch (e) { console.warn("[vagabond-crawler] FX stop on item delete failed:", e); }
        }
      }
    });

    Hooks.on("dropCanvasData", async (_canvasObj, data) => {
      if (data.type !== "Item") return;
      let item;
      try { item = await fromUuid(data.uuid); } catch(e) { return; }
      if (!item || !_isLightSource(item) || !item.parent) return;
      if (game.user.isGM) {
        await _dropLightOnCanvas(item, data.x, data.y);
      } else {
        game.socket.emit(`module.${MODULE_ID}`, { action: "dropLight", itemUuid: data.uuid, x: data.x, y: data.y });
      }
      return false;
    });

    Hooks.on("renderTokenHUD", (hud, html, _data) => {
      const token = hud.object;
      const actor = token.actor;
      if (!actor?.getFlag(MODULE_ID, VLT_LIGHT_ACTOR_FLAG)) return;
      const root = html instanceof HTMLElement ? html : html[0];
      const btn  = document.createElement("div");
      btn.className = "control-icon vlt-pickup-btn";
      btn.title     = `Pick up ${actor.getFlag(MODULE_ID, "itemName") ?? "light source"}`;
      btn.innerHTML = `<i class="fas fa-hand-holding-hand"></i>`;
      (root.querySelector(".col.right") ?? root).prepend(btn);
      btn.addEventListener("click", async () => { hud.close(); await _pickupLight(actor, token); });
    });

    game.socket?.on(`module.${MODULE_ID}`, async data => {
      if (!game.user.isGM) return;
      if (data.action === "dropLight") {
        const item = await fromUuid(data.itemUuid).catch(() => null);
        if (item) await _dropLightOnCanvas(item, data.x, data.y);
      } else if (data.action === "pickupLight") {
        const lightActor  = game.actors.get(data.lightActorId);
        const tokenDoc    = canvas.tokens?.get(data.tokenId)?.document;
        const targetActor = game.actors.get(data.targetActorId);
        if (lightActor && tokenDoc && targetActor) await _doPickup(lightActor, tokenDoc, targetActor);
      }
    });

    Hooks.on("updateItem", () => { if (this._trackerApp?.rendered) this._trackerApp.render(); });
  },

  openTracker() {
    if (!this._trackerApp) this._trackerApp = new LightTrackerApp();
    this._trackerApp.render(true);
  },

  async advanceTime(secs) {
    if (!game.user.isGM) return;
    for (const actor of _getActiveActors()) {
      if (actor.getFlag(MODULE_ID, VLT_LIGHT_ACTOR_FLAG)) {
        if (!actor.getFlag(MODULE_ID, "lit")) continue;
        const key     = actor.getFlag(MODULE_ID, "sourceKey") ?? "torch";
        const maxSecs = LIGHT_SOURCES[key]?.longevitySecs ?? 3600;
        const prev = actor.getFlag(MODULE_ID, "remainingSecs") ?? 0;
        const next = Math.max(0, Math.min(maxSecs, prev - secs));
        await actor.setFlag(MODULE_ID, "remainingSecs", next);
        if (secs > 0 && next <= 0) {
          const itemName = actor.getFlag(MODULE_ID, "itemName") ?? "light source";
          await ChatMessage.create({
            content: `<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">🕯️</span><span>A dropped <strong>${itemName}</strong> has burned out!</span></div>`,
          });
          const burnedToken = canvas.tokens?.placeables.find(t => t.document.actorId === actor.id);
          if (burnedToken) await burnedToken.document.delete();
          await actor.delete();
        }
        continue;
      }
      for (const item of actor.items) {
        if (!item.getFlag(MODULE_ID, "lit")) continue;
        const srcKey  = item.getFlag(MODULE_ID, "sourceKey");
        const maxSecs = LIGHT_SOURCES[srcKey]?.longevitySecs ?? 3600;
        const prev = item.getFlag(MODULE_ID, "remainingSecs") ?? 0;
        const next = Math.max(0, Math.min(maxSecs, prev - secs));
        if (secs > 0 && next <= 0) await this._burnOut(item, actor);
        else await item.setFlag(MODULE_ID, "remainingSecs", next);
      }
    }
    if (this._trackerApp?.rendered) this._trackerApp.render();
  },

  async _toggleLight(item) {
    const lit = item.getFlag(MODULE_ID, "lit") ?? false;
    if (lit) await this._douseLight(item);
    else     await this._lightItem(item);
    if (this._trackerApp?.rendered) this._trackerApp.render();
  },

  async _lightItem(item) {
    const match = _getLightDef(item.name);
    if (!match) return;
    const { key, def } = match;
    const actor = item.parent;

    // Fuel check: lanterns require oil — only consume if no burn time remaining
    if (def.fuel && actor) {
      const remaining = item.getFlag(MODULE_ID, "remainingSecs") ?? 0;
      if (remaining <= 0) {
        const fuelItem = _findFuel(actor, def);
        if (!fuelItem) {
          ui.notifications.warn(`${item.name} needs fuel (oil) to light.`);
          return;
        }
        await _consumeFuel(fuelItem);
        await item.setFlag(MODULE_ID, "remainingSecs", def.longevitySecs);
        const fuelQty = (fuelItem.system?.quantity ?? 1) - 1;
        const note = fuelQty > 0 ? `(${fuelQty} oil remaining)` : "(last oil used)";
        ui.notifications.info(`${item.name}: oil consumed ${note}.`);
      }
    }

    // Split from stack: if quantity > 1, create a separate item with qty 1
    // and decrement the stack. Light the new item instead.
    const qty = item.system?.quantity ?? 1;
    if (qty > 1 && actor) {
      await item.update({ "system.quantity": qty - 1 });
      const newData = item.toObject();
      newData.system.quantity = 1;
      delete newData._id;
      const created = await actor.createEmbeddedDocuments("Item", [newData], { skipStack: true });
      item = created[0];
      if (!item) return;
    }

    const remaining = item.getFlag(MODULE_ID, "remainingSecs") ?? def.longevitySecs;
    await item.setFlag(MODULE_ID, "lit",          true);
    await item.setFlag(MODULE_ID, "remainingSecs", remaining);
    await item.setFlag(MODULE_ID, "sourceKey",     key);
    if (actor) {
      const tokens = actor.getActiveTokens();
      if (tokens.length) {
        for (const token of tokens) {
          await token.document.update({ light: _lightConfig(def) });
          try {
            const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(key);
            if (preset) await game.vagabondCrawler.animationFx.startPersistent(preset, token);
          } catch (e) { console.warn("[vagabond-crawler] light FX start failed:", e); }
        }
      } else {
        // No tokens on canvas — check if gathered into a party token
        const partyToken = _findPartyToken(actor);
        if (partyToken) {
          await partyToken.document.update({ light: _lightConfig(def) });
          try {
            const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(key);
            if (preset) await game.vagabondCrawler.animationFx.startPersistent(preset, partyToken);
          } catch (e) { console.warn("[vagabond-crawler] light FX start failed:", e); }
        }
      }
    }
    ui.notifications.info(`${item.name} lit. ${this._formatTime(remaining)} remaining.`);
  },

  async _douseLight(item) {
    const sourceKey = item.getFlag(MODULE_ID, "sourceKey");
    await item.setFlag(MODULE_ID, "lit", false);
    const actor = item.parent;
    if (actor) {
      const tokens = actor.getActiveTokens();
      if (tokens.length) {
        for (const token of tokens) {
          await token.document.update({ light: DARK_LIGHT });
          try {
            const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(sourceKey);
            if (preset) await game.vagabondCrawler.animationFx.stopPersistent(preset, token);
          } catch (e) { console.warn("[vagabond-crawler] light FX stop failed:", e); }
        }
      } else {
        // No tokens on canvas — remove light from party token if gathered
        const partyToken = _findPartyToken(actor);
        if (partyToken) {
          // Only douse if no other gathered member has a lit light source
          const stillLit = _anyGatheredMemberLit(partyToken, actor);
          if (!stillLit) {
            await partyToken.document.update({ light: DARK_LIGHT });
            try {
              const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(sourceKey);
              if (preset) await game.vagabondCrawler.animationFx.stopPersistent(preset, partyToken);
            } catch (e) { console.warn("[vagabond-crawler] light FX stop failed:", e); }
          }
        }
      }
    }
    ui.notifications.info(`${item.name} doused.`);
  },

  async _burnOut(item, actor) {
    await item.setFlag(MODULE_ID, "lit",          false);
    await item.setFlag(MODULE_ID, "remainingSecs", 0);

    const key = item.getFlag(MODULE_ID, "sourceKey");
    const def = key ? LIGHT_SOURCES[key] : null;

    // Helper: apply light config to actor's tokens or party token fallback
    // fxMode: "start" or "stop" — drives persistent FX alongside the light update
    const _applyLight = async (lightCfg, fxMode) => {
      const tokens = actor.getActiveTokens();
      if (tokens.length) {
        for (const token of tokens) {
          await token.document.update({ light: lightCfg });
          if (fxMode && key) {
            try {
              const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(key);
              if (preset) {
                if (fxMode === "stop") await game.vagabondCrawler.animationFx.stopPersistent(preset, token);
                else if (fxMode === "start") await game.vagabondCrawler.animationFx.startPersistent(preset, token);
              }
            } catch (e) { console.warn("[vagabond-crawler] light FX burnOut failed:", e); }
          }
        }
      } else {
        const pt = _findPartyToken(actor);
        if (pt) {
          if (lightCfg === DARK_LIGHT) {
            const stillLit = _anyGatheredMemberLit(pt, actor);
            if (!stillLit) {
              await pt.document.update({ light: DARK_LIGHT });
              if (fxMode === "stop" && key) {
                try {
                  const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(key);
                  if (preset) await game.vagabondCrawler.animationFx.stopPersistent(preset, pt);
                } catch (e) { console.warn("[vagabond-crawler] light FX burnOut failed:", e); }
              }
            }
          } else {
            await pt.document.update({ light: lightCfg });
            if (fxMode === "start" && key) {
              try {
                const preset = game.vagabondCrawler?.animationFx?.resolveGearPresetByLightType(key);
                if (preset) await game.vagabondCrawler.animationFx.startPersistent(preset, pt);
              } catch (e) { console.warn("[vagabond-crawler] light FX burnOut failed:", e); }
            }
          }
        }
      }
    };

    await _applyLight(DARK_LIGHT, "stop");

    if (def?.consumable) {
      const qty = item.system.quantity ?? 1;
      if (qty <= 1) {
        await item.delete();
        await ChatMessage.create({
          content: `<div class="vagabond-crawler-chat light-out"><i class="fas fa-fire-flame-curved"></i> <strong>${actor.name}'s last ${item.name} has burned out!</strong></div>`,
          speaker: { alias: "Light Tracker" },
        });
      } else {
        await item.update({ "system.quantity": qty - 1 });
        await item.setFlag(MODULE_ID, "remainingSecs", def.longevitySecs);
        await ChatMessage.create({
          content: `<div class="vagabond-crawler-chat light-out"><i class="fas fa-fire-flame-curved"></i> <strong>${actor.name}'s ${item.name} has burned out! (${qty - 1} remaining)</strong></div>`,
          speaker: { alias: "Light Tracker" },
        });
      }
    } else if (def?.fuel) {
      // Fuel-based light (lantern): try to auto-consume another oil and relight
      const fuelItem = _findFuel(actor, def);
      if (fuelItem) {
        await _consumeFuel(fuelItem);
        await item.setFlag(MODULE_ID, "lit", true);
        await item.setFlag(MODULE_ID, "remainingSecs", def.longevitySecs);
        await _applyLight(_lightConfig(def), "start");
        const remaining = (fuelItem.system?.quantity ?? 1) - 1;
        await ChatMessage.create({
          content: `<div class="vagabond-crawler-chat light-out"><i class="fas fa-fire-flame-curved"></i> <strong>${actor.name}'s ${item.name} oil burned out — refueled automatically.</strong> (${remaining} oil remaining)</div>`,
          speaker: { alias: "Light Tracker" },
        });
      } else {
        await ChatMessage.create({
          content: `<div class="vagabond-crawler-chat light-out"><i class="fas fa-fire-flame-curved"></i> <strong>${actor.name}'s ${item.name} has gone out — no oil remaining!</strong></div>`,
          speaker: { alias: "Light Tracker" },
        });
      }
    } else {
      await ChatMessage.create({
        content: `<div class="vagabond-crawler-chat light-out"><i class="fas fa-fire-flame-curved"></i> <strong>${actor.name}'s ${item.name} needs refueling!</strong></div>`,
        speaker: { alias: "Light Tracker" },
      });
    }
  },

  _formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  },

  applySync() {},
};

// ── Light Tracker App ─────────────────────────────────────────────────────────

const { ApplicationV2: AppV2, HandlebarsApplicationMixin: HbsMixin } = foundry.applications.api;

class LightTrackerApp extends HbsMixin(AppV2) {
  static DEFAULT_OPTIONS = {
    id:       "vagabond-crawler-light-tracker",
    window:   { title: "Light Tracker", resizable: true },
    position: { width: "auto", height: "auto" },
  };
  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/light-tracker.hbs" },
  };

  async _prepareContext() {
    const entries = [];
    for (const actor of _getActiveActors()) {
      if (actor.getFlag(MODULE_ID, VLT_LIGHT_ACTOR_FLAG)) {
        if (!actor.getFlag(MODULE_ID, "lit")) continue;
        const secs = actor.getFlag(MODULE_ID, "remainingSecs") ?? 0;
        entries.push({
          actorId: actor.id, name: "🔦 Dropped",
          img: actor.getFlag(MODULE_ID, "itemImg") ?? actor.img,
          lights: [{ id: null, actorId: actor.id,
                     name: actor.getFlag(MODULE_ID, "itemName") ?? actor.name,
                     remaining: secs, formattedTime: LightTracker._formatTime(secs), pct: 100 }],
        });
        continue;
      }
      const litItems = actor.items.filter(i => i.getFlag(MODULE_ID, "lit"));
      if (!litItems.length) continue;
      entries.push({
        actorId: actor.id, name: actor.name, img: actor.img,
        lights: litItems.map(i => {
          const secs = i.getFlag(MODULE_ID, "remainingSecs") ?? 0;
          const max  = LIGHT_SOURCES[i.getFlag(MODULE_ID, "sourceKey")]?.longevitySecs ?? 3600;
          return { id: i.id, actorId: actor.id, name: i.name,
                   remaining: secs, formattedTime: LightTracker._formatTime(secs),
                   pct: Math.round((secs / max) * 100) };
        }),
      });
    }
    const defaultMins = game.settings.get(MODULE_ID, "timePassesMinutes");
    return { entries, defaultMins };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    // Time Passes
    const minsInput = this.element.querySelector(".vlt-mins-input");
    minsInput?.addEventListener("change", ev => {
      const v = parseInt(ev.target.value);
      if (v > 0) game.settings.set(MODULE_ID, "timePassesMinutes", v);
    }, { signal });

    const _doTimePasses = async (multiplier) => {
      const mins = parseInt(minsInput?.value ?? game.settings.get(MODULE_ID, "timePassesMinutes"));
      if (!(mins > 0)) return;
      const adjusted = mins * multiplier;
      const { CrawlState } = await import("./crawl-state.mjs");
      await CrawlState.addTime(adjusted);
      // Positive adjusted = add time to torches (rewind burn), negative = burn torches down
      // advanceTime(secs) subtracts secs from remaining, so negate: adding mins means negative secs
      await LightTracker.advanceTime(-adjusted * 60);
      const label = multiplier > 0 ? "Time Added" : "Time Passes";
      const icon  = multiplier > 0 ? "fa-hourglass-start" : "fa-hourglass-half";
      await ChatMessage.create({
        content: `<div class="vagabond-crawler-chat"><i class="fas ${icon}"></i> <strong>${label}</strong> — ${Math.abs(adjusted)} minutes. (Total: ${CrawlState.formatElapsed()})</div>`,
        speaker: { alias: "Crawler" },
        whisper: game.users.filter(u => u.isGM).map(u => u.id),
      });
    };

    this.element.querySelector("[data-action='timePlus']")?.addEventListener("click", () => _doTimePasses(1), { signal });
    this.element.querySelector("[data-action='timeMinus']")?.addEventListener("click", () => _doTimePasses(-1), { signal });

    // Douse buttons
    this.element.querySelectorAll(".vlt-douse").forEach(btn => {
      btn.addEventListener("click", async ev => {
        const { actorId, itemId } = ev.currentTarget.dataset;
        const item = game.actors.get(actorId)?.items.get(itemId);
        if (item) await LightTracker._douseLight(item);
      }, { signal });
    });
  }
}
