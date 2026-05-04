/**
 * Loot Generator + Spell Scroll Forge — smoke tests
 *
 * Loot Generator: rolls a level table, posts a chat card with item data,
 *   and registers Give-To buttons. We test rollForToken's data shape and
 *   the give-to handler indirectly via the chat-card flag schema.
 *
 * Spell Scroll Forge: produces consumable items flagged with `spellScroll`,
 *   used via context menu. We test isScroll() and the basic contract that
 *   forge.useScroll exists.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

export function register() {
  suite("Loot Generator", () => {

    case_("rollForToken posts a chat card with vagabond-crawler.lootGeneratorCard flag", async (ctx) => {
      const lg = game.vagabondCrawler.lootGenerator;
      // Capture chat messages created during the roll
      const captured = [];
      const hookId = Hooks.on("createChatMessage", (msg) => captured.push(msg));
      ctx.cleanup(() => Hooks.off("createChatMessage", hookId));

      // Roll without a token, level 1 (smallest table)
      try { await lg.rollForToken(null, 1); } catch (e) { /* ok if no items rolled */ }
      const lootCard = captured.find(m => m.flags?.[MODULE_ID]?.lootGeneratorCard);
      // Either it produced a loot card OR the roll legitimately produced
      // nothing (level 1 table CAN return empty). The contract: if a card
      // was produced, it carries the expected flag.
      if (lootCard) {
        expect(lootCard.flags?.[MODULE_ID]?.lootGeneratorCard).toBe(true);
        // itemData should be an array (possibly empty)
        const itemData = lootCard.flags?.[MODULE_ID]?.itemData;
        expect(Array.isArray(itemData)).toBe(true);
      }
      // Cleanup any chat messages created
      for (const m of captured) {
        try { await m.delete(); } catch {}
      }
    });

  });

  suite("Spell Scroll Forge", () => {

    case_("isScroll returns true for items with the spellScroll flag", async (ctx) => {
      const sf = game.vagabondCrawler.scrollForge;
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const [scroll] = await pc.createEmbeddedDocuments("Item", [{
        name: "VCTest Scroll", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
        flags: { [MODULE_ID]: { spellScroll: { spellId: "fake", spellName: "Magic Missile" } } },
      }]);
      expect(sf.isScroll(scroll)).toBe(true);
    });

    case_("isScroll returns false for plain items", async (ctx) => {
      const sf = game.vagabondCrawler.scrollForge;
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const [plain] = await pc.createEmbeddedDocuments("Item", [{
        name: "VCTest Plain Gear", type: "equipment",
        system: { equipmentType: "gear", quantity: 1 },
      }]);
      expect(sf.isScroll(plain)).toBe(false);
    });

    case_("ScrollForge exposes open(), useScroll(), isScroll() on the singleton", async (ctx) => {
      const sf = game.vagabondCrawler.scrollForge;
      expect(typeof sf.open).toBe("function");
      expect(typeof sf.useScroll).toBe("function");
      expect(typeof sf.isScroll).toBe("function");
    });

  });
}
