/**
 * Vagabond Crawler — Relic Effects
 *
 * Runtime hooks that make relic powers functional:
 * - Bane: Extra damage dice vs matching creature types
 * - Strike: Extra elemental damage dice
 * - Protection: Favor on saves vs creature types
 * - Fabled Vicious: Extra crit damage
 * - Lifesteal/Manasteal: Heal on kill
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

/* -------------------------------------------- */
/*  Helper: Get relic flags from equipped items */
/* -------------------------------------------- */

/**
 * Collect all relic power flags from an actor's equipped items.
 * Returns an array of { power, flags, item } objects.
 */
function _getEquippedRelicFlags(actor) {
  if (!actor) return [];
  const results = [];
  for (const item of actor.items) {
    if (item.type !== "equipment") continue;
    if (!item.system.equipped) continue;

    const forgeData = item.getFlag(MODULE_ID, "relicForge");
    if (!forgeData?.forged) continue;

    // Collect flags from Active Effects on this item
    for (const effect of item.effects) {
      const relicPower = effect.flags?.[MODULE_ID]?.relicPower;
      if (!relicPower) continue;

      // Also check the original power flags stored in the AE
      const powerFlags = effect.flags || {};
      results.push({ power: relicPower, flags: powerFlags, item, effect });
    }
  }
  return results;
}

/**
 * Get the weapon item from a chat message's damage button context.
 */
function _getItemFromMessage(message) {
  const content = message.content || "";
  // Look for data-actor-id and data-item-id in the chat card
  const actorMatch = content.match(/data-actor-id="([^"]+)"/);
  const itemMatch = content.match(/data-item-id="([^"]+)"/);
  if (!actorMatch || !itemMatch) return null;

  const actor = game.actors.get(actorMatch[1]);
  if (!actor) return null;
  return actor.items.get(itemMatch[1]) || null;
}

/**
 * Get the actor who owns a chat message.
 */
function _getActorFromMessage(message) {
  const speaker = message.speaker;
  if (speaker?.actor) return game.actors.get(speaker.actor);
  return null;
}

/**
 * Get the targeted actor(s).
 */
function _getTargetActors() {
  return Array.from(game.user.targets).map(t => t.actor).filter(Boolean);
}

/* -------------------------------------------- */
/*  Relic Effects Singleton                     */
/* -------------------------------------------- */

export const RelicEffects = {

  init() {
    // Hook into chat messages to detect damage rolls and add relic bonuses
    Hooks.on("renderChatMessage", (message, html, data) => {
      this._onRenderDamageMessage(message, html);
    });

    // Hook into actor updates to detect kills for lifesteal
    Hooks.on("updateActor", (actor, changes, options, userId) => {
      this._onActorUpdate(actor, changes, options, userId);
    });

    console.log(`${MODULE_ID} | Relic Effects initialized.`);
  },

  /* -------------------------------------------- */
  /*  Damage Message: Add Bane/Strike/Crit Bonus  */
  /* -------------------------------------------- */

  async _onRenderDamageMessage(message, html) {
    if (!game.user.isGM) return;

    // Only process damage messages (they have damage rolls)
    if (!message.rolls?.length) return;

    // Check if we already processed this message
    const el = html instanceof jQuery ? html[0] : html;
    if (el.querySelector(".relic-bonus-applied")) return;

    // Get the actor and item from the message
    const actor = _getActorFromMessage(message);
    if (!actor) return;

    const relicFlags = _getEquippedRelicFlags(actor);
    if (relicFlags.length === 0) return;

    // Get targets
    const targets = _getTargetActors();

    // Collect bonus dice to add
    const bonusParts = [];

    // Check for Bane powers
    for (const { flags, item } of relicFlags) {
      const baneTarget = flags.baneTarget;
      const baneDice = flags.baneDice;
      if (!baneTarget || !baneDice) continue;

      for (const target of targets) {
        const beingType = target.system?.beingType || "";
        const targetName = target.name || "";
        const resolvedBane = baneTarget.replace("{input}", "");

        // Check if target matches the bane type (being type or name match)
        if (beingType.toLowerCase().includes(resolvedBane.toLowerCase()) ||
            targetName.toLowerCase().includes(resolvedBane.toLowerCase())) {
          bonusParts.push({
            formula: baneDice,
            label: `Bane (${resolvedBane})`,
            type: "bane",
          });
          break; // Only add once per bane power
        }
      }
    }

    // Check for Strike powers (extra elemental damage)
    for (const { power, flags, item } of relicFlags) {
      const strikeDice = flags.strikeDice;
      const strikeType = flags.strikeType;
      if (!strikeDice || !strikeType) continue;

      bonusParts.push({
        formula: strikeDice,
        label: `${strikeType} Strike`,
        type: "strike",
      });
    }

    // Check for crit-specific bonuses
    const isCrit = message.content?.includes("Critical") || message.content?.includes("crit");
    if (isCrit) {
      for (const { flags } of relicFlags) {
        // Thundering: +1d8 on crit
        if (flags.relicPower === "strike-thundering" || flags.strikeType === "Thunder") {
          // Thundering is already in strike — skip duplicate
        }
        // Fabled Vicious: +2x HD on crit
        if (flags.relicPower === "fabled-vicious") {
          const hd = actor.system?.hitDie || "d6";
          bonusParts.push({
            formula: `2${hd}`,
            label: "Vicious (Crit)",
            type: "vicious",
          });
        }
      }
    }

    // If no bonus to add, done
    if (bonusParts.length === 0) return;

    // Roll and post the bonus damage as a follow-up
    const totalFormula = bonusParts.map(b => b.formula).join(" + ");
    const labels = bonusParts.map(b => b.label).join(", ");

    try {
      const roll = new Roll(totalFormula);
      await roll.evaluate();

      await ChatMessage.create({
        speaker: message.speaker,
        content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
          <div class="card-body">
            <header class="card-header">
              <div class="header-icon">
                <i class="fas fa-gem" style="font-size:1.5em; color:#f4c542;"></i>
              </div>
              <div class="header-info">
                <h3 class="header-title">Relic Bonus Damage</h3>
                <div class="metadata-tags-row">
                  <div class="meta-tag"><span>${labels}</span></div>
                </div>
              </div>
            </header>
            <section class="content-body">
              <div class="card-description" style="text-align:center; padding:6px 0;">
                <p style="font-size:1.3em; font-weight:bold; color:#f4c542;">+${roll.total} damage</p>
                <p style="color:#888; font-size:0.85em;">${totalFormula} = ${roll.total}</p>
              </div>
            </section>
          </div>
        </div>`,
        rolls: [roll],
      });
    } catch (e) {
      console.error(`${MODULE_ID} | Relic bonus damage roll failed:`, e);
    }
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
    const oldHP = actor.system.health.value;
    if (oldHP <= 0) return; // Already dead

    // Find who killed this NPC — check the last attacker from combat
    const combat = game.combat;
    if (!combat) return;

    // Get the current combatant (likely the killer)
    const currentCombatant = combat.combatant;
    if (!currentCombatant?.actor) return;

    const killer = currentCombatant.actor;
    if (killer.type !== "character") return;

    const relicFlags = _getEquippedRelicFlags(killer);

    for (const { flags } of relicFlags) {
      // Lifesteal: heal 1d6 on kill
      if (flags.relicPower === "utility-lifesteal") {
        const healAmount = Math.floor(Math.random() * 6) + 1; // Manual d6 (avoid Roll.evaluate issues)
        const currentHP = killer.system.health.value;
        const maxHP = killer.system.health.max;
        const newHP = Math.min(currentHP + healAmount, maxHP);
        await killer.update({ "system.health.value": newHP });

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
                  <p>Healed <strong>${healAmount} HP</strong> from slaying ${actor.name}.</p>
                </div>
              </section>
            </div>
          </div>`,
        });
      }

      // Manasteal: recover 1 spell slot on kill
      if (flags.relicPower === "utility-manasteal") {
        // Try to recover lowest empty spell slot
        const spellSlots = killer.system.spellSlots;
        if (spellSlots) {
          let recovered = false;
          for (let i = 0; i < spellSlots.length && !recovered; i++) {
            if (spellSlots[i]?.used) {
              await killer.update({ [`system.spellSlots.${i}.used`]: false });
              recovered = true;
            }
          }
          if (recovered) {
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
                      <p>Recovered a spell slot from slaying ${actor.name}.</p>
                    </div>
                  </section>
                </div>
              </div>`,
            });
          }
        }
      }
    }
  },
};
