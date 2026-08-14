/**
 * Vagabond Crawler — Relic Effects
 *
 * Runtime hooks that make relic powers functional by monkey-patching
 * the system's damage pipeline:
 * - Bane: Extra damage dice vs matching creature types
 * - Strike: Extra elemental damage dice
 * - Fabled Vicious: Extra crit damage
 * - Lifesteal/Manasteal: Heal on kill
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { isWrapped, markWrapped } from "./wrap-guard.mjs";

/* -------------------------------------------- */
/*  Helper: Get relic flags from equipped items */
/* -------------------------------------------- */

/**
 * Collect all relic power flags from an actor's equipped items.
 */
function _getEquippedRelicFlags(actor) {
  if (!actor) return [];
  const results = [];
  for (const item of actor.items) {
    if (item.type !== "equipment") continue;
    if (!item.system.equipped) continue;

    const forgeData = item.getFlag(MODULE_ID, "relicForge");
    if (!forgeData?.forged) continue;

    for (const effect of item.effects) {
      const moduleFlags = effect.flags?.[MODULE_ID];
      if (!moduleFlags?.relicPower) continue;
      results.push({ power: moduleFlags.relicPower, flags: moduleFlags, item, effect });
    }
  }
  return results;
}

/**
 * Collect relic flags from a specific weapon item.
 */
function _getWeaponRelicFlags(item) {
  if (!item) return [];
  const forgeData = item.getFlag(MODULE_ID, "relicForge");
  if (!forgeData?.forged) return [];

  const results = [];
  for (const effect of item.effects) {
    const moduleFlags = effect.flags?.[MODULE_ID];
    if (!moduleFlags?.relicPower) continue;
    results.push({ power: moduleFlags.relicPower, flags: moduleFlags, item, effect });
  }
  return results;
}

/* -------------------------------------------- */
/*  Relic Effects Singleton                     */
/* -------------------------------------------- */

export const RelicEffects = {

  init() {
    // Two patches keep relic dice on every damage path:
    //  1. VagabondItem.rollDamage  → covers item.roll(), Crawl Strip, macros,
    //                                 the system's "auto-roll damage" path,
    //                                 and any caller that pre-rolls damage
    //                                 before posting a chat card.
    //  2. VagabondDamageHelper.rollDamageFromButton → covers the chat-card
    //                                 "Roll Damage" button click.
    // Both patches share `collectBonusParts` so the formula stays in sync.
    // Bane / Vicious / Strike I-III ride on flags (changes:[]) because the
    // system's AE overlay can't carry dice strings — these patches read the
    // flags and inject the dice at roll time, scoped to the firing item.
    this._patchItemRollDamage();
    this._patchDamageHelper();

    // Hook into actor updates to detect kills for lifesteal / manasteal.
    Hooks.on("updateActor", (actor, changes, options, userId) => {
      this._onActorUpdate(actor, changes, options, userId);
    });

    // Equip-gating is now handled by the system: each relic AE carries
    // `flags.vagabond.applicationMode` (set by the Forge), which the system
    // filters in `_prepareItemEffectsList`. No more manual `disabled`
    // toggling on `updateItem` — see relic-forge.mjs and the v1.16.7
    // migration in vagabond-crawler.mjs for the data shape.

    console.log(`${MODULE_ID} | Relic Effects initialized.`);
  },

  /**
   * Collect every relic-driven bonus die/flat that should be appended to a
   * weapon damage roll. Pure function — no side effects, no DOM access — so
   * both the item-roll patch and the chat-card-button patch can share it.
   *
   * @param {Actor} actor
   * @param {Item} item   The firing weapon (relic flags are scoped to it)
   * @param {object} ctx
   * @param {boolean} [ctx.isCritical=false]
   * @param {Actor[]} [ctx.targets=[]]  World actors of the targeted tokens
   * @returns {{formula:string,label:string}[]}
   */
  collectBonusParts(actor, item, { isCritical = false, targets = [] } = {}) {
    const relicFlags = _getWeaponRelicFlags(item);
    if (relicFlags.length === 0) return [];
    const parts = [];

    // Bane: only fires when at least one targeted actor's beingType matches
    for (const { flags } of relicFlags) {
      if (!flags.baneTarget || !flags.baneDice) continue;
      for (const t of targets) {
        const bt = t?.system?.beingType || "";
        if (bt.toLowerCase().includes(flags.baneTarget.toLowerCase())) {
          parts.push({ formula: flags.baneDice, label: `Bane (${flags.baneTarget})` });
          break;
        }
      }
    }

    // Strike (typed): elemental damage rider
    for (const { flags } of relicFlags) {
      if (flags.strikeDice && flags.strikeType) {
        parts.push({ formula: flags.strikeDice, label: `${flags.strikeType} Strike` });
      }
    }

    // Strike I/II/III: untyped bonus damage dice (bonusDamageDice flag)
    for (const { flags } of relicFlags) {
      if (flags.bonusDamageDice) {
        parts.push({
          formula: flags.bonusDamageDice,
          label:   flags.bonusDamageLabel || "Bonus Damage",
        });
      }
    }

    // Fabled Vicious: extra crit damage scaled to actor's hit die
    if (isCritical) {
      for (const { flags } of relicFlags) {
        if (flags.relicPower === "vicious") {
          const hd = actor?.system?.hitDie || "d6";
          parts.push({ formula: `2${hd}`, label: "Vicious (Crit)" });
        }
      }
    }

    return parts;
  },

  /* -------------------------------------------- */
  /*  Monkey-patch: VagabondItem.rollDamage        */
  /* -------------------------------------------- */

  /**
   * Wrap the system's `VagabondItem.prototype.rollDamage` so any path that
   * calls `item.rollDamage(...)` directly (Crawl Strip action menu, macros,
   * the system's auto-roll-damage setting, character sheet flows that
   * pre-roll instead of posting a button) still picks up relic-flag bonuses.
   *
   * Mutual exclusion with the chat-card button patch: only ONE of the two
   * paths fires per attack (the chat card either has a pre-rolled damage OR
   * a Roll Damage button, never both), so there's no double-application.
   */
  async _patchItemRollDamage() {
    let VagabondItem;
    try {
      ({ VagabondItem } = await import("/systems/vagabond/module/documents/item.mjs"));
    } catch (e) {
      console.warn(`${MODULE_ID} | Could not import VagabondItem — relic dice on item.rollDamage skipped:`, e);
      return;
    }
    if (!VagabondItem?.prototype?.rollDamage) return;
    // Guard on the PROTOTYPE, not the function. VCE wraps this same method in
    // its own ready hook; once it does, a marker stamped on our wrapper is
    // buried inside its closure and reads as "not patched" — so we'd wrap again
    // and apply relic dice twice. See wrap-guard.mjs.
    if (isWrapped(VagabondItem.prototype, "rollDamage")) return;

    const original = VagabondItem.prototype.rollDamage;
    const self = this;
    async function wrapped(actor, isCritical = false, statKey = null) {
      const baseRoll = await original.call(this, actor, isCritical, statKey);
      // Base may be null (no damage formula — Grapple, Net, etc.) — pass through
      if (!baseRoll) return baseRoll;

      const targets = Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
      const parts = self.collectBonusParts(actor, this, { isCritical, targets });
      if (parts.length === 0) return baseRoll;

      const bonusFormula = parts.map(p => p.formula).join(" + ");

      // Evaluate ONLY the bonus, then splice its terms onto the ALREADY-EVALUATED
      // base roll. Do not rebuild from `baseRoll.formula` — that re-rolls the base
      // and silently discards the system's post-evaluation work. The killer case is
      // `VagabondDamageHelper._manuallyExplodeDice` (damage-helper.mjs:21), which
      // pushes extra results straight into `term.results` after evaluation; the
      // formula string keeps no record of them, since an exploding weapon's formula
      // is a plain "4d6". Re-rolling dropped every explosion — a 104-result roll
      // came back as 4.
      const bonusRoll = new Roll(bonusFormula, actor.getRollData());
      await bonusRoll.evaluate();

      // Append in place rather than building a new Roll via `Roll.fromTerms`.
      // fromTerms produces a fresh instance and drops anything the system hung
      // off the roll OBJECT — `_perDieBonusTotal`, `_perDieBonusDiceCount`,
      // `_weaknessPreRolled` (damage-helper.mjs) and the dice-appearance colorset
      // applied in item.mjs. Mutating keeps the exact instance the system
      // returned, so every reference to it stays consistent.
      const OperatorTerm = foundry.dice?.terms?.OperatorTerm ?? globalThis.OperatorTerm;
      try {
        const totalBefore = baseRoll.total;   // may already include system adjustments
        baseRoll.terms.push(new OperatorTerm({ operator: "+" }), ...bonusRoll.terms);
        baseRoll._formula = Roll.getFormula(baseRoll.terms);
        baseRoll._total = totalBefore + bonusRoll.total;
      } catch (err) {
        // Degrade to the base roll untouched: losing the relic rider is far
        // better than losing the weapon's own damage and its explosions.
        console.error(`${MODULE_ID} | Relic dice merge failed — base roll left unmodified:`, err);
        return baseRoll;
      }

      const labels = parts.map(p => p.label).join(", ");
      console.log(`${MODULE_ID} | Relic dice merged into item.rollDamage: ${labels} (${bonusFormula})`);
      return baseRoll;   // mutated in place — same instance the system returned
    }
    wrapped.__vcRelicWrapped = true;   // kept for debugging/introspection only
    VagabondItem.prototype.rollDamage = wrapped;
    markWrapped(VagabondItem.prototype, "rollDamage");
    console.log(`${MODULE_ID} | Patched VagabondItem.prototype.rollDamage for relic effects.`);
  },

  /* -------------------------------------------- */
  /*  Monkey-patch: VagabondDamageHelper           */
  /* -------------------------------------------- */

  async _patchDamageHelper() {
    // Import from the system's module path
    let DamageHelper;
    try {
      const mod = await import("/systems/vagabond/module/helpers/damage-helper.mjs");
      DamageHelper = mod.VagabondDamageHelper;
    } catch (e) {
      console.warn(`${MODULE_ID} | Could not import VagabondDamageHelper:`, e);
      return;
    }

    if (!DamageHelper) {
      console.warn(`${MODULE_ID} | VagabondDamageHelper not found in module export.`);
      return;
    }
    // Previously unguarded entirely. A second patch would stack another layer,
    // each appending the bonus dice to `button.dataset.damageFormula` — so the
    // chat-card "Roll Damage" button would roll the relic rider twice.
    if (isWrapped(DamageHelper, "rollDamageFromButton")) return;

    const origRollDamage = DamageHelper.rollDamageFromButton.bind(DamageHelper);

    DamageHelper.rollDamageFromButton = async function(button, messageId) {
      // Before the original runs, check for relic bonuses and inject into the button's formula
      const actorId = button.dataset.actorId;
      const itemId = button.dataset.itemId;
      const actor = game.actors.get(actorId);
      const item = actor?.items.get(itemId);

      if (actor && item) {
        const context = JSON.parse((button.dataset.context || "{}").replace(/&quot;/g, '"'));
        const targets = Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
        const bonusParts = RelicEffects.collectBonusParts(actor, item, { isCritical: !!context.isCritical, targets });
        if (bonusParts.length > 0) {
          const bonusFormula = bonusParts.map(b => b.formula).join(" + ");
          const origFormula = button.dataset.damageFormula;
          button.dataset.damageFormula = `${origFormula} + ${bonusFormula}`;
          const labels = bonusParts.map(b => b.label).join(", ");
          console.log(`${MODULE_ID} | Relic bonus injected: ${labels} (${bonusFormula})`);
        }
      }

      // Call the original
      return origRollDamage(button, messageId);
    };

    markWrapped(DamageHelper, "rollDamageFromButton");
    console.log(`${MODULE_ID} | Patched VagabondDamageHelper.rollDamageFromButton for relic effects.`);
  },

  /* -------------------------------------------- */
  /*  On Kill: Lifesteal / Manasteal              */
  /* -------------------------------------------- */

  async _onActorUpdate(actor, changes, options, userId) {
    if (!game.user.isGM) return;
    if (actor.type !== "npc") return;

    // Check if HP dropped to 0 or below
    const newHP = changes?.system?.health?.value;
    if (newHP === undefined || newHP > 0) return;

    // Find who killed this NPC — check the current combatant
    const combat = game.combat;
    if (!combat) return;
    const currentCombatant = combat.combatant;
    if (!currentCombatant?.actor || currentCombatant.actor.type !== "character") return;

    const killer = currentCombatant.actor;
    const relicFlags = _getEquippedRelicFlags(killer);

    for (const { flags } of relicFlags) {
      // Lifesteal: heal on kill (uses onKillHealDice flag)
      const healDice = flags.onKillHealDice;
      if (healDice) {
        try {
          const roll = new Roll(healDice);
          await roll.evaluate();
          const healAmount = roll.total;
          const currentHP = killer.system.health.value;
          const maxHP = killer.system.health.max;
          const newHPVal = Math.min(currentHP + healAmount, maxHP);
          await killer.update({ "system.health.value": newHPVal });

          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: killer }),
            content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
              <div class="card-body">
                <header class="card-header">
                  <div class="header-icon">
                    <i class="fas fa-heart-pulse" style="font-size:1.5em; color:#e74c3c;"></i>
                  </div>
                  <div class="header-info">
                    <h3 class="header-title">Lifesteal</h3>
                    <div class="metadata-tags-row">
                      <div class="meta-tag"><span>${killer.name}</span></div>
                    </div>
                  </div>
                </header>
                <section class="content-body">
                  <div class="card-description" style="text-align:center; padding:4px 0;">
                    <p>Healed <strong>${healAmount} HP</strong> (${healDice}) from slaying ${actor.name}.</p>
                  </div>
                </section>
              </div>
            </div>`,
            rolls: [roll],
          });
        } catch (e) {
          console.error(`${MODULE_ID} | Lifesteal roll failed:`, e);
        }
      }

      // Manasteal: restore mana on kill (uses onKillManaDice flag)
      const manaDice = flags.onKillManaDice;
      if (manaDice) {
        try {
          const roll = new Roll(manaDice);
          await roll.evaluate();
          const manaAmount = roll.total;
          const currentMana = killer.system.mana?.value ?? 0;
          const maxMana = killer.system.mana?.max ?? 0;
          if (maxMana > 0) {
            const newManaVal = Math.min(currentMana + manaAmount, maxMana);
            await killer.update({ "system.mana.value": newManaVal });

            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: killer }),
              content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
                <div class="card-body">
                  <header class="card-header">
                    <div class="header-icon">
                      <i class="fas fa-hat-wizard" style="font-size:1.5em; color:#7b5ea7;"></i>
                    </div>
                    <div class="header-info">
                      <h3 class="header-title">Manasteal</h3>
                      <div class="metadata-tags-row">
                        <div class="meta-tag"><span>${killer.name}</span></div>
                      </div>
                    </div>
                  </header>
                  <section class="content-body">
                    <div class="card-description" style="text-align:center; padding:4px 0;">
                      <p>Restored <strong>${manaAmount} Mana</strong> (${manaDice}) from slaying ${actor.name}.</p>
                    </div>
                  </section>
                </div>
              </div>`,
              rolls: [roll],
            });
          }
        } catch (e) {
          console.error(`${MODULE_ID} | Manasteal roll failed:`, e);
        }
      }
    }
  },
};
