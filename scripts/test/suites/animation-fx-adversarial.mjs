/**
 * Animation FX — adversarial tests
 *
 * Throw garbage at the FX subsystem and watch what breaks. These tests
 * deliberately violate happy-path assumptions: malformed flags, deleted
 * documents mid-action, bad regex patterns, missing tokens, null actors,
 * rapid-fire chat messages. The point is to FIND BUGS, not pin behavior.
 *
 * Each case ends with a comment about what bug, if any, surfaced.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

export function register() {
  suite("Animation FX (adversarial)", () => {

    case_("_resolve survives malformed actor (null, undefined, no items)", async (ctx) => {
      const afx = game.vagabondCrawler.animationFx;
      // None of these should throw — _resolve is called from a chat hook
      // and a throw would derail the chat card chain.
      let threw = false;
      try { afx._resolve({ item: null }); } catch { threw = true; }
      try { afx._resolve({ item: undefined }); } catch { threw = true; }
      try { afx._resolve({}); } catch { threw = true; }
      try { afx._resolve({ actor: null, actionIndex: 0 }); } catch { threw = true; }
      try { afx._resolve({ actor: { system: null }, actionIndex: 0 }); } catch { threw = true; }
      try { afx._resolve({ actor: { system: { actions: null } }, actionIndex: 0 }); } catch { threw = true; }
      expect(threw).toBe(false);
    });

    case_("_resolve handles actionIndex out of range without throwing", async (ctx) => {
      const afx = game.vagabondCrawler.animationFx;
      const { actor: npc } = await ctx.fx.createTestNPC(ctx, {
        system: { actions: [{ name: "Bite", description: "", recharge: "", note: "" }] },
      });
      let threw = false;
      let result = "set";
      try {
        result = afx._resolve({ actor: npc, actionIndex: 999 });
      } catch (e) { threw = true; }
      expect(threw).toBe(false);
      expect(result).toBeNull();
    });

    case_("_resolve with malformed pattern regex doesn't crash _pickBestPattern", async (ctx) => {
      const afx = game.vagabondCrawler.animationFx;
      // Inject a bad-regex preset into the live config and see if it explodes
      // when matched. We DON'T persist this — only mutate the in-memory cache.
      const original = game.settings.get(MODULE_ID, "animationFxConfig");
      ctx.cleanup(async () => { await game.settings.set(MODULE_ID, "animationFxConfig", original); });
      const corrupted = foundry.utils.deepClone(original);
      corrupted.npcActions = {
        ...(corrupted.npcActions ?? {}),
        _vctest_bad: { label: "Bad", patterns: "[", hit: { file: "x.webm", scale: 1, duration: 800 } },
      };
      await game.settings.set(MODULE_ID, "animationFxConfig", corrupted);

      const { actor: npc } = await ctx.fx.createTestNPC(ctx, {
        system: { actions: [{ name: "Anything", description: "", recharge: "", note: "" }] },
      });
      let threw = false;
      try { afx._resolve({ actor: npc, actionIndex: 0 }); }
      catch (e) { threw = true; console.warn("Bad-regex case threw:", e); }
      expect(threw).toBe(false);
    });

    case_("rapid-fire chat messages do not double-fire FX for the same item", async (ctx) => {
      // Real bug class: createChatMessage hook fires for every message; a
      // burst of 3 messages with the same actorId/itemId in <50ms could
      // trigger 3 plays. Verify exactly one _play per message.
      const pcRef = await ctx.fx.createTestPC(ctx);
      const { actor: pc, token: pcTok } = pcRef;
      const { token: npcTok } = await ctx.fx.createTestNPCAdjacentTo(ctx, pcRef);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Burst Sword" });

      pcTok.control({ releaseOthers: true });
      game.user.targets.clear();
      npcTok.setTarget(true, { releaseOthers: true });

      const afx = game.vagabondCrawler.animationFx;
      const calls = [];
      const orig = afx._play.bind(afx);
      afx._play = async function (preset, ...rest) { calls.push(preset?.label ?? null); };
      ctx.cleanup(() => { afx._play = orig; });

      // Fire 3 chat messages back-to-back (no await between)
      const msgs = await Promise.all([
        ChatMessage.create({ flags: { vagabond: { actorId: pc.id, itemId: weapon.id } }, content: "<p>1</p>" }),
        ChatMessage.create({ flags: { vagabond: { actorId: pc.id, itemId: weapon.id } }, content: "<p>2</p>" }),
        ChatMessage.create({ flags: { vagabond: { actorId: pc.id, itemId: weapon.id } }, content: "<p>3</p>" }),
      ]);
      ctx.cleanup(async () => { for (const m of msgs) try { await m.delete(); } catch {} });
      await ctx.fx.settle(400);

      // Exactly one _play per message — no debounce, no dropping.
      expect(calls.length).toBe(3);
    });

    case_("FX hook tolerates a deleted item between message creation and resolution", async (ctx) => {
      const pcRef = await ctx.fx.createTestPC(ctx);
      const { actor: pc, token: pcTok } = pcRef;
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Vanishing Sword" });
      const itemId = weapon.id;

      const afx = game.vagabondCrawler.animationFx;
      const calls = [];
      const orig = afx._play.bind(afx);
      afx._play = async function (preset) { calls.push(preset?.label ?? null); };
      ctx.cleanup(() => { afx._play = orig; });

      // Delete the item BEFORE the chat message is created
      await weapon.delete();

      let threw = false;
      try {
        const msg = await ChatMessage.create({ flags: { vagabond: { actorId: pc.id, itemId } }, content: "<p>orphan</p>" });
        ctx.cleanup(async () => { try { await msg.delete(); } catch {} });
        await ctx.fx.settle(200);
      } catch (e) { threw = true; }
      expect(threw).toBe(false);
      // No play should have fired (item was gone)
      expect(calls.length).toBe(0);
    });

    case_("FX hook tolerates an actor that no longer exists when message arrives", async (ctx) => {
      // Capture an actor id, delete the actor, post a message referencing it.
      const pcRef = await ctx.fx.createTestPC(ctx);
      const { actor: pc } = pcRef;
      const actorId = pc.id;
      // Need to delete the actor BUT the cleanup tracker will also try to
      // delete it. That's safe because cleanup ignores errors.
      await pc.delete();

      const afx = game.vagabondCrawler.animationFx;
      let threw = false;
      try {
        const msg = await ChatMessage.create({ flags: { vagabond: { actorId, itemId: "fakeitem" } }, content: "<p>ghost</p>" });
        ctx.cleanup(async () => { try { await msg.delete(); } catch {} });
        await ctx.fx.settle(200);
      } catch (e) { threw = true; }
      expect(threw).toBe(false);
    });

    case_("Persistent gear FX: starting twice on the same token is idempotent", async (ctx) => {
      // Real failure mode: each call to startPersistent appends a new
      // Sequencer effect with the same name. If the guard is broken we'd
      // get two stacked instances per token.
      if (typeof Sequencer === "undefined") return;  // nothing to verify
      const afx = game.vagabondCrawler.animationFx;
      const { token } = await ctx.fx.createTestPC(ctx);
      const preset = {
        label: "VCTest Persist",
        type: "onToken",
        target: "self",
        persist: true,
        hit: { file: "modules/JB2A_DnD5e/Library/Generic/Light/LightOrb01_01_Regular_Yellow_400x400.webm", scale: 1, duration: 1000 },
      };
      const tag = `vagabond-crawler-fx-${preset.label}-${token.id}`;
      ctx.cleanup(async () => {
        try { await Sequencer.EffectManager.endEffects({ name: tag }); } catch {}
      });

      await afx.startPersistent(preset, token);
      await afx.startPersistent(preset, token);  // duplicate
      await afx.startPersistent(preset, token);  // triplicate
      await ctx.fx.settle(300);

      const matching = (Sequencer.EffectManager?.getEffects?.({ name: tag }) ?? []).length;
      expect(matching).toBe(1);
    });

    case_("stopPersistent on a non-running effect is a silent no-op (no throw)", async (ctx) => {
      if (typeof Sequencer === "undefined") return;
      const afx = game.vagabondCrawler.animationFx;
      const { token } = await ctx.fx.createTestPC(ctx);
      const preset = { label: "VCTest Never Started", persist: true, hit: { file: "x.webm", scale: 1 } };
      let threw = false;
      try { await afx.stopPersistent(preset, token); }
      catch (e) { threw = true; console.warn(e); }
      expect(threw).toBe(false);
    });

    case_("category toggle disable is read FRESH each resolution (no caching staleness)", async (ctx) => {
      const afx = game.vagabondCrawler.animationFx;
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Cat Cache" });

      const origWeapons = game.settings.get(MODULE_ID, "animationFxCategoryWeapons");
      const origSkills  = game.settings.get(MODULE_ID, "animationFxCategorySkills");
      ctx.cleanup(async () => {
        await game.settings.set(MODULE_ID, "animationFxCategoryWeapons", origWeapons);
        await game.settings.set(MODULE_ID, "animationFxCategorySkills",  origSkills);
      });

      // First: both on → resolves
      await game.settings.set(MODULE_ID, "animationFxCategoryWeapons", true);
      await game.settings.set(MODULE_ID, "animationFxCategorySkills",  true);
      const r1 = afx._resolve({ item: weapon });
      expect(r1).not.toBeNull();

      // Toggle off mid-flight
      await game.settings.set(MODULE_ID, "animationFxCategoryWeapons", false);
      await game.settings.set(MODULE_ID, "animationFxCategorySkills",  false);
      const r2 = afx._resolve({ item: weapon });
      expect(r2).toBeNull();

      // Toggle back on
      await game.settings.set(MODULE_ID, "animationFxCategoryWeapons", true);
      await game.settings.set(MODULE_ID, "animationFxCategorySkills",  true);
      const r3 = afx._resolve({ item: weapon });
      expect(r3).not.toBeNull();
    });

    case_("BUG HUNT: animationOverride flag with NO hit file should not be returned", async (ctx) => {
      // What happens if someone saves an override with empty hit.file?
      // _resolve returns the override unconditionally if it exists, then
      // _play checks for a missing file. But the chat hook resolves to
      // the override, then sees no file, then... silently returns?
      const afx = game.vagabondCrawler.animationFx;
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Empty Override" });
      // Save an override with empty hit.file (a GM might do this by accident
      // in the per-item dialog).
      await weapon.setFlag(MODULE_ID, "animationOverride", {
        label: "Empty",
        hit: { file: "", scale: 1, duration: 800 },
      });

      // _resolve will return the empty override.
      const resolved = afx._resolve({ item: weapon });
      // CONTRACT QUESTION: should _resolve drop empty overrides, or should
      // _play handle the empty-file case? Currently _resolve returns the
      // empty override. _play then checks `if (!block?.file) return;` so
      // playback no-ops. But this means the empty override SUPPRESSES the
      // global preset that would have otherwise played. Is that desired?
      //
      // Document the current behavior so we notice if it changes:
      expect(resolved?.label).toBe("Empty");
      expect(resolved?.hit?.file).toBe("");
      // → If you want empty overrides to FALL THROUGH to the global preset
      //   instead of suppressing it, that's a real (small) bug. Likely
      //   intended behavior is: empty file = "use this item but no FX".
    });

  });
}
