/**
 * Vagabond Crawler — Loot Tables
 *
 * Default loot generation tables organized by Threat Level (TL).
 * Each tier defines currency dice formulas and item pools.
 * NPCs can override with a custom RollTable UUID.
 */

/* -------------------------------------------- */
/*  Currency Formulas by Threat Level           */
/* -------------------------------------------- */

/**
 * Default currency rewards per TL tier.
 * Each entry: { gold: formula|null, silver: formula|null, copper: formula|null }
 */
export const CURRENCY_BY_TL = {
  // TL 0-2: Minor rewards
  0: { gold: null,   silver: "1d6",  copper: "2d6" },
  1: { gold: null,   silver: "1d6",  copper: "2d6" },
  2: { gold: null,   silver: "2d6",  copper: "3d6" },
  // TL 3-4: Moderate rewards
  3: { gold: "1d4",  silver: "2d6",  copper: null },
  4: { gold: "1d6",  silver: "3d6",  copper: null },
  // TL 5-7: Notable rewards
  5: { gold: "2d6",  silver: "3d6",  copper: null },
  6: { gold: "2d6",  silver: "4d6",  copper: null },
  7: { gold: "3d6",  silver: "4d6",  copper: null },
  // TL 8-10: Major rewards
  8:  { gold: "4d6",  silver: "5d6",  copper: null },
  9:  { gold: "5d6",  silver: "5d6",  copper: null },
  10: { gold: "6d6",  silver: "6d6",  copper: null },
};

/**
 * Get currency formula for a given TL. Clamps to 0-10 range.
 */
export function getCurrencyForTL(tl) {
  const clamped = Math.max(0, Math.min(10, tl));
  return CURRENCY_BY_TL[clamped] || CURRENCY_BY_TL[0];
}

/* -------------------------------------------- */
/*  Loot Generation                             */
/* -------------------------------------------- */

/**
 * Generate loot for a defeated NPC.
 * @param {Actor} npc — The defeated NPC actor
 * @param {string|null} customTableUuid — Optional RollTable UUID override
 * @returns {Promise<{currency: {gold:number, silver:number, copper:number}, items: Object[]}>}
 */
export async function generateLoot(npc, customTableUuid = null) {
  const tl = npc.system.threatLevel ?? npc.system.cr ?? 1;

  // Roll currency
  const currencyFormulas = getCurrencyForTL(tl);
  const currency = { gold: 0, silver: 0, copper: 0 };
  for (const [type, formula] of Object.entries(currencyFormulas)) {
    if (!formula) continue;
    const roll = new Roll(formula);
    await roll.evaluate();
    currency[type] = roll.total;
  }

  // Roll items from custom table or skip
  const items = [];
  if (customTableUuid) {
    const table = await fromUuid(customTableUuid);
    if (table) {
      const draw = await table.draw({ displayChat: false, resetTable: false });
      for (const result of draw.results) {
        // Try to resolve the result to an item
        if (result.documentCollection && result.documentId) {
          const uuid = `${result.documentCollection}.${result.documentId}`;
          const doc = await fromUuid(uuid);
          if (doc) {
            items.push(doc.toObject());
          }
        } else if (result.text) {
          // Text result — try to parse as currency
          const parsed = _parseCurrencyText(result.text);
          if (parsed) {
            currency.gold += parsed.gold || 0;
            currency.silver += parsed.silver || 0;
            currency.copper += parsed.copper || 0;
          }
        }
      }
    }
  }

  return { currency, items };
}

/**
 * Parse currency from a text result (e.g. "2d6 gold, 3d6 silver").
 */
function _parseCurrencyText(text) {
  if (!text) return null;
  const result = { gold: 0, silver: 0, copper: 0 };
  let found = false;

  for (const type of ["gold", "silver", "copper"]) {
    const re = new RegExp(`(\\d+(?:d\\d+)?(?:\\s*[+\\-]\\s*\\d+)?)\\s*${type}`, "i");
    const match = text.match(re);
    if (match) {
      found = true;
      // If it's a dice formula, evaluate it
      const formula = match[1].trim();
      if (/d/i.test(formula)) {
        const roll = new Roll(formula);
        roll.evaluate({ async: false });
        result[type] = roll.total;
      } else {
        result[type] = parseInt(formula) || 0;
      }
    }
  }

  return found ? result : null;
}
