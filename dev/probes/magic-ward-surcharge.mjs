// Probe: Magic Ward surcharge reaches the vagabond system cast cost authority.
//
// Falsifies the regression where the system moved spell-cast cost off
// SpellHandler._calculateSpellCost onto the STATIC SpellCastDialog.calculateCosts
// (used by both the dialog preview/validation and the real deduction in
// SpellHandler._executeCast). The crawler now wraps calculateCosts; this probe
// confirms the surcharge appears in that authoritative cost and in the
// vagabond.spellCastMessages dialog hook.
//
// Run: mcp__foundry-vtt__evaluate(expression: <paste this file>)
// Returns { pass, ... }. Creates and deletes a temp warded NPC + token.

const WARD_NAMES = ["Magic Ward I", "Magic Ward II", "Magic Ward III", "Magic Ward IV", "Magic Ward V", "Magic Ward VI"];
const EXPECT_SURCHARGE = 2; // "Magic Ward II"

const scene = canvas?.scene ?? game.scenes?.active;
if (!scene) return { pass: false, reason: "No active/canvas scene to place a target token." };

// Pick an Actor type whose schema defines `abilities` (the NPC/monster type).
function typeWithAbilities() {
  for (const t of Object.keys(CONFIG.Actor.dataModels ?? {})) {
    const fields = CONFIG.Actor.dataModels[t]?.schema?.fields;
    if (fields && "abilities" in fields) return t;
  }
  return null;
}

const npcType = typeWithAbilities();
if (!npcType) return { pass: false, reason: "No Actor type with an `abilities` field found." };

let wardActor = null;
let tokenDoc = null;
try {
  wardActor = await Actor.create({
    name: "__vctest_ward",
    type: npcType,
    system: { abilities: [{ name: "Magic Ward II" }] },
  });

  // Confirm the schema kept the ability (some element schemas reshape entries).
  let abilities = wardActor.system?.abilities ?? [];
  if (!abilities.some((a) => WARD_NAMES.includes(a?.name))) {
    await wardActor.update({ "system.abilities": [{ name: "Magic Ward II" }] });
    abilities = wardActor.system?.abilities ?? [];
  }
  const wardDetected = abilities.some((a) => WARD_NAMES.includes(a?.name));
  if (!wardDetected) {
    return { pass: false, reason: "NPC schema dropped the Magic Ward ability; use a real warded monster.", abilities };
  }

  // Place a token for it on the current scene so it is targetable.
  const td = await wardActor.getTokenDocument({ x: 1000, y: 1000, hidden: false });
  [tokenDoc] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
  const token = tokenDoc.object ?? canvas.tokens.get(tokenDoc.id);
  if (!token) return { pass: false, reason: "Token placeable not found on canvas after create." };

  // ── Confirm the wraps are installed ─────────────────────────────────────
  const { SpellCastDialog } = await import("/systems/vagabond/module/applications/spell-cast-dialog.mjs");
  const { SpellHandler } = await import("/systems/vagabond/module/sheets/handlers/_module.mjs");
  const calcWrapped = /wardSurcharge|wardEntries/.test(SpellCastDialog.calculateCosts.toString());
  const execWrapped = /wardSnapshot|_isCastCheck/.test(SpellHandler.prototype._executeCast.toString());

  // ── Cost authority test (stub spell/actor — calculateCosts only reads
  //    spell.system.damageType and actor.system.bonuses). The deducted amount
  //    in _executeCast is this same value (spell-handler.mjs:478 → :602). ──
  const deliveryKey = Object.keys(CONFIG.VAGABOND.deliveryDefaults ?? {})[0];
  const stubSpell = { system: { damageType: "fire" } };
  const stubActor = { system: { bonuses: {} } };
  const state = { damageDice: 1, deliveryType: deliveryKey, deliveryIncrease: 0, useFx: false, manaOverrideDelta: 0 };

  token.setTarget(true, { releaseOthers: true });
  const targeted = game.user.targets.has(token);
  const withWard = SpellCastDialog.calculateCosts(stubSpell, stubActor, state);

  token.setTarget(false, { releaseOthers: true });
  const without = SpellCastDialog.calculateCosts(stubSpell, stubActor, state);

  const delta = withWard.totalCost - without.totalCost;

  // ── Dialog message hook test ────────────────────────────────────────────
  token.setTarget(true, { releaseOthers: true });
  const recomputed = SpellCastDialog.calculateCosts(stubSpell, stubActor, state);
  const messages = [];
  Hooks.callAll("vagabond.spellCastMessages", null, messages, {
    actor: stubActor, spell: stubSpell, state, finalMana: recomputed.totalCost, costs: recomputed,
  });
  token.setTarget(false, { releaseOthers: true });
  const wardMessage = messages.find((m) => /Magic Ward/i.test(m?.text ?? ""))?.text ?? null;

  const pass =
    calcWrapped && execWrapped && targeted &&
    delta === EXPECT_SURCHARGE &&
    withWard.wardSurcharge === EXPECT_SURCHARGE &&
    without.wardSurcharge == null &&
    !!wardMessage;

  return {
    pass,
    calcWrapped,        // calculateCosts carries the surcharge wrap
    execWrapped,        // _executeCast carries the cast-check/ward wrap
    targeted,
    deliveryKey,
    withWardTotal: withWard.totalCost,
    withoutTotal: without.totalCost,
    delta,              // expect 2
    wardSurcharge: withWard.wardSurcharge ?? null,
    wardMessage,        // expect "Magic Ward: +2 mana surcharge vs __vctest_ward."
  };
} finally {
  try { canvas?.tokens?.get(tokenDoc?.id)?.setTarget(false, { releaseOthers: true }); } catch (e) {}
  try { if (tokenDoc) await tokenDoc.delete(); } catch (e) {}
  try { if (wardActor) await wardActor.delete(); } catch (e) {}
}
