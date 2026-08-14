/**
 * System Contract — drift canary
 *
 * Every other suite asks "does my feature behave correctly?". This one asks
 * "is the ground still there?".
 *
 * The Crawler replaces 7 Vagabond system methods and writes Active Effects at
 * specific `system.*` paths. Neither is a stable public API. When the system
 * renames one, the failure is SILENT — a patch installed onto a method nobody
 * calls any more, and an AE change written to a field that isn't in the data
 * model, both do nothing and throw nothing. Every other test can stay green
 * while a chunk of the module quietly stops working.
 *
 * That is exactly what a large system jump threatens. Written after the system
 * moved 5.8.0 → 5.36.0 (121 commits, no changelog) while the Crawler still
 * declared compatibility with 5.8.1.
 */

import { suite, case_, expect } from "../harness.mjs";

const MODULE_ID = "vagabond-crawler";
const SYS = "/systems/vagabond/module";

/* -------------------------------------------- */
/*  Monkey-patch targets                        */
/* -------------------------------------------- */

/**
 * Every system method the Crawler replaces or wraps.
 *
 * MAINTENANCE: add to this whenever you add a monkey-patch, or the canary
 * silently guards less. Regenerate with:
 *
 *   grep -rhoE '\b(VagabondItem|VagabondDamageHelper|VagabondRollBuilder|VagabondChatCard|SpellHandler|SpellCastDialog)\.(prototype\.)?[A-Za-z_][A-Za-z0-9_]*\s*=' scripts
 */
const PATCH_TARGETS = [
  ["documents/item.mjs",                 "VagabondItem",         "prototype.rollAttack"],
  ["documents/item.mjs",                 "VagabondItem",         "prototype.rollDamage"],
  ["helpers/roll-builder.mjs",           "VagabondRollBuilder",  "buildAndEvaluateD20WithRollData"],
  ["helpers/chat-card.mjs",              "VagabondChatCard",     "npcAction"],
  ["helpers/damage-helper.mjs",          "VagabondDamageHelper", "rollDamageFromButton"],
  ["sheets/handlers/spell-handler.mjs",  "SpellHandler",         "prototype._executeCast"],
  ["sheets/handlers/spell-handler.mjs",  "SpellHandler",         "prototype._calculateSpellCost"],
  ["applications/spell-cast-dialog.mjs", "SpellCastDialog",      "calculateCosts"],
  ["applications/level-up-dialog.mjs",   "LevelUpDialog",        "prototype._prepareQuestionnaireContext"],
];

/**
 * Patches applied to classes resolved at RUNTIME off CONFIG rather than by
 * import. Invisible to a class-name-based grep, and so previously unguarded.
 * Each entry is [label, resolver, methodPath].
 */
const CONFIG_PATCH_TARGETS = [
  ["CONFIG.Actor.dataModels.npc",
    () => CONFIG.Actor?.dataModels?.npc, "prototype.prepareDerivedData"],
];

/* -------------------------------------------- */
/*  Active Effect field paths                   */
/* -------------------------------------------- */

/**
 * `system.*` paths the Crawler writes that the data model ACTUALLY backs.
 * These are load-bearing: an AE change here reaches a real derived field.
 * If one stops resolving, relic/mutation effects silently stop working.
 */
const BACKED_AE_PATHS = [
  "system.armor",
  "system.armorBonus",
  "system.defenderStatusModifiers.attackersAreBlinded",
  "system.favorHinder",
  "system.incomingAttacksModifier",
  "system.inventory.bonusSlots",
  "system.outgoingSavesModifier",
  "system.saves.endure.bonus",
  "system.saves.reflex.bonus",
  "system.saves.will.bonus",
  "system.speed.bonus",
  "system.universalSpellDamageBonus",
  "system.universalWeaponDamageBonus",
];

/**
 * `system.*` paths the Crawler writes that the data model does NOT back.
 *
 * KNOWN DEAD — NOT intentional, and not yet triaged.
 *
 * An earlier version of this comment claimed the behaviour was "carried by the
 * parallel `flags` on the same relic power (grantedSense, autoFailSaveVs...)".
 * That was wrong and was never verified: searching for consumers of those flags
 * finds NOTHING outside relic-powers.mjs itself — not elsewhere in the Crawler,
 * not in Vagabond 5.36. So the AE change is discarded on data prep AND nothing
 * reads the flag, which means the relic powers carrying these currently do
 * nothing at all.
 *
 * They are not system drift: none of these fields existed at v5.8.0 either, so
 * the 5.36.0 jump did not remove them — they were never there.
 *
 * This list PINS the damage rather than blessing it. The growth check below
 * fails if a new dead path appears, so the set cannot quietly expand while the
 * open question — implement the consumers, or strip the ineffective changes —
 * is still being triaged.
 */
const KNOWN_DEAD_AE_PATHS = [
  "system.autoFailSaveVs.berserk",
  "system.autoFailSaveVs.charmed",
  "system.autoFailSaveVs.frightened",
  "system.breatheUnderwater",
  "system.cannotBeSurprised",
  "system.favorOnSaveVs.charmed",
  "system.favorOnSaveVs.confused",
  "system.favorOnSaveVs.frightened",
  "system.healingCappedPerDie",
  "system.movement.blink",
  "system.movement.climb",
  "system.movement.cling",
  "system.movement.fly",
  "system.movement.levitate",
  "system.movement.waterwalk",
  "system.movement.webwalk",
  "system.onHitBurningDice",
  "system.senses.allsight",
  "system.senses.darksight",
  "system.senses.detection",
  "system.senses.echolocation",
  "system.senses.senseLife",
  "system.senses.senseValuables",
  "system.senses.telepathy",
  "system.senses.tremorsense",
  "system.speakAllLanguages",
];

/** A path counts as present if it resolves on EITHER document type. */
function _resolvesAnywhere(key, pc, npc) {
  if (pc && foundry.utils.getProperty(pc, key) !== undefined) return true;
  if (npc && foundry.utils.getProperty(npc, key) !== undefined) return true;
  return false;
}

/**
 * Every `system.*` AE key the relic system can actually write, read straight
 * out of RELIC_POWERS.
 *
 * Derived rather than hand-listed: the two constants above are a snapshot, and
 * a snapshot cannot detect a key added to relic-powers.mjs later. Without this
 * the "cannot quietly grow" claim was false — a new dead path would have left
 * the suite green.
 */
async function _relicPowerAEKeys() {
  const { RELIC_POWERS, getCustomRelicPowers } = await import("../../relic-powers.mjs");
  const pools = [RELIC_POWERS ?? []];
  try { pools.push(getCustomRelicPowers?.() ?? []); } catch { /* world setting may be absent */ }

  const keys = new Map(); // key -> first power id that writes it
  for (const pool of pools) {
    for (const power of pool) {
      for (const change of power?.changes ?? []) {
        const k = change?.key;
        if (typeof k === "string" && k.startsWith("system.") && !keys.has(k)) {
          keys.set(k, power.id ?? power.name ?? "?");
        }
      }
    }
  }
  return keys;
}

export function register() {
  suite("System Contract", () => {

    // ── The system still exposes every method we patch ────────────────────
    case_("every monkey-patched system method still exists", async () => {
      const missing = [];
      const cache = new Map();

      for (const [file, exportName, path] of PATCH_TARGETS) {
        const spec = `${SYS}/${file}`;
        if (!cache.has(spec)) {
          try { cache.set(spec, await import(spec)); }
          catch (e) { cache.set(spec, { __err: e.message }); }
        }
        const mod = cache.get(spec);
        if (mod.__err) { missing.push(`${file} — import failed: ${mod.__err}`); continue; }

        const root = mod[exportName];
        if (!root) { missing.push(`${file} → ${exportName} (export gone)`); continue; }

        const target = path.split(".").reduce((o, k) => o?.[k], root);
        if (typeof target !== "function") missing.push(`${exportName}.${path} (${typeof target})`);
      }

      // Classes resolved off CONFIG rather than by import.
      for (const [label, resolve, path] of CONFIG_PATCH_TARGETS) {
        let root;
        try { root = resolve(); } catch (e) { missing.push(`${label} — resolver threw: ${e.message}`); continue; }
        if (!root) { missing.push(`${label} (not registered on CONFIG)`); continue; }
        const target = path.split(".").reduce((o, k) => o?.[k], root);
        if (typeof target !== "function") missing.push(`${label}.${path} (${typeof target})`);
      }

      expect(missing.join("; ")).toBe("");
    });

    // ── Load-bearing AE paths still resolve ───────────────────────────────
    case_("every data-model-backed AE target path still resolves", async () => {
      const pc  = game.actors.find(a => a.type === "character");
      const npc = game.actors.find(a => a.type === "npc");
      expect(!!pc || !!npc).toBeTruthy();

      const broken = BACKED_AE_PATHS.filter(k => !_resolvesAnywhere(k, pc, npc));
      // Named explicitly: these are the ones whose loss would silently kill
      // relic and mutation effects with no error anywhere.
      expect(broken.join("; ")).toBe("");
    });

    // ── Known-dead paths must not grow, and get promoted when fixed ───────
    case_("no new dead AE paths in RELIC_POWERS, and none silently promoted", async () => {
      const pc  = game.actors.find(a => a.type === "character");
      const npc = game.actors.find(a => a.type === "npc");

      // If one of these starts resolving, the system added it — move it into
      // BACKED_AE_PATHS so it gets guarded from then on.
      const nowBacked = KNOWN_DEAD_AE_PATHS.filter(k => _resolvesAnywhere(k, pc, npc));
      expect(`promoted: ${nowBacked.join(", ")}`).toBe("promoted: ");

      // Derived from RELIC_POWERS, so a dead path added later cannot slip in
      // behind a hand-written snapshot. Anything unresolvable and unlisted is
      // new damage.
      const declared = await _relicPowerAEKeys();
      const known = new Set([...BACKED_AE_PATHS, ...KNOWN_DEAD_AE_PATHS]);
      const surprises = [...declared]
        .filter(([k]) => !known.has(k) && !_resolvesAnywhere(k, pc, npc))
        .map(([k, owner]) => `${k} (power "${owner}")`);
      expect(`new dead paths: ${surprises.join(", ")}`).toBe("new dead paths: ");
    });

    // ── Declared compatibility hasn't fallen behind reality ───────────────
    case_("module.json verified system version tracks the installed one", async () => {
      const mod = game.modules.get(MODULE_ID);
      const declared = [...(mod?.relationships?.systems ?? [])]
        .find(s => s.id === "vagabond")?.compatibility?.verified;
      const installed = game.system.version;

      expect(!!declared).toBeTruthy();
      const major = v => String(v).split(".").slice(0, 2).join(".");
      // NOTE: game.modules reads the manifest as cached at world launch, so
      // after editing module.json this stays red until the world restarts —
      // an F5 is not enough.
      expect(`${major(declared)} (installed ${major(installed)})`)
        .toBe(`${major(installed)} (installed ${major(installed)})`);
    });

  });
}
