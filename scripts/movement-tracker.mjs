/**
 * Vagabond Crawler — Movement Tracker
 *
 * Crawl mode: hard-blocks movement beyond crawl speed, deducts on move.
 * Combat mode: deducts movement, colors ruler green/yellow/red but does NOT block.
 *
 * Key insight from console data:
 *   - waypoint.cost = cost of THAT segment (per-step, not cumulative)
 *   - passedWaypoints = segments already committed this drag
 *   - pendingWaypoints = speculative path ahead (cursor position)
 *   - movementId changes every segment — each is a new transaction
 *   - Total cost = sum of all passed costs + sum of pending costs
 */

import { MODULE_ID }  from "./vagabond-crawler.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";

// ── VCS TokenRuler subclass ───────────────────────────────────────────────────

class VCSTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {

  /** Total ft of full path, updated every refresh(). */
  _vcsTotalFt = 0;

  /** Map from waypoint object → cumulative ft at that waypoint. */
  _vcsCumulativeMap = new Map();

  // ── Helpers ──────────────────────────────────────────────────────────────

  get _moveRemaining() {
    const actor = this.token?.actor;
    if (!actor) return Infinity;
    const s = actor.system.speed;
    const baseSpeed = CrawlState.paused ? (s?.base ?? 30) : (s?.crawl ?? 90);
    return actor.getFlag(MODULE_ID, "moveRemaining") ?? baseSpeed;
  }

  get _isTracked() {
    if (!CrawlState.active) return false;
    const actor = this.token?.actor;
    if (!actor || actor.type !== "character") return false;
    return !!CrawlState.members.find(m => m.actorId === actor.id);
  }

  _sumCosts(waypoints) {
    return (waypoints ?? []).reduce((sum, wp) => sum + (wp?.cost ?? 0), 0);
  }

  _cumulativeAt(waypoint) {
    return this._vcsCumulativeMap.get(waypoint) ?? 0;
  }

  _colorForFt(ft) {
    const r = this._moveRemaining;
    if (ft <= r)     return 0x00cc00;
    if (ft <= r * 2) return 0xddaa00;
    return 0xcc2200;
  }

  _clearHighlight() {
    const layerName = `TokenRuler.${this.token.id}`;
    canvas.interface.grid.clearHighlightLayer(layerName);
  }

  clear() {
    this._clearHighlight();
    super.clear();
  }

  // ── refresh: build cumulative map, clamp pending to budget ───────────────

  refresh({ passedWaypoints, pendingWaypoints, plannedMovement }) {
    const passed  = passedWaypoints ?? [];
    const pending = pendingWaypoints ?? [];

    // Build cumulative cost map: each waypoint → running total ft to reach it
    this._vcsCumulativeMap.clear();
    let running = 0;
    for (const wp of passed) {
      running += (wp?.cost ?? 0);
      this._vcsCumulativeMap.set(wp, running);
    }
    const spentFt = running;

    // Continue into pending
    let pendingRunning = spentFt;
    for (const wp of pending) {
      pendingRunning += (wp?.cost ?? 0);
      this._vcsCumulativeMap.set(wp, pendingRunning);
    }
    this._vcsTotalFt = pendingRunning;

    // In crawl enforcement mode: clamp pending to remaining budget
    if (this._isTracked && !CrawlState.paused
        && game.settings.get(MODULE_ID, "enforceCrawlMovement")) {

      const remaining = this._moveRemaining;
      const budget    = remaining - spentFt;

      if (budget <= 0) {
        this._clearHighlight();
        return super.refresh({ passedWaypoints, pendingWaypoints: [], plannedMovement });
      }

      let accumulated = 0;
      let cutIdx = -1;
      for (let i = 0; i < pending.length; i++) {
        accumulated += (pending[i]?.cost ?? 0);
        if (accumulated <= budget) cutIdx = i;
        else break;
      }

      const clampedPending = cutIdx >= 0 ? pending.slice(0, cutIdx + 1) : [];
      if (clampedPending.length < pending.length) this._clearHighlight();
      return super.refresh({ passedWaypoints, pendingWaypoints: clampedPending, plannedMovement });
    }

    super.refresh({ passedWaypoints, pendingWaypoints, plannedMovement });
  }

  // ── Style overrides ──────────────────────────────────────────────────────

  _getSegmentStyle(waypoint) {
    const base = super._getSegmentStyle(waypoint);
    if (!this._isTracked) return base;
    base.color = this._colorForFt(this._cumulativeAt(waypoint));
    return base;
  }

  _getWaypointStyle(waypoint) {
    const base = super._getWaypointStyle(waypoint);
    if (!this._isTracked) return base;
    base.color = this._colorForFt(this._cumulativeAt(waypoint));
    return base;
  }

  _getGridHighlightStyle(waypoint, offset) {
    const base = super._getGridHighlightStyle(waypoint, offset);
    if (!this._isTracked) return base;
    if (this._cumulativeAt(waypoint) > this._moveRemaining) {
      base.color = 0xcc2200;
      base.alpha = Math.min(1, (base.alpha ?? 0.25) * 1.5);
    }
    return base;
  }

  _getWaypointLabelContext(waypoint, state) {
    const base = super._getWaypointLabelContext(waypoint, state);
    if (!this._isTracked || !base) return base;
    const after = Math.max(0, this._moveRemaining - this._cumulativeAt(waypoint));
    base.label  = base.label ? `${base.label} (${after}ft left)` : `${after}ft left`;
    return base;
  }
}

// ── MovementTracker ───────────────────────────────────────────────────────────

export const MovementTracker = {

  _lastPos: {},

  registerSettings() {
    game.settings.register(MODULE_ID, "enforceCrawlMovement", {
      name: "Enforce Crawl Movement",
      hint: "Block tokens from moving beyond their crawl speed during the Heroes phase.",
      scope: "world", config: true, type: Boolean, default: true,
    });
  },

  init() {
    CONFIG.Token.rulerClass = VCSTokenRuler;
    console.log("vagabond-crawler | Registered VCSTokenRuler");

    // CONFIG.Token.rulerClass only affects newly created tokens.
    // Swap ruler instances on all tokens already on canvas.
    this._installRulers();
    Hooks.on("canvasReady", () => this._installRulers());

    canvas.tokens?.placeables?.forEach(t => {
      this._lastPos[t.id] = { x: t.x, y: t.y };
    });

    Hooks.on("createToken", doc => {
      this._lastPos[doc.id] = { x: doc.x, y: doc.y };
    });

    Hooks.on("preUpdateToken", (doc, changes, _opts, userId) => {
      return this._onPreUpdate(doc, changes, userId);
    });

    Hooks.on("updateToken", (doc, changes) => {
      if (changes.x !== undefined || changes.y !== undefined) {
        this._lastPos[doc.id] = { x: doc.x, y: doc.y };
        // Delay clear to after #continueMovement finishes all segments
        const tokenId = doc.id;
        clearTimeout(this._clearTimers?.[tokenId]);
        this._clearTimers ??= {};
        this._clearTimers[tokenId] = setTimeout(() => {
          const token = canvas.tokens?.get(tokenId);
          token?.ruler?.clear();
          // Also hide the grid highlight layer directly
          const highlight = canvas.interface.grid.highlight.children
            ?.find(c => c.name === `TokenRuler.${tokenId}`);
          if (highlight) highlight.visible = false;
        }, 100);
      }
    });

    Hooks.on("getTokenContextOptions", (token, options) => {
      if (!game.user.isGM) return;
      const member = CrawlState.members.find(m => m.tokenId === token.id);
      if (!member || member.type !== "player") return;
      options.push({
        name: "Rollback Movement",
        icon: '<i class="fas fa-rotate-left"></i>',
        condition: () => CrawlState.active && CrawlState.isHeroesPhase,
        callback: () => this.rollback(token.id),
      });
    });

    Hooks.on("controlToken", (token, controlled) => {
      // Clear all rulers when token selection changes — catches any stale ghost trails
      canvas.tokens?.placeables?.forEach(t => {
        if (t.ruler && !t.isMoving) t.ruler.clear();
      });
    });

    Hooks.on("combatStart", async () => {
      if (!CrawlState.active || !game.user.isGM) return;
      await this.resetAll();
    });

    Hooks.on("updateCombat", async (combat, changes) => {
      if (!CrawlState.active || !game.user.isGM) return;
      if (changes.round === undefined) return;
      await this.resetAll();
    });
  },

  // ── Ruler installation ────────────────────────────────────────────────────

  _installRulers() {
    const tokens = canvas.tokens?.placeables ?? [];
    for (const token of tokens) {
      if (token.ruler instanceof VCSTokenRuler) continue;
      try { token.ruler?.destroy(); } catch(e) {}
      token.ruler = new VCSTokenRuler(token);
      token.ruler.draw().catch(() => {});
      console.log(`vagabond-crawler | Installed VCSTokenRuler on ${token.name}`);
    }
  },

  // ── preUpdateToken ────────────────────────────────────────────────────────

  _onPreUpdate(doc, changes, userId) {
    if (!CrawlState.active) return;
    if (changes.x === undefined && changes.y === undefined) return;

    const actor = doc.actor;
    if (!actor || actor.type !== "character") return;

    const member = CrawlState.members.find(m => m.actorId === actor.id);
    if (!member) return;

    const scene    = doc.parent;
    const gridSize = scene?.grid?.size     ?? 100;
    const gridDist = scene?.grid?.distance ?? 5;

    const s             = actor.system.speed;
    const inCombat      = CrawlState.paused;
    const baseSpeed     = inCombat ? (s?.base ?? 0) : (s?.crawl ?? 0);
    const moveRemaining = actor.getFlag(MODULE_ID, "moveRemaining") ?? baseSpeed;

    // ── Crawl: safety-net block (ruler clamping should prevent reaching here) ──
    if (!inCombat && game.settings.get(MODULE_ID, "enforceCrawlMovement")) {
      const dx = ((changes.x ?? doc.x) - doc.x) / gridSize;
      const dy = ((changes.y ?? doc.y) - doc.y) / gridSize;
      const segFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;

      if (segFt > moveRemaining) {
        if (userId === game.userId) {
          ui.notifications.warn(`${actor.name}: only ${moveRemaining}ft remaining.`);
          // Schedule repeated clear attempts — #continueMovement may redraw after our first clear
          const tokenId = doc.id;
          let attempts = 0;
          const clearLoop = setInterval(() => {
            const token = canvas.tokens?.get(tokenId);
            token?.ruler?.clear();
            const h = canvas.interface?.grid?.highlight?.children
              ?.find(c => c.name === `TokenRuler.${tokenId}`);
            if (h) h.visible = false;
            if (++attempts >= 10) clearInterval(clearLoop);
          }, 50);
        }
        return false;
      }
    }

    // ── Deduct this segment ───────────────────────────────────────────────
    const dx = ((changes.x ?? doc.x) - doc.x) / gridSize;
    const dy = ((changes.y ?? doc.y) - doc.y) / gridSize;
    const distanceFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;
    if (distanceFt === 0) return;

    const newRemaining = Math.max(0, Math.round((moveRemaining - distanceFt) / 5) * 5);
    actor.setFlag(MODULE_ID, "moveRemaining", newRemaining)
      .then(() => CrawlStrip.updateMember(actor.id));
  },

  // ── Rollback ──────────────────────────────────────────────────────────────

  async rollback(tokenId) {
    const last = this._lastPos[tokenId];
    if (!last) { ui.notifications.warn("No previous position recorded."); return; }

    const token = canvas.tokens?.get(tokenId);
    const doc   = token?.document;
    if (!doc) return;

    const actor    = doc.actor;
    const scene    = doc.parent;
    const gridSize = scene?.grid?.size     ?? 100;
    const gridDist = scene?.grid?.distance ?? 5;

    const dx = (doc.x - last.x) / gridSize;
    const dy = (doc.y - last.y) / gridSize;
    const refundFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;

    await doc.update({ x: last.x, y: last.y });

    if (actor?.type === "character") {
      const s        = actor.system.speed;
      const maxSpeed = CrawlState.paused ? (s?.base ?? 0) : (s?.crawl ?? 0);
      const current  = actor.getFlag(MODULE_ID, "moveRemaining") ?? 0;
      const refunded = Math.min(current + refundFt, maxSpeed);
      await actor.setFlag(MODULE_ID, "moveRemaining", Math.round(refunded / 5) * 5);
      CrawlStrip.updateMember(actor.id);
      ui.notifications.info(`${actor.name} rolled back — ${refunded}ft restored.`);
    }
  },

  // ── Turn management ───────────────────────────────────────────────────────

  async resetActor(actor) {
    const s = actor.system.speed;
    const speed = CrawlState.paused ? (s?.base ?? 0) : (s?.crawl ?? 0);
    await actor.setFlag(MODULE_ID, "moveRemaining", Math.round(speed / 5) * 5);
  },

  async resetAll() {
    for (const member of CrawlState.playerMembers) {
      if (!member.actorId) continue;
      const actor = game.actors.get(member.actorId);
      if (actor) await this.resetActor(actor);
    }
    CrawlStrip.render();
  },
};
