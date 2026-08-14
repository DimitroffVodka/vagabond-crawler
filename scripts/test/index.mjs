/**
 * Vagabond Crawler — Test runner entrypoint.
 *
 * Lazily loads suites + harness so test code never executes in normal play.
 * Exposed via `game.vagabondCrawler.test` once `vagabond-crawler.mjs` calls
 * `installTestRunner()` in the ready hook.
 *
 * Usage from console:
 *   await game.vagabondCrawler.test.run()                  // run everything
 *   await game.vagabondCrawler.test.run("crawl strip")     // filter by suite
 *   await game.vagabondCrawler.test.sweep()                // delete orphan fixtures
 */

const SUITE_LOADERS = [
  () => import("./suites/crawl-strip.mjs"),
  () => import("./suites/animation-fx.mjs"),
  () => import("./suites/relic-effects.mjs"),
  () => import("./suites/light-tracker.mjs"),
  () => import("./suites/npc-abilities.mjs"),
  () => import("./suites/crawl-state.mjs"),
  () => import("./suites/movement-tracker.mjs"),
  () => import("./suites/flanking-countdown.mjs"),
  () => import("./suites/loot-spell-scroll.mjs"),
  () => import("./suites/merchant-recap.mjs"),
  () => import("./suites/exploration-tools.mjs"),
  () => import("./suites/animation-fx-adversarial.mjs"),
  // Drift canary: the 7 system methods we patch and the system.* paths our
  // AEs write. Both fail silently when the system renames them, so no other
  // suite would notice.
  () => import("./suites/system-contract.mjs"),
  () => import("./suites/inventory-slots.mjs"),
];

let _loaded = false;
let _harness = null;
let _fixtures = null;

async function _loadOnce() {
  if (_loaded) return;
  _harness = await import("./harness.mjs");
  ({ Fixtures: _fixtures } = await import("./fixtures.mjs"));
  _harness._resetSuites();
  for (const loader of SUITE_LOADERS) {
    const mod = await loader();
    if (typeof mod.register === "function") mod.register();
  }
  _loaded = true;
}

export async function run(filter = null) {
  if (!game.user.isGM) {
    ui.notifications.warn("Vagabond Crawler tests are GM-only.");
    return null;
  }
  await _loadOnce();
  return _harness.run({ filter, fixtures: _fixtures });
}

export async function sweep() {
  if (!game.user.isGM) return null;
  await _loadOnce();
  const r = await _fixtures.sweepOrphans();
  ui.notifications.info(`Swept ${r.actors} test actor(s), ${r.tokens} test token(s).`);
  return r;
}

/**
 * Wired in by vagabond-crawler.mjs at ready time. We deliberately do NOT
 * import this file at module-load; tests are opt-in.
 */
export function getApi() {
  return { run, sweep };
}
