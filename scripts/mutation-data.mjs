/**
 * Vagabond Crawler — Mutation Database
 *
 * Boon/bane mutations from mutation-variables.md, encoded as structured data.
 * Each mutation has an apply() function that modifies actor data in place,
 * a TL delta (0 = off-formula), and an AI prompt fragment for image generation.
 *
 * TL Formula: TL = (Armor * 2 + HP / 10) / 4 + DPR / 6
 * Only HP, Armor, and DPR directly affect TL.
 */

/* -------------------------------------------- */
/*  Mutation Categories                         */
/* -------------------------------------------- */

export const MUTATION_CATEGORIES = {
  hp:              { label: "Hit Points",         icon: "fas fa-heart" },
  armor:           { label: "Armor",              icon: "fas fa-shield" },
  dpr:             { label: "Damage",             icon: "fas fa-sword" },
  speed:           { label: "Speed",              icon: "fas fa-person-running" },
  movement:        { label: "Movement Types",     icon: "fas fa-feather" },
  size:            { label: "Size",               icon: "fas fa-up-right-and-down-left-from-center" },
  morale:          { label: "Morale",             icon: "fas fa-flag" },
  senses:          { label: "Senses",             icon: "fas fa-eye" },
  immunities:      { label: "Damage Immunities",  icon: "fas fa-shield-halved" },
  weaknesses:      { label: "Weaknesses",         icon: "fas fa-heart-crack" },
  statusImmunities:{ label: "Status Immunities",  icon: "fas fa-ban" },
  abilities:       { label: "Abilities",          icon: "fas fa-star" },
};

/* -------------------------------------------- */
/*  Mutations                                   */
/* -------------------------------------------- */

export const MUTATIONS = [

  // ══════════════════════════════════════════════
  // HP — Direct TL impact (+0.025 per HP)
  // ══════════════════════════════════════════════

  {
    id: "hp-bloated",
    name: "Bloated",
    category: "hp",
    type: "boon",
    tlDelta: 0.2,
    description: "+9 HP (swollen, engorged)",
    namePrefix: "Bloated",
    promptFragment: "bloated and swollen body, engorged",
    suggestedBane: "speed-minus-10",
    apply(d) { d.system.hd += 2; },
  },
  {
    id: "hp-massive",
    name: "Massive",
    category: "hp",
    type: "boon",
    tlDelta: 0.5,
    description: "+18 HP (huge, overgrown)",
    namePrefix: "Massive",
    promptFragment: "enormous, towering, overgrown body",
    suggestedBane: "speed-minus-10",
    apply(d) { d.system.hd += 4; },
  },
  {
    id: "hp-fragile",
    name: "Fragile",
    category: "hp",
    type: "bane",
    tlDelta: -0.2,
    description: "-9 HP (hollow, thin)",
    nameSuffix: "Runt",
    promptFragment: "thin and fragile looking, gaunt",
    apply(d) { d.system.hd = Math.max(1, d.system.hd - 2); },
  },
  {
    id: "hp-withered",
    name: "Withered",
    category: "hp",
    type: "bane",
    tlDelta: -0.5,
    description: "-18 HP (desiccated, wasted)",
    namePrefix: "Withered",
    promptFragment: "desiccated and withered, skeletal frame",
    apply(d) { d.system.hd = Math.max(1, d.system.hd - 4); },
  },

  // ══════════════════════════════════════════════
  // ARMOR — Direct TL impact (+0.5 per point)
  // ══════════════════════════════════════════════

  {
    id: "armor-plus-1",
    name: "Ironlike Scales",
    category: "armor",
    type: "boon",
    tlDelta: 0.5,
    description: "+1 Armor (thick hide, scales)",
    namePrefix: "Ironhide",
    promptFragment: "covered in thick metallic scales, armored hide",
    suggestedBane: "speed-minus-10",
    apply(d) { d.system.armor += 1; },
  },
  {
    id: "armor-plus-2",
    name: "Crystalline Shell",
    category: "armor",
    type: "boon",
    tlDelta: 1.0,
    description: "+2 Armor (crystal carapace, stone skin)",
    namePrefix: "Crystalline",
    promptFragment: "encased in crystalline shell, gemstone-like armor plating",
    suggestedBane: "speed-halved",
    apply(d) { d.system.armor += 2; },
  },
  {
    id: "armor-minus-1",
    name: "Thin Skin",
    category: "armor",
    type: "bane",
    tlDelta: -0.5,
    description: "-1 Armor (stretched, vulnerable)",
    promptFragment: "thin translucent skin, exposed flesh",
    apply(d) { d.system.armor = Math.max(0, d.system.armor - 1); },
  },
  {
    id: "armor-minus-2",
    name: "Reckless / Fragile",
    category: "armor",
    type: "bane",
    tlDelta: -1.0,
    description: "-2 Armor (reckless, unprotected)",
    promptFragment: "scarred and battered, missing armor plating",
    apply(d) { d.system.armor = Math.max(0, d.system.armor - 2); },
  },

  // ══════════════════════════════════════════════
  // DPR — Direct TL impact (+0.17 per DPR)
  // ══════════════════════════════════════════════

  {
    id: "dpr-action-d6",
    name: "New Attack (1d6)",
    category: "dpr",
    type: "boon",
    tlDelta: 0.6,
    description: "Add a new melee action dealing 1d6 damage",
    namePrefix: "Savage",
    promptFragment: "with extra claws or fangs, more aggressive",
    apply(d) {
      d.system.actions.push({
        name: "Mutant Strike", note: "", recharge: "", rechargeCountdownId: null,
        flatDamage: "", rollDamage: "1d6", damageType: "physical",
        attackType: "melee", extraInfo: "", weaponId: "", weaponPrevName: "",
        weaponPrevFlatDamage: "", weaponPrevRollDamage: "",
        causedStatuses: [], critCausedStatuses: [],
      });
    },
  },
  {
    id: "dpr-action-d8",
    name: "New Attack (1d8)",
    category: "dpr",
    type: "boon",
    tlDelta: 0.75,
    description: "Add a new melee action dealing 1d8 damage",
    namePrefix: "Brutal",
    promptFragment: "with massive claws or crushing jaws, heavily muscled",
    apply(d) {
      d.system.actions.push({
        name: "Mutant Slam", note: "", recharge: "", rechargeCountdownId: null,
        flatDamage: "", rollDamage: "1d8", damageType: "physical",
        attackType: "melee", extraInfo: "", weaponId: "", weaponPrevName: "",
        weaponPrevFlatDamage: "", weaponPrevRollDamage: "",
        causedStatuses: [], critCausedStatuses: [],
      });
    },
  },
  {
    id: "dpr-recharge-cd4",
    name: "Recharge Cd4 (best action)",
    category: "dpr",
    type: "bane",
    tlDelta: -0.2,
    description: "Best action gets Cd4 recharge (~every 2.5 rounds)",
    promptFragment: "exhausted looking, labored breathing",
    apply(d) {
      if (d.system.actions.length > 0) {
        d.system.actions[0].recharge = "Cd4";
      }
    },
  },
  {
    id: "dpr-recharge-cd6",
    name: "Recharge Cd6 (best action)",
    category: "dpr",
    type: "bane",
    tlDelta: -0.3,
    description: "Best action gets Cd6 recharge (~every 3.5 rounds)",
    promptFragment: "visibly strained, gathering energy between attacks",
    apply(d) {
      if (d.system.actions.length > 0) {
        d.system.actions[0].recharge = "Cd6";
      }
    },
  },
  {
    id: "dpr-breath-fire",
    name: "Fire Breath (Cd4)",
    category: "dpr",
    type: "boon",
    tlDelta: 0,
    description: "Add fire breath attack (HDxd4, Cd4 recharge, cone)",
    namePrefix: "Fire-Breathing",
    promptFragment: "breathing fire, flames erupting from mouth",
    suggestedBane: "weakness-cold",
    apply(d) {
      const hd = d.system.hd || 1;
      d.system.actions.push({
        name: "Fire Breath", note: "Cone, Close", recharge: "Cd4",
        rechargeCountdownId: null,
        flatDamage: "", rollDamage: `${hd}d4`, damageType: "fire",
        attackType: "castClose", extraInfo: "All creatures in cone",
        weaponId: "", weaponPrevName: "", weaponPrevFlatDamage: "",
        weaponPrevRollDamage: "", causedStatuses: [], critCausedStatuses: [],
      });
    },
  },

  // ══════════════════════════════════════════════
  // SPEED — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "speed-plus-10",
    name: "Speed +10ft",
    category: "speed",
    type: "boon",
    tlDelta: 0,
    description: "+10ft movement speed",
    namePrefix: "Swift",
    promptFragment: "lean and fast, built for speed",
    apply(d) { d.system.speed += 10; },
  },
  {
    id: "speed-minus-10",
    name: "Speed -10ft",
    category: "speed",
    type: "bane",
    tlDelta: 0,
    description: "-10ft movement speed",
    promptFragment: "lumbering, heavy-footed",
    apply(d) { d.system.speed = Math.max(5, d.system.speed - 10); },
  },
  {
    id: "speed-doubled",
    name: "Speed Doubled",
    category: "speed",
    type: "boon",
    tlDelta: 0,
    description: "Movement speed doubled",
    namePrefix: "Quicksilver",
    promptFragment: "blurred with speed, elongated limbs",
    suggestedBane: "armor-minus-1",
    apply(d) { d.system.speed *= 2; },
  },
  {
    id: "speed-halved",
    name: "Speed Halved",
    category: "speed",
    type: "bane",
    tlDelta: 0,
    description: "Movement speed halved",
    promptFragment: "sluggish, dragging itself forward",
    apply(d) { d.system.speed = Math.max(5, Math.floor(d.system.speed / 2)); },
  },

  // ══════════════════════════════════════════════
  // MOVEMENT TYPES — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "movement-fly",
    name: "Wings / Fly",
    category: "movement",
    type: "boon",
    tlDelta: 0,
    description: "Gains Fly (= walk speed)",
    namePrefix: "Winged",
    promptFragment: "with large bat-like wings, airborne",
    suggestedBane: "armor-minus-1",
    apply(d) {
      if (!d.system.speedTypes) d.system.speedTypes = [];
      if (!d.system.speedTypes.includes("fly")) d.system.speedTypes.push("fly");
      if (!d.system.speedValues) d.system.speedValues = {};
      d.system.speedValues.fly = d.system.speed;
    },
  },
  {
    id: "movement-swim",
    name: "Aquatic / Swim",
    category: "movement",
    type: "boon",
    tlDelta: 0,
    description: "Gains Swim (= walk speed)",
    namePrefix: "Aquatic",
    promptFragment: "with fins and gills, amphibious, wet slick skin",
    suggestedBane: "weakness-shock",
    apply(d) {
      if (!d.system.speedTypes) d.system.speedTypes = [];
      if (!d.system.speedTypes.includes("swim")) d.system.speedTypes.push("swim");
      if (!d.system.speedValues) d.system.speedValues = {};
      d.system.speedValues.swim = d.system.speed;
    },
  },
  {
    id: "movement-phase",
    name: "Phase",
    category: "movement",
    type: "boon",
    tlDelta: 0,
    description: "Gains Phase (move through solid objects)",
    namePrefix: "Spectral",
    promptFragment: "partially translucent, ghostly, phasing through matter",
    suggestedBane: "hp-fragile",
    apply(d) {
      if (!d.system.speedTypes) d.system.speedTypes = [];
      if (!d.system.speedTypes.includes("phase")) d.system.speedTypes.push("phase");
      if (!d.system.speedValues) d.system.speedValues = {};
      d.system.speedValues.phase = d.system.speed;
    },
  },
  {
    id: "movement-climb",
    name: "Climb / Cling",
    category: "movement",
    type: "boon",
    tlDelta: 0,
    description: "Gains Climb (move on vertical surfaces)",
    namePrefix: "Crawling",
    promptFragment: "with hooked claws clinging to walls, spider-like grip",
    apply(d) {
      if (!d.system.speedTypes) d.system.speedTypes = [];
      if (!d.system.speedTypes.includes("climb")) d.system.speedTypes.push("climb");
      if (!d.system.speedValues) d.system.speedValues = {};
      d.system.speedValues.climb = d.system.speed;
    },
  },

  // ══════════════════════════════════════════════
  // SIZE — Mixed (HP/Armor changes are on-formula)
  // ══════════════════════════════════════════════

  {
    id: "size-up",
    name: "Size Up",
    category: "size",
    type: "boon",
    tlDelta: 0.7,
    description: "Grow one size category (+9 HP, +1 Armor)",
    namePrefix: "Greater",
    promptFragment: "enormous, towering over others, massive frame",
    suggestedBane: "speed-minus-10",
    apply(d) {
      const sizes = ["small", "medium", "large", "huge", "giant", "colossal"];
      const idx = sizes.indexOf(d.system.size);
      if (idx < sizes.length - 1) d.system.size = sizes[idx + 1];
      d.system.hd += 2;
      d.system.armor += 1;
    },
  },
  {
    id: "size-down",
    name: "Size Down",
    category: "size",
    type: "bane",
    tlDelta: -0.2,
    description: "Shrink one size category (-9 HP)",
    namePrefix: "Lesser",
    promptFragment: "small and compact, diminutive",
    apply(d) {
      const sizes = ["small", "medium", "large", "huge", "giant", "colossal"];
      const idx = sizes.indexOf(d.system.size);
      if (idx > 0) d.system.size = sizes[idx - 1];
      d.system.hd = Math.max(1, d.system.hd - 2);
    },
  },

  // ══════════════════════════════════════════════
  // MORALE — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "morale-plus-3",
    name: "Relentless (+3 Morale)",
    category: "morale",
    type: "boon",
    tlDelta: 0,
    description: "+3 Morale (fights longer)",
    namePrefix: "Relentless",
    promptFragment: "wild-eyed and fearless, frenzied",
    apply(d) { d.system.morale = Math.min(12, (d.system.morale || 7) + 3); },
  },
  {
    id: "morale-minus-3",
    name: "Cowardly (-3 Morale)",
    category: "morale",
    type: "bane",
    tlDelta: 0,
    description: "-3 Morale (flees sooner)",
    promptFragment: "nervous, darting eyes, ready to flee",
    apply(d) { d.system.morale = Math.max(1, (d.system.morale || 7) - 3); },
  },
  {
    id: "morale-12",
    name: "Fights to Death",
    category: "morale",
    type: "boon",
    tlDelta: 0,
    description: "Morale = 12 (never flees)",
    namePrefix: "Fanatical",
    promptFragment: "berserker rage, foaming at mouth, unstoppable",
    suggestedBane: "morale-minus-3",
    apply(d) { d.system.morale = 12; },
  },

  // ══════════════════════════════════════════════
  // SENSES — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "senses-darksight",
    name: "Darksight",
    category: "senses",
    type: "boon",
    tlDelta: 0,
    description: "Can see in darkness",
    namePrefix: "Night",
    promptFragment: "with glowing eyes, adapted to darkness",
    apply(d) {
      const s = d.system.senses || "";
      if (!s.includes("Darksight")) d.system.senses = s ? `${s}, Darksight` : "Darksight";
    },
  },
  {
    id: "senses-blindsight",
    name: "Blindsight",
    category: "senses",
    type: "boon",
    tlDelta: 0,
    description: "Perceives without sight (echolocation, tremorsense)",
    namePrefix: "Blind",
    promptFragment: "eyeless, with enlarged ears or sensory pits",
    apply(d) {
      const s = d.system.senses || "";
      if (!s.includes("Blindsight")) d.system.senses = s ? `${s}, Blindsight` : "Blindsight";
    },
  },

  // ══════════════════════════════════════════════
  // DAMAGE IMMUNITIES — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "immune-fire",
    name: "Fire Immunity",
    category: "immunities",
    type: "boon",
    tlDelta: 0,
    description: "Immune to fire damage",
    namePrefix: "Flame-Touched",
    promptFragment: "wreathed in flames, fire-resistant skin, smoldering",
    suggestedBane: "weakness-cold",
    apply(d) {
      if (!d.system.immunities) d.system.immunities = [];
      if (!d.system.immunities.includes("fire")) d.system.immunities.push("fire");
    },
  },
  {
    id: "immune-cold",
    name: "Cold Immunity",
    category: "immunities",
    type: "boon",
    tlDelta: 0,
    description: "Immune to cold damage",
    namePrefix: "Frost-Born",
    promptFragment: "covered in frost and ice, frozen breath",
    suggestedBane: "weakness-fire",
    apply(d) {
      if (!d.system.immunities) d.system.immunities = [];
      if (!d.system.immunities.includes("cold")) d.system.immunities.push("cold");
    },
  },
  {
    id: "immune-poison",
    name: "Poison Immunity",
    category: "immunities",
    type: "boon",
    tlDelta: 0,
    description: "Immune to poison damage",
    promptFragment: "sickly green veins, toxic aura",
    apply(d) {
      if (!d.system.immunities) d.system.immunities = [];
      if (!d.system.immunities.includes("poison")) d.system.immunities.push("poison");
    },
  },
  {
    id: "immune-physical",
    name: "Physical Immunity",
    category: "immunities",
    type: "boon",
    tlDelta: 0,
    description: "Immune to physical damage (very strong — needs on-formula bane)",
    namePrefix: "Ethereal",
    promptFragment: "partially incorporeal, ghostly, weapons pass through",
    suggestedBane: "armor-minus-2",
    apply(d) {
      if (!d.system.immunities) d.system.immunities = [];
      if (!d.system.immunities.includes("physical")) d.system.immunities.push("physical");
    },
  },

  // ══════════════════════════════════════════════
  // WEAKNESSES — Off-formula (used as banes)
  // ══════════════════════════════════════════════

  {
    id: "weakness-fire",
    name: "Fire Weakness",
    category: "weaknesses",
    type: "bane",
    tlDelta: 0,
    description: "Takes double fire damage",
    promptFragment: "dry bark-like skin, flammable",
    apply(d) {
      if (!d.system.weaknesses) d.system.weaknesses = [];
      if (!d.system.weaknesses.includes("fire")) d.system.weaknesses.push("fire");
    },
  },
  {
    id: "weakness-cold",
    name: "Cold Weakness",
    category: "weaknesses",
    type: "bane",
    tlDelta: 0,
    description: "Takes double cold damage",
    promptFragment: "warm-blooded, tropical creature in cold environment",
    apply(d) {
      if (!d.system.weaknesses) d.system.weaknesses = [];
      if (!d.system.weaknesses.includes("cold")) d.system.weaknesses.push("cold");
    },
  },
  {
    id: "weakness-shock",
    name: "Shock Weakness",
    category: "weaknesses",
    type: "bane",
    tlDelta: 0,
    description: "Takes double shock/lightning damage",
    promptFragment: "wet glistening skin, conductive body",
    apply(d) {
      if (!d.system.weaknesses) d.system.weaknesses = [];
      if (!d.system.weaknesses.includes("shock")) d.system.weaknesses.push("shock");
    },
  },
  {
    id: "weakness-silver",
    name: "Silver Weakness",
    category: "weaknesses",
    type: "bane",
    tlDelta: 0,
    description: "Takes double damage from silver weapons",
    promptFragment: "dark corrupted flesh, recoils from moonlight",
    apply(d) {
      if (!d.system.weaknesses) d.system.weaknesses = [];
      if (!d.system.weaknesses.includes("silver")) d.system.weaknesses.push("silver");
    },
  },

  // ══════════════════════════════════════════════
  // STATUS IMMUNITIES — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "status-immune-frightened",
    name: "Immune to Frightened",
    category: "statusImmunities",
    type: "boon",
    tlDelta: 0,
    description: "Cannot be frightened",
    namePrefix: "Fearless",
    promptFragment: "menacing stance, unshakeable resolve",
    apply(d) {
      if (!d.system.statusImmunities) d.system.statusImmunities = [];
      if (!d.system.statusImmunities.includes("frightened")) d.system.statusImmunities.push("frightened");
    },
  },
  {
    id: "status-immune-prone",
    name: "Immune to Prone",
    category: "statusImmunities",
    type: "boon",
    tlDelta: 0,
    description: "Cannot be knocked prone",
    promptFragment: "low center of gravity, multi-legged, stable",
    apply(d) {
      if (!d.system.statusImmunities) d.system.statusImmunities = [];
      if (!d.system.statusImmunities.includes("prone")) d.system.statusImmunities.push("prone");
    },
  },

  // ══════════════════════════════════════════════
  // ABILITIES — Off-formula
  // ══════════════════════════════════════════════

  {
    id: "ability-nimble",
    name: "Nimble",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Cannot be Favored against (hard to hit)",
    namePrefix: "Nimble",
    promptFragment: "agile and quick, dodging effortlessly",
    suggestedBane: "weakness-fire",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Nimble", description: "Attacks against this creature are never Favored." });
    },
  },
  {
    id: "ability-pack-hunter",
    name: "Pack Hunter",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Favored on attacks when ally is Close to target",
    namePrefix: "Pack",
    promptFragment: "hunting in a coordinated pack, lean predator",
    suggestedBane: "morale-minus-3",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Pack Hunter", description: "Attack checks are Favored when an ally is Close to the target." });
    },
  },
  {
    id: "ability-regenerate",
    name: "Regenerate I",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Heals 1d4 HP at start of each turn",
    namePrefix: "Regenerating",
    promptFragment: "wounds visibly closing, rapid healing, pulsing flesh",
    suggestedBane: "weakness-fire",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Regenerate I", description: "At the start of its turn, heals 1d4 HP. Does not regenerate fire or acid damage." });
    },
  },
  {
    id: "ability-terror",
    name: "Terror I",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Enemies must save vs Frightened on sight",
    namePrefix: "Dreadful",
    promptFragment: "terrifying visage, nightmare-inducing, horrific appearance",
    suggestedBane: "morale-minus-3",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Terror I", description: "Creatures that see this monster must make a Will save or become Frightened." });
    },
  },
  {
    id: "ability-magic-ward",
    name: "Magic Ward I",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Favored on saves vs spells and magical effects",
    namePrefix: "Warded",
    promptFragment: "shimmering with protective runes, magical barrier",
    suggestedBane: "weakness-silver",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Magic Ward I", description: "Favored on saves against spells and magical effects." });
    },
  },
  {
    id: "ability-shadow-stealth",
    name: "Shadow Stealth",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Can hide in dim light or darkness",
    namePrefix: "Shadow",
    promptFragment: "shadowy, partially translucent, lurking in darkness",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Shadow Stealth", description: "Can attempt to hide when in dim light or darkness." });
    },
  },
  {
    id: "ability-pounce",
    name: "Pounce",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Knocks target Prone on charge attack",
    namePrefix: "Pouncing",
    promptFragment: "coiled muscles ready to spring, predatory stance",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Pounce", description: "If this creature moves at least 20ft before attacking, the target must save or be knocked Prone." });
    },
  },
  {
    id: "ability-tunneler",
    name: "Tunneler",
    category: "abilities",
    type: "boon",
    tlDelta: 0,
    description: "Can burrow through earth and stone",
    namePrefix: "Burrowing",
    promptFragment: "massive digging claws, covered in dirt, emerging from ground",
    apply(d) {
      if (!d.system.abilities) d.system.abilities = [];
      d.system.abilities.push({ name: "Tunneler", description: "Can move through earth and loose stone at half speed, leaving a tunnel behind." });
    },
  },
];

/* -------------------------------------------- */
/*  Helper Functions                            */
/* -------------------------------------------- */

export function getMutation(id) {
  return MUTATIONS.find(m => m.id === id) || null;
}

export function getMutationsByCategory(category) {
  if (category === "all") return [...MUTATIONS];
  return MUTATIONS.filter(m => m.category === category);
}

export function getBoons() {
  return MUTATIONS.filter(m => m.type === "boon");
}

export function getBanes() {
  return MUTATIONS.filter(m => m.type === "bane");
}
