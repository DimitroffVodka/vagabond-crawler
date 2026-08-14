/**
 * Vagabond Crawler — Test Fixtures
 *
 * Helpers that build canonical scenario state (PCs, NPCs, weapons, relics)
 * and register cleanup callbacks so tests don't leak world actors / canvas
 * tokens. All helpers take the test `ctx` and call `ctx.cleanup(fn)` so
 * teardown is automatic — the test body never has to think about it.
 *
 * Naming: every fixture stamps `__vctest__: true` on the actor / item flag
 * so a sweeper can find and delete orphans (`Fixtures.sweepOrphans()`)
 * if a previous run was interrupted before cleanup ran.
 */

const MODULE_ID = "vagabond-crawler";
const TEST_FLAG_NS = "vctest";

// Reused defaults for synthetic actors. Kept tiny and predictable —
// tests should set whatever they care about explicitly.
//
// `ownership: { default: 3 }` makes the synthetic actor "player-owned" for
// any code that gates on `actor.hasPlayerOwner` (e.g. light-tracker's
// `_getActiveActors()` skips actors with no player owner). Without this,
// the GM is the only owner → hasPlayerOwner returns false → tests that
// rely on actor-iteration helpers silently skip the fixture.
const DEFAULT_PC_DATA = {
  name: "VCTest PC",
  type: "character",
  ownership: { default: 3 },
  system: {
    stats: {
      might:    { value: 0 },
      finesse:  { value: 0 },
      reaction: { value: 0 },
      logic:    { value: 0 },
      will:     { value: 0 },
      charm:    { value: 0 },
    },
    resources: {
      hp:   { value: 20, max: 20 },
      mana: { value: 10, max: 10 },
    },
    speed: { base: 30, crawl: 30 },
  },
};

// NPCs use `system.health` (not `system.resources.hp`) for HP — different
// data model from PCs. See actor-npc.mjs in the system. Many runtime
// helpers gate on `actor.system.health.value > 0`, so make sure HP is set.
const DEFAULT_NPC_DATA = {
  name: "VCTest Wolf",
  type: "npc",
  ownership: { default: 3 },
  system: {
    health: { value: 8, max: 8, temp: 0 },
    actions: [
      { name: "Bite", description: "1d6 piercing", recharge: "", note: "" },
    ],
    abilities: [],
  },
};

const DEFAULT_WEAPON_DATA = {
  name: "Test Longsword",
  type: "equipment",
  system: {
    equipmentType: "weapon",
    equipped: true,
    // validateCanAttack() checks `equipmentState`, NOT `equipped`. Without
    // this the synthetic weapon throws "is not equipped" and VCE's
    // rollAttack wrap swallows the error → null result. Valid choices are
    // 'unequipped' | 'oneHand' | 'twoHands' (see base-equipment.mjs schema).
    equipmentState: "oneHand",
    weaponSkill: "melee",
    currentDamage: "d8",
    currentDamageType: "physical",
    properties: [],
  },
};

export const Fixtures = {
  /**
   * Create a synthetic player character (world actor) plus a token on the
   * current scene. Both get cleaned up at end-of-case.
   *
   * @param {object} ctx        Test context (provides cleanup())
   * @param {object} [overrides] Deep-merged into DEFAULT_PC_DATA
   * @param {{x:number,y:number}} [pos] Token position (defaults to scene center-ish)
   * @returns {Promise<{actor:Actor, token:Token, tokenDoc:TokenDocument}>}
   */
  async createTestPC(ctx, overrides = {}, pos = null) {
    const data = foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULT_PC_DATA), overrides, { inplace: false }
    );
    foundry.utils.setProperty(data, `flags.${TEST_FLAG_NS}.created`, Date.now());
    const actor = await Actor.create(data);
    ctx.cleanup(async () => { try { await actor.delete(); } catch {} });

    const token = await this._dropToken(ctx, actor, pos);
    return { actor, token, tokenDoc: token.document };
  },

  /**
   * Create a synthetic NPC actor plus a token on the current scene.
   * @param {object} ctx
   * @param {object} [overrides]
   * @param {{x:number,y:number}} [pos]
   */
  async createTestNPC(ctx, overrides = {}, pos = null) {
    const data = foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULT_NPC_DATA), overrides, { inplace: false }
    );
    foundry.utils.setProperty(data, `flags.${TEST_FLAG_NS}.created`, Date.now());
    const actor = await Actor.create(data);
    ctx.cleanup(async () => { try { await actor.delete(); } catch {} });

    const token = await this._dropToken(ctx, actor, pos);
    return { actor, token, tokenDoc: token.document };
  },

  /**
   * Add an equipped weapon to an actor with optional relic-forge powers.
   *
   * @param {Actor} actor
   * @param {object} [overrides] Deep-merged into DEFAULT_WEAPON_DATA
   * @param {object} [opts]
   * @param {{bonusDamageDice?:string, bonusDamageLabel?:string,
   *          baneTarget?:string, baneDice?:string,
   *          strikeDice?:string, strikeType?:string,
   *          relicPower?:string}} [opts.relicFlags]
   *   When set, the weapon is marked as forged and an embedded AE is added
   *   carrying the supplied relic flags (mode = on-use). Lets a single
   *   helper produce Strike I / Bane / Vicious / etc. test weapons.
   * @returns {Promise<Item>}
   */
  async addWeapon(actor, overrides = {}, { relicFlags = null } = {}) {
    const data = foundry.utils.mergeObject(
      foundry.utils.deepClone(DEFAULT_WEAPON_DATA), overrides, { inplace: false }
    );
    if (relicFlags) {
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.relicForge`, { forged: true });
      data.effects = [{
        name: `Relic: ${relicFlags.relicPower ?? "Test"}`,
        icon: "icons/svg/upgrade.svg",
        disabled: false,
        changes: [],
        flags: {
          [MODULE_ID]: relicFlags,
          vagabond: { applicationMode: "on-use" },
        },
      }];
    }
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    return item;
  },

  /**
   * Convenience: create an NPC adjacent to an existing PC token. Reads
   * `pcRef.tokenDoc.x/y` (NOT `pcRef.token.x/y` — the placeable's `.x` is 0
   * until canvas finishes its first render, which hasn't happened yet at
   * fixture-build time, and that gives a wildly wrong position).
   */
  async createTestNPCAdjacentTo(ctx, pcRef, overrides = {}) {
    const gs = canvas.grid.size;
    const pos = { x: pcRef.tokenDoc.x + gs, y: pcRef.tokenDoc.y };
    return this.createTestNPC(ctx, overrides, pos);
  },

  /** Internal — drop a token for an actor on the current scene. */
  async _dropToken(ctx, actor, pos) {
    const scene = canvas.scene;
    if (!scene) throw new Error("Fixtures: no active scene; cannot drop token");
    const center = pos ?? {
      x: (scene.dimensions?.sceneX ?? 0) + (scene.dimensions?.sceneWidth ?? 1000) / 2,
      y: (scene.dimensions?.sceneY ?? 0) + (scene.dimensions?.sceneHeight ?? 1000) / 2,
    };
    const tdData = await actor.getTokenDocument({ x: center.x, y: center.y });
    const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [tdData]);
    ctx.cleanup(async () => { try { await tokenDoc.delete(); } catch {} });

    // Resolve the placeable on canvas — needed for `token.actor`, control(), etc.
    const token = canvas.tokens.get(tokenDoc.id);
    if (!token) throw new Error(`Fixtures: token placeable not found for ${tokenDoc.id}`);
    return token;
  },

  /**
   * Snapshot Sequencer effect names + count, used by FX assertions to
   * compare delta after an action runs.
   */
  fxSnapshot() {
    if (typeof Sequencer === "undefined") return { count: 0, names: [] };
    const fx = Sequencer.EffectManager?.getEffects?.({}) ?? [];
    return {
      count: fx.length,
      names: fx.map(e => e?.data?.name ?? null),
      moduleNames: fx.map(e => e?.data?.moduleName ?? null),
    };
  },

  /**
   * Wait until Sequencer reports MORE live effects than `baseline`, and return
   * that snapshot.
   *
   * Use this instead of `settle(n)` + `fxSnapshot()`. fxSnapshot reads
   * `EffectManager.getEffects()`, which lists only effects that are CURRENTLY
   * PLAYING — so sleeping a fixed time and then sampling races in BOTH
   * directions: too early and the effect hasn't started, too late and it has
   * already finished and been dropped from the list.
   *
   * That is not hypothetical. A crawler weapon FX measured alive from ~0-50ms
   * to 750-800ms, and the test that used `settle(800)` sampled exactly as it
   * expired — failing approximately 1 run in 15 while passing in isolation.
   *
   * Polling for the increase is robust at both ends: it returns as soon as the
   * effect appears, long before it can expire.
   *
   * @param {{count:number}} baseline  snapshot taken before triggering the FX
   * @param {number} timeoutMs         give up after this long
   * @returns {Promise<object>} the snapshot showing the increase, or the last
   *                            one polled if it never increased (lets the
   *                            caller's own assertion produce the failure)
   */
  async fxWaitForIncrease(baseline, timeoutMs = 2500, stepMs = 50) {
    const deadline = Date.now() + timeoutMs;
    let last = this.fxSnapshot();
    while (Date.now() < deadline) {
      last = this.fxSnapshot();
      if (last.count > baseline.count) return last;
      await this.settle(stepMs);
    }
    return last;
  },

  /**
   * Capture all chat messages created during `fn`. Returns the array of
   * created messages plus the value `fn` resolved to.
   */
  async captureChatMessages(fn) {
    const captured = [];
    const hookId = Hooks.on("createChatMessage", (msg) => captured.push(msg));
    let result;
    try { result = await fn(); }
    finally { Hooks.off("createChatMessage", hookId); }
    return { messages: captured, result };
  },

  /**
   * Wait for an arbitrary async settle window. Animation FX uses
   * setTimeout chains for stagger + cleanup; tests need a beat to let
   * those land before asserting on Sequencer state.
   */
  settle(ms = 600) {
    return new Promise(r => setTimeout(r, ms));
  },

  /**
   * Sweep stale test actors / tokens left behind by an interrupted run.
   * Safe to call from the console: `await game.vagabondCrawler.test.sweep()`.
   */
  async sweepOrphans() {
    let actors = 0, tokens = 0;
    for (const a of [...game.actors]) {
      if (a.flags?.[TEST_FLAG_NS]?.created) {
        try { await a.delete(); actors++; } catch {}
      }
    }
    for (const scene of game.scenes) {
      const stale = scene.tokens.filter(td => td.actor?.flags?.[TEST_FLAG_NS]?.created);
      if (stale.length) {
        try {
          await scene.deleteEmbeddedDocuments("Token", stale.map(t => t.id));
          tokens += stale.length;
        } catch {}
      }
    }
    return { actors, tokens };
  },
};
