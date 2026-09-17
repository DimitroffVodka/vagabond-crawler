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

    case_("Vicious: fires only on critical hits, 2× HD (NPC) or 2× Level (PC)", async (ctx) => {
      const RelicEffects = await loadRelicEffects();
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Vicious" }, {
        relicFlags: { relicPower: "vicious" },
      });
      const onHit  = RelicEffects.collectBonusParts(pc, weapon, { isCritical: false, targets: [] });
      const onCrit = RelicEffects.collectBonusParts(pc, weapon, { isCritical: true,  targets: [] });
      expect(onHit).toEqual([]);
      expect(onCrit.length).toBe(1);
      // PCs have no HD; Level stands in.
      expect(onCrit[0].formula).toBe(String(2 * (pc.system.attributes.level.value ?? 1)));
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

    case_("Vicious fires only on real crits, whatever shape isCritical arrives in", async (ctx) => {
      // Callers disagree: roll-handler.mjs:352 and vagabond.mjs:2448 pass a
      // boolean, chat-card.mjs:743 passes `{ isCritical }`. Forwarding the object
      // raw made `if (isCritical)` truthy on every hit, so Vicious added crit
      // dice to every chat-card auto-rolled attack.
      const { RelicEffects } = await import("/modules/vagabond-crawler/scripts/relic-effects.mjs");
      const { actor } = await ctx.fx.createTestPC(ctx);
      const [w] = await actor.createEmbeddedDocuments("Item", [{
        name: "VCTest Vicious Blade", type: "equipment",
        system: { equipmentType: "weapon", baseSlots: 1, damageType: "physical", equipmentState: "oneHand" },
        flags: { "vagabond-crawler": { relicForge: { forged: true } } },
        effects: [{ name: "Vicious", changes: [], flags: { "vagabond-crawler": { relicPower: "vicious" } } }],
      }], { skipStack: true });

      const labels = v => RelicEffects.collectBonusParts(actor, w, { isCritical: v, targets: [] }).map(p => p.label);
      expect(labels(false).length).toBe(0);
      expect(labels(true).length).toBeGreaterThan(0);
      // The regression: an object with isCritical:false must NOT count as a crit.
      expect(labels({ isCritical: false }).length).toBe(0);
      expect(labels({ isCritical: true }).length).toBeGreaterThan(0);
    });

    case_("wrap guard does not leak across the prototype chain", async (ctx) => {
      // `owner[GUARD]?.[key]` walks the prototype chain, so a subclass that
      // OVERRIDES a wrapped parent method inherited the marker and was silently
      // skipped. isWrapped() must be an own-property check.
      const { isWrapped, markWrapped } = await import("/modules/vagabond-crawler/scripts/wrap-guard.mjs");
      class Parent { foo() {} }
      class Child extends Parent { foo() {} }

      markWrapped(Parent.prototype, "foo");
      expect(isWrapped(Parent.prototype, "foo")).toBe(true);
      expect(isWrapped(Child.prototype, "foo")).toBe(false);   // the leak

      // ...and marking a key on the child must not shadow the parent's record.
      markWrapped(Child.prototype, "bar");
      expect(isWrapped(Parent.prototype, "foo")).toBe(true);
      expect(isWrapped(Child.prototype, "bar")).toBe(true);
    });

    case_("chat-card damage button does not compound the relic rider across clicks", async (ctx) => {
      // Chat-card buttons persist after being clicked. The handler used to read
      // `damageFormula`, append the bonus, and write it back — so a second click
      // turned "1d8 + 1d4" into "1d8 + 1d4 + 1d4", and so on.
      const DamageHelper = (await import("/systems/vagabond/module/helpers/damage-helper.mjs")).VagabondDamageHelper;
      const { actor } = await ctx.fx.createTestPC(ctx);
      const [relic] = await actor.createEmbeddedDocuments("Item", [{
        name: "VCTest Striking Blade", type: "equipment",
        system: { equipmentType: "weapon", baseSlots: 1, damageType: "physical", equipmentState: "oneHand" },
        flags: { "vagabond-crawler": { relicForge: { forged: true } } },
        effects: [{ name: "Striking", changes: [], flags: { "vagabond-crawler": {
          relicPower: "strike-1", bonusDamageDice: "1d4", bonusDamageLabel: "Striking" } } }],
      }], { skipStack: true });

      const btn = document.createElement("button");
      btn.dataset.actorId = actor.id;
      btn.dataset.itemId = relic.id;
      btn.dataset.damageFormula = "1d8";
      btn.dataset.context = "{}";

      for (let i = 0; i < 3; i++) {
        // The original needs a real chat message; we only care about the dataset
        // mutation the wrapper performs before delegating.
        try { await DamageHelper.rollDamageFromButton(btn, null); } catch { /* expected */ }
      }
      const riders = (btn.dataset.damageFormula.match(/1d4/g) ?? []).length;
      expect(riders).toBe(1);
      expect(btn.dataset.damageFormula).toBe("1d8 + 1d4");
    });


    // ── Defensive / token relic powers ─────────────────────────────────────
    const forgeRing = async (actor, ids, userInputs = {}) => {
      const { RelicForge } = await import(`/modules/${MODULE_ID}/scripts/relic-forge.mjs`);
      const { getRelicPower } = await import(`/modules/${MODULE_ID}/scripts/relic-powers.mjs`);
      const [ring] = await actor.createEmbeddedDocuments("Item", [{ name: "VCTest Ring", type: "equipment", system: { equipmentType: "gear", equipmentState: "worn" } }]);
      await RelicForge.forgeItem(ring, ids.map(getRelicPower), { userInputs });
      return ring;
    };
    const DH = async () => (await import("/systems/vagabond/module/helpers/damage-helper.mjs")).VagabondDamageHelper;
    const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 50)); return fn(); };

    case_("Resistance (Fire) halves fire damage before armor, not other types", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      await forgeRing(pc, ["resistance-typed"], { "resistance-typed": "Fire" });
      const D = await DH();
      expect(D.calculateFinalDamageDetailed(pc, 10, "fire", null).final).toBe(5);
      expect(D.calculateFinalDamageDetailed(pc, 10, "cold", null).final).toBe(10);
    });

    case_("Protection (Undead) grants the save Favor vote vs Undead only", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const { actor: undead } = await ctx.fx.createTestNPC(ctx, { system: { beingType: "Undead" } });
      const { actor: beast } = await ctx.fx.createTestNPC(ctx, { system: { beingType: "Beasts" } });
      await forgeRing(pc, ["protection-general"], { "protection-general": "Undead" });
      const D = await DH();
      expect(await D._hasStatusResistanceForSave(pc, "will", { sourceActor: undead })).toBe(true);
      expect(await D._hasStatusResistanceForSave(pc, "will", { sourceActor: beast })).toBe(false);
    });

    case_("Nightvision + Tremors + Radiant apply to the token and clear on unequip", async (ctx) => {
      const { actor: pc, token } = await ctx.fx.createTestPC(ctx);
      const tdoc = token.document ?? token;
      const ring = await forgeRing(pc, ["senses-nightvision", "senses-tremors", "utility-radiant-1"]);
      expect(await until(() => tdoc.sight.visionMode === "darkvision" && tdoc.light.dim > 0)).toBe(true);
      expect(tdoc.toObject().detectionModes.feelTremor?.enabled).toBe(true);
      await ring.update({ "system.equipmentState": "unequipped" });
      expect(await until(() => tdoc.sight.visionMode !== "darkvision" && !tdoc.light.dim)).toBe(true);
      expect(tdoc.toObject().detectionModes.feelTremor).toBe(undefined);
    });

    case_("A relic light comes back after a system torch on the same token is doused", async (ctx) => {
      const LS = game.vagabond?.lightSource;
      if (!LS) return;
      const { actor: pc, token } = await ctx.fx.createTestPC(ctx);
      const tdoc = token.document ?? token;
      await forgeRing(pc, ["utility-moonlit-1"]);
      expect(await until(() => tdoc.light.dim > 0)).toBe(true);
      const relicDim = tdoc.light.dim;
      const [torch] = await pc.createEmbeddedDocuments("Item", [{ name: "Torch", type: "equipment",
        system: { equipmentType: "gear", macro: { command: "game.vagabond.lightSource.use({ actor, item, token })" } } }]);
      const origPrompt = LS._promptMode;
      LS._promptMode = async () => "lit";
      ctx.cleanup(() => { LS._promptMode = origPrompt; });
      await LS.use({ actor: pc, item: torch, token: tdoc, light: { bright: 25, dim: 40 }, durationMin: 60 });
      expect(tdoc.light.dim).toBe(40);
      await LS.douse(tdoc);
      expect(await until(() => tdoc.light.dim === relicDim)).toBe(true);
    });


    // ── Activated relic powers (relic-activations.mjs) ─────────────────────
    const RA = () => game.vagabondCrawler.relicActivations;
    const forgeOn = async (item, ids) => {
      const { RelicForge } = await import(`/modules/${MODULE_ID}/scripts/relic-forge.mjs`);
      const { getRelicPower } = await import(`/modules/${MODULE_ID}/scripts/relic-powers.mjs`);
      await RelicForge.forgeItem(item, ids.map(getRelicPower));
    };

    case_("Loot Generator power text maps Fabled and named Bane/Protection onto forge data", async () => {
      const { _applyRelicPower } = await import(`/modules/${MODULE_ID}/scripts/loot-generator.mjs`);
      const forge = (text) => { const d = { name: "Sword", type: "equipment", system: { equipmentType: "weapon" } }; _applyRelicPower(d, text); return d.flags?.[MODULE_ID]?.relicForge; };
      expect(forge("Fabled, Vicious")?.powers?.[0]).toBe("fabled-vicious");
      expect(forge("Bane of Goblin (Niche)")?.powers?.[0]).toBe("bane-niche");
      expect(forge("Bane of Goblin (Niche)")?.userInputs?.["bane-niche"]).toBe("Goblin");
      expect(forge("Bane of Beast, Wolf")?.powers?.[0]).toBe("bane-specific");
      expect(forge("Protection vs Undead")?.powers?.[0]).toBe("protection-general");
    });

    case_("Precision forces exactly one hit, then disarms", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const weapon = await ctx.fx.addWeapon(pc, { name: "VCTest Precise" });
      await forgeOn(weapon, ["fabled-precision"]);
      await RA().menuEntries(weapon).find(e => e.label === "Precision").run();
      const first = await weapon.rollAttack(pc, "none", 999, { allowUnequipped: true });
      const second = await weapon.rollAttack(pc, "none", 999, { allowUnequipped: true });
      expect(first?.isHit).toBe(true);
      expect(second?.isHit).toBe(false);
      expect(RA().usesLeft(weapon, "precision")).toBe(0);
    });

    case_("Benediction keeps the wearer at 1 HP once, and a Rest doesn't restore it", async (ctx) => {
      const { actor: pc } = await ctx.fx.createTestPC(ctx);
      const [ring] = await pc.createEmbeddedDocuments("Item", [{ name: "VCTest Ring", type: "equipment", system: { equipmentType: "gear", equipmentState: "worn" } }]);
      await forgeOn(ring, ["fabled-benediction", "fabled-blasting"]);
      await pc.update({ "system.health.value": 1 });
      await pc.update({ "system.health.value": 0 });
      expect(pc.system.health.value).toBe(1);
      await pc.update({ "system.health.value": 0 });
      expect(pc.system.health.value).toBe(0);
      await RA()._spend(ring, "blasting");
      await RA().onRest([pc]);
      expect(RA().usesLeft(ring, "blasting")).toBe(1);
      expect(RA().usesLeft(ring, "benediction")).toBe(0);
    });

  });
}
