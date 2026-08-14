/**
 * Vagabond Crawler — monkey-patch idempotency guard.
 *
 * Every subsystem that wraps a system/module method needs to know "have I
 * already patched this?". The obvious approach — stamp a flag on the wrapper
 * function and test `target.method.__myFlag` — is WRONG whenever another module
 * wraps the same method after us:
 *
 *     VagabondItem.prototype.rollDamage = vceWrapper(crawlerWrapper(original))
 *                                         ^^^^^^^^^^ the flag lives in here,
 *                                                    invisible from the outside
 *
 * The guard then reads `undefined`, concludes it has not patched yet, and wraps
 * a SECOND time. For relic-effects that meant bonus damage dice applying twice
 * (`1d6 + 1d4 + 1d4`) — reproduced live. `vagabond-character-enhancer` wraps
 * several of the same methods we do and, being alphabetically earlier, its
 * `ready` hook runs first, so this is not hypothetical.
 *
 * Fix: key the marker on the OWNER OBJECT (the thing holding the method), whose
 * identity is stable no matter how many layers wrap the method itself.
 *
 * Inspect from the console with:
 *   VagabondItem.prototype[Symbol.for("vagabond-crawler.wraps")]
 */

// Global symbol registry, so the marker survives even if this module somehow
// gets evaluated twice under different URLs. Symbols never show up in
// Object.keys / JSON.stringify, so system objects stay clean.
const GUARD = Symbol.for("vagabond-crawler.wraps");

/**
 * Has `owner[key]` already been wrapped by us?
 * @param {object} owner Object holding the method (a class prototype, a static
 *                       class, or a plain namespace object).
 * @param {string} key   Method name.
 */
export function isWrapped(owner, key) {
  if (!owner) return false;
  return !!owner[GUARD]?.[key];
}

/**
 * Record that `owner[key]` is now wrapped. Call AFTER assigning the wrapper.
 * @returns {boolean} false when `owner` is unusable.
 */
export function markWrapped(owner, key) {
  if (!owner) return false;
  if (!Object.prototype.hasOwnProperty.call(owner, GUARD)) {
    Object.defineProperty(owner, GUARD, {
      value: Object.create(null),
      configurable: true,
      writable: true,
      enumerable: false,
    });
  }
  owner[GUARD][key] = true;
  return true;
}
