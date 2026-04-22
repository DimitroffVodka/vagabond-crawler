#!/usr/bin/env node
/**
 * migrate-riders.mjs
 *
 * Parses every NPC action's `extraInfo` in docs/audit/monsters.json and
 * produces a structured rider entry matching the causedStatuses schema
 * (plus the new fatigueOnFail / fatigueOnTick fields). Writes two files:
 *
 *   docs/audit/riders-migration-proposed.json   — structured diff: per
 *       (monster, action) tuples, the proposed causedStatuses payload. GM
 *       can review before anything is applied to live actors.
 *   docs/audit/riders-migration-unmatched.md    — every action whose
 *       extraInfo contained a [Save] marker but didn't match any of the
 *       canonical patterns. Manual narration territory.
 *
 * The parser is deliberately conservative: it only emits an entry when the
 * text matches one of the canonical shapes documented in riders.md. Compound
 * riders (e.g. "Sickened (Cd4, Paralyzed)" with a secondary status) capture
 * the primary structurally and leave the secondary in extraInfo for GM
 * narration — the schema doesn't model nested status chains yet.
 *
 * Run:   node scripts/audit/migrate-riders.mjs
 * No code changes to live actors — read-only analysis + diff output.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const MONSTERS_JSON = path.join(ROOT, "docs", "audit", "monsters.json");
const OUT_DIFF      = path.join(ROOT, "docs", "audit", "riders-migration-proposed.json");
const OUT_UNMATCHED = path.join(ROOT, "docs", "audit", "riders-migration-unmatched.md");

/* ─────────────────────────────────────────────────────────────────────────
   Status name → canonical id mapping. Only the statuses that actually show
   up in the rider corpus (per riders.md) — not the full CONFIG.VAGABOND
   list. Unknown status names leave the entry unclassified.
   ───────────────────────────────────────────────────────────────────── */
const STATUS_ALIASES = {
  sickened:    "sickened",
  paralyzed:   "paralyzed",
  prone:       "prone",
  dazed:       "dazed",
  unconscious: "unconscious",
  asleep:      "unconscious",
  burning:     "burning",
  bleeding:    "bleeding",
  poisoned:    "poisoned",
  frightened:  "frightened",
  charmed:     "charmed",
  blinded:     "blinded",
  deafened:    "deafened",
  restrained:  "restrained",
  grappled:    "grappled",
  cursed:      "cursed",
  stunned:     "stunned",
  vulnerable:  "vulnerable",
  berserk:     "berserk",  // edge — Vigzud uses this
};

const SAVE_MARKER   = /\[(Endure|Reflex|Will)\]/i;
const SAVE_PENALTY  = /\[(Endure|Reflex|Will)\]\s+(?:with\s+a\s+)?([+-]\d+)\s+(?:penalty|bonus)/i;

/* ─────────────────────────────────────────────────────────────────────────
   Pattern matchers — each returns a partial causedStatuses entry or null.
   ───────────────────────────────────────────────────────────────────── */

/**
 * "pass [Save] or become Status (CdN unit[, +K Fatigue each Round])"
 * Captures: save, status, duration die, unit (for tick damage detection),
 * optional fatigueOnTick.
 */
const PAT_SAVE_STATUS_COUNTDOWN = new RegExp(
  [
    /pass\s+(?:an?\s+)?\[(Endure|Reflex|Will)\]/.source,
    /(?:\s+(?:Save|save))?/.source,
    /(?:\s+with\s+(?:a\s+)?([+-]\d+)(?:\s+penalty|\s+bonus)?)?/.source,   // optional modifier
    /\s+or\s+(?:be(?:come)?|is|are)?\s*/.source,
    /([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)/.source,                      // status name (1-2 word)
    /\s*\(/.source,
    /C?d(\d+)/i.source,                                                   // duration: Cd6 or d6
    /(?:\s+([A-Za-z]+))?/.source,                                         // unit: "damage"/"days"/"Rounds"/etc.
    /(?:[^)]*?\+(\d+)\s+Fatigue\s+each\s+Round)?/i.source,                // optional fatigueOnTick
    /[^)]*\)/.source,
  ].join(""),
  "i"
);

/**
 * "pass [Save] or +N Fatigue" — fatigue-only rider, no status.
 */
const PAT_SAVE_FATIGUE_ONLY = /pass\s+(?:an?\s+)?\[(Endure|Reflex|Will)\](?:\s+Save)?\s+or\s+\+(\d+)\s+Fatigue(?!\s+each)/i;

/**
 * "pass [Save] or become Status" — status only, no timer. Rare.
 */
const PAT_SAVE_STATUS_SIMPLE = /pass\s+(?:an?\s+)?\[(Endure|Reflex|Will)\](?:\s+Save)?\s+or\s+(?:be(?:come)?|is|are)?\s*([A-Z][A-Za-z]+)(?!\s*\()/i;

/* ─────────────────────────────────────────────────────────────────────────
   Core parser — takes an extraInfo string, returns a rider entry or null.
   ───────────────────────────────────────────────────────────────────── */
function parseRider(extraInfo) {
  if (!extraInfo) return null;
  const text = extraInfo.trim();
  if (!SAVE_MARKER.test(text)) return null;

  // Try the big pattern first
  const m1 = text.match(PAT_SAVE_STATUS_COUNTDOWN);
  if (m1) {
    const [, save, modifier, rawStatus, dieN, unit, fatTick] = m1;
    const statusId = STATUS_ALIASES[rawStatus.toLowerCase()];
    if (!statusId) return { unmatched: `unknown status "${rawStatus}" in "${text}"` };

    const isDamageUnit = /damage/i.test(unit || "");
    const entry = {
      statusId,
      saveType: save.toLowerCase(),
      duration: `d${dieN}`,
      tickDamageEnabled: isDamageUnit,
      damageOnTick: "",                 // blank = use die roll as damage
      damageType: "-",
      requiresDamage: true,
      fatigueOnFail: 0,
      fatigueOnTick: Number(fatTick) || 0,
    };
    if (modifier) entry._saveModifierText = modifier; // informational, not yet schema'd
    return { entry };
  }

  // Fatigue-only
  const m2 = text.match(PAT_SAVE_FATIGUE_ONLY);
  if (m2) {
    const [, save, n] = m2;
    return {
      entry: {
        statusId: "",                   // no status — fatigue payload only
        saveType: save.toLowerCase(),
        duration: "",
        tickDamageEnabled: false,
        damageOnTick: "",
        damageType: "-",
        requiresDamage: true,
        fatigueOnFail: Number(n),
        fatigueOnTick: 0,
      }
    };
  }

  // Simple "save or status" (no timer)
  const m3 = text.match(PAT_SAVE_STATUS_SIMPLE);
  if (m3) {
    const [, save, rawStatus] = m3;
    const statusId = STATUS_ALIASES[rawStatus.toLowerCase()];
    if (!statusId) return { unmatched: `unknown status "${rawStatus}" in "${text}"` };
    return {
      entry: {
        statusId,
        saveType: save.toLowerCase(),
        duration: "",
        tickDamageEnabled: false,
        damageOnTick: "",
        damageType: "-",
        requiresDamage: true,
        fatigueOnFail: 0,
        fatigueOnTick: 0,
      }
    };
  }

  return { unmatched: text };
}

/* ─────────────────────────────────────────────────────────────────────────
   Main
   ───────────────────────────────────────────────────────────────────── */
function main() {
  const monsters = JSON.parse(fs.readFileSync(MONSTERS_JSON, "utf8")).monsters;

  const proposed  = [];
  const unmatched = [];
  let skippedAlreadyPopulated = 0;

  for (const m of monsters) {
    for (const [idx, a] of (m.actions || []).entries()) {
      if (!a.extraInfo) continue;
      if (!SAVE_MARKER.test(a.extraInfo)) continue;

      // Skip actions already populated with a save-typed causedStatuses entry.
      // (Entries with saveType: "any" or "none" aren't blocking — our parser
      // produces more specific saveType values.)
      const hasSpecificSave = (a.causedStatuses || []).some(
        cs => cs.saveType && cs.saveType !== "any" && cs.saveType !== "none" && cs.statusId
      );
      if (hasSpecificSave) { skippedAlreadyPopulated++; continue; }

      const result = parseRider(a.extraInfo);
      if (!result) continue;

      if (result.unmatched) {
        unmatched.push({
          monster: m.name,
          monsterUuid: m.uuid,
          actionIndex: idx,
          actionName: a.name,
          extraInfo: a.extraInfo,
          reason: result.unmatched,
        });
        continue;
      }

      proposed.push({
        monster: m.name,
        monsterUuid: m.uuid,
        actionIndex: idx,
        actionName: a.name,
        extraInfo: a.extraInfo,
        existingCausedStatuses: a.causedStatuses || [],
        proposedEntry: result.entry,
      });
    }
  }

  // ── Write output files ────────────────────────────────────────────────
  fs.writeFileSync(
    OUT_DIFF,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      summary: {
        proposedCount: proposed.length,
        unmatchedCount: unmatched.length,
        skippedAlreadyPopulated,
      },
      proposed,
    }, null, 2),
    "utf8"
  );

  const unmatchedMd = [
    "# Rider migration — unmatched actions",
    "",
    `Generated ${new Date().toISOString()}.`,
    "",
    "These actions have a `[Save]` marker in `extraInfo` but didn't match any",
    "canonical parser pattern. They need manual review — either the wording",
    "is bespoke enough to live in `causedStatuses.description` (GM-narrated),",
    "or the pattern list needs extending.",
    "",
    `Count: **${unmatched.length}**`,
    "",
    "| Monster | Action | extraInfo |",
    "|---|---|---|",
    ...unmatched.map(u =>
      `| ${u.monster} | ${u.actionName} | ${u.extraInfo.replace(/\|/g, "\\|")} |`
    ),
    "",
  ].join("\n");
  fs.writeFileSync(OUT_UNMATCHED, unmatchedMd, "utf8");

  console.log("Rider migration dry-run complete.");
  console.log(`  Proposed entries:      ${proposed.length}`);
  console.log(`  Unmatched (manual):    ${unmatched.length}`);
  console.log(`  Skipped (already has specific save): ${skippedAlreadyPopulated}`);
  console.log(`  Wrote ${path.relative(ROOT, OUT_DIFF)}`);
  console.log(`  Wrote ${path.relative(ROOT, OUT_UNMATCHED)}`);
}

main();
