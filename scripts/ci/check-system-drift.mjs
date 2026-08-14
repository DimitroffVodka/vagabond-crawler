#!/usr/bin/env node
/**
 * Vagabond Crawler — system drift canary.
 *
 * Fails when `module.json`'s declared vagabond `verified` version falls behind
 * the system's current release.
 *
 * WHY THIS EXISTS
 * ---------------
 * v1.18.0 fixed four separate bugs that all had one root cause: the module was
 * coded against vagabond ~5.8 while 5.36 was installed. In that 28-minor gap the
 * system deleted the `weapon` / `armor` / `gear` item types and reworked slot
 * counting, so code that was correct when written became wrong without anyone
 * touching it. Nothing surfaced that until players reported wrong numbers.
 *
 * A drift check already existed as a live smoke test (`system-contract.mjs`) and
 * was red — but it only runs inside a Foundry world, on demand, by a GM who
 * thinks to run it. This is the same check somewhere a machine looks at it.
 *
 * Run locally:  node scripts/ci/check-system-drift.mjs
 *
 * Exit codes: 0 = in step (or could not check), 1 = drifted / manifest invalid.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_JSON = resolve(HERE, "../../module.json");
const SYSTEM_MANIFEST = "https://github.com/mordachai/vagabond/releases/latest/download/system.json";

/** Compare on major.minor — patch releases don't move APIs and would be noise. */
const track = (v) => String(v ?? "").split(".").slice(0, 2).join(".");
const rank = (v) => track(v).split(".").map(Number);

/** @returns {-1|0|1} how `a` orders against `b` on the major.minor track. */
function cmpTrack(a, b) {
  const [aMaj, aMin] = rank(a);
  const [bMaj, bMin] = rank(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  return 0;
}

const fail = [];
const warn = [];

// ── module.json ─────────────────────────────────────────────────────────────
let mod;
try {
  mod = JSON.parse(await readFile(MODULE_JSON, "utf8"));
} catch (err) {
  console.error(`✗ module.json is unreadable or invalid JSON: ${err.message}`);
  process.exit(1);
}

const vagabond = (mod.relationships?.systems ?? []).find((s) => s.id === "vagabond");
if (!vagabond) {
  console.error("✗ module.json declares no `vagabond` system relationship.");
  process.exit(1);
}
const declared = vagabond.compatibility?.verified;
if (!declared) {
  console.error("✗ vagabond relationship has no `compatibility.verified`.");
  process.exit(1);
}

// Manifest URLs must use the `latest` redirect, or existing installs stop seeing
// updates. Cheap to check here and easy to get wrong during a release.
for (const key of ["manifest", "download"]) {
  const url = mod[key] ?? "";
  if (!url.includes("/releases/latest/download/")) {
    fail.push(`module.json \`${key}\` does not use the /releases/latest/ redirect: ${url || "(missing)"}`);
  }
}

// ── current system release ──────────────────────────────────────────────────
let latest = null;
try {
  const res = await fetch(SYSTEM_MANIFEST, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  latest = (await res.json()).version;
} catch (err) {
  // A network blip is not drift — say so loudly but don't cry wolf. The weekly
  // schedule means a real outage still gets caught on the next run.
  warn.push(`could not reach the vagabond manifest (${err.message}) — drift NOT checked this run`);
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`module            : vagabond-crawler ${mod.version}`);
console.log(`declared verified : vagabond ${declared}  (track ${track(declared)})`);
console.log(`latest release    : vagabond ${latest ?? "unknown"}${latest ? `  (track ${track(latest)})` : ""}`);
console.log("");

if (latest && cmpTrack(declared, latest) < 0) {
  fail.push(
    `vagabond \`verified\` is behind: declared ${declared} (${track(declared)}) vs released ${latest} (${track(latest)}).\n` +
    `    Re-test against ${latest}, then bump \`relationships.systems[vagabond].compatibility.verified\` in module.json.\n` +
    `    Do not bump it blind — the point is to force a re-test, not to silence the check.`
  );
}

for (const w of warn) console.warn(`⚠ ${w}`);
for (const f of fail) console.error(`✗ ${f}`);

if (fail.length) {
  console.error(`\n${fail.length} problem(s) found.`);
  process.exit(1);
}
console.log(warn.length ? "✓ no drift detected (with warnings above)" : "✓ in step with the current vagabond release");
process.exit(0);
