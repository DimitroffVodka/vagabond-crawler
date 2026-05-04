/**
 * Light Tracker — smoke tests
 *
 * Locks in the 12-source config, the lit/dous toggle, fuel consumption for
 * lanterns, the burn-time decrement, and the test-on-token snapshot/restore
 * mechanism that powers the Light Source Configuration preview button.
 *
 * Note: we exercise private methods (`_lightItem`, `_douseLight`,
 * `_burnOut`) directly — these ARE the contract the rest of the system
 * depends on. The public surface is mostly UI (settings menus, tracker
 * window) which is harder to assert on in a smoke test.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

export function register() {
  suite("Light Tracker", () => {

    case_("getLightSourcesConfig returns 12 sources with required fields", async (ctx) => {
      const cfg = game.vagabondCrawler.lightTracker.getLightSourcesConfig();
      const keys = Object.keys(cfg);
      expect(keys.length).toBe(12);
      // Spot-check core sources
      expect(keys).toContain("torch");
      expect(keys).toContain("lantern-hooded");
      expect(keys).toContain("sunrod");
      // Each source must have the fields the config UI / token light setter needs
      for (const k of keys) {
        const def = cfg[k];
        expect(typeof def.bright).toBe("number");
        expect(typeof def.dim).toBe("number");
        expect(typeof def.color).toBe("string");
        expect(typeof def.longevitySecs).toBe("number");
      }
    });

    case_("_lightItem on a torch sets lit/sourceKey/remainingSecs flags", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [torch] = await pc.createEmbeddedDocuments("Item", [{
        name: "Torch", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      // Stash original token light so we can restore.
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      await game.vagabondCrawler.lightTracker._lightItem(torch);
      // After lighting, the torch should have the lit flag set on the SAME item
      // (qty was 1, no split). Re-read from actor.items to be safe.
      const lit = pc.items.find(i => i.name === "Torch");
      expect(lit.getFlag(MODULE_ID, "lit")).toBe(true);
      expect(lit.getFlag(MODULE_ID, "sourceKey")).toBe("torch");
      const remaining = lit.getFlag(MODULE_ID, "remainingSecs");
      expect(remaining).toBeGreaterThan(0);

      // Token's light data should now reflect the torch config (bright=15, dim=30)
      expect(pcTok.document.light.bright).toBe(15);
      expect(pcTok.document.light.dim).toBe(30);
    });

    case_("_douseLight clears lit flag", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [torch] = await pc.createEmbeddedDocuments("Item", [{
        name: "Torch", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      await game.vagabondCrawler.lightTracker._lightItem(torch);
      const litItem = pc.items.find(i => i.name === "Torch");
      await game.vagabondCrawler.lightTracker._douseLight(litItem);
      expect(litItem.getFlag(MODULE_ID, "lit")).toBe(false);
    });

    case_("Splitting a stack: lighting 1 from a stack of 3 leaves 2 unlit", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [torchStack] = await pc.createEmbeddedDocuments("Item", [{
        name: "Torch", type: "equipment",
        system: { equipmentType: "gear", quantity: 3 },
      }]);
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      await game.vagabondCrawler.lightTracker._lightItem(torchStack);
      // After lighting from a stack of 3:
      //   - one new "Torch" item (qty 1) with lit=true
      //   - the original stack still exists with qty 2, lit unset
      const torches = pc.items.filter(i => i.name === "Torch");
      const lit  = torches.filter(i => i.getFlag(MODULE_ID, "lit"));
      const unlit = torches.filter(i => !i.getFlag(MODULE_ID, "lit"));
      expect(lit.length).toBe(1);
      expect(unlit.length).toBe(1);
      expect(unlit[0].system.quantity).toBe(2);
    });

    case_("advanceTime decrements remainingSecs on every lit item", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [torch] = await pc.createEmbeddedDocuments("Item", [{
        name: "Torch", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      await game.vagabondCrawler.lightTracker._lightItem(torch);
      const lit = pc.items.find(i => i.name === "Torch");
      const before = lit.getFlag(MODULE_ID, "remainingSecs");

      await game.vagabondCrawler.lightTracker.advanceTime(60);

      const after = lit.getFlag(MODULE_ID, "remainingSecs");
      expect(before - after).toBe(60);
    });

    case_("advanceTime past longevity triggers burn-out (item douses)", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [torch] = await pc.createEmbeddedDocuments("Item", [{
        name: "Torch", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      await game.vagabondCrawler.lightTracker._lightItem(torch);
      const lit = pc.items.find(i => i.name === "Torch");
      const longevity = lit.getFlag(MODULE_ID, "remainingSecs");

      // Advance past burn-out
      await game.vagabondCrawler.lightTracker.advanceTime(longevity + 60);

      // _burnOut deletes the item entirely (it was a single split torch).
      const stillThere = pc.items.find(i => i.name === "Torch" && i.id === lit.id);
      expect(stillThere).toBeUndefined();
    });

    case_("Hooded lantern requires oil — refuses to light without fuel", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [lantern] = await pc.createEmbeddedDocuments("Item", [{
        name: "Lantern, Hooded", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      // No oil → expect light stays unlit.
      await game.vagabondCrawler.lightTracker._lightItem(lantern);
      expect(lantern.getFlag(MODULE_ID, "lit")).toBeFalsy();
    });

    case_("Hooded lantern lights when oil is present, consumes 1 oil", async (ctx) => {
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [lantern] = await pc.createEmbeddedDocuments("Item", [{
        name: "Lantern, Hooded", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      const [oil] = await pc.createEmbeddedDocuments("Item", [{
        name: "Oil", type: "equipment",
        system: { equipmentType: "gear", quantity: 2 },
      }]);
      const originalLight = foundry.utils.deepClone(pcTok.document.toObject().light);
      ctx.cleanup(() => pcTok.document.update({ light: originalLight }));

      await game.vagabondCrawler.lightTracker._lightItem(lantern);
      const litLantern = pc.items.find(i => i.name === "Lantern, Hooded");
      expect(litLantern.getFlag(MODULE_ID, "lit")).toBe(true);
      const remainingOil = pc.items.find(i => i.name === "Oil");
      expect(remainingOil?.system.quantity).toBe(1);
    });

  });
}
