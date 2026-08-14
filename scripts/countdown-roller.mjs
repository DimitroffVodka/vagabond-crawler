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
import { isWrapped, markWrapped } from "./wrap-guard.mjs";

// Dice So Nice animation takes ~2 seconds; pad to avoid overlap.
const DICE_ANIM_DELAY = 2500;

// ── Helpers (lazy-loaded system imports) ────────────────────────────────────

let _CountdownDice, _StatusHelper, _VagabondChatCard;
// Captured during _createStatusCountdown so the CountdownDice.create wrapper
// can pull fatigueOnTick off the rider entry without threading an extra arg
// through the system's call chain.
let _pendingRiderEntry = null;

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
    // Patch the system's _createStatusCountdown so the rider schema's
    // `fatigueOnTick` field is persisted onto the countdown die's flags.
    // The system's status-helper has a TODO comment at the same spot; we
    // restore the feature here (Crawler-owned) rather than forking the system.
    this._patchCreateStatusCountdown();

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

  // ── Patch system's _createStatusCountdown to persist fatigueOnTick ──────

  /**
   * Wrap `StatusHelper._createStatusCountdown` so the per-rider `fatigueOnTick`
   * field is carried into the CountdownDice document's flags. The system's
   * code has a literal `// TODO: fatigueOnTick — restore when re-enabling`
   * comment in this spot; rather than fork the system, intercept the
   * CountdownDice.create call the system makes and inject the flag.
   */
  async _patchCreateStatusCountdown() {
    await _loadSystemClasses();
    if (this._createStatusCountdownPatched) return;
    this._createStatusCountdownPatched = true;

    // The helper calls CountdownDice.create() with a shallow object. Wrap
    // the static create so any call with a truthy `fatigueOnTick` on the
    // caller's scope picks up the flag. Since the system strips unknown
    // fields in its call site, we need to smuggle the value through a
    // sibling patch: patch the helper itself by capturing the caller-scope
    // `entry` before create.
    const original = _StatusHelper._createStatusCountdown;
    // Guard on the owner, not the function — see wrap-guard.mjs.
    if (!original || isWrapped(_StatusHelper, "_createStatusCountdown")) return;
    _StatusHelper._createStatusCountdown = async function (actor, entry, sourceName = "", sourceActorName = "") {
      // Temporarily stash the entry so the CountdownDice.create wrapper below
      // can pick up fatigueOnTick from it. Using a module-scope ref avoids a
      // prototype patch on CountdownDice.
      _pendingRiderEntry = entry;
      try {
        return await original.call(this, actor, entry, sourceName, sourceActorName);
      } finally {
        _pendingRiderEntry = null;
      }
    };
    _StatusHelper._createStatusCountdown.__vcbPatchedFatigueOnTick = true;  // debugging only
    markWrapped(_StatusHelper, "_createStatusCountdown");

    // Wrap CountdownDice.create — system's create doesn't persist the
    // fatigueOnTick field (there's a literal TODO in the system code), so
    // after the journal is created, stamp the flag directly if the pending
    // rider entry has fatigueOnTick > 0.
    const createOrig = _CountdownDice.create;
    if (createOrig && !isWrapped(_CountdownDice, "create")) {
      _CountdownDice.create = async function (data = {}) {
        const fot = Number(_pendingRiderEntry?.fatigueOnTick) || 0;
        const journal = await createOrig.call(this, data);
        if (journal && fot > 0) {
          await journal.update({ "flags.vagabond.countdownDice.fatigueOnTick": fot });
        }
        return journal;
      };
      _CountdownDice.create.__vcbPatchedFatigueOnTick = true;  // debugging only
      markWrapped(_CountdownDice, "create");
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

    // Per-tick fatigue — the "+1 Fatigue each Round while Sickened" pattern
    // (Ettercap, Giant Spider, Tarantella, Violet Fungus, etc). Reads the
    // fatigueOnTick flag we stamp in _patchCreateStatusCountdown. Independent
    // of tickDamageEnabled — a rider can have one, the other, or both.
    const fatigueOnTick = Number(flags.fatigueOnTick) || 0;
    if (fatigueOnTick > 0 && flags.linkedActorUuid) {
      try {
        const actor = await fromUuid(flags.linkedActorUuid);
        if (actor?.system?.fatigue !== undefined) {
          const autoApply = game.settings.get("vagabond", "autoApplySaveDamage");
          if (autoApply) {
            const current = actor.system.fatigue ?? 0;
            const max = actor.system.fatigueMax ?? 5;
            await actor.update({ "system.fatigue": Math.min(max, current + fatigueOnTick) });
            ChatMessage.create({
              content: `<div class="vagabond-chat-card-v2" data-card-type="apply-result">
                <div class="card-body"><section class="content-body">
                  <div class="card-description" style="text-align:center;">
                    <strong>${actor.name}</strong> gains <strong>+${fatigueOnTick} Fatigue</strong> (${flags.linkedStatusId || "ongoing effect"} tick).
                  </div>
                </section></div>
              </div>`,
              speaker: ChatMessage.getSpeaker({ actor })
            });
          }
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | Countdown fatigue tick error:`, err);
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
