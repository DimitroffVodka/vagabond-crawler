/**
 * Vagabond Crawler — Light Tracker
 *
 * Context menu injection approach copied exactly from vagabond-extras/light-tracker.mjs.
 * Uses renderActorSheet hook + DOM injection on .inventory-card elements.
 * getItemContextOptions does NOT exist in Foundry v13 / Vagabond sheets.
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
    bright: 15, dim: 30,
    color: "#ffbb44", colorIntensity: 0.3,
    animation: { type: "torch", speed: 2, intensity: 3 },
  },
  "lantern-bullseye": {
    match:         name => /^lantern,?\s*bullseye$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    false,
    bright: 15, dim: 30,
    color: "#ffdd88", colorIntensity: 0.25,
    animation: { type: "torch", speed: 2, intensity: 2 },
  },
  candle: {
    match:         name => /^candle$/i.test(name.trim()),
    longevitySecs: 3600,
    consumable:    true,
    bright: 5, dim: 10,
    color: "#ffcc44", colorIntensity: 0.5,
    animation: { type: "torch", speed: 3, intensity: 3 },
  },
};

// ── Context menu injection (DOM-based, same as vagabond-extras) ───────────────

function _matchSource(name) {
  for (const [key, def] of Object.entries(LIGHT_SOURCES)) {
    if (def.match(name)) return key;
  }
  return null;
}

function _injectContextEntry(card, item) {
  card.addEventListener("contextmenu", () => {
    // Poll for the context menu rather than blindly waiting 60ms
    let attempts = 0;
    const poll = setInterval(() => {
      const menu = document.querySelector(".inventory-context-menu");
      if (menu) {
        clearInterval(poll);
        if (menu.querySelector(".vcl-ctx-item")) return;

        const isLit = !!item.getFlag(MODULE_ID, "lit");
        const secs  = item.getFlag(MODULE_ID, "remainingSecs") ?? 0;

        const li = document.createElement("li");
        li.className = "vcl-ctx-item";
        li.style.cssText = "padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-weight:bold;border-bottom:1px solid #555;list-style:none;";
        li.innerHTML = `<i class="fas fa-${isLit ? "wind" : "fire"}" style="width:14px"></i> ${isLit ? `Extinguish (${LightTracker._formatTime(secs)} left)` : "Light"}`;
        li.addEventListener("mouseenter", () => li.style.background = "rgba(240,192,64,0.15)");
        li.addEventListener("mouseleave", () => li.style.background = "");
        li.addEventListener("click", async ev => {
          ev.stopPropagation();
          menu.remove();
          await LightTracker._toggleLight(item);
        });
        menu.insertBefore(li, menu.firstChild);
      } else if (++attempts >= 10) {
        clearInterval(poll); // give up after 100ms
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
    if (!item || !_matchSource(item.name)) continue;
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

// ── LightTracker ──────────────────────────────────────────────────────────────

export const LightTracker = {

  _trackerApp: null,

  registerSettings() {
    // No additional settings — realtimeTracking registered in vagabond-crawler.mjs
  },

  // ── Real-time engine ─────────────────────────────────────────────────────────

  _intervalId: null,
  _tickAccum:  0,      // accumulated seconds not yet flushed to world time
  _TICK_FLUSH: 6,      // flush to DB every N real seconds (1 game round)

  startRealTime() {
    if (!game.user.isGM) return;
    if (this._intervalId) return;
    this._tickAccum  = 0;
    this._intervalId = setInterval(() => this._tick(), 1000);
    console.log(`${MODULE_ID} | Real-time light tracking started.`);
  },

  stopRealTime() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      if (this._tickAccum > 0) {
        game.time.advance(this._tickAccum);
        this._tickAccum = 0;
      }
      console.log(`${MODULE_ID} | Real-time light tracking stopped.`);
    }
  },

  _tick() {
    if (game.paused) return;
    if (!game.user.isGM) return;
    this._tickAccum += 1;
    if (this._tickAccum >= this._TICK_FLUSH) {
      game.time.advance(this._tickAccum);
      this._tickAccum = 0;
    }
  },

  init() {
    // Hook into all possible Vagabond sheet render events
    for (const hookName of [
      "renderVagabondCharacterSheet",
      "renderVagabondActorSheet",
      "renderActorSheet",
    ]) {
      Hooks.on(hookName, (app, html) => {
        const actor = app.actor ?? app.document;
        if (!actor) return;
        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (root) _watchSheet(root, actor);
      });
    }

    // Real-time burn via world time advancement
    let _ticking = false;
    Hooks.on("updateWorldTime", async (worldTime, delta) => {
      if (!game.user.isGM) return;
      if (!game.settings.get(MODULE_ID, "realtimeTracking")) return;
      if (_ticking || delta <= 0) return;
      _ticking = true;
      try {
        await this.advanceTime(delta);
      } finally {
        _ticking = false;
      }
    });

    // Re-render light tracker window when items update
    Hooks.on("updateItem", () => {
      if (this._trackerApp?.rendered) this._trackerApp.render();
    });
  },

  openTracker() {
    if (!this._trackerApp) this._trackerApp = new LightTrackerApp();
    this._trackerApp.render(true);
  },

  // ── Time advance ─────────────────────────────────────────────────────────────

  async advanceTime(secs) {
    if (!game.user.isGM) return;
    const actors = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    for (const actor of actors) {
      for (const item of actor.items) {
        if (!item.getFlag(MODULE_ID, "lit")) continue;
        const remaining    = item.getFlag(MODULE_ID, "remainingSecs") ?? 0;
        const newRemaining = remaining - secs;
        if (newRemaining <= 0) {
          await this._burnOut(item, actor);
        } else {
          await item.setFlag(MODULE_ID, "remainingSecs", newRemaining);
        }
      }
    }
    if (this._trackerApp?.rendered) this._trackerApp.render();
  },

  // ── Toggle / light / douse ───────────────────────────────────────────────────

  async _toggleLight(item) {
    const lit = item.getFlag(MODULE_ID, "lit") ?? false;
    if (lit) await this._douseLight(item);
    else     await this._lightItem(item);
    if (this._trackerApp?.rendered) this._trackerApp.render();
  },

  async _lightItem(item) {
    const key = _matchSource(item.name);
    if (!key) return;
    const def       = LIGHT_SOURCES[key];
    const remaining = item.getFlag(MODULE_ID, "remainingSecs") ?? def.longevitySecs;

    await item.setFlag(MODULE_ID, "lit",          true);
    await item.setFlag(MODULE_ID, "remainingSecs", remaining);
    await item.setFlag(MODULE_ID, "sourceKey",     key);

    // Apply light to all of the actor's active tokens on the current scene
    const actor = item.parent;
    if (actor) {
      for (const token of actor.getActiveTokens()) {
        await token.document.update({
          light: {
            bright:    def.bright,
            dim:       def.dim,
            color:     def.color,
            alpha:     def.colorIntensity,
            animation: def.animation,
          },
        });
      }
    }
    ui.notifications.info(`${item.name} lit. ${this._formatTime(remaining)} remaining.`);
  },

  async _douseLight(item) {
    await item.setFlag(MODULE_ID, "lit", false);
    const actor = item.parent;
    if (actor) {
      for (const token of actor.getActiveTokens()) {
        await token.document.update({
          light: { bright: 0, dim: 0, animation: { type: "none" } },
        });
      }
    }
    ui.notifications.info(`${item.name} doused.`);
  },

  async _burnOut(item, actor) {
    await item.setFlag(MODULE_ID, "lit",          false);
    await item.setFlag(MODULE_ID, "remainingSecs", 0);

    for (const token of actor.getActiveTokens()) {
      await token.document.update({ light: { bright: 0, dim: 0 } });
    }

    const key = item.getFlag(MODULE_ID, "sourceKey");
    const def = key ? LIGHT_SOURCES[key] : null;

    if (def?.consumable) {
      const qty = item.system.quantity ?? 1;
      if (qty <= 1) {
        await item.delete();
        await ChatMessage.create({
          content: `<div class="vagabond-crawler-chat light-out">
            <i class="fas fa-fire-flame-curved"></i>
            <strong>${actor.name}'s last ${item.name} has burned out!</strong>
          </div>`,
          speaker: { alias: "Light Tracker" },
        });
      } else {
        await item.update({ "system.quantity": qty - 1 });
        await item.setFlag(MODULE_ID, "remainingSecs", def.longevitySecs);
        await ChatMessage.create({
          content: `<div class="vagabond-crawler-chat light-out">
            <i class="fas fa-fire-flame-curved"></i>
            <strong>${actor.name}'s ${item.name} has burned out! (${qty - 1} remaining)</strong>
          </div>`,
          speaker: { alias: "Light Tracker" },
        });
      }
    } else {
      await ChatMessage.create({
        content: `<div class="vagabond-crawler-chat light-out">
          <i class="fas fa-fire-flame-curved"></i>
          <strong>${actor.name}'s ${item.name} ${def?.consumable ? "has burned out!" : "needs refueling!"}</strong>
        </div>`,
        speaker: { alias: "Light Tracker" },
      });
    }
  },

  // ── Helpers ──────────────────────────────────────────────────────────────────

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
    id:       `vagabond-crawler-light-tracker`,
    window:   { title: "Light Tracker", resizable: true },
    position: { width: 340, height: "auto" },
  };

  static PARTS = {
    form: { template: `modules/vagabond-crawler/templates/light-tracker.hbs` },
  };

  async _prepareContext() {
    const actors  = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    const entries = [];

    for (const actor of actors) {
      const litItems = actor.items.filter(i => i.getFlag(MODULE_ID, "lit"));
      const hasDarkvision = actor.items.some(i =>
        /dark.?vision|dark.?sight|allsight/i.test(i.name)
      );
      entries.push({
        actorId: actor.id,
        name:    actor.name,
        img:     actor.img,
        hasDarkvision,
        lights: litItems.map(i => {
          const secs = i.getFlag(MODULE_ID, "remainingSecs") ?? 0;
          const max  = LIGHT_SOURCES[i.getFlag(MODULE_ID, "sourceKey")]?.longevitySecs ?? 3600;
          return {
            id:            i.id,
            name:          i.name,
            remaining:     secs,
            formattedTime: LightTracker._formatTime(secs),
            pct:           Math.round((secs / max) * 100),
          };
        }),
      });
    }
    return { entries };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll(".vlt-douse").forEach(btn => {
      btn.addEventListener("click", async ev => {
        const { actorId, itemId } = ev.currentTarget.dataset;
        const item = game.actors.get(actorId)?.items.get(itemId);
        if (item) await LightTracker._douseLight(item);
      });
    });
  }
}
