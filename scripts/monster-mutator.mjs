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
 * Calculate HP from HD (Vagabond formula: HD * 4.5 for medium+, HD * 1 for small).
 */
export function calculateHP(hd, size = "medium") {
  if (size === "small") return Math.max(1, hd);
  return Math.floor(hd * 4.5);
}

/**
 * Estimate average DPR from an actions array.
 * If any action is a combo, sum all. Otherwise, take the highest single.
 */
export function calculateDPR(actions) {
  if (!actions || actions.length === 0) return 0;

  const averages = actions.map(a => {
    const roll = a.rollDamage || "";
    const flat = parseInt(a.flatDamage) || 0;
    return _averageDice(roll) + flat;
  });

  // Check for combo — Vagabond uses note field or similar indicator
  // For simplicity: if > 1 action and any has "combo" in its note, sum all
  const hasCombo = actions.some(a =>
    (a.note || "").toLowerCase().includes("combo") ||
    (a.extraInfo || "").toLowerCase().includes("combo")
  );

  if (hasCombo) {
    return averages.reduce((sum, avg) => sum + avg, 0);
  }
  return Math.max(...averages);
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
export function generatePrompt(baseName, systemData, selectedMutations) {
  const size = systemData.size || "medium";
  const beingType = systemData.beingType || "creature";
  const zone = systemData.zone || "frontline";

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

  // Environment based on zone/theme
  const envMap = {
    frontline: "in a dark dungeon corridor",
    midline: "lurking behind rocks in a cavern",
    backline: "in the shadows of ancient ruins",
  };
  const environment = envMap[zone] || "in a dungeon";

  // Build final prompt
  const parts = [
    "DND digital drawing fantasy artwork color",
    baseDesc,
    mutationDesc,
    "full body in view",
    environment,
    "style of dungeons and dragons monster",
  ].filter(Boolean);

  return parts.join(", ");
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
