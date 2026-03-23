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
    // Monkey-patch the damage helper once the system is ready
    this._patchDamageHelper();

    // Hook into actor updates to detect kills for lifesteal
    Hooks.on("updateActor", (actor, changes, options, userId) => {
      this._onActorUpdate(actor, changes, options, userId);
    });

    console.log(`${MODULE_ID} | Relic Effects initialized.`);
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

    const origRollDamage = DamageHelper.rollDamageFromButton.bind(DamageHelper);

    DamageHelper.rollDamageFromButton = async function(button, messageId) {
      // Before the original runs, check for relic bonuses and inject into the button's formula
      const actorId = button.dataset.actorId;
      const itemId = button.dataset.itemId;
      const actor = game.actors.get(actorId);
      const item = actor?.items.get(itemId);

      if (actor && item) {
        const relicFlags = _getWeaponRelicFlags(item);
        if (relicFlags.length > 0) {
          const targets = Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
          const context = JSON.parse((button.dataset.context || "{}").replace(/&quot;/g, '"'));
          const bonusParts = [];

          // Bane: check target creature type
          for (const { flags } of relicFlags) {
            const baneTarget = flags.baneTarget;
            const baneDice = flags.baneDice;
            if (!baneTarget || !baneDice) continue;

            for (const target of targets) {
              const beingType = target.system?.beingType || "";
              if (beingType.toLowerCase().includes(baneTarget.toLowerCase())) {
                bonusParts.push({ formula: baneDice, label: `Bane (${baneTarget})` });
                break;
              }
            }
          }

          // Strike: add elemental damage
          for (const { flags } of relicFlags) {
            if (flags.strikeDice && flags.strikeType) {
              bonusParts.push({ formula: flags.strikeDice, label: `${flags.strikeType} Strike` });
            }
          }

          // Fabled Vicious: extra crit damage
          if (context.isCritical) {
            for (const { flags } of relicFlags) {
              if (flags.relicPower === "vicious") {
                const hd = actor.system?.hitDie || "d6";
                bonusParts.push({ formula: `2${hd}`, label: "Vicious (Crit)" });
              }
            }
          }

          // Inject bonus into the damage formula
          if (bonusParts.length > 0) {
            const bonusFormula = bonusParts.map(b => b.formula).join(" + ");
            const origFormula = button.dataset.damageFormula;
            button.dataset.damageFormula = `${origFormula} + ${bonusFormula}`;

            // Post a notification about the bonus
            const labels = bonusParts.map(b => b.label).join(", ");
            console.log(`${MODULE_ID} | Relic bonus injected: ${labels} (${bonusFormula})`);
          }
        }
      }

      // Call the original
      return origRollDamage(button, messageId);
    };

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
