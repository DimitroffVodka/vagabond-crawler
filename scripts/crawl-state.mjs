/**
 * Vagabond Crawler — Crawl State
 *
 * Single source of truth for crawl mode. Persists to world settings
 * and syncs to all clients via socket.
 *
 * Turn structure:
 *   Two phases per crawl turn: "heroes" and "gm"
 *   - Heroes phase: all player tokens can move up to crawl speed simultaneously
 *   - GM phase: encounter check, monster placement, etc.
 *   Clicking "Next Turn" advances: heroes → gm → heroes (new turn) → gm → ...
 *
 * State shape:
 *   active      {boolean}  — is crawl mode on?
 *   phase       {string}   — "heroes" | "gm"
 *   members     {Array}    — [{ id, name, img, type, actorId? }]  type: "player"|"gm"
 *   turnCount   {number}   — full crawl turns completed (increments when gm→heroes)
 *   elapsedMins {number}   — total minutes elapsed
 *   paused      {boolean}  — true during active Foundry combat
 *   clockId     {string|null} — JournalEntry ID of the crawl progress clock
 *   clockFilled {number}     — saved filled count (persists across combat hide/show)
 */

import { MODULE_ID }  from "./vagabond-crawler.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { CrawlBar }   from "./crawl-bar.mjs";

export const CrawlState = {

  _state: null,

  // ── Getters ──────────────────────────────────────────────────────────────────

  get active()      { return this._state?.active      ?? false; },
  get phase()       { return this._state?.phase        ?? "heroes"; },
  get members()     { return this._state?.members      ?? []; },
  get turnCount()   { return this._state?.turnCount    ?? 1; },
  get elapsedMins() { return this._state?.elapsedMins  ?? 0; },
  get paused()      { return this._state?.paused       ?? false; },
  get clockId()     { return this._state?.clockId      ?? null; },
  get clockFilled() { return this._state?.clockFilled  ?? 0; },

  get isHeroesPhase() { return this.phase === "heroes"; },
  get isGMPhase()     { return this.phase === "gm"; },

  get playerMembers() { return this.members.filter(m => m.type === "player"); },
  get gmMember()      { return this.members.find(m => m.type === "gm") ?? null; },

  // ── Persistence ──────────────────────────────────────────────────────────────

  async _save() {
    await game.settings.set(MODULE_ID, "crawlState", foundry.utils.deepClone(this._state));
    this._broadcast();
    this._applyBodyClass();
  },

  _broadcast() {
    if (!game.user.isGM) return;
    try {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "syncState",
        state: foundry.utils.deepClone(this._state),
      });
    } catch (e) {
      console.error(`${MODULE_ID} | Socket broadcast failed:`, e);
    }
  },

  _applyBodyClass() {
    if (this._state?.active) {
      document.body.classList.add("vcs-active");
    } else {
      document.body.classList.remove("vcs-active");
    }
  },

  async restore() {
    this._state = game.settings.get(MODULE_ID, "crawlState");
    // Clamp elapsedMins in case of corrupted saved state
    if (this._state.elapsedMins < 0) this._state.elapsedMins = 0;
    this._applyBodyClass();
    if (this._state.active) {
      CrawlStrip.render();
      CrawlBar.render();
    }
  },

  async applySync(state) {
    this._state = foundry.utils.deepClone(state);
    this._applyBodyClass();
    CrawlStrip.render();
    CrawlBar.render();
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async start() {
    this._state = {
      active:      true,
      phase:       "heroes",
      members:     [{ id: "gm", name: "Game Master", img: "icons/svg/cowled.svg", type: "gm" }],
      turnCount:   1,
      elapsedMins: 0,
      paused:      false,
      clockId:     null,
      clockFilled: 0,
    };
    await this._save();
    ui.notifications.info("Crawl mode started — Heroes phase.");
    Hooks.callAll("vagabondCrawler.crawlStart");
  },

  async end() {
    this._state = {
      active: false, phase: "heroes", members: [],
      turnCount: 0, elapsedMins: 0, paused: false, clockId: null, clockFilled: 0,
    };
    await this._save();
    ui.notifications.info("Crawl ended.");
    Hooks.callAll("vagabondCrawler.crawlEnd");
  },

  async pause() {
    if (!this.active) return;
    this._state.paused = true;
    await this._save();
  },

  async resume() {
    if (!this.active) return;
    this._state.paused = false;
    await this._save();
    ui.notifications.info("Crawl resumed.");
  },

  // ── Turn advancement ──────────────────────────────────────────────────────────

  /**
   * Advance phase:
   *   heroes → gm         (end of Heroes phase)
   *   gm     → heroes     (end of GM phase; increments turnCount, resets movement)
   */
  async nextTurn() {
    if (!this.active || this.paused) return;

    if (this.isHeroesPhase) {
      this._state.phase = "gm";
      await this._save();
      return { newPhase: "gm" };
    } else {
      this._state.phase = "heroes";
      this._state.turnCount++;
      await this._save();
      return { newPhase: "heroes", newTurn: true };
    }
  },

  // ── Members ───────────────────────────────────────────────────────────────────

  async addMember(member) {
    if (!this._state) return;
    if (this._state.members.find(m => m.id === member.id)) return; // no duplicates
    this._state.members.push(member);
    await this._save();
  },

  async removeMember(id) {
    if (!this._state) return;
    const idx = this._state.members.findIndex(m => m.id === id);
    if (idx === -1) return;
    const removed = this._state.members[idx];
    this._state.members.splice(idx, 1);
    await this._save();

    // Cascade to the combat tracker — a manual remove on the strip means
    // "this actor is leaving the encounter too." Strip removal happens first
    // so the reconciler (fired by deleteCombatant) won't immediately re-push
    // the hero back into combat from stale strip state.
    if (removed.tokenId && game.combat) {
      const combatant = game.combat.combatants.find(c => c.tokenId === removed.tokenId);
      if (combatant) {
        await game.combat.deleteEmbeddedDocuments("Combatant", [combatant.id]);
      }
    }
  },

  /**
   * Reconcile the crawl strip's members list with the active combat tracker,
   * both directions:
   *   • Any combatant missing from members gets added to the strip.
   *   • Any combat-sourced member whose combatant is gone gets removed.
   *   • Any hero (type:"player") in members without a combatant gets added
   *     to the tracker (so the party always joins the encounter turn order).
   *
   * Safe to call any time. Returns { added, removed, combatantsAdded } for
   * logging/debug.
   */
  async syncCombatMembers() {
    if (!this._state || !game.user?.isGM) {
      return { added: [], removed: [], combatantsAdded: [] };
    }
    // Reentrancy guard — `createEmbeddedDocuments("Combatant")` fires a
    // createCombatant hook for each newly-created combatant, which re-enters
    // this function before the prior create has landed in the combatants
    // snapshot. Without the guard, each re-entry sees heroes still "missing"
    // and pushes duplicates.
    if (this._syncing) return { added: [], removed: [], combatantsAdded: [] };
    this._syncing = true;
    try {
      return await this._syncCombatMembersImpl();
    } finally {
      this._syncing = false;
    }
  },

  async _syncCombatMembersImpl() {
    const combat = game.combat;
    const combatants = combat?.combatants?.contents ?? [];
    const added = [];
    const removed = [];
    const combatantsAdded = [];
    let dirty = false;

    // Strip ← Combat: add any combatant missing from members
    for (const c of combatants) {
      const token = c.token;
      if (!token?.actor) continue;
      const memberId = `token-${token.id}`;
      if (this._state.members.some(m => m.id === memberId)) continue;
      const type = (token.document ?? token).disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY
        ? "player" : "npc";
      this._state.members.push({
        id:      memberId,
        name:    token.name,
        img:     token.texture?.src ?? token.actor.img,
        type,
        actorId: token.actor.id,
        tokenId: token.id,
        // ALL combat-created members get source:"combat" so orphan-cleanup
        // removes them when the combatant is deleted. Previously only type
        // === "npc" got the tag, which meant friendly summons/familiars
        // (type "player") lingered with stale tokenIds after despawn.
        source:  "combat",
      });
      added.push(token.name);
      dirty = true;
    }

    // Strip ← Combat: remove any combat-sourced member whose combatant is gone
    const combatantTokenIds = new Set(combatants.map(c => c.tokenId));
    for (let i = this._state.members.length - 1; i >= 0; i--) {
      const m = this._state.members[i];
      if (m.source !== "combat") continue;
      if (combatantTokenIds.has(m.tokenId)) continue;
      this._state.members.splice(i, 1);
      removed.push(m.name);
      dirty = true;
    }

    // Defense-in-depth: purge any member whose tokenId no longer resolves
    // to a real token on any scene. Guards against members left behind from
    // older flows (pre-source-tag, pre-reconciler) or external token deletes
    // that didn't fire the usual hooks.
    for (let i = this._state.members.length - 1; i >= 0; i--) {
      const m = this._state.members[i];
      if (m.type === "gm") continue;  // GM placeholder has no token by design
      if (!m.tokenId) continue;
      const exists = game.scenes.some(s => s.tokens.get(m.tokenId));
      if (exists) continue;
      this._state.members.splice(i, 1);
      removed.push(`${m.name} (stale token)`);
      dirty = true;
    }

    if (dirty) await this._save();

    // Combat ← Strip: push any hero member missing from the combat tracker.
    // Only runs once the combat has actually STARTED. Gating on combat.started
    // prevents a race when a GM right-clicks a token and Foundry's "Toggle
    // Combat State" creates the combat + its initial combatant in parallel:
    // createCombat fires before the token's combatant lands in the snapshot,
    // so the reconciler used to see the hero as "missing" and push a
    // duplicate combatant. Once the user hits Begin Encounter, combatStart
    // fires with combat.started = true and this block runs normally.
    //
    // In v13 a combat doc may be "sceneless" — combat.scene is undefined and
    // each combatant carries its own sceneId. Derive the target scene from
    // (in order) combat.scene, the first existing combatant, or the canvas.
    if (combat && combat.started) {
      const targetSceneId = combat.scene?.id
        ?? combatants[0]?.sceneId
        ?? canvas.scene?.id;
      const targetScene = targetSceneId ? game.scenes.get(targetSceneId) : null;
      if (targetScene) {
        const toAdd = [];
        for (const m of this._state.members) {
          if (m.type !== "player" || !m.tokenId) continue;
          if (combatantTokenIds.has(m.tokenId)) continue;
          const tokenDoc = targetScene.tokens.get(m.tokenId);
          if (!tokenDoc) continue;  // hero's token isn't on the combat scene
          const actorId = tokenDoc.actorId;
          if (!actorId || !game.actors.get(actorId)) continue;  // stale / deleted actor
          toAdd.push({ tokenId: m.tokenId, sceneId: targetSceneId, actorId });
          combatantsAdded.push(m.name);
        }
        if (toAdd.length) {
          try {
            await combat.createEmbeddedDocuments("Combatant", toAdd);
          } catch (err) {
            console.warn(`vagabond-crawler | Combat←Strip push failed:`, err, { toAdd });
          }
        }
      }
    }

    return { added, removed, combatantsAdded };
  },

  // ── Time ──────────────────────────────────────────────────────────────────────

  async addTime(minutes) {
    if (!this.active) return;
    this._state.elapsedMins = Math.max(0, (this._state.elapsedMins ?? 0) + minutes);
    await this._save();
  },

  // ── Clock ───────────────────────────────────────────────────────────────────

  async setClockId(id) {
    if (!this._state) return;
    this._state.clockId = id;
    await this._save();
  },

  async setClockFilled(n) {
    if (!this._state) return;
    this._state.clockFilled = n ?? 0;
    await this._save();
  },

  // ── Helpers ───────────────────────────────────────────────────────────────────

  formatElapsed() {
    const h = Math.floor(this.elapsedMins / 60);
    const m = this.elapsedMins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  },
};
