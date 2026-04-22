/**
 * Vagabond Crawler — Settings Group Config Window
 *
 * One ApplicationV2 class driven by a group spec. Each of the 7 groups (Light,
 * Encounter, Crawl Strip, Combat, Movement, Loot & Merchant, Animation FX)
 * gets a subclass baked at registration time, and a button in Foundry's
 * module settings panel via registerMenu. The individual settings themselves
 * are marked config:false so they only surface inside these submenus, not as
 * 28 scattered rows in the main panel.
 *
 * World settings are read-only for non-GMs; client settings are always
 * editable by the logged-in user. The submenu is visible to everyone — the
 * per-field gating handles role-based permissions.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = "vagabond-crawler";

export const SETTINGS_GROUPS = {
  // ── GM-only groups (world settings) ─────────────────────────────────────
  light: {
    title: "Light & Time",
    icon: "fa-solid fa-sun",
    hint: "Time Passes cadence and real-time light-burn behavior.",
    settings: ["timePassesMinutes", "realtimeTracking"],
    restricted: true,
  },
  encounter: {
    title: "Encounters",
    icon: "fa-solid fa-dice-d6",
    hint: "Encounter-check visibility and auto-pause behavior.",
    settings: ["encounterRollGMOnly", "pauseOnEncounter"],
    restricted: true,
  },
  strip: {
    title: "Crawl Strip",
    icon: "fa-solid fa-users",
    hint: "What players see on the top HUD strip (names, HP, defeated tokens).",
    settings: ["hideNpcNames", "hideNpcHpBar", "autoRemoveDefeated"],
    restricted: true,
  },
  combat: {
    title: "Combat",
    icon: "fa-solid fa-khanda",
    hint: "Combat automation toggles — flanking, countdown dice.",
    settings: ["flankingEnabled", "countdownAutoRoll"],
    restricted: true,
  },
  movement: {
    title: "Movement",
    icon: "fa-solid fa-person-running",
    hint: "Movement-budget enforcement during crawl and combat.",
    settings: ["enforceCrawlMovement", "enforceCombatMovement", "enforceNpcMovement"],
    restricted: true,
  },
  loot: {
    title: "Loot & Merchant",
    icon: "fa-solid fa-sack-dollar",
    hint: "Item drops, loot-bag generation, and merchant pricing.",
    settings: ["itemDropsEnabled", "lootDropEnabled", "lootDropChance", "shopSellRatio", "shopName"],
    restricted: true,
  },

  // Animation FX (per-client) controls — animationFxEnabled, Sound, Volume —
  // are surfaced directly in the main Foundry module settings panel (config:
  // true in animation-fx.mjs), not via a submenu. The full preset editor
  // stays GM-only in AnimationFxConfigApp via animationFxConfigMenu.
};

export class SettingsGroupApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static GROUP_KEY = null;

  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-settings-group",
    classes: ["vagabond-crawler", "vcb-settings-group"],
    tag: "form",
    window: { title: "Settings", resizable: false },
    position: { width: 560 },
    form: {
      handler: SettingsGroupApp._onSubmit,
      closeOnSubmit: true,
      submitOnChange: false,
    },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/settings-group-app.hbs" },
  };

  get title() {
    return SETTINGS_GROUPS[this.constructor.GROUP_KEY]?.title ?? "Settings";
  }

  async _prepareContext() {
    const group = SETTINGS_GROUPS[this.constructor.GROUP_KEY];
    if (!group) return { fields: [], groupTitle: "" };

    const fields = group.settings.map((key) => {
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if (!setting) return null;
      const value   = game.settings.get(MODULE_ID, key);
      const canEdit = setting.scope === "client" || game.user.isGM;
      const isBool    = setting.type === Boolean;
      const isNumber  = setting.type === Number;
      const hasChoices = !!setting.choices;
      const choices = hasChoices
        ? Object.entries(setting.choices).map(([v, l]) => ({
            value: v,
            label: typeof l === "string" ? (game.i18n?.has?.(l) ? game.i18n.localize(l) : l) : String(l),
            selected: String(v) === String(value),
          }))
        : null;
      return {
        key,
        name:       setting.name ?? key,
        hint:       setting.hint ?? "",
        value,
        canEdit,
        scopeTag:   setting.scope === "client" ? "per-client" : (canEdit ? "world" : "GM only"),
        isCheckbox: isBool,
        isNumber:   isNumber && !hasChoices,
        isSelect:   hasChoices,
        isString:   !isBool && !isNumber && !hasChoices,
        choices,
      };
    }).filter(Boolean);

    return {
      groupTitle: group.title,
      groupHint:  group.hint ?? "",
      fields,
    };
  }

  static async _onSubmit(event, form, formData) {
    const data  = foundry.utils.expandObject(formData.object);
    const group = SETTINGS_GROUPS[this.constructor.GROUP_KEY];
    if (!group) return;
    let changed = 0;
    for (const key of group.settings) {
      if (!(key in data)) continue;
      const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
      if (!setting) continue;
      if (setting.scope === "world" && !game.user.isGM) continue;
      let next = data[key];
      if (setting.type === Boolean)      next = !!next;
      else if (setting.type === Number)  next = Number(next);
      else                                next = String(next ?? "");
      const current = game.settings.get(MODULE_ID, key);
      if (current === next) continue;
      await game.settings.set(MODULE_ID, key, next);
      changed++;
    }
    if (changed) ui.notifications.info(`${group.title}: ${changed} setting${changed === 1 ? "" : "s"} updated.`);
  }
}

/**
 * Build a subclass that bakes in the GROUP_KEY. Foundry's registerMenu wants
 * a distinct class per menu, so each group gets its own.
 */
function _makeGroupSubclass(key) {
  const group = SETTINGS_GROUPS[key];
  const cls = class extends SettingsGroupApp {
    static GROUP_KEY = key;
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
      SettingsGroupApp.DEFAULT_OPTIONS,
      {
        id: `vagabond-crawler-settings-${key}`,
        window: { title: group.title },
      },
      { inplace: false },
    );
  };
  // Give the class a readable name for debugging
  Object.defineProperty(cls, "name", { value: `SettingsGroup_${key}` });
  return cls;
}

/**
 * Register one button per group in the Foundry module settings panel.
 * Call once during the init hook AFTER all individual settings are registered.
 */
export function registerSettingsGroupMenus() {
  for (const key of Object.keys(SETTINGS_GROUPS)) {
    const group = SETTINGS_GROUPS[key];
    const cls   = _makeGroupSubclass(key);
    game.settings.registerMenu(MODULE_ID, `menu-${key}`, {
      name:       group.title,
      label:      `Configure ${group.title}`,
      hint:       group.hint ?? `Configure ${group.title.toLowerCase()} settings.`,
      icon:       group.icon,
      type:       cls,
      restricted: group.restricted ?? true,  // default to GM-only; flip via the group spec
    });
  }
}
