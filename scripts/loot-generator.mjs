const MODULE_ID = "vagabond-crawler";
const LOOT_SOCKET = `module.${MODULE_ID}`;

import {
  LEVEL_FORMULAS, TREASURE, TRADE_GOODS, ART, JEWELRY, CLOTHING, RELIC,
  ARMOR_BASE, ARMOR_POWER, ARMOR_MATERIAL, ARMOR_RESISTANCE, ARMOR_UTILITY,
  WEAPONS_LIST, WEAPON_POWER, WEAPON_MATERIAL, WEAPON_RESISTANCE, WEAPON_UTILITY,
  ALCHEMY, SENSES, MOVEMENT, CREATURE_GENERAL, CREATURE_SPECIFIC,
  LEVEL1_TABLE,
} from "./loot-data.mjs";
import { LootTracker } from "./loot-tracker.mjs";
import { SessionRecap } from "./session-recap.mjs";
import { RELIC_POWERS } from "./relic-powers.mjs";

/* ── Relic Power → Active Effect mapping ─────────────────── */

/** Build a lookup from power text → RELIC_POWERS entry. */
const _relicPowerMap = {};
function _initRelicPowerMap() {
  if (Object.keys(_relicPowerMap).length) return;
  for (const p of RELIC_POWERS) {
    // Map by id, name, and common aliases (all lowercase)
    _relicPowerMap[p.id] = p;
    _relicPowerMap[p.name.toLowerCase()] = p;
  }
  // Additional mappings for loot generator power text → relic power id
  const aliases = {
    "+1": "bonus-weapon-1", "+2": "bonus-weapon-2", "+3": "bonus-weapon-3",
    "weapon +1": "bonus-weapon-1", "weapon +2": "bonus-weapon-2", "weapon +3": "bonus-weapon-3",
    "weapon/trinket +1": "bonus-weapon-1", "weapon/trinket +2": "bonus-weapon-2", "weapon/trinket +3": "bonus-weapon-3",
    "armor +1": "bonus-armor-1", "armor +2": "bonus-armor-2", "armor +3": "bonus-armor-3",
    "protection +1": "bonus-protection-1", "protection +2": "bonus-protection-2", "protection +3": "bonus-protection-3",
    "trinket +1": "bonus-trinket-1", "trinket +2": "bonus-trinket-2", "trinket +3": "bonus-trinket-3",
    "strike 1": "strike-1", "strike 2": "strike-2", "strike 3": "strike-3",
    "swiftness 1": "movement-swiftness-1", "swiftness 2": "movement-swiftness-2", "swiftness 3": "movement-swiftness-3",
    "climbing": "movement-climbing", "clinging": "movement-clinging", "displacement": "movement-displacement",
    "flying": "movement-flying", "levitation": "movement-levitation", "blinking": "movement-blinking",
    "waterwalk": "movement-waterwalk", "webwalk": "movement-webwalk",
    "jumping 1": "movement-jumping-1", "jumping 2": "movement-jumping-2", "jumping 3": "movement-jumping-3",
    "nightvision": "senses-nightvision", "echolocation": "senses-echolocation",
    "tremors": "senses-tremors", "detection": "senses-detection",
    "sense life": "senses-life", "sense valuables": "senses-valuables",
    "telepathy": "senses-telepathy", "true-seeing": "senses-truesight",
    "bravery": "resistance-bravery", "clarity": "resistance-clarity", "repulsing": "resistance-repulsing",
    "acid resist": "resistance-typed", "cold resist": "resistance-typed",
    "fire resist": "resistance-typed", "poison resist": "resistance-typed", "shock resist": "resistance-typed",
    "after-image 1": "utility-after-image-1", "after-image 2": "utility-after-image-2",
    "ambassador": "utility-ambassador", "aqua lung": "utility-aqua-lung",
    "burning 1": "utility-burning-1", "burning 2": "utility-burning-2", "burning 3": "utility-burning-3",
    "darkness 1": "utility-darkness-1", "darkness 2": "utility-darkness-2", "darkness 3": "utility-darkness-3",
    "moonlight 1": "utility-moonlit-1", "moonlight 2": "utility-moonlit-2", "moonlight 3": "utility-moonlit-3",
    "moonlit 1": "utility-moonlit-1", "moonlit 2": "utility-moonlit-2", "moonlit 3": "utility-moonlit-3",
    "radiant 1": "utility-radiant-1", "radiant 2": "utility-radiant-2", "radiant 3": "utility-radiant-3",
    "infinite": "utility-infinite", "loyalty": "utility-loyalty", "warning": "utility-warning",
    "lifesteal 1": "utility-lifesteal-1", "lifesteal 2": "utility-lifesteal-2", "lifesteal 3": "utility-lifesteal-3",
    "manasteal 1": "utility-manasteal-1", "manasteal 2": "utility-manasteal-2", "manasteal 3": "utility-manasteal-3",
    "invisibility 1": "utility-invisibility-1", "invisibility 2": "utility-invisibility-2",
    "benediction": "fabled-benediction", "blasting": "fabled-blasting", "precision": "fabled-precision",
    "soul-eater": "fabled-soul-eater", "soul eater": "fabled-soul-eater",
    "vicious": "fabled-vicious", "vorpal": "fabled-vorpal",
    "ace": "ace-keen",  // default ace — should be randomized based on weapon properties
  };
  for (const [k, v] of Object.entries(aliases)) {
    _relicPowerMap[k] = RELIC_POWERS.find(p => p.id === v);
  }
}

/** Look up the RELIC_POWERS entry for a given power text. */
function _findRelicPower(powerText) {
  if (!powerText) return null;
  _initRelicPowerMap();
  const lower = powerText.toLowerCase().replace(/\s*\(niche\)/i, "").trim();
  return _relicPowerMap[lower] ?? null;
}

/** Create Active Effect documents from a relic power, with optional input substitution. */
function _buildRelicEffects(power, input = "") {
  if (!power) return [];
  const changes = (power.changes || []).map(e => ({
    key: e.key.replace("{input}", input),
    mode: e.mode,
    value: String(e.value).replace("{input}", input),
  }));
  const moduleFlags = { relicPower: power.id || power.name, managed: true };
  if (power.flags) {
    for (const [k, v] of Object.entries(power.flags)) {
      moduleFlags[k] = typeof v === "string" ? v.replace("{input}", input) : v;
    }
  }
  return [{
    name: `Relic: ${power.name}${input ? ` (${input})` : ""}`,
    icon: "icons/svg/item-bag.svg",
    changes,
    disabled: false,
    transfer: true,
    flags: { [MODULE_ID]: moduleFlags },
  }];
}

/* ── Loot Item Builders ────────────────────────────────── */

const ICONS = {
  // Gems
  gemUncommon:  "icons/commodities/gems/gem-faceted-diamond-blue.webp",
  gemRare:      "icons/commodities/gems/gem-rough-cushion-red.webp",
  gemVeryRare:  "icons/commodities/gems/gem-cut-square-green.webp",
  // Ingots
  ingotGold:    "icons/commodities/metal/ingot-gold.webp",
  ingotSilver:  "icons/commodities/metal/ingot-silver.webp",
  ingotCopper:  "icons/commodities/metal/ingot-copper.webp",
  ingotPlatinum:"icons/commodities/metal/ingot-hammered-gold.webp",
  // Trade goods
  spiceCommon:  "icons/consumables/food/spice-anise-pod.webp",
  spiceExotic:  "icons/consumables/food/salt-seasoning-spice-pink.webp",
  cloth:        "icons/commodities/cloth/cloth-bolt-gold.webp",
  // Art
  tapestry:     "icons/commodities/cloth/cloth-bolt-embroidered-pink.webp",
  painting:     "icons/commodities/treasure/bust-carved-stone.webp",
  figurine:     "icons/commodities/treasure/figurine-idol.webp",
  bust:         "icons/commodities/treasure/statue-bust-stone-grey.webp",
  pottery:      "icons/containers/kitchenware/mug-simple-wooden-brown.webp",
  artifact:     "icons/commodities/treasure/statue-gold-laurel-wreath.webp",
  // Jewelry
  amulet:       "icons/equipment/neck/amulet-round-gold-green.webp",
  bracelet:     "icons/equipment/wrist/bracelet-embossed-steel.webp",
  circlet:      "icons/equipment/head/circlet-gold-blue.webp",
  earring:      "icons/equipment/neck/pendant-faceted-gold-green.webp",
  locket:       "icons/equipment/neck/pendant-gold-crystal-blue.webp",
  monocle:      "icons/commodities/gems/gem-faceted-diamond-pink.webp",
  pendant:      "icons/equipment/neck/pendant-rough-gold-purple.webp",
  ring:         "icons/equipment/finger/ring-cabochon-gold-blue.webp",
  spectacles:   "icons/commodities/gems/gem-cluster-blue-white.webp",
  necklace:     "icons/equipment/neck/necklace-jeweled-gold-red.webp",
  beltBuckle:   "icons/equipment/waist/belt-buckle-gold.webp",
  barrette:     "icons/equipment/neck/necklace-simple-bone.webp",
  // Clothing
  belt:         "icons/equipment/waist/belt-leather-brown.webp",
  boots:        "icons/equipment/feet/boots-leather-brown.webp",
  cape:         "icons/equipment/back/cape-layered-red.webp",
  cloak:        "icons/equipment/back/cloak-collared-red-gold.webp",
  cowl:         "icons/equipment/head/circlet-gold-blue.webp",
  doublet:      "icons/equipment/chest/shirt-collared-brown.webp",
  dress:        "icons/equipment/chest/shirt-collared-green.webp",
  frock:        "icons/equipment/chest/shirt-simple-white.webp",
  girdle:       "icons/equipment/waist/belt-leather-studded-gold.webp",
  gloves:       "icons/equipment/hand/glove-leather-brown.webp",
  leggings:     "icons/equipment/leg/pants-leather-brown.webp",
  mantle:       "icons/equipment/back/cloak-layered-green.webp",
  pants:        "icons/equipment/leg/pants-leather-brown.webp",
  scarf:        "icons/commodities/cloth/cloth-roll-gold-green.webp",
  shirt:        "icons/equipment/chest/shirt-simple-white.webp",
  shoes:        "icons/equipment/feet/boots-leather-simple-blue.webp",
  skirt:        "icons/commodities/cloth/cloth-worn-gold.webp",
  tunic:        "icons/equipment/chest/shirt-collared-brown.webp",
  vest:         "icons/equipment/chest/shirt-collared-green.webp",
  vestments:    "icons/equipment/back/cloak-hooded-red.webp",
  // Scrolls
  scroll:       "icons/sundries/scrolls/scroll-bound-gold.webp",
};

// Jewelry icon lookup by JEWELRY table entry index
const JEWELRY_ICONS = {
  1: ICONS.amulet,     // Amulet / Necklace
  2: ICONS.beltBuckle, // Belt buckle, decorative
  3: ICONS.barrette,   // Barrette
  4: ICONS.bracelet,   // Bracelet
  5: ICONS.circlet,    // Circlet
  6: ICONS.earring,    // Earring
  7: ICONS.locket,     // Locket
  8: ICONS.monocle,    // Monocle
  9: ICONS.pendant,    // Pendant
  10: ICONS.ring,      // Ring
  11: ICONS.spectacles,// Spectacles
  12: null,            // →Clothing (redirect)
};

// Clothing icon lookup by CLOTHING table entry index
const CLOTHING_ICONS = {
  1: ICONS.belt,    2: ICONS.boots,    3: ICONS.cape,     4: ICONS.cloak,
  5: ICONS.cowl,    6: ICONS.doublet,  7: ICONS.dress,    8: ICONS.frock,
  9: ICONS.girdle,  10: ICONS.gloves,  11: ICONS.leggings,12: ICONS.mantle,
  13: ICONS.pants,  14: ICONS.scarf,   15: ICONS.shirt,   16: ICONS.shoes,
  17: ICONS.skirt,  18: ICONS.tunic,   19: ICONS.vest,    20: ICONS.vestments,
};

// Art icon lookup by ART table entry index
const ART_ICONS = {
  1: ICONS.tapestry, 2: ICONS.painting, 3: ICONS.painting,
  4: ICONS.figurine, 5: ICONS.bust, 6: ICONS.pottery,
  7: ICONS.pottery, 8: ICONS.artifact,
};

/** Build an equipment itemData object for loot.
 *
 * `cost` may be either a flat number (treated as gold for backward
 * compatibility with existing callers) or a `{ gold, silver, copper }`
 * object — use the object form when the value isn't a clean gold
 * amount, e.g. spices and copper ingots that are priced in silver
 * or copper in the system compendium.
 */
function _lootItem(name, img, cost, slots = 0, description = "") {
  const baseCost = (typeof cost === "number")
    ? { gold: cost, silver: 0, copper: 0 }
    : { gold:   cost?.gold   ?? 0,
        silver: cost?.silver ?? 0,
        copper: cost?.copper ?? 0 };
  return {
    name,
    type: "equipment",
    img: img || "icons/svg/item-bag.svg",
    system: {
      description: description ? `<p>${description}</p>` : "",
      equipmentType: "gear",
      quantity: 1,
      baseSlots: slots,
      baseCost,
      gearCategory: "Loot",
      isConsumable: false,
    },
  };
}

/** Relic power gold values from the Vagabond core book (p.148-154). */
const POWER_VALUES = {
  // Bonus
  "+1": 100, "+2": 1250, "+3": 5000,
  "Weapon +1": 100, "Weapon +2": 1250, "Weapon +3": 5000,
  "Armor +1": 100, "Armor +2": 5000, "Armor +3": 50000,
  "Protection +1": 1000, "Protection +2": 10000, "Protection +3": 100000,
  "Trinket +1": 200, "Trinket +2": 2500, "Trinket +3": 10000,
  // Strike
  "Strike 1": 1000, "Strike 2": 2500, "Strike 3": 8000,
  // Bane
  "Bane Niche": 500, "Bane, Niche": 500, "Bane, Specific": 2000, "Bane, General": 5000,
  "Bane Specific": 2000, "Bane General": 5000, "Bane of Last Fought": 500,
  // Protection (relic)
  "Protection Niche": 500, "Protection, Niche": 500, "Protection vs Last Fought": 500,
  "Protection Specific": 2000, "Protection, Specific": 2000,
  "Protection General": 5000, "Protection, General": 5000,
  // Resistance
  "Bravery": 150, "Clarity": 150, "Repulsing": 150, "Resistance": 2500,
  "Acid Resist": 2500, "Cold Resist": 2500, "Fire Resist": 2500, "Poison Resist": 2500, "Shock Resist": 2500,
  // Movement
  "Swiftness 1": 250, "Swiftness 2": 1000, "Swiftness 3": 5000,
  "Climbing": 500, "Clinging": 2500, "Jumping 1": 500, "Jumping 2": 2500, "Jumping 3": 12500,
  "Levitation": 500, "Displacement": 1000, "Blinking": 2000, "Flying": 5000,
  "Waterwalk": 500, "Webwalk": 500,
  // Senses
  "Nightvision": 100, "Echolocation": 250, "Tremors": 1000, "Detection": 5000,
  "Sense Life": 10000, "Sense Valuables": 10000, "Telepathy": 10000, "True-Seeing": 20000,
  // Ace
  "Ace": 1500, "Brutal": 2000, "Cleave": 2000, "Entangle": 1000, "Keen": 2000, "Long": 1000, "Thrown": 2000,
  // Utility (avg by tier)
  "After-Image 1": 500, "After-Image 2": 2500, "Ambassador": 1250, "Aqua Lung": 5000,
  "Burning 1": 4000, "Burning 2": 15000, "Burning 3": 64000,
  "Darkness 1": 500, "Darkness 2": 1250, "Darkness 3": 5000,
  "Moonlight 1": 500, "Moonlight 2": 1250, "Moonlight 3": 5000, "Moonlit 1": 500, "Moonlit 2": 1250, "Moonlit 3": 5000,
  "Radiant 1": 2000, "Radiant 2": 5000, "Radiant 3": 20000,
  "Infinite": 1000, "Loyalty": 1000, "Warning": 7500,
  "Lifesteal 1": 1000, "Lifesteal 2": 12500, "Lifesteal 3": 50000,
  "Manasteal 1": 5000, "Manasteal 2": 20000, "Manasteal 3": 50000,
  "Invisibility 1": 5000, "Invisibility 2": 50000,
  // Fabled
  "Benediction": 50000, "Blasting": 5000, "Precision": 10000,
  "Soul Eater": 50000, "Soul-Eater": 50000, "Vicious": 25000, "Vorpal": 50000,
  // Material (multiplier value rough estimate for the item, not additive)
  "Silver": 100, "Cold Iron": 200, "Adamant": 500, "Mythral": 500, "Orichalcum": 500,
};

/** Look up the gold value of a relic power string. Case-insensitive with prefix stripping. */
function _powerGoldValue(powerText) {
  if (!powerText) return 0;
  // Build case-insensitive lookup on first call
  if (!_powerGoldValue._map) {
    _powerGoldValue._map = {};
    for (const [k, v] of Object.entries(POWER_VALUES)) _powerGoldValue._map[k.toLowerCase()] = v;
  }
  const map = _powerGoldValue._map;
  const lower = powerText.toLowerCase();
  // Direct match
  if (map[lower] !== undefined) return map[lower];
  // Strip common prefixes: "of Climbing" → "climbing", "(Strike 1)" → "strike 1", "(Ace)" → "ace"
  const stripped = lower.replace(/^\(|\)$/g, "").replace(/^of\s+/i, "").replace(/^bane of\s+/i, "bane ").trim();
  if (map[stripped] !== undefined) return map[stripped];
  // "Protection vs [creature]" or "Protection, Niche" → look up by tier
  if (lower.startsWith("protection")) {
    if (lower.includes("niche") || lower.includes("last fought") || lower.includes("unknown foe")) return 500;
    const creature = lower.replace("protection vs ", "");
    if (!creature.includes(",")) return 5000;  // General (whole type)
    return 2000;  // Specific (subtype with comma)
  }
  // "Bane of [creature]" or "Bane, Niche" → same tier logic
  if (lower.startsWith("bane")) {
    if (lower.includes("niche") || lower.includes("last fought")) return 500;
    const creature = lower.replace(/^bane (of )?/, "");
    if (!creature.includes(",")) return 5000;  // General
    return 2000;  // Specific
  }
  // Try each known power as a substring
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return 0;
}

/** Add relic power value to an item's baseCost. */
function _addPowerValue(itemData, powerText, material) {
  const powerGold = _powerGoldValue(powerText);
  const matGold = (material && material !== "Mundane") ? (_powerGoldValue(material)) : 0;
  const extraGold = powerGold + matGold;
  if (extraGold > 0) {
    const bc = itemData.system.baseCost ?? { gold: 0, silver: 0, copper: 0 };
    const totalCopper = (bc.gold ?? 0) * 10000 + (bc.silver ?? 0) * 100 + (bc.copper ?? 0) + extraGold * 10000;
    itemData.system.baseCost = {
      gold: Math.floor(totalCopper / 10000),
      silver: Math.floor((totalCopper % 10000) / 100),
      copper: totalCopper % 100,
    };
  }
}

/** Build a gem loot item. Per-unit baseCost — `quantity` scales the
 *  stack value at sell time. Older code did `valueGold * qty` AND
 *  `system.quantity = qty`, which made selling a stack of N pay
 *  out N×N times the unit value. We DON'T bake `×N` into the name
 *  because the inventory render patch already adds an `×N` badge from
 *  `system.quantity` — having both produces "Uncommon Gem ×2 ×2". */
function _gemItem(rarity, valueGold, qty = 1) {
  const icon = rarity === "Uncommon" ? ICONS.gemUncommon
    : rarity === "Rare" ? ICONS.gemRare : ICONS.gemVeryRare;
  const item = _lootItem(
    `${rarity} Gem`,
    icon, valueGold, 0,
    `${rarity} gemstone worth ${valueGold}g each.`,
  );
  if (qty > 1) item.system.quantity = qty;
  return item;
}

/** Build a trade goods loot item from the TRADE_GOODS table. */
function _tradeGoodItem(entry, qty) {
  let icon = ICONS.cloth;
  let name = entry;
  if (entry.includes("Spice, Common")) { icon = ICONS.spiceCommon; name = "Common Spice"; }
  else if (entry.includes("Spice, Exotic")) { icon = ICONS.spiceExotic; name = "Exotic Spice"; }
  else if (entry.includes("Spice, Rare")) { icon = ICONS.spiceExotic; name = "Rare Spice"; }
  else if (entry.includes("Ingots, Copper")) { icon = ICONS.ingotCopper; name = "Copper Ingot"; }
  else if (entry.includes("Ingots, Silver")) { icon = ICONS.ingotSilver; name = "Silver Ingot"; }
  else if (entry.includes("Ingot, Gold") || entry.includes("Ingots, Gold")) { icon = ICONS.ingotGold; name = "Gold Ingot"; }
  else if (entry.includes("Platinum")) { icon = ICONS.ingotPlatinum; name = "Platinum Ingot"; }

  // Estimate value: spices ~1-10g, copper ingots ~1g, silver ~10g, gold ~100g, platinum ~5000g.
  // IMPORTANT — per-unit, NOT per-stack. The merchant code reads `baseCost`
  // as a unit price and multiplies it by the sale `quantity`. Older code
  // here pre-multiplied (`unitVal * qty`) and ALSO set `system.quantity =
  // qty`, which made selling a stack pay out the per-unit price × stack
  // size × stack size. Keep `baseCost` as the per-unit price — `quantity`
  // alone scales the stack value.
  const values = {
    "Common Spice": 1, "Exotic Spice": 5, "Rare Spice": 10,
    "Copper Ingot": 1, "Silver Ingot": 10, "Gold Ingot": 100, "Platinum Ingot": 5000,
  };
  const unitVal = values[name] || 5;

  // Don't bake `×N` into the name — the inventory render patch already
  // adds an `×N` badge from `system.quantity`. Having both produces
  // "Exotic Spice ×11 ×11" / "Copper Ingot ×20 ×12" in the merchant UI.
  const item = _lootItem(
    name,
    icon, unitVal, 1,
    `Trade goods: ${entry}.`,
  );
  if (qty > 1) item.system.quantity = qty;
  return item;
}

/** Create a random spell scroll for a given mana cost. */
async function _createSpellScroll(manaCost) {
  const pack = game.packs.get("vagabond.spells");
  if (!pack) return null;

  // Get all spells and pick one that fits this mana cost
  // Mana cost = delivery cost + damage dice cost + fx cost
  // For simplicity: pick a random spell and configure it at base (1 die, touch, no fx)
  // so the mana comes from delivery cost alone, or pick any spell for the given level
  const docs = await _getCompendiumItems("vagabond.spells");
  if (!docs.length) return null;

  // Pick a random spell
  const spell = docs[Math.floor(Math.random() * docs.length)];
  const goldValue = 5 + 5 * manaCost;

  const deliveryType = spell.system?.deliveryType ?? "touch";
  const deliveryName = CONFIG.VAGABOND?.deliveryTypes?.[deliveryType] ?? deliveryType;

  const scrollData = {
    spellName: spell.name,
    spellUuid: spell.uuid,
    spellImg: spell.img,
    damageType: spell.system?.damageType ?? "-",
    damageDice: 1,
    deliveryType,
    deliveryIncrease: 0,
    useFx: false,
    manaCost,
    deliveryText: deliveryName,
    causedStatuses: spell.system?.causedStatuses ?? [],
    critCausedStatuses: spell.system?.critCausedStatuses ?? [],
    canExplode: spell.system?.canExplode ?? false,
    explodeValues: spell.system?.explodeValues ?? "",
  };

  return {
    name: `Scroll of ${spell.name}`,
    type: "equipment",
    img: spell.img || ICONS.scroll,
    system: {
      description: `<p><strong>Spell Scroll</strong> (${deliveryName})</p><p>${spell.system?.description ?? ""}</p><p><em>Reading this scroll casts the spell. No Mana cost, no Cast Check. The scroll vaporizes after use.</em></p>`,
      equipmentType: "gear",
      isConsumable: true,
      quantity: 1,
      baseSlots: 0,
      baseCost: { gold: goldValue, silver: 0, copper: 0 },
      gearCategory: "Scrolls",
      lore: "Relic Parchment",
    },
    flags: { [MODULE_ID]: { spellScroll: scrollData } },
  };
}

/**
 * Build a Relic: +N Enchantment Scroll — a one-shot consumable that, when
 * used, lets the owner apply a `bonus-weapon-N` / `bonus-armor-N` /
 * `bonus-trinket-N` relic power to an item they own.
 *
 * NOT to be confused with a spell scroll for the "Enchant" spell (see
 * `_createSpellScroll` above). Both can end up with similar-looking names
 * like "Scroll of Enchant" vs "+1 Enchantment Scroll" — the distinguishing
 * feature is the `flags["vagabond-crawler"].enchantmentScroll` marker below.
 *
 * @param {number} bonus — +1 / +2 / +3 tier
 * @returns {object} itemData ready for createEmbeddedDocuments
 */
function _createEnchantmentScroll(bonus = 1) {
  const tierCost = { 1: 100, 2: 1250, 3: 5000 };
  const goldValue = tierCost[bonus] ?? 100;
  return {
    name: `+${bonus} Enchantment Scroll`,
    type: "equipment",
    img: ICONS.scroll,
    system: {
      description:
        `<p><strong>Relic: +${bonus} Enchantment Scroll</strong></p>` +
        `<p>Right-click this scroll and choose <em>Use Scroll</em> to permanently ` +
        `apply a <strong>+${bonus}</strong> enchantment to an equipped weapon, ` +
        `armor, or trinket you own. The scroll is consumed on use.</p>` +
        `<p><em>Weapons gain +${bonus} damage. Armor gains +${bonus} Armor. ` +
        `Trinkets gain +${bonus} spell damage.</em></p>`,
      equipmentType: "gear",
      isConsumable: true,
      quantity: 1,
      baseSlots: 1,
      baseCost: { gold: goldValue, silver: 0, copper: 0 },
      gearCategory: "Scrolls",
      lore: "Enchantment Scroll",
    },
    flags: {
      [MODULE_ID]: {
        enchantmentScroll: { bonus },
      },
    },
  };
}

/** Get a random hostile NPC name from the most recent combat, or a random world NPC. */
function _lastFoughtName() {
  // Try active combat first, then most recent
  const combats = game.combats?.contents ?? [];
  const combat = combats.find(c => c.active) ?? combats[combats.length - 1];
  if (combat) {
    const hostiles = combat.combatants.filter(c =>
      c.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
    );
    if (hostiles.length) {
      const pick = hostiles[Math.floor(Math.random() * hostiles.length)];
      if (pick.name) return pick.name;
    }
  }

  // Fallback: pick a random NPC from the world
  const npcs = game.actors.filter(a => a.type === "npc");
  if (npcs.length) {
    return npcs[Math.floor(Math.random() * npcs.length)].name;
  }

  return "Unknown Foe";
}

/** Resolve a raw power table entry into a concrete power name by rolling sub-tables.
 *  E.g. "Movement (d6)" → "Climbing", "Utility (d4)" → "After-Image 1"
 *  @param {string} rawPower — raw text from WEAPON_POWER or ARMOR_POWER
 *  @param {"weapon"|"armor"} [powerTable="weapon"] — which power table for Reroll/Add
 *  @param {number} [depth=0] — recursion guard */
async function _resolveRawPower(rawPower, powerTable = "weapon", depth = 0) {
  if (!rawPower) return { display: "", powerText: "" };

  const _roll = async (f) => { const r = new Roll(f); await r.evaluate(); return r.total; };

  // Already resolved (from app path) or simple entries
  if (rawPower.startsWith("Weapon +") || rawPower.startsWith("Weapon/Trinket +")) {
    const display = rawPower.replace("Weapon/Trinket ", "").replace("Weapon ", "");
    return { display, powerText: rawPower };
  }
  if (rawPower.includes("Armor +") || rawPower.includes("Protection +")) {
    return { display: rawPower, powerText: rawPower };
  }
  if (rawPower.startsWith("Strike")) return { display: `(${rawPower})`, powerText: rawPower };
  if (rawPower.startsWith("Ace")) return { display: "(Ace)", powerText: "Ace" };
  if (rawPower.startsWith("Fabled")) return { display: `(${rawPower})`, powerText: rawPower };

  // Niche — resolve to last fought
  if (rawPower.includes("Niche")) {
    const name = _lastFoughtName();
    const isBane = rawPower.includes("Bane");
    const prefix = isBane ? "Bane of" : "Protection vs";
    return { display: `${prefix} ${name}`, powerText: `${prefix} ${name} (Niche)` };
  }

  // Sub-table rolls
  if (rawPower.startsWith("Movement")) {
    const m = rawPower.match(/\((.+?)\)/); const d = m ? m[1] : "1d6";
    const v = await _roll(d);
    const clamped = Math.min(v, 14);  // MOVEMENT table max is 14
    const name = MOVEMENT[clamped] || MOVEMENT[14];
    return { display: `of ${name}`, powerText: name };
  }
  if (rawPower.startsWith("Resistance")) {
    const d = rawPower.includes("d8") ? "1d8" : rawPower.includes("d4") ? "1d4" : "1d3";
    let v = await _roll(d);
    // "reroll 4s" or "reroll 1-3s" instructions from the table
    if (rawPower.includes("reroll 4") && v === 4) v = await _roll("1d3");
    if (rawPower.includes("reroll 1-3") && v <= 3) v = 3 + await _roll("1d5"); // push into armor resistance 4-8
    const name = (v <= 3 ? WEAPON_RESISTANCE : ARMOR_RESISTANCE)?.[v] || `Resistance ${v}`;
    return { display: `of ${name}`, powerText: name };
  }
  if (rawPower.startsWith("Senses")) {
    const m = rawPower.match(/\((.+?)\)/); const d = m ? m[1] : "1d4";
    const v = await _roll(d);
    const name = SENSES[v] || `Senses ${v}`;
    return { display: `of ${name}`, powerText: name };
  }
  if (rawPower.startsWith("Utility")) {
    const m = rawPower.match(/\((.+?)\)/); const d = m ? m[1] : "1d8";
    const v = await _roll(d);
    // Check weapon or armor utility based on dice range
    const name = WEAPON_UTILITY?.[v] || ARMOR_UTILITY?.[v] || `Utility ${v}`;
    return { display: `of ${name}`, powerText: name };
  }
  if (rawPower.startsWith("Bane, General")) {
    const v = await _roll("1d8");
    const name = CREATURE_GENERAL[v] || "Unknown";
    return { display: `Bane of ${name}`, powerText: `Bane of ${name}` };
  }
  if (rawPower.startsWith("Bane, Specific")) {
    const v = await _roll("1d40");
    const name = CREATURE_SPECIFIC[v] || "Unknown";
    return { display: `Bane of ${name}`, powerText: `Bane of ${name}` };
  }
  if (rawPower.startsWith("Protection, General")) {
    const v = await _roll("1d8");
    const name = CREATURE_GENERAL[v] || "Unknown";
    return { display: `of Protection vs ${name}`, powerText: `Protection vs ${name}` };
  }
  if (rawPower.startsWith("Protection, Specific")) {
    const v = await _roll("1d40");
    const name = CREATURE_SPECIFIC[v] || "Unknown";
    return { display: `of Protection vs ${name}`, powerText: `Protection vs ${name}` };
  }
  if (rawPower.startsWith("Material")) {
    // Material table — handled separately via metal
    return { display: "", powerText: rawPower };
  }
  // Meta: "Reroll as d8, twice" → roll twice on range, pick results
  // "Add d10 to this roll" → add d10 to current power index
  // "Reroll d8, d8+9, d8+19, d8+29" → roll on multiple ranges, combine
  if ((rawPower.startsWith("Reroll") || rawPower.startsWith("Add ")) && depth < 3) {
    const _roll = async (f) => { const r = new Roll(f); await r.evaluate(); return r.total; };
    const TABLE = powerTable === "armor" ? ARMOR_POWER : WEAPON_POWER;

    if (rawPower.startsWith("Add d")) {
      // "Add d10 to this roll" — we don't know the original roll, estimate mid-range
      const diceMatch = rawPower.match(/d(\d+)/);
      const bonus = diceMatch ? await _roll(`1d${diceMatch[1]}`) : 5;
      // Re-resolve from a higher entry
      const newIdx = Math.min(Object.keys(TABLE).length, 10 + bonus); // rough offset
      const newPower = TABLE[newIdx];
      if (newPower) return _resolveRawPower(newPower, powerTable, depth + 1);
    }

    // "Reroll as d8, twice" or "Reroll as d8+10, twice" etc.
    const rerollMatch = rawPower.match(/Reroll\s+(?:as\s+)?([\dd+,\s]+?)(?:,?\s*twice)?$/i);
    if (rerollMatch) {
      const formulas = rerollMatch[1].split(",").map(s => s.trim()).filter(Boolean);
      // Roll on each formula, take the best result
      let bestDisplay = "";
      let bestPowerText = "";
      let bestValue = 0;
      for (const formula of formulas) {
        const idx = await _roll(formula);
        const entry = TABLE[idx];
        if (entry) {
          const result = await _resolveRawPower(entry, powerTable, depth + 1);
          const val = _powerGoldValue(result.powerText);
          if (val > bestValue) {
            bestValue = val;
            bestDisplay = result.display;
            bestPowerText = result.powerText;
          }
        }
      }
      if (bestDisplay) return { display: bestDisplay, powerText: bestPowerText };
    }

    // Fallback: couldn't parse the reroll instruction
    return { display: "", powerText: rawPower };
  }

  return { display: rawPower, powerText: rawPower };
}

/** After resolving a power, build the AE effects for it. */
function _buildEffectsForPower(powerText, input = "") {
  const power = _findRelicPower(powerText);
  if (!power) return [];
  // For typed resistance, extract the element from the power text
  if (power.id === "resistance-typed" && !input) {
    const match = powerText.match(/(acid|cold|fire|poison|shock)/i);
    input = match ? match[1] : "";
  }
  return _buildRelicEffects(power, input);
}

/* ── Compendium item cache ─────────────────────────────── */

const _compendiumCache = {};

async function _getCompendiumItems(packId) {
  if (_compendiumCache[packId]) return _compendiumCache[packId];
  const pack = game.packs.get(packId);
  if (!pack) return [];
  const docs = await pack.getDocuments();
  _compendiumCache[packId] = docs;
  return docs;
}

/** Normalize apostrophes (curly → straight) for matching. */
function _norm(s) { return s.toLowerCase().replace(/[\u2018\u2019\u201A\u201B]/g, "'"); }

async function _findCompendiumItem(packId, name) {
  const docs = await _getCompendiumItems(packId);
  const lower = _norm(name);
  return docs.find(d => _norm(d.name) === lower)
    || docs.find(d => _norm(d.name).includes(lower));
}

/* ── Singleton accessor ─────────────────────────────────── */

let _app = null;

export const LootGenerator = {
  init() {
    // Claim/Pass buttons on GM-only Roll Loot chat cards
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const flags = message.flags?.["vagabond-crawler"];
      if (!flags?.lootGeneratorCard) return;
      if (!game.user.isGM) return;  // Roll Loot cards are GM-controlled

      const claimBtn = html.querySelector(".vcl-drops-claim-btn");
      const passBtn = html.querySelector(".vcl-drops-pass-btn");
      const actions = html.querySelector(".vcl-drops-actions");

      // Locked states
      if (flags.claimed) {
        if (actions) actions.innerHTML = `<span class="vcl-drops-status vcl-drops-status--claimed"><i class="fas fa-check"></i> Claimed by ${flags.claimedByName ?? "???"}</span>`;
        return;
      }
      if (flags.passed) {
        if (actions) actions.innerHTML = `<span class="vcl-drops-status"><i class="fas fa-arrow-right-arrow-left"></i> Passed to party</span>`;
        return;
      }

      claimBtn?.addEventListener("click", async () => {
        // GM picks a recipient via dropdown dialog
        const players = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
        if (!players.length) {
          ui.notifications.warn("No player-owned characters in the world.");
          return;
        }
        const options = players.map(a => `<option value="${a.id}">${a.name}</option>`).join("");
        const recipientId = await new Promise(resolve => {
          new foundry.applications.api.DialogV2({
            window: { title: "Claim Loot — Pick Recipient" },
            content: `<div style="padding:8px;"><label>Give to: <select name="recipient" style="width:100%;margin-top:4px;">${options}</select></label></div>`,
            buttons: [
              { action: "ok", label: "Give", default: true, callback: (_e, b, dlg) => dlg.element.querySelector('select[name="recipient"]').value },
              { action: "cancel", label: "Cancel", callback: () => null },
            ],
            submit: r => resolve(r),
          }).render({ force: true });
        });
        if (!recipientId) return;
        await LootGenerator._handleRollLootClaim(message.id, recipientId);
      });

      passBtn?.addEventListener("click", async () => {
        await LootGenerator._handleRollLootPass(message.id);
      });
    });

    // Claim buttons on whispered loot cards (Roll for Selected Token)
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const flags = message.flags?.[MODULE_ID];
      if (!flags?.lootClaimCard) return;

      const claimBtn = html.querySelector(".vcl-drops-claim-btn");
      const actions = html.querySelector(".vcl-drops-actions");

      if (flags.claimed) {
        if (actions) actions.innerHTML = `<span class="vcl-drops-status vcl-drops-status--claimed"><i class="fas fa-check"></i> Claimed by ${flags.claimedBy ?? "???"}</span>`;
        return;
      }
      if (flags.passed) {
        if (actions) actions.innerHTML = `<span class="vcl-drops-status"><i class="fas fa-arrow-right-arrow-left"></i> Passed to party</span>`;
        return;
      }

      if (!claimBtn) return;

      claimBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const actor = game.actors.get(flags.actorId);
        if (!actor?.isOwner && !game.user.isGM) {
          ui.notifications.warn("You don't own this character.");
          return;
        }

        claimBtn.disabled = true;
        claimBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Claiming\u2026`;

        const payload = {
          action: "claimLoot",
          messageId: message.id,
          actorId: flags.actorId,
          userId: game.user.id,
        };

        if (game.user.isGM) {
          await LootGenerator._handleClaim(payload);
        } else {
          game.socket.emit(LOOT_SOCKET, payload);
        }
      });
    });

    // Pass buttons on Roll-for-Selected-Token whisper cards
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const flags = message.flags?.[MODULE_ID];
      if (!flags?.lootClaimCard) return;
      if (flags.passed) return;  // already passed — claim btn handler shows status

      const passBtn = html.querySelector(".vcl-drops-pass-btn");
      if (!passBtn) return;

      const actor = game.actors.get(flags.actorId);
      if (!actor?.isOwner && !game.user.isGM) {
        passBtn.disabled = true;
        return;
      }

      passBtn.addEventListener("click", async () => {
        passBtn.disabled = true;
        await LootGenerator._handleRollForTokenPass(message.id);
      });
    });

    // Socket handler (GM only)
    game.socket.on(LOOT_SOCKET, async (data) => {
      if (!game.user.isGM) return;
      if (data.action === "claimLoot") {
        await LootGenerator._handleClaim(data);
      } else if (data.action === "rollForTokenPass") {
        await LootGenerator._handleRollForTokenPass(data.messageId);
      }
    });
  },

  /* ── Roll Loot card: GM picks recipient via dialog, then transfers ── */
  async _handleRollLootClaim(messageId, recipientId) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.["vagabond-crawler"];
    if (!flags?.lootGeneratorCard || flags.claimed || flags.passed) return;

    const recipient = game.actors.get(recipientId);
    if (!recipient) return;

    await message.update({
      [`flags.vagabond-crawler.claimed`]: true,
      [`flags.vagabond-crawler.claimedByName`]: recipient.name,
    });

    for (const itemData of flags.itemData ?? []) {
      await Item.create(itemData, { parent: recipient });
    }

    await LootTracker.logClaim(
      recipient.name,
      flags.sourceLabel || "Loot Generator",
      { gold: 0, silver: 0, copper: 0 },
      (flags.itemData ?? []).map(d => ({ name: d.name, img: d.img })),
    );

    ui.notifications.info(`${recipient.name} claimed loot from ${flags.sourceLabel || "Loot Generator"}.`);
  },

  /* ── Roll Loot card: emit public pool card for any player to claim ── */
  async _handleRollLootPass(messageId) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.["vagabond-crawler"];
    if (!flags?.lootGeneratorCard || flags.claimed || flags.passed) return;

    await message.update({ [`flags.vagabond-crawler.passed`]: true });

    // Emit public pool card via LootDrops singleton
    const lc = game.vagabondCrawler?.lootDrops;
    if (!lc) return;
    const passer = { name: "GM", id: game.user.id };
    await lc._emitPoolCard(
      passer,
      flags.sourceLabel || "Loot Generator",
      { gold: 0, silver: 0, copper: 0 },
      flags.itemData ?? [],
      flags.trace ?? [],
    );
  },

  /* ── Roll for Selected Token card: pass to public pool ── */
  async _handleRollForTokenPass(messageId) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootClaimCard || flags.claimed || flags.passed) return;

    if (!game.user.isGM) {
      // Players forward to GM via socket
      game.socket.emit(LOOT_SOCKET, { action: "rollForTokenPass", messageId });
      return;
    }

    await message.update({ [`flags.${MODULE_ID}.passed`]: true });

    const lc = game.vagabondCrawler?.lootDrops;
    if (!lc) return;
    const passer = game.actors.get(flags.actorId) ?? { name: "GM", id: game.user.id };
    await lc._emitPoolCard(
      passer,
      `Loot Roll (Lv${flags.level})`,
      flags.currency ?? { gold: 0, silver: 0, copper: 0 },
      flags.itemData ?? [],
      flags.trace ?? [],
    );
  },

  /**
   * Handle a loot claim from a player (runs on GM client).
   */
  async _handleClaim({ messageId, actorId, userId }) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const flags = message.flags?.[MODULE_ID];
    if (!flags?.lootClaimCard || flags.claimed) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    const user = game.users.get(userId);
    if (!user || !actor.testUserPermission(user, "OWNER")) {
      console.warn(`${MODULE_ID} | Claim denied: user does not own actor`);
      return;
    }

    // Mark claimed immediately to prevent race conditions
    await message.update({
      [`flags.${MODULE_ID}.claimed`]: true,
      [`flags.${MODULE_ID}.claimedBy`]: user.name,
    });

    // Add items to actor
    const itemData = flags.itemData;
    if (itemData?.length) {
      for (const data of itemData) {
        await Item.create(data, { parent: actor });
      }
    }

    // Add currency to actor
    const currency = flags.currency;
    if (currency) {
      const cur = actor.system.currency ?? {};
      const updates = {};
      if (currency.gold) updates["system.currency.gold"] = (cur.gold ?? 0) + currency.gold;
      if (currency.silver) updates["system.currency.silver"] = (cur.silver ?? 0) + currency.silver;
      if (currency.copper) updates["system.currency.copper"] = (cur.copper ?? 0) + currency.copper;
      if (Object.keys(updates).length) await actor.update(updates);
    }

    // Flip the previously-logged unclaimed drop entries to claimed. If the
    // original drop wasn't logged (card predates drop-tracking), fall back
    // to a logClaim so the item still appears in the recap.
    const preEntries = SessionRecap.getData()?.loot ?? [];
    const hadDropEntry = preEntries.some(e => e.messageId === messageId);
    if (hadDropEntry) {
      await LootTracker.markClaimed(messageId, actor.name);
    } else {
      await LootTracker.logClaim(
        actor.name,
        `Loot Roll (Lv${flags.level})`,
        currency ?? { gold: 0, silver: 0, copper: 0 },
        (itemData ?? []).map(d => ({ name: d.name, img: d.img })),
      );
    }

    // Mark claimed via flags — the renderChatMessageHTML hook flips the UI to
    // the locked "Claimed by X" status block on next render and on reload.
    await message.update({ [`flags.${MODULE_ID}.claimedBy`]: user.name });

    ui.notifications.info(`${actor.name} claimed loot from Level ${flags.level} roll.`);
  },

  /**
   * Roll loot for a selected token and whisper the result.
   * @param {Token|null} [token] — token to roll for; defaults to first controlled token
   * @param {number|null} [level] — override level; defaults to the Hero Level dropdown or actor level
   */
  async rollForToken(token, level) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can roll loot.");
      return;
    }

    if (!token) token = canvas.tokens.controlled[0];
    if (!token) {
      ui.notifications.warn("Select a token first.");
      return;
    }

    const actor = token.actor;
    if (!actor) {
      ui.notifications.error("Token has no actor.");
      return;
    }

    const rawLevel = level ?? _app?._level ?? actor.system?.attributes?.level?.value ?? 1;
    const clampedLevel = Math.max(1, Math.min(10, rawLevel));

    // Generate loot using the headless engine (defined below in this module)
    const result = await generateLevelLoot(clampedLevel);
    if (!result) {
      ui.notifications.warn("Loot generation failed.");
      return;
    }

    const { currency, items, trace } = result;

    // Build the chat card content
    const itemLines = items.map(d => {
      const bc = d.system?.baseCost;
      const valParts = [];
      if (bc?.gold)   valParts.push(`${bc.gold}g`);
      if (bc?.silver) valParts.push(`${bc.silver}s`);
      if (bc?.copper) valParts.push(`${bc.copper}c`);
      const valStr = valParts.length ? ` (${valParts.join(" ")})` : "";
      // Surface stack qty in the loot card. Trade goods and gems no
      // longer bake `×N` into the name (the inventory badge handles
      // that), so the card has to show qty explicitly or the player
      // can't see they got a stack.
      const qty = d.system?.quantity ?? 1;
      const qtyStr = qty > 1 ? ` ×${qty}` : "";
      return `<div class="vcl-gen-claim-item">
        <img src="${d.img || "icons/svg/item-bag.svg"}" width="24" height="24" />
        <span>${d.name}${qtyStr}${valStr}</span>
      </div>`;
    }).join("");

    const currParts = [];
    if (currency.gold) currParts.push(`${currency.gold} Gold`);
    if (currency.silver) currParts.push(`${currency.silver} Silver`);
    if (currency.copper) currParts.push(`${currency.copper} Copper`);
    const currencyLine = currParts.length
      ? `<div class="vcl-gen-claim-item"><i class="fas fa-coins" style="width:24px;text-align:center;color:inherit;"></i> <span>${currParts.join(", ")}</span></div>`
      : "";

    const hasLoot = items.length > 0 || currParts.length > 0;
    if (!hasLoot) {
      ui.notifications.info(`Level ${clampedLevel} roll for ${actor.name}: nothing found.`);
      return;
    }

    const lootIcon = items[0]?.img || "icons/svg/item-bag.svg";

    const traceHtml = renderTraceHtml(trace);

    const cardContent = `
      <div class="vagabond-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${lootIcon}" alt="Loot">
            </div>
            <div class="header-info">
              <h3 class="header-title">Level ${clampedLevel} Loot</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${actor.name}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 8px;">
              ${traceHtml}
              ${currencyLine}
              ${itemLines}
            </div>
            <div class="vcl-drops-actions" style="padding:4px 8px 8px;">
              <button type="button" class="vcl-gen-claim-btn vcl-drops-claim-btn">
                <i class="fas fa-hand-holding"></i> Claim Loot
              </button>
              <button type="button" class="vcl-gen-claim-btn vcl-drops-pass-btn">
                <i class="fas fa-arrow-right-arrow-left"></i> Pass Loot
              </button>
            </div>
          </section>
        </div>
      </div>`;

    // Determine whisper targets
    const owningPlayer = game.users.find(
      u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER")
    );
    const whisperTargets = [game.user.id];
    if (owningPlayer) whisperTargets.push(owningPlayer.id);

    const claimMessage = await ChatMessage.create({
      content: cardContent,
      whisper: whisperTargets,
      speaker: ChatMessage.getSpeaker({ token: token.document ?? token }),
      flags: {
        [MODULE_ID]: {
          lootClaimCard: true,
          itemData: items,
          currency,
          actorId: actor.id,
          level: clampedLevel,
          trace,
          claimed: false,
          passed: false,
        },
      },
    });

    // Log as unclaimed so the session recap captures rolls that are never
    // claimed. The Claim button handler flips these entries to claimed via
    // LootTracker.markClaimed(messageId).
    await LootTracker.logDrop({
      messageId: claimMessage.id,
      playerName: actor.name,
      sourceName: `Loot Roll (Lv${clampedLevel})`,
      currency: currency ?? { gold: 0, silver: 0, copper: 0 },
      items: (items ?? []).map(d => ({ name: d.name, img: d.img })),
    });
  },

  open() {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can use the Loot Generator.");
      return;
    }
    if (!_app) _app = new LootGeneratorApp();
    _app.render(true);
  },
};

/* ── ApplicationV2 window ───────────────────────────────── */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class LootGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-loot-generator",
    window: { title: "Loot Generator", resizable: true },
    position: { width: 540, height: "auto" },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/loot-generator.hbs" },
  };

  constructor(...args) {
    super(...args);
    this._level = 1;
    this._history = [];  // Array of { category, color, icon, trace, item, level, resolvedParts, itemData }
  }

  /* ── Template data ──────────────────────────────────── */

  async _prepareContext() {
    const levels = [];
    for (let i = 1; i <= 10; i++) {
      levels.push({ value: i, label: `Level ${i}${i === 1 ? " (p.186)" : ""}${i === 10 ? "+" : ""}`, selected: i === this._level });
    }
    const players = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    return {
      levels,
      history: this._history.map((h, i) => {
        // Sum value across all items (alchemy gives 2)
        let totalCopper = 0;
        for (const d of (h.itemData ?? [])) {
          const bc = d.system?.baseCost;
          if (bc) totalCopper += (bc.gold ?? 0) * 10000 + (bc.silver ?? 0) * 100 + (bc.copper ?? 0);
        }
        const totalCost = totalCopper ? {
          gold: Math.floor(totalCopper / 10000),
          silver: Math.floor((totalCopper % 10000) / 100),
          copper: totalCopper % 100,
        } : null;
        const valParts = [];
        if (totalCost?.gold)   valParts.push(`${totalCost.gold}g`);
        if (totalCost?.silver) valParts.push(`${totalCost.silver}s`);
        if (totalCost?.copper) valParts.push(`${totalCost.copper}c`);
        return {
          ...h,
          origIndex: i,
          hasItem: !!h.itemData?.length,
          valueDisplay: valParts.length ? valParts.join(" ") : "",
        };
      }).reverse(),
      hasHistory: this._history.length > 0,
      players,
    };
  }

  /* ── Event binding ──────────────────────────────────── */

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;
    const $ = (sel) => el.querySelector(sel);
    const on = (sel, evt, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener(evt, fn, { signal }));

    // Level select
    const levelSel = $(".vcl-gen-level");
    if (levelSel) {
      levelSel.value = this._level;
      levelSel.addEventListener("change", ev => { this._level = parseInt(ev.currentTarget.value); }, { signal });
    }

    // Roll button
    const rollBtn = $(".vcl-gen-roll");
    if (rollBtn) rollBtn.addEventListener("click", () => this._rollLoot(), { signal });

    // Roll for selected token button
    const rollTokenBtn = $(".vcl-gen-roll-token");
    if (rollTokenBtn) rollTokenBtn.addEventListener("click", () => LootGenerator.rollForToken(null, this._level), { signal });

    // Post to chat buttons
    on(".vcl-gen-post-chat", "click", ev => {
      const idx = parseInt(ev.currentTarget.dataset.index);
      const entry = this._history[idx];
      if (entry) this._postToChat(entry);
    });

    // Give to player buttons (in-app)
    on(".vcl-gen-give-app", "click", async ev => {
      const idx = parseInt(ev.currentTarget.dataset.histIndex);
      const result = ev.currentTarget.closest(".vcl-gen-result");
      const actorId = result?.querySelector(".vcl-gen-player-select")?.value;
      if (!actorId) return;
      const entry = this._history[idx];
      if (!entry?.itemData?.length) return;

      const actor = game.actors.get(actorId);
      if (!actor) return;
      for (const data of entry.itemData) {
        await Item.create(data, { parent: actor });
      }

      // Log to LootTracker
      await LootTracker.logClaim(
        actor.name,
        "Loot Generator",
        { gold: 0, silver: 0, copper: 0 },
        entry.itemData.map(d => ({ name: d.name, img: d.img })),
      );

      ui.notifications.info(`Gave loot to ${actor.name}`);
    });

    // Clear history
    const clearBtn = $(".vcl-gen-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => { this._history = []; this.render(); }, { signal });
  }

  /* ── Level 1 — roll on world "Vagabond Loot (p.186)" table ── */

  async _rollLevel1() {
    // Weighted random from embedded p.186 data — no world table dependency
    const totalWeight = LEVEL1_TABLE.reduce((s, e) => s + e[0], 0);
    let roll = Math.floor(Math.random() * totalWeight);
    let rollDisplay = roll + 1;  // 1-indexed for display
    let pick = LEVEL1_TABLE[0];
    for (const entry of LEVEL1_TABLE) {
      roll -= entry[0];
      if (roll < 0) { pick = entry; break; }
    }
    const [weight, itemName, uuid] = pick;

    const trace = [{ label: "Vagabond Loot (p.186)", formula: `1d${totalWeight}`, total: rollDisplay }];

    // Resolve item data
    let itemData = null;

    // Coins: parse and roll the currency
    const coinMatch = itemName.match(/^Coins\s+\((.+?)\)\s+(gold|silver|copper)$/i);
    if (coinMatch) {
      const coinRoll = new Roll(coinMatch[1]);
      await coinRoll.evaluate();
      const coinType = coinMatch[2].toLowerCase();
      const coinAmount = coinRoll.total;
      // Create a currency loot item so it can be "given"
      const coinItem = _lootItem(
        `${coinAmount} ${coinMatch[2]}`,
        ICONS.ingotGold,
        coinType === "gold" ? coinAmount : 0,
        0,
        `${coinAmount} ${coinMatch[2]} coins.`,
      );
      if (coinType === "silver") coinItem.system.baseCost = { gold: 0, silver: coinAmount, copper: 0 };
      if (coinType === "copper") coinItem.system.baseCost = { gold: 0, silver: 0, copper: coinAmount };
      coinItem.system.quantity = 1;
      itemData = [coinItem];
    }
    // Compendium UUID
    else if (uuid) {
      try {
        let doc = await fromUuid(uuid);
        if (!doc) {
          doc = await _findCompendiumItem("vagabond.gear", itemName)
            || await _findCompendiumItem("vagabond.weapons", itemName)
            || await _findCompendiumItem("vagabond.armor", itemName)
            || await _findCompendiumItem("vagabond.alchemical-items", itemName);
        }
        if (doc) itemData = [doc.toObject()];
      } catch { /* non-fatal */ }
    }
    // Trinkets without UUID
    else if (itemName.includes("Trinket")) {
      const doc = await _findCompendiumItem("vagabond.gear", "Trinket");
      if (doc) {
        const d = doc.toObject();
        d.name = itemName;
        itemData = [d];
      } else {
        itemData = [_lootItem(itemName, ICONS.artifact, 50, 0, "A magical trinket.")];
      }
    }
    // Relic: +1 Enchantment Scroll — upgrade consumable, NOT a spell scroll.
    else if (itemName.includes("Scroll")) {
      itemData = [_createEnchantmentScroll(1)];
    }

    const entry = {
      category: "Loot (p.186)",
      color: "#c9aa58",
      icon: "fa-book-open",
      trace,
      item: itemData?.[0]?.name ?? itemName,
      level: 1,
      resolvedParts: { type: "level1", name: itemName },
      itemData,
    };
    this._history.push(entry);
    this.render();
  }

  /* ── Core resolution engine ─────────────────────────── */

  async _rollLoot() {
    const level = this._level;

    // ── Level 1: Roll on the world "Vagabond Loot (p.186)" table ──
    if (level === 1) {
      return this._rollLevel1();
    }

    const formulas = LEVEL_FORMULAS[level];
    if (!formulas) return;

    const trace = [];

    // Helper to roll and record trace
    const R = async (formula, label) => {
      const r = new Roll(formula);
      await r.evaluate();
      trace.push({ label, formula, total: r.total });
      return r.total;
    };

    // Helper to lookup in range table
    const lookupRange = (table, n) => {
      for (const [lo, hi, text] of table) {
        if (n >= lo && n <= hi) return text;
      }
      return `Unknown (${n})`;
    };

    // Step 1: Category (d6)
    const catN = await R("1d6", "Category");
    let category, color, icon, item, resolvedParts;

    if (catN === 1) {
      // ── TREASURE ──
      category = "Treasure";
      color = "#c9aa58";
      icon = "fa-coins";
      const result = await this._resolveTreasure(R, formulas.treasure);
      item = result.text;
      resolvedParts = result.parts;
    } else if (catN === 2) {
      // ── ARMOR ──
      category = "Armor";
      color = "#6a9fd8";
      icon = "fa-shield-halved";
      const result = await this._resolveArmor(R, lookupRange, formulas.armor);
      item = result.text;
      resolvedParts = result.parts;
    } else if (catN <= 4) {
      // ── WEAPONS ──
      category = "Weapons";
      color = "#d86a6a";
      icon = "fa-khanda";
      const result = await this._resolveWeapon(R, formulas.weapon);
      item = result.text;
      resolvedParts = result.parts;
    } else {
      // ── ALCHEMY (roll twice) ──
      category = "Alchemy (\u00d72)";
      color = "#7ad868";
      icon = "fa-flask-vial";
      const n1 = await R(formulas.alchemy, "Alchemy Roll 1");
      const item1 = ALCHEMY[n1] || `Unknown (${n1})`;
      const n2 = await R(formulas.alchemy, "Alchemy Roll 2");
      const item2 = ALCHEMY[n2] || `Unknown (${n2})`;
      item = `${item1}  &  ${item2}`;
      resolvedParts = { items: [item1, item2] };
    }

    const entry = { category, color, icon, trace, item, level, resolvedParts };
    entry.itemData = await this._createItemData(entry);
    this._history.push(entry);
    this.render();
  }

  /* ── Item creation pipeline ────────────────────────── */

  async _createItemData(result) {
    if (result.category.includes("Alchemy")) {
      return this._createAlchemyItem(result);
    }
    if (result.category === "Weapons") {
      return this._createWeaponItem(result);
    }
    if (result.category === "Armor") {
      return this._createArmorItem(result);
    }
    return this._createTreasureItem(result);
  }

  async _createAlchemyItem(result) {
    const items = [];
    for (const name of (result.resolvedParts?.items ?? [])) {
      // Spell Scrolls
      const scrollMatch = name.match(/^Spell Scroll\s*\((\d+)\s*Mana\)$/i);
      if (scrollMatch) {
        const manaCost = parseInt(scrollMatch[1]);
        const scrollItem = await _createSpellScroll(manaCost);
        if (scrollItem) items.push(scrollItem);
        continue;
      }

      const doc = await _findCompendiumItem("vagabond.alchemical-items", name)
        || await _findCompendiumItem("vagabond.gear", name);
      if (doc) {
        items.push(doc.toObject());
      } else {
        items.push(_lootItem(name, ICONS.scroll, 5, 1, `Alchemical item: ${name}.`));
      }
    }
    return items.length ? items : null;
  }

  async _createWeaponItem(result) {
    const { base, material, powerText } = result.resolvedParts ?? {};
    if (!base) return null;

    // Try weapons, then gear (trinkets, spell books, scrolls)
    let doc = await _findCompendiumItem("vagabond.weapons", base)
      || await _findCompendiumItem("vagabond.gear", base);

    // Trinkets: "Trinket — Arcane" etc. → fall back to generic Trinket
    if (!doc && base.includes("Trinket")) {
      doc = await _findCompendiumItem("vagabond.gear", "Trinket");
    }

    // Still nothing → create a placeholder
    const itemData = doc ? doc.toObject() : {
      name: base,
      img: ICONS.artifact,
      type: "equipment",
      system: { description: "", equipmentType: "gear", baseCost: { gold: 0, silver: 0, copper: 0 }, quantity: 1 },
    };

    // Apply material
    if (material && material !== "Mundane") {
      itemData.system.metal = material.toLowerCase();
    }

    // Update name with full generated name
    itemData.name = result.item;

    // Add relic power value to baseCost
    _addPowerValue(itemData, powerText, material);

    // Apply relic Active Effects
    const effects = _buildEffectsForPower(powerText);
    if (effects.length) itemData.effects = [...(itemData.effects || []), ...effects];

    // Store loot gen metadata
    itemData.flags = itemData.flags || {};
    itemData.flags["vagabond-crawler"] = {
      lootGenerated: true,
      powerText,
      material,
      level: result.level,
    };

    return [itemData];
  }

  async _createArmorItem(result) {
    const { base, material, powerText } = result.resolvedParts ?? {};
    if (!base) return null;

    // Special entries that aren't actual armor
    if (base.includes("Scroll, Enchantment")) {
      // Relic: +1 Enchantment Scroll — upgrade consumable, NOT a spell scroll.
      // The ARMOR chain's power/material roll is ignored: the scroll's bonus is
      // always +1 (rolling higher tiers comes from separate loot tables).
      return [_createEnchantmentScroll(1)];
    }
    if (base.includes("Accessory")) {
      // Accessory: the item name from resolver already has the power text
      // Create as a jewelry/clothing loot item with power value
      const itemData = _lootItem(result.item, ICONS.ring, 0, 0, "A magical accessory.");
      _addPowerValue(itemData, powerText, material);
      return [itemData];
    }

    // Map base name to armor type
    let searchName = "Light Armor";
    if (base.includes("Medium")) searchName = "Medium Armor";
    else if (base.includes("Heavy")) searchName = "Heavy Armor";

    const doc = await _findCompendiumItem("vagabond.armor", searchName);
    if (!doc) return null;
    const itemData = doc.toObject();

    itemData.name = result.item;
    if (material && material !== "Mundane") {
      itemData.system.metal = material.toLowerCase();
    }

    // Add relic power value to baseCost
    _addPowerValue(itemData, powerText, material);

    // Apply relic Active Effects
    const effects = _buildEffectsForPower(powerText);
    if (effects.length) itemData.effects = [...(itemData.effects || []), ...effects];

    itemData.flags = itemData.flags || {};
    itemData.flags["vagabond-crawler"] = {
      lootGenerated: true,
      powerText,
      material,
      level: result.level,
    };

    return [itemData];
  }

  async _createTreasureItem(result) {
    const sub = result.resolvedParts?.subtype;
    const name = result.resolvedParts?.name || result.item;

    // Currency: "Coins: 5d10 gold" → create a coin loot item
    if (sub === "currency") {
      const coinMatch = name.match(/Coins:\s+(.+?)\s+(gold|silver|copper)/i);
      if (coinMatch) {
        const r = new Roll(coinMatch[1].replace(/\u00d7/g, "*"));
        await r.evaluate();
        const coinType = coinMatch[2].toLowerCase();
        const amt = r.total;
        const item = _lootItem(`${amt} ${coinMatch[2]}`, ICONS.ingotGold, coinType === "gold" ? amt : 0, 0, `${amt} ${coinMatch[2]} coins.`);
        if (coinType === "silver") item.system.baseCost = { gold: 0, silver: amt, copper: 0 };
        if (coinType === "copper") item.system.baseCost = { gold: 0, silver: 0, copper: amt };
        return [item];
      }
      // Gems
      const gemMatch = name.match(/(\d+d\d+|\d+)\s+(Uncommon|Rare|Very Rare)\s+Gems.*?(\d+)g\s+each/i);
      if (gemMatch) {
        const r = new Roll(gemMatch[1]);
        await r.evaluate();
        return [_gemItem(gemMatch[2], parseInt(gemMatch[3]), r.total)];
      }
    }

    // Trade goods
    if (sub === "tradeGoods") {
      const tgMatch = name.match(/^(\d+d\d+|\d+)\s+(.+)$/);
      if (tgMatch) {
        const r = new Roll(tgMatch[1]);
        await r.evaluate();
        return [_tradeGoodItem(tgMatch[2], r.total)];
      }
      return [_tradeGoodItem(name, 1)];
    }

    // Art
    if (sub === "art") {
      const worthMatch = result.item.match(/worth\s+(\d+)g/i);
      const worthGold = worthMatch ? parseInt(worthMatch[1]) : 20;
      const artName = name.replace(/\s*\(.+?\)/g, "").trim();
      return [_lootItem(artName, ICONS.artifact, worthGold, 1, `Fine art piece worth ${worthGold}g.`)];
    }

    // Jewelry / clothing
    if (sub === "jewelry") {
      const worthMatch = result.item.match(/worth\s+(\d+)g/i);
      const worthGold = worthMatch ? parseInt(worthMatch[1]) : 10;
      return [_lootItem(name, ICONS.ring, worthGold, 0, `${name} worth ${worthGold}g.`)];
    }

    // Relic
    if (sub === "relic") {
      const doc = await _findCompendiumItem("vagabond.relics", name);
      if (doc) return [doc.toObject()];
      return [_lootItem(name, ICONS.artifact, 0, 1, `Relic: ${name}.`)];
    }

    // Fallback: try compendium
    const doc = await _findCompendiumItem("vagabond.gear", name);
    if (doc) return [doc.toObject()];
    return [_lootItem(name, ICONS.artifact, 0, 1, `Treasure: ${name}.`)];
  }

  /* ── Treasure resolver ──────────────────────────────── */

  async _resolveTreasure(R, formula) {
    const n = await R(formula, "Treasure Table");
    const entry = TREASURE[n];
    if (!entry) return { text: `Unknown treasure (${n})`, parts: {} };

    if (entry.startsWith("Trade Goods")) {
      const tgF = n <= 6 ? "d6" : n <= 12 ? "d6+6" : n <= 18 ? "d6+12" : "d6+18";
      const tg = await R(tgF, "Trade Goods");
      const text = TRADE_GOODS[tg];
      return { text, parts: { subtype: "tradeGoods", name: text } };
    }
    if (entry.startsWith("Art")) {
      const a = await R("1d8", "Art Table");
      const text = `${ART[a]}, ${entry.replace("Art (d8), ", "")}`;
      return { text, parts: { subtype: "art", name: ART[a] } };
    }
    if (entry.startsWith("Jewelry")) {
      const j = await R("1d12", "Jewelry Table");
      let result = JEWELRY[j];
      if (result === "\u2192Clothing") {
        const c = await R("1d20", "Clothing Table");
        result = CLOTHING[c];
      }
      const text = `${result}, ${entry.replace("Jewelry (d12), ", "")}`;
      return { text, parts: { subtype: "jewelry", name: result } };
    }
    if (entry.startsWith("Relic")) {
      const relF = n <= 6 ? "d6" : n <= 12 ? "d6+6" : n <= 18 ? "d6+12" : "d6+18";
      const rel = await R(relF, "Relic Item Table");
      const text = RELIC[rel];
      return { text, parts: { subtype: "relic", name: text } };
    }
    return { text: entry, parts: { subtype: "currency", name: entry } };
  }

  /* ── Armor resolver ─────────────────────────────────── */

  async _resolveArmor(R, lookupRange, formula) {
    const baseN = await R("1d20", "Armor Table");
    const base = lookupRange(ARMOR_BASE, baseN);
    const powN = await R(formula, "Armor Power");
    const power = await this._resolveArmorPower(R, powN);

    let material = "";
    if (powN >= 8) {
      const matN = await R("1d12", "Material Check");
      const mat = ARMOR_MATERIAL[matN];
      if (mat && mat !== "Mundane") material = mat;
    }

    const parts = [];
    if (material) parts.push(material);
    parts.push(base);
    if (power) {
      const displayPower = power.replace(/\s*\(Niche\)/i, "");
      if (displayPower.startsWith("of ") || displayPower.startsWith("(") || displayPower.includes("+")) {
        parts.push(displayPower);
      } else {
        parts.push(`of ${displayPower}`);
      }
    }
    const text = parts.join(" ");

    return { text, parts: { base, material: material || "Mundane", powerText: power || "" } };
  }

  async _resolveArmorPower(R, n) {
    const p = ARMOR_POWER[n];
    if (!p) return "";
    if (p.startsWith("Material")) { const m = await R("1d12", "Armor Material"); const mat = ARMOR_MATERIAL[m]; return mat === "Mundane" ? "" : mat; }
    if (p.startsWith("Resistance")) { const d = p.includes("d8") ? "1d8" : "1d3"; const v = await R(d, "Armor Resistance"); return `of ${ARMOR_RESISTANCE[v]}`; }
    if (p.startsWith("Movement")) { const d = p.includes("+6") ? "1d8+6" : "1d6"; const v = await R(d, "Movement"); return `of ${MOVEMENT[v]}`; }
    if (p.startsWith("Senses")) { const d = p.includes("+4") ? "1d4+4" : "1d4"; const v = await R(d, "Senses"); return `of ${SENSES[v]}`; }
    if (p.startsWith("Utility")) { const m = p.match(/\((.+?)\)/); const d = m ? m[1] : "1d8"; const v = await R(d, "Armor Utility"); return `of ${ARMOR_UTILITY[v]}`; }
    if (p.startsWith("Protection, General")) { const v = await R("1d8", "Creature General"); return `Protection vs ${CREATURE_GENERAL[v]}`; }
    if (p.startsWith("Protection, Specific")) { const v = await R("1d40", "Creature Specific"); return `Protection vs ${CREATURE_SPECIFIC[v]}`; }
    if (p.startsWith("Protection, Niche")) { const name = _lastFoughtName(); return `Protection vs ${name} (Niche)`; }
    if (p.includes("+")) return p;  // "+1", "+2", "+3"
    if (p.startsWith("Fabled")) return `(${p})`;
    return p;
  }

  /* ── Weapon resolver ────────────────────────────────── */

  async _resolveWeapon(R, formula) {
    const baseN = await R("1d48", "Weapon Table");
    const base = WEAPONS_LIST[baseN - 1] || "Unknown weapon";
    const powN = await R(formula, "Weapon Power");
    const power = await this._resolveWeaponPower(R, powN);

    let material = "";
    if (powN >= 10) {
      const matN = await R("1d8", "Material Check");
      const mat = WEAPON_MATERIAL[matN];
      if (mat && mat !== "Mundane") material = mat;
    }

    const parts = [];
    if (material) parts.push(material);
    parts.push(base);
    if (power) {
      const displayPower = power.replace(/\s*\(Niche\)/i, "");
      // Powers already prefixed with "of", "(", or "+" stay as-is
      if (displayPower.startsWith("of ") || displayPower.startsWith("(") || displayPower.startsWith("+") || displayPower.startsWith("Bane")) {
        parts.push(displayPower);
      } else {
        parts.push(`of ${displayPower}`);
      }
    }
    const text = parts.join(" ");

    return { text, parts: { base, material: material || "Mundane", powerText: power || "" } };
  }

  async _resolveWeaponPower(R, n) {
    const p = WEAPON_POWER[n];
    if (!p) return "";
    if (p.startsWith("Material")) { const v = await R("1d8", "Weapon Material"); const mat = WEAPON_MATERIAL[v]; return mat === "Mundane" ? "" : mat; }
    if (p.startsWith("Resistance")) { const v = await R("1d3", "Weapon Resistance"); return `of ${WEAPON_RESISTANCE[v]}`; }
    if (p.startsWith("Movement")) { const m = p.match(/\((.+?)\)/); const d = m ? m[1] : "1d6"; const v = await R(d, "Movement"); return `of ${MOVEMENT[v]}`; }
    if (p.startsWith("Senses")) { const m = p.match(/\((.+?)\)/); const d = m ? m[1] : "1d4"; const v = await R(d, "Senses"); return `of ${SENSES[v]}`; }
    if (p.startsWith("Utility")) { const m = p.match(/\((.+?)\)/); const d = m ? m[1] : "1d6"; const v = await R(d, "Weapon Utility"); return `of ${WEAPON_UTILITY[v]}`; }
    if (p.startsWith("Bane, General")) { const v = await R("1d8", "Creature General"); return `Bane of ${CREATURE_GENERAL[v]}`; }
    if (p.startsWith("Bane, Specific")) { const v = await R("1d40", "Creature Specific"); return `Bane of ${CREATURE_SPECIFIC[v]}`; }
    if (p.startsWith("Bane, Niche")) { const name = _lastFoughtName(); return `Bane of ${name} (Niche)`; }
    if (p.startsWith("Strike")) return `(${p})`;
    if (p.startsWith("Ace")) return "(Ace)";
    if (p.startsWith("Fabled")) return `(${p})`;
    if (p.startsWith("Weapon +") || p.startsWith("Weapon/Trinket +")) return p.replace("Weapon/Trinket ", "").replace("Weapon ", "");
    return p;
  }

  /* ── Post to chat ───────────────────────────────────── */

  async _postToChat(entry) {
    const traceHtml = renderTraceHtml(entry.trace);

    // Item icon for the card
    const itemImg = entry.itemData?.[0]?.img || "icons/svg/item-bag.svg";

    // Item rows — vcl-gen-claim-item style, matches Roll for Selected Token + Loot Drops
    const itemLines = (entry.itemData ?? []).map(d => {
      const bc = d.system?.baseCost;
      const vp = [];
      if (bc?.gold)   vp.push(`${bc.gold}g`);
      if (bc?.silver) vp.push(`${bc.silver}s`);
      if (bc?.copper) vp.push(`${bc.copper}c`);
      const valStr = vp.length ? ` (${vp.join(" ")})` : "";
      const qty = d.system?.quantity ?? 1;
      const qtyStr = qty > 1 ? ` ×${qty}` : "";
      return `<div class="vcl-gen-claim-item"><img src="${d.img || "icons/svg/item-bag.svg"}" width="24" height="24" /><span>${d.name}${qtyStr}${valStr}</span></div>`;
    }).join("");

    const buttonRow = entry.itemData?.length
      ? `<div class="vcl-drops-actions" style="padding:4px 8px 8px;">
          <button type="button" class="vcl-gen-claim-btn vcl-drops-claim-btn"><i class="fas fa-hand-holding"></i> Claim Loot</button>
          <button type="button" class="vcl-gen-claim-btn vcl-drops-pass-btn"><i class="fas fa-arrow-right-arrow-left"></i> Pass Loot</button>
        </div>`
      : `<div style="padding:4px 8px 8px;font-size:14px;color:var(--vcb-text-muted);">(Text-only)</div>`;

    const msgData = {
      content: `<div class="vagabond-chat-card-v2" data-card-type="generic" data-loot-gen="true">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${itemImg}" alt="${entry.item}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Level ${entry.level} ${entry.category}</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${entry.item}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 8px;">
              ${traceHtml}
              ${itemLines}
            </div>
            ${buttonRow}
          </section>
        </div>
      </div>`,
      speaker: { alias: "Loot Generator" },
      flags: {
        "vagabond-crawler": {
          lootGeneratorCard: true,
          itemData: entry.itemData,
          trace: entry.trace,
          sourceLabel: `Level ${entry.level} ${entry.category}`,
          claimed: false,
          passed: false,
        },
      },
    };

    await ChatMessage.create(msgData);
  }
}

/* ── Headless loot generation for Loot Drops integration ───── */

/**
 * Generate loot for a given level without UI.
 * Called by loot-tables.mjs when a "loot-level:N" table is assigned.
 * @param {number} level — 1-10
 * @returns {Promise<{currency: Object, items: Object[]}>}
 */
export async function generateLevelLoot(level) {
  const currency = { gold: 0, silver: 0, copper: 0 };
  const items = [];
  const trace = [];

  // Trace-aware roller — every roll pushes a labeled entry so the chat
  // card can show the GM the dice path that produced this loot.
  const _R = async (formula, label) => {
    const r = new Roll(formula);
    await r.evaluate();
    trace.push({ label, formula, total: r.total });
    return r.total;
  };

  const _lookupRange = (table, n) => {
    for (const [lo, hi, text] of table) { if (n >= lo && n <= hi) return text; }
    return null;
  };

  if (level === 1) {
    // ── Level 1: weighted random from p.186 table ──
    const totalWeight = LEVEL1_TABLE.reduce((s, e) => s + e[0], 0);
    let roll = Math.floor(Math.random() * totalWeight);
    const rollDisplay = roll + 1;  // 1-indexed for trace display
    let pick = LEVEL1_TABLE[0];
    for (const entry of LEVEL1_TABLE) {
      roll -= entry[0];
      if (roll < 0) { pick = entry; break; }
    }
    const [, name, uuid] = pick;
    trace.push({ label: "Vagabond Loot (p.186)", formula: `1d${totalWeight}`, total: rollDisplay });

    // Parse currency from name
    const coinMatch = name.match(/^Coins\s+\((.+?)\)\s+(gold|silver|copper)$/i);
    if (coinMatch) {
      const coinRoll = await _R(coinMatch[1], "Coins");
      currency[coinMatch[2].toLowerCase()] += coinRoll;
      return { currency, items, trace };
    }

    // Compendium item
    if (uuid) {
      try {
        let doc = await fromUuid(uuid);
        // Fallback: if UUID is stale, search by name
        if (!doc) {
          doc = await _findCompendiumItem("vagabond.gear", name)
            || await _findCompendiumItem("vagabond.weapons", name)
            || await _findCompendiumItem("vagabond.armor", name)
            || await _findCompendiumItem("vagabond.alchemical-items", name);
        }
        if (doc) items.push(doc.toObject());
      } catch { /* non-fatal */ }
    }
    // Trinkets without UUID: look up generic trinket from compendium
    else if (name.includes("Trinket")) {
      const doc = await _findCompendiumItem("vagabond.gear", "Trinket");
      if (doc) {
        const itemData = doc.toObject();
        itemData.name = name;  // "Arcane Trinket", "Divine Trinket", etc.
        items.push(itemData);
      } else {
        items.push(_lootItem(name, ICONS.artifact, 50, 0, `A magical trinket.`));
      }
    }
    // Enchantment Scroll: create a spell scroll
    // Relic: +1 Enchantment Scroll — upgrade consumable, NOT a spell scroll.
    else if (name.includes("Scroll")) {
      items.push(_createEnchantmentScroll(1));
    }
    return { currency, items, trace };
  }

  // ── Levels 2-10: category chain ──
  const formulas = LEVEL_FORMULAS[level];
  if (!formulas) return { currency, items, trace };

  const catN = await _R("1d6", "Category");

  if (catN === 1) {
    // Treasure chain
    const n = await _R(formulas.treasure, "Treasure");
    const entry = TREASURE[n];
    if (entry) {
      // Coins: "Coins: 5d10 gold"
      const coinMatch = entry.match(/^Coins:\s+(.+)$/);
      if (coinMatch) {
        const formula = coinMatch[1].replace(/\u00d7/g, "*").replace(/gold/i, "").trim();
        try { currency.gold += (await _R(formula, "Coin Roll")); } catch { /* complex formula */ }
      }
      // Gems: "1d8 Uncommon Gems (0-Slot, 5g each)"
      else if (entry.includes("Gems")) {
        const qtyMatch = entry.match(/(\d+d\d+|\d+)/);
        const valMatch = entry.match(/(\d+)g\s+each/i);
        if (qtyMatch && valMatch) {
          const qty = await _R(qtyMatch[1], "Gem Quantity");
          const rarity = entry.includes("Very Rare") ? "Very Rare"
            : entry.includes("Rare") ? "Rare" : "Uncommon";
          items.push(_gemItem(rarity, parseInt(valMatch[1]), qty));
        }
      }
      // Trade Goods: "Trade Goods (d6)" → roll sub-table
      else if (entry.startsWith("Trade Goods")) {
        const diceMatch = entry.match(/\((.+?)\)/);
        if (diceMatch) {
          const tgN = await _R(diceMatch[1], "Trade Goods");
          const tgEntry = TRADE_GOODS[tgN];
          if (tgEntry) {
            const tgQtyMatch = tgEntry.match(/^(\d+d\d+|\d+)\s+(.+)$/);
            if (tgQtyMatch) {
              const qty = await _R(tgQtyMatch[1], "Trade Good Quantity");
              items.push(_tradeGoodItem(tgQtyMatch[2], qty));
            } else {
              items.push(_tradeGoodItem(tgEntry, 1));
            }
          }
        }
      }
      // Art: "Art (d8), worth 20g" → roll art sub-table, create item with value
      else if (entry.startsWith("Art")) {
        const worthMatch = entry.match(/worth\s+(\d+)g/i);
        const diceMatch = entry.match(/\((.+?)\)/);
        const worthGold = worthMatch ? parseInt(worthMatch[1]) : 20;
        if (diceMatch) {
          const artN = await _R(diceMatch[1], "Art");
          const artName = ART[artN] || "Art Object";
          const baseName = artName.replace(/\s*\(.+?\)/g, "").trim();
          const slotsMatch = artName.match(/(\d+)-Slot/);
          const slots = slotsMatch ? parseInt(slotsMatch[1]) : 1;
          items.push(_lootItem(baseName, ART_ICONS[artN] || ICONS.artifact, worthGold, slots,
            `A fine art piece worth ${worthGold}g.`));
        }
      }
      // Jewelry: "Jewelry (d12), worth 10g" → roll jewelry sub-table
      else if (entry.startsWith("Jewelry")) {
        const worthMatch = entry.match(/worth\s+(\d+)g/i);
        const diceMatch = entry.match(/\((.+?)\)/);
        const worthGold = worthMatch ? parseInt(worthMatch[1]) : 10;
        if (diceMatch) {
          const jN = await _R(diceMatch[1], "Jewelry");
          if (jN === 12) {
            // Redirect to Clothing sub-table
            const cN = await _R("1d20", "Clothing");
            const cName = CLOTHING[cN] || "Clothing";
            items.push(_lootItem(`Fine ${cName}`, CLOTHING_ICONS[cN] || ICONS.cloak, worthGold, 1,
              `Fine clothing worth ${worthGold}g.`));
          } else {
            const jName = JEWELRY[jN] || "Jewelry";
            items.push(_lootItem(jName, JEWELRY_ICONS[jN] || ICONS.ring, worthGold, 0,
              `${jName} worth ${worthGold}g.`));
          }
        }
      }
      // Relic Item: "Relic Item (d6)" → roll relic sub-table
      else if (entry.startsWith("Relic")) {
        const diceMatch = entry.match(/\((.+?)\)/);
        if (diceMatch) {
          const rN = await _R(diceMatch[1], "Relic");
          const relicName = RELIC[rN];
          if (relicName) {
            const doc = await _findCompendiumItem("vagabond.relics", relicName);
            if (doc) {
              items.push(doc.toObject());
            } else {
              items.push(_lootItem(relicName, ICONS.artifact, 0, 1, `Relic: ${relicName}.`));
            }
          }
        }
      }
    }
  } else if (catN === 2) {
    // Armor — get base + power
    const baseN = await _R("1d20", "Armor Base");
    const base = _lookupRange(ARMOR_BASE, baseN) ?? "Light Armor";

    // Special entries
    if (base.includes("Scroll, Enchantment")) {
      // Relic: +1 Enchantment Scroll — upgrade consumable, NOT a spell scroll.
      items.push(_createEnchantmentScroll(1));
    } else if (base.includes("Accessory")) {
      // Accessory: d4 → 1-2 = Jewelry, 3-4 = Clothing
      const accRoll = await _R("1d4", "Accessory Type");
      let accName, accImg;
      if (accRoll <= 2) {
        const jN = await _R("1d12", "Jewelry");
        const jEntry = JEWELRY[jN];
        if (jEntry === "\u2192Clothing" || !jEntry) {
          const cN = await _R("1d20", "Clothing");
          accName = CLOTHING[cN] || "Clothing";
          accImg = ICONS.cloak;
        } else {
          accName = jEntry;
          accImg = ICONS.ring;
        }
      } else {
        const cN = await _R("1d20", "Clothing");
        accName = CLOTHING[cN] || "Clothing";
        accImg = ICONS.cloak;
      }
      const itemData = _lootItem(accName, accImg, 0, 0, "A magical accessory.");
      const powN = await _R(formulas.armor, "Armor Power");
      const rawPower = ARMOR_POWER[powN];
      const { display, powerText } = await _resolveRawPower(rawPower, "armor");
      itemData.name = display ? `${accName} ${display}` : accName;
      _addPowerValue(itemData, powerText, null);
      const accEffects = _buildEffectsForPower(powerText);
      if (accEffects.length) itemData.effects = accEffects;
      items.push(itemData);
    } else {
      // Actual armor
      let armorPack = "Light Armor";
      if (base.includes("Medium")) armorPack = "Medium Armor";
      if (base.includes("Heavy")) armorPack = "Heavy Armor";
      const doc = await _findCompendiumItem("vagabond.armor", armorPack);
      if (doc) {
        const itemData = doc.toObject();
        const powN = await _R(formulas.armor, "Armor Power");
        if (powN >= 8) {
          const matN = await _R("1d12", "Armor Material");
          const mat = ARMOR_MATERIAL[matN];
          if (mat && mat !== "Mundane") {
            itemData.system.metal = mat.toLowerCase();
            itemData.name = `${mat} ${itemData.name}`;
          }
        }
        const rawPower = ARMOR_POWER[powN];
        const { display, powerText } = await _resolveRawPower(rawPower, "armor");
        if (display) itemData.name += ` ${display}`;
        _addPowerValue(itemData, powerText, itemData.system?.metal ?? null);
        // Apply relic Active Effects
        const effects = _buildEffectsForPower(powerText);
        if (effects.length) itemData.effects = effects;
        items.push(itemData);
      }
    }
  } else if (catN <= 4) {
    // Weapons
    const baseN = await _R("1d48", "Weapon Base");
    const baseName = WEAPONS_LIST[baseN - 1];
    if (baseName) {
      // Try weapons, then gear (for trinkets, spell books, etc.)
      let doc = await _findCompendiumItem("vagabond.weapons", baseName)
        || await _findCompendiumItem("vagabond.gear", baseName);
      // Trinkets: fall back to generic Trinket
      if (!doc && baseName.includes("Trinket")) {
        doc = await _findCompendiumItem("vagabond.gear", "Trinket");
      }
      const itemData = doc ? doc.toObject() : {
        name: baseName,
        img: ICONS.artifact,
        type: "equipment",
        system: { description: "", equipmentType: "gear", baseCost: { gold: 0, silver: 50, copper: 0 }, quantity: 1 },
      };
      // Preserve the full trinket name
      itemData.name = baseName;
      const powN = await _R(formulas.weapon, "Weapon Power");
      if (doc && powN >= 10) {
        const matN = await _R("1d8", "Weapon Material");
        const mat = WEAPON_MATERIAL[matN];
        if (mat && mat !== "Mundane") {
          itemData.system.metal = mat.toLowerCase();
          itemData.name = `${mat} ${itemData.name}`;
        }
      }
      const rawPower = WEAPON_POWER[powN];
      const { display, powerText } = await _resolveRawPower(rawPower);
      if (display) itemData.name += ` ${display}`;
      _addPowerValue(itemData, powerText, itemData.system?.metal ?? null);
      // Apply relic Active Effects
      const effects = _buildEffectsForPower(powerText);
      if (effects.length) itemData.effects = effects;
      items.push(itemData);
    }
  } else {
    // Alchemy (roll twice)
    for (let i = 0; i < 2; i++) {
      const n = await _R(formulas.alchemy, `Alchemy Roll ${i + 1}`);
      const name = ALCHEMY[n];
      if (!name) continue;

      // Spell Scrolls: "Spell Scroll (X Mana)" → create actual scroll
      const scrollMatch = name.match(/^Spell Scroll\s*\((\d+)\s*Mana\)$/i);
      if (scrollMatch) {
        const manaCost = parseInt(scrollMatch[1]);
        const scrollItem = await _createSpellScroll(manaCost);
        if (scrollItem) items.push(scrollItem);
        continue;
      }

      // Regular alchemical item → find in compendium
      const doc = await _findCompendiumItem("vagabond.alchemical-items", name)
        || await _findCompendiumItem("vagabond.gear", name);
      if (doc) {
        items.push(doc.toObject());
      } else {
        items.push(_lootItem(name, ICONS.scroll, 5, 1, `Alchemical item: ${name}.`));
      }
    }
  }

  return { currency, items, trace };
}

/* ── Trace HTML helper (shared across all loot card flows) ──── */

/**
 * Render a trace array as the monospace "→ Label (formula=total)" block
 * used by all three loot card flows (Roll Loot, Roll for Selected Token,
 * Loot Drops). Returns the HTML for a `card-description` block.
 * @param {{label: string, formula: string, total: number}[]} trace
 * @returns {string}
 */
export function renderTraceHtml(trace) {
  if (!trace?.length) return "";
  const lines = trace.map(t =>
    `<span>→</span> <span>${t.label}</span> <span>(${t.formula}=${t.total})</span>`
  ).join("<br>");
  return `<div style="font-size:14px;line-height:1.6;margin-bottom:6px;font-family:monospace;color:#0b1a23;">${lines}</div>`;
}
