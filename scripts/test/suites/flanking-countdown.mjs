/**
 * Flanking + Countdown Dice — smoke tests
 *
 * Both subsystems run inside the combat lifecycle (preUpdateCombat,
 * combatRound), so a true end-to-end test would require driving combat
 * through real turns. This suite exercises the apply / remove helpers
 * directly — which is where the bugs actually live (state leaks, missing
 * world-actor mirroring for unlinked tokens, AE shape).
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

export function register() {
  suite("Flanking", () => {

    case_("_makeEffectData returns Vulnerable AE with the 3 expected changes", async (ctx) => {
      const fc = game.vagabondCrawler.flanking;
      const data = fc._makeEffectData();
      expect(data.name).toContain("Flanked");
      expect(data.statuses).toContain("vulnerable");
      const keys = data.changes.map(c => c.key);
      expect(keys).toContain("system.favorHinder");
      expect(keys).toContain("system.incomingAttacksModifier");
      expect(keys).toContain("system.outgoingSavesModifier");
    });

    case_("_applyFlanked sets flankedBy flag and creates the Vulnerable AE", async (ctx) => {
      const { actor } = await ctx.fx.createTestNPC(ctx);
      const fc = game.vagabondCrawler.flanking;
      await fc._applyFlanked(actor);
      ctx.cleanup(async () => { await fc._removeFlanked(actor); });

      expect(actor.getFlag(MODULE_ID, "flankedBy")).toBe(true);
      const ae = actor.effects.find(e => e.flags?.[MODULE_ID]?.tag === "flanking");
      expect(ae).not.toBeUndefined();
      expect(ae.statuses?.has?.("vulnerable")).toBe(true);
    });

    case_("_applyFlanked is idempotent — calling twice doesn't double-create AEs", async (ctx) => {
      const { actor } = await ctx.fx.createTestNPC(ctx);
      const fc = game.vagabondCrawler.flanking;
      await fc._applyFlanked(actor);
      await fc._applyFlanked(actor);
      ctx.cleanup(async () => { await fc._removeFlanked(actor); });

      const matching = actor.effects.filter(e => e.flags?.[MODULE_ID]?.tag === "flanking");
      expect(matching.length).toBe(1);
    });

    case_("_removeFlanked clears the flag and deletes the AE", async (ctx) => {
      const { actor } = await ctx.fx.createTestNPC(ctx);
      const fc = game.vagabondCrawler.flanking;
      await fc._applyFlanked(actor);
      await fc._removeFlanked(actor);
      expect(actor.getFlag(MODULE_ID, "flankedBy")).toBeFalsy();
      const ae = actor.effects.find(e => e.flags?.[MODULE_ID]?.tag === "flanking");
      expect(ae).toBeUndefined();
    });

  });

  suite("Countdown Dice", () => {

    case_("CountdownRoller singleton exists with init / round-start hook surface", async (ctx) => {
      const cr = game.vagabondCrawler.countdownRoller;
      expect(cr).not.toBeUndefined();
      expect(typeof cr.init).toBe("function");
      expect(typeof cr._onRoundStart).toBe("function");
      expect(typeof cr._cleanup).toBe("function");
    });

    case_("Setting 'countdownAutoRoll' is registered with a sensible default", async (ctx) => {
      // The roller is gated by this setting — confirm it's registered so the
      // round-start hook doesn't quietly throw when it tries to read it.
      let val;
      try { val = game.settings.get(MODULE_ID, "countdownAutoRoll"); } catch { val = undefined; }
      expect(val !== undefined).toBe(true);
    });

  });
}
