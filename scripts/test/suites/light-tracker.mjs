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


    // ── System light sources (vagabond 5.23+ game.vagabond.lightSource) ────
    const LS = () => game.vagabond?.lightSource;
    const sysLantern = (qty = 1) => ({
      name: "Lantern, hooded", type: "equipment",
      system: { equipmentType: "gear", quantity: qty, macro: { command: "game.vagabond.lightSource.use({ actor, item, token, light: { bright: 25, dim: 30 } })" } },
    });

    case_("system light items light through the system, and a lantern with no oil won't light", async (ctx) => {
      if (!LS()) return;  // pre-5.23 system: legacy path only
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [lantern] = await pc.createEmbeddedDocuments("Item", [sysLantern()]);
      expect(LS().isLightItem(lantern)).toBe(true);
      const before = JSON.stringify(pcTok.document.light);
      await LS().use({ actor: pc, item: lantern, token: pcTok, light: { bright: 25, dim: 30 } });
      expect(JSON.stringify(pcTok.document.light)).toBe(before);
    });

    case_("lighting a system lantern burns one oil; burning out keeps the lantern", async (ctx) => {
      if (!LS()) return;
      const { actor: pc, token: pcTok } = await ctx.fx.createTestPC(ctx);
      const [lantern, oil] = await pc.createEmbeddedDocuments("Item", [sysLantern(), {
        name: "Oil, flask", type: "equipment", system: { equipmentType: "gear", quantity: 2 },
      }]);
      const origPrompt = LS()._promptMode;
      LS()._promptMode = async () => "hour";
      ctx.cleanup(async () => { LS()._promptMode = origPrompt; await LS().douse(pcTok.document); });
      await LS().use({ actor: pc, item: lantern, token: pcTok, light: { bright: 25, dim: 30 } });
      expect(pc.items.get(oil.id)?.system.quantity).toBe(1);
      const clock = game.vagabond.clocks.getAll().find(j => j.getFlag("vagabond", "lightSource")?.itemUuid === lantern.uuid);
      expect(!!clock).toBe(true);

      // A crawl turn of 10 minutes ticks the 6-segment hour clock down one.
      await game.vagabondCrawler.lightTracker.tickSystemLightClocks(10);
      expect(clock.getFlag("vagabond", "progressClock").filled).toBe(5);

      await LS()._consumeLitItem(lantern.uuid);
      expect(!!pc.items.get(lantern.id)).toBe(true);
    });


    const until = async (fn, ms = 15000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 50)); return fn(); };
    const sysTorch = () => ({ name: "Torch", type: "equipment",
      system: { equipmentType: "gear", quantity: 1, macro: { command: "game.vagabond.lightSource.use({ actor, item, token })" } } });
    const clocksWhere = pred => game.vagabond.clocks.getAll().filter(j => { const ls = j.getFlag("vagabond", "lightSource"); return ls && pred(ls); });
    const stubHourMode = (ctx) => {
      const orig = LS()._promptMode;
      LS()._promptMode = async () => "hour";
      ctx.cleanup(async () => { LS()._promptMode = orig; for (const j of clocksWhere(() => true).filter(j => /Torch/.test(j.name))) await j.delete(); });
    };

    case_("a lit system torch dropped on the canvas carries its light and clock; pickup relights the new holder", async (ctx) => {
      if (!LS()) return;
      stubHourMode(ctx);
      const { actor: a, tokenDoc: aTok } = await ctx.fx.createTestPC(ctx);
      const { actor: b, tokenDoc: bTok } = await ctx.fx.createTestPC(ctx);
      const [torch] = await a.createEmbeddedDocuments("Item", [sysTorch()]);
      await LS().use({ actor: a, item: torch, token: aTok, light: { bright: 25, dim: 30 } });
      await clocksWhere(ls => ls.itemUuid === torch.uuid)[0].update({ "flags.vagabond.progressClock.filled": 4 });

      Hooks.call("dropCanvasData", canvas, { type: "Item", uuid: torch.uuid, x: aTok.x + canvas.grid.size, y: aTok.y });
      const findDropped = () => game.actors.find(x => x.getFlag(MODULE_ID, "systemLight")?.itemData?.name === "Torch" && x.getFlag(MODULE_ID, "sourceActorId") === a.id);
      expect(await until(() => findDropped() && !aTok.light.dim)).toBeTruthy();
      const la = findDropped();
      const dropped = canvas.scene.tokens.find(t => t.actorId === la.id);
      ctx.cleanup(async () => { if (canvas.scene.tokens.get(dropped.id)) await dropped.delete(); if (game.actors.get(la.id)) await la.delete(); });
      expect(await until(() => clocksWhere(ls => ls.tokenUuid === dropped.uuid).length === 1)).toBe(true);
      expect(dropped.light.dim).toBe(30);
      expect(clocksWhere(ls => ls.tokenUuid === dropped.uuid)[0].getFlag("vagabond", "progressClock").filled).toBe(4);

      const D = foundry.applications.api.DialogV2; const origPrompt = D.prompt;
      D.prompt = async () => b.id;
      ctx.cleanup(() => { D.prompt = origPrompt; });
      const el = document.createElement("div"); el.append(Object.assign(document.createElement("div"), { className: "col right" }));
      Hooks.callAll("renderTokenHUD", { object: dropped.object, close() {} }, el, {});
      el.querySelector(".vlt-pickup-btn").dispatchEvent(new MouseEvent("click"));
      expect(await until(() => !game.actors.get(la.id))).toBe(true);
      const picked = b.items.find(i => i.name === "Torch");
      expect(LS().isItemLit(picked)).toBe(true);
      expect(bTok.light.dim).toBe(30);
      expect(clocksWhere(ls => ls.itemUuid === picked.uuid)[0]?.getFlag("vagabond", "progressClock").filled).toBe(4);
    });

    case_("gathering into a party moves a system light and its clock; a burn-out while gathered stays out on release", async (ctx) => {
      if (!LS()) return;
      stubHourMode(ctx);
      const { actor: m, tokenDoc: mTok } = await ctx.fx.createTestPC(ctx);
      const party = await Actor.create({ name: "VCTest Party", type: "party", flags: { vctest: { created: true } }, system: { members: [m.uuid] } });
      const [pTok] = await canvas.scene.createEmbeddedDocuments("Token", [{ actorId: party.id, actorLink: true, x: mTok.x + canvas.grid.size * 2, y: mTok.y }]);
      ctx.cleanup(async () => { for (const t of canvas.scene.tokens.filter(t => t.actorId === party.id || t.actorId === m.id)) await t.delete(); await party.delete(); });
      const [torch] = await m.createEmbeddedDocuments("Item", [sysTorch()]);
      await LS().use({ actor: m, item: torch, token: mTok, light: { bright: 25, dim: 30 } });
      const clock = clocksWhere(ls => ls.itemUuid === torch.uuid)[0];

      const { _id, ...snap } = mTok.toObject();
      await mTok.delete();
      expect(await until(() => pTok.light.dim === 30 && clock.getFlag("vagabond", "lightSource").tokenUuid === pTok.uuid)).toBe(true);

      await clock.update({ "flags.vagabond.progressClock.filled": 0 });
      expect(await until(() => !pTok.light.dim && !game.journal.get(clock.id))).toBe(true);
      await until(() => pTok.getFlag(MODULE_ID, "partyLights")?.includes("expired"), 3000);

      const [back] = await canvas.scene.createEmbeddedDocuments("Token", [snap]);
      expect(await until(() => !back.light.dim)).toBe(true);
      expect(pTok.getFlag(MODULE_ID, "partyLights")).toBe(undefined);
    });

  });
}
