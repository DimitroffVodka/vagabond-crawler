/**
 * Vagabond Crawler — Crawl Clock
 *
 * Wraps the Vagabond system's ProgressClock API to manage a 6-segment
 * crawl clock. Each segment represents a Scene of dungeon time.
 * Filling a segment triggers a random encounter check.
 * When the clock fills (6/6), it resets to 0.
 *
 * Clock configuration (size, position) persists in the "clockConfig"
 * module setting so it survives deletion, combat hiding, and new crawls.
 */

import { MODULE_ID }      from "./vagabond-crawler.mjs";
import { CrawlState }     from "./crawl-state.mjs";
import { EncounterTools } from "./encounter-tools.mjs";

const CRAWL_CLOCK_SEGMENTS = 6;
const CRAWL_CLOCK_NAME     = "Crawl Clock";

export const CrawlClock = {

  /** Check whether the Vagabond system's ProgressClock API is available. */
  get api() {
    return globalThis.vagabond?.documents?.ProgressClock ?? null;
  },

  get available() {
    return !!this.api;
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Create or reuse a 6-segment progress clock for the crawl.
   * Reads persisted config (size, position) from the clockConfig setting.
   * Stores the JournalEntry ID in CrawlState.
   */
  async ensure() {
    if (!this.available) return null;

    // If state already has a clock ID, verify it still exists
    const existingId = CrawlState.clockId;
    if (existingId) {
      const existing = game.journal.get(existingId);
      if (existing?.flags?.vagabond?.progressClock) return existing;
    }

    // Read persisted clock config
    const cfg = game.settings.get(MODULE_ID, "clockConfig");

    // Create a new 6-segment clock via the system API
    const journal = await this.api.create({
      name:            CRAWL_CLOCK_NAME,
      segments:        CRAWL_CLOCK_SEGMENTS,
      size:            cfg.size            ?? "S",
      defaultPosition: cfg.defaultPosition ?? "bottom-left",
    });

    await CrawlState.setClockId(journal.id);
    return journal;
  },

  /** Get the current clock JournalEntry, if it exists. */
  get journal() {
    const id = CrawlState.clockId;
    return id ? (game.journal.get(id) ?? null) : null;
  },

  /** Current number of filled segments. */
  get filled() {
    return this.journal?.flags?.vagabond?.progressClock?.filled ?? 0;
  },

  /** Total segments (always 6 for crawl clock). */
  get segments() {
    return this.journal?.flags?.vagabond?.progressClock?.segments ?? CRAWL_CLOCK_SEGMENTS;
  },

  /** SVG path for the current clock state. */
  get svgPath() {
    if (!this.available || !this.journal) return null;
    return this.api.getSVGPath(this.segments, this.filled);
  },

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Advance the clock by 1 segment, trigger encounter check,
   * and reset if the clock fills.
   * @param {"scene"} reason
   */
  async advance(reason = "scene") {
    // Re-create the clock if it was deleted while the crawl is active
    let journal = this.journal ?? await this.ensure();
    if (!journal) return null;

    const data      = journal.flags.vagabond.progressClock;
    const newFilled = data.filled + 1;
    let wasReset    = false;

    // Update the clock — the system overlay refreshes automatically
    await journal.update({
      "flags.vagabond.progressClock.filled": newFilled,
    });

    // Chat notification
    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat">
        <h3><i class="fas fa-clock"></i> Crawl Clock</h3>
        <p><strong>Scene passed</strong> — Clock ${newFilled}/${CRAWL_CLOCK_SEGMENTS}</p>
      </div>`,
      speaker: { alias: "Crawler" },
    });

    // Trigger encounter check
    await EncounterTools.rollEncounterCheck();

    // Check for full clock
    if (newFilled >= CRAWL_CLOCK_SEGMENTS) {
      wasReset = true;
      await this.reset();
    }

    return { filled: wasReset ? 0 : newFilled, wasReset };
  },

  /**
   * Roll back the clock by 1 segment (min 0). No encounter check.
   */
  async rollBack() {
    let journal = this.journal ?? await this.ensure();
    if (!journal) return null;

    const data      = journal.flags.vagabond.progressClock;
    const newFilled = Math.max(0, data.filled - 1);

    if (newFilled === data.filled) return { filled: newFilled };

    await journal.update({
      "flags.vagabond.progressClock.filled": newFilled,
    });

    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat">
        <h3><i class="fas fa-clock"></i> Crawl Clock</h3>
        <p><strong>Rolled back</strong> — Clock ${newFilled}/${CRAWL_CLOCK_SEGMENTS}</p>
      </div>`,
      speaker: { alias: "Crawler" },
    });

    return { filled: newFilled };
  },

  /** Reset the clock to 0 filled segments. */
  async reset() {
    const journal = this.journal;
    if (!journal) return;

    await journal.update({
      "flags.vagabond.progressClock.filled": 0,
    });

    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat">
        <h3><i class="fas fa-sync"></i> Crawl Clock Reset</h3>
        <p>The crawl clock has filled and reset. A new cycle begins.</p>
      </div>`,
      speaker: { alias: "Crawler" },
    });
  },

  // ── Combat hide / show ─────────────────────────────────────────────────────

  /** Save filled count and delete the clock journal (hides overlay). */
  async hide() {
    await CrawlState.setClockFilled(this.filled);
    await this.cleanup();
  },

  /** Recreate the clock and restore filled count from state. */
  async show() {
    const journal = await this.ensure();
    if (!journal) return;

    const savedFilled = CrawlState.clockFilled;
    if (savedFilled > 0) {
      await journal.update({
        "flags.vagabond.progressClock.filled": savedFilled,
      });
    }
  },

  // ── Configuration ──────────────────────────────────────────────────────────

  /** Open the system's ProgressClockConfig dialog for this clock. */
  async openConfig() {
    let journal = this.journal ?? await this.ensure();
    if (!journal) return;

    const ConfigApp = globalThis.vagabond?.applications?.ProgressClockConfig;
    if (!ConfigApp) {
      ui.notifications.warn("ProgressClockConfig not available.");
      return;
    }
    new ConfigApp(journal).render(true);
  },

  /** Delete the clock when crawl ends. */
  async cleanup() {
    const journal = this.journal;
    if (journal) await journal.delete();
  },
};

// ── Persist config changes ───────────────────────────────────────────────────
// When the system's Configure dialog saves changes to our crawl clock,
// capture size and defaultPosition into the clockConfig module setting
// so they persist across deletion, combat, and new crawls.

Hooks.on("updateJournalEntry", async (journal, changes) => {
  if (!game.user.isGM) return;
  if (journal.id !== CrawlState.clockId) return;

  const clockData = changes?.flags?.vagabond?.progressClock;
  if (!clockData) return;

  const cfg = game.settings.get(MODULE_ID, "clockConfig");
  let dirty = false;

  if (clockData.size !== undefined && clockData.size !== cfg.size) {
    cfg.size = clockData.size;
    dirty = true;
  }
  if (clockData.defaultPosition !== undefined && clockData.defaultPosition !== cfg.defaultPosition) {
    cfg.defaultPosition = clockData.defaultPosition;
    dirty = true;
  }

  if (dirty) {
    await game.settings.set(MODULE_ID, "clockConfig", foundry.utils.deepClone(cfg));
    console.log(`${MODULE_ID} | Clock config saved:`, cfg);
  }
});
