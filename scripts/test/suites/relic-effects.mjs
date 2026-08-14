/**
 * Relic Effects — smoke tests
 *
 * Locks in the relic damage-injection patches:
 *   - VagabondItem.prototype.rollDamage  (covers item.roll, Crawl Strip,
 *                                          macros, system auto-roll setting)
 *   - VagabondDamageHelper.rollDamageFromButton  (covers chat-card button)
 *
 * Both paths share `RelicEffects.collectBonusParts`, which is the actual
 * unit under test for most of these cases. We then run the path end-to-end
 * to confirm the wrap chain composes correctly with VCE's existing wraps
 * (Gunslinger / Monk / Rogue / silver-weakness).
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";

async function loadRelicEffects() {
  const mod = await import(`/modules/${MODULE_ID}/scripts/relic-effects.mjs`);
  return mod.RelicEffects;
}

export function register() {
  suite("Relic Effects", () => {

    case_("collectBonusParts returns [] for a plain (non-forged) weapon", async (ctx) => {
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Plain" });
      const parts = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [] });
      expect(parts).toEqual([]);
    });

    case_("collectBonusParts returns Strike I dice for a Striking-forged weapon", async (ctx) => {
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Striking" }, {
        relicFlags: { relicPower: "strike-1", bonusDamageDice: "1d4", bonusDamageLabel: "Striking" },
      });
      const parts = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [] });
      expect(parts.length).toBe(1);
      expect(parts[0].formula).toBe("1d4");
      expect(parts[0].label).toBe("Striking");
    });

    case_("Bane (general): fires when target beingType matches", async (ctx) => {
      // NOTE: only Bane (general) currently works because the system schema
      // restricts `system.beingType` to 8 broad categories (Humanlike, Fae,
      // Cryptid, Artificials, Beasts, Outers, Primordials, Undead). Bane
      // "specific" (Orc/Wolf/Spider) and Bane "niche" (Halfling/Dwarf) can
      // never match because there's no fine-grained ancestry field on NPCs.
      // See findings: relic-bane-specificity-broken.
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const { actor: beastNpc } = await ctx.fx.createTestNPC(ctx, {
        system: { beingType: "Beasts" },
      });
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Beastbane" }, {
        relicFlags: { relicPower: "bane-general", baneTarget: "Beasts", baneDice: "3d6" },
      });
      const parts = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [beastNpc] });
      expect(parts.length).toBe(1);
      expect(parts[0].formula).toBe("3d6");
      expect(parts[0].label).toContain("Bane");
    });

    case_("Bane (general): does NOT fire when beingType doesn't match", async (ctx) => {
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const { actor: undeadNpc } = await ctx.fx.createTestNPC(ctx, {
        system: { beingType: "Undead" },
      });
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Beastbane2" }, {
        relicFlags: { relicPower: "bane-general", baneTarget: "Beasts", baneDice: "3d6" },
      });
      const parts = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [undeadNpc] });
      expect(parts).toEqual([]);
    });

    case_("FINDING: Bane (specific) cannot match because system has no fine-grained ancestry field", async (ctx) => {
      // Documented bug: a "Wolf-bane" relic created via the Forge produces a
      // baneTarget of "Wolf", but the system's actor.system.beingType field
      // can only hold one of the 8 broad categories. So the substring match
      // in collectBonusParts will always miss for specific/niche banes. This
      // case INTENTIONALLY documents the broken behavior so we notice if it
      // ever changes (intentionally or accidentally). Update the assertion
      // when the Crawler / system grows a fine-grained ancestry field.
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const { actor: beastNpc } = await ctx.fx.createTestNPC(ctx, {
        system: { beingType: "Beasts" },  // closest valid choice for a "Wolf"
      });
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Wolfbane" }, {
        relicFlags: { relicPower: "bane-specific", baneTarget: "Wolf", baneDice: "2d6" },
      });
      const parts = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [beastNpc] });
      // Currently broken: expected to be empty. Flip to .toBeGreaterThan(0)
      // when the underlying system gains a Wolf-grain field.
      expect(parts).toEqual([]);
    });

    case_("Vicious: fires only on critical hits, scaled to actor.system.hitDie || d6", async (ctx) => {
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Vicious" }, {
        relicFlags: { relicPower: "vicious" },
      });
      const onHit  = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [] });
      const onCrit = RelicEffects.collectBonusParts(pc, weapon, { isCritical: true,  targets: [] });
      expect(onHit).toEqual([]);
      expect(onCrit.length).toBe(1);
      // Synthetic PC has no hitDie set (it's normally derived from class data).
      // collectBonusParts falls back to d6 when missing — verify the fallback.
      expect(onCrit[0].formula).toBe("2d6");
      expect(onCrit[0].label).toContain("Vicious");
    });

    case_("Multiple relic AEs on one weapon: bonuses stack", async (ctx) => {
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const { actor: beastNpc } = await ctx.fx.createTestNPC(ctx, {
        system: { beingType: "Beasts" },
      });

      // Build a weapon manually so we can attach two AEs at once.
      const [weapon] = await pc.createEmbeddedDocuments("Item", [{
        name: "VCTest Multi", type: "equipment",
        system: { equipmentType: "weapon", equipped: true, equipmentState: "oneHand", weaponSkill: "melee", currentDamage: "d8", currentDamageType: "physical" },
        flags: { [MODULE_ID]: { relicForge: { forged: true } } },
        effects: [
          { name: "Relic: Strike I", icon: "icons/svg/upgrade.svg", changes: [],
            flags: { [MODULE_ID]: { relicPower: "strike-1", bonusDamageDice: "1d4", bonusDamageLabel: "Striking" }, vagabond: { applicationMode: "on-use" } } },
          { name: "Relic: Beastbane", icon: "icons/svg/upgrade.svg", changes: [],
            flags: { [MODULE_ID]: { relicPower: "bane-general", baneTarget: "Beasts", baneDice: "3d6" }, vagabond: { applicationMode: "on-use" } } },
        ],
      }]);

      const parts = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [beastNpc] });
      expect(parts.length).toBe(2);
      const formulas = parts.map(p => p.formula);
      expect(formulas).toContain("1d4");
      expect(formulas).toContain("3d6");
    });

    case_("End-to-end: rollDamage on Striking weapon includes 1d4 in formula", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest E2E Striking" }, {
        relicFlags: { relicPower: "strike-1", bonusDamageDice: "1d4", bonusDamageLabel: "Striking" },
      });
      const r = await weapon.rollDamage(pc, false, null);
      expect(r).not.toBeNull();
      expect(r.formula).toContain("1d4");
    });

    case_("End-to-end: rollDamage on plain weapon does NOT include relic dice", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest E2E Plain" });
      const r = await weapon.rollDamage(pc, false, null);
      expect(r).not.toBeNull();
      // Plain weapon — no relic dice (1d4) injected. The base die size comes
      // from the system's derived currentDamage and may legitimately include
      // 1d6, so we only assert the absence of relic-specific markers.
      expect(r.formula).not.toContain("1d4");
    });

    case_("Wrap guard survives VCE's outer wrap — re-patching cannot double-apply", async (ctx) => {
      // VCE wraps prototype.rollDamage in its own ready hook, on top of ours.
      // The guard therefore CANNOT live on our wrapper function: once VCE wraps
      // it, a function-level flag is buried in a closure and reads as "not
      // patched", so a second _patchItemRollDamage() stacked another layer and
      // relic dice applied twice (reproduced live as `1d6 + 1d4 + 1d4`).
      // wrap-guard.mjs keys the marker on the prototype instead.
      const { VagabondItem } = await import("/systems/vagabond/module/documents/item.mjs");
      const { RelicEffects } = await import("/modules/vagabond-crawler/scripts/relic-effects.mjs");
      const GUARD = Symbol.for("vagabond-crawler.wraps");

      // Visible on the prototype no matter how many layers wrap the method.
      expect(!!VagabondItem.prototype[GUARD]?.rollDamage).toBe(true);

      // Re-invoking the patch must be a no-op — same function object after.
      const before = VagabondItem.prototype.rollDamage;
      await RelicEffects._patchItemRollDamage();
      expect(VagabondItem.prototype.rollDamage).toBe(before);

      // Same for the chat-card button patch, which previously had no guard.
      const DamageHelper = (await import("/systems/vagabond/module/helpers/damage-helper.mjs")).VagabondDamageHelper;
      const beforeBtn = DamageHelper.rollDamageFromButton;
      await RelicEffects._patchDamageHelper();
      expect(DamageHelper.rollDamageFromButton).toBe(beforeBtn);
    });

  });
}
