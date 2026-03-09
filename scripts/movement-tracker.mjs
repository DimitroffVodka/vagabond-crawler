/**
 * Vagabond Crawler — Movement Tracker
 *
 * Crawl mode: hard-blocks movement beyond crawl speed, deducts on move.
 * Combat mode: budget = base speed, ruler turns red when over (Rush).
 *              Hard cap at 2× base speed (move + Rush action).
 *              moveRemaining can go negative to indicate Rush usage.
 *
 * TokenRulerWaypoint (what _getSegmentStyle receives) is NOT the same
 * object as the TokenMeasuredMovementWaypoint passed to refresh().
 * Foundry creates new DeepReadonly<TokenRulerWaypoint> objects internally
 * with `previous` (linked list), `stage` ("passed"|"pending"|"planned"),
 * and `cost` carried over from the original waypoint.
 *
 * We compute cumulative cost by walking the `previous` chain, counting
 * only "pending" waypoints (passed costs are already deducted from the
 * actor's moveRemaining flag).
 */

import { MODULE_ID }  from "./vagabond-crawler.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { ICONS }      from "./icons.mjs";

// ── Shared speed helpers ────────────────────────────────────────────────────

/**
 * Visual movement budget for an actor.
 * Combat: base speed (normal move action).
 * Crawl:  exploration (crawl) speed.
 * This is what moveRemaining resets to each turn and what the strip displays.
 */
function _getBaseSpeed(actor) {
  const s = actor?.system?.speed;
  if (CrawlState.paused) return s?.base ?? 0;   // combat: base move
  return s?.crawl ?? 0;                           // crawl: exploration
}

/**
 * Hard movement cap — the absolute maximum a token can move per turn.
 * Combat: 2× base speed (move + Rush action).
 * Crawl:  same as base speed (no Rush in crawl).
 */
function _getHardCap(actor) {
  const s = actor?.system?.speed;
  if (CrawlState.paused) return ((s?.base ?? 0) * 2);  // combat: move + Rush
  return s?.crawl ?? 0;                                  // crawl: no Rush
}

// ── VCS TokenRuler subclass ─────────────────────────────────────────────────

class VCSTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {

  // ── Helpers ──────────────────────────────────────────────────────────────

  get _moveRemaining() {
    const actor = this.token?.actor;
    if (!actor) return Infinity;
    return actor.getFlag(MODULE_ID, "moveRemaining") ?? _getBaseSpeed(actor);
  }

  get _isTracked() {
    if (!CrawlState.active) return false;
    const actor = this.token?.actor;
    if (!actor || actor.type !== "character") return false;
    return !!CrawlState.members.find(m => m.actorId === actor.id);
  }

  /**
   * Walk the waypoint's `previous` linked list and sum costs of pending
   * waypoints only.  Passed waypoints have already been deducted from the
   * actor's moveRemaining flag, so including them would double-count.
   */
  _cumulativeAt(waypoint) {
    let total = 0;
    let wp = waypoint;
    while (wp) {
      if (wp.stage === "passed") break;   // stop at committed waypoints
      total += (wp.cost ?? 0);
      wp = wp.previous ?? null;
    }
    return total;
  }

  _colorForFt(ft) {
    const r = this._moveRemaining;
    return ft <= r ? 0x00cc00 : 0xcc2200;  // green: within budget, red: over
  }

  _clearHighlight() {
    const layerName = `TokenRuler.${this.token.id}`;
    canvas.interface.grid.clearHighlightLayer(layerName);
  }

  clear() {
    this._clearHighlight();
    super.clear();
  }

  // ── refresh ────────────────────────────────────────────────────────────

  /** No custom bookkeeping needed — style methods walk the linked list. */
  refresh(args) {
    super.refresh(args);
  }

  // ── Style overrides ────────────────────────────────────────────────────

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
    const after = this._moveRemaining - this._cumulativeAt(waypoint);
    const tag   = after < 0 ? `Rush: ${after}ft` : `${after}ft left`;
    base.label  = base.label ? `${base.label} (${tag})` : tag;
    return base;
  }
}

// ── MovementTracker ─────────────────────────────────────────────────────────

export const MovementTracker = {

  _turnStartPos: {},  // tokenId → {x, y} snapshotted at turn/round start

  /** Snapshot a token's current position as the rollback target. */
  snapshotPosition(tokenId) {
    const token = canvas.tokens?.get(tokenId);
    if (token) this._turnStartPos[tokenId] = { x: token.document.x, y: token.document.y };
  },

  registerSettings() {
    game.settings.register(MODULE_ID, "enforceCrawlMovement", {
      name: "Enforce Crawl Movement",
      hint: "Block tokens from moving beyond their crawl speed during the Heroes phase.",
      scope: "world", config: true, type: Boolean, default: true,
    });
  },

  init() {
    CONFIG.Token.rulerClass = VCSTokenRuler;
    console.log(`${MODULE_ID} | Registered VCSTokenRuler`);

    // CONFIG.Token.rulerClass only affects newly created tokens.
    // Swap ruler instances on all tokens already on canvas.
    this._installRulers();
    Hooks.on("canvasReady", () => this._installRulers());

    Hooks.on("preUpdateToken", (doc, changes, opts, userId) => {
      if (opts?.[MODULE_ID]?.rollback) return; // skip accounting for rollback moves
      if (changes.x !== undefined || changes.y !== undefined) {

        // Compute and cache the distance now, while we still have old position
        // updateToken receives doc.x/y already updated to new position
        if (CrawlState.active) {
          const scene    = doc.parent;
          const gridSize = scene?.grid?.size     ?? 100;
          const gridDist = scene?.grid?.distance ?? 5;
          const dx = ((changes.x ?? doc.x) - doc.x) / gridSize;
          const dy = ((changes.y ?? doc.y) - doc.y) / gridSize;
          const distanceFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;
          this._pendingDeduct ??= {};
          this._pendingDeduct[doc.id] = distanceFt;
        }
      }
      // Block move if it exceeds remaining movement
      return this._onPreUpdate(doc, changes, userId);
    });

    Hooks.on("updateToken", (doc, changes, opts) => {
      if (opts?.[MODULE_ID]?.rollback) return;
      if (changes.x !== undefined || changes.y !== undefined) {
        // Deduct movement after the move has successfully committed
        if (CrawlState.active) {
          const actor = doc.actor;
          if (actor?.type === "character" && CrawlState.members.find(m => m.actorId === actor.id)) {
            const distanceFt = this._pendingDeduct?.[doc.id] ?? 0;
            delete this._pendingDeduct?.[doc.id];
            if (distanceFt > 0) {
              const moveRemaining = actor.getFlag(MODULE_ID, "moveRemaining")
                ?? _getBaseSpeed(actor);
              // Combat: allow negative (Rush territory).  Crawl: floor at 0.
              const raw = Math.round((moveRemaining - distanceFt) / 5) * 5;
              const newRemaining = CrawlState.paused ? raw : Math.max(0, raw);
              actor.setFlag(MODULE_ID, "moveRemaining", newRemaining)
                .then(() => CrawlStrip.updateMember(actor.id));
            }
          }
        }

        // Delay ruler clear to after #continueMovement finishes all segments
        const tokenId = doc.id;
        this._clearTimers ??= {};
        clearTimeout(this._clearTimers[tokenId]);
        this._clearTimers[tokenId] = setTimeout(() => {
          delete this._clearTimers[tokenId];
          const token = canvas.tokens?.get(tokenId);
          token?.ruler?.clear();
          const highlight = canvas.interface.grid.highlight.children
            ?.find(c => c.name === `TokenRuler.${tokenId}`);
          if (highlight) highlight.visible = false;
        }, 100);
      }
    });

    Hooks.on("renderTokenHUD", (hud, html, data) => {
      if (!game.user.isGM) return;
      if (!CrawlState.active) return;
      // Show rollback in crawl Heroes phase OR during combat
      if (!CrawlState.isHeroesPhase && !CrawlState.paused) return;
      const token = hud.object;
      const member = CrawlState.members.find(m => m.tokenId === token.id);
      if (!member || member.type !== "player") return;

      const btn = document.createElement("div");
      btn.classList.add("control-icon");
      btn.title = "Rollback Movement";
      btn.innerHTML = ICONS.rollbackMove;
      btn.addEventListener("click", () => {
        hud.close();
        this.rollback(token.id);
      });
      html.querySelector(".col.left")?.appendChild(btn);
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
      // Reset on round change OR turn change (each combatant gets fresh budget)
      if (changes.round === undefined && changes.turn === undefined) return;
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
      console.log(`${MODULE_ID} | Installed VCSTokenRuler on ${token.name}`);
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

    const inCombat      = CrawlState.paused;
    const moveRemaining = actor.getFlag(MODULE_ID, "moveRemaining") ?? _getBaseSpeed(actor);

    // Crawl: enforce if setting enabled.  Combat: always enforce.
    const enforce = inCombat || game.settings.get(MODULE_ID, "enforceCrawlMovement");
    if (!enforce) return;

    const dx = ((changes.x ?? doc.x) - doc.x) / gridSize;
    const dy = ((changes.y ?? doc.y) - doc.y) / gridSize;
    const segFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist) / 5) * 5;

    // Combat: allow up to 2× base (Rush).  moveRemaining starts at base speed
    // and can go negative (down to -base), so the hard limit is:
    //   moveRemaining + baseSpeed  (= remaining Rush budget)
    // Crawl: hard stop at moveRemaining (no Rush).
    const baseSpeed = _getBaseSpeed(actor);
    const limit     = inCombat ? moveRemaining + baseSpeed : moveRemaining;

    if (segFt > limit) {
      if (userId === game.userId) {
        const msg = inCombat && moveRemaining <= 0
          ? `${actor.name}: Rush exhausted — no movement remaining.`
          : `${actor.name}: only ${Math.max(0, moveRemaining)}ft remaining${inCombat ? ` (${limit}ft with Rush)` : ""}.`;
        ui.notifications.warn(msg);
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
  },

  // ── Rollback ──────────────────────────────────────────────────────────────

  async rollback(tokenId) {
    const start = this._turnStartPos[tokenId];
    if (!start) { ui.notifications.warn("No turn-start position recorded for this token."); return; }

    const token = canvas.tokens?.get(tokenId);
    const doc   = token?.document;
    if (!doc) return;

    const actor = doc.actor;

    // Teleport token back to turn-start position (bypass wall collision)
    await doc.update({ x: start.x, y: start.y }, {
      teleport: true, animate: false, [MODULE_ID]: { rollback: true },
    });

    // Refund full turn movement (base speed — Rush is a choice, not a given)
    if (actor?.type === "character") {
      const fullSpeed = Math.round(_getBaseSpeed(actor) / 5) * 5;
      await actor.setFlag(MODULE_ID, "moveRemaining", fullSpeed);
      CrawlStrip.updateMember(actor.id);
      ui.notifications.info(`${actor.name} rolled back to turn start — movement restored.`);
    }
  },

  // ── Turn management ───────────────────────────────────────────────────────

  async resetActor(actor) {
    const speed = _getBaseSpeed(actor);
    await actor.setFlag(MODULE_ID, "moveRemaining", Math.round(speed / 5) * 5);
  },

  async resetAll() {
    for (const member of CrawlState.playerMembers) {
      if (!member.actorId) continue;
      const actor = game.actors.get(member.actorId);
      if (actor) await this.resetActor(actor);
      // Snapshot turn-start position for each member's token
      if (member.tokenId) {
        const token = canvas.tokens?.get(member.tokenId)
          ?? canvas.tokens?.placeables?.find(t => t.actor?.id === member.actorId);
        if (token) this._turnStartPos[token.id] = { x: token.document.x, y: token.document.y };
      }
    }
    CrawlStrip.render();
  },
};
