/**
 * Crawl State — smoke tests
 *
 * Locks in the start/end lifecycle, the phase advance, member add/remove,
 * pause/resume, and elapsed-time tracking.
 *
 * SAFETY NOTE: do NOT call `cs.start()` or `cs.end()` directly. Those fire
 * `vagabondCrawler.crawlStart` and `crawlEnd` hooks; SessionRecap (and any
 * other subscriber) responds to those by popping confirmation dialogs.
 * 8 cases × 2 hooks each → a stack of "Start tracking a new session?"
 * dialogs over the GM's screen. Instead we install canonical state via
 * `_installState` (writes the setting + restores) and assert via the
 * pure helpers (`nextTurn`, `addMember`, `pause`, etc.) which don't fire
 * lifecycle hooks. Every case snapshots and restores the live crawl.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

/** Snapshot the live crawl state and register restoration on case cleanup. */
function preserveCrawlState(ctx) {
  const original = foundry.utils.deepClone(game.settings.get(MODULE_ID, "crawlState"));
  ctx.cleanup(async () => {
    await game.settings.set(MODULE_ID, "crawlState", original);
    await game.vagabondCrawler.state.restore();
  });
}

/**
 * Install a known crawl state without going through cs.start() — bypasses
 * the lifecycle hooks that subscribers (SessionRecap, etc.) would react to.
 */
async function installState(state) {
  await game.settings.set(MODULE_ID, "crawlState", foundry.utils.deepClone(state));
  await game.vagabondCrawler.state.restore();
}

const FRESH_ACTIVE = {
  active:      true,
  phase:       "heroes",
  members:     [{ id: "gm", name: "Game Master", img: "icons/svg/cowled.svg", type: "gm" }],
  turnCount:   1,
  elapsedMins: 0,
  paused:      false,
  clockId:     null,
  clockFilled: 0,
};

export function register() {
  suite("Crawl State", () => {

    case_("Fresh active state has phase=heroes, turnCount=1, GM member present", async (ctx) => {
      preserveCrawlState(ctx);
      await installState(FRESH_ACTIVE);
      const cs = game.vagabondCrawler.state;
      expect(cs.active).toBe(true);
      expect(cs.phase).toBe("heroes");
      expect(cs.turnCount).toBe(1);
      expect(cs.elapsedMins).toBe(0);
      expect(cs.gmMember).not.toBeNull();
      expect(cs.gmMember?.type).toBe("gm");
    });

    case_("Inactive state has active=false and empty members", async (ctx) => {
      preserveCrawlState(ctx);
      await installState({ active: false, phase: "heroes", members: [], turnCount: 0, elapsedMins: 0, paused: false, clockId: null, clockFilled: 0 });
      const cs = game.vagabondCrawler.state;
      expect(cs.active).toBe(false);
      expect(cs.members.length).toBe(0);
      expect(cs.turnCount).toBe(0);
    });

    case_("nextTurn() advances heroes → gm without incrementing turnCount", async (ctx) => {
      preserveCrawlState(ctx);
      await installState(FRESH_ACTIVE);
      const cs = game.vagabondCrawler.state;
      const beforeTurn = cs.turnCount;
      const result = await cs.nextTurn();
      expect(result?.newPhase).toBe("gm");
      expect(cs.phase).toBe("gm");
      expect(cs.turnCount).toBe(beforeTurn);
    });

    case_("nextTurn() advances gm → heroes AND increments turnCount", async (ctx) => {
      preserveCrawlState(ctx);
      await installState({ ...FRESH_ACTIVE, phase: "gm" });
      const cs = game.vagabondCrawler.state;
      const beforeTurn = cs.turnCount;
      const result = await cs.nextTurn();
      expect(result?.newPhase).toBe("heroes");
      expect(result?.newTurn).toBe(true);
      expect(cs.phase).toBe("heroes");
      expect(cs.turnCount).toBe(beforeTurn + 1);
    });

    case_("addMember + removeMember manage the members list with no duplicates", async (ctx) => {
      preserveCrawlState(ctx);
      await installState(FRESH_ACTIVE);
      const cs = game.vagabondCrawler.state;
      const before = cs.members.length;
      await cs.addMember({ id: "vctest-pc-1", name: "Tester", img: "icons/svg/mystery-man.svg", type: "player", actorId: "fakeid" });
      expect(cs.members.length).toBe(before + 1);
      await cs.addMember({ id: "vctest-pc-1", name: "Tester", img: "icons/svg/mystery-man.svg", type: "player", actorId: "fakeid" });
      expect(cs.members.length).toBe(before + 1);  // duplicate add is a no-op
      await cs.removeMember("vctest-pc-1");
      expect(cs.members.length).toBe(before);
    });

    case_("pause()/resume() flip the paused flag without disturbing other state", async (ctx) => {
      preserveCrawlState(ctx);
      await installState(FRESH_ACTIVE);
      const cs = game.vagabondCrawler.state;
      expect(cs.paused).toBe(false);
      await cs.pause();
      expect(cs.paused).toBe(true);
      expect(cs.active).toBe(true);
      await cs.resume();
      expect(cs.paused).toBe(false);
    });

    case_("nextTurn() during pause is a silent no-op", async (ctx) => {
      preserveCrawlState(ctx);
      await installState({ ...FRESH_ACTIVE, paused: true });
      const cs = game.vagabondCrawler.state;
      const beforePhase = cs.phase;
      const beforeTurn = cs.turnCount;
      const result = await cs.nextTurn();
      expect(result).toBeUndefined();
      expect(cs.phase).toBe(beforePhase);
      expect(cs.turnCount).toBe(beforeTurn);
    });

    case_("addTime() accumulates elapsedMins", async (ctx) => {
      preserveCrawlState(ctx);
      await installState(FRESH_ACTIVE);
      const cs = game.vagabondCrawler.state;
      const before = cs.elapsedMins;
      await cs.addTime(15);
      expect(cs.elapsedMins).toBe(before + 15);
      await cs.addTime(45);
      expect(cs.elapsedMins).toBe(before + 60);
    });

  });
}
