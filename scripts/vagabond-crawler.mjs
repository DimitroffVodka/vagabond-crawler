/**
 * Vagabond Crawler — Main Entry Point
 */

import { CrawlState }       from "./crawl-state.mjs";
import { CrawlBar }         from "./crawl-bar.mjs";
import { CrawlStrip }       from "./crawl-strip.mjs";
import { MovementTracker }  from "./movement-tracker.mjs";
import { EncounterTools }   from "./encounter-tools.mjs";
import { MoraleChecker }    from "./morale-checker.mjs";
import { RestBreather }     from "./rest-breather.mjs";
import { LightTracker }     from "./light-tracker.mjs";
import { CrawlClock }       from "./crawl-clock.mjs";
import { FlankingChecker }  from "./flanking-checker.mjs";
import { registerChatTooltips } from "./chat-tooltips.mjs";
import { registerMagicWardHook, registerEarlyRollBuilderWrap } from "./npc-abilities.mjs";
import { ItemDrops }        from "./item-drops.mjs";
import { LootDrops }        from "./loot-drops.mjs";
import { RelicForge }       from "./relic-forge.mjs";
import { RelicEffects }     from "./relic-effects.mjs";
import { RELIC_POWERS, getRelicPower, getPowersByCategory, METAL_DISPLAY_NAMES } from "./relic-powers.mjs";
import { LootManager }      from "./loot-manager.mjs";
import { LootTracker }      from "./loot-tracker.mjs";
import { LootGenerator }    from "./loot-generator.mjs";
import { CountdownRoller }  from "./countdown-roller.mjs";
import { ScrollForge }      from "./scroll-forge.mjs";
import { EnchantmentScroll } from "./enchantment-scroll.mjs";
import { MerchantShop }     from "./merchant-shop.mjs";
import { PartyInventory }  from "./party-inventory.mjs";
import { MonsterCreator }  from "./monster-creator/monster-creator-app.mjs";
import { XpCounterPatch }  from "./xp-counter-patch.mjs";
import { SessionRecap }    from "./session-recap.mjs";
import { AnimationFx }    from "./animation-fx.mjs";
import { HitDieConfig, HitDieConfigApp } from "./hit-die-config.mjs";
import { StackSplit }     from "./stack-split.mjs";
import { isWrapped, markWrapped } from "./wrap-guard.mjs";
import { GatherFriendlies } from "./gather-friendlies.mjs";
import { registerSettingsGroupMenus } from "./settings-group-app.mjs";
import { resolveHitDieConfig, calculateHP, dieAvg } from "./monster-mutator.mjs";

export const MODULE_ID = "vagabond-crawler";

// ── Inventory helpers (shared with movement-tracker) ─────────────────────────
// The system's `actor.system.inventory.occupiedSlots` (`_calculateInventorySlots`,
// `module/data/actor-character.mjs:1174-1198`, verified against vagabond 5.36.0):
//
//   if (item.system.containerId) continue;             // stowed items are free
//   const itemSlots = item.system.slots || item.system.baseSlots || 0;
//   if (itemSlots > 0) occupiedSlots += itemSlots;     // quantity is never read
//
// So the system charges nothing for zero-slot items and ignores quantity entirely
// — two Torches occupy one slot. Crawler deviates on exactly ONE axis: quantity.
// A stack of N costs `baseSlots × N`, so the extra to add is `baseSlots × (N - 1)`.
//
// Zero-slot items are free here, same as the system. Crawler used to pool them by
// `gearCategory` at 10-per-slot, but `Math.ceil` ran per pool, so every distinct
// category cost a full slot even at one item — a Backpack (`baseSlots: 0`, free in
// the system) cost a slot, and characters read over capacity. Removed deliberately.
const _INV_TYPES = new Set(["equipment", "weapon", "armor", "gear", "container"]);

/**
 * Does this item occupy inventory on its owner's sheet? Exported so any surface
 * that LISTS inventory uses the same gate as the code that COUNTS it. Party
 * Inventory previously hardcoded `type === "equipment"`, which dropped
 * `container`-type items from its list while still charging their slots in the
 * total — a column whose items didn't add up to its own number.
 */
export function isInventoryItem(item) {
  if (!item?.system || !_INV_TYPES.has(item.type)) return false;
  return !item.system.containerId;   // stowed items are represented by their container
}

export function getExtraOccupiedSlots(actor) {
  if (!actor?.items) return 0;
  let extra = 0;
  for (const item of actor.items) {
    if (!item.system || !_INV_TYPES.has(item.type)) continue;
    // Stowed items are excluded by the system's own slot math — the container's
    // slots represent them. Counting them here double-charged every packed item.
    if (item.system.containerId) continue;
    // "Weightless" opt-out: never contribute extra slots, whatever the quantity.
    if (item.getFlag(MODULE_ID, "trueZeroSlot")) continue;
    const baseSlots = _slotsOf(item);
    const qty = _qtyOf(item);
    if (qty > 1) extra += baseSlots * (qty - 1);
  }
  return extra;
}

// Normalised readers, shared by both halves of the invariant below.
// `baseSlots` is clamped at 0 because the schema puts no `min` on the field and
// the system only adds it when `> 0`; a negative value must contribute nothing,
// not subtract. `quantity` is floored and clamped for the same reason (the
// schema says `integer: true, min: 0`, but nothing stops a module writing junk).
function _slotsOf(item) {
  return Math.max(0, item?.system?.slots || item?.system?.baseSlots || 0);
}
function _qtyOf(item) {
  return Math.max(0, Math.floor(item?.system?.quantity ?? 1));
}

// Capacity a single item consumes under Crawler's model. MUST stay in lockstep
// with getExtraOccupiedSlots() above, or the sheet header and the inventory grid
// will disagree. The identity that has to hold, summed over every item:
//
//   Σ itemCapacity  ===  system.occupiedSlots + getExtraOccupiedSlots()
//
// The system contributes `baseSlots` once per item; Crawler's extra contributes
// `baseSlots × (qty − 1)` unless the item is flagged weightless. So a weightless
// item still costs the system's `baseSlots` — it only forgoes the stack multiplier.
//
// `quantity: 0` is the case worth spelling out. The system charges `baseSlots`
// regardless of quantity, and `getExtraOccupiedSlots` adds nothing (its guard is
// `qty > 1`), so the header shows `baseSlots`. A naive `baseSlots × qty` here
// would return 0 and the grid would start numbering at 1 while the header said 1
// occupied — the sheet contradicting itself. Emptying a stack to zero without
// deleting the item is ordinary play (ammo, consumables), so this is not
// theoretical. Charging `baseSlots` keeps parity with the system.
function _itemCapacity(item) {
  const baseSlots = _slotsOf(item);
  if (item?.getFlag?.(MODULE_ID, "trueZeroSlot")) return baseSlots;
  const qty = _qtyOf(item);
  return qty > 1 ? baseSlots * qty : baseSlots;
}

// ── Inventory grid numbering ─────────────────────────────────────────────────
// The system numbers the grid from its own model, which never reads `quantity`
// (`InventoryHandler.prepareInventoryGrid`, advancing by `itemData.totalSlots`).
// Crawler charges `baseSlots × N` for a stack, so the patched header read "12 / 17"
// while the grid still drew free cells starting at 11 — the sheet contradicted
// itself. Recompute the numbering with quantity-aware sizes so both agree.
//
// `totalSlots` also drives `grid-column: span` in inventory-card.hbs, so a stack
// now visually occupies its true footprint instead of a single cell.
export function renumberInventoryGrid(context, actor) {
  const inv = actor?.system?.inventory;
  if (!inv || !Array.isArray(context?.inventoryItems)) return;
  const baseMaxSlots = inv.baseMaxSlots ?? 0;
  const maxSlots = inv.maxSlots ?? 0;

  let capacityNumber = 1;
  for (const itemData of context.inventoryItems) {
    const consumed = _itemCapacity(itemData.item);
    itemData.totalSlots = consumed;
    if (consumed > 0) {
      itemData.displayNumber = capacityNumber;
      capacityNumber += consumed;
    } else {
      itemData.displayNumber = null;  // zero-slot items are unnumbered, as before
    }
  }

  const itemCount = context.inventoryItems.length;
  const emptyCount = Math.max(0, baseMaxSlots - (capacityNumber - 1));
  context.emptySlots = Array.from({ length: emptyCount }, (_, i) => {
    const slotNumber = capacityNumber + i;
    // Fatigue eats the LAST N slots — anything past the effective max is unusable.
    const fatigueOccupied = slotNumber > maxSlots;
    return { index: itemCount + i, displayNumber: slotNumber, unavailable: fatigueOccupied, fatigueOccupied };
  });
  context.gridSize = itemCount + emptyCount;
  context.gridRows = Math.ceil(context.gridSize / 4);
}

// Wrap the system's grid builder so the renumber runs for every surface that uses
// it — the character sheet AND the character HUD both instantiate InventoryHandler.
async function _wrapInventoryGrid() {
  let InventoryHandler;
  try {
    ({ InventoryHandler } = await import(
      "../../../systems/vagabond/module/sheets/handlers/_module.mjs"
    ));
  } catch (err) {
    console.error(`${MODULE_ID} | Inventory grid wrap: failed to import InventoryHandler`, err);
    return;
  }
  const orig = InventoryHandler?.prototype?.prepareInventoryGrid;
  if (typeof orig !== "function") {
    console.error(`${MODULE_ID} | Inventory grid wrap: prepareInventoryGrid not found`);
    return;
  }
  // Guard on the prototype, not the function — a function-level flag is hidden
  // the moment another module wraps the same method. See wrap-guard.mjs.
  if (isWrapped(InventoryHandler.prototype, "prepareInventoryGrid")) return;

  function prepareInventoryGrid(context, ...rest) {
    const out = orig.call(this, context, ...rest);
    try {
      renumberInventoryGrid(context, this.actor);
    } catch (err) {
      console.error(`${MODULE_ID} | Inventory grid renumber failed`, err);
    }
    return out;
  }
  prepareInventoryGrid.__vcbWrapped = true;   // kept for debugging/introspection only
  InventoryHandler.prototype.prepareInventoryGrid = prepareInventoryGrid;
  markWrapped(InventoryHandler.prototype, "prepareInventoryGrid");
}

/**
 * Total slots an actor occupies under Crawler's model — the ONE number every
 * surface must display. The sheet header, the inventory grid, Party Inventory and
 * the system's Character HUD all route through this. They previously each did
 * their own arithmetic and drifted apart: the HUD and Party Inventory kept
 * reporting the system's unadjusted count while the sheet showed the real one.
 *
 * @returns {number|null} null when the actor has no inventory to report on.
 */
export function getTotalOccupiedSlots(actor) {
  const inv = actor?.system?.inventory;
  if (!inv || inv.maxSlots == null) return null;
  return (inv.occupiedSlots ?? 0) + getExtraOccupiedSlots(actor);
}

export function isOverloaded(actor) {
  if (actor?.type !== "character") return false;
  const total = getTotalOccupiedSlots(actor);
  if (total == null) return false;
  return total > actor.system.inventory.maxSlots;
}

// ── Settings ──────────────────────────────────────────────────────────────────

// ── Setup: wrap buildAndEvaluateD20WithRollData BEFORE vagabond-character-enhancer ──
// VCE wraps the same function in its "ready" hook. Wrapping in "setup" ensures
// our wrap is captured as VCE's orig → VCE becomes outermost, we become innermost.
// This is required so our Nimble clamp sees the FINAL favorHinder after VCE has
// applied its `_rangeFavorHinder` combine.
Hooks.once("setup", () => {
  registerEarlyRollBuilderWrap();
  _wrapNpcMaxHpForHitDie();
});

/**
 * Wrap `VagabondNPC.prototype.prepareDerivedData` so that an actor's
 * `flags.vagabond-crawler.hitDie` overrides the system's hardcoded
 * `Math.floor(hd * 4.5)` Max-HP rule. Without this wrap the actor sheet (and
 * any non-token consumer) shows the legacy max regardless of the configured
 * die. The token-side `preCreateToken` override stays as the per-spawn rolled
 * path; this wrap covers the static / sheet-display path.
 *
 * Wrapped in `setup` (not `ready`) so the wrap is the innermost layer — if
 * other modules also wrap `prepareDerivedData` in `ready`, our recompute will
 * have already adjusted `health.max` by the time they run.
 */
function _wrapNpcMaxHpForHitDie() {
  const NpcCls = CONFIG?.Actor?.dataModels?.npc;
  if (!NpcCls?.prototype?.prepareDerivedData) {
    console.warn(`[${MODULE_ID}] NPC data model not found at setup — Max HP wrap skipped`);
    return;
  }
  const orig = NpcCls.prototype.prepareDerivedData;
  NpcCls.prototype.prepareDerivedData = function (...args) {
    const result = orig.apply(this, args);
    try {
      const actor = this.parent;
      const hitDie = actor?.flags?.[MODULE_ID]?.hitDie;
      if (hitDie == null) return result;          // no flag → leave system's value
      if (this.size === "small") return result;   // Small special-case unchanged

      // Resolve "fromSize" against the world setting at compute time.
      let resolved = hitDie;
      if (hitDie === "fromSize") {
        const map = game.settings.get(MODULE_ID, "hitDieSizeMap") ?? {};
        resolved = map[this.size] ?? "d8";
      }

      // If a token rolled fresh HP at spawn, the per-token total is parked
      // on `flags.vagabond-crawler.rolledMaxHp` — use it verbatim so Max HP
      // matches the rolled value (otherwise the user would see e.g. 36/32
      // instead of 36/36). World actors don't carry this flag, so they fall
      // through to the configured die's average.
      const rolled = Number(actor?.flags?.[MODULE_ID]?.rolledMaxHp);
      const sysBase = Math.floor(this.hd * 4.5);
      const ourBase = (Number.isFinite(rolled) && rolled > 0)
        ? rolled
        : Math.floor(this.hd * dieAvg(resolved));
      // The system added sysBase on top of any AE contributions. Swap it for
      // ours so AEs compose correctly: max = (max - sysBase) + ourBase.
      this.health.max = (this.health.max ?? 0) - sysBase + ourBase;
    } catch (err) {
      console.warn(`[${MODULE_ID}] Max HP wrap failed:`, err);
    }
    return result;
  };
}

Hooks.once("init", () => {
  // One-time migration flag — relic AEs converted to system-native
  // applicationMode + Strike I/II/III re-shaped to flag-based bonus dice.
  // V1 (v1.16.7) stamped applicationMode and dropped homemade equip-gating.
  // V2 (v1.16.7) replaced the Strike AE-changes with a bonusDamageDice flag
  // because the system's roll-data overlay can't carry dice strings.
  // The migrator runs every load until the V2 flag is set.
  game.settings.register(MODULE_ID, "relicAppModeMigrationV2", {
    scope: "world", config: false, type: Boolean, default: false
  });

  // Encounter table UUID
  game.settings.register(MODULE_ID, "encounterTableUuid", {
    scope: "world", config: false, type: String, default: ""
  });

  // Time Passes default minutes
  game.settings.register(MODULE_ID, "timePassesMinutes", {
    name: "Default Time Passes (minutes)",
    hint: "How many minutes advance when the Time Passes button is clicked.",
    scope: "world", config: false, type: Number, default: 10
  });

  // Crawl state persistence
  game.settings.register(MODULE_ID, "crawlState", {
    scope: "world", config: false, type: Object,
    default: { active: false, members: [], phase: "heroes", paused: false, turnCount: 0, elapsedMins: 0, clockId: null, clockFilled: 0 }
  });

  // Crawl clock configuration (persists across deletion / combat / new crawls)
  game.settings.register(MODULE_ID, "clockConfig", {
    scope: "world", config: false, type: Object,
    default: { size: "S", defaultPosition: "bottom-left" }
  });

  // Encounter roll result visibility
  game.settings.register(MODULE_ID, "encounterRollGMOnly", {
    name: "Encounter Roll: GM Only",
    hint: "If enabled, encounter check results are whispered to the GM only.",
    scope: "world", config: false, type: Boolean, default: true
  });

  // Auto-pause on rolled encounter — gives the GM a beat to prep before the
  // table is rolled / creatures are placed. Only the GM can pause, so this
  // only fires when a GM is driving the encounter check.
  game.settings.register(MODULE_ID, "pauseOnEncounter", {
    name: "Pause Game on Encounter Hit",
    hint: "When an encounter check rolls a hit, automatically pause the game so the GM can set up.",
    scope: "world", config: false, type: Boolean, default: true
  });

  // Encounter threshold (1-in-6 through 5-in-6) — UI via right-click popover
  game.settings.register(MODULE_ID, "encounterThreshold", {
    scope: "world", config: false, type: Number, default: 1
  });

  // Excluded RollTable folders (JSON array of folder IDs) — Encounter Roller
  game.settings.register(MODULE_ID, "excludedTableFolders", {
    scope: "world", config: false, type: String, default: "[]"
  });

  // Excluded RollTable folders — Loot Manager (separate from encounter exclusions)
  game.settings.register(MODULE_ID, "excludedLootTableFolders", {
    scope: "world", config: false, type: String, default: "[]"
  });

  // Hide NPC names in the strip (players only; GM always sees names)
  game.settings.register(MODULE_ID, "hideNpcNames", {
    name: "Hide NPC Names from Players",
    hint: "Players won't see NPC names on the crawl strip. The GM always sees them.",
    scope: "world", config: false, type: Boolean, default: false,
    onChange: () => { game.vagabondCrawler?.strip?.render(); },
  });

  // Hide NPC HP bar from players in the strip
  game.settings.register(MODULE_ID, "hideNpcHpBar", {
    name: "Hide NPC Health Bar from Players",
    hint: "Players won't see HP bars or values on NPC cards in the crawl strip. The GM still sees them.",
    scope: "world", config: false, type: Boolean, default: false,
    onChange: () => { game.vagabondCrawler?.strip?.render(); },
  });

  // Auto-remove defeated tokens from strip
  game.settings.register(MODULE_ID, "autoRemoveDefeated", {
    name: "Auto-Hide Defeated Tokens",
    hint: "Defeated tokens are hidden from the strip instead of showing a skull.",
    scope: "world", config: false, type: Boolean, default: false,
    onChange: () => { game.vagabondCrawler?.strip?.render(); },
  });

  // NPC Action Menu is always on — removed the per-world toggle. The hover
  // dropdown on NPC cards during combat is core UX; players can still only
  // trigger actions on actors they own (owner check inside the menu handler).

  // Flanking
  game.settings.register(MODULE_ID, "flankingEnabled", {
    name: "Flanking",
    hint: "Automatically apply Vulnerable when 2+ allies are Close to a foe that is no more than one size larger.",
    scope: "world", config: false, type: Boolean, default: true,
  });

  game.settings.register(MODULE_ID, "hitDieSizeMap", {
    name: "Hit Die Size Map",
    hint: "Default hit die per creature size. Edited via the Hit Die Configuration window.",
    scope: "world",
    config: false,
    type: Object,
    default: {
      medium:   "d6",
      large:    "d8",
      huge:     "d10",
      giant:    "d12",
      colossal: "d14",
    },
  });

  game.settings.register(MODULE_ID, "bestiaryHitDieFallback", {
    name: "Apply Hit Die Map to Bestiary NPCs",
    hint: "When ON, compendium NPCs without authored hit-die flags use the size→die map and roll fresh HP per spawn. When OFF, legacy bestiary drops keep the deterministic HD × 4.5 formula.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Saved custom relic powers — populated via the Relic Forge's "Save"
  // button on the Custom Power builder. Surfaced in the Power Database
  // under the "Custom" category for reuse on future relics.
  game.settings.register(MODULE_ID, "customRelicPowers", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu(MODULE_ID, "hitDieConfigMenu", {
    name:    "VAGABOND_CRAWLER.HitDieConfig.Title",
    label:   "VAGABOND_CRAWLER.HitDieConfig.OpenButton",
    hint:    "VAGABOND_CRAWLER.HitDieConfig.MenuHint",
    icon:    "fas fa-dice",
    type:    HitDieConfigApp,
    restricted: true,
  });

  // Register all sub-module settings
  AnimationFx.registerSettings();
  MovementTracker.registerSettings();
  LightTracker.registerSettings();
  ItemDrops.registerSettings();
  LootDrops.registerSettings();
  LootManager.registerSettings();
  LootTracker.registerSettings();
  SessionRecap.registerSettings();
  CountdownRoller.registerSettings();
  MerchantShop.registerSettings();

  // Real-time light burn
  game.settings.register(MODULE_ID, "realtimeTracking", {
    name: "Real-Time Light Burn",
    hint: "Burn light sources in real time (1 real second = 1 game second). Pauses when Foundry is paused. If disabled, light only burns when Time Passes is clicked.",
    scope: "world", config: false, type: Boolean, default: false,
    onChange: (val) => {
      // game.vagabondCrawler exposes the singleton under `lightTracker` (and
      // `light` alias); the previous `LightTracker` destructure was always
      // undefined so toggling the setting silently no-op'd.
      const lt = game.vagabondCrawler?.lightTracker;
      if (!lt) return;
      val ? lt.startRealTime() : lt.stopRealTime();
    },
  });

  // Register the 7 submenu buttons (Light, Encounter, Crawl Strip, Combat,
  // Movement, Loot & Merchant, Animation FX) — must be after all settings
  // are registered.
  registerSettingsGroupMenus();

  // Register Handlebars helpers for template conditionals
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
  if (!Handlebars.helpers.or) {
    Handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(x => !!x));
  }

  // Preload templates
  foundry.applications.handlebars.loadTemplates([
    "modules/vagabond-crawler/templates/animation-fx-config.hbs",
    "modules/vagabond-crawler/templates/animation-fx-override.hbs",
    "modules/vagabond-crawler/templates/light-sources-config.hbs",
  ]);

  console.log(`${MODULE_ID} | Initialized.`);
});

// ── Relic AE migration (one-time, GM-run) ────────────────────────────────────
//
// Pre-1.16.7 relic AEs used Crawler's homemade equip-gating: `disabled:
// !system.equipped` toggled on `updateItem`, with our own `equipGated` flag.
// 1.16.7 hands gating to the Vagabond system via `flags.vagabond.applicationMode`
// — the system already filters effects by 'permanent' / 'when-equipped' /
// 'on-use'.
//
// 1.16.7 also re-shaped Strike I/II/III to flag-based on-use because the
// system's roll-data overlay does numeric ADD on rollData fields and can't
// carry dice strings (Number('1d4') = NaN).
//
// This pass walks every owned and world-level forged item and:
//   - Stamps `flags.vagabond.applicationMode` onto each relic AE (from the
//     catalog), and clears Crawler's homemade `disabled:!equipped` gate.
//   - For Strike I/II/III: drops the AE `changes` and adds the
//     `bonusDamageDice` flag so the damage-helper patch can inject the
//     dice at roll time.
// Gated by the relicAppModeMigrationV2 setting — runs once per world.
async function _migrateRelicApplicationModes() {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, "relicAppModeMigrationV2")) return;

  const allItems = [];
  for (const it of game.items)             allItems.push(it);
  for (const a of game.actors)
    for (const it of a.items)              allItems.push(it);

  const STRIKE_IDS = new Set(["strike-1", "strike-2", "strike-3"]);

  let migratedItems = 0;
  let migratedEffects = 0;
  for (const item of allItems) {
    const forged = item.getFlag(MODULE_ID, "relicForge")?.forged;
    if (!forged) continue;

    const updates = [];
    for (const eff of item.effects) {
      const moduleFlags = eff.flags?.[MODULE_ID];
      if (!moduleFlags?.relicPower) continue;

      const power = getRelicPower(moduleFlags.relicPower);
      const mode  = power?.applicationMode || 'when-equipped';
      const update = { _id: eff.id, disabled: false };
      let dirty = false;

      // Stamp applicationMode if missing or stale
      if (eff.flags?.vagabond?.applicationMode !== mode) {
        update.flags = update.flags || {};
        update.flags.vagabond = { applicationMode: mode };
        dirty = true;
      }

      // Strike re-shape: empty changes + bonusDamageDice flag
      if (STRIKE_IDS.has(moduleFlags.relicPower)) {
        const expectedDice = power?.flags?.bonusDamageDice;
        const hasOldChanges = (eff.changes?.length ?? 0) > 0;
        const hasNewFlag    = !!eff.flags?.[MODULE_ID]?.bonusDamageDice;
        if (hasOldChanges || (!hasNewFlag && expectedDice)) {
          update.changes = [];
          update.flags = update.flags || {};
          update.flags[MODULE_ID] = {
            ...(eff.flags?.[MODULE_ID] ?? {}),
            bonusDamageDice:  expectedDice,
            bonusDamageLabel: power?.flags?.bonusDamageLabel || "Striking",
          };
          dirty = true;
        }
      }

      if (dirty) updates.push(update);
    }
    if (updates.length) {
      try {
        await item.updateEmbeddedDocuments("ActiveEffect", updates);
        migratedItems   += 1;
        migratedEffects += updates.length;
      } catch (err) {
        console.warn(`${MODULE_ID} | Migration failed on ${item.name}:`, err);
      }
    }
  }

  await game.settings.set(MODULE_ID, "relicAppModeMigrationV2", true);
  if (migratedEffects > 0) {
    const msg = `Vagabond Crawler: migrated ${migratedEffects} relic effect${migratedEffects === 1 ? "" : "s"} on ${migratedItems} item${migratedItems === 1 ? "" : "s"} to system-native application modes.`;
    console.log(`${MODULE_ID} | ${msg}`);
    ui.notifications.info(msg);
  }
}

// ── Ready ─────────────────────────────────────────────────────────────────────

Hooks.once("ready", async () => {
  // Expose globals for console debugging
  game.vagabondCrawler = {
    state:     CrawlState,
    bar:       CrawlBar,
    strip:     CrawlStrip,
    movement:  MovementTracker,
    encounter: EncounterTools,
    morale:    MoraleChecker,
    rest:      RestBreather,
    light:        LightTracker,
    lightTracker: LightTracker,
    clock:     CrawlClock,
    flanking:  FlankingChecker,
    hitDieConfig: HitDieConfig,
    itemDrops: ItemDrops,
    lootDrops: LootDrops,
    relicForge: RelicForge,
    relicEffects: RelicEffects,
    lootManager: LootManager,
    lootTracker: LootTracker,
    lootGenerator: LootGenerator,
    countdownRoller: CountdownRoller,
    scrollForge: ScrollForge,
    enchantmentScroll: EnchantmentScroll,
    merchantShop: MerchantShop,
    partyInventory: PartyInventory,
    monsterCreator: MonsterCreator,
    recap: SessionRecap,
    animationFx: AnimationFx,
    stackSplit: StackSplit,
    debugCombat: () => {
      const combat = game.combat;
      if (!combat) return "No active combat";
      return combat.combatants.map(c => ({
        name:       c.name,
        initiative: c.initiative,
        defeated:   c.defeated,
        hidden:     c.hidden,
        flags:      c.flags,
        systemKeys: c.system ? Object.keys(c.system) : [],
        system:     c.system,
      }));
    },
    debugSpeed: () => {
      const token = canvas.tokens?.controlled[0];
      if (!token?.actor) return "No token selected";
      const s = token.actor.system.speed;
      return { actorName: token.actor.name, speed: s, allSpeedKeys: Object.keys(s ?? {}) };
    },
    // Lazy-loaded smoke-test runner. Test code never imports until the GM
    // calls `game.vagabondCrawler.test.run()`, so production sessions stay
    // clean. See scripts/test/index.mjs.
    test: {
      async run(filter = null) {
        const mod = await import("./test/index.mjs");
        return mod.run(filter);
      },
      async sweep() {
        const mod = await import("./test/index.mjs");
        return mod.sweep();
      },
    },
  };

  // Public API for cross-module integration (vgbnd-importer, etc.). Stable
  // surface — change here only with a version bump and changelog note.
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      forgeItem:        RelicForge.forgeItem.bind(RelicForge),
      computeRelicName: RelicForge.computeRelicName.bind(RelicForge),
      getRelicPower,
      getPowersByCategory,
      RELIC_POWERS,
      METAL_DISPLAY_NAMES,
    };
  }

  // Token HP override on spawn — the system's prepareDerivedData clobbers
  // actor.system.health.max using HD * 4.5, so we must override the token's
  // delta on creation to make the configured hit-die actually stick at runtime.
  // The hook runs synchronously: preCreateToken's updateSource() must land
  // before the document is finalized, so we roll manually rather than via
  // Roll.evaluate() (which is async and finalizes too late). The chat-message
  // whisper is fired-and-forgotten after the source update lands.
  if (game.user.isGM) {
    Hooks.on("preCreateToken", (tokenDoc, _data, _options, _userId) => {
      try {
        const actor = tokenDoc.actor;
        if (!actor) return;
        if (actor.type === "character") return;
        if (tokenDoc.actorLink === true) return; // shared HP — never override

        const { hasOverride, rollOnSpawn, die } = resolveHitDieConfig(actor);
        if (!hasOverride) return;

        const hd   = Number(actor.system?.hd) || 0;
        const size = actor.system?.size ?? "medium";

        let total;
        let formula = null;
        let resultsText = "";

        if (size === "small") {
          // Small never rolls — HP = max(1, HD) regardless of die or roll flag
          total = Math.max(1, hd);
        } else if (rollOnSpawn) {
          if (hd <= 0) return;
          const m = String(die).match(/^d(\d+)$/i);
          const sides = m ? parseInt(m[1], 10) : 8;
          if (!Number.isFinite(sides) || sides < 2) return;
          formula = `${hd}${die}`;
          const dice = [];
          let sum = 0;
          for (let i = 0; i < hd; i++) {
            const v = Math.floor(Math.random() * sides) + 1;
            dice.push(v);
            sum += v;
          }
          total = sum;
          if (dice.length) resultsText = ` [${dice.join(", ")}]`;
        } else {
          // Static deterministic — override max so the configured die's
          // average wins over the system's HD * 4.5 recompute.
          total = Math.round(calculateHP(hd, size, die) ?? 0);
          if (!Number.isFinite(total) || total <= 0) return;
        }

        // Stamp the resolved total into the token's actor delta. We also
        // park it on a flag — the system's prepareBaseData zeroes
        // health.max every load and prepareDerivedData rebuilds it from HD,
        // so a delta on system.health.max wouldn't survive. The wrap in
        // setup reads `flags.vagabond-crawler.rolledMaxHp` and uses it
        // verbatim instead of recomputing the avg.
        tokenDoc.updateSource({
          "delta.system.health.value": total,
          "delta.system.health.max":   total,
          [`delta.flags.${MODULE_ID}.rolledMaxHp`]: total,
        });

        if (rollOnSpawn && formula) {
          ChatMessage.create({
            whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
            content: `<i>${actor.name}</i> spawned with <b>${total} HP</b> (rolled ${formula}${resultsText}).`,
          });
        }
      } catch (err) {
        console.warn("[vagabond-crawler] preCreateToken HP override failed:", err);
      }
    });
  }

  // Restore crawl state if it was active when the world was last closed
  await CrawlState.restore();

  // Mount the bottom bar (GM only)
  if (game.user.isGM) {
    CrawlBar.mount();
  }

  // Mount the top strip (all users, visibility controlled by CrawlState)
  CrawlStrip.mount();

  // Start movement tracker hooks
  MovementTracker.init();

  // Start morale hooks
  MoraleChecker.init();

  // Start flanking checker
  FlankingChecker.init();

  // NPC passive ability hooks (Magic Ward, etc.)
  registerMagicWardHook();

  // Chat damage dice tooltips
  registerChatTooltips();

  // Item drops, loot drops, relic forge
  ItemDrops.init();
  LootDrops.init();
  MonsterCreator.init();
  RelicForge.init();
  RelicEffects.init();
  // One-time migration: stamp `flags.vagabond.applicationMode` onto every
  // pre-existing relic AE so the system-native filter (permanent /
  // when-equipped / on-use) takes over from Crawler's old `disabled:!equipped`
  // gating. See _migrateRelicApplicationModes for the per-power mapping.
  await _migrateRelicApplicationModes();
  EnchantmentScroll.init();
  LootManager.init();
  LootTracker.init();
  LootGenerator.init();

  // Countdown dice auto-roller
  CountdownRoller.init();

  // Merchant shop
  MerchantShop.init();

  // Session recap
  SessionRecap.init();

  // Animation FX subsystem
  await AnimationFx.init();

  // XP questionnaire counter patch (replaces checkboxes with numeric counters)
  XpCounterPatch.init();

  // Start light tracker + real-time engine if enabled
  LightTracker.init();
  if (game.user.isGM && game.settings.get(MODULE_ID, "realtimeTracking")) {
    LightTracker.startRealTime();
  }

  // Stack split/merge gestures on the inventory grid
  StackSplit.init();

  // Inventory grid numbering — keep the free-cell numbers in step with the
  // quantity-aware slot count the header shows. See renumberInventoryGrid().
  await _wrapInventoryGrid();

  // "Gather Friendlies" — DEPRECATED. Replaced by VCE's GatherCompanions
  // (scripts/companion/gather-companions.mjs in vagabond-character-enhancer).
  // The VCE version uses the Party-Token snapshot pattern (compress/release)
  // scoped to VCE-flagged companions. Only init the crawler version if VCE
  // isn't active, so standalone crawler installs still get the legacy feature.
  if (!game.modules.get("vagabond-character-enhancer")?.active) {
    GatherFriendlies.init();
  }

  // Auto-stack items: when adding an item that already exists, merge quantities.
  // Uses StackSplit.sameStackIdentity so the "what counts as the same stack"
  // rule lives in one place (shared with the drag-onto merge gesture).
  Hooks.on("preCreateItem", (item, data, options, userId) => {
    if (userId !== game.userId) return;
    if (options?.skipStack) return;       // bypass when splitting stacks
    const actor = item.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (!item.system?.quantity) return;   // no quantity field (non-equipment)

    const existing = actor.items.find(i =>
      i.id !== item.id
      && i.system?.quantity != null
      && StackSplit.sameStackIdentity(i, item)
    );
    if (!existing) return;

    // Merge: add incoming quantity to existing, cancel creation
    const addQty = item.system.quantity || 1;
    const newQty = (existing.system.quantity || 1) + addQty;
    existing.update({ "system.quantity": newQty });
    ui.notifications.info(`${item.name} ×${addQty} → stacked (×${newQty} total).`);
    return false;  // prevent the new item from being created
  });

  // Inventory quantity badges — inject "×N" on cards where quantity > 1
  // ApplicationV2 sheets fire render{ClassName} hooks, not renderActorSheet.
  // Inventory stacking: quantity badge on cards + correct .slot-value count
  const _patchInventory = (sheet) => {
    const el = sheet.element;
    if (!el) return;
    const actor = sheet.actor;
    if (!actor) return;

    // 1. Inject ×N badges on inventory cards
    for (const card of el.querySelectorAll(".inventory-card")) {
      const item = actor.items.get(card.dataset.itemId);
      const qty = item?.system?.quantity;
      if (!qty || qty <= 1) continue;
      if (card.querySelector(".vcb-qty-badge")) continue;
      const badge = document.createElement("div");
      badge.className = "vcb-qty-badge";
      badge.textContent = `×${qty}`;
      card.appendChild(badge);
    }

    // 2. Fix .slot-value "X / Y" — stacked + pooled extras the system doesn't count
    //    See getExtraOccupiedSlots() at the top of this file for the math.
    const extraSlots = getExtraOccupiedSlots(actor);
    if (!extraSlots) return;
    const slotValue = el.querySelector(".slot-value");
    if (!slotValue) return;
    const match = slotValue.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const newOccupied = getTotalOccupiedSlots(actor) ?? (parseInt(match[1]) + extraSlots);
      const max = parseInt(match[2]);
      slotValue.textContent = `${newOccupied} / ${max}`;
      // System's Handlebars sets `.overloaded` on `.slot-field` from its own
      // occupiedSlots calc which doesn't account for stacked / pooled extras.
      // Re-evaluate against our adjusted total so stacked overflow turns red.
      const slotField = slotValue.closest(".slot-field");
      if (slotField) slotField.classList.toggle("overloaded", newOccupied > max);

      // Same story for the "Inventory is full / Rush action" banner — gated
      // by `{{#if isOverloaded}}` in features.hbs so it's missing from the DOM
      // when the system thinks we're under capacity. Inject (or update) it.
      if (newOccupied > max) {
        const overloadAmount = newOccupied - max;
        const msg = `Your Inventory is full, you can't take the Rush action. (+${overloadAmount} slots beyond capacity)`;
        let warning = el.querySelector(".inventory-overload-warning");
        if (warning) {
          const span = warning.querySelector("span");
          if (span) span.textContent = msg;
        } else {
          const gridContainer = el.querySelector(".inventory-grid-container");
          if (gridContainer) {
            warning = document.createElement("div");
            warning.className = "inventory-overload-warning";
            warning.innerHTML = `<i class="fas fa-exclamation-triangle"></i><span></span>`;
            warning.querySelector("span").textContent = msg;
            gridContainer.appendChild(warning);
          }
        }
      }
    }
  };
  Hooks.on("renderVagabondCharacterSheet", _patchInventory);
  Hooks.on("renderVagabondNPCSheet", _patchInventory);
  Hooks.on("renderActorSheet", _patchInventory);  // fallback

  // Character HUD slot counter — the system's `character-hud.hbs` prints
  // `{{system.inventory.occupiedSlots}}/{{system.inventory.maxSlots}}` straight
  // off the actor and never routes through `prepareInventoryGrid`, so the grid
  // wrap does NOT reach it. Correct the rendered text so the HUD agrees with the
  // sheet instead of quietly showing the system's unadjusted number.
  const _patchHudSlots = (app, element) => {
    const actor = app?.actor;
    if (!actor) return;
    const total = getTotalOccupiedSlots(actor);
    if (total == null) return;
    const root = element instanceof HTMLElement ? element : app.element;
    const title = root?.querySelector?.(".vh-inv-header-title");
    if (!title) return;
    const max = actor.system.inventory.maxSlots;
    // Label is localized and precedes the count — rewrite only the "N/M" part.
    const next = title.textContent.replace(/\d+\s*\/\s*\d+/, `${total}/${max}`);
    if (next !== title.textContent) title.textContent = next;
  };
  Hooks.on("renderVagabondCharacterHud", _patchHudSlots);

  // Scroll context menu: "Use Scroll" entry on spell scroll items
  const _attachScrollCtx = (sheet) => {
    const el = sheet.element;
    if (!el) return;
    const actor = sheet.actor;
    if (!actor) return;
    for (const card of el.querySelectorAll(".inventory-card")) {
      if (card.dataset.vcscrBound) continue;
      const item = actor.items.get(card.dataset.itemId);
      if (!item || !ScrollForge.isScroll(item)) continue;
      card.dataset.vcscrBound = "1";
      card.addEventListener("contextmenu", () => {
        let attempts = 0;
        const poll = setInterval(() => {
          const menu = document.querySelector(".inventory-context-menu");
          if (menu) {
            clearInterval(poll);
            if (menu.querySelector(".vcscr-ctx-item")) return;
            const entry = document.createElement("div");
            entry.className = "context-menu-item vcscr-ctx-item";
            entry.innerHTML = `<i class="fas fa-scroll"></i><span>Use Scroll</span>`;
            entry.addEventListener("click", async ev => {
              ev.stopPropagation();
              menu.remove();
              await ScrollForge.useScroll(item);
            });
            menu.insertBefore(entry, menu.firstChild);
          } else if (++attempts >= 10) {
            clearInterval(poll);
          }
        }, 10);
      });
    }
  };
  Hooks.on("renderVagabondCharacterSheet", _attachScrollCtx);
  Hooks.on("renderVagabondNPCSheet", _attachScrollCtx);
  Hooks.on("renderActorSheet", _attachScrollCtx);

  // Enchantment Scroll context menu: "Use Scroll" on +N Enchantment Scroll items
  const _attachEnchantCtx = (sheet) => {
    const el = sheet.element;
    if (!el) return;
    const actor = sheet.actor;
    if (!actor) return;
    for (const card of el.querySelectorAll(".inventory-card")) {
      if (card.dataset.vcEnchBound) continue;
      const item = actor.items.get(card.dataset.itemId);
      if (!item || !EnchantmentScroll.isEnchantmentScroll(item)) continue;
      card.dataset.vcEnchBound = "1";
      card.addEventListener("contextmenu", () => {
        let attempts = 0;
        const poll = setInterval(() => {
          const menu = document.querySelector(".inventory-context-menu");
          if (menu) {
            clearInterval(poll);
            if (menu.querySelector(".vc-ench-ctx-item")) return;
            const entry = document.createElement("div");
            entry.className = "context-menu-item vc-ench-ctx-item";
            entry.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i><span>Use Enchantment Scroll</span>`;
            entry.addEventListener("click", async ev => {
              ev.stopPropagation();
              menu.remove();
              await EnchantmentScroll.useScroll(item);
            });
            menu.insertBefore(entry, menu.firstChild);
          } else if (++attempts >= 10) {
            clearInterval(poll);
          }
        }, 10);
      });
    }
  };
  Hooks.on("renderVagabondCharacterSheet", _attachEnchantCtx);
  Hooks.on("renderVagabondNPCSheet", _attachEnchantCtx);
  Hooks.on("renderActorSheet", _attachEnchantCtx);

  // Junk marking: "Mark as Junk" / "Unmark Junk" context menu on equipment items
  const _attachJunkCtx = (sheet) => {
    const el = sheet.element;
    if (!el) return;
    const actor = sheet.actor;
    if (!actor) return;
    for (const card of el.querySelectorAll(".inventory-card")) {
      if (card.dataset.vcJunkBound) continue;
      const item = actor.items.get(card.dataset.itemId);
      if (!item || item.type !== "equipment") continue;
      card.dataset.vcJunkBound = "1";

      // Visual junk indicator
      if (item.getFlag(MODULE_ID, "junk")) {
        card.style.opacity = "0.5";
        card.style.borderLeft = "3px solid #e74c3c";
      }

      card.addEventListener("contextmenu", () => {
        let attempts = 0;
        const poll = setInterval(() => {
          const menu = document.querySelector(".inventory-context-menu");
          if (menu) {
            clearInterval(poll);
            if (menu.querySelector(".vc-junk-ctx-item")) return;
            const isJunk = !!item.getFlag(MODULE_ID, "junk");
            const entry = document.createElement("div");
            entry.className = "context-menu-item vc-junk-ctx-item";
            entry.innerHTML = isJunk
              ? `<i class="fas fa-recycle"></i><span>Unmark Junk</span>`
              : `<i class="fas fa-trash-can"></i><span>Mark as Junk</span>`;
            entry.addEventListener("click", async ev => {
              ev.stopPropagation();
              menu.remove();
              if (isJunk) {
                await item.unsetFlag(MODULE_ID, "junk");
              } else {
                await item.setFlag(MODULE_ID, "junk", true);
              }
            });
            menu.insertBefore(entry, menu.firstChild);
          } else if (++attempts >= 10) {
            clearInterval(poll);
          }
        }, 10);
      });
    }
  };
  Hooks.on("renderVagabondCharacterSheet", _attachJunkCtx);
  Hooks.on("renderActorSheet", _attachJunkCtx);

  // "True Zero Slot" checkbox on item sheets — items flagged skip the 10-per-slot rule
  const _injectTrueZeroSlot = (sheet) => {
    const item = sheet.item ?? sheet.document;
    if (!item?.system) return;
    const baseSlots = item.system.slots || item.system.baseSlots || 0;
    if (baseSlots !== 0) return;  // only show on zero-slot items (or items without a slots field)
    const el = sheet.element;
    if (!el || el.querySelector(".vcb-true-zero-slot")) return;

    // Find the baseSlots input to inject near it
    const slotsInput = el.querySelector("input[name='system.baseSlots']");
    if (!slotsInput) return;
    const container = slotsInput.closest(".stat-pair, .resource-group, .form-group") ?? slotsInput.parentElement;

    const wrapper = document.createElement("label");
    wrapper.className = "vcb-true-zero-slot";
    wrapper.style.cssText = "display:flex; align-items:center; gap:4px; font-size:11px; margin-top:4px; cursor:pointer;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!item.getFlag(MODULE_ID, "trueZeroSlot");
    cb.addEventListener("change", () => item.setFlag(MODULE_ID, "trueZeroSlot", cb.checked));
    wrapper.appendChild(cb);
    wrapper.appendChild(document.createTextNode("Weightless (no slot cost)"));
    container.after(wrapper);
  };
  Hooks.on("renderVagabondItemSheet", _injectTrueZeroSlot);
  Hooks.on("renderItemSheet", _injectTrueZeroSlot);

  console.log(`${MODULE_ID} | Ready.`);
});


// !recap chat command — opens session recap for any user
Hooks.on("chatMessage", (chatLog, message) => {
  if (message.trim().toLowerCase() === "!recap") {
    SessionRecap.open();
    return false;
  }
});

Hooks.once("ready", () => {
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    if (data.action === "syncState") {
      await CrawlState.applySync(data.state);
    }
    if (data.action === "syncLights") {
      await LightTracker.applySync(data.lights);
    }
    if (data.action === "rollbackMove" && game.user.isGM) {
      await MovementTracker.rollback(data.tokenId);
    }
    // Item Drops and Loot Drops register their own socket handlers in init()
  });
});
