/**
 * Merchant Shop + Session Recap — smoke tests
 *
 * Both subsystems persist most state to world settings; tests snapshot
 * and restore the relevant settings to keep the live world clean.
 *
 * Recap caveat: do NOT call `recap.startSession()` from a test — it
 * fires the "Session Tracking" dialog. Install state directly via the
 * setting (same pattern as Crawl State suite).
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

function preserveSetting(ctx, key) {
  const original = foundry.utils.deepClone(game.settings.get(MODULE_ID, key));
  ctx.cleanup(async () => { await game.settings.set(MODULE_ID, key, original); });
}

export function register() {
  suite("Merchant Shop", () => {

    case_("logTransaction + getLog round-trip preserves entry data", async (ctx) => {
      preserveSetting(ctx, "shopLog");
      const ms = game.vagabondCrawler.merchantShop;
      // Clear log to a known state
      await ms.clearLog();
      await ms.logTransaction({
        type: "purchase",
        actorName: "VCTest Buyer",
        itemName: "Healing Potion",
        cost: { gold: 5, silver: 0, copper: 0 },
        quantity: 1,
      });
      const log = ms.getLog();
      expect(Array.isArray(log)).toBe(true);
      expect(log.length).toBeGreaterThan(0);
      const last = log[log.length - 1];
      expect(last?.actorName).toBe("VCTest Buyer");
      expect(last?.itemName).toBe("Healing Potion");
    });

    case_("clearLog empties the merchant transaction log", async (ctx) => {
      preserveSetting(ctx, "shopLog");
      const ms = game.vagabondCrawler.merchantShop;
      await ms.logTransaction({ type: "sale", actorName: "Test", itemName: "Stuff", cost: { gold: 1, silver: 0, copper: 0 }, quantity: 1 });
      await ms.clearLog();
      const log = ms.getLog();
      expect(log.length).toBe(0);
    });

    case_("formatForDiscord produces a non-empty string from a sample log", async (ctx) => {
      preserveSetting(ctx, "shopLog");
      const ms = game.vagabondCrawler.merchantShop;
      await ms.clearLog();
      await ms.logTransaction({ type: "purchase", actorName: "Tester", itemName: "Rope", cost: { gold: 0, silver: 5, copper: 0 }, quantity: 1 });
      const out = ms.formatForDiscord();
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });

  });

  suite("Session Recap", () => {

    case_("getData returns a recap object with expected top-level shape", async (ctx) => {
      const r = game.vagabondCrawler.recap;
      const data = r.getData();
      expect(typeof data).toBe("object");
      // Common fields the recap window reads. We don't pin exact shape here
      // because the schema evolves; just confirm it's an object with known
      // sentinel fields the SessionRecap UI relies on.
      expect("sessionState" in data).toBe(true);
    });

    case_("logCombat is a silent no-op when no session is active", async (ctx) => {
      // Verifies the session-state guard so test calls don't pollute the
      // live recap log when no session exists. This is also the exact path
      // SessionRecap relies on to avoid logging during between-session play.
      preserveSetting(ctx, "sessionRecap");
      const r = game.vagabondCrawler.recap;
      const data = r.getData();
      const beforeState = data.sessionState;
      const beforeCombatCount = (data.combat ?? []).length;

      // Force an inactive state by writing the setting directly
      await game.settings.set(MODULE_ID, "sessionRecap",
        foundry.utils.mergeObject(foundry.utils.deepClone(data), { sessionState: "inactive" }, { inplace: false }));

      await r.logCombat({ encounter: "Test", outcome: "won" });
      const after = r.getData();
      const afterCombatCount = (after.combat ?? []).length;
      expect(afterCombatCount).toBe(beforeCombatCount);
    });

    case_("formatForDiscordFromData produces a string from synthetic data", async (ctx) => {
      const r = game.vagabondCrawler.recap;
      // Match the SAME shape getData() returns so the formatter's array
      // accesses (combats.length, encounterChecks.length, …) all succeed.
      const synthetic = {
        sessionState: "ended", sessionStart: Date.now() - 60000,
        loot: [], sales: [], purchases: [], xp: [],
        combats: [], encounterChecks: [], playerStats: {},
      };
      const out = r.formatForDiscordFromData(synthetic, synthetic.sessionStart, Date.now());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });

  });
}
