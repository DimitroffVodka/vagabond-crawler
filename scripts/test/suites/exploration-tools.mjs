/**
 * Encounter System + Monster Creator + Hit Die Config — smoke tests
 *
 * These three subsystems are mostly ApplicationV2 UI windows — not much
 * pure-data behavior to assert on. The smoke tests here lock in:
 *   - the encounter check posts the right chat-card flag
 *   - the singletons exist on game.vagabondCrawler with the expected shape
 *   - registered settings have sensible defaults
 *
 * Anything UI-driven (panel rendering, mutator dialogs, hit-die window
 * checkboxes) is best validated by playing through it.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

export function register() {
  suite("Encounter System", () => {

    case_("rollEncounterCheck posts a chat message with rolled d6 and threshold result", async (ctx) => {
      const captured = [];
      const hookId = Hooks.on("createChatMessage", (msg) => captured.push(msg));
      ctx.cleanup(() => Hooks.off("createChatMessage", hookId));

      const tools = (await import(`/modules/${MODULE_ID}/scripts/encounter-tools.mjs`)).EncounterTools;
      await tools.rollEncounterCheck();
      // Cleanup any chat we created
      ctx.cleanup(async () => { for (const m of captured) try { await m.delete(); } catch {} });

      expect(captured.length).toBeGreaterThan(0);
      const card = captured[0];
      // Card should reference a d6 roll
      expect(card.rolls?.[0]?.formula).toContain("1d6");
      // And the content distinguishes hit vs miss
      const isHitOrMiss = /encounter|quiet/i.test(card.content);
      expect(isHitOrMiss).toBe(true);
    });

    case_("encounterThreshold setting is registered with a numeric default", async (ctx) => {
      let val;
      try { val = game.settings.get(MODULE_ID, "encounterThreshold"); } catch { val = undefined; }
      expect(val !== undefined).toBe(true);
      expect(typeof val).toBe("number");
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThan(7);  // d6 threshold range
    });

  });

  suite("Monster Creator", () => {

    case_("MonsterCreator singleton exposes init / open / openWithData / mountPanel / unmountPanel", async (ctx) => {
      const mc = game.vagabondCrawler.monsterCreator;
      expect(mc).not.toBeUndefined();
      for (const fn of ["init", "open", "openWithData", "mountPanel", "unmountPanel"]) {
        expect(typeof mc[fn]).toBe("function");
      }
    });

  });

  suite("Hit Die Config", () => {

    case_("HitDieConfig singleton exposes open()", async (ctx) => {
      const hd = game.vagabondCrawler.hitDieConfig;
      expect(hd).not.toBeUndefined();
      expect(typeof hd.open).toBe("function");
    });

    case_("hitDieSizeMap setting is registered (per-monster-size hit die mapping)", async (ctx) => {
      // The size→die mapping is the core data the config edits. If it's not
      // registered, the config window can't load defaults.
      let val;
      try { val = game.settings.get(MODULE_ID, "hitDieSizeMap"); } catch { val = undefined; }
      // The setting may be an object or an empty object; the contract is just
      // "registered without throwing".
      expect(val !== undefined).toBe(true);
    });

    case_("bestiaryHitDieFallback setting is registered (controls roll-on-spawn for un-flagged NPCs)", async (ctx) => {
      // rollHpOnSpawn is a per-actor flag, not a setting — but the
      // bestiaryHitDieFallback setting controls the system-wide default
      // when an NPC has no override flag.
      let val;
      try { val = game.settings.get(MODULE_ID, "bestiaryHitDieFallback"); } catch { val = undefined; }
      expect(val !== undefined).toBe(true);
    });

  });
}
