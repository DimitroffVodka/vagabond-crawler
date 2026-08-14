#!/usr/bin/env node
/**
 * Publish docs/wiki/ to the GitHub Wiki.
 *
 * The wiki lives in a separate repository (vagabond-crawler.wiki.git) that
 * GitHub serves at /wiki. This clones it to a temp directory, copies
 * docs/wiki/*.md over, commits, and pushes.
 *
 * Usage:
 *   node scripts/publish-wiki.mjs                 # dry run — show the plan, change nothing
 *   node scripts/publish-wiki.mjs --push          # actually publish
 *   node scripts/publish-wiki.mjs --push --prune  # also delete wiki pages not in docs/wiki/
 *   node scripts/publish-wiki.mjs --push -m "..." # custom commit message
 *
 * Dry run is the default on purpose: pushing updates a public page.
 * Auth uses your existing git credentials for github.com.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_REMOTE = "https://github.com/DimitroffVodka/vagabond-crawler.wiki.git";
const DEFAULT_MESSAGE = "docs: sync wiki from docs/wiki/";
const SOURCE_DIR = "docs/wiki";

/**
 * Expected failure with a message already written for the user. Thrown rather
 * than exiting on the spot, so the temp clone still gets cleaned up — a bare
 * process.exit() skips finally blocks.
 */
class Fatal extends Error {}

function parseArgs(argv) {
  const opts = {
    push: false,
    prune: false,
    keep: false,
    message: DEFAULT_MESSAGE,
    remote: DEFAULT_REMOTE,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--push") opts.push = true;
    else if (a === "--prune") opts.prune = true;
    else if (a === "--keep") opts.keep = true;
    else if (a === "-m" || a === "--message") opts.message = argv[++i];
    else if (a === "--remote") opts.remote = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", cwd }).trim();
}

function repoRoot() {
  try {
    return git(["rev-parse", "--show-toplevel"]);
  } catch {
    console.error("Not inside a git repository.");
    process.exit(1);
  }
}

function markdownIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

function sameBytes(a, b) {
  return readFileSync(a).equals(readFileSync(b));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0]);
    process.exit(0);
  }

  const root = repoRoot();
  const source = join(root, SOURCE_DIR);

  const pages = markdownIn(source);
  if (!pages.length) {
    console.error(`No markdown files in ${SOURCE_DIR}/. Nothing to publish.`);
    process.exit(1);
  }
  if (!pages.includes("Home.md")) {
    console.error(`${SOURCE_DIR}/Home.md is missing — the wiki needs a Home page.`);
    process.exit(1);
  }

  const temp = mkdtempSync(join(tmpdir(), "vc-wiki-"));
  let keepClone = false;

  try {
    console.log(`Cloning ${opts.remote}`);
    try {
      execFileSync("git", ["clone", "--depth", "1", "--quiet", opts.remote, temp], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (err) {
      throw new Fatal(
        `\nClone failed: ${String(err.stderr || err.message).trim()}\n` +
          "\nIf the wiki has never been created, open the repo's Wiki tab on GitHub" +
          "\nand save any page once — GitHub only creates the .wiki.git repo after that."
      );
    }

    const existing = markdownIn(temp);
    const added = [];
    const updated = [];
    const unchanged = [];

    for (const name of pages) {
      const src = join(source, name);
      const dst = join(temp, name);
      if (!existsSync(dst)) added.push(name);
      else if (!sameBytes(src, dst)) updated.push(name);
      else unchanged.push(name);
    }

    // Pages on the wiki that docs/wiki/ doesn't have. These may have been made
    // in GitHub's web editor, so never delete them without --prune.
    const orphans = existing.filter((name) => !pages.includes(name));

    console.log("");
    for (const n of added) console.log(`  add     ${n}`);
    for (const n of updated) console.log(`  update  ${n}`);
    for (const n of unchanged) console.log(`  same    ${n}`);
    for (const n of orphans) {
      console.log(`  ${opts.prune ? "delete " : "orphan "} ${n}`);
    }

    if (orphans.length && !opts.prune) {
      console.log(
        `\n${orphans.length} page(s) exist on the wiki but not in ${SOURCE_DIR}/.` +
          `\nThey may have been written in GitHub's web editor. Left untouched.` +
          `\nCopy them into ${SOURCE_DIR}/ to keep them, or pass --prune to delete them.`
      );
    }

    const willChange = added.length + updated.length + (opts.prune ? orphans.length : 0);
    if (!willChange) {
      console.log("\nWiki already matches docs/wiki/. Nothing to publish.");
      return;
    }

    if (!opts.push) {
      console.log(`\nDry run — nothing was pushed. Re-run with --push to publish.`);
      return;
    }

    for (const name of [...added, ...updated]) {
      copyFileSync(join(source, name), join(temp, name));
    }
    if (opts.prune) {
      for (const name of orphans) unlinkSync(join(temp, name));
    }

    git(["add", "-A"], temp);
    git(["commit", "-m", opts.message], temp);
    console.log(`\nPushing to ${opts.remote}`);
    try {
      execFileSync("git", ["push", "--quiet"], { cwd: temp, stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      // The commit exists locally — keep the clone so the push can be retried.
      keepClone = true;
      throw new Fatal(
        `\nPush failed: ${String(err.stderr || err.message).trim()}\n` +
          "\nCheck that your git credentials have write access to the wiki."
      );
    }
    console.log(`Published ${willChange} page(s).`);
  } catch (err) {
    if (!(err instanceof Fatal)) keepClone = true;
    console.error(err instanceof Fatal ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (opts.keep || keepClone) console.log(`\nClone kept at ${temp}`);
    else rmSync(temp, { recursive: true, force: true });
  }
}

main();
