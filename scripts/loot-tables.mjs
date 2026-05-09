/**
 * Vagabond Crawler — Loot Tables
 *
 * Loot generation from assigned RollTables, with a fallback
 * to default TL-based currency if no table is configured.
 */

/* -------------------------------------------- */
/*  Fallback Currency Formulas by Threat Level  */
/* -------------------------------------------- */

/**
 * Default currency rewards per TL tier (used only when no loot table is assigned).
 */
export const CURRENCY_BY_TL = {
  0: { gold: null,   silver: "1d6",  copper: "2d6" },
  1: { gold: null,   silver: "1d6",  copper: "2d6" },
  2: { gold: null,   silver: "2d6",  copper: "3d6" },
  3: { gold: "1d4",  silver: "2d6",  copper: null },
  4: { gold: "1d6",  silver: "3d6",  copper: null },
  5: { gold: "2d6",  silver: "3d6",  copper: null },
  6: { gold: "2d6",  silver: "4d6",  copper: null },
  7: { gold: "3d6",  silver: "4d6",  copper: null },
  8: { gold: "4d6",  silver: "5d6",  copper: null },
  9: { gold: "5d6",  silver: "5d6",  copper: null },
  10: { gold: "6d6",  silver: "6d6",  copper: null },
};

export function getCurrencyForTL(tl) {
  const clamped = Math.max(0, Math.min(10, tl));
  return CURRENCY_BY_TL[clamped] || CURRENCY_BY_TL[0];
}

/* -------------------------------------------- */
/*  Loot Generation                             */
/* -------------------------------------------- */

/**
 * Generate loot for a defeated NPC.
 * If a custom table is assigned, ALL loot comes from the table.
 * If no table, fall back to TL-based currency.
 * @param {Actor} npc — The defeated NPC actor
 * @param {string|null} customTableUuid — Optional RollTable UUID override
 * @returns {Promise<{currency: {gold:number, silver:number, copper:number}, items: Object[]}>}
 */
export async function generateLoot(npc, customTableUuid = null) {
  const currency = { gold: 0, silver: 0, copper: 0 };
  const items = [];
  let trace = [];

  if (customTableUuid?.startsWith("loot-level:")) {
    // Built-in Level Loot — delegate to Loot Generator engine
    const level = parseInt(customTableUuid.split(":")[1]);
    if (level >= 1 && level <= 10) {
      const { generateLevelLoot } = await import("./loot-generator.mjs");
      const result = await generateLevelLoot(level);
      if (result) {
        if (result.currency) {
          currency.gold += result.currency.gold ?? 0;
          currency.silver += result.currency.silver ?? 0;
          currency.copper += result.currency.copper ?? 0;
        }
        if (result.items?.length) items.push(...result.items);
        if (result.trace?.length) trace = result.trace;
      }
    }
  } else if (customTableUuid) {
    // Loot comes entirely from the assigned table
    const table = await fromUuid(customTableUuid);
    if (table) {
      const draw = await table.draw({ displayChat: false, resetTable: false });
      for (const result of draw.results) {
        await _processTableResult(result, currency, items);
      }
    }
  } else {
    // No table assigned — use TL-based currency fallback
    const tl = npc.system.threatLevel ?? npc.system.cr ?? 1;
    const formulas = getCurrencyForTL(tl);
    for (const [type, formula] of Object.entries(formulas)) {
      if (!formula) continue;
      const roll = await new Roll(formula).evaluate();
      currency[type] = roll.total;
    }
  }

  return { currency, items, trace };
}

/* -------------------------------------------- */
/*  Table Result Processing                     */
/* -------------------------------------------- */

/**
 * Process a single table result — handles document links, sub-tables,
 * currency text, and quantity formulas in descriptions.
 */
async function _processTableResult(result, currency, items) {
  // 1. Document result with a valid UUID (item or sub-table)
  if (result.documentUuid) {
    const doc = await fromUuid(result.documentUuid);
    if (!doc) return;

    // Sub-table: recursively draw and process
    if (doc instanceof RollTable) {
      const subDraw = await doc.draw({ displayChat: false, resetTable: false });
      for (const subResult of subDraw.results) {
        await _processTableResult(subResult, currency, items);
      }
      return;
    }

    // Item: determine quantity from description formula
    const qty = await _parseQuantity(result.description);
    const itemData = doc.toObject();
    if (qty > 1 && itemData.system) {
      itemData.system.quantity = qty;
    }
    items.push(itemData);
    return;
  }

  // 2. Text result — check description first, then name
  const descText = result.description ?? "";
  const nameText = result.text ?? result.name ?? "";

  // Try to parse currency from description (e.g. "<p>[[1d100]] Silver</p>")
  const descCurrency = await _parseCurrencyFromDescription(descText);
  if (descCurrency) {
    currency.gold += descCurrency.gold;
    currency.silver += descCurrency.silver;
    currency.copper += descCurrency.copper;
    return;
  }

  // Try to parse currency from name (e.g. "2d6 gold")
  const nameCurrency = await _parseCurrencyText(nameText);
  if (nameCurrency) {
    currency.gold += nameCurrency.gold;
    currency.silver += nameCurrency.silver;
    currency.copper += nameCurrency.copper;
    return;
  }
}

/**
 * Parse a quantity formula from a description string.
 * Matches [[d4]], [[2d6]], [[/r d4]], etc. Returns 1 if none found.
 */
async function _parseQuantity(desc) {
  if (!desc) return 1;
  const match = desc.match(/\[\[(?:\/r\s+)?([^\]]+)\]\]/);
  if (!match) return 1;
  try {
    const roll = await new Roll(match[1].trim()).evaluate();
    return Math.max(1, roll.total);
  } catch { return 1; }
}

/**
 * Parse currency from a description containing [[formula]] currency-type.
 * e.g. "<p>[[1d100]] silver</p>", "<p>[[d10]] gold</p>"
 */
async function _parseCurrencyFromDescription(desc) {
  if (!desc) return null;
  const result = { gold: 0, silver: 0, copper: 0 };
  let found = false;

  for (const type of ["gold", "silver", "copper"]) {
    const re = new RegExp(`\\[\\[(?:\\/r\\s+)?([^\\]]+)\\]\\]\\s*${type}`, "i");
    const match = desc.match(re);
    if (match) {
      found = true;
      try {
        const roll = await new Roll(match[1].trim()).evaluate();
        result[type] = roll.total;
      } catch { /* skip */ }
    }
  }

  return found ? result : null;
}

/**
 * Parse currency from plain text (e.g. "2d6 gold", "10 silver").
 * Handles both dice formulas and flat numbers.
 */
async function _parseCurrencyText(text) {
  if (!text) return null;
  const result = { gold: 0, silver: 0, copper: 0 };
  let found = false;

  for (const type of ["gold", "silver", "copper"]) {
    const re = new RegExp(`(\\d+(?:d\\d+)?(?:\\s*[+\\-]\\s*\\d+)?)\\s*${type}`, "i");
    const match = text.match(re);
    if (match) {
      found = true;
      const formula = match[1].trim();
      if (/d/i.test(formula)) {
        try {
          const roll = await new Roll(formula).evaluate();
          result[type] = roll.total;
        } catch { /* skip */ }
      } else {
        result[type] = parseInt(formula) || 0;
      }
    }
  }

  return found ? result : null;
}
