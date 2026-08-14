#!/usr/bin/env node
/**
 * Wiki drift check.
 *
 * `docs/*.md` (the full GM guide) and `docs/wiki/*.md` (the short skim layer
 * published to the GitHub Wiki) cover the same six topics in deliberately
 * different prose. They are hand-maintained peers — nothing generates one from
 * the other — so this check flags when one side moves without the other.
 *
 * Usage:
 *   node scripts/check-wiki-drift.mjs                 # compare HEAD~1...HEAD
 *   node scripts/check-wiki-drift.mjs --base main     # compare main...HEAD
 *   node scripts/check-wiki-drift.mjs --staged        # compare the index
 *
 * Exit 0 = clean, exit 1 = drift. Add [wiki-ok] to a commit message in the
 * range to acknowledge an intentional one-sided edit.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

/** guide page → wiki page. Both sides are hand-written; neither is generated. */
const PAIRS = [
  ["README.md", "docs/wiki/Home.md"],
  ["docs/crawl-loop.md", "docs/wiki/Crawl-Loop.md"],
  ["docs/combat.md", "docs/wiki/NPC-Combat-Automation.md"],
  ["docs/exploration.md", "docs/wiki/Exploration.md"],
  ["docs/crafting-loot.md", "docs/wiki/Crafting-and-Loot.md"],
  ["docs/session-tracking.md", "docs/wiki/Session-Tracking.md"],
  ["docs/player-quickref.md", "docs/wiki/Player-Quick-Reference.md"],
];

/** Wiki navigation files have no guide counterpart by design. */
const WIKI_NAV = ["docs/wiki/_Sidebar.md", "docs/wiki/_Footer.md"];

const SKIP_TOKEN = "[wiki-ok]";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const opts = { base: null, staged: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--staged") opts.staged = true;
    else if (argv[i] === "--base") opts.base = argv[++i];
  }
  return opts;
}

function changedFiles({ base, staged }) {
  if (staged) return git(["diff", "--name-only", "--cached"]).split("\n").filter(Boolean);
  const from = base || "HEAD~1";
  // Three-dot: changes on our side since the merge-base. Correct for PRs, and
  // equivalent to two-dot when `from` is a direct ancestor (push events).
  return git(["diff", "--name-only", `${from}...HEAD`]).split("\n").filter(Boolean);
}

function commitMessages({ base, staged }) {
  if (staged) return "";
  const from = base || "HEAD~1";
  return git(["log", "--format=%B", `${from}...HEAD`]);
}

/** Top-level docs/*.md are the GM guide track. Subdirs are other tracks. */
function guidePages() {
  if (!existsSync("docs")) return [];
  return readdirSync("docs", { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => `docs/${e.name}`);
}

function wikiPages() {
  if (!existsSync("docs/wiki")) return [];
  return readdirSync("docs/wiki", { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => `docs/wiki/${e.name}`);
}

/**
 * Pages present on disk but missing from PAIRS. Catches a new guide page added
 * without a wiki counterpart, which would otherwise never be drift-checked.
 */
function unpairedPages() {
  const paired = new Set(PAIRS.flat());
  const known = new Set([...paired, ...WIKI_NAV]);
  return [...guidePages(), ...wikiPages()].filter((p) => !known.has(p));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  let changed;
  try {
    changed = changedFiles(opts);
  } catch (err) {
    console.error(`Could not read the diff: ${err.message}`);
    console.error("In CI, check that actions/checkout used fetch-depth: 0.");
    process.exit(1);
  }

  const touched = new Set(changed);
  const errors = [];
  const notes = [];

  for (const [guide, wiki] of PAIRS) {
    const guideChanged = touched.has(guide);
    const wikiChanged = touched.has(wiki);
    if (guideChanged && !wikiChanged) {
      errors.push(`${guide} changed, but ${wiki} did not.`);
    } else if (wikiChanged && !guideChanged) {
      // The wiki is a condensation — tightening its prose often needs no guide
      // change. Worth surfacing, not worth failing on.
      notes.push(`${wiki} changed without ${guide} — fine if it was a wording pass.`);
    }
  }

  for (const page of unpairedPages()) {
    errors.push(`${page} has no entry in PAIRS — add one in scripts/check-wiki-drift.mjs.`);
  }

  for (const [guide, wiki] of PAIRS) {
    for (const p of [guide, wiki]) {
      if (!existsSync(p)) errors.push(`PAIRS lists ${p}, but it is not on disk.`);
    }
  }

  for (const note of notes) console.log(`note: ${note}`);

  if (!errors.length) {
    console.log("Wiki drift check passed.");
    process.exit(0);
  }

  if (commitMessages(opts).includes(SKIP_TOKEN)) {
    console.log(`Drift found, but ${SKIP_TOKEN} is present — acknowledged:`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(0);
  }

  console.error("\nWiki drift:\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    `\ndocs/ and docs/wiki/ are hand-maintained peers covering the same topics.` +
      `\nUpdate the matching page, or add ${SKIP_TOKEN} to the commit message if` +
      `\nthe change genuinely does not apply to the other side.` +
      `\nSee docs/dev/wiki.md.\n`
  );
  process.exit(1);
}

main();
