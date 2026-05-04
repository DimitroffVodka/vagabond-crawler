/**
 * Animation FX — smoke tests
 *
 * Coverage focus: every preset-resolution path (`AnimationFx._resolve`) and
 * the chat-message-hook trigger (`AnimationFx._onChatMessage`). Most cases
 * spy on `_play` directly rather than counting Sequencer effects — that
 * sidesteps async timing issues with Sequencer's setTimeout chains and
 * lets us inspect the resolved preset (label, file, type) in addition to
 * "did it fire."
 *
 * The tricky parts of the FX subsystem this suite locks in:
 *   - per-item `disabled` and `animationOverride` flags
 *   - per-actor `actionOverrides` keyed by actionIndex
 *   - most-specific-pattern wins (Frost Breath beats generic Breath)
 *   - spell / armor / relic items return null preset (system handles)
 *   - category toggles short-circuit resolution
 *   - the GM-only conflict warning
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

/** Spy: replace AnimationFx._play with a recorder. Returns a restore fn. */
function spyPlay(ctx) {
  const afx = game.vagabondCrawler.animationFx;
  const calls = [];
  const orig = afx._play.bind(afx);
  afx._play = async function (preset, source, targets, outcome) {
    calls.push({
      label: preset?.label ?? null,
      type: preset?.type ?? null,
      hitFile: preset?.hit?.file ?? null,
      outcome,
      sourceName: source?.name ?? null,
      targetCount: targets?.length ?? 0,
    });
    // Don't actually call orig — we don't want Sequencer effects accumulating.
    // Caller asserts on `calls`.
  };
  ctx.cleanup(() => { afx._play = orig; });
  return calls;
}

export function register() {
  suite("Animation FX", () => {

    case_("_resolve returns null for spells (system owns spell FX)", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const [spell] = await pc.createEmbeddedDocuments("Item", [{
        name: "VCTest Spell", type: "spell", system: { damageType: "fire" },
      }]);
      const preset = game.vagabondCrawler.animationFx._resolve({ item: spell });
      expect(preset).toBeNull();
    });

    case_("_resolve returns null for armor and relic items", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const [armor] = await pc.createEmbeddedDocuments("Item", [{
        name: "VCTest Armor", type: "equipment",
        system: { equipmentType: "armor", equipmentState: "oneHand" },
      }]);
      const [relic] = await pc.createEmbeddedDocuments("Item", [{
        name: "VCTest Relic", type: "equipment",
        system: { equipmentType: "relic", equipmentState: "oneHand" },
      }]);
      expect(game.vagabondCrawler.animationFx._resolve({ item: armor })).toBeNull();
      expect(game.vagabondCrawler.animationFx._resolve({ item: relic })).toBeNull();
    });

    case_("per-item disabled flag short-circuits FX resolution", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Disabled Sword" });
      // Sanity: with no flag, weapon resolves to a preset (skill fallback at minimum).
      const before = game.vagabondCrawler.animationFx._resolve({ item: weapon });
      expect(before).not.toBeNull();
      // Now disable.
      await weapon.setFlag(MODULE_ID, "disabled", true);
      const after = game.vagabondCrawler.animationFx._resolve({ item: weapon });
      expect(after).toBeNull();
    });

    case_("per-item animationOverride flag wins over global config", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Override Sword" });
      const customPreset = {
        label: "Custom Override",
        type: "onToken",
        target: "target",
        hit: { file: "modules/JB2A_DnD5e/CUSTOM_OVERRIDE.webm", scale: 1, duration: 500 },
      };
      await weapon.setFlag(MODULE_ID, "animationOverride", customPreset);
      const resolved = game.vagabondCrawler.animationFx._resolve({ item: weapon });
      expect(resolved?.label).toBe("Custom Override");
      expect(resolved?.hit?.file).toContain("CUSTOM_OVERRIDE");
    });

    case_("NPC action with matching pattern resolves to global preset", async (ctx) => {
      const { actor: npc } = await ctx.fx.createTestNPC(ctx, {
        system: { actions: [{ name: "Bite", description: "1d6 piercing", recharge: "", note: "" }] },
      });
      const preset = game.vagabondCrawler.animationFx._resolve({ actor: npc, actionIndex: 0 });
      expect(preset).not.toBeNull();
      expect(preset?.label).toBe("Bite");
    });

    case_("NPC action specificity: 'Frost Breath' picks frost_breath over generic breath", async (ctx) => {
      const cfg = game.vagabondCrawler.animationFx.getConfig();
      const hasFrostBreath = !!cfg.npcActions?.frost_breath;
      const hasBreath = !!cfg.npcActions?.breath;
      // If config doesn't have both, this test isn't meaningful — skip.
      if (!hasFrostBreath || !hasBreath) return;

      const { actor: npc } = await ctx.fx.createTestNPC(ctx, {
        system: { actions: [{ name: "Frost Breath", description: "cold cone", recharge: "", note: "" }] },
      });
      const preset = game.vagabondCrawler.animationFx._resolve({ actor: npc, actionIndex: 0 });
      expect(preset?.label).toBe("Frost Breath");
    });

    case_("per-actor actionOverride flag wins over global pattern match", async (ctx) => {
      const { actor: npc } = await ctx.fx.createTestNPC(ctx, {
        system: { actions: [{ name: "Bite", description: "", recharge: "", note: "" }] },
      });
      const customPreset = {
        label: "Custom Bite Override",
        type: "onToken",
        hit: { file: "modules/JB2A_DnD5e/CUSTOM_BITE_OVERRIDE.webm", scale: 1, duration: 500 },
      };
      await npc.setFlag(MODULE_ID, "actionOverrides", { 0: customPreset });
      const preset = game.vagabondCrawler.animationFx._resolve({ actor: npc, actionIndex: 0 });
      expect(preset?.label).toBe("Custom Bite Override");
    });

    case_("actionOverride disabled:true short-circuits FX for that action only", async (ctx) => {
      const { actor: npc } = await ctx.fx.createTestNPC(ctx, {
        system: { actions: [
          { name: "Bite",  description: "", recharge: "", note: "" },
          { name: "Claw",  description: "", recharge: "", note: "" },
        ] },
      });
      await npc.setFlag(MODULE_ID, "actionOverrides", { 0: { disabled: true } });
      const bite = game.vagabondCrawler.animationFx._resolve({ actor: npc, actionIndex: 0 });
      const claw = game.vagabondCrawler.animationFx._resolve({ actor: npc, actionIndex: 1 });
      expect(bite).toBeNull();
      // Claw should still resolve via the global pattern.
      expect(claw).not.toBeNull();
    });

    case_("category toggle 'animationFxCategoryWeapons' off → no weapon preset resolves", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Cat Sword" });
      const original = game.settings.get(MODULE_ID, "animationFxCategoryWeapons");
      ctx.cleanup(async () => { await game.settings.set(MODULE_ID, "animationFxCategoryWeapons", original); });

      // Also disable skill fallbacks so nothing resolves at all.
      const origSkills = game.settings.get(MODULE_ID, "animationFxCategorySkills");
      ctx.cleanup(async () => { await game.settings.set(MODULE_ID, "animationFxCategorySkills", origSkills); });

      await game.settings.set(MODULE_ID, "animationFxCategoryWeapons", false);
      await game.settings.set(MODULE_ID, "animationFxCategorySkills", false);

      const preset = game.vagabondCrawler.animationFx._resolve({ item: weapon });
      expect(preset).toBeNull();
    });

    case_("chat-message hook fires _play exactly once per weapon attack via item.roll", async (ctx) => {
      const pcRef = await ctx.fx.createTestPC(ctx);
      const { actor: pc, token: pcTok } = pcRef;
      const { token: npcTok } = await ctx.fx.createTestNPCAdjacentTo(ctx, pcRef);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Hook Sword" });

      pcTok.control({ releaseOthers: true });
      game.user.targets.clear();
      npcTok.setTarget(true, { releaseOthers: true });

      const calls = spyPlay(ctx);

      // item.roll() goes through the chat-card path that previously bypassed FX entirely.
      // After the regression fix, the createChatMessage hook should reach _play once.
      await weapon.roll();
      await ctx.fx.settle(400);

      expect(calls.length).toBe(1);
      expect(calls[0].label).toBeTruthy();  // resolved to *some* preset
    });

    case_("chat-message hook ignores items without flags.vagabond.itemId", async (ctx) => {
      const calls = spyPlay(ctx);
      // Create a chat message with no item context — _onChatMessage should bail.
      await ChatMessage.create({ content: "<p>orphan message</p>" });
      await ctx.fx.settle(200);
      expect(calls.length).toBe(0);
    });

  });
}
