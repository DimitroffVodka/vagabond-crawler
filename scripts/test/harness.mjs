/**
 * Vagabond Crawler — Test Harness
 *
 * A tiny live-runtime test runner. Tests run inside Foundry against real
 * game state (synthetic actors / tokens cloned per case) so they exercise
 * the actual hook chain, wrap stack, and document lifecycle — the things
 * that unit tests miss and that break in real play sessions.
 *
 * Public surface:
 *   import { suite, case_, expect } from "./harness.mjs";
 *   suite("Crawl Strip", () => {
 *     case_("weapon attack via _fireAction includes relic dice", async (ctx) => {
 *       const { actor, token } = await ctx.fx.createTestPC();
 *       ...
 *       expect(damageRoll.formula).toContain("1d4");
 *     });
 *   });
 *
 * Each case runs in isolation: the harness wraps the body in a try/finally
 * that calls every cleanup callback registered via `ctx.cleanup(fn)` (or
 * registered automatically by the fixture helpers). Even if assertions
 * throw, fixtures get torn down — no orphan actors left in the world.
 *
 * Output: console.group per suite, ✓ / ✗ per case, diff on failure, final
 * summary line. Plain `console.log` so it shows up in F12 dev tools and in
 * the Foundry MCP `get_console_errors` capture.
 */

const _suites = [];
let _currentSuite = null;

export function suite(name, fn) {
  const s = { name, cases: [] };
  _currentSuite = s;
  try {
    fn();
  } finally {
    _currentSuite = null;
  }
  _suites.push(s);
}

export function case_(name, fn) {
  if (!_currentSuite) throw new Error(`case_("${name}") called outside a suite()`);
  _currentSuite.cases.push({ name, fn });
}

/** Drop and re-collect all suites — call before re-running to pick up edits. */
export function _resetSuites() { _suites.length = 0; }

/* -------------------------------------------- */
/*  expect()                                    */
/* -------------------------------------------- */

class ExpectFail extends Error {
  constructor(msg, actual, expected) {
    super(msg);
    this.actual = actual;
    this.expected = expected;
    this.name = "ExpectFail";
  }
}

class Expectation {
  constructor(actual) { this._actual = actual; this._not = false; }
  get not() { this._not = !this._not; return this; }
  _fail(msg, expected) {
    throw new ExpectFail(msg, this._actual, expected);
  }
  _check(cond, msg, expected) {
    const pass = this._not ? !cond : cond;
    if (!pass) this._fail(msg, expected);
  }

  toBe(expected) {
    this._check(Object.is(this._actual, expected), `expected ${this._not ? "not " : ""}toBe`, expected);
  }
  toEqual(expected) {
    const eq = JSON.stringify(this._actual) === JSON.stringify(expected);
    this._check(eq, `expected ${this._not ? "not " : ""}toEqual`, expected);
  }
  toBeNull()      { this._check(this._actual === null, "expected toBeNull"); }
  toBeUndefined() { this._check(this._actual === undefined, "expected toBeUndefined"); }
  toBeTruthy()    { this._check(!!this._actual, "expected toBeTruthy"); }
  toBeFalsy()     { this._check(!this._actual, "expected toBeFalsy"); }
  toBeGreaterThan(n) { this._check(this._actual > n, `expected > ${n}`); }
  toBeLessThan(n)    { this._check(this._actual < n, `expected < ${n}`); }
  toContain(sub) {
    if (typeof this._actual === "string") {
      this._check(this._actual.includes(sub), `expected string to contain "${sub}"`, sub);
    } else if (Array.isArray(this._actual)) {
      this._check(this._actual.includes(sub), `expected array to contain ${JSON.stringify(sub)}`, sub);
    } else {
      this._fail(`toContain not supported on ${typeof this._actual}`, sub);
    }
  }
  toMatch(regex) {
    this._check(regex.test(this._actual), `expected to match ${regex}`, String(regex));
  }
}

export function expect(actual) { return new Expectation(actual); }

/* -------------------------------------------- */
/*  Runner                                      */
/* -------------------------------------------- */

/**
 * Run all registered suites, optionally filtered by suite-name substring
 * (case-insensitive). Returns { total, passed, failed, durationMs, failures[] }.
 */
export async function run({ filter = null, fixtures = null } = {}) {
  const summary = { total: 0, passed: 0, failed: 0, durationMs: 0, failures: [] };
  const t0 = performance.now();

  console.log("%c┌─ vagabond-crawler tests ─", "color:#9cf;font-weight:bold");

  const filtered = filter
    ? _suites.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
    : _suites;

  for (const s of filtered) {
    console.group(`%c│ ${s.name}`, "color:#9cf;font-weight:bold");
    for (const c of s.cases) {
      summary.total++;
      const cleanups = [];
      const ctx = {
        fx: fixtures,
        cleanup: (fn) => { if (typeof fn === "function") cleanups.push(fn); },
      };
      const tCase = performance.now();
      let err = null;
      try {
        await c.fn(ctx);
      } catch (e) {
        err = e;
      } finally {
        // Run cleanups in reverse order, swallow individual errors so one
        // failed teardown can't strand the rest.
        for (const fn of cleanups.reverse()) {
          try { await fn(); } catch (e) { console.warn("[test] cleanup failed:", e); }
        }
      }
      const dt = Math.round(performance.now() - tCase);
      if (err) {
        summary.failed++;
        summary.failures.push({ suite: s.name, case: c.name, error: err });
        const tag = `%c  ✗ ${c.name} (${dt}ms)`;
        console.log(tag, "color:#f88;font-weight:bold");
        if (err instanceof ExpectFail) {
          console.log("    expected:", err.expected);
          console.log("    actual:  ", err.actual);
        } else {
          console.log("    error:", err?.stack ?? err);
        }
      } else {
        summary.passed++;
        console.log(`%c  ✓ ${c.name} (${dt}ms)`, "color:#9f9");
      }
    }
    console.groupEnd();
  }

  summary.durationMs = Math.round(performance.now() - t0);
  const color = summary.failed === 0 ? "color:#9f9;font-weight:bold" : "color:#f88;font-weight:bold";
  console.log(
    `%c└─ ${summary.passed}/${summary.total} passed${summary.failed ? `, ${summary.failed} failed` : ""} in ${summary.durationMs}ms`,
    color
  );
  return summary;
}
