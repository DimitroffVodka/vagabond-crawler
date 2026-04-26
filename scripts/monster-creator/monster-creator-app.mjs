/**
 * Vagabond Crawler — Monster Creator (Phase 1: skeleton + save + bestiary load)
 *
 * ApplicationV2 window for authoring a new NPC from scratch or by starting
 * from a bestiary monster. Saves as a world actor with the full Vagabond
 * `npc` system shape so the sheet renders immediately.
 *
 * Scope (phase 1):
 *   - Basic-info form: identity, stats, movement, resistances, description
 *   - Portrait + Token file pickers (separate images; no Tokenizer yet)
 *   - Load-from-bestiary dropdown pre-fills the form from a compendium NPC
 *   - Save creates a new world actor — never modifies the compendium
 *   - Live HP + TL preview as fields change
 *
 * Out of scope (later phases):
 *   - Actions editor + quick-pick / catalog templates (phase 2)
 *   - Abilities editor with automation-status badges (phase 3)
 *   - Mutations panel + "Edit in Creator" handoff (phase 4)
 *   - Tokenizer integration + JSON import/export (phase 5)
 */

import { MODULE_ID } from "../vagabond-crawler.mjs";
import { calculateHP, calculateTL, calculateDPR, applyMutations, generateMutatedName, getStatSummary } from "../monster-mutator.mjs";
import { MUTATIONS, getMutation, getConflict, getBoons, getBanes } from "../mutation-data.mjs";
import { PASSIVE_ABILITIES } from "../npc-abilities.mjs";
import { STATUS_IDS, STATUS_LABELS } from "../audit/status-vocabulary.mjs";

/** Lazy-loaded dataset of every unique ability across the compendium,
 *  sourced from the committed audit files (`docs/audit/abilities.json` +
 *  `monsters.json`). Loaded once per session, then reused.
 *
 *  Shape returned:
 *  {
 *    abilities: [{ name, representativeText, automationStatus, monsterNames: [string] }],
 *    monsterNameByUuid: Map<uuid, name>,
 *    loaded: boolean,
 *  }
 */
let _auditAbilitiesCache = null;
async function _getAuditAbilities() {
  if (_auditAbilitiesCache) return _auditAbilitiesCache;
  _auditAbilitiesCache = { abilities: [], monsterNameByUuid: new Map(), loaded: false };
  try {
    const base = "modules/vagabond-crawler/docs/audit";
    const [monstersResp, abilitiesResp] = await Promise.all([
      fetch(`${base}/monsters.json`),
      fetch(`${base}/abilities.json`),
    ]);
    if (!monstersResp.ok || !abilitiesResp.ok) return _auditAbilitiesCache;
    const monstersJson  = await monstersResp.json();
    const abilitiesJson = await abilitiesResp.json();
    const byUuid = new Map();
    for (const m of (monstersJson.monsters ?? [])) byUuid.set(m.uuid, m.name);
    _auditAbilitiesCache = {
      monsterNameByUuid: byUuid,
      abilities: (abilitiesJson.abilities ?? []).map((a) => ({
        name:               a.name,
        representativeText: a.representativeText ?? "",
        automationStatus:   a.automationStatus ?? "unknown",
        monsterNames:       (a.monsters ?? [])
          .map((uuid) => byUuid.get(uuid) ?? null)
          .filter(Boolean)
          .sort(),
      })),
      loaded: true,
    };
  } catch (err) {
    console.warn("[vagabond-crawler] audit abilities load failed:", err);
  }
  return _auditAbilitiesCache;
}

/** Status ids that show up in `get_available_conditions` but aren't actually
 *  part of the Vagabond rules — contributed by third-party modules (Patrol).
 *  Filtered out of the rider status dropdown so they stop polluting it. */
const NON_VAGABOND_STATUS_IDS = new Set(["patrolundetectable"]);
const RIDER_STATUS_IDS = STATUS_IDS.filter((id) => !NON_VAGABOND_STATUS_IDS.has(id));
import { ACTION_QUICK_PICKS,  materializeAction  } from "./action-templates.mjs";
import { ABILITY_QUICK_PICKS, materializeAbility } from "./ability-templates.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ── Constants for dropdowns ───────────────────────────────────────────────────

const BEING_TYPES = ["Beasts", "Cryptid", "Humanlike", "Undead", "Fae", "Primordials", "Outers", "Artificials"];
const SIZES       = ["small", "medium", "large", "huge", "giant", "colossal"];
const ZONES       = ["frontline", "midline", "backline"];

// Canonical lists mirror the HTML Monster Creator (matches Vagabond's data model).
const DAMAGE_TYPES  = ["acid", "fire", "shock", "poison", "cold", "blunt", "piercing", "slashing", "physical", "necrotic", "psychic", "magical", "healing", "recover", "recharge"];
const WEAKNESS_TYPES = [...DAMAGE_TYPES, "coldIron", "silver"];
const WEAKNESS_LABELS = { coldIron: "Cold Iron" };
const STATUS_CONDITIONS = [
  "berserk", "blinded", "burning", "charmed", "confused", "dazed",
  "fatigued", "focusing", "frightened", "grappling", "incapacitated",
  "invisible", "paralyzed", "prone", "restrained", "sickened",
  "suffocating", "unconscious", "vulnerable",
];
const SPEED_MODES = ["climb", "cling", "fly", "phase", "swim"];

function _capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function _labelFor(s, map) { return map[s] ?? _capitalize(s); }

/**
 * Parse a free-form Vagabond `senses` string into Foundry token-sight settings.
 * Returns `null` when the string doesn't match any known sense — leaving the
 * caller to keep whatever the user had previously set. Range `null` means
 * infinite (displayed as ∞ in Foundry's token HUD).
 *
 * Used when loading from bestiary so a monster with "Darksight" auto-gets
 * Darkvision + 60ft range, etc. Can be disabled per-field if the user wants
 * to tweak manually.
 */
function _visionFromSenses(sensesText) {
  const str = String(sensesText ?? "").trim();
  if (!str) return { enabled: false, range: 0, mode: "basic" };
  for (const rule of VISION_MODE_BY_SENSE) {
    if (rule.keyword.test(str)) {
      // Prefer an explicit range number in the text if the author gave one
      // (e.g. "Darksight 60'", "Blindsight 60 feet", "Seismicsense (Far)").
      const explicit = str.match(/(\d+)\s*(?:ft|feet|'|")/i);
      const range = explicit ? Number(explicit[1]) : rule.range;
      return { enabled: true, range, mode: rule.mode };
    }
  }
  return null; // unknown — don't auto-configure
}

function _identitySummary(d) {
  const parts = [
    (d.name ?? "").trim() || "(unnamed)",
    d.beingType,
    _capitalize(d.size || ""),
    _capitalize(d.zone  || ""),
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Short one-line preview of selected senses for the collapsed mini-section
 *  summary line. Includes the compiled string so users see exactly what the
 *  actor will save. */
function _sensesMiniPreview(d) {
  const s = d.senses ?? "";
  return s.trim() || "none";
}

/** Short one-line preview of non-walk movement modes. */
function _movementMiniPreview(d) {
  const types = Array.isArray(d.speedTypes) ? d.speedTypes : [];
  if (!types.length) return "walk only";
  return types.map((t) => String(t).trim()).filter(Boolean).join(", ");
}

function _visionSummary(d) {
  if (!d.visionEnabled) return "disabled";
  const modeLabel = VISION_MODE_OPTIONS.find((o) => o.value === d.visionMode)?.label ?? d.visionMode;
  const rangeLabel = d.visionInfinite ? "∞" : `${d.visionRange || 0}ft`;
  return `${modeLabel} · ${rangeLabel}`;
}

function _statsSummary(d) {
  const parts = [];
  parts.push(`HD ${d.hd}`);
  parts.push(`Armor ${d.armor}`);
  parts.push(`${d.speed}ft`);
  if (d.speedTypes?.length) {
    const modes = d.speedTypes.map((s) => String(s).split(/\s+/)[0]).filter(Boolean);
    if (modes.length) parts.push(`+ ${modes.join("/")}`);
  }
  parts.push(`Morale ${d.morale}`);
  return parts.join(" · ");
}

function _descriptionPreview(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  return t.length > 80 ? t.slice(0, 80) + "…" : t;
}

/**
 * Compact summary of a string-array field — used in collapsible <summary>
 * so the user sees what's selected without expanding.
 * Returns { hasAny, count, preview } where preview is up to 4 values joined.
 */
function _summarize(arr, labelMap = {}) {
  const list = Array.isArray(arr) ? arr : [];
  if (list.length === 0) return { hasAny: false, count: 0, preview: "" };
  const labels = list.map((v) => _labelFor(v, labelMap));
  const preview = labels.slice(0, 4).join(", ") + (labels.length > 4 ? `, +${labels.length - 4} more` : "");
  return { hasAny: true, count: list.length, preview };
}

/**
 * Canonical Vagabond senses for the Stats section checkbox grid.
 * `key` is the checkbox data-key (used in UI state).
 * `match` is a regex tested against the stored senses string to pre-check
 *   boxes when we load a monster with a free-form senses field.
 * `writeName` is the canonical spelling used when compiling back to text.
 * `supportsRange` is false for boolean-only senses (e.g. Allsight → infinite).
 */
const SENSE_DEFS = [
  { key: "darksight",    label: "Darksight",    match: /\bdark[\s-]?sight\b|\bdarkvision\b/i, writeName: "Darksight",    defaultRange: 60, supportsRange: true  },
  { key: "blindsight",   label: "Blindsight",   match: /\bblindsight\b/i,                      writeName: "Blindsight",   defaultRange: 30, supportsRange: true  },
  { key: "seismicsense", label: "Seismicsense", match: /\bseismicsense\b|\btremorsense\b/i,    writeName: "Seismicsense", defaultRange: 30, supportsRange: true  },
  { key: "allsight",     label: "Allsight",     match: /\ball[\s-]?sight\b|\btruesight\b/i,    writeName: "Allsight",     defaultRange: 0,  supportsRange: false, infinite: true },
  { key: "lightsight",   label: "Lightsight",   match: /\blight[\s-]?sight\b/i,                writeName: "Lightsight",   defaultRange: 30, supportsRange: true  },
  { key: "blindsense",   label: "Blindsense",   match: /\bblindsense\b/i,                      writeName: "Blindsense",   defaultRange: 15, supportsRange: true  },
  { key: "echolocation", label: "Echolocation", match: /\becholocation\b/i,                    writeName: "Echolocation", defaultRange: 15, supportsRange: true  },
];

/** Parse a free-form senses string into { struct, other }. The struct maps
 *  `key → { checked }`. Senses are boolean — either on (infinite range) or
 *  off. Any explicit "60'" / "30 ft" in the source is discarded because the
 *  UI no longer exposes a range field; saving recompiles to just the name.
 *  `other` holds whatever couldn't be matched so custom phrasings survive. */
function _parseSensesString(text) {
  const str = String(text ?? "").trim();
  const struct = {};
  for (const def of SENSE_DEFS) struct[def.key] = { checked: false };
  if (!str) return { struct, other: "" };

  const segments = str.split(/\s*,\s*/).filter(Boolean);
  const leftovers = [];
  for (const seg of segments) {
    let matched = false;
    for (const def of SENSE_DEFS) {
      if (!def.match.test(seg)) continue;
      struct[def.key].checked = true;
      matched = true;
      break;
    }
    if (!matched) leftovers.push(seg);
  }
  return { struct, other: leftovers.join(", ") };
}

/** Compile a sensesStruct + other string back into the canonical free-form
 *  senses string. Each checked sense writes just its name (infinite range
 *  implied per the simplified UI). */
function _compileSensesString(struct, other) {
  const parts = [];
  for (const def of SENSE_DEFS) {
    if (struct?.[def.key]?.checked) parts.push(def.writeName);
  }
  const extra = String(other ?? "").trim();
  if (extra) parts.push(extra);
  return parts.join(", ");
}

// Vagabond sense keyword → Foundry token sight config
// Keep keys in precedence order: the first match wins so "Allsight" beats
// "Blindsight" when both happen to appear in the same senses string.
const VISION_MODE_BY_SENSE = [
  { keyword: /\ball[\s-]?sight\b/i, range: null,  mode: "basic"      },   // null = infinite
  { keyword: /\bdark[\s-]?sight\b/i, range: 60,    mode: "darkvision" },
  { keyword: /\bdarkvision\b/i,      range: 60,    mode: "darkvision" },
  { keyword: /\btruesight\b/i,       range: null,  mode: "basic"      },
  { keyword: /\bseismicsense\b/i,    range: 30,    mode: "tremorsense" },
  { keyword: /\btremorsense\b/i,     range: 30,    mode: "tremorsense" },
  { keyword: /\bblindsight\b/i,      range: 30,    mode: "basic"      },
  { keyword: /\bblindsense\b/i,      range: 15,    mode: "basic"      },
  { keyword: /\becholocation\b/i,    range: 15,    mode: "basic"      },
];

const VISION_MODE_OPTIONS = [
  { value: "basic",              label: "Basic Vision"      },
  { value: "darkvision",         label: "Darkvision"        },
  { value: "tremorsense",        label: "Tremorsense"       },
  { value: "monochromatic",      label: "Monochromatic"     },
  { value: "lightAmplification", label: "Light Amplification" },
  { value: "blindness",          label: "Blindness"         },
];

/** Canonical Armor Descriptors from the Vagabond Core Rulebook §6 Bestiary,
 *  table ^armor-descriptors-table. `mitigation` is the armor value the
 *  description implies (Unarmored=0, Leather=1, etc.), used by the template
 *  so the dropdown can preview each option's armor value. "None" / "All
 *  attacks hit" are special non-numeric cases. */
const ARMOR_DESCRIPTORS = [
  { value: "None",                        mitigation: "-" },
  { value: "All attacks hit",             mitigation: "-" },
  { value: "as Unarmored",                mitigation: 0  },
  { value: "as Unarmored plus Shield",    mitigation: 1  },
  { value: "as Leather",                  mitigation: 1  },
  { value: "as Leather plus Shield",      mitigation: 2  },
  { value: "as Hide",                     mitigation: 1  },
  { value: "as Hide plus Shield",         mitigation: 2  },
  { value: "as Chain",                    mitigation: 2  },
  { value: "as Chain plus Shield",        mitigation: 3  },
  { value: "as Scale",                    mitigation: 2  },
  { value: "as Scale plus Shield",        mitigation: 3  },
  { value: "as Plate",                    mitigation: 3  },
  { value: "as Plate plus Shield",        mitigation: 4  },
  { value: "as Splint",                   mitigation: 3  },
  { value: "as Splint plus Shield",       mitigation: 4  },
  { value: "as (+1) Plate",               mitigation: 4  },
  { value: "as (+1) Plate plus Shield",   mitigation: 5  },
  { value: "as (+2) Plate",               mitigation: 5  },
  { value: "as (+2) Plate plus Shield",   mitigation: 6  },
  { value: "as (+3) Plate",               mitigation: 6  },
  { value: "as (+3) Plate plus Shield",   mitigation: 7  },
];

const SIZE_TO_TOKEN = {
  small:    { w: 1, h: 1 },
  medium:   { w: 1, h: 1 },
  large:    { w: 2, h: 2 },
  huge:     { w: 3, h: 3 },
  giant:    { w: 4, h: 4 },
  colossal: { w: 5, h: 5 },
};

const ATTACK_TYPES = [
  { value: "melee",      label: "Melee" },
  { value: "ranged",     label: "Ranged" },
  { value: "castClose",  label: "Cast (Close)" },
  { value: "castRanged", label: "Cast (Ranged)" },
];

const DAMAGE_TYPE_OPTIONS = ["-", ...["acid","fire","shock","poison","cold","blunt","piercing","slashing","physical","necrotic","psychic","magical","healing","recover","recharge"]];

const SAVE_TYPES = [
  { value: "any",    label: "Any"    },
  { value: "reflex", label: "Reflex" },
  { value: "endure", label: "Endure" },
  { value: "will",   label: "Will"   },
  { value: "none",   label: "None"   },
];

const ACTION_TABS = [
  { key: "all",        label: "All" },
  { key: "melee",      label: "Melee" },
  { key: "ranged",     label: "Ranged" },
  { key: "castClose",  label: "Cast (Close)" },
  { key: "castRanged", label: "Cast (Ranged)" },
];

/** Map MUTATION_CATEGORIES keys into high-level tabs (matches the HTML tool). */
const MUTATION_TAB_BUCKETS = {
  form:    new Set(["hp", "armor", "speed", "size", "morale", "senses", "movement", "immunities", "weaknesses", "statusImmunities"]),
  attack:  new Set(["dpr"]),
  special: new Set(["abilities"]),
};
const MUTATION_TABS = [
  { key: "all",     label: "All" },
  { key: "form",    label: "Form" },
  { key: "attack",  label: "Attack" },
  { key: "special", label: "Special" },
];

const BESTIARY_PACKS = ["vagabond.bestiary", "vagabond.humanlike"];

const DEFAULT_PORTRAIT = "systems/vagabond/assets/ui/default-npc.svg";

// ── Singleton public API ──────────────────────────────────────────────────────

export const MonsterCreator = {
  _app: null,

  init() {
    console.log(`${MODULE_ID} | Monster Creator initialized.`);
    // Pre-warm the audit abilities cache so the first click on the
    // Abilities tab doesn't stall on a cold fetch.
    _getAuditAbilities().catch(() => { /* best-effort; cache already safe */ });
  },

  open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open the Monster Creator.");
      return;
    }
    if (!this._app) this._app = new MonsterCreatorApp();
    this._app.render(true);
  },

  /**
   * Open the Creator pre-filled with a raw actor data object (as returned
   * by `actor.toObject()` or the output of `applyMutations(clone, ...)`).
   * The Creator treats this as "loaded content" — all sections collapse;
   * the user expands to tweak. Used by the Mutate tab's "Edit in Creator"
   * handoff so mutations are baked in as starting stats.
   */
  openWithData(actorObject) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open the Monster Creator.");
      return;
    }
    if (!this._app) this._app = new MonsterCreatorApp();
    this._app._loadFromActorShape(actorObject);
    this._app.render(true);
  },

  /**
   * Mount a panel-mode Monster Creator into a DOM element. Used by the
   * Encounter Roller's Monster Creator tab so the full Creator UI renders
   * inside the tab pane instead of opening a separate window.
   *
   * Keeps its own instance (`_panelApp`) independent of the standalone
   * window (`_app`) so state in one doesn't leak into the other. Returns
   * the panel-app so callers can drive it (e.g. close/reset).
   */
  async mountPanel(container) {
    if (!container) return null;
    if (!this._panelApp) {
      this._panelApp = new MonsterCreatorApp();
      this._panelApp._isPanel = true;
    }
    await this._panelApp.mountInto(container);
    return this._panelApp;
  },

  /** Tear down the embedded panel — called when the Encounter Roller closes
   *  or switches off the Monster Creator tab. Clears handlers, drops state. */
  unmountPanel() {
    if (!this._panelApp) return;
    this._panelApp._panelRoot?.replaceChildren();
    this._panelApp._renderAbort?.abort();
    this._panelApp._renderAbort = null;
    this._panelApp._panelRoot = null;
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _blankMonster() {
  return {
    name:             "",
    beingType:        "Beasts",
    size:             "medium",
    zone:             "frontline",
    hd:               3,
    hitDie:           "fromSize",
    rollHpOnSpawn:    false,
    armor:            0,
    armorDescription: "as Unarmored",
    speed:            30,
    speedTypes:       [],
    speedValues:      { climb: 0, cling: 0, fly: 0, phase: 0, swim: 0 },
    morale:           7,
    appearing:        "1",
    senses:           "",
    sensesStruct:     _parseSensesString("").struct,
    sensesOther:      "",
    description:      "",
    immunities:       [],
    weaknesses:       [],
    statusImmunities: [],
    actions:          [],
    abilities:        [],
    portraitImg:      DEFAULT_PORTRAIT,
    tokenImg:         DEFAULT_PORTRAIT,
    // Token vision — matches Foundry v13 prototypeToken.sight shape.
    // `range` is Number | null; null displays as ∞.
    // Rules:
    //   - Mode "basic" always implies range 0 (no bonus sight), overriding input.
    //   - Blank / empty range on any non-basic mode = infinite (∞).
    //   - We no longer expose an Angle control; the saved value stays 360.
    visionEnabled:    true,   // on by default for new monsters
    visionRange:      0,
    visionInfinite:   false,
    visionAngle:      360,
    visionMode:       "basic",
  };
}

/** Full Vagabond action shape; used when a template has no pre-defined fields. */
function _blankAction() {
  return {
    name: "", note: "", recharge: "",
    attackType: "melee",
    flatDamage: "", rollDamage: "", damageType: "-",
    extraInfo: "",
    weaponId: "", weaponPrevName: "", weaponPrevFlatDamage: "", weaponPrevRollDamage: "",
    causedStatuses: [], critCausedStatuses: [],
    combo: false,  // true = part of this monster's multi-attack routine
  };
}

/** One On-Hit rider (causedStatuses or critCausedStatuses entry). */
function _blankRider() {
  return {
    statusId:          "",   // "" until user picks; compendium uses "prone"/"burning"/etc.
    saveType:          "any",
    duration:          "",   // "" = permanent / no duration; "d4"/"d6"/"Cd4" otherwise
    tickDamageEnabled: false,
    damageOnTick:      "",
    damageType:        "-",
    requiresDamage:    true, // "If Hit" — status only lands if the attack actually dealt damage
    fatigueOnFail:     0,    // +N Fatigue applied to the target on save fail (0 = none)
    fatigueOnTick:     0,    // +N Fatigue applied per countdown-die tick while the status persists
  };
}

/** Strip the form shape from a compendium NPC actor into Creator state. */
function _fromCompendiumActor(actor) {
  const s = actor.system ?? {};
  return {
    name:             actor.name,
    beingType:        s.beingType ?? "Beasts",
    size:             s.size ?? "medium",
    zone:             s.zone ?? "frontline",
    hd:               Number(s.hd ?? 1),
    hitDie:           actor.getFlag?.("vagabond-crawler", "hitDie")        ?? "fromSize",
    rollHpOnSpawn:    actor.getFlag?.("vagabond-crawler", "rollHpOnSpawn") ?? false,
    armor:            Number(s.armor ?? 0),
    armorDescription: s.armorDescription ?? "",
    speed:            Number(s.speed ?? 30),
    speedTypes:       Array.isArray(s.speedTypes) ? [...s.speedTypes] : [],
    speedValues:      { climb: 0, cling: 0, fly: 0, phase: 0, swim: 0, ...(s.speedValues ?? {}) },
    morale:           Number(s.morale ?? 7),
    appearing:        s.appearing ?? "1",
    senses:           s.senses ?? "",
    ...(() => { const p = _parseSensesString(s.senses ?? ""); return { sensesStruct: p.struct, sensesOther: p.other }; })(),
    description:      s.description ?? "",
    immunities:       Array.isArray(s.immunities)       ? [...s.immunities]       : [],
    weaknesses:       Array.isArray(s.weaknesses)       ? [...s.weaknesses]       : [],
    statusImmunities: Array.isArray(s.statusImmunities) ? [...s.statusImmunities] : [],
    actions: (() => {
      if (!Array.isArray(s.actions)) return [];
      // Combo membership is persisted in a module flag because the system's
      // action schema rejects unknown fields. Rehydrate into the form state.
      const comboNames = new Set(actor.getFlag?.("vagabond-crawler", "actionCombos") ?? []);
      return s.actions.map((a) => ({
        name: a?.name ?? "", note: a?.note ?? "", recharge: a?.recharge ?? "",
        attackType: a?.attackType ?? "melee",
        flatDamage: a?.flatDamage ?? "", rollDamage: a?.rollDamage ?? "", damageType: a?.damageType ?? "-",
        extraInfo: a?.extraInfo ?? "",
        weaponId: a?.weaponId ?? "",
        weaponPrevName: a?.weaponPrevName ?? "",
        weaponPrevFlatDamage: a?.weaponPrevFlatDamage ?? "",
        weaponPrevRollDamage: a?.weaponPrevRollDamage ?? "",
        causedStatuses: Array.isArray(a?.causedStatuses) ? a.causedStatuses.map((c) => ({ ...c })) : [],
        critCausedStatuses: Array.isArray(a?.critCausedStatuses) ? a.critCausedStatuses.map((c) => ({ ...c })) : [],
        combo: comboNames.has(a?.name ?? ""),
      }));
    })(),
    abilities: Array.isArray(s.abilities) ? s.abilities.map((ab) => ({
      name: ab?.name ?? "", description: ab?.description ?? "",
    })) : [],
    portraitImg:      actor.img || DEFAULT_PORTRAIT,
    // prototypeToken.texture.src can be a wildcard like ".../*" (used by bestiary
    // entries that randomize across a folder of variant images via `randomImg`).
    // The browser can't render a literal `*` as an `<img src>`, so we fall back
    // to the portrait when the path contains a wildcard. The user can pick a
    // specific image manually if they want.
    tokenImg:         (() => {
      const src = actor.prototypeToken?.texture?.src;
      if (!src || src.includes("*")) return actor.img || DEFAULT_PORTRAIT;
      return src;
    })(),
    ..._visionFromCompendiumSource(actor, s),
  };
}

/**
 * Pull vision settings from a compendium actor. If `prototypeToken.sight`
 * is the bestiary default (disabled, range 0, basic) — which is true for
 * every monster in vagabond.bestiary — synthesize settings from the
 * senses text so a Darksight monster gets Darkvision automatically.
 * Otherwise honor whatever the actor has explicitly configured.
 */
function _visionFromCompendiumSource(actor, systemData) {
  const sight = actor.prototypeToken?.sight ?? {};
  const isDefaultish =
    !sight.enabled && (sight.range ?? 0) === 0 && (sight.visionMode ?? "basic") === "basic";
  if (isDefaultish) {
    const derived = _visionFromSenses(systemData?.senses);
    if (derived) {
      return {
        visionEnabled:   true,  // always on when loading from bestiary
        visionRange:     derived.range ?? 0,
        visionInfinite:  derived.range === null,
        visionAngle:     360,
        visionMode:      derived.mode,
      };
    }
    // No senses keywords + defaultish prototypeToken → give the monster
    // Basic Vision (range 0) enabled by default. The GM can always turn
    // it off in the Creator UI.
    return {
      visionEnabled:   true,
      visionRange:     0,
      visionInfinite:  false,
      visionAngle:     360,
      visionMode:      "basic",
    };
  }
  return {
    visionEnabled:   !!sight.enabled,
    visionRange:     typeof sight.range === "number" ? sight.range : 0,
    visionInfinite:  sight.range === null,
    visionAngle:     Number(sight.angle ?? 360),
    visionMode:      sight.visionMode ?? "basic",
  };
}

/** "fire, poison , charmed" → ["fire","poison","charmed"]  (trimmed, deduped, no empties) */
function _parseCsvList(str) {
  if (!str) return [];
  return [...new Set(String(str).split(",").map((s) => s.trim()).filter(Boolean))];
}

function _computePreview(data) {
  const hp  = Math.round(calculateHP(data.hd, data.size, data.hitDie ?? "fromSize") ?? 0);
  const dpr = Math.round(((calculateDPR(data.actions) ?? 0)) * 10) / 10;
  const tl  = Math.round((calculateTL(hp, data.armor, dpr) ?? 0) * 10) / 10;
  return { hp, tl, dpr };
}

/** Build the compact damage string shown on template buttons and on
 *  action-summary pills.
 *
 *  `flatDamage` is an ALTERNATIVE to the dice roll (most GMs run flat for
 *  speed; rolling is optional), NOT a bonus that adds to the roll. The
 *  display reflects that by joining with "/" when both are present — e.g.
 *  "1d6 / 3" — instead of the old "1d6 +3" which read as addition. */
function _damageDisplay(rollDamage, flatDamage, damageType) {
  const roll = String(rollDamage ?? "").trim();
  const flat = String(flatDamage ?? "").trim();
  const hasRoll = !!roll;
  const hasFlat = !!flat && flat !== "0";

  let out;
  if (hasRoll && hasFlat)      out = `${roll} / ${flat}`;
  else if (hasRoll)            out = roll;
  else if (hasFlat)            out = flat;
  else                         return "—";

  if (damageType && damageType !== "-") out += ` ${damageType}`;
  return out;
}

/**
 * Convert the Creator's form-state `_data` into the actor-shape object that
 * `applyMutations` / `getStatSummary` / `calculateHP` expect (i.e. the raw
 * shape of a compendium `actor.toObject()`).
 *
 * Used when previewing/applying mutations so we can use the canonical
 * mutation logic without reimplementing it.
 */
function _dataToActorShape(data) {
  const hpVal = Math.round(calculateHP(data.hd, data.size, data.hitDie ?? "fromSize") ?? 0);
  return {
    name: data.name,
    flags: {
      "vagabond-crawler": {
        hitDie:        data.hitDie        ?? "fromSize",
        rollHpOnSpawn: data.rollHpOnSpawn ?? false,
      },
    },
    system: {
      hd:               data.hd,
      cr:               data.hd,
      size:             data.size,
      beingType:        data.beingType,
      speed:            data.speed,
      speedTypes:       [...data.speedTypes],
      speedValues:      { ...data.speedValues },
      morale:           data.morale,
      senses:           data.senses,
      armor:            data.armor,
      armorDescription: data.armorDescription,
      immunities:       [...data.immunities],
      weaknesses:       [...data.weaknesses],
      statusImmunities: [...data.statusImmunities],
      zone:             data.zone,
      health:           { value: hpVal, max: hpVal, bonus: [] },
      actions:   data.actions.map((a) => ({ ...a })),
      abilities: data.abilities.map((a) => ({ ...a })),
    },
  };
}

/** Reverse — copy a mutated actor-shape object back into Creator form state. */
function _actorShapeToData(actorObj, prevData) {
  const s = actorObj.system;
  return {
    name:             actorObj.name ?? prevData.name,
    beingType:        s.beingType ?? prevData.beingType,
    size:             s.size ?? prevData.size,
    zone:             s.zone ?? prevData.zone,
    hd:               Number(s.hd ?? prevData.hd),
    hitDie:           actorObj.flags?.["vagabond-crawler"]?.hitDie        ?? prevData?.hitDie        ?? "fromSize",
    rollHpOnSpawn:    actorObj.flags?.["vagabond-crawler"]?.rollHpOnSpawn ?? prevData?.rollHpOnSpawn ?? false,
    armor:            Number(s.armor ?? prevData.armor),
    armorDescription: s.armorDescription ?? prevData.armorDescription,
    speed:            Number(s.speed ?? prevData.speed),
    speedTypes:       Array.isArray(s.speedTypes) ? [...s.speedTypes] : [...prevData.speedTypes],
    speedValues:      { ...(s.speedValues ?? prevData.speedValues) },
    morale:           Number(s.morale ?? prevData.morale),
    appearing:        prevData.appearing,
    senses:           s.senses ?? prevData.senses,
    ...(() => { const p = _parseSensesString(s.senses ?? prevData.senses ?? ""); return { sensesStruct: p.struct, sensesOther: p.other }; })(),
    description:      prevData.description,
    immunities:       Array.isArray(s.immunities)       ? [...s.immunities]       : [...prevData.immunities],
    weaknesses:       Array.isArray(s.weaknesses)       ? [...s.weaknesses]       : [...prevData.weaknesses],
    statusImmunities: Array.isArray(s.statusImmunities) ? [...s.statusImmunities] : [...prevData.statusImmunities],
    actions:          Array.isArray(s.actions)   ? s.actions.map((a) => ({ ...a }))   : [],
    abilities:        Array.isArray(s.abilities) ? s.abilities.map((a) => ({ ...a })) : [],
    portraitImg:      prevData.portraitImg,
    tokenImg:         prevData.tokenImg,
  };
}

/** Compute a live preview of selected mutations applied to the current form.
 *  Returns before/after stat summaries + prefixes/suffixes. */
function _mutationPreview(data, selectedIds) {
  const baseShape  = _dataToActorShape(data);
  const baseSys    = baseShape.system;
  const basePreview = {
    hp:    Math.round(calculateHP(data.hd, data.size, data.hitDie ?? "fromSize") ?? 0),
    armor: data.armor,
    speed: data.speed,
    abilityCount: data.abilities.length,
    actionCount:  data.actions.length,
  };
  basePreview.tl = Math.round((calculateTL(basePreview.hp, basePreview.armor, calculateDPR(baseSys.actions) ?? 0) ?? 0) * 10) / 10;

  if (!selectedIds.size) return { base: basePreview, mutated: null, prefixes: [], suffixes: [] };

  const clone = foundry.utils.deepClone(baseShape);
  const { prefixes, suffixes } = applyMutations(clone, [...selectedIds]);
  const mSys = clone.system;
  const mDie = clone.flags?.["vagabond-crawler"]?.hitDie ?? "fromSize";
  const mutated = {
    hp:    Math.round(calculateHP(mSys.hd, mSys.size, mDie) ?? 0),
    armor: mSys.armor,
    speed: mSys.speed,
    abilityCount: (mSys.abilities ?? []).length,
    actionCount:  (mSys.actions ?? []).length,
  };
  mutated.tl = Math.round((calculateTL(mutated.hp, mutated.armor, calculateDPR(mSys.actions) ?? 0) ?? 0) * 10) / 10;
  return { base: basePreview, mutated, prefixes, suffixes };
}

function _mutationTabFor(mutationCategory) {
  for (const [bucket, cats] of Object.entries(MUTATION_TAB_BUCKETS)) {
    if (cats.has(mutationCategory)) return bucket;
  }
  return "form";
}

function _abilitiesSummary(abilities) {
  if (!abilities?.length) return { count: 0, preview: "" };
  const preview = abilities.slice(0, 4).map((a) => a.name).filter(Boolean).join(", ");
  const more = abilities.length > 4 ? `, +${abilities.length - 4} more` : "";
  return { count: abilities.length, preview: preview + more };
}

/** Badge metadata for an ability NAME. "implemented" when npc-abilities.mjs
 *  actively matches it; "unimplemented"/"flavor" are hints from Quick Picks
 *  (only meaningful when the name matches a Quick Pick tier/variant output).
 *  Anything else gets `null` (no badge).
 */
function _abilityBadge(name) {
  if (!name) return null;
  if (PASSIVE_ABILITIES[name]) {
    return { status: "implemented", icon: "✓", label: "Automated" };
  }
  // Match Quick Picks materialized names: "Magic Ward III", "Pack Hunter", "Nimble", etc.
  for (const qp of ABILITY_QUICK_PICKS) {
    const names = qp.tiers
      ? qp.tiers.map((t) => `${qp.name} ${t.label}`)
      : qp.variants
        ? qp.variants.map((v) => `${qp.name} ${v.label}`)
        : [qp.name];
    if (names.includes(name)) {
      if (qp.automationStatus === "implemented") return { status: "implemented", icon: "✓", label: "Automated" };
      if (qp.automationStatus === "unimplemented") return { status: "unimplemented", icon: "⚠", label: "Not automated" };
      if (qp.automationStatus === "flavor") return { status: "flavor", icon: "📖", label: "Flavor / narrative" };
    }
  }
  return null;
}

function _actionsSummary(actions) {
  if (!actions?.length) return { count: 0, preview: "" };
  const preview = actions.slice(0, 3)
    .map((a) => {
      const dmg = _damageDisplay(a.rollDamage, a.flatDamage, a.damageType);
      return dmg === "—" ? a.name : `${a.name} ${dmg}`;
    })
    .join(", ");
  const more = actions.length > 3 ? `, +${actions.length - 3} more` : "";
  return { count: actions.length, preview: preview + more };
}

/** Build the full Vagabond npc actor shape from Creator state. */
function _buildActorData(data) {
  const { hp } = _computePreview(data);
  const tok = SIZE_TO_TOKEN[data.size] ?? { w: 1, h: 1 };
  const stats = Object.fromEntries(
    ["might", "dexterity", "awareness", "reason", "presence", "luck"].map((k) => [k, { value: 8 }])
  );
  return {
    name: data.name.trim() || "Unnamed Monster",
    type: "npc",
    img:  data.portraitImg || DEFAULT_PORTRAIT,
    system: {
      health:           { value: hp, max: hp, bonus: [] },
      power:            { value: 5,  max: 5 },
      fatigue:          0,
      biography:        "",
      cr:               data.hd,
      threatLevel:      _computePreview(data).tl,
      size:             data.size,
      beingType:        data.beingType,
      speedTypes:       [...data.speedTypes],
      speedValues:      { ...data.speedValues },
      stats,
      hd:               data.hd,
      morale:           data.morale,
      appearing:        data.appearing,
      speed:            data.speed,
      senses:           data.senses,
      armor:            data.armor,
      armorDescription: data.armorDescription,
      locked:           true,
      immunities:       [...data.immunities],
      weaknesses:       [...data.weaknesses],
      statusImmunities: [...data.statusImmunities],
      zone:             data.zone,
      description:      data.description,
      actions:   data.actions.map((a) => ({
        name: a.name, note: a.note, recharge: a.recharge,
        attackType: a.attackType,
        flatDamage: a.flatDamage, rollDamage: a.rollDamage, damageType: a.damageType || "-",
        extraInfo: a.extraInfo ?? "",
        weaponId:             a.weaponId             ?? "",
        weaponPrevName:       a.weaponPrevName       ?? "",
        weaponPrevFlatDamage: a.weaponPrevFlatDamage ?? "",
        weaponPrevRollDamage: a.weaponPrevRollDamage ?? "",
        causedStatuses:     Array.isArray(a.causedStatuses)     ? a.causedStatuses.map((c) => ({ ...c }))     : [],
        critCausedStatuses: Array.isArray(a.critCausedStatuses) ? a.critCausedStatuses.map((c) => ({ ...c })) : [],
      })),
      abilities: data.abilities.map((ab) => ({ name: ab.name, description: ab.description })),
      universalDamageBonus:          ["0"],
      universalDamageDice:           [""],
      fatigueBonus:                  [],
      universalWeaponDamageBonus:    [],
      universalWeaponDamageDice:     [],
      universalSpellDamageBonus:     [],
      universalSpellDamageDice:      [],
      universalAlchemicalDamageBonus:[],
      universalAlchemicalDamageDice: [],
      cleaveTargets:                 [],
      brutalDice:                    [],
      reflexCritBonus:               [],
      endureCritBonus:               [],
    },
    prototypeToken: {
      name:        data.name.trim() || "Monster",
      displayName: 0,
      actorLink:   false,
      width:       tok.w,
      height:      tok.h,
      disposition: -1,
      randomImg:   false,
      texture: {
        src:      data.tokenImg || data.portraitImg || DEFAULT_PORTRAIT,
        anchorX:  0.5,
        anchorY:  0.5,
        scaleX:   1,
        scaleY:   1,
        rotation: 0,
        tint:     "#ffffff",
      },
      bar1: { attribute: "health" },
      sight: {
        enabled:    !!data.visionEnabled,
        range:      data.visionInfinite ? null : Number(data.visionRange) || 0,
        angle:      Number(data.visionAngle) || 360,
        visionMode: data.visionMode || "basic",
        color:      null,
        attenuation:0.1,
        brightness: 0,
        saturation: 0,
        contrast:   0,
      },
    },
    // Combo/multi-attack membership. The Vagabond action schema rejects
    // unknown fields, so we persist combo membership as an array of action
    // names on a module flag. _fromCompendiumActor reads this back when
    // editing an existing actor.
    flags: {
      "vagabond-crawler": {
        actionCombos: (data.actions ?? [])
          .filter((a) => a.combo)
          .map((a) => a.name)
          .filter((n) => !!n),
        hitDie:        data.hitDie        ?? "fromSize",
        rollHpOnSpawn: data.rollHpOnSpawn ?? false,
      },
    },
  };
}

// ── Cached bestiary index for the load dropdown ───────────────────────────────

let _bestiaryCache = null;

let _weaponsCache = null;

async function _getWeaponsList() {
  if (_weaponsCache) return _weaponsCache;
  const pack = game.packs.get("vagabond.weapons");
  if (!pack) { _weaponsCache = []; return []; }
  const docs = await pack.getDocuments();
  _weaponsCache = docs
    .filter((d) => d.type === "equipment" && d.system?.equipmentType === "weapon")
    .map((w) => ({
      id:             w.id,
      uuid:           w.uuid,
      name:           w.name,
      damageOneHand:  w.system.damageOneHand ?? "",
      damageTwoHands: w.system.damageTwoHands ?? "",
      damageType:     w.system.damageType ?? "-",
      weaponSkill:    w.system.weaponSkill ?? "melee",
      grip:           w.system.grip ?? "1H",
      range:          w.system.range ?? "close",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return _weaponsCache;
}

/** Map a weapon's weaponSkill + range to the Creator's attackType enum. */
function _weaponToAttackType(w) {
  if (w.weaponSkill === "ranged") return "ranged";
  return "melee";
}

async function _getBestiaryList() {
  if (_bestiaryCache) return _bestiaryCache;
  const items = [];
  for (const packId of BESTIARY_PACKS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const idx = await pack.getIndex({ fields: ["system.threatLevel", "system.beingType"] });
    for (const e of idx) {
      items.push({
        uuid:      `Compendium.${packId}.Actor.${e._id}`,
        name:      e.name,
        beingType: e.system?.beingType ?? "",
        tl:        Number(e.system?.threatLevel ?? 0),
        source:    packId,
      });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  _bestiaryCache = items;
  return items;
}

/** Apply the Creator's active filters to the bestiary list. */
function _filterBestiary(list, filters) {
  const term = (filters.search || "").trim().toLowerCase();
  const [tlLo, tlHi] = _tlRange(filters.tlRange);
  return list.filter((m) => {
    if (term && !m.name.toLowerCase().includes(term)) return false;
    if (filters.beingType && m.beingType !== filters.beingType) return false;
    if (filters.source    && m.source    !== filters.source)    return false;
    if (tlLo !== null && m.tl < tlLo) return false;
    if (tlHi !== null && m.tl >= tlHi) return false;
    return true;
  });
}

function _tlRange(range) {
  switch (range) {
    case "0-1": return [0, 1];
    case "1-3": return [1, 3];
    case "3-5": return [3, 5];
    case "5-8": return [5, 8];
    case "8+":  return [8, Infinity];
    default:    return [null, null];
  }
}

const TL_RANGE_OPTIONS = ["0-1", "1-3", "3-5", "5-8", "8+"];
const SOURCE_OPTIONS = [
  { value: "vagabond.bestiary",  label: "Bestiary"  },
  { value: "vagabond.humanlike", label: "Humanlike" },
];

// ── ApplicationV2 ─────────────────────────────────────────────────────────────

class MonsterCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:       "vagabond-crawler-monster-creator",
    window:   { title: "Monster Creator", resizable: true },
    position: { width: 760, height: 720 },
    classes:  ["vagabond-crawler", "monster-creator"],
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/monster-creator.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._data = _blankMonster();
    this._sourceUuid = null;
    this._renderAbort = null;
    this._actionsTab   = "all"; // which Action Quick-Picks tab is active
    this._mutationsTab = "all"; // which Mutation tab is active
    this._templatePickerOpen = false; // is the Actions "From Template" popup open?
    this._abilityQuery = "";         // live search box text for abilities
    this._abilityFilter = "all";     // "all" | "implemented" | "unimplemented" | "flavor"
    this._selectedMutations = new Set(); // staged mutation IDs (not applied yet)
    // Open/closed state for every <details data-collapse="…"> section.
    // Persisted across re-renders so editing inside an open section doesn't
    // collapse it. Keyed by the section's data-collapse attribute.
    this._sectionOpen = { identity: true, stats: true, senses: false, movement: false };
    // Per-action expanded state (action rows are also <details>). Keyed by
    // index — when a user clicks an action row to expand it, that index is
    // remembered so full re-renders don't collapse it. Cleared on reset/load.
    this._actionOpen = new Set();
    // Fresh start vs loaded-from-bestiary affects which sections are open
    // by default on next render. Set to false after a successful load so
    // the long "Stats" / "Identity" sections don't add to the page height
    // when the user is just scanning a loaded monster.
    this._isFreshStart = true;
    this._filters = {
      search: "",       // text match on name
      beingType: "",    // "" = all
      tlRange:   "",    // "" | "0-1" | "1-3" | "3-5" | "5-8" | "8+"
      source:    "",    // "" | "vagabond.bestiary" | "vagabond.humanlike"
    };
    // Panel-mount plumbing. When `_panelRoot` is set, the Creator renders
    // into that DOM element instead of opening a standalone ApplicationV2
    // window. `_isPanel` is a stable flag we use to decide whether to skip
    // the ApplicationV2 lifecycle in `render()`.
    this._isPanel = false;
    this._panelRoot = null;
  }

  /** When embedded (panel mode), return the mounted container. Otherwise
   *  fall through to ApplicationV2's normal `element` getter. */
  get element() {
    if (this._isPanel && this._panelRoot) return this._panelRoot;
    return super.element;
  }

  /** Render override — in panel mode, bypass ApplicationV2 and re-render the
   *  template into the mounted container. Otherwise use the normal window
   *  render. This is what makes `this.render()` calls inside the Creator's
   *  own event handlers work uniformly whether the Creator is a window or
   *  a tab panel. */
  async render(options) {
    if (this._isPanel && this._panelRoot) return this._renderPanel();
    return super.render(options);
  }

  /** Build the template HTML from `_prepareContext` and inject into the
   *  mounted container, then re-bind all the event handlers. */
  async _renderPanel() {
    const context = await this._prepareContext();
    const tplPath = MonsterCreatorApp.PARTS.form.template;
    const renderTemplate = foundry.applications?.handlebars?.renderTemplate
                        ?? globalThis.renderTemplate;
    const html = await renderTemplate(tplPath, context);
    this._panelRoot.innerHTML = html;
    this._onRender(context, { parts: ["form"] });
  }

  /** Mount the Creator's UI into an external container element. The element
   *  must have id "vagabond-crawler-monster-creator" so the existing CSS
   *  selectors keep matching. */
  async mountInto(container) {
    this._isPanel = true;
    // Ensure the container has the right id for CSS scoping. If the caller
    // passed a generic element we patch the id in place — if there's already
    // an id (e.g. from a previous mount) we leave it.
    if (!container.id) container.id = "vagabond-crawler-monster-creator";
    container.classList.add("vagabond-crawler", "monster-creator");
    this._panelRoot = container;
    await this._renderPanel();
  }

  async _prepareContext() {
    const bestiary = await _getBestiaryList();
    const filtered = _filterBestiary(bestiary, this._filters);
    const tokenizer = game.modules.get("vtta-tokenizer");
    const tokenizerAvailable = !!tokenizer?.active && !!tokenizer?.api?.launch;
    const markSelected = (list, current) =>
      list.map((v) => ({ value: v, label: v, selected: v === current }));
    const beingTypeFilterOpts = markSelected(BEING_TYPES, this._filters.beingType);
    const tlFilterOpts = markSelected(TL_RANGE_OPTIONS, this._filters.tlRange)
      .map((o) => ({ ...o, label: `TL ${o.label}` }));
    const sourceFilterOpts = SOURCE_OPTIONS.map((s) => ({
      ...s, selected: s.value === this._filters.source,
    }));
    return {
      data:        this._data,
      preview:     _computePreview(this._data),
      hitDieIsFromSize: (this._data.hitDie ?? "fromSize") === "fromSize",
      hitDieOptions:    ["d4","d6","d8","d10","d12","d14"].map((d) => ({
                          value:    d,
                          label:    d,
                          selected: this._data.hitDie === d,
                        })),
      hpPreviewFormula: (() => {
        const die       = this._data.hitDie ?? "fromSize";
        const size      = this._data.size ?? "medium";
        const hd        = Number(this._data.hd) || 0;
        const hp        = Math.round(calculateHP(hd, size, die) ?? 0);
        if (size === "small") return `${hp} HP — small (HP = HD)`;
        const resolved  = die === "fromSize"
          ? (game.settings.get(MODULE_ID, "hitDieSizeMap")?.[size] ?? "d8")
          : die;
        const suffix = die === "fromSize" ? " (from size)" : "";
        return `${hp} HP — ${hd}${resolved} avg${suffix}`;
      })(),
      beingTypes:  markSelected(BEING_TYPES, this._data.beingType),
      sizes:       markSelected(SIZES,       this._data.size),
      zones:       markSelected(ZONES,       this._data.zone),
      armorDescriptors: (() => {
        const current = this._data.armorDescription ?? "";
        const canonical = ARMOR_DESCRIPTORS.map((d) => ({
          value:    d.value,
          label:    d.mitigation === "-" ? d.value : `${d.value} (${d.mitigation})`,
          selected: d.value === current,
        }));
        // If the saved description doesn't match any canonical entry, keep
        // it as a one-off option so the user doesn't silently lose custom
        // text on first render.
        if (current && !canonical.some((c) => c.selected)) {
          canonical.unshift({ value: current, label: `${current} (custom)`, selected: true });
        }
        return canonical;
      })(),
      sourceName:  this._sourceUuid
        ? bestiary.find((b) => b.uuid === this._sourceUuid)?.name
        : null,
      bestiary,
      filtered,
      tokenizerAvailable,
      sectionOpen: this._sectionOpen,
      bestiaryOpen: !!this._sectionOpen.bestiary,
      filters: this._filters,
      beingTypeFilterOpts,
      tlFilterOpts,
      sourceFilterOpts,
      bestiaryTotal:          bestiary.length,
      bestiaryShown:          filtered.length,

      // Checkbox grids (replace the old CSV inputs)
      speedModesGrid: SPEED_MODES.map((m) => {
        const entry = this._data.speedTypes.find((s) => String(s).trim().toLowerCase().split(/\s+/)[0] === m);
        const checked = !!entry;
        // Resolve speed: prefer inline in speedTypes, fall back to speedValues[m]
        let speed = 0;
        if (entry) {
          const [, n] = String(entry).trim().split(/\s+/);
          speed = Number(n) || Number(this._data.speedValues?.[m] ?? 0);
        } else {
          speed = Number(this._data.speedValues?.[m] ?? 0);
        }
        return { value: m, label: _capitalize(m), checked, speed };
      }),
      sensesGrid: SENSE_DEFS.map((def) => ({
        key:     def.key,
        label:   def.label,
        checked: !!this._data.sensesStruct?.[def.key]?.checked,
      })),
      immunitiesGrid: DAMAGE_TYPES.map((t) => ({
        value: t, label: _capitalize(t),
        checked: this._data.immunities.includes(t),
      })),
      weaknessesGrid: WEAKNESS_TYPES.map((t) => ({
        value: t, label: _labelFor(t, WEAKNESS_LABELS),
        checked: this._data.weaknesses.includes(t),
      })),
      statusImmunitiesGrid: STATUS_CONDITIONS.map((s) => ({
        value: s, label: _capitalize(s),
        checked: this._data.statusImmunities.includes(s),
      })),
      // Collapsible section summaries — open the section by default if it has content
      immunitiesSummary:       _summarize(this._data.immunities),
      weaknessesSummary:       _summarize(this._data.weaknesses, WEAKNESS_LABELS),
      statusImmunitiesSummary: _summarize(this._data.statusImmunities),

      // Live preview text for the big-headline collapsibles
      identitySummary:     _identitySummary(this._data),
      statsSummary:        _statsSummary(this._data),
      descriptionPreview:  _descriptionPreview(this._data.description),
      hasDescription:      !!(this._data.description ?? "").trim(),

      // Open-by-default flags. Fresh-start: Identity + Stats open so the user
      // has something to edit right away. Loaded: everything closed — the
      // summaries show what's selected and the user expands to tweak.
      openIdentity:    this._isFreshStart,
      openStats:       this._isFreshStart,
      openDescription: !!(this._data.description ?? "").trim(),

      // Actions section
      actionsSummary:     _actionsSummary(this._data.actions),
      templatePickerOpen: !!this._templatePickerOpen,
      // Templates are grouped by category for the popup — one section per
      // attack type, in a consistent display order. Empty groups are filtered out.
      quickPickGroups: ACTION_TABS.filter((t) => t.key !== "all").map((tab) => ({
        key:   tab.key,
        label: tab.label,
        items: ACTION_QUICK_PICKS
          .filter((p) => p.category === tab.key)
          .map((p) => ({
            name: p.name,
            // Single preview damage per template (the first tier's numbers
            // by default). No tier picker — `materializeAction(template, null)`
            // picks tier[0] automatically, so clicking a template always adds
            // a sensible starter you can tweak in the expanded action card.
            previewDamage: _damageDisplay(
              (p.tiers?.[0]?.rollDamage ?? p.defaults?.rollDamage ?? ""),
              (p.tiers?.[0]?.flatDamage ?? p.defaults?.flatDamage ?? ""),
              (p.tiers?.[0]?.damageType ?? p.defaults?.damageType ?? "-"),
            ),
          })),
      })).filter((g) => g.items.length > 0),
      actionRows: await Promise.all(this._data.actions.map(async (a, index) => {
        const weaponsList = await _getWeaponsList();
        const riderShape = (r) => ({
          statusId: r.statusId ?? "",
          saveType: r.saveType ?? "any",
          duration: r.duration ?? "",
          tickDamageEnabled: !!r.tickDamageEnabled,
          damageOnTick: r.damageOnTick ?? "",
          damageType: r.damageType ?? "-",
          requiresDamage: r.requiresDamage !== false,
          fatigueOnFail: Number(r.fatigueOnFail) || 0,
          fatigueOnTick: Number(r.fatigueOnTick) || 0,
          permanent: !(r.duration && r.duration.trim()),
          statusOptions: [{ value: "", label: "— Select Status —", selected: !r.statusId }]
            .concat(RIDER_STATUS_IDS.map((id) => ({
              value: id,
              label: STATUS_LABELS[id] ?? _capitalize(id),
              selected: id === r.statusId,
            }))),
          saveOptions: SAVE_TYPES.map((s) => ({ ...s, selected: s.value === (r.saveType ?? "any") })),
          damageTypeOptions: DAMAGE_TYPE_OPTIONS.map((t) => ({
            value: t, label: t === "-" ? "—" : _capitalize(t), selected: t === (r.damageType || "-"),
          })),
        });
        return {
          index,
          open: this._actionOpen.has(index),
          name: a.name,
          note: a.note,
          recharge: a.recharge,
          rollDamage: a.rollDamage,
          flatDamage: a.flatDamage,
          damageType: a.damageType || "-",
          extraInfo: a.extraInfo ?? "",
          weaponId: a.weaponId ?? "",
          combo: !!a.combo,
          summary: _damageDisplay(a.rollDamage, a.flatDamage, a.damageType),
          attackTypeLabel: ATTACK_TYPES.find((t) => t.value === a.attackType)?.label ?? a.attackType,
          attackTypeOptions: ATTACK_TYPES.map((t) => ({ ...t, selected: t.value === a.attackType })),
          damageTypeOptions: DAMAGE_TYPE_OPTIONS.map((t) => ({ value: t, label: t === "-" ? "—" : _capitalize(t), selected: t === (a.damageType || "-") })),
          weaponOptions: [{ value: "", label: "— No weapon —", selected: !a.weaponId }]
            .concat(weaponsList.map((w) => ({
              value: w.id,
              label: w.damageOneHand ? `${w.name} (${w.damageOneHand})` : w.name,
              selected: w.id === a.weaponId,
            }))),
          causedStatuses:     (a.causedStatuses     ?? []).map(riderShape),
          critCausedStatuses: (a.critCausedStatuses ?? []).map(riderShape),
        };
      })),

      // Abilities section
      // Sourced from TWO datasets, merged by name:
      //   1. ABILITY_QUICK_PICKS — the 20 curated entries with tiers/variants
      //      and automation badges. Authoritative for picking how an ability
      //      materializes into an actor (description, tier label).
      //   2. Audit data (docs/audit/abilities.json) — every unique ability
      //      name across the compendium, with representativeText and the
      //      list of monsters that use it.
      // A curated entry WINS when names match — so Magic Ward still has its
      // tier picker — but unique audit-only names become plain rows with a
      // "used by N monsters" hover.
      abilitiesSummary: _abilitiesSummary(this._data.abilities),
      abilityQuery: this._abilityQuery,
      ...(await (async () => {
        const audit = await _getAuditAbilities();
        const curatedByName = new Map();
        for (const qp of ABILITY_QUICK_PICKS) curatedByName.set(qp.name.toLowerCase(), qp);

        // Merge: seed with curated, then add audit entries whose names aren't curated.
        const mergedRows = [];
        for (const qp of ABILITY_QUICK_PICKS) {
          const auditEntry = audit.abilities.find((a) => a.name.toLowerCase() === qp.name.toLowerCase()
                                                    || a.name.toLowerCase().startsWith(qp.name.toLowerCase() + " "));
          const monsterNames = auditEntry?.monsterNames ?? [];
          const monsterCount = (auditEntry?.monsterNames?.length) ?? 0;
          const fullDescription = qp.description
            ?? qp.tiers?.[0]?.description
            ?? qp.variants?.[0]?.description
            ?? auditEntry?.representativeText
            ?? "";
          mergedRows.push({
            source:             "curated",
            name:               qp.name,
            description:        qp.description ?? "",
            fullDescription,
            automationStatus:   qp.automationStatus,
            representativeText: auditEntry?.representativeText ?? "",
            tiers:              qp.tiers    ? qp.tiers.map((t) => ({ label: t.label }))    : null,
            variants:           qp.variants ? qp.variants.map((v) => ({ label: v.label })) : null,
            monsterCount,
            monsterNames,
          });
        }
        for (const a of audit.abilities) {
          const keyLower = a.name.toLowerCase();
          // Skip any audit entry already covered by a curated family. We match
          // exact names AND tiered variants (e.g. "Magic Ward III" belongs to "Magic Ward").
          const coveredBy = [...curatedByName.keys()].find((k) =>
            keyLower === k || keyLower.startsWith(k + " ")
          );
          if (coveredBy) continue;
          mergedRows.push({
            source:             "audit",
            name:               a.name,
            description:        a.representativeText,
            fullDescription:    a.representativeText,
            automationStatus:   a.automationStatus ?? "unimplemented",
            representativeText: a.representativeText,
            tiers:              null,
            variants:           null,
            monsterCount:       a.monsterNames.length,
            monsterNames:       a.monsterNames,
          });
        }

        // Compute filter counts across the full merged set (pre-search).
        const counts = { all: 0, implemented: 0, unimplemented: 0, flavor: 0 };
        for (const row of mergedRows) {
          counts.all++;
          const s = row.automationStatus ?? "unimplemented";
          if (counts[s] !== undefined) counts[s]++;
        }

        const q = (this._abilityQuery ?? "").trim().toLowerCase();
        const filterKey = this._abilityFilter ?? "all";

        const filtered = mergedRows
          .filter((row) => {
            if (filterKey !== "all" && (row.automationStatus ?? "unimplemented") !== filterKey) return false;
            if (!q) return true;
            const hay = `${row.name} ${row.fullDescription}`.toLowerCase();
            return hay.includes(q);
          })
          .map((row) => {
            const badgeBase = _abilityBadge(row.name) ?? (
              row.tiers ? _abilityBadge(`${row.name} ${row.tiers[0].label}`)
                        : row.variants ? _abilityBadge(`${row.name} ${row.variants[0].label}`) : null
            );
            const resolvedBadge = badgeBase ?? {
              status: (row.automationStatus ?? "unimplemented"),
              icon:   (row.automationStatus === "flavor") ? "—" : (row.automationStatus === "implemented" ? "✓" : "⚠"),
              label:  (row.automationStatus === "flavor") ? "Flavor / narrative"
                    : (row.automationStatus === "implemented" ? "Automated" : "Not yet automated"),
            };

            // Compose the native `title` tooltip: the full description, then
            // a line break, then "Used by N monsters: ..." (truncated).
            const tooltipLines = [];
            if (row.fullDescription) tooltipLines.push(row.fullDescription);
            if (row.monsterCount) {
              const shown = row.monsterNames.slice(0, 12).join(", ");
              const more  = row.monsterCount > 12 ? `, +${row.monsterCount - 12} more` : "";
              tooltipLines.push(`\nUsed by ${row.monsterCount} monster${row.monsterCount === 1 ? "" : "s"}: ${shown}${more}`);
            } else if (row.source === "curated") {
              tooltipLines.push("\n(Curated template — not currently found in any compendium actor)");
            }

            return {
              name:                row.name,
              description:         row.description,
              automationStatus:    row.automationStatus,
              automationBadge:     resolvedBadge,
              representativeShort: _descriptionPreview(row.fullDescription),
              fullTooltip:         tooltipLines.join("").trim(),
              tiers:               row.tiers,
              variants:            row.variants,
              monsterCount:        row.monsterCount,
              isCurated:           row.source === "curated",
            };
          });

        return {
          abilityFilters: [
            { key: "all",           label: "All",           title: "All abilities",                       count: counts.all,           active: filterKey === "all" },
            { key: "implemented",   label: "Automated",     title: "Automated at runtime by the module",  count: counts.implemented,   active: filterKey === "implemented" },
            { key: "unimplemented", label: "Not Automated", title: "Text-only (not yet automated)",       count: counts.unimplemented, active: filterKey === "unimplemented" },
            { key: "flavor",        label: "Flavor",        title: "Narrative flavor (no mechanics)",     count: counts.flavor,        active: filterKey === "flavor" },
          ],
          abilityTemplates: filtered,
        };
      })()),
      abilityRows: this._data.abilities.map((a, index) => ({
        index,
        name: a.name ?? "",
        description: a.description ?? "",
        badge: _abilityBadge(a.name),
      })),

      // Mutations panel
      mutationTabs: MUTATION_TABS.map((t) => ({ ...t, active: t.key === this._mutationsTab })),
      mutationCards: MUTATIONS
        .filter((m) => this._mutationsTab === "all" || _mutationTabFor(m.category) === this._mutationsTab)
        .map((m) => {
          const selected = this._selectedMutations.has(m.id);
          // Only detect conflicts against OTHER selected mutations, not self
          const otherSelected = selected ? new Set([...this._selectedMutations].filter((id) => id !== m.id)) : this._selectedMutations;
          const conflict = getConflict(m.id, [...otherSelected]);
          return {
            id:          m.id,
            name:        m.name,
            category:    m.category,
            type:        m.type,                        // "boon" | "bane"
            tlDelta:     m.tlDelta,
            tlDeltaStr:  (m.tlDelta > 0 ? "+" : "") + m.tlDelta,
            description: m.description,
            selected,
            conflict,                                    // conflict id, or null
            disabled:    !!conflict && !selected,        // can't check if a conflicting one is already picked
          };
        }),
      mutationSelectedCount: this._selectedMutations.size,
      mutationPreview: _mutationPreview(this._data, this._selectedMutations),

      // Token vision (basic = always range 0, input disabled; non-basic with
      // blank value = infinite)
      visionModeOptions: VISION_MODE_OPTIONS.map((o) => ({ ...o, selected: o.value === this._data.visionMode })),
      visionSummary: _visionSummary(this._data),
      visionRangeDisabled:    this._data.visionMode === "basic",
      visionRangePlaceholder: this._data.visionMode === "basic" ? "0" : "blank = ∞",

      // Short previews for the Senses + Movement mini-collapsibles. Stays
      // text-only (no pill) since these sections always have a handful of
      // items to summarize.
      sensesPreview:   _sensesMiniPreview(this._data),
      movementPreview: _movementMiniPreview(this._data),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    // Generic change listener: sync form → this._data live.
    // ALWAYS preview-only — we never want a simple field edit (including
    // arrow-key increments on a number input) to blow away the DOM and
    // lose focus. Full re-renders happen only for structural changes
    // (bestiary panel toggle/filter/load, reset, checkbox grids).
    el.querySelectorAll("[name]").forEach((input) => {
      const onChange = () => this._onFieldChange(input);
      input.addEventListener("change", onChange, { signal });
      if (input.tagName !== "SELECT") input.addEventListener("input", onChange, { signal });
    });

    el.querySelector('[data-action="pickPortrait"]')?.addEventListener("click", () => this._pickImage("portraitImg"), { signal });
    el.querySelector('[data-action="pickToken"]')   ?.addEventListener("click", () => this._pickImage("tokenImg"),    { signal });
    el.querySelector('[data-action="tokenize"]')    ?.addEventListener("click", () => this._launchTokenizer(),        { signal });

    // Unified <details> toggle sync — persist every section's open/closed
    // state across re-renders so editing inside an open section doesn't
    // inadvertently collapse it. Keyed by data-collapse attribute.
    el.querySelectorAll("details[data-collapse]").forEach((det) => {
      det.addEventListener("toggle", (ev) => {
        const key = ev.currentTarget.dataset.collapse;
        if (key) this._sectionOpen[key] = ev.currentTarget.open;
      }, { signal });
    });

    el.querySelector('[data-action="filterType"]')?.addEventListener("change", (ev) => {
      this._filters.beingType = ev.currentTarget.value;
      this.render();
    }, { signal });
    el.querySelector('[data-action="filterTL"]')?.addEventListener("change", (ev) => {
      this._filters.tlRange = ev.currentTarget.value;
      this.render();
    }, { signal });
    el.querySelector('[data-action="filterSource"]')?.addEventListener("change", (ev) => {
      this._filters.source = ev.currentTarget.value;
      this.render();
    }, { signal });

    // Search input — live-filter the list WITHOUT a full re-render
    // (avoids losing input focus on every keystroke).
    const searchInput = el.querySelector('[data-action="filterSearch"]');
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this._filters.search = searchInput.value;
        this._refreshBestiaryListOnly();
      }, { signal });
    }

    // Click a monster row to load
    el.querySelectorAll(".mc-bestiary-item").forEach((row) => {
      row.addEventListener("click", () => {
        const uuid = row.dataset.uuid;
        if (uuid) this._loadFromBestiary(uuid);
      }, { signal });
    });

    // Checkbox grids — toggle a string in the matching array, no full re-render.
    const toggleArray = (field, value, checked) => {
      const arr = this._data[field];
      if (checked) { if (!arr.includes(value)) arr.push(value); }
      else         { this._data[field] = arr.filter((v) => v !== value); }
    };

    const bindCheckboxGrid = (attr, field, details, labelMap = {}) => {
      el.querySelectorAll(`[data-${attr}]`).forEach((cb) => {
        cb.addEventListener("change", (ev) => {
          toggleArray(field, ev.currentTarget.dataset[attr], ev.currentTarget.checked);
          this._refreshCollapsedSummary(details, this._data[field], labelMap);
        }, { signal });
      });
    };
    bindCheckboxGrid("immune",        "immunities",       "immunities");
    bindCheckboxGrid("weak",          "weaknesses",       "weaknesses", WEAKNESS_LABELS);
    bindCheckboxGrid("statusimmune",  "statusImmunities", "statusImmunities");

    // Speed-mode checkboxes — enable/disable the partner number input in-place
    el.querySelectorAll("[data-speedmode]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const mode    = ev.currentTarget.dataset.speedmode;
        const checked = ev.currentTarget.checked;
        const numInput = el.querySelector(`[data-speedspeed="${mode}"]`);
        if (numInput) numInput.disabled = !checked;
        const speed = Number(numInput?.value ?? 0);
        this._setSpeedMode(mode, checked, speed);
      }, { signal });
    });
    el.querySelectorAll("[data-speedspeed]").forEach((num) => {
      num.addEventListener("input", (ev) => {
        const mode  = ev.currentTarget.dataset.speedspeed;
        const speed = Number(ev.currentTarget.value ?? 0);
        // Only store if the checkbox is enabled
        const cb = el.querySelector(`[data-speedmode="${mode}"]`);
        if (cb?.checked) this._setSpeedMode(mode, true, speed);
      }, { signal });
    });

    // ── Senses grid ─────────────────────────────────────────────────────
    // Each checkbox toggles sensesStruct[key].checked and enables/disables
    // its partner range input. The range input updates sensesStruct[key].range.
    // On every change we re-compile the human-readable string so _data.senses
    // stays in sync — that's the field the Save path persists.
    const syncSensesString = () => {
      this._data.senses = _compileSensesString(this._data.sensesStruct, this._data.sensesOther);
      this._refreshHeaderSummaries();
    };
    el.querySelectorAll("[data-sense]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.sense;
        const entry = this._data.sensesStruct[key] ?? (this._data.sensesStruct[key] = { checked: false });
        entry.checked = ev.currentTarget.checked;
        syncSensesString();
      }, { signal });
    });
    el.querySelector("[data-senses-other]")?.addEventListener("input", (ev) => {
      this._data.sensesOther = ev.currentTarget.value ?? "";
      syncSensesString();
    }, { signal });

    // ── Actions editor ──────────────────────────────────────────────────

    // [+ New Action] — append a blank action row and auto-open it.
    el.querySelector('[data-action="newBlankAction"]')?.addEventListener("click", () => {
      const fresh = _blankAction();
      fresh.name = "New Action";
      this._data.actions.push(fresh);
      this._actionOpen.add(this._data.actions.length - 1);
      this._templatePickerOpen = false;
      this.render();
    }, { signal });

    // [+ From Template ▾] — toggle the popup.
    el.querySelector('[data-action="toggleTemplatePicker"]')?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._templatePickerOpen = !this._templatePickerOpen;
      this.render();
    }, { signal });

    // Close the template popup when the user clicks anywhere outside it.
    if (this._templatePickerOpen) {
      const closeIfOutside = (ev) => {
        const inside = ev.target.closest(".mc-template-picker");
        if (inside) return;
        this._templatePickerOpen = false;
        document.removeEventListener("mousedown", closeIfOutside, true);
        this.render();
      };
      document.addEventListener("mousedown", closeIfOutside, true);
      signal.addEventListener("abort", () => document.removeEventListener("mousedown", closeIfOutside, true));
    }

    // Template popup: add action from template (+ optional tier)
    el.querySelectorAll('[data-action="addTemplate"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        const name = ev.currentTarget.dataset.templateName;
        const template = ACTION_QUICK_PICKS.find((p) => p.name === name);
        if (!template) return;
        const tierSel = el.querySelector(`[data-template-tier-for="${name}"]`);
        const tierLabel = tierSel?.value ?? null;
        const newAction = materializeAction(template, tierLabel);
        this._data.actions.push(newAction);
        this._actionOpen.add(this._data.actions.length - 1);
        this._templatePickerOpen = false;
        this.render();
      }, { signal });
    });

    // Per-action field edit → in-place state update + live summary/preview
    el.querySelectorAll("[data-action-field]").forEach((input) => {
      const onEdit = (ev) => {
        const row = ev.currentTarget.closest("[data-action-index]");
        const index = Number(row?.dataset.actionIndex);
        if (!Number.isFinite(index)) return;
        const field = ev.currentTarget.dataset.actionField;
        const action = this._data.actions[index];
        if (!action) return;
        // Checkboxes write their boolean state; text/select/number inputs
        // write .value. Distinguishing by .type keeps a single handler.
        const target = ev.currentTarget;
        action[field] = target.type === "checkbox" ? !!target.checked : target.value;
        this._refreshActionsSummary();
        this._refreshActionCardSummary(index);
        this._refreshPreviewLine();
      };
      input.addEventListener("input", onEdit, { signal });
      input.addEventListener("change", onEdit, { signal });
    });

    // Delete action row (button lives inside the summary; stop the default
    // toggle behavior so clicking the X doesn't also flip the details state)
    el.querySelectorAll('[data-action="deleteAction"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const row = ev.currentTarget.closest("[data-action-index]");
        const index = Number(row?.dataset.actionIndex);
        if (!Number.isFinite(index)) return;
        this._data.actions.splice(index, 1);
        // Re-index _actionOpen: remove deleted key, shift higher keys down by 1
        const nextOpen = new Set();
        for (const k of this._actionOpen) {
          if (k === index) continue;
          nextOpen.add(k > index ? k - 1 : k);
        }
        this._actionOpen = nextOpen;
        this.render();
      }, { signal });
    });

    // Per-action <details> toggle → remember which cards are open so a
    // re-render (e.g. adding a rider, picking a weapon) doesn't collapse them.
    el.querySelectorAll(".mc-action-card").forEach((card) => {
      card.addEventListener("toggle", (ev) => {
        const index = Number(card.dataset.actionIndex);
        if (!Number.isFinite(index)) return;
        if (card.open) this._actionOpen.add(index);
        else           this._actionOpen.delete(index);
      }, { signal });
    });

    // Weapon picker — populate name / rollDamage / damageType from the
    // selected weapon. Reversible: pick "— No weapon —" to restore the
    // previous (pre-link) values, so an accidental pick doesn't destroy
    // the existing damage formula.
    el.querySelectorAll('[data-action="setWeapon"]').forEach((sel) => {
      sel.addEventListener("change", async (ev) => {
        const row = ev.currentTarget.closest("[data-action-index]");
        const index = Number(row?.dataset.actionIndex);
        if (!Number.isFinite(index)) return;
        const action = this._data.actions[index];
        if (!action) return;
        const weaponId = ev.currentTarget.value;
        if (weaponId) {
          const weapons = await _getWeaponsList();
          const w = weapons.find((x) => x.id === weaponId);
          if (!w) return;
          // Snapshot old values so an "unlink" restores them
          if (!action.weaponId) {
            action.weaponPrevName       = action.name ?? "";
            action.weaponPrevFlatDamage = action.flatDamage ?? "";
            action.weaponPrevRollDamage = action.rollDamage ?? "";
          }
          action.weaponId    = weaponId;
          action.name        = w.name;
          action.rollDamage  = w.damageOneHand ?? action.rollDamage;
          action.flatDamage  = "";
          action.damageType  = (w.damageType && w.damageType !== "-") ? w.damageType : action.damageType;
          action.attackType  = (w.weaponSkill === "ranged" || w.range === "far") ? "ranged" : "melee";
        } else {
          // Unlink — restore previous values
          action.weaponId    = "";
          if (action.weaponPrevName      !== undefined) action.name       = action.weaponPrevName;
          if (action.weaponPrevRollDamage !== undefined) action.rollDamage = action.weaponPrevRollDamage;
          if (action.weaponPrevFlatDamage !== undefined) action.flatDamage = action.weaponPrevFlatDamage;
          action.weaponPrevName = "";
          action.weaponPrevRollDamage = "";
          action.weaponPrevFlatDamage = "";
        }
        this.render();
      }, { signal });
    });

    // Add rider (on-hit or crit-on-hit). Keep the card open across re-render.
    el.querySelectorAll('[data-action="addOnHitEffect"],[data-action="addCritEffect"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        const row = ev.currentTarget.closest("[data-action-index]");
        const index = Number(row?.dataset.actionIndex);
        if (!Number.isFinite(index)) return;
        const action = this._data.actions[index];
        if (!action) return;
        const listKey = ev.currentTarget.dataset.action === "addCritEffect"
          ? "critCausedStatuses" : "causedStatuses";
        if (!Array.isArray(action[listKey])) action[listKey] = [];
        action[listKey].push(_blankRider());
        this._actionOpen.add(index);
        this.render();
      }, { signal });
    });

    // Rider field edit (status / saveType / duration / tick / damage type /
    // permanent / requiresDamage).
    //
    // Permanent/duration are two views of the same state: an empty duration
    // IS permanent. The checkbox just flips it:
    //   - check   → duration := "" (permanent)
    //   - uncheck → duration := "d4" (a sane default the user can edit)
    // The duration field is NEVER disabled — typing any value immediately
    // makes the rider non-permanent. This is the fix for the prior bug where
    // Permanent couldn't be unchecked and the duration field was locked.
    el.querySelectorAll("[data-rider-field]").forEach((input) => {
      const onEdit = (ev) => {
        const riderRow = ev.currentTarget.closest("[data-rider-list]");
        const card = ev.currentTarget.closest("[data-action-index]");
        if (!riderRow || !card) return;
        const actionIndex = Number(card.dataset.actionIndex);
        const listKey = riderRow.dataset.riderList;
        const riderIndex = Number(riderRow.dataset.riderIndex);
        const action = this._data.actions[actionIndex];
        const list = action?.[listKey];
        const rider = list?.[riderIndex];
        if (!rider) return;
        const field = ev.currentTarget.dataset.riderField;
        if (field === "permanent") {
          rider.duration = ev.currentTarget.checked ? "" : "d4";
          this._actionOpen.add(actionIndex);
          this.render();
          return;
        }
        if (field === "tickDamageEnabled" || field === "requiresDamage") {
          rider[field] = ev.currentTarget.checked;
          this._actionOpen.add(actionIndex);
          this.render();
          return;
        }
        rider[field] = ev.currentTarget.value;
        // Duration typing can flip the Permanent state — refresh the checkbox
        // without a full re-render so focus stays in the text field.
        if (field === "duration") {
          const permCb = riderRow.querySelector('[data-rider-field="permanent"]');
          if (permCb) permCb.checked = !String(rider.duration).trim();
        }
        this._refreshActionCardSummary(actionIndex);
      };
      input.addEventListener("change", onEdit, { signal });
      if (input.tagName !== "SELECT" && input.type !== "checkbox") {
        input.addEventListener("input", onEdit, { signal });
      }
    });

    // Delete one rider from its action
    el.querySelectorAll('[data-action="deleteRider"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        const riderRow = ev.currentTarget.closest("[data-rider-list]");
        const card = ev.currentTarget.closest("[data-action-index]");
        if (!riderRow || !card) return;
        const actionIndex = Number(card.dataset.actionIndex);
        const listKey = riderRow.dataset.riderList;
        const riderIndex = Number(riderRow.dataset.riderIndex);
        const action = this._data.actions[actionIndex];
        const list = action?.[listKey];
        if (!Array.isArray(list)) return;
        list.splice(riderIndex, 1);
        this._actionOpen.add(actionIndex);
        this.render();
      }, { signal });
    });

    // ── Abilities editor ────────────────────────────────────────────────

    // Live search box — filters the browse list IN-PLACE by toggling a
    // `hidden` attribute on each row, avoiding a full Handlebars re-render
    // per keystroke. Focus + caret stay intact naturally since the input is
    // never re-created. The filter buttons' counts don't change with the
    // search query (they reflect the automation-status split), so they
    // don't need an update here.
    const abilitySearch = el.querySelector("[data-ability-search]");
    if (abilitySearch) {
      abilitySearch.addEventListener("input", (ev) => {
        this._abilityQuery = ev.currentTarget.value ?? "";
        const q = this._abilityQuery.trim().toLowerCase();
        const rows = el.querySelectorAll(".mc-ability-browse-row");
        let shown = 0;
        rows.forEach((row) => {
          const title = row.querySelector(".mc-ability-browse-title")?.textContent ?? "";
          const desc  = row.querySelector(".mc-ability-browse-desc")?.textContent  ?? "";
          const hay   = `${title} ${desc}`.toLowerCase();
          const match = !q || hay.includes(q);
          row.toggleAttribute("hidden", !match);
          if (match) shown++;
        });
        // Surface an empty-state node if nothing matches (reuse whatever
        // empty-state node Handlebars rendered for the no-results case).
        const list = el.querySelector(".mc-ability-browse-list");
        let empty = list?.querySelector(".mc-ability-empty-dynamic");
        if (!shown) {
          if (!empty && list) {
            empty = document.createElement("div");
            empty.className = "mc-action-empty mc-ability-empty-dynamic";
            empty.textContent = "No abilities match the current search.";
            list.appendChild(empty);
          }
        } else if (empty) {
          empty.remove();
        }
      }, { signal });
    }
    el.querySelectorAll("[data-ability-filter]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        this._abilityFilter = ev.currentTarget.dataset.abilityFilter || "all";
        this.render();
      }, { signal });
    });

    // Add an ability to the actor. Falls through to audit data when the
    // picked name isn't in the curated Quick Picks, so every browse row is
    // addable regardless of source.
    el.querySelectorAll('[data-action="addAbilityTemplate"]').forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        const name = ev.currentTarget.dataset.templateName;
        const template = ABILITY_QUICK_PICKS.find((q) => q.name === name);
        if (template) {
          const tierSel = el.querySelector(`[data-ability-tier-for="${name}"]`);
          const selectedLabel = tierSel?.value ?? null;
          const newAbility = materializeAbility(template, selectedLabel);
          this._data.abilities.push(newAbility);
        } else {
          // Audit-sourced — no tiers, no curated description. Copy the
          // representative text from the audit dataset as the body.
          const audit = await _getAuditAbilities();
          const entry = audit.abilities.find((a) => a.name === name);
          this._data.abilities.push({
            name,
            description: entry?.representativeText ?? "",
          });
        }
        this.render();
      }, { signal });
    });

    // Per-ability field edit
    el.querySelectorAll("[data-ability-field]").forEach((input) => {
      const onEdit = (ev) => {
        const row = ev.currentTarget.closest("[data-ability-index]");
        const index = Number(row?.dataset.abilityIndex);
        if (!Number.isFinite(index)) return;
        const field = ev.currentTarget.dataset.abilityField;
        const ability = this._data.abilities[index];
        if (!ability) return;
        ability[field] = ev.currentTarget.value;
        // Name change can flip automation status → a full re-render refreshes badges.
        // Description edits are in-place (don't need re-render).
        if (field === "name") this.render();
        else                  this._refreshAbilitiesSummary();
      };
      input.addEventListener("input", onEdit, { signal });
      input.addEventListener("change", onEdit, { signal });
    });

    el.querySelectorAll('[data-action="deleteAbility"]').forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        const row = ev.currentTarget.closest("[data-ability-index]");
        const index = Number(row?.dataset.abilityIndex);
        if (!Number.isFinite(index)) return;
        this._data.abilities.splice(index, 1);
        this.render();
      }, { signal });
    });

    // ── Mutations panel ─────────────────────────────────────────────────
    el.querySelectorAll("[data-mutation-tab]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        this._mutationsTab = ev.currentTarget.dataset.mutationTab;
        this.render();
      }, { signal });
    });
    el.querySelectorAll("[data-mutation-id]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        this._toggleMutation(ev.currentTarget.dataset.mutationId, ev.currentTarget.checked);
      }, { signal });
    });
    el.querySelector('[data-action="rollRandomMutation"]')?.addEventListener("click", () => this._rollRandomMutation(), { signal });
    el.querySelector('[data-action="applyMutations"]')?.addEventListener("click", () => this._applyMutations(), { signal });
    el.querySelector('[data-action="clearMutations"]')?.addEventListener("click", () => this._clearMutationSelection(), { signal });

    // ── Token vision fields ─────────────────────────────────────────────
    // Rules:
    //   - Mode "basic"  → range forced to 0, Infinite off, input disabled.
    //   - Mode non-basic + empty range → Infinite on.
    //   - Mode non-basic + numeric range → Infinite off.
    // Mode changes re-render so the range input's disabled state matches.
    el.querySelectorAll("[data-vision-field]").forEach((input) => {
      const onChange = (ev) => {
        const name = ev.currentTarget.dataset.visionField;
        if (name === "visionMode") {
          this._data.visionMode = ev.currentTarget.value;
          if (this._data.visionMode === "basic") {
            this._data.visionRange    = 0;
            this._data.visionInfinite = false;
          } else {
            // Keep existing range/infinite as-is — they're still valid.
          }
          this.render();
          return;
        }
        if (name === "visionEnabled") {
          this._data.visionEnabled = ev.currentTarget.checked;
          this._refreshVisionSummary();
          return;
        }
        if (name === "visionRange") {
          const raw = ev.currentTarget.value;
          if (this._data.visionMode === "basic") {
            this._data.visionRange    = 0;
            this._data.visionInfinite = false;
          } else if (raw === "" || raw === null) {
            // Blank on a non-basic mode means infinite (∞).
            this._data.visionRange    = 0;
            this._data.visionInfinite = true;
          } else {
            this._data.visionRange    = Number(raw) || 0;
            this._data.visionInfinite = false;
          }
          this._refreshVisionSummary();
          return;
        }
        // Ignore legacy fields (visionAngle / visionInfinite) that no longer
        // have a UI control — they're handled implicitly by the rules above.
      };
      input.addEventListener("change", onChange, { signal });
      if (input.tagName !== "SELECT" && input.type !== "checkbox") {
        input.addEventListener("input", onChange, { signal });
      }
    });
    el.querySelector('[data-action="autoVisionFromSenses"]')?.addEventListener("click", () => this._autoVisionFromSenses(), { signal });

    // Wrap every number input with visible ▴/▾ stepper buttons. Uses the
    // input's own `step` attribute (default 1) so Speed (step=5) steps by 5
    // and HD/Armor/Morale (no step) step by 1 exactly as the user asked for.
    // We do this after render (rather than in the template) so any future
    // number input gets steppers for free without template changes.
    el.querySelectorAll('input[type="number"]').forEach((input) => {
      if (input.closest(".mc-num-wrap")) return; // already wrapped
      const step = Number(input.step || input.getAttribute("step") || 1);
      const wrap = document.createElement("span");
      wrap.className = "mc-num-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const up   = document.createElement("button");
      const down = document.createElement("button");
      up.type   = down.type = "button";
      up.className   = "mc-num-btn mc-num-btn-up";
      down.className = "mc-num-btn mc-num-btn-down";
      up.innerHTML   = `<span aria-hidden="true">▴</span>`;
      down.innerHTML = `<span aria-hidden="true">▾</span>`;
      const fieldLabel = input.closest(".mc-field")?.querySelector("label")?.textContent?.trim()
                     ?? input.name
                     ?? "value";
      up.setAttribute(  "aria-label", `Increase ${fieldLabel} by ${step}`);
      down.setAttribute("aria-label", `Decrease ${fieldLabel} by ${step}`);
      up.title   = `+${step}`;
      down.title = `−${step}`;
      const nudge = (dir) => {
        const min = Number(input.min || "-Infinity");
        const max = Number(input.max ||  "Infinity");
        const cur = Number(input.value || 0);
        const next = Math.max(min, Math.min(max, cur + dir * step));
        input.value = String(next);
        input.dispatchEvent(new Event("input",  { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      up  .addEventListener("click", (ev) => { ev.preventDefault(); nudge(+1); }, { signal });
      down.addEventListener("click", (ev) => { ev.preventDefault(); nudge(-1); }, { signal });
      const stack = document.createElement("span");
      stack.className = "mc-num-stack";
      stack.appendChild(up);
      stack.appendChild(down);
      wrap.appendChild(stack);
    });

    el.querySelector('[data-action="reset"]') ?.addEventListener("click", () => this._reset(),  { signal });
    el.querySelector('[data-action="cancel"]')?.addEventListener("click", () => this.close(),   { signal });
    el.querySelector('[data-action="save"]')  ?.addEventListener("click", () => this._save(),   { signal });
    el.querySelector('[data-action="openHitDieConfig"]')?.addEventListener("click", (ev) => {
      ev.preventDefault();
      game.vagabondCrawler?.hitDieConfig?.open();
    }, { signal });
  }

  _onFieldChange(input) {
    const name = input.name;
    let value = input.value;
    if (input.type === "number")   value = Number(value);
    if (input.type === "checkbox") value = !!input.checked;
    this._data[name] = value;
    this._refreshPreviewLine();
    this._refreshHpPreviewBlock();
    this._refreshHeaderSummaries();
  }

  /** In-place update of the new "HP — XdY avg" line that lives under the
   *  Stats row. Computes the same string as _prepareContext so changing
   *  hitDie / size / hd / rollHpOnSpawn updates the preview without a full
   *  re-render (which would steal focus from text inputs). */
  _refreshHpPreviewBlock() {
    const root = this.element;
    if (!root) return;
    const formulaEl = root.querySelector(".mc-hp-preview-formula");
    if (!formulaEl) return;
    const die  = this._data.hitDie ?? "fromSize";
    const size = this._data.size ?? "medium";
    const hd   = Number(this._data.hd) || 0;
    const hp   = Math.round(calculateHP(hd, size, die) ?? 0);
    let text;
    if (size === "small") {
      text = `${hp} HP — small (HP = HD)`;
    } else {
      const resolved = die === "fromSize"
        ? (game.settings.get(MODULE_ID, "hitDieSizeMap")?.[size] ?? "d8")
        : die;
      const suffix = die === "fromSize" ? " (from size)" : "";
      text = `${hp} HP — ${hd}${resolved} avg${suffix}`;
    }
    formulaEl.textContent = text;
    // Toggle the "rolled at spawn" suffix in place.
    const rolledEl = root.querySelector(".mc-hp-preview-rolled");
    if (this._data.rollHpOnSpawn) {
      if (!rolledEl) {
        const span = document.createElement("span");
        span.className = "mc-hp-preview-rolled";
        span.textContent = " — rolled at spawn";
        formulaEl.parentElement?.appendChild(span);
      }
    } else if (rolledEl) {
      rolledEl.remove();
    }
  }

  /** Update the Identity / Stats / Description collapsed-header previews
   *  in-place so the user can see their edits reflected without expanding
   *  or re-rendering the form. */
  _refreshHeaderSummaries() {
    const el = this.element;
    if (!el) return;
    const updates = {
      identity:    _identitySummary(this._data),
      stats:       _statsSummary(this._data),
      description: _descriptionPreview(this._data.description),
    };
    for (const [key, text] of Object.entries(updates)) {
      const previewEl = el.querySelector(`[data-collapse="${key}"] > summary .mc-collapse-preview`);
      if (!previewEl) continue;
      if (key === "description") {
        if (text) {
          previewEl.textContent = text;
          previewEl.classList.remove("mc-empty");
        } else {
          previewEl.textContent = "no description";
          previewEl.classList.add("mc-empty");
        }
      } else {
        previewEl.textContent = text;
      }
    }
  }

  /** Update the count pill + preview text inside a collapsible's <summary>
   *  without re-rendering. Keeps `<details open>` state intact. */
  _refreshCollapsedSummary(key, arr, labelMap = {}) {
    const el = this.element?.querySelector(`[data-collapse="${key}"] > summary .mc-collapse-summary`);
    if (!el) return;
    const summary = _summarize(arr, labelMap);
    if (summary.hasAny) {
      el.innerHTML = `<span class="mc-pill">${summary.count}</span><span class="mc-collapse-preview">${foundry.utils.escapeHTML(summary.preview)}</span>`;
    } else {
      el.innerHTML = `<span class="mc-collapse-preview mc-empty">none</span>`;
    }
  }

  _refreshPreviewLine() {
    const preview = _computePreview(this._data);
    const el = this.element?.querySelector(".mc-preview-line");
    if (!el) return;
    const actionsCount = this._data.actions?.length ?? 0;
    const dprStr = actionsCount ? `${preview.dpr}` : "— (no actions)";
    el.textContent = `HP ${preview.hp} · TL ${preview.tl} · DPR ${dprStr}`;
  }

  /** Live-update the Abilities collapsed-header summary. */
  _refreshVisionSummary() {
    const el = this.element?.querySelector('[data-collapse="vision"] > summary .mc-collapse-preview');
    if (!el) return;
    el.textContent = _visionSummary(this._data);
  }

  /** Apply the senses → vision heuristic on demand. Doesn't touch fields
   *  the user has already customized beyond defaults. */
  _autoVisionFromSenses() {
    const derived = _visionFromSenses(this._data.senses);
    if (!derived) {
      ui.notifications.warn("No known sense keyword in the Senses field.");
      return;
    }
    this._data.visionEnabled  = derived.enabled;
    this._data.visionMode     = derived.mode;
    this._data.visionRange    = derived.range === null ? 0 : derived.range;
    this._data.visionInfinite = derived.range === null;
    this._data.visionAngle    = this._data.visionAngle || 360;
    this.render();
    ui.notifications.info(`Token vision set from Senses: ${_visionSummary(this._data)}`);
  }

  _refreshAbilitiesSummary() {
    const el = this.element?.querySelector('[data-collapse="abilities"] > summary .mc-collapse-summary');
    if (!el) return;
    const { count, preview } = _abilitiesSummary(this._data.abilities);
    if (count) {
      el.innerHTML = `<span class="mc-pill">${count}</span><span class="mc-collapse-preview">${foundry.utils.escapeHTML(preview)}</span>`;
    } else {
      el.innerHTML = `<span class="mc-collapse-preview mc-empty">none</span>`;
    }
  }

  /** Live-update a single action card's <summary> line (the one inside the
   *  card's <details>) without re-rendering. Keeps focus in the edited input
   *  and keeps every other card's open/closed state intact. */
  _refreshActionCardSummary(index) {
    const el = this.element;
    if (!el) return;
    const card = el.querySelector(`.mc-action-card[data-action-index="${index}"]`);
    if (!card) return;
    const action = this._data.actions?.[index];
    if (!action) return;
    const nameEl = card.querySelector(".mc-action-summary-name");
    const metaEl = card.querySelector(".mc-action-summary-meta");
    if (nameEl) {
      const safeName = action.name || "(unnamed)";
      nameEl.innerHTML = action.combo
        ? `${foundry.utils.escapeHTML(safeName)} <span class="mc-combo-badge" title="Part of this monster's multi-attack routine">combo</span>`
        : foundry.utils.escapeHTML(safeName);
    }
    if (metaEl) {
      const attackLabel = ATTACK_TYPES.find((t) => t.value === action.attackType)?.label ?? action.attackType;
      const dmg = _damageDisplay(action.rollDamage, action.flatDamage, action.damageType);
      const bits = [attackLabel, dmg];
      if (action.recharge) bits.push(action.recharge);
      const onHitCount  = action.causedStatuses?.length ?? 0;
      const critCount   = action.critCausedStatuses?.length ?? 0;
      // On-hit / crit-on-hit rider counts. Using inline labels instead of
      // emoji keeps the summary crisp and monochrome with the rest of the
      // card chrome (emoji render bright-multicolor on most platforms).
      if (onHitCount) bits.push(`${onHitCount} on-hit`);
      if (critCount)  bits.push(`${critCount} crit`);
      metaEl.textContent = bits.join(" · ");
    }
  }

  /** Live-update the Actions collapsed-header summary (count + preview)
   *  without re-rendering. Preserves the open/closed state of the section. */
  _refreshActionsSummary() {
    const el = this.element?.querySelector('[data-collapse="actions"] > summary .mc-collapse-summary');
    if (!el) return;
    const { count, preview } = _actionsSummary(this._data.actions);
    if (count) {
      el.innerHTML = `<span class="mc-pill">${count}</span><span class="mc-collapse-preview">${foundry.utils.escapeHTML(preview)}</span>`;
    } else {
      el.innerHTML = `<span class="mc-collapse-preview mc-empty">none</span>`;
    }
  }

  /** Launch the vtta-tokenizer module with the current portrait/token as
   *  starting points. Its callback fires with `{ avatarFilename, tokenFilename }`
   *  holding the uploaded Foundry paths — write those back to form state. */
  async _launchTokenizer() {
    const api = game.modules.get("vtta-tokenizer")?.api;
    if (!api?.launch) {
      ui.notifications.warn("Tokenizer module isn't active.");
      return;
    }
    const name = this._data.name?.trim() || "Monster";
    // Tokenizer tries to load its own fallback (hardcoded to
    // `icons/mystery-man.png`, which 404s) whenever avatarFilename /
    // tokenFilename is empty. Always pass a real, resolvable path —
    // Foundry's built-in SVG works regardless of system. The user can
    // still replace it from inside Tokenizer.
    const FALLBACK = "icons/svg/mystery-man.svg";
    const portrait = this._data.portraitImg && this._data.portraitImg !== DEFAULT_PORTRAIT
                   ? this._data.portraitImg : FALLBACK;
    const token    = this._data.tokenImg    && this._data.tokenImg    !== DEFAULT_PORTRAIT
                   ? this._data.tokenImg    : FALLBACK;
    const options = {
      type:            "npc",
      name,
      avatarFilename:  portrait,
      tokenFilename:   token,
      isWildCard:      false,
    };
    try {
      api.launch(options, (result) => {
        if (!result) return;
        let updated = false;
        if (result.avatarFilename) { this._data.portraitImg = result.avatarFilename; updated = true; }
        if (result.tokenFilename)  { this._data.tokenImg    = result.tokenFilename;  updated = true; }
        if (updated) {
          ui.notifications.info("Tokenizer: portrait + token updated.");
          this.render();
        }
      });
    } catch (err) {
      console.error(`${MODULE_ID} | Tokenizer launch failed`, err);
      ui.notifications.error("Failed to open Tokenizer — see console.");
    }
  }

  async _pickImage(field) {
    const current = this._data[field] || DEFAULT_PORTRAIT;
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type:     "image",
      current,
      callback: (path) => {
        this._data[field] = path;
        this.render();
      },
    });
    fp.browse();
  }

  /** Re-render only the bestiary list + count in-place.
   *  Used for search-as-you-type to preserve input focus. */
  async _refreshBestiaryListOnly() {
    const el = this.element;
    if (!el) return;
    const list = await _getBestiaryList();
    const filtered = _filterBestiary(list, this._filters);
    const countEl = el.querySelector(".mc-bestiary-count");
    const listEl  = el.querySelector(".mc-bestiary-list");
    if (countEl) countEl.textContent = `Showing ${filtered.length} of ${list.length}`;
    if (!listEl) return;
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="mc-bestiary-empty">No monsters match these filters.</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((m) => `
      <div class="mc-bestiary-item" data-uuid="${m.uuid}">
        <span class="mc-bestiary-tl">${m.tl}</span>
        <span class="mc-bestiary-name">${foundry.utils.escapeHTML(m.name)}</span>
        <span class="mc-bestiary-meta">${foundry.utils.escapeHTML(m.beingType)}</span>
      </div>
    `).join("");
    // Re-attach click handlers using the existing abort signal
    const signal = this._renderAbort?.signal;
    listEl.querySelectorAll(".mc-bestiary-item").forEach((row) => {
      row.addEventListener("click", () => {
        const uuid = row.dataset.uuid;
        if (uuid) this._loadFromBestiary(uuid);
      }, { signal });
    });
  }

  /** Load raw actor-shape data (not a Document) into the form.
   *  Used by MonsterCreator.openWithData() for the Mutate-tab handoff. */
  _loadFromActorShape(actorObject) {
    this._data = _fromCompendiumActor(actorObject);
    this._sourceUuid = null;
    this._isFreshStart = false;
    this._sectionOpen = {};
    this._actionOpen.clear();
  }

  async _loadFromBestiary(uuid) {
    try {
      const actor = await fromUuid(uuid);
      if (!actor) { ui.notifications.warn("Could not load that actor."); return; }
      this._data = _fromCompendiumActor(actor);
      this._sourceUuid = uuid;
      this._isFreshStart = false;   // loaded content: collapse everything; user expands to edit
      this._sectionOpen = {};       // close every section after a load
      this._actionOpen.clear();
      ui.notifications.info(`Loaded "${actor.name}" from ${uuid.split(".")[1]}.`);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Monster Creator: load failed`, err);
      ui.notifications.error("Failed to load from bestiary — see console.");
    }
  }

  /**
   * Canonicalize a speed mode's on/off state + speed into BOTH `speedTypes`
   * and `speedValues` so the saved actor works regardless of which form
   * downstream code reads.
   */
  _setSpeedMode(mode, enabled, speed) {
    // Remove any existing entry for this mode
    this._data.speedTypes = this._data.speedTypes.filter((s) => String(s).trim().toLowerCase().split(/\s+/)[0] !== mode);
    if (enabled) {
      this._data.speedTypes.push(speed > 0 ? `${mode} ${speed}` : mode);
      this._data.speedValues[mode] = speed;
    } else {
      this._data.speedValues[mode] = 0;
    }
  }

  _reset() {
    this._data = _blankMonster();
    this._sourceUuid = null;
    this._isFreshStart = true;
    this._sectionOpen = { identity: true, stats: true, senses: false, movement: false };
    this._actionOpen.clear();
    this._selectedMutations.clear();
    this.render();
  }

  /** Toggle a mutation checkbox. */
  _toggleMutation(id, checked) {
    if (checked) {
      // Block if the click would create a conflict
      if (getConflict(id, [...this._selectedMutations])) return;
      this._selectedMutations.add(id);
    } else {
      this._selectedMutations.delete(id);
    }
    this.render();
  }

  /** Pick one random untouched boon + its suggested bane (or a random bane).
   *  Matches the HTML Monster Creator's "Roll Random" action. */
  _rollRandomMutation() {
    const boons = getBoons().filter((b) => !this._selectedMutations.has(b.id) && !getConflict(b.id, [...this._selectedMutations]));
    if (!boons.length) { ui.notifications.warn("No eligible boons left to roll."); return; }
    const boon = boons[Math.floor(Math.random() * boons.length)];
    this._selectedMutations.add(boon.id);

    // Suggested bane first; fall back to any eligible bane
    const suggestedBane = boon.suggestedBane ? getMutation(boon.suggestedBane) : null;
    let bane = suggestedBane;
    if (!bane || this._selectedMutations.has(bane.id) || getConflict(bane.id, [...this._selectedMutations])) {
      const banes = getBanes().filter((b) => !this._selectedMutations.has(b.id) && !getConflict(b.id, [...this._selectedMutations]));
      bane = banes[Math.floor(Math.random() * banes.length)] ?? null;
    }
    if (bane) this._selectedMutations.add(bane.id);
    this.render();
  }

  /** Bake all selected mutations into `this._data`, clear the selection,
   *  and update the form. The user can then refine or stack another round. */
  _applyMutations() {
    if (!this._selectedMutations.size) {
      ui.notifications.warn("No mutations selected.");
      return;
    }
    const shape = _dataToActorShape(this._data);
    const { prefixes, suffixes } = applyMutations(shape, [...this._selectedMutations]);

    // Preserve current name if the user has set one non-default; otherwise
    // apply the mutation-generated name for flavor.
    // Dedupe: skip any prefix/suffix that's already present in the current
    // name so stacking the same mutation family twice doesn't double-prepend.
    const baseName = this._data.name?.trim() || shape.name || "";
    const hasWord = (word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(baseName);
    const newPrefixes = prefixes.filter((p) => !hasWord(p));
    const newSuffixes = suffixes.filter((s) => !hasWord(s));
    const newName  = newPrefixes.length || newSuffixes.length
      ? generateMutatedName(baseName, newPrefixes, newSuffixes)
      : baseName;

    this._data = _actorShapeToData(shape, this._data);
    this._data.name = newName;
    this._selectedMutations.clear();
    ui.notifications.info(`Applied ${[...prefixes, ...suffixes].length} mutation(s) to form.`);
    this.render();
  }

  _clearMutationSelection() {
    if (!this._selectedMutations.size) return;
    this._selectedMutations.clear();
    this.render();
  }

  async _save() {
    if (!this._data.name.trim()) {
      ui.notifications.warn("Name required before saving.");
      return;
    }
    try {
      const actorData = _buildActorData(this._data);
      const created = await Actor.create(actorData);
      if (created) {
        ui.notifications.info(`Created world actor: ${created.name}`);
        this.close();
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Monster Creator: save failed`, err);
      ui.notifications.error("Save failed — see console.");
    }
  }

  async close(options) {
    this._renderAbort?.abort();
    return super.close(options);
  }
}
