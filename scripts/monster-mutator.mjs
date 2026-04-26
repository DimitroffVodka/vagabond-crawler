/**
 * Vagabond Crawler — Monster Mutator
 *
 * Handles TL calculation, applying mutations to actor data,
 * creating mutated world actors, and generating AI art prompts.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { MUTATIONS, getMutation } from "./mutation-data.mjs";

/* -------------------------------------------- */
/*  TL Calculation                              */
/* -------------------------------------------- */

/**
 * TL = (Armor * 2 + HP / 10) / 4 + DPR / 6
 */
export function calculateTL(hp, armor, dpr) {
  return (armor * 2 + hp / 10) / 4 + dpr / 6;
}

/**
 * Average roll value for a die expression like "d4", "d8", "d20".
 * Defaults to d8's 4.5 for any unparseable input — keeps callers tolerant
 * of legacy data and free-form strings.
 */
export function dieAvg(die) {
  const m = String(die ?? "").match(/^d(\d+)$/i);
  if (!m) return 4.5;
  const sides = parseInt(m[1], 10);
  if (!Number.isFinite(sides) || sides < 2) return 4.5;
  return (sides + 1) / 2;
}

/**
 * Calculate HP from HD.
 *
 * Vagabond rule: Small = max(1, HD); medium+ = floor(HD * dieAvg).
 * `die` defaults to "d8" so every legacy 2-arg call stays at HD * 4.5.
 *
 * `die === "fromSize"` resolves the die at call time from the world
 * setting `hitDieSizeMap` — this lets monsters declare "follow the size
 * map" once and pick up live edits to the map.
 */
export function calculateHP(hd, size = "medium", die = "d8") {
  if (size === "small") return Math.max(1, Number(hd) || 0);

  let resolved = die;
  if (die === "fromSize") {
    let map;
    try { map = game?.settings?.get?.("vagabond-crawler", "hitDieSizeMap"); }
    catch (_) { map = null; }
    resolved = map?.[size] ?? "d8";
  }

  return Math.floor((Number(hd) || 0) * dieAvg(resolved));
}

/**
 * Estimate average per-turn damage (DPR) from an actions array.
 *
 * Model: a monster performs ONE "routine" per turn. A routine is either a
 * single non-combo action, or the sum of every combo-flagged action (a
 * multi-attack like Bite+Claw+Claw). DPR = the best routine's expected
 * damage.
 *
 *   routine = max( comboSum, best non-combo single )
 *
 * Per-action average uses rollDamage OR flatDamage — NEVER both. The two
 * fields are alternative presentations of the same damage (a dice formula
 * versus a pre-computed average), not an addend.
 *
 * Combo membership is read from three sources, in order:
 *   1. `action.combo === true`                            (explicit flag, preferred)
 *   2. legacy "combo" substring in note / extraInfo       (backward compat)
 */
export function calculateDPR(actions) {
  if (!actions || actions.length === 0) return 0;

  // Per-action average: prefer the rolled formula's expected value; fall
  // back to the flat damage if no roll is defined. They are NOT summed.
  const actionAvg = (a) => {
    const rollAvg = _averageDice(a.rollDamage || "");
    if (rollAvg > 0) return rollAvg;
    const flat = parseFloat(a.flatDamage);
    return Number.isFinite(flat) ? flat : 0;
  };

  const isCombo = (a) => {
    if (a.combo === true) return true;
    // Legacy: users tagged multi-attacks by typing "combo" into a note.
    const text = `${a.note || ""} ${a.extraInfo || ""}`.toLowerCase();
    return text.includes("combo");
  };

  let comboSum = 0;
  let comboCount = 0;
  let bestSingle = 0;
  for (const a of actions) {
    const avg = actionAvg(a);
    if (isCombo(a)) {
      comboSum += avg;
      comboCount++;
    } else if (avg > bestSingle) {
      bestSingle = avg;
    }
  }

  // A lone combo-flagged action with no siblings is effectively a single.
  const comboRoutine = comboCount >= 2 ? comboSum : 0;
  return Math.max(comboRoutine, bestSingle, comboCount === 1 ? comboSum : 0);
}

/**
 * Parse a dice formula and return the average.
 * Handles: "2d6", "1d8+2", "3d4+1d6", etc.
 */
function _averageDice(formula) {
  if (!formula) return 0;
  let total = 0;

  // Match dice terms: NdM
  const diceRegex = /(\d+)?d(\d+)/gi;
  let match;
  while ((match = diceRegex.exec(formula)) !== null) {
    const count = parseInt(match[1]) || 1;
    const sides = parseInt(match[2]);
    total += count * (sides + 1) / 2;
  }

  // Match flat modifiers: +N or -N (not part of dice)
  const flatRegex = /([+-]\s*\d+)(?!\s*d)/g;
  while ((match = flatRegex.exec(formula)) !== null) {
    total += parseInt(match[1].replace(/\s/g, ""));
  }

  return total;
}

/* -------------------------------------------- */
/*  Stat Summary                                */
/* -------------------------------------------- */

/**
 * Extract a stat summary from actor system data.
 */
export function getStatSummary(systemData) {
  const hp = calculateHP(systemData.hd || 1, systemData.size || "medium");
  const armor = systemData.armor || 0;
  const dpr = calculateDPR(systemData.actions || []);
  const tl = calculateTL(hp, armor, dpr);

  return {
    hd: systemData.hd || 1,
    hp,
    armor,
    dpr: Math.round(dpr * 10) / 10,
    tl: Math.round(tl * 100) / 100,
    speed: systemData.speed || 30,
    size: systemData.size || "medium",
    morale: systemData.morale ?? 7,
    beingType: systemData.beingType || "—",
    immunities: systemData.immunities || [],
    weaknesses: systemData.weaknesses || [],
    speedTypes: systemData.speedTypes || [],
    senses: systemData.senses || "",
    abilities: (systemData.abilities || []).map(a => a.name),
    actions: (systemData.actions || []).map(a => `${a.name} (${a.rollDamage || a.flatDamage || "—"})`),
  };
}

/* -------------------------------------------- */
/*  Apply Mutations                             */
/* -------------------------------------------- */

/**
 * Apply a list of mutations to actor data (in place).
 * @param {Object} actorData — result of actor.toObject()
 * @param {string[]} mutationIds — list of mutation IDs to apply
 * @returns {Object} — { appliedMutations, nameParts, tlDelta }
 */
export function applyMutations(actorData, mutationIds) {
  const appliedMutations = [];
  const prefixes = [];
  const suffixes = [];
  let totalTlDelta = 0;

  for (const id of mutationIds) {
    const mutation = getMutation(id);
    if (!mutation) continue;

    mutation.apply(actorData);
    appliedMutations.push(mutation);
    totalTlDelta += mutation.tlDelta;

    if (mutation.namePrefix) prefixes.push(mutation.namePrefix);
    if (mutation.nameSuffix) suffixes.push(mutation.nameSuffix);
  }

  return { appliedMutations, prefixes, suffixes, tlDelta: totalTlDelta };
}

/**
 * Generate a mutated name from base name + mutation fragments.
 */
export function generateMutatedName(baseName, prefixes, suffixes) {
  const parts = [...prefixes, baseName];
  if (suffixes.length > 0) {
    parts.push(suffixes.join(" "));
  }
  return parts.join(" ");
}

/* -------------------------------------------- */
/*  AI Art Prompt Generation                    */
/* -------------------------------------------- */

/**
 * Generate an AI art prompt for a mutated monster.
 * Based on the too-many-tokens-dnd prompt pattern.
 */
/**
 * Pose/lighting options (replacing environments for clean token art).
 */
const POSES = [
  "aggressive attacking stance",
  "menacing battle pose",
  "standing alert, ready to strike",
  "prowling forward, low stance",
  "rearing up, dramatic pose",
];

const LIGHTING = [
  "harsh dramatic lighting from above",
  "rim lighting, dark atmosphere",
  "dramatic side lighting",
  "moody underlighting",
];

/**
 * Technical boilerplate for clean VTT token output.
 */
const TECH_BOILERPLATE = "The image must have a solid black background. The artwork must extend completely to the edges with no white outlines or borders. The final image must be entirely clean of any text, logos, or watermarks.";

export function generatePrompt(baseName, systemData, selectedMutations) {
  const size = systemData.size || "medium";
  const beingType = systemData.beingType || "creature";

  // Base description
  const baseDesc = `${size} ${baseName} ${beingType}`.toLowerCase();

  // Collect mutation prompt fragments
  const fragments = [];
  for (const id of selectedMutations) {
    const mutation = getMutation(id);
    if (mutation?.promptFragment) {
      fragments.push(mutation.promptFragment);
    }
  }
  const mutationDesc = fragments.join(", ");

  // Pick a pose and lighting (deterministic from mutation count for consistency)
  const poseIdx = selectedMutations.length % POSES.length;
  const lightIdx = (selectedMutations.length + 1) % LIGHTING.length;

  // Build final prompt
  const parts = [
    "DND digital drawing fantasy artwork color",
    baseDesc,
    mutationDesc,
    "full body in view",
    POSES[poseIdx],
    LIGHTING[lightIdx],
    "style of dungeons and dragons monster",
  ].filter(Boolean);

  return parts.join(", ") + ". " + TECH_BOILERPLATE;
}

/* -------------------------------------------- */
/*  Create Mutated Actor                        */
/* -------------------------------------------- */

/**
 * Clone a base actor, apply mutations, and create a new world actor.
 * @param {string} baseUuid — UUID of the base actor (compendium or world)
 * @param {string[]} mutationIds — mutations to apply
 * @param {string} [customName] — optional override name
 * @returns {Promise<Actor>} — the created world actor
 */
export async function createMutatedActor(baseUuid, mutationIds, customName = null) {
  const baseActor = await fromUuid(baseUuid);
  if (!baseActor) throw new Error(`Actor not found: ${baseUuid}`);

  const actorData = baseActor.toObject();

  // Remove IDs so Foundry creates new ones
  delete actorData._id;
  if (actorData.items) actorData.items.forEach(i => delete i._id);
  if (actorData.effects) actorData.effects.forEach(e => delete e._id);

  // Apply mutations
  const { appliedMutations, prefixes, suffixes, tlDelta } = applyMutations(actorData, mutationIds);

  // Set name
  const baseName = baseActor.name;
  actorData.name = customName || generateMutatedName(baseName, prefixes, suffixes);

  // Recalculate derived values
  const hp = calculateHP(actorData.system.hd, actorData.system.size);
  actorData.system.health = { value: hp, max: hp, bonus: [] };
  actorData.system.cr = actorData.system.hd; // CR = HD in Vagabond

  const dpr = calculateDPR(actorData.system.actions);
  const newTL = calculateTL(hp, actorData.system.armor, dpr);
  actorData.system.threatLevel = Math.round(newTL * 100) / 100;

  // Store mutation metadata
  actorData.flags = actorData.flags || {};
  actorData.flags[MODULE_ID] = actorData.flags[MODULE_ID] || {};
  actorData.flags[MODULE_ID].mutations = {
    baseActorUuid: baseUuid,
    baseName,
    appliedMutationIds: mutationIds,
    tlDelta,
    originalTL: baseActor.system?.threatLevel ?? 0,
    prompt: generatePrompt(baseName, actorData.system, mutationIds),
    createdAt: Date.now(),
  };

  // Create the world actor
  const newActor = await Actor.create(actorData);

  // Post chat notification
  const prompt = actorData.flags[MODULE_ID].mutations.prompt;
  await ChatMessage.create({
    speaker: { alias: "Monster Mutator" },
    content: `<div class="vagabond-chat-card-v2" data-card-type="generic">
      <div class="card-body">
        <header class="card-header">
          <div class="header-icon">
            <img src="${newActor.img}" alt="${newActor.name}" width="48" height="48">
          </div>
          <div class="header-info">
            <h3 class="header-title">Monster Created</h3>
            <div class="metadata-tags-row">
              <div class="meta-tag"><span>${newActor.name}</span></div>
              <div class="meta-tag"><span>TL ${newTL.toFixed(2)}</span></div>
            </div>
          </div>
        </header>
        <section class="content-body">
          <div class="card-description" style="padding:4px 0; font-size:0.85em;">
            <p><strong>Base:</strong> ${baseName} | <strong>Mutations:</strong> ${appliedMutations.map(m => m.name).join(", ")}</p>
          </div>
        </section>
      </div>
    </div>`,
  });

  return newActor;
}

/**
 * Resolve an actor's effective hit-die configuration.
 *
 * Returns { hasOverride, rollOnSpawn, die } where:
 *   - hasOverride: true when the token's HP should be overridden via delta
 *                  (because the actor opts in via flags, or the bestiary
 *                  fallback applies). When false, no token-side override
 *                  should occur and the system's default behavior stands.
 *   - rollOnSpawn: when true, roll fresh `${hd}${die}` per spawn; when
 *                  false, use the deterministic `calculateHP` average.
 *   - die:         a concrete die expression like "d6", never "fromSize".
 */
export function resolveHitDieConfig(actor) {
  if (!actor) return { hasOverride: false, rollOnSpawn: false, die: "d8" };

  const moduleId = "vagabond-crawler";
  const flagDie  = actor.getFlag?.(moduleId, "hitDie")        ?? null;
  const flagRoll = actor.getFlag?.(moduleId, "rollHpOnSpawn") ?? null;

  let hasOverride;
  let rollOnSpawn;
  let die;

  if (flagDie != null || flagRoll != null) {
    hasOverride = true;
    rollOnSpawn = flagRoll === true;
    die         = flagDie ?? "fromSize";
  } else {
    let fallback = false;
    try { fallback = !!game.settings.get(moduleId, "bestiaryHitDieFallback"); } catch (_) {}
    hasOverride = fallback;
    rollOnSpawn = fallback;          // fallback always rolls (matches user spec)
    die         = "fromSize";
  }

  if (die === "fromSize") {
    const size = actor.system?.size ?? "medium";
    let map = {};
    try { map = game.settings.get(moduleId, "hitDieSizeMap") ?? {}; } catch (_) {}
    die = map[size] ?? "d8";
  }

  return { hasOverride, rollOnSpawn, die };
}

