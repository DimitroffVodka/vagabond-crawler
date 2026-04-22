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
import { getEffectiveMovement } from "./combat-helpers.mjs";

// ── Shared speed helpers ────────────────────────────────────────────────────

/**
 * Visual movement budget for an actor.
 * Combat: effective mode speed — honors tokenDoc.movementAction (GM override)
 *   or falls back to the fastest available mode. This is what a Bat (walk 5 /
 *   fly 30) gets for its turn when it's in the air.
 * Crawl:  exploration (crawl) speed. Crawl phase doesn't care about flight
 *   mode — exploration is a slow overland pace.
 * Callers should pass tokenDoc when available so movementAction is respected.
 */
function _getBaseSpeed(actor, tokenDoc = null) {
  const sys = actor?.system;
  if (!sys) return 0;
  if (CrawlState.paused) {
    // Combat — use effective mode speed (fly, swim, etc.)
    return getEffectiveMovement(actor, tokenDoc).speed;
  }
  // Crawl — exploration speed
  const s = sys.speed;
  if (typeof s === "object") return s.crawl ?? 0;
  const crawl = sys.crawl ?? 0;
  if (crawl > 0) return crawl;
  // Friendly NPCs (summons, familiars, beast companions, hirelings) have no
  // explicit crawl-speed field on the NPC sheet — fall back to base × 3 so
  // they actually keep pace with the party during the crawl phase.
  const disposition = tokenDoc?.disposition ?? actor.prototypeToken?.disposition;
  if (actor.type === "npc" && disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
    const base = typeof s === "number" ? s : 0;
    return base * 3;
  }
  return 0;
}

/**
 * Hard movement cap — the absolute maximum a token can move per turn.
 * Combat: 2× effective mode speed (move + Rush).
 * Crawl:  same as crawl speed (no Rush in crawl).
 */
function _getHardCap(actor, tokenDoc = null) {
  if (CrawlState.paused) return _getBaseSpeed(actor, tokenDoc) * 2;
  return _getBaseSpeed(actor, tokenDoc);
}

/** Highest "Modify Movement Cost" multiplier along a segment (checks dest + midpoint). */
function _getTerrainDifficulty(scene, fromX, fromY, toX, toY, elevation = 0, tokenDoc = null) {
  if (!scene?.regions?.size) return 1;

  // Treads Lightly: character ignores walk terrain difficulty
  if (tokenDoc?.actor?.type === "character") {
    const features = tokenDoc.actor.getFlag("vagabond-character-enhancer", "features");
    if (features?.perk_treadsLightly) return 1;
  }

  const points = [
    { x: toX, y: toY, elevation },
    { x: (fromX + toX) / 2, y: (fromY + toY) / 2, elevation },
  ];

  let maxDifficulty = 1;
  for (const region of scene.regions) {
    for (const behavior of region.behaviors) {
      if (behavior.type !== "modifyMovementCost" || behavior.disabled) continue;
      const diff = behavior.system?.difficulties?.walk;
      if (!diff || diff <= 1) continue;
      // Check if any test point falls inside this region
      for (const pt of points) {
        if (region.testPoint(pt)) { maxDifficulty = Math.max(maxDifficulty, diff); break; }
      }
      if (maxDifficulty >= 3) return maxDifficulty;
    }
  }
  return maxDifficulty;
}

// ── VCS TokenRuler subclass ─────────────────────────────────────────────────

class VCSTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {

  // ── Helpers ──────────────────────────────────────────────────────────────

  get _moveRemaining() {
    const actor = this.token?.actor;
    if (!actor) return Infinity;
    return actor.getFlag(MODULE_ID, "moveRemaining") ?? _getBaseSpeed(actor, this.token?.document);
  }

  get _isTracked() {
    if (!CrawlState.active) return false;
    const actor = this.token?.actor;
    if (!actor) return false;
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
      scope: "world", config: false, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "enforceCombatMovement", {
      name: "Enforce Combat Movement",
      hint: "Block tokens from moving beyond their base speed (+ Rush) during combat.",
      scope: "world", config: false, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "enforceNpcMovement", {
      name: "Enforce NPC Movement",
      hint: "Block NPC tokens from exceeding their movement budget in combat. When off, only player tokens are enforced.",
      scope: "world", config: false, type: Boolean, default: false,
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
          const toX = changes.x ?? doc.x;
          const toY = changes.y ?? doc.y;
          const difficulty = _getTerrainDifficulty(scene, doc.x, doc.y, toX, toY, doc.elevation ?? 0, doc);
          const distanceFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist * difficulty) / 5) * 5;
          this._pendingDeduct ??= {};
          this._pendingDeduct[doc.id] = distanceFt;
        }
      }
      // Block move if it exceeds remaining movement
      return this._onPreUpdate(doc, changes, userId, this._pendingDeduct?.[doc.id]);
    });

    Hooks.on("updateToken", (doc, changes, opts) => {
      if (opts?.[MODULE_ID]?.rollback) return;
      if (changes.x !== undefined || changes.y !== undefined) {
        // Deduct movement after the move has successfully committed
        if (CrawlState.active) {
          const actor = doc.actor;
          const mem = actor && CrawlState.members.find(m => m.actorId === actor.id);
          if (mem && !(mem.type === "npc" && CrawlState.paused && !game.settings.get(MODULE_ID, "enforceNpcMovement"))) {
            const distanceFt = this._pendingDeduct?.[doc.id] ?? 0;
            delete this._pendingDeduct?.[doc.id];
            if (distanceFt > 0) {
              const moveRemaining = actor.getFlag(MODULE_ID, "moveRemaining")
                ?? _getBaseSpeed(actor, doc);
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
      if (!CrawlState.active) return;
      const token = hud.object;
      if (!token.isOwner) return;  // GM or the owning player
      const member = CrawlState.members.find(m => m.tokenId === token.id);
      if (!member) return;

      // Phase gate: PC tokens in Heroes phase, NPC tokens in GM phase,
      // both in combat. Keeps the HUD uncluttered during the other side's turn.
      const inCombat    = CrawlState.paused;
      const isPCMember  = member.type === "player";
      const isNPCMember = member.type === "npc" || member.type === "gm";
      const phaseOk = inCombat
        || (isPCMember  &&  CrawlState.isHeroesPhase)
        || (isNPCMember && !CrawlState.isHeroesPhase);
      if (!phaseOk) return;

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

  _onPreUpdate(doc, changes, userId, precomputedFt) {
    if (!CrawlState.active) return;
    if (changes.x === undefined && changes.y === undefined) return;

    const actor = doc.actor;
    if (!actor) return;

    const member = CrawlState.members.find(m => m.actorId === actor.id);
    if (!member) return;

    const inCombat      = CrawlState.paused;
    const moveRemaining = actor.getFlag(MODULE_ID, "moveRemaining") ?? _getBaseSpeed(actor, doc);

    // Crawl: enforce if setting enabled.  Combat: enforce if setting enabled.
    const enforce = inCombat
      ? game.settings.get(MODULE_ID, "enforceCombatMovement")
      : game.settings.get(MODULE_ID, "enforceCrawlMovement");
    if (!enforce) return;

    // NPC enforcement is a separate opt-in setting
    if (member.type === "npc" && inCombat && !game.settings.get(MODULE_ID, "enforceNpcMovement")) return;

    let segFt = precomputedFt;
    if (segFt == null) {
      const scene    = doc.parent;
      const gridSize = scene?.grid?.size     ?? 100;
      const gridDist = scene?.grid?.distance ?? 5;
      const dx = ((changes.x ?? doc.x) - doc.x) / gridSize;
      const dy = ((changes.y ?? doc.y) - doc.y) / gridSize;
      const difficulty = _getTerrainDifficulty(scene, doc.x, doc.y, changes.x ?? doc.x, changes.y ?? doc.y, doc.elevation ?? 0, doc);
      segFt = Math.round((Math.max(Math.abs(dx), Math.abs(dy)) * gridDist * difficulty) / 5) * 5;
    }

    // Combat: allow up to 2× base (Rush).  moveRemaining starts at base speed
    // and can go negative (down to -base), so the hard limit is:
    //   moveRemaining + baseSpeed  (= remaining Rush budget)
    // Crawl: hard stop at moveRemaining (no Rush).
    const baseSpeed = _getBaseSpeed(actor, doc);
    const limit     = inCombat ? moveRemaining + baseSpeed : moveRemaining;

    if (segFt > limit) {
      delete this._pendingDeduct?.[doc.id];
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
    // Players relay to GM (turn-start positions are only tracked on the GM client)
    if (!game.user.isGM) {
      game.socket.emit(`module.${MODULE_ID}`, { action: "rollbackMove", tokenId });
      return;
    }
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
    if (actor) {
      const fullSpeed = Math.round(_getBaseSpeed(actor, doc) / 5) * 5;
      await actor.setFlag(MODULE_ID, "moveRemaining", fullSpeed);
      CrawlStrip.updateMember(actor.id);
      ui.notifications.info(`${actor.name} rolled back to turn start — movement restored.`);
    }
  },

  // ── Turn management ───────────────────────────────────────────────────────

  async resetActor(actor, tokenDoc = null) {
    const speed = _getBaseSpeed(actor, tokenDoc);
    await actor.setFlag(MODULE_ID, "moveRemaining", Math.round(speed / 5) * 5);
  },

  async resetAll() {
    for (const member of CrawlState.members) {
      if (!member.actorId) continue;
      // Prefer token actor (handles unlinked/synthetic actors correctly)
      const token = member.tokenId
        ? (canvas.tokens?.get(member.tokenId) ?? canvas.tokens?.placeables?.find(t => t.actor?.id === member.actorId))
        : null;
      const actor = token?.actor ?? game.actors.get(member.actorId);
      if (actor) await this.resetActor(actor, token?.document);
      // Snapshot turn-start position for each member's token
      if (token) {
        this._turnStartPos[token.id] = { x: token.document.x, y: token.document.y };
      }
    }
    CrawlStrip.render();
  },
};
