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
import { GatherFriendlies } from "./gather-friendlies.mjs";
import { registerSettingsGroupMenus } from "./settings-group-app.mjs";

export const MODULE_ID = "vagabond-crawler";

// ── Settings ──────────────────────────────────────────────────────────────────

// ── Setup: wrap buildAndEvaluateD20WithRollData BEFORE vagabond-character-enhancer ──
// VCE wraps the same function in its "ready" hook. Wrapping in "setup" ensures
// our wrap is captured as VCE's orig → VCE becomes outermost, we become innermost.
// This is required so our Nimble clamp sees the FINAL favorHinder after VCE has
// applied its `_rangeFavorHinder` combine.
Hooks.once("setup", () => {
  registerEarlyRollBuilderWrap();
});

Hooks.once("init", () => {
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
      const { LightTracker } = game.vagabondCrawler ?? {};
      if (!LightTracker) return;
      val ? LightTracker.startRealTime() : LightTracker.stopRealTime();
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
  };

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

    // 2. Fix .slot-value "X / Y"
    //    - Stacked items (qty > 1, slots > 0): system only counts 1× slots, add the rest
    //    - Zero-slot items: pool by gearCategory, every 10 units in a group = 1 slot
    //      e.g. 3× Scroll of Fade + 3× Scroll of Life + 4× Scroll of Ward = 10 "Scrolls" = 1 slot
    let extraSlots = 0;
    const INV_TYPES = new Set(["equipment", "weapon"]);
    const zeroSlotGroups = new Map();  // gearCategory|name → total qty
    for (const item of actor.items) {
      if (!item.system || !INV_TYPES.has(item.type)) continue;
      const baseSlots = item.system.slots || item.system.baseSlots || 0;
      const qty = item.system.quantity ?? 1;
      if (baseSlots === 0 && qty > 0) {
        // Skip items flagged as truly weightless
        if (item.getFlag(MODULE_ID, "trueZeroSlot")) continue;
        // Group by gearCategory; fall back to item name if no category
        const group = item.system.gearCategory || item.name;
        zeroSlotGroups.set(group, (zeroSlotGroups.get(group) || 0) + qty);
      } else if (qty > 1) {
        extraSlots += baseSlots * (qty - 1);
      }
    }
    for (const total of zeroSlotGroups.values()) {
      extraSlots += Math.ceil(total / 10);
    }

    if (!extraSlots) return;
    const slotValue = el.querySelector(".slot-value");
    if (!slotValue) return;
    const match = slotValue.textContent.match(/(\d+)(\s*\/\s*\d+)/);
    if (match) {
      slotValue.textContent = `${parseInt(match[1]) + extraSlots}${match[2]}`;
    }
  };
  Hooks.on("renderVagabondCharacterSheet", _patchInventory);
  Hooks.on("renderVagabondNPCSheet", _patchInventory);
  Hooks.on("renderActorSheet", _patchInventory);  // fallback

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
