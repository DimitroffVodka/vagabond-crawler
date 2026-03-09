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
    this._state = state;
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
  },

  async end() {
    this._state = {
      active: false, phase: "heroes", members: [],
      turnCount: 0, elapsedMins: 0, paused: false, clockId: null, clockFilled: 0,
    };
    await this._save();
    ui.notifications.info("Crawl ended.");
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
    if (idx !== -1) this._state.members.splice(idx, 1);
    await this._save();
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
