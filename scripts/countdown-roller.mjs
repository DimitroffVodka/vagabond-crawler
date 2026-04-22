/**
 * Vagabond Crawler — Countdown Dice Auto-Roller
 *
 * Automatically rolls all combat-linked countdown dice at the start of
 * each round.  Applies tick damage (burning, poison, etc.) and shrinks
 * or expires dice on a roll of 1.  Cleans up combat-linked dice when
 * combat ends.
 *
 * Replicates the roll logic from the system's CountdownDiceOverlay
 * (_onRollDice) so the module can drive rolls from combat hooks.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

// Dice So Nice animation takes ~2 seconds; pad to avoid overlap.
const DICE_ANIM_DELAY = 2500;

// ── Helpers (lazy-loaded system imports) ────────────────────────────────────

let _CountdownDice, _StatusHelper, _VagabondChatCard;

async function _loadSystemClasses() {
  if (!_CountdownDice) {
    ({ CountdownDice: _CountdownDice } = await import(
      "../../../systems/vagabond/module/documents/countdown-dice.mjs"
    ));
  }
  if (!_StatusHelper) {
    ({ StatusHelper: _StatusHelper } = await import(
      "../../../systems/vagabond/module/helpers/status-helper.mjs"
    ));
  }
  if (!_VagabondChatCard) {
    ({ VagabondChatCard: _VagabondChatCard } = await import(
      "../../../systems/vagabond/module/helpers/chat-card.mjs"
    ));
  }
}

// ── CountdownRoller singleton ───────────────────────────────────────────────

export const CountdownRoller = {

  // ── Settings ─────────────────────────────────────────────────────────────

  registerSettings() {
    game.settings.register(MODULE_ID, "countdownAutoRoll", {
      name: "Auto-Roll Countdown Dice",
      hint: "Automatically roll all combat-linked countdown dice at the start of each round.",
      scope: "world", config: false, type: Boolean, default: true,
    });
  },

  // ── Init ──────────────────────────────────────────────────────────────────

  init() {
    Hooks.on("updateCombat", (combat, changes) => {
      if (!game.user.isGM) return;
      if (changes.round === undefined) return;       // round change only
      this._onRoundStart(combat);
    });

    Hooks.on("deleteCombat", (combat) => {
      if (!game.user.isGM) return;
      this._cleanup(combat);
    });

    // Clean up countdowns linked to an NPC when that NPC dies. Burning /
    // Poisoned / Bleeding dice should not keep ticking on a corpse (and
    // the status icons shouldn't linger on the token either — the system's
    // deleteJournalEntry hook removes those as a side effect of delete).
    // Scope: NPCs only. PCs at 0 HP are downed, not dead, and may be
    // revived while their conditions are still supposed to matter.
    Hooks.on("updateActor", (actor, changes) => {
      if (!game.user.isGM) return;
      if (actor.type !== "npc") return;
      const newHP = changes?.system?.health?.value;
      if (newHP === undefined) return;  // HP didn't change
      if (newHP > 0) return;
      this._cleanupForDeadActor(actor).catch(err => {
        console.warn(`${MODULE_ID} | Countdown death cleanup error:`, err);
      });
    });
  },

  // ── Round start — auto-roll ──────────────────────────────────────────────

  async _onRoundStart(combat) {
    if (!game.settings.get(MODULE_ID, "countdownAutoRoll")) return;

    await _loadSystemClasses();

    // Build set of combatant actor UUIDs
    // Gather all countdown dice except NPC recharge cooldowns
    const allDice = _CountdownDice.getAll();
    const toRoll = allDice.filter(d => {
      const flags = d.flags?.vagabond?.countdownDice;
      if (!flags) return false;
      if (flags.linkedRechargeActorUuid) return false;   // recharge cooldowns roll separately
      return true;
    });

    if (!toRoll.length) return;
    console.log(`${MODULE_ID} | Countdown auto-roll: ${toRoll.length} dice for round ${combat.round}`);

    // Roll sequentially to avoid Dice So Nice animation collisions
    for (const diceJournal of toRoll) {
      const fresh = game.journal.get(diceJournal.id);
      if (!fresh) continue;                              // deleted mid-loop
      await this._rollDie(fresh);
      await new Promise(r => setTimeout(r, DICE_ANIM_DELAY));
    }
  },

  // ── Roll a single countdown die ──────────────────────────────────────────

  async _rollDie(diceJournal) {
    const flags = diceJournal.flags.vagabond.countdownDice;
    const diceType = flags.diceType;

    // Roll
    const roll = new Roll(`1${diceType}`);
    await roll.evaluate();
    const rollResult = roll.total;

    // Tick damage (GM only, mirrors overlay logic exactly)
    let tickData = null;
    if (flags.linkedActorUuid && flags.tickDamageEnabled) {
      try {
        const actor = await fromUuid(flags.linkedActorUuid);
        if (actor) {
          tickData = await _StatusHelper.dealTickDamage(
            actor,
            flags.tickDamageFormula ?? "",
            flags.tickDamageType ?? "-",
            flags.linkedStatusId ?? "",
            rollResult,
          );
          if (tickData) {
            const autoApply = game.settings.get("vagabond", "autoApplySaveDamage");
            if (autoApply && tickData.finalDamage > 0) {
              const currentHP = actor.system.health?.value ?? 0;
              const newHP = Math.max(0, currentHP - tickData.finalDamage);
              await actor.update({ "system.health.value": newHP });
              await _VagabondChatCard.applyResult(actor, {
                type: "damage",
                rawAmount: tickData.rawDamage,
                finalAmount: tickData.finalDamage,
                damageType: tickData.damageTypeKey,
                previousValue: currentHP,
                newValue: newHP,
                sourceName: tickData.statusLabel,
              });
            }
            tickData.autoApplied = autoApply;
          }
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | Countdown auto-roll tick damage error:`, err);
      }
    }

    // Shrink / expire
    if (rollResult === 1) {
      const smallerDice = _CountdownDice.getSmallerDice(diceType);
      if (smallerDice === null) {
        // d4 rolled 1 — countdown ends
        await this._postChat(diceJournal, roll, rollResult, "ended", null, tickData);
        await diceJournal.delete();  // system deleteJournalEntry hook removes status + recharge
      } else {
        await this._postChat(diceJournal, roll, rollResult, "reduced", smallerDice, tickData);
        await diceJournal.update({ "flags.vagabond.countdownDice.diceType": smallerDice });
      }
    } else {
      await this._postChat(diceJournal, roll, rollResult, "continues", null, tickData);
    }
  },

  // ── Chat message (delegates to system) ───────────────────────────────────

  async _postChat(dice, roll, rollResult, status, newDiceType, tickData) {
    const currentDiceType = dice.flags.vagabond.countdownDice.diceType;
    await _VagabondChatCard.countdownDiceRoll(
      dice, roll, rollResult, status, currentDiceType, newDiceType, tickData,
    );
  },

  // ── Actor death — cleanup linked countdowns ─────────────────────────────

  /**
   * Delete every non-recharge countdown die linked to this actor. Called
   * from the updateActor hook when an NPC's HP drops to 0. Idempotent —
   * safe to call again if HP updates further while already dead.
   */
  async _cleanupForDeadActor(actor) {
    await _loadSystemClasses();
    const actorUuid = actor.uuid;

    const allDice = _CountdownDice.getAll();
    const toDelete = allDice.filter(d => {
      const flags = d.flags?.vagabond?.countdownDice;
      if (!flags) return false;
      if (flags.linkedRechargeActorUuid) return false;   // recharge cooldowns aren't condition timers
      return flags.linkedActorUuid === actorUuid;
    });

    if (!toDelete.length) return;
    console.log(`${MODULE_ID} | Countdown death cleanup: deleting ${toDelete.length} dice linked to ${actor.name}`);

    for (const d of toDelete) {
      try {
        await d.delete();  // system's deleteJournalEntry hook clears linked status icon
      } catch (err) {
        console.warn(`${MODULE_ID} | Countdown death cleanup — failed to delete ${d.id}:`, err);
      }
    }
  },

  // ── Combat end — cleanup ─────────────────────────────────────────────────

  async _cleanup(combat) {
    await _loadSystemClasses();

    // Delete all non-recharge countdown dice when combat ends
    const allDice = _CountdownDice.getAll();
    const toDelete = allDice.filter(d => {
      const flags = d.flags?.vagabond?.countdownDice;
      if (!flags) return false;
      if (flags.linkedRechargeActorUuid) return false;  // keep recharge cooldowns
      return true;
    });

    if (!toDelete.length) return;
    console.log(`${MODULE_ID} | Countdown cleanup: deleting ${toDelete.length} dice`);

    for (const d of toDelete) {
      try {
        await d.delete();  // system hook handles status removal
      } catch (err) {
        console.warn(`${MODULE_ID} | Countdown cleanup error:`, err);
      }
    }
  },
};
