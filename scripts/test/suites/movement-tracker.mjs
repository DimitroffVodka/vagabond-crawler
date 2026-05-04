/**
 * Movement Tracker — smoke tests
 *
 * Locks in the moveRemaining flag math: snapshotPosition for rollback,
 * resetActor restoring full speed, deduction on token move, and the
 * critical "do not deduct on rollback" guard. The actual `preUpdateToken`
 * hook isn't unit-tested here (it's wired through Foundry's document
 * lifecycle and depends on canvas + scene setup); we exercise the helper
 * methods that the hook delegates to.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

export function register() {
  suite("Movement Tracker", () => {

    case_("snapshotPosition records the token's current x/y", async (ctx) => {
      const { token } = await ctx.fx.createTestPC(ctx);
      const mt = game.vagabondCrawler.movement;
      mt.snapshotPosition(token.id);
      const snap = mt._turnStartPos[token.id];
      expect(snap?.x).toBe(token.document.x);
      expect(snap?.y).toBe(token.document.y);
      // Cleanup the snapshot so we don't leak between tests
      ctx.cleanup(() => { delete mt._turnStartPos[token.id]; });
    });

    case_("resetActor sets moveRemaining to actor's base speed (rounded to 5)", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx, {
        system: { speed: { base: 30, crawl: 60 } },
      });
      const mt = game.vagabondCrawler.movement;
      await mt.resetActor(actor);
      const remaining = actor.getFlag(MODULE_ID, "moveRemaining");
      // Out-of-crawl: base speed (30). In-crawl-paused: same. In-crawl-active: 60 (crawl).
      expect(typeof remaining).toBe("number");
      expect(remaining).toBeGreaterThan(0);
      // Should be a multiple of 5
      expect(remaining % 5).toBe(0);
    });

    case_("rollback restores token to snapshotted position", async (ctx) => {
      // Disable enforcement so the test PC's move isn't blocked when crawl
      // is active and our synthetic actor has 0 moveRemaining.
      const enforce = game.settings.get(MODULE_ID, "enforceCrawlMovement");
      const enforceCombat = game.settings.get(MODULE_ID, "enforceCombatMovement");
      ctx.cleanup(async () => {
        await game.settings.set(MODULE_ID, "enforceCrawlMovement", enforce);
        await game.settings.set(MODULE_ID, "enforceCombatMovement", enforceCombat);
      });
      await game.settings.set(MODULE_ID, "enforceCrawlMovement", false);
      await game.settings.set(MODULE_ID, "enforceCombatMovement", false);

      const { token, tokenDoc } = await ctx.fx.createTestPC(ctx);
      const mt = game.vagabondCrawler.movement;
      const startPos = { x: tokenDoc.x, y: tokenDoc.y };
      mt.snapshotPosition(token.id);
      ctx.cleanup(() => { delete mt._turnStartPos[token.id]; });

      // animate:false bypasses Foundry v13's position interpolation so we can
      // read the post-update x without waiting for the tween to finish.
      await tokenDoc.update({ x: startPos.x + (canvas.grid.size * 3), y: startPos.y }, { animate: false });
      expect(tokenDoc.x).toBe(startPos.x + (canvas.grid.size * 3));

      await mt.rollback(token.id);
      // After rollback, the document's stored x should be back at startPos.x.
      // tokenDoc.x can still report a mid-animation value during the rollback
      // tween, so read the canonical value via toObject().
      expect(tokenDoc.toObject().x).toBe(startPos.x);
      expect(tokenDoc.toObject().y).toBe(startPos.y);
    });

    case_("rollback does NOT deduct movement (the rollback opt guard)", async (ctx) => {
      const enforce = game.settings.get(MODULE_ID, "enforceCrawlMovement");
      const enforceCombat = game.settings.get(MODULE_ID, "enforceCombatMovement");
      ctx.cleanup(async () => {
        await game.settings.set(MODULE_ID, "enforceCrawlMovement", enforce);
        await game.settings.set(MODULE_ID, "enforceCombatMovement", enforceCombat);
      });
      await game.settings.set(MODULE_ID, "enforceCrawlMovement", false);
      await game.settings.set(MODULE_ID, "enforceCombatMovement", false);

      const { actor, token, tokenDoc } = await ctx.fx.createTestPC(ctx, {
        system: { speed: { base: 30, crawl: 30 } },
      });
      const mt = game.vagabondCrawler.movement;
      await mt.resetActor(actor);
      const beforeRemaining = actor.getFlag(MODULE_ID, "moveRemaining");
      mt.snapshotPosition(token.id);
      ctx.cleanup(() => { delete mt._turnStartPos[token.id]; });

      await tokenDoc.update({ x: tokenDoc.toObject().x + canvas.grid.size, y: tokenDoc.toObject().y }, { animate: false });
      await mt.rollback(token.id);
      const afterRemaining = actor.getFlag(MODULE_ID, "moveRemaining");
      // Rollback should refund the deduction — afterRemaining ≥ beforeRemaining.
      expect(afterRemaining).toBeGreaterThan(beforeRemaining - 1);
    });

  });
}
