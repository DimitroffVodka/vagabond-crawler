/**
 * Relic Powers Database
 * Pre-defined Active Effect templates for the Relic Forge.
 *
 * Each power has a `nameFormat` for relic naming:
 *   { position: 'prefix', text: 'Brutal' }       → "Brutal [Item]"
 *   { position: 'suffix', text: 'of Climbing' }   → "[Item] of Climbing"
 *   { position: 'wrap', template: "{input}'s Bane {item}" } → custom template
 *
 * Powers with `requiresInput: true` need user-typed text (creature type, damage type, etc.)
 * The `{input}` placeholder in nameFormat is replaced with that text.
 *
 * `cost` is in gold pieces (added to base item cost when forging).
 * Categories match the official Vagabond Relic Naming Procedure spreadsheet.
 */

export const RELIC_POWER_CATEGORIES = {
  ace:        { label: 'Ace',        icon: 'fas fa-star' },
  bane:       { label: 'Bane',       icon: 'fas fa-skull-crossbones' },
  bonus:      { label: 'Bonus',      icon: 'fas fa-plus-circle' },
  cursed:     { label: 'Cursed',     icon: 'fas fa-skull' },
  fabled:     { label: 'Fabled',     icon: 'fas fa-crown' },
  movement:   { label: 'Movement',   icon: 'fas fa-person-running' },
  protection: { label: 'Protection', icon: 'fas fa-shield' },
  resistance: { label: 'Resistance', icon: 'fas fa-shield-halved' },
  senses:     { label: 'Senses',     icon: 'fas fa-eye' },
  strike:     { label: 'Strike',     icon: 'fas fa-sword' },
  utility:    { label: 'Utility',    icon: 'fas fa-gear' }
};

export const RELIC_POWERS = [

  // ═══════════════════════════════════════════════════════════
  // ACE — Enhances a Weapon Property
  // ═══════════════════════════════════════════════════════════
  {
    id: 'ace-brutal',
    name: 'Ace - Brutal',
    icon: 'fas fa-hammer',
    category: 'ace',
    description: 'Deals an extra damage die from the Brutal Property.',
    cost: 2000,
    nameFormat: { position: 'prefix', text: 'Brutal' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'ace-brutal' },
    addProperties: ['Brutal']
  },
  {
    id: 'ace-cleave',
    name: 'Ace - Cleave',
    icon: 'fas fa-angles-right',
    category: 'ace',
    description: 'Can deal full damage to two Targets.',
    cost: 2000,
    nameFormat: { position: 'prefix', text: 'Cleaving' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'ace-cleave' },
    addProperties: ['Cleave']
  },
  {
    id: 'ace-entangle',
    name: 'Ace - Entangle',
    icon: 'fas fa-link',
    category: 'ace',
    description: 'Target is considered Vulnerable for ending the Restrained Status.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Entangling' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'ace-entangle' },
    addProperties: ['Entangle']
  },
  {
    id: 'ace-keen',
    name: 'Ace - Keen',
    icon: 'fas fa-crosshairs',
    category: 'ace',
    description: 'Crit on Attack Checks 2 lower, rather than 1 lower.',
    cost: 2000,
    nameFormat: { position: 'prefix', text: 'Keen' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'ace-keen' },
    addProperties: ['Keen']
  },
  {
    id: 'ace-long',
    name: 'Ace - Long',
    icon: 'fas fa-arrows-left-right',
    category: 'ace',
    description: 'Its Range is 10\' further, rather than 5\' further.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Long' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'ace-long' },
    addProperties: ['Long']
  },
  {
    id: 'ace-thrown',
    name: 'Ace - Thrown',
    icon: 'fas fa-share',
    category: 'ace',
    description: 'Deals an extra damage die when attacking by throwing it.',
    cost: 2000,
    nameFormat: { position: 'prefix', text: 'Ace Thrown' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'ace-thrown' },
    addProperties: ['Thrown']
  },

  // ═══════════════════════════════════════════════════════════
  // BANE — Extra damage die based on Being Type
  // ═══════════════════════════════════════════════════════════
  {
    id: 'bane-niche',
    name: 'Bane (Niche)',
    icon: 'fas fa-crosshairs',
    category: 'bane',
    description: '+1d6 vs extremely specific Beings (e.g. Trolls, not all giants).',
    cost: 500,
    nameFormat: { position: 'wrap', template: "{input}'s Bane {item}" },
    requiresInput: true,
    inputType: 'compendium',
    inputSource: 'bestiary',
    inputLabel: 'Creature',
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'bane-niche', baneType: 'niche', baneDice: '1d6', baneTarget: '{input}' }
  },
  {
    id: 'bane-specific',
    name: 'Bane (Specific)',
    icon: 'fas fa-crosshairs',
    category: 'bane',
    description: '+2d6 vs a Being subtype (e.g. giants, not all Cryptids).',
    cost: 2000,
    nameFormat: { position: 'wrap', template: "{input}'s Bane {item}" },
    requiresInput: true,
    inputType: 'select',
    inputLabel: 'Subtype',
    inputOptions: [
      'Amphibian', 'Beyonder', 'Bird', 'Divine', 'Djinn', 'Dragon', 'Drakken',
      'Dwarf', 'Elemental', 'Elf', 'Fish', 'Giant', 'Goblin', 'Golem', 'Hag',
      'Halfling', 'Hellspawn', 'Human', 'Insect', 'Mammal', 'Orc', 'Plant',
      'Potead', 'Reptile', 'Sahpechanger', 'Slime', 'Spider', 'Statue', 'Wyrm'
    ],
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'bane-specific', baneType: 'specific', baneDice: '2d6', baneTarget: '{input}' }
  },
  {
    id: 'bane-general',
    name: 'Bane (General)',
    icon: 'fas fa-crosshairs',
    category: 'bane',
    description: '+3d6 vs an entire Being Type (e.g. Cryptids, Undead).',
    cost: 5000,
    nameFormat: { position: 'wrap', template: "{input}'s Bane {item}" },
    requiresInput: true,
    inputType: 'select',
    inputLabel: 'Being Type',
    inputOptions: [
      'Artificial', 'Beast', 'Cryptid', 'Fae', 'Humanlike', 'Outer', 'Primordial', 'Undead'
    ],
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'bane-general', baneType: 'general', baneDice: '3d6', baneTarget: '{input}' }
  },

  // ═══════════════════════════════════════════════════════════
  // BONUS — Indicated bonus to indicated attributes
  // ═══════════════════════════════════════════════════════════
  {
    id: 'bonus-armor-1',
    name: 'Armor +1',
    icon: 'fas fa-shield',
    category: 'bonus',
    description: '+1 bonus to Armor.',
    cost: 100,
    nameFormat: { position: 'prefix', text: '+1' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.armorBonus', mode: 2, value: '1' }],
    flags: { relicPower: 'bonus-armor-1' }
  },
  {
    id: 'bonus-armor-2',
    name: 'Armor +2',
    icon: 'fas fa-shield',
    category: 'bonus',
    description: '+2 bonus to Armor.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: '+2' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.armorBonus', mode: 2, value: '2' }],
    flags: { relicPower: 'bonus-armor-2' }
  },
  {
    id: 'bonus-armor-3',
    name: 'Armor +3',
    icon: 'fas fa-shield',
    category: 'bonus',
    description: '+3 bonus to Armor.',
    cost: 50000,
    nameFormat: { position: 'prefix', text: '+3' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.armorBonus', mode: 2, value: '3' }],
    flags: { relicPower: 'bonus-armor-3' }
  },
  {
    id: 'bonus-protection-1',
    name: 'Protection +1',
    icon: 'fas fa-shield-heart',
    category: 'bonus',
    description: '+1 bonus to Saves.',
    cost: 1000,
    nameFormat: { position: 'suffix', text: 'of Minor Protection' },
    applicationMode: 'when-equipped',
    changes: [
      { key: 'system.saves.reflex.bonus', mode: 2, value: '1' },
      { key: 'system.saves.endure.bonus', mode: 2, value: '1' },
      { key: 'system.saves.will.bonus', mode: 2, value: '1' }
    ],
    flags: { relicPower: 'bonus-protection-1' }
  },
  {
    id: 'bonus-protection-2',
    name: 'Protection +2',
    icon: 'fas fa-shield-heart',
    category: 'bonus',
    description: '+2 bonus to Saves.',
    cost: 10000,
    nameFormat: { position: 'suffix', text: 'of Protection' },
    applicationMode: 'when-equipped',
    changes: [
      { key: 'system.saves.reflex.bonus', mode: 2, value: '2' },
      { key: 'system.saves.endure.bonus', mode: 2, value: '2' },
      { key: 'system.saves.will.bonus', mode: 2, value: '2' }
    ],
    flags: { relicPower: 'bonus-protection-2' }
  },
  {
    id: 'bonus-protection-3',
    name: 'Protection +3',
    icon: 'fas fa-shield-heart',
    category: 'bonus',
    description: '+3 bonus to Saves.',
    cost: 100000,
    nameFormat: { position: 'suffix', text: 'of Major Protection' },
    applicationMode: 'when-equipped',
    changes: [
      { key: 'system.saves.reflex.bonus', mode: 2, value: '3' },
      { key: 'system.saves.endure.bonus', mode: 2, value: '3' },
      { key: 'system.saves.will.bonus', mode: 2, value: '3' }
    ],
    flags: { relicPower: 'bonus-protection-3' }
  },
  {
    id: 'bonus-trinket-1',
    name: 'Trinket +1',
    icon: 'fas fa-hat-wizard',
    category: 'bonus',
    description: '+1 bonus to Spell damage.',
    cost: 200,
    nameFormat: { position: 'suffix', text: 'of Minor Spell Power' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalSpellDamageBonus', mode: 2, value: '1' }],
    flags: { relicPower: 'bonus-trinket-1' }
  },
  {
    id: 'bonus-trinket-2',
    name: 'Trinket +2',
    icon: 'fas fa-hat-wizard',
    category: 'bonus',
    description: '+2 bonus to Spell damage.',
    cost: 2500,
    nameFormat: { position: 'suffix', text: 'of Spell Power' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalSpellDamageBonus', mode: 2, value: '2' }],
    flags: { relicPower: 'bonus-trinket-2' }
  },
  {
    id: 'bonus-trinket-3',
    name: 'Trinket +3',
    icon: 'fas fa-hat-wizard',
    category: 'bonus',
    description: '+3 bonus to Spell damage.',
    cost: 10000,
    nameFormat: { position: 'suffix', text: 'of Major Spell Power' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalSpellDamageBonus', mode: 2, value: '3' }],
    flags: { relicPower: 'bonus-trinket-3' }
  },
  {
    id: 'bonus-weapon-1',
    name: 'Weapon +1',
    icon: 'fas fa-bullseye',
    category: 'bonus',
    description: '+1 bonus to Weapon damage.',
    cost: 100,
    nameFormat: { position: 'prefix', text: '+1' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageBonus', mode: 2, value: '1' }],
    flags: { relicPower: 'bonus-weapon-1' }
  },
  {
    id: 'bonus-weapon-2',
    name: 'Weapon +2',
    icon: 'fas fa-bullseye',
    category: 'bonus',
    description: '+2 bonus to Weapon damage.',
    cost: 1250,
    nameFormat: { position: 'prefix', text: '+2' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageBonus', mode: 2, value: '2' }],
    flags: { relicPower: 'bonus-weapon-2' }
  },
  {
    id: 'bonus-weapon-3',
    name: 'Weapon +3',
    icon: 'fas fa-bullseye',
    category: 'bonus',
    description: '+3 bonus to Weapon damage.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: '+3' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageBonus', mode: 2, value: '3' }],
    flags: { relicPower: 'bonus-weapon-3' }
  },

  // ═══════════════════════════════════════════════════════════
  // CURSED
  // ═══════════════════════════════════════════════════════════
  {
    id: 'cursed-anger',
    name: 'Cursed - Anger',
    icon: 'fas fa-face-angry',
    category: 'cursed',
    description: 'Auto-fail saves vs Berserk.',
    cost: 0,
    nameFormat: { position: 'prefix', text: 'Angering' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.autoFailSaveVs.berserk', mode: 5, value: 'true' }],
    flags: { relicPower: 'cursed-anger', autoFailSaveVs: 'berserk' }
  },
  {
    id: 'cursed-cowardice',
    name: 'Cursed - Cowardice',
    icon: 'fas fa-face-flushed',
    category: 'cursed',
    description: 'Auto-fail saves vs Frightened.',
    cost: 0,
    nameFormat: { position: 'prefix', text: 'Cowering' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.autoFailSaveVs.frightened', mode: 5, value: 'true' }],
    flags: { relicPower: 'cursed-cowardice', autoFailSaveVs: 'frightened' }
  },
  {
    id: 'cursed-doom',
    name: 'Cursed - Doom',
    icon: 'fas fa-skull',
    category: 'cursed',
    description: 'Healing capped at 1 per die.',
    cost: 0,
    nameFormat: { position: 'prefix', text: 'Doomed' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.healingCappedPerDie', mode: 5, value: '1' }],
    flags: { relicPower: 'cursed-doom', healingCappedPerDie: 1 }
  },
  {
    id: 'cursed-gullibility',
    name: 'Cursed - Gullibility',
    icon: 'fas fa-face-smile',
    category: 'cursed',
    description: 'Auto-fail saves vs Charmed.',
    cost: 0,
    nameFormat: { position: 'prefix', text: 'Gullible' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.autoFailSaveVs.charmed', mode: 5, value: 'true' }],
    flags: { relicPower: 'cursed-gullibility', autoFailSaveVs: 'charmed' }
  },
  {
    id: 'cursed-vulnerability-1',
    name: 'Vulnerability -1',
    icon: 'fas fa-heart-crack',
    category: 'cursed',
    description: '-1 Armor penalty.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of Minor Vulnerability' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.armorBonus', mode: 2, value: '-1' }],
    flags: { relicPower: 'cursed-vulnerability-1' }
  },
  {
    id: 'cursed-vulnerability-2',
    name: 'Vulnerability -2',
    icon: 'fas fa-heart-crack',
    category: 'cursed',
    description: '-2 Armor penalty.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of Vulnerability' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.armorBonus', mode: 2, value: '-2' }],
    flags: { relicPower: 'cursed-vulnerability-2' }
  },
  {
    id: 'cursed-vulnerability-3',
    name: 'Vulnerability -3',
    icon: 'fas fa-heart-crack',
    category: 'cursed',
    description: '-3 Armor penalty.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of Major Vulnerability' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.armorBonus', mode: 2, value: '-3' }],
    flags: { relicPower: 'cursed-vulnerability-3' }
  },
  {
    id: 'cursed-weakness-1',
    name: 'Weakness -1',
    icon: 'fas fa-arrow-down',
    category: 'cursed',
    description: '-1 weapon damage penalty.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of Minor Weakness' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageBonus', mode: 2, value: '-1' }],
    flags: { relicPower: 'cursed-weakness-1' }
  },
  {
    id: 'cursed-weakness-2',
    name: 'Weakness -2',
    icon: 'fas fa-arrow-down',
    category: 'cursed',
    description: '-2 weapon damage penalty.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of Weakness' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageBonus', mode: 2, value: '-2' }],
    flags: { relicPower: 'cursed-weakness-2' }
  },
  {
    id: 'cursed-weakness-3',
    name: 'Weakness -3',
    icon: 'fas fa-arrow-down',
    category: 'cursed',
    description: '-3 weapon damage penalty.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of Major Weakness' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageBonus', mode: 2, value: '-3' }],
    flags: { relicPower: 'cursed-weakness-3' }
  },

  // ═══════════════════════════════════════════════════════════
  // FABLED — Unique/Epic powers
  // ═══════════════════════════════════════════════════════════
  {
    id: 'fabled-benediction',
    name: 'Benediction',
    icon: 'fas fa-cross',
    category: 'fabled',
    description: 'Once per week, revive on death with 1 HP.',
    cost: 50000,
    nameFormat: { position: 'prefix', text: 'Blessed' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'benediction' }
  },
  {
    id: 'fabled-blasting',
    name: 'Blasting',
    icon: 'fas fa-explosion',
    category: 'fabled',
    description: 'Once per day, unleash a blast of energy dealing 6d6 damage in a Close area.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: 'Blasting' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'blasting', blastDamage: '6d6', usesPerDay: 1 }
  },
  {
    id: 'fabled-precision',
    name: 'Precision',
    icon: 'fas fa-bullseye',
    category: 'fabled',
    description: 'Once per day, automatically hit with an attack (no roll needed).',
    cost: 10000,
    nameFormat: { position: 'prefix', text: 'Precise' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'precision', usesPerDay: 1 }
  },
  {
    id: 'fabled-soul-eater',
    name: 'Soul Eater',
    icon: 'fas fa-ghost',
    category: 'fabled',
    description: 'Creatures killed by this weapon cannot be resurrected.',
    cost: 50000,
    nameFormat: { position: 'prefix', text: 'Soul Eating' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'soul-eater' }
  },
  {
    id: 'fabled-vicious',
    name: 'Vicious',
    icon: 'fas fa-biohazard',
    category: 'fabled',
    description: 'On crit, deal extra damage equal to 2x your Hit Die.',
    cost: 25000,
    nameFormat: { position: 'prefix', text: 'Vicious' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'vicious' }
  },
  {
    id: 'fabled-vorpal',
    name: 'Vorpal',
    icon: 'fas fa-skull',
    category: 'fabled',
    description: 'On crit, behead the target (if applicable).',
    cost: 50000,
    nameFormat: { position: 'prefix', text: 'Vorpal' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'vorpal' }
  },
  {
    id: 'fabled-wish-granting',
    name: 'Wish-Granting',
    icon: 'fas fa-star',
    category: 'fabled',
    description: 'Once ever, grant a single wish (GM discretion).',
    cost: 1000000,
    nameFormat: { position: 'prefix', text: 'Wish-Granting' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'wish-granting', usesTotal: 1 }
  },

  // ═══════════════════════════════════════════════════════════
  // MOVEMENT
  // ═══════════════════════════════════════════════════════════
  {
    id: 'movement-blinking',
    name: 'Blinking',
    icon: 'fas fa-bolt',
    category: 'movement',
    description: 'Can teleport short distances.',
    cost: 2000,
    nameFormat: { position: 'prefix', text: 'Blinking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.blink', mode: 5, value: 'true' }],
    flags: { relicPower: 'blinking', grantedMovement: 'blink' }
  },
  {
    id: 'movement-climbing',
    name: 'Climbing',
    icon: 'fas fa-mountain',
    category: 'movement',
    description: 'Grants Climb speed.',
    cost: 500,
    nameFormat: { position: 'suffix', text: 'of Climbing' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.climb', mode: 5, value: 'true' }],
    flags: { relicPower: 'climbing', grantedMovement: 'climb' }
  },
  {
    id: 'movement-clinging',
    name: 'Clinging',
    icon: 'fas fa-spider',
    category: 'movement',
    description: 'Cling to walls and ceilings.',
    cost: 2500,
    nameFormat: { position: 'suffix', text: 'of Clinging' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.cling', mode: 5, value: 'true' }],
    flags: { relicPower: 'clinging', grantedMovement: 'cling' }
  },
  {
    id: 'movement-displacement',
    name: 'Displacement',
    icon: 'fas fa-clone',
    category: 'movement',
    description: 'Image shifts — attackers are treated as Blinded.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Displacing' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.defenderStatusModifiers.attackersAreBlinded', mode: 5, value: 'true' }],
    flags: { relicPower: 'displacement' }
  },
  {
    id: 'movement-flying',
    name: 'Flying',
    icon: 'fas fa-feather',
    category: 'movement',
    description: 'Grants Fly speed.',
    cost: 5000,
    nameFormat: { position: 'suffix', text: 'of Flying' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.fly', mode: 5, value: 'true' }],
    flags: { relicPower: 'flying', grantedMovement: 'fly' }
  },
  {
    id: 'movement-jumping-1',
    name: 'Jumping I',
    icon: 'fas fa-arrow-up',
    category: 'movement',
    description: 'Jump distance x2.',
    cost: 500,
    nameFormat: { position: 'suffix', text: 'of Minor Jumping' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'jumping-1', jumpMultiplier: 2 }
  },
  {
    id: 'movement-jumping-2',
    name: 'Jumping II',
    icon: 'fas fa-arrow-up',
    category: 'movement',
    description: 'Jump distance x3.',
    cost: 2500,
    nameFormat: { position: 'suffix', text: 'of Jumping' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'jumping-2', jumpMultiplier: 3 }
  },
  {
    id: 'movement-jumping-3',
    name: 'Jumping III',
    icon: 'fas fa-arrow-up',
    category: 'movement',
    description: 'Jump distance x4.',
    cost: 12500,
    nameFormat: { position: 'suffix', text: 'of Major Jumping' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'jumping-3', jumpMultiplier: 4 }
  },
  {
    id: 'movement-levitation',
    name: 'Levitation',
    icon: 'fas fa-cloud',
    category: 'movement',
    description: 'Grants Levitate (hover in place).',
    cost: 500,
    nameFormat: { position: 'suffix', text: 'of Levitation' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.levitate', mode: 5, value: 'true' }],
    flags: { relicPower: 'levitation', grantedMovement: 'levitate' }
  },
  {
    id: 'movement-swiftness-1',
    name: 'Swiftness I',
    icon: 'fas fa-person-running',
    category: 'movement',
    description: '+5 Speed bonus.',
    cost: 250,
    nameFormat: { position: 'suffix', text: 'of Minor Swiftness' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.speed.bonus', mode: 2, value: '5' }],
    flags: { relicPower: 'swiftness-1' }
  },
  {
    id: 'movement-swiftness-2',
    name: 'Swiftness II',
    icon: 'fas fa-person-running',
    category: 'movement',
    description: '+10 Speed bonus.',
    cost: 1000,
    nameFormat: { position: 'suffix', text: 'of Swiftness' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.speed.bonus', mode: 2, value: '10' }],
    flags: { relicPower: 'swiftness-2' }
  },
  {
    id: 'movement-swiftness-3',
    name: 'Swiftness III',
    icon: 'fas fa-person-running',
    category: 'movement',
    description: '+15 Speed bonus.',
    cost: 5000,
    nameFormat: { position: 'suffix', text: 'of Major Swiftness' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.speed.bonus', mode: 2, value: '15' }],
    flags: { relicPower: 'swiftness-3' }
  },
  {
    id: 'movement-waterwalk',
    name: 'Waterwalk',
    icon: 'fas fa-water',
    category: 'movement',
    description: 'Walk on water.',
    cost: 500,
    nameFormat: { position: 'suffix', text: 'of Waterwalking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.waterwalk', mode: 5, value: 'true' }],
    flags: { relicPower: 'waterwalk', grantedMovement: 'waterwalk' }
  },
  {
    id: 'movement-webwalk',
    name: 'Webwalk',
    icon: 'fas fa-spider',
    category: 'movement',
    description: 'Move through webs freely.',
    cost: 500,
    nameFormat: { position: 'suffix', text: 'of Webwalking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.movement.webwalk', mode: 5, value: 'true' }],
    flags: { relicPower: 'webwalk', grantedMovement: 'webwalk' }
  },

  // ═══════════════════════════════════════════════════════════
  // PROTECTION — Favor on saves vs creature types
  // ═══════════════════════════════════════════════════════════
  {
    id: 'protection-niche',
    name: 'Protection (Niche)',
    icon: 'fas fa-shield',
    category: 'protection',
    description: 'Favor on saves vs extremely specific Beings.',
    cost: 500,
    nameFormat: { position: 'suffix', text: 'of Protection Against {input}' },
    requiresInput: true,
    inputType: 'compendium',
    inputSource: 'bestiary',
    inputLabel: 'Creature',
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'protection-niche', wardType: 'niche', wardTarget: '{input}' }
  },
  {
    id: 'protection-specific',
    name: 'Protection (Specific)',
    icon: 'fas fa-shield',
    category: 'protection',
    description: 'Favor on saves vs a Being subtype.',
    cost: 2000,
    nameFormat: { position: 'suffix', text: 'of Protection Against {input}' },
    requiresInput: true,
    inputType: 'select',
    inputLabel: 'Subtype',
    inputOptions: [
      'Amphibian', 'Beyonder', 'Bird', 'Divine', 'Djinn', 'Dragon', 'Drakken',
      'Dwarf', 'Elemental', 'Elf', 'Fish', 'Giant', 'Goblin', 'Golem', 'Hag',
      'Halfling', 'Hellspawn', 'Human', 'Insect', 'Mammal', 'Orc', 'Plant',
      'Potead', 'Reptile', 'Sahpechanger', 'Slime', 'Spider', 'Statue', 'Wyrm'
    ],
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'protection-specific', wardType: 'specific', wardTarget: '{input}' }
  },
  {
    id: 'protection-general',
    name: 'Protection (General)',
    icon: 'fas fa-shield',
    category: 'protection',
    description: 'Favor on saves vs an entire Being Type.',
    cost: 5000,
    nameFormat: { position: 'suffix', text: 'of Protection Against {input}' },
    requiresInput: true,
    inputType: 'select',
    inputLabel: 'Being Type',
    inputOptions: [
      'Artificial', 'Beast', 'Cryptid', 'Fae', 'Humanlike', 'Outer', 'Primordial', 'Undead'
    ],
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'protection-general', wardType: 'general', wardTarget: '{input}' }
  },

  // ═══════════════════════════════════════════════════════════
  // RESISTANCE — Favor on saves vs conditions / damage types
  // ═══════════════════════════════════════════════════════════
  {
    id: 'resistance-bravery',
    name: 'Bravery',
    icon: 'fas fa-shield-heart',
    category: 'resistance',
    description: 'Favor on saves vs Frightened.',
    cost: 150,
    nameFormat: { position: 'prefix', text: 'Brave' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.favorOnSaveVs.frightened', mode: 5, value: 'true' }],
    flags: { relicPower: 'resistance-bravery' }
  },
  {
    id: 'resistance-clarity',
    name: 'Clarity',
    icon: 'fas fa-lightbulb',
    category: 'resistance',
    description: 'Favor on saves vs Confused.',
    cost: 150,
    nameFormat: { position: 'prefix', text: 'Clear-minded' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.favorOnSaveVs.confused', mode: 5, value: 'true' }],
    flags: { relicPower: 'resistance-clarity' }
  },
  {
    id: 'resistance-repulsing',
    name: 'Repulsing',
    icon: 'fas fa-ban',
    category: 'resistance',
    description: 'Favor on saves vs Charmed.',
    cost: 150,
    nameFormat: { position: 'prefix', text: 'Repelling' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.favorOnSaveVs.charmed', mode: 5, value: 'true' }],
    flags: { relicPower: 'resistance-repulsing' }
  },
  {
    id: 'resistance-typed',
    name: 'Resistance',
    icon: 'fas fa-shield-halved',
    category: 'resistance',
    description: 'Resistance to a specific damage type (half damage before armor).',
    cost: 2500,
    nameFormat: { position: 'prefix', text: '{input} Resistant' },
    requiresInput: true,
    inputType: 'select',
    inputLabel: 'Damage Type',
    inputOptions: [
      'Acid', 'Fire', 'Shock', 'Poison', 'Cold', 'Blunt', 'Piercing',
      'Slashing', 'Physical', 'Necrotic', 'Psychic', 'Magical'
    ],
    applicationMode: 'when-equipped',
    // Resistance type stored in flags — calculateFinalDamage reads equipped item AE flags
    changes: [],
    flags: { relicPower: 'resistance-typed', damageResistance: '{input}' }
  },

  // ═══════════════════════════════════════════════════════════
  // SENSES
  // ═══════════════════════════════════════════════════════════
  {
    id: 'senses-detection',
    name: 'Detection',
    icon: 'fas fa-magnifying-glass',
    category: 'senses',
    description: 'Detect a specific Being type nearby.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: '{input} Detecting' },
    requiresInput: true,
    inputLabel: 'Being Type (e.g. Beast, Undead)',
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.detection', mode: 5, value: 'true' }],
    flags: { relicPower: 'detection', grantedSense: 'detection' }
  },
  {
    id: 'senses-nightvision',
    name: 'Nightvision',
    icon: 'fas fa-eye',
    category: 'senses',
    description: 'See in darkness.',
    cost: 100,
    nameFormat: { position: 'suffix', text: 'of Darksight' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.darksight', mode: 5, value: 'true' }],
    flags: { relicPower: 'nightvision', grantedSense: 'darksight' }
  },
  {
    id: 'senses-echolocation',
    name: 'Echolocation',
    icon: 'fas fa-satellite-dish',
    category: 'senses',
    description: 'Perceive surroundings via sound.',
    cost: 250,
    nameFormat: { position: 'suffix', text: 'of Echolocation' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.echolocation', mode: 5, value: 'true' }],
    flags: { relicPower: 'echolocation', grantedSense: 'echolocation' }
  },
  {
    id: 'senses-life',
    name: 'Sense Life',
    icon: 'fas fa-heartbeat',
    category: 'senses',
    description: 'Sense living creatures within Near range.',
    cost: 10000,
    nameFormat: { position: 'prefix', text: 'Life Sensing' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.senseLife', mode: 5, value: 'true' }],
    flags: { relicPower: 'sense-life', grantedSense: 'senseLife' }
  },
  {
    id: 'senses-valuables',
    name: 'Sense Valuables',
    icon: 'fas fa-coins',
    category: 'senses',
    description: 'Sense valuable items and treasure within Near range.',
    cost: 10000,
    nameFormat: { position: 'prefix', text: 'Treasure Seeking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.senseValuables', mode: 5, value: 'true' }],
    flags: { relicPower: 'sense-valuables', grantedSense: 'senseValuables' }
  },
  {
    id: 'senses-tremors',
    name: 'Tremors',
    icon: 'fas fa-hill-rockslide',
    category: 'senses',
    description: 'Sense vibrations through the ground (seismic sense).',
    cost: 1000,
    nameFormat: { position: 'suffix', text: 'of Seismic Sense' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.tremorsense', mode: 5, value: 'true' }],
    flags: { relicPower: 'tremors', grantedSense: 'tremorsense' }
  },
  {
    id: 'senses-telepathy',
    name: 'Telepathy',
    icon: 'fas fa-comments',
    category: 'senses',
    description: 'Communicate mentally.',
    cost: 10000,
    nameFormat: { position: 'prefix', text: 'Telepathic' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.telepathy', mode: 5, value: 'true' }],
    flags: { relicPower: 'telepathy', grantedSense: 'telepathy' }
  },
  {
    id: 'senses-truesight',
    name: 'True-Seeing',
    icon: 'fas fa-eye-low-vision',
    category: 'senses',
    description: 'See through illusions and invisibility.',
    cost: 20000,
    nameFormat: { position: 'prefix', text: 'True-Seeing' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.senses.allsight', mode: 5, value: 'true' }],
    flags: { relicPower: 'true-seeing', grantedSense: 'allsight' }
  },

  // ═══════════════════════════════════════════════════════════
  // STRIKE — Bonus damage dice
  // ═══════════════════════════════════════════════════════════
  {
    id: 'strike-1',
    name: 'Strike I',
    icon: 'fas fa-dice-d20',
    category: 'strike',
    description: '+1d4 bonus weapon damage die.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Minor Striking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageDice', mode: 2, value: '1d4' }],
    flags: { relicPower: 'strike-1' }
  },
  {
    id: 'strike-2',
    name: 'Strike II',
    icon: 'fas fa-dice-d20',
    category: 'strike',
    description: '+1d6 bonus weapon damage die.',
    cost: 2500,
    nameFormat: { position: 'prefix', text: 'Striking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageDice', mode: 2, value: '1d6' }],
    flags: { relicPower: 'strike-2' }
  },
  {
    id: 'strike-3',
    name: 'Strike III',
    icon: 'fas fa-dice-d20',
    category: 'strike',
    description: '+1d8 bonus weapon damage die.',
    cost: 8000,
    nameFormat: { position: 'prefix', text: 'Major Striking' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.universalWeaponDamageDice', mode: 2, value: '1d8' }],
    flags: { relicPower: 'strike-3' }
  },

  // ═══════════════════════════════════════════════════════════
  // UTILITY — Magical quirks other than Combat and Mobility
  // ═══════════════════════════════════════════════════════════
  {
    id: 'utility-after-image-1',
    name: 'After-Image I',
    icon: 'fas fa-clone',
    category: 'utility',
    description: 'Once per day, create an illusory duplicate (short duration).',
    cost: 500,
    nameFormat: { position: 'prefix', text: 'Minor Illusory' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'after-image-1', usesPerDay: 1 }
  },
  {
    id: 'utility-after-image-2',
    name: 'After-Image II',
    icon: 'fas fa-clone',
    category: 'utility',
    description: 'Once per day, create an illusory duplicate (longer duration).',
    cost: 2500,
    nameFormat: { position: 'prefix', text: 'Illusory' },
    applicationMode: 'on-use',
    changes: [],
    flags: { relicPower: 'after-image-2', usesPerDay: 1 }
  },
  {
    id: 'utility-ambassador',
    name: 'Ambassador',
    icon: 'fas fa-handshake',
    category: 'utility',
    description: 'Understand and speak all languages while equipped.',
    cost: 1250,
    nameFormat: { position: 'prefix', text: 'Diplomatic' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.speakAllLanguages', mode: 5, value: 'true' }],
    flags: { relicPower: 'ambassador' }
  },
  {
    id: 'utility-aqua-lung',
    name: 'Aqua Lung',
    icon: 'fas fa-fish',
    category: 'utility',
    description: 'Breathe underwater.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: 'Water Breathing' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.breatheUnderwater', mode: 5, value: 'true' }],
    flags: { relicPower: 'aqua-lung' }
  },
  {
    id: 'utility-burning-1',
    name: 'Burning I',
    icon: 'fas fa-fire',
    category: 'utility',
    description: 'On hit, apply Burning with d4 countdown die.',
    cost: 4000,
    nameFormat: { position: 'prefix', text: 'Minor Burning' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.onHitBurningDice', mode: 5, value: 'd4' }],
    flags: { relicPower: 'burning-1' }
  },
  {
    id: 'utility-burning-2',
    name: 'Burning II',
    icon: 'fas fa-fire',
    category: 'utility',
    description: 'On hit, apply Burning with d6 countdown die.',
    cost: 15000,
    nameFormat: { position: 'prefix', text: 'Burning' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.onHitBurningDice', mode: 5, value: 'd6' }],
    flags: { relicPower: 'burning-2' }
  },
  {
    id: 'utility-burning-3',
    name: 'Burning III',
    icon: 'fas fa-fire',
    category: 'utility',
    description: 'On hit, apply Burning with d8 countdown die.',
    cost: 64000,
    nameFormat: { position: 'prefix', text: 'Major Burning' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.onHitBurningDice', mode: 5, value: 'd8' }],
    flags: { relicPower: 'burning-3' }
  },
  {
    id: 'utility-darkness-1',
    name: 'Darkness I',
    icon: 'fas fa-circle',
    category: 'utility',
    description: 'Emits magical darkness out to Close while Equipped.',
    cost: 500,
    nameFormat: { position: 'prefix', text: 'Minor Darkening' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'darkness-1', lightType: 'darkness', lightRange: 'close' }
  },
  {
    id: 'utility-darkness-2',
    name: 'Darkness II',
    icon: 'fas fa-circle',
    category: 'utility',
    description: 'Emits magical darkness out to Near while Equipped.',
    cost: 1250,
    nameFormat: { position: 'prefix', text: 'Darkening' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'darkness-2', lightType: 'darkness', lightRange: 'near' }
  },
  {
    id: 'utility-darkness-3',
    name: 'Darkness III',
    icon: 'fas fa-circle',
    category: 'utility',
    description: 'Emits magical darkness out to Far while Equipped.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: 'Major Darkening' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'darkness-3', lightType: 'darkness', lightRange: 'far' }
  },
  {
    id: 'utility-holding',
    name: 'Holding (Rank)',
    icon: 'fas fa-box',
    category: 'utility',
    description: '+3 inventory slots.',
    cost: 200,
    nameFormat: { position: 'prefix', text: '+3 Holding' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.inventory.bonusSlots', mode: 2, value: '3' }],
    flags: { relicPower: 'holding' }
  },
  {
    id: 'utility-infinite',
    name: 'Infinite',
    icon: 'fas fa-infinity',
    category: 'utility',
    description: 'Item never runs out of ammunition or charges.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Unlimited' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'infinite' }
  },
  {
    id: 'utility-invisibility-1',
    name: 'Invisibility I',
    icon: 'fas fa-ghost',
    category: 'utility',
    description: 'Skip your Move to become Invisible until you move or attack.',
    cost: 5000,
    nameFormat: { position: 'suffix', text: 'of Invisibility' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'invisibility-1' }
  },
  {
    id: 'utility-invisibility-2',
    name: 'Invisibility II',
    icon: 'fas fa-ghost',
    category: 'utility',
    description: 'Permanently Invisible while equipped.',
    cost: 50000,
    nameFormat: { position: 'suffix', text: 'of Major Invisibility' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.defenderStatusModifiers.attackersAreBlinded', mode: 5, value: 'true' }],
    statuses: ['invisible'],
    flags: { relicPower: 'invisibility-2' }
  },
  {
    id: 'utility-lifesteal-1',
    name: 'Lifesteal I',
    icon: 'fas fa-heart',
    category: 'utility',
    description: 'On kill, heal 1d8 HP.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Minor Lifestealing' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'lifesteal-1', onKillHealDice: '1d8' }
  },
  {
    id: 'utility-lifesteal-2',
    name: 'Lifesteal II',
    icon: 'fas fa-heart',
    category: 'utility',
    description: 'On kill, heal 2d8 HP.',
    cost: 12500,
    nameFormat: { position: 'prefix', text: 'Lifestealing' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'lifesteal-2', onKillHealDice: '2d8' }
  },
  {
    id: 'utility-lifesteal-3',
    name: 'Lifesteal III',
    icon: 'fas fa-heart',
    category: 'utility',
    description: 'On kill, heal 3d8 HP.',
    cost: 50000,
    nameFormat: { position: 'prefix', text: 'Major Lifestealing' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'lifesteal-3', onKillHealDice: '3d8' }
  },
  {
    id: 'utility-loyalty',
    name: 'Loyalty',
    icon: 'fas fa-hand-holding-heart',
    category: 'utility',
    description: 'Returns to owner when thrown or disarmed.',
    cost: 1000,
    nameFormat: { position: 'prefix', text: 'Loyal' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'loyalty' }
  },
  {
    id: 'utility-manasteal-1',
    name: 'Manasteal I',
    icon: 'fas fa-droplet',
    category: 'utility',
    description: 'On kill, restore 1d4 Mana.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: 'Minor Mana Stealing' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'manasteal-1', onKillManaDice: '1d4' }
  },
  {
    id: 'utility-manasteal-2',
    name: 'Manasteal II',
    icon: 'fas fa-droplet',
    category: 'utility',
    description: 'On kill, restore 2d4 Mana.',
    cost: 20000,
    nameFormat: { position: 'prefix', text: 'Mana Stealing' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'manasteal-2', onKillManaDice: '2d4' }
  },
  {
    id: 'utility-manasteal-3',
    name: 'Manasteal III',
    icon: 'fas fa-droplet',
    category: 'utility',
    description: 'On kill, restore 3d4 Mana.',
    cost: 50000,
    nameFormat: { position: 'prefix', text: 'Major Mana Stealing' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'manasteal-3', onKillManaDice: '3d4' }
  },
  {
    id: 'utility-moonlit-1',
    name: 'Moonlit I',
    icon: 'fas fa-moon',
    category: 'utility',
    description: 'Sheds Moonlight out to Close while Equipped.',
    cost: 500,
    nameFormat: { position: 'prefix', text: 'Minor Moonlit' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'moonlit-1', lightType: 'moonlight', lightRange: 'close' }
  },
  {
    id: 'utility-moonlit-2',
    name: 'Moonlit II',
    icon: 'fas fa-moon',
    category: 'utility',
    description: 'Sheds Moonlight out to Near while Equipped.',
    cost: 1250,
    nameFormat: { position: 'prefix', text: 'Moonlit' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'moonlit-2', lightType: 'moonlight', lightRange: 'near' }
  },
  {
    id: 'utility-moonlit-3',
    name: 'Moonlit III',
    icon: 'fas fa-moon',
    category: 'utility',
    description: 'Sheds Moonlight out to Far while Equipped.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: 'Major Moonlit' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'moonlit-3', lightType: 'moonlight', lightRange: 'far' }
  },
  {
    id: 'utility-radiant-1',
    name: 'Radiant I',
    icon: 'fas fa-sun',
    category: 'utility',
    description: 'Sheds Sunlight out to Close while Equipped.',
    cost: 2000,
    nameFormat: { position: 'prefix', text: 'Minor Radiant' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'radiant-1', lightType: 'sunlight', lightRange: 'close' }
  },
  {
    id: 'utility-radiant-2',
    name: 'Radiant II',
    icon: 'fas fa-sun',
    category: 'utility',
    description: 'Sheds Sunlight out to Near while Equipped.',
    cost: 5000,
    nameFormat: { position: 'prefix', text: 'Radiant' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'radiant-2', lightType: 'sunlight', lightRange: 'near' }
  },
  {
    id: 'utility-radiant-3',
    name: 'Radiant III',
    icon: 'fas fa-sun',
    category: 'utility',
    description: 'Sheds Sunlight out to Far while Equipped.',
    cost: 20000,
    nameFormat: { position: 'prefix', text: 'Major Radiant' },
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'radiant-3', lightType: 'sunlight', lightRange: 'far' }
  },
  {
    id: 'utility-store-spell',
    name: 'Store Spell',
    icon: 'fas fa-wand-sparkles',
    category: 'utility',
    description: 'Reduce Caster\'s Maximum Mana to store a Casting of a Spell.',
    cost: 0,
    nameFormat: { position: 'suffix', text: 'of {input}' },
    requiresInput: true,
    inputType: 'compendium',
    inputSource: 'spells',
    inputLabel: 'Spell',
    applicationMode: 'when-equipped',
    changes: [],
    flags: { relicPower: 'store-spell' }
  },
  {
    id: 'utility-warning',
    name: 'Warning',
    icon: 'fas fa-bell',
    category: 'utility',
    description: 'Bound Being can\'t be surprised, and is awoken if foes are Near.',
    cost: 7500,
    nameFormat: { position: 'prefix', text: 'Warning' },
    applicationMode: 'when-equipped',
    changes: [{ key: 'system.cannotBeSurprised', mode: 5, value: 'true' }],
    flags: { relicPower: 'warning' }
  }
];

/**
 * Metal type display names for relic naming
 */
export const METAL_DISPLAY_NAMES = {
  magical: 'Magical',
  adamant: 'Adamant',
  coldIron: 'Cold Iron',
  silver: 'Silver',
  mythral: 'Mythral',
  orichalcum: 'Orichalcum'
};

/**
 * Get a power by ID
 */
export function getRelicPower(id) {
  return RELIC_POWERS.find(p => p.id === id);
}

/**
 * Get all powers in a category
 */
export function getPowersByCategory(category) {
  if (category === 'all') return RELIC_POWERS;
  return RELIC_POWERS.filter(p => p.category === category);
}
