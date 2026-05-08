/**
 * NPC Passive Abilities — Automation hooks for monster abilities
 *
 * Extensible system: add entries to PASSIVE_ABILITIES keyed by the exact
 * ability name string found in actor.system.abilities[].name.
 *
 * Currently implemented:
 *   - Magic Ward I–VI — +N Mana surcharge on the caster, the first time each
 *     round that this being is unwillingly affected by a spell. Matches the
 *     compendium text: "The first time it is unwillingly affected by a Spell
 *     each Round, the Caster must spend an extra N Mana to affect it."
 *     Surcharge is added to totalCost before the system's mana/castingMax
 *     validation, so casters short on mana are blocked outright.
 *   - Pack Instincts / Pack Tactics — ally-adjacent target → Vulnerable,
 *     applied as a transient ActiveEffect before the NPC attack.
 *   - Nimble — attacks against this being can't be Favored if it can Move.
 *     "Can move" = not currently Incapacitated/Paralyzed/Restrained/Unconscious.
 *     Enforced inside buildAndEvaluateD20WithRollData for both cast checks
 *     and weapon attacks (rollAttack wraps toggle the _isAttackRoll flag).
 *
 * Also patches the system's missing target-modifier check for spell casts
 * (Vulnerable incomingAttacksModifier → Favor on cast checks).
 */

const MODULE_ID = "vagabond-crawler";
import { distanceFt } from "./combat-helpers.mjs";

/* ──────────────────────────────────────────────────────────────────────────────
 * PASSIVE ABILITIES TABLE
 * ──────────────────────────────────────────────────────────────────────────── */

export const PASSIVE_ABILITIES = {
  "Magic Ward I":   { type: "manaSurcharge", surcharge: 1, label: "Magic Ward I" },
  "Magic Ward II":  { type: "manaSurcharge", surcharge: 2, label: "Magic Ward II" },
  "Magic Ward III": { type: "manaSurcharge", surcharge: 3, label: "Magic Ward III" },
  "Magic Ward IV":  { type: "manaSurcharge", surcharge: 4, label: "Magic Ward IV" },
  "Magic Ward V":   { type: "manaSurcharge", surcharge: 5, label: "Magic Ward V" },
  "Magic Ward VI":  { type: "manaSurcharge", surcharge: 6, label: "Magic Ward VI" },
  "Pack Instincts":  { type: "packInstincts" },
  "Pack Tactics":    { type: "packInstincts" },
  "Pack Hunter":     { type: "packInstincts" },
  "Nimble":          { type: "nimble", label: "Nimble" },
  "Soft Underbelly": { type: "softUnderbelly", label: "Soft Underbelly" },
};

/** Flag key for tracking which round a given actor's ward was last triggered. */
const WARD_ROUND_FLAG = "wardTriggeredRound";

/** Statuses that prevent a being from moving, disabling Nimble's favor suppression. */
const NIMBLE_IMMOBILIZING_STATUSES = new Set([
  "incapacitated",
  "paralyzed",
  "restrained",
  "unconscious",
]);

/* ──────────────────────────────────────────────────────────────────────────────
 * HELPERS
 * ──────────────────────────────────────────────────────────────────────────── */

function getPassiveAbilities(actor, type) {
  const abilities = actor?.system?.abilities;
  if (!Array.isArray(abilities)) return [];

  const matches = [];
  for (const ability of abilities) {
    const def = PASSIVE_ABILITIES[ability.name];
    if (def && def.type === type) {
      matches.push(def);
    }
  }
  return matches;
}

/** Pick the strongest manaSurcharge ability on an actor (if somehow stacked). */
function strongestWardOnActor(actor) {
  const wards = getPassiveAbilities(actor, "manaSurcharge");
  if (!wards.length) return null;
  return wards.reduce((best, cur) => (cur.surcharge > (best?.surcharge ?? -Infinity) ? cur : best), null);
}

/**
 * Compute Magic Ward surcharge for the current user's targets.
 * A ward only contributes if it hasn't already been triggered *this combat round*
 * on that being. Out of combat (no active combat), every cast triggers the ward
 * because there is no round to gate on.
 *
 * Returns:
 *   {
 *     totalSurcharge: number,        // sum of all untriggered wards
 *     entries: [{ actor, ward, round }] // per-target surcharge entries to flag on success
 *   }
 */
function computeWardSurcharge(targets) {
  const result = { totalSurcharge: 0, entries: [] };
  if (!targets?.size) return result;

  const round = game.combat?.round ?? null; // null = out of combat

  for (const token of targets) {
    const actor = token.actor;
    if (!actor) continue;
    const ward = strongestWardOnActor(actor);
    if (!ward) continue;

    if (round !== null) {
      const last = actor.getFlag(MODULE_ID, WARD_ROUND_FLAG);
      if (last === round) continue; // already paid this round
    }

    result.totalSurcharge += ward.surcharge;
    result.entries.push({ actor, ward, round });
  }
  return result;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * NIMBLE
 *
 * Compendium text: "Attacks against it can't be Favored if it can Move."
 *
 * "Can Move" is interpreted as: the being is not afflicted by a status that
 * prevents movement — Incapacitated, Paralyzed, Restrained, or Unconscious.
 *
 * Mechanism: when a weapon attack (wrapped rollAttack) or spell cast
 * (_isCastCheck) resolves favor/hinder, if any targeted actor is Nimble and
 * can move, any computed "favor" is clamped to "none". This is evaluated
 * inside the buildAndEvaluateD20WithRollData wrap, AFTER the system has
 * applied the target's incomingAttacksModifier — so it overrides Vulnerable,
 * flanking, Keen, and any other favor source uniformly.
 * ──────────────────────────────────────────────────────────────────────────── */

/** True iff the actor has an ability with the given name on `system.abilities`. */
function hasAbility(actor, name) {
  return !!actor?.system?.abilities?.some((a) => a?.name === name);
}

function canActorMove(actor) {
  const statuses = actor?.statuses;
  if (!statuses?.size) return true;
  for (const s of NIMBLE_IMMOBILIZING_STATUSES) {
    if (statuses.has(s)) return false;
  }
  return true;
}

/** True iff at least one of the current user's targets has active Nimble. */
function targetsHaveActiveNimble(targets) {
  if (!targets?.size) return false;
  for (const token of targets) {
    const actor = token.actor;
    if (hasAbility(actor, "Nimble") && canActorMove(actor)) return true;
  }
  return false;
}

/** Mark each entry's actor as ward-triggered for the current round. */
async function flagWardsTriggered(entries) {
  await Promise.all(entries.map(async ({ actor, round }) => {
    if (round === null) return; // out of combat: nothing to flag
    try {
      await actor.setFlag(MODULE_ID, WARD_ROUND_FLAG, round);
    } catch (err) {
      console.warn(`${MODULE_ID} | Failed to set ward-triggered flag on ${actor.name}`, err);
    }
  }));
}

/**
 * Check all current targets for incomingAttacksModifier and adjust
 * the caster's favorHinder accordingly.  Mirrors item.mjs logic for
 * weapon attacks, but the system never does this for spell casts.
 */
function applyTargetModifiers(favorHinder) {
  if (!game.user?.targets?.size) return favorHinder;

  // Collect all sources: the incoming favorHinder plus each target's AE-based
  // incomingAttacksModifier sources (counted individually so Prone + Vulnerable
  // each contribute a separate favor for proper 1-for-1 cancellation).
  let fav = 0, hind = 0;
  if (favorHinder === "favor") fav++;
  else if (favorHinder === "hinder") hind++;

  for (const token of game.user.targets) {
    const actor = token.actor;
    if (!actor) continue;

    // Count each Active Effect that sets incomingAttacksModifier as a separate source
    let aeTouched = false;
    for (const effect of actor.effects) {
      if (effect.disabled || effect.isSuppressed) continue;
      for (const change of effect.changes) {
        if (change.key !== "system.incomingAttacksModifier") continue;
        aeTouched = true;
        if (change.value === "favor") fav++;
        else if (change.value === "hinder") hind++;
      }
    }
    // If no AEs touch the key, fall back to the stored field value
    if (!aeTouched) {
      const mod = actor.system?.incomingAttacksModifier;
      if (mod === "favor") fav++;
      else if (mod === "hinder") hind++;
    }
  }

  const net = fav - hind;
  return net > 0 ? "favor" : net < 0 ? "hinder" : "none";
}

/* ──────────────────────────────────────────────────────────────────────────────
 * MAGIC WARD (mana surcharge) + CAST-CHECK TARGET MODIFIERS
 *
 * Strategy:
 *   1. Wrap SpellHandler.prototype._calculateSpellCost to add the ward
 *      surcharge to totalCost. The system's downstream mana/castingMax
 *      validation runs against the inflated total; a caster without enough
 *      mana to cover the surcharge is blocked outright (no cast check).
 *   2. Wrap SpellHandler.prototype.castSpell to (a) flag the active Cast
 *      Check for the roll wrapper below, and (b) detect a successful cast
 *      by comparing mana before/after, and flag each triggered ward so it
 *      doesn't charge again this round.
 *   3. Wrap VagabondRollBuilder.buildAndEvaluateD20WithRollData to apply
 *      target incomingAttacksModifier (Vulnerable, Prone, etc.) to the
 *      cast's favor/hinder — the system's base code does this for weapon
 *      attacks but not for spell casts.
 *   4. Reset per-actor ward-triggered flags when the combat round advances
 *      and when combat ends.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Module-scope flag: true while a Cast Check roll is in progress. */
let _isCastCheck = false;

/** Module-scope flag: true while a weapon Attack Check roll is in progress. */
let _isAttackRoll = false;

/** Allow external callers (e.g. crawl-strip spell dialog) to bracket
 *  their own cast-check rolls with the same flag.                    */
export function setCastCheckFlag(val) { _isCastCheck = !!val; }

/** Export ward helpers so the crawl-strip spell dialog (npc-action-menu.mjs)
 *  can participate in the same Magic Ward surcharge flow. */
export { computeWardSurcharge, flagWardsTriggered };

let _hooksRegistered = false;

export function registerNpcAbilityHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;
  _wrapSystemClasses();
  _registerPackInstinctsCleanup();
  _registerWardRoundResetHook();
  _registerSoftUnderbellyHook();
  console.log(`${MODULE_ID} | NPC ability hooks registered (Magic Ward, Pack Instincts/Tactics/Hunter, Nimble, Soft Underbelly).`);
}

/** @deprecated Alias kept for backwards-compat — prefer registerNpcAbilityHooks(). */
export { registerNpcAbilityHooks as registerMagicWardHook };

/**
 * Early (setup-hook) wrap of VagabondRollBuilder.buildAndEvaluateD20WithRollData.
 *
 * Register BEFORE `vagabond-character-enhancer` runs its own ready-hook wrap
 * on the same function. VCE wraps in ready → captures our wrap as its orig →
 * VCE is outermost, we are innermost. That ordering matters because VCE's
 * wrap re-injects its `_rangeFavorHinder` AFTER combining favor sources —
 * if we wrapped outside VCE, our Nimble clamp would run before VCE's
 * combine and VCE would then re-add the favor we just removed.
 *
 * For cast checks (no _rangeFavorHinder path), nesting order is behaviorally
 * identical either way: we still apply target-modifier adjustments and
 * Nimble clamp. For weapon attacks, innermost is required.
 */
export async function registerEarlyRollBuilderWrap() {
  let VagabondRollBuilder;
  try {
    ({ VagabondRollBuilder } = await import(
      "../../../systems/vagabond/module/helpers/roll-builder.mjs"
    ));
  } catch (err) {
    console.error(`${MODULE_ID} | Early roll-builder wrap: import failed`, err);
    return;
  }
  if (!VagabondRollBuilder?.buildAndEvaluateD20WithRollData) {
    console.error(`${MODULE_ID} | Early roll-builder wrap: buildAndEvaluateD20WithRollData not found`);
    return;
  }

  const origBuild = VagabondRollBuilder.buildAndEvaluateD20WithRollData;
  VagabondRollBuilder.buildAndEvaluateD20WithRollData = async function (
    rollData,
    favorHinder,
    baseFormula = null
  ) {
    // Target incomingAttacksModifier → favor/hinder adjustment for cast checks.
    // (The system already handles this for weapon attacks inside rollAttack.)
    if (_isCastCheck) {
      const origFH = favorHinder;
      favorHinder = applyTargetModifiers(favorHinder);
      if (favorHinder !== origFH) {
        console.log(`${MODULE_ID} | Cast-check favor/hinder adjusted: "${origFH}" → "${favorHinder}" (target modifier)`);
      }
    }

    // Nimble clamp — runs at the innermost layer so VCE's `_rangeFavorHinder`
    // combine (which happens at VCE's outer layer, above this wrap) has
    // already been applied. If the final favorHinder is "favor" and any
    // target has active Nimble, clamp to "none".
    if ((_isCastCheck || _isAttackRoll) && favorHinder === "favor") {
      if (targetsHaveActiveNimble(game.user?.targets)) {
        favorHinder = "none";
        const nimbleTargets = Array.from(game.user.targets)
          .filter((t) => hasAbility(t.actor, "Nimble") && canActorMove(t.actor))
          .map((t) => t.name)
          .join(", ");
        console.log(`${MODULE_ID} | Nimble: clamped "favor" → "none" (targets: ${nimbleTargets})`);
        ui.notifications.info(`Nimble: attack against ${nimbleTargets} cannot be Favored`);
      }
    }

    return origBuild.call(this, rollData, favorHinder, baseFormula);
  };
  console.log(`${MODULE_ID} | ✓ Wrapped RollBuilder.buildAndEvaluateD20WithRollData (early/setup, innermost)`);
}

async function _wrapSystemClasses() {
  // ── 1. Import the system classes ──────────────────────────────────────────
  let SpellHandler;
  try {
    ({ SpellHandler } = await import(
      "../../../systems/vagabond/module/sheets/handlers/_module.mjs"
    ));
  } catch (err) {
    console.error(`${MODULE_ID} | Cast-check wrap: failed to import system classes`, err);
    return;
  }

  if (!SpellHandler?.prototype?.castSpell) {
    console.error(`${MODULE_ID} | SpellHandler.prototype.castSpell not found — cannot wrap`);
    return;
  }
  if (!SpellHandler?.prototype?._calculateSpellCost) {
    console.error(`${MODULE_ID} | SpellHandler.prototype._calculateSpellCost not found — cannot wrap`);
    return;
  }

  // ── 2. Wrap SpellHandler.prototype._calculateSpellCost ────────────────────
  //    Add Magic Ward surcharge to totalCost so the preview, validation
  //    (mana.current and castingMax), and deduction paths all see the
  //    inflated amount.
  const origCalculate = SpellHandler.prototype._calculateSpellCost;
  SpellHandler.prototype._calculateSpellCost = function (spellId) {
    const costs = origCalculate.call(this, spellId);
    const { totalSurcharge } = computeWardSurcharge(game.user?.targets);
    if (totalSurcharge > 0) {
      costs.wardSurcharge = totalSurcharge;
      costs.totalCost = (costs.totalCost ?? 0) + totalSurcharge;
    }
    return costs;
  };
  console.log(`${MODULE_ID} | ✓ Wrapped SpellHandler._calculateSpellCost (Magic Ward surcharge)`);

  // ── 3. Wrap SpellHandler.prototype.castSpell ──────────────────────────────
  //    Set the cast-check flag for the roll-builder wrapper, and after the
  //    original cast runs, detect success by checking if the caster's mana
  //    actually decreased — if so, flag each triggered ward for the round.
  const origCastSpell = SpellHandler.prototype.castSpell;
  SpellHandler.prototype.castSpell = async function (event, target) {
    _isCastCheck = true;
    const manaBefore = this.actor?.system?.mana?.current;
    const wardSnapshot = computeWardSurcharge(game.user?.targets);

    if (wardSnapshot.totalSurcharge > 0) {
      const summary = wardSnapshot.entries
        .map((e) => `${e.ward.label} on ${e.actor.name} (+${e.ward.surcharge})`)
        .join(", ");
      console.log(`${MODULE_ID} | Magic Ward surcharge: +${wardSnapshot.totalSurcharge} Mana — ${summary}`);
    }

    try {
      const result = await origCastSpell.call(this, event, target);
      const manaAfter = this.actor?.system?.mana?.current;
      // Mana only decreases on a successful cast (system logic). If it did,
      // the cast went through and the target was affected → consume the wards.
      if (
        wardSnapshot.totalSurcharge > 0 &&
        typeof manaBefore === "number" &&
        typeof manaAfter === "number" &&
        manaAfter < manaBefore
      ) {
        await flagWardsTriggered(wardSnapshot.entries);
        const names = wardSnapshot.entries.map((e) => e.actor.name).join(", ");
        ui.notifications.info(
          `Magic Ward: ${this.actor.name} paid +${wardSnapshot.totalSurcharge} Mana surcharge against ${names}`
        );
      }
      return result;
    } finally {
      _isCastCheck = false;
    }
  };
  console.log(`${MODULE_ID} | ✓ Wrapped SpellHandler.castSpell (ward flag on success)`);

  // ── 4. Wrap VagabondItem.prototype.rollAttack ─────────────────────────────
  //    Set _isAttackRoll so the buildAndEvaluateD20 wrap knows to apply
  //    Nimble suppression. The system's own rollAttack computes
  //    effectiveFavorHinder (factoring target incomingAttacksModifier) and
  //    then delegates to buildAndEvaluateD20 — that's where our Nimble
  //    clamp fires.
  let VagabondItem;
  try {
    ({ VagabondItem } = await import("../../../systems/vagabond/module/documents/item.mjs"));
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not import VagabondItem — Nimble attack wrap skipped`, err);
  }
  if (VagabondItem?.prototype?.rollAttack) {
    const origRollAttack = VagabondItem.prototype.rollAttack;
    VagabondItem.prototype.rollAttack = async function (actor, favorHinder = "none") {
      _isAttackRoll = true;
      try {
        return await origRollAttack.call(this, actor, favorHinder);
      } finally {
        _isAttackRoll = false;
      }
    };
    console.log(`${MODULE_ID} | ✓ Wrapped VagabondItem.rollAttack (Nimble)`);
  }

  // ── 5. Wrap VagabondChatCard.npcAction for Pack Instincts ────────────────
  //    Works from both actor sheet clicks AND crawl strip action menu.
  let VagabondChatCard;
  try {
    ({ VagabondChatCard } = await import(
      "../../../systems/vagabond/module/helpers/chat-card.mjs"
    ));
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not import VagabondChatCard — Pack Instincts wrap skipped`, err);
  }
  if (VagabondChatCard?.npcAction) {
    const origNpcAction = VagabondChatCard.npcAction;
    VagabondChatCard.npcAction = async function (actor, action, actionIndex, targetsAtRollTime = []) {
      await applyPackInstincts(actor);
      return origNpcAction.call(this, actor, action, actionIndex, targetsAtRollTime);
    };
    console.log(`${MODULE_ID} | ✓ Wrapped VagabondChatCard.npcAction (Pack Instincts)`);
  }
}

/* ──────────────────────────────────────────────────────────────────────────────
 * PACK INSTINCTS / PACK TACTICS / PACK HUNTER
 *
 * All three have the same mechanical shape: if any ally of the attacker is
 * adjacent (≤5 ft) to the Target, that Target is Vulnerable *to this attack*.
 *
 * The "Vulnerable" in the rule text is narrow: the PC's save rolls against
 * the attack are Hindered. It does NOT grant attackers favor against the PC.
 * So the ActiveEffect only sets `system.outgoingSavesModifier: hinder` on the
 * attacking NPC (mirrored to the world actor for unlinked tokens). This
 * fires as a transient effect applied before the NPC's action/weapon and
 * cleaned up on turn change or combat end.
 * ──────────────────────────────────────────────────────────────────────────── */

const PACK_INSTINCTS_TAG = "packInstincts";

/**
 * Apply Vulnerable (Pack Instincts) to each targeted token if the attacker
 * has Pack Instincts and an ally is within 5 ft of the target.
 * Call this before firing an NPC action or weapon attack.
 */
export async function applyPackInstincts(attacker) {
  if (!game.user.isGM) return;
  const packAbilities = getPassiveAbilities(attacker, "packInstincts");
  if (!packAbilities.length) return;
  const abilityName = attacker.system?.abilities
    ?.find(a => PASSIVE_ABILITIES[a.name]?.type === "packInstincts")?.name ?? "Pack Instincts";

  const targets = game.user?.targets;
  if (!targets?.size) return;

  // Find the attacker's token on canvas
  const attackerToken = attacker.token?.object ?? attacker.getActiveTokens(true)[0];
  if (!attackerToken) return;
  const attackerDisp = attackerToken.document.disposition;

  // Gather ally tokens (same disposition, not the attacker)
  const allies = canvas.tokens.placeables.filter(t =>
    t.id !== attackerToken.id
    && t.document.disposition === attackerDisp
    && t.actor?.system?.health?.value > 0
  );
  if (!allies.length) return;

  let applied = false;
  for (const targetToken of targets) {
    const targetActor = targetToken.actor;
    if (!targetActor) continue;

    // Check if any ally is Close (adjacent) to this target
    const hasAdjacentAlly = allies.some(ally => distanceFt(ally, targetToken) <= 0);
    if (!hasAdjacentAlly) continue;

    applied = true;
    ChatMessage.create({
      content: `<strong>${abilityName}:</strong> ${targetActor.name} is Vulnerable against the attack (ally adjacent). Saves are Hindered.`,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
    });
    console.log(`${MODULE_ID} | Pack Instincts: ${targetActor.name} — saves vs this attacker hindered`);
  }

  // Attacker: saves against this NPC's attacks are Hindered.
  // Use the world actor (game.actors) because the save system resolves the
  // source via game.actors.get(actorId), not the synthetic token actor.
  if (applied) {
    const worldActor = game.actors.get(attacker.id) ?? attacker;
    if (!worldActor.effects.some(e => e.flags?.[MODULE_ID]?.tag === PACK_INSTINCTS_TAG)) {
      await worldActor.createEmbeddedDocuments("ActiveEffect", [{
        name:     "Pack Instincts (active)",
        img:      "icons/svg/downgrade.svg",
        flags:    { [MODULE_ID]: { tag: PACK_INSTINCTS_TAG } },
        changes: [
          { key: "system.outgoingSavesModifier", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "hinder" },
        ],
      }]);
    }
  }
}

/** Remove all Pack Instincts Vulnerable effects from every actor. */
export async function cleanupPackInstincts() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    const effect = actor.effects.find(e => e.flags?.[MODULE_ID]?.tag === PACK_INSTINCTS_TAG);
    if (effect) await effect.delete();
  }
  // Also check synthetic (unlinked) token actors on the current scene
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor?.isToken) {
      const effect = token.actor.effects.find(e => e.flags?.[MODULE_ID]?.tag === PACK_INSTINCTS_TAG);
      if (effect) await effect.delete();
    }
  }
}

function _registerPackInstinctsCleanup() {
  Hooks.on("updateCombat", (combat, changes) => {
    if (changes.round !== undefined || changes.turn !== undefined) {
      cleanupPackInstincts();
    }
  });
  Hooks.on("deleteCombat", () => cleanupPackInstincts());
}

/* ──────────────────────────────────────────────────────────────────────────────
 * MAGIC WARD ROUND RESET
 *
 * A ward's surcharge applies "the first time per round" each being is
 * unwillingly affected. The per-actor flag tracks the round it last
 * triggered; clearing on round advance and on combat end is strictly
 * cosmetic (the gate in computeWardSurcharge compares to the live round),
 * but removing stale flags keeps the data clean.
 * ──────────────────────────────────────────────────────────────────────────── */

async function clearAllWardFlags() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    if (actor.getFlag(MODULE_ID, WARD_ROUND_FLAG) !== undefined) {
      try { await actor.unsetFlag(MODULE_ID, WARD_ROUND_FLAG); }
      catch (err) { console.warn(`${MODULE_ID} | Failed to unset ward flag on ${actor.name}`, err); }
    }
  }
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor?.isToken && token.actor.getFlag(MODULE_ID, WARD_ROUND_FLAG) !== undefined) {
      try { await token.actor.unsetFlag(MODULE_ID, WARD_ROUND_FLAG); }
      catch (err) { console.warn(`${MODULE_ID} | Failed to unset ward flag on ${token.name}`, err); }
    }
  }
}

function _registerWardRoundResetHook() {
  Hooks.on("updateCombat", (combat, changes) => {
    if (changes.round !== undefined) clearAllWardFlags();
  });
  Hooks.on("deleteCombat", () => clearAllWardFlags());
}

/* ──────────────────────────────────────────────────────────────────────────────
 * SOFT UNDERBELLY
 *
 * Compendium text: "Its Armor is 0 while it is Prone."
 *
 * Mechanism: when a being with Soft Underbelly gains the Prone status, apply
 * a transient ActiveEffect with `system.armor: 0` (OVERRIDE). When Prone is
 * removed, remove the transient effect. `VagabondDamageHelper.calculateFinalDamage`
 * reads `actor.system.armor` directly, so the override is respected by every
 * damage-resolution path without needing to wrap damage helpers.
 *
 * Hooks: createActiveEffect (apply on prone gained), deleteActiveEffect
 * (remove when prone lost), ready (catch pre-existing prone + Soft Underbelly).
 * ──────────────────────────────────────────────────────────────────────────── */

const SOFT_UNDERBELLY_TAG = "softUnderbelly";

function effectInvolvesProne(effect) {
  if (effect?.statuses?.has?.("prone")) return true;
  // Some systems attach the status id on a legacy field
  const legacy = effect?.flags?.core?.statusId;
  if (legacy === "prone") return true;
  return false;
}

async function ensureSoftUnderbellyEffect(actor) {
  if (!actor) return;
  if (!hasAbility(actor, "Soft Underbelly")) return;
  if (!actor.statuses?.has?.("prone")) return;
  if (actor.effects.some((e) => e.flags?.[MODULE_ID]?.tag === SOFT_UNDERBELLY_TAG)) return;
  try {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name:   "Soft Underbelly (Prone)",
      img:    "icons/svg/downgrade.svg",
      flags:  { [MODULE_ID]: { tag: SOFT_UNDERBELLY_TAG } },
      changes: [
        { key: "system.armor", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0", priority: 999 },
      ],
    }]);
    console.log(`${MODULE_ID} | Soft Underbelly: armor set to 0 on ${actor.name} (Prone)`);
  } catch (err) {
    console.warn(`${MODULE_ID} | Soft Underbelly: failed to apply AE on ${actor.name}`, err);
  }
}

async function clearSoftUnderbellyEffect(actor) {
  if (!actor) return;
  const ours = actor.effects.find((e) => e.flags?.[MODULE_ID]?.tag === SOFT_UNDERBELLY_TAG);
  if (!ours) return;
  // Don't clear if actor is still prone (multiple sources of prone)
  if (actor.statuses?.has?.("prone")) return;
  try {
    await ours.delete();
    console.log(`${MODULE_ID} | Soft Underbelly: armor restored on ${actor.name} (no longer Prone)`);
  } catch (err) {
    console.warn(`${MODULE_ID} | Soft Underbelly: failed to delete AE on ${actor.name}`, err);
  }
}

function _registerSoftUnderbellyHook() {
  // Prone gained → try to apply armor-0 override
  Hooks.on("createActiveEffect", (effect) => {
    if (!game.user.isGM) return;
    if (!effectInvolvesProne(effect)) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    // Defer one tick so actor.statuses reflects the just-created effect
    queueMicrotask(() => ensureSoftUnderbellyEffect(actor));
  });

  // Prone lost → remove our override
  Hooks.on("deleteActiveEffect", (effect) => {
    if (!game.user.isGM) return;
    if (!effectInvolvesProne(effect)) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    queueMicrotask(() => clearSoftUnderbellyEffect(actor));
  });

  // World-load catch-up: any actor that starts in the Prone+SoftUnderbelly state
  // without our AE yet — apply. Runs once after the module is ready.
  Hooks.once("ready", () => {
    if (!game.user.isGM) return;
    for (const actor of game.actors) {
      if (hasAbility(actor, "Soft Underbelly")) ensureSoftUnderbellyEffect(actor);
    }
    for (const token of canvas.tokens?.placeables ?? []) {
      if (token.actor?.isToken && hasAbility(token.actor, "Soft Underbelly")) {
        ensureSoftUnderbellyEffect(token.actor);
      }
    }
  });
}
