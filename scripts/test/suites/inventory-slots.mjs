/**
 * Inventory slots — smoke tests
 *
 * Guards the one invariant that keeps the character sheet self-consistent:
 *
 *     Σ itemCapacity  ===  system.occupiedSlots + getExtraOccupiedSlots(actor)
 *
 * The left side drives the inventory grid (cell numbering + `grid-column: span`
 * via the `prepareInventoryGrid` wrap). The right side drives the header's
 * "X / Y" counter. They are computed by different code in different files, so
 * they can drift silently — which is exactly what happened: the header read
 * "14 / 17" above a grid whose next free cell was labelled 11.
 *
 * Rather than re-implementing the math (which would drift in lockstep and prove
 * nothing), the drift guard renders a REAL sheet and asserts on what the DOM
 * says: the first empty cell must be numbered `headerTotal + 1`.
 *
 * Also pins the counting rules Crawler shares with the system:
 *   - zero-slot items are free (the Backpack bug)
 *   - items stowed in a container are excluded
 *   - a stack costs `baseSlots × quantity` (Crawler's only deviation)
 *   - the "Weightless" flag forgoes the stack multiplier
 */

import { suite, case_, expect } from "../harness.mjs";
import {
  MODULE_ID,
  getExtraOccupiedSlots,
  isOverloaded,
} from "../../vagabond-crawler.mjs";

/**
 * Create an inventory item directly. `skipStack: true` bypasses the auto-stack
 * preCreateItem hook so quantities land exactly as specified.
 */
async function addGear(actor, {
  name,
  type = "equipment",
  baseSlots = 0,
  quantity = 1,
  gearCategory = "",
  containerId = null,
  weightless = false,
} = {}) {
  const data = {
    name,
    type,
    system: { baseSlots, quantity, gearCategory, containerId },
  };
  if (weightless) foundry.utils.setProperty(data, `flags.${MODULE_ID}.trueZeroSlot`, true);
  const [item] = await actor.createEmbeddedDocuments("Item", [data], { skipStack: true });
  return item;
}

/** The number the sheet header renders, per the production helper. */
function headerTotal(actor) {
  return (actor.system.inventory?.occupiedSlots ?? 0) + getExtraOccupiedSlots(actor);
}

export function register() {
  suite("Inventory Slots", () => {

    // ── Counting rules ──────────────────────────────────────────────────────

    case_("zero-slot item costs nothing (Backpack regression)", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // A Backpack in the core compendium is exactly this: baseSlots 0, categorized.
      await addGear(actor, { name: "VCTest Backpack", baseSlots: 0, quantity: 1, gearCategory: "Outdoors" });

      // The system charges 0 for zero-slot items; Crawler must add nothing on top.
      expect(getExtraOccupiedSlots(actor)).toBe(0);
      expect(actor.system.inventory.occupiedSlots).toBe(0);
    });

    case_("several distinct zero-slot categories still cost nothing", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // The old pooling charged ceil(n/10) PER category → 4 phantom slots here.
      await addGear(actor, { name: "VCTest Coin",   baseSlots: 0, gearCategory: "" });
      await addGear(actor, { name: "VCTest Quill",  baseSlots: 0, gearCategory: "Books & Magic" });
      await addGear(actor, { name: "VCTest Ring",   baseSlots: 0, gearCategory: "Gems, Jewelry, & Smithing" });
      await addGear(actor, { name: "VCTest Ration", baseSlots: 0, quantity: 5, gearCategory: "Cooking & Food" });

      expect(getExtraOccupiedSlots(actor)).toBe(0);
    });

    case_("a stack costs baseSlots x quantity", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest Torch", baseSlots: 1, quantity: 3 });

      // System counts the item once (1); Crawler adds 1 x (3 - 1) = 2 → total 3.
      expect(actor.system.inventory.occupiedSlots).toBe(1);
      expect(getExtraOccupiedSlots(actor)).toBe(2);
      expect(headerTotal(actor)).toBe(3);
    });

    case_("items stowed inside a container are excluded", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, {
        name: "VCTest Stowed Rope", baseSlots: 2, quantity: 4, containerId: "vctest-pack",
      });

      // The system skips anything with a containerId; Crawler must too, or every
      // packed item gets double-charged.
      expect(getExtraOccupiedSlots(actor)).toBe(0);
      expect(headerTotal(actor)).toBe(0);
    });

    case_("Weightless flag forgoes the stack multiplier", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest Feather", baseSlots: 1, quantity: 4, weightless: true });

      // Flagged items still cost the system's baseSlots once — they only opt out
      // of Crawler's quantity multiplier. Keeping this exact is what makes
      // _itemCapacity() and getExtraOccupiedSlots() agree.
      expect(getExtraOccupiedSlots(actor)).toBe(0);
      expect(headerTotal(actor)).toBe(1);
    });

    case_("overload flips once a stack exceeds capacity", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      const max = actor.system.inventory.maxSlots;
      expect(max).toBeGreaterThan(0);

      await addGear(actor, { name: "VCTest Anvil", baseSlots: 1, quantity: max + 2 });

      expect(headerTotal(actor)).toBeGreaterThan(max);
      expect(isOverloaded(actor)).toBe(true);
    });

    // ── The drift guard ─────────────────────────────────────────────────────

    case_("sheet header and grid free-cell numbering agree", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // A stack is required: the header patch early-returns when extras are 0,
      // so without one neither the header nor the grid renumber is exercised.
      await addGear(actor, { name: "VCTest Soap",     baseSlots: 1, quantity: 2 });
      await addGear(actor, { name: "VCTest Bedroll",  baseSlots: 1, quantity: 1 });
      await addGear(actor, { name: "VCTest Trinket",  baseSlots: 0, quantity: 1, gearCategory: "Outdoors" });

      const total = headerTotal(actor);
      const max = actor.system.inventory.maxSlots;
      // Need room left over, otherwise there are no empty cells to assert on.
      expect(total).toBeLessThan(max);

      await actor.sheet.render(true);
      ctx.cleanup(async () => { try { await actor.sheet.close(); } catch {} });
      await ctx.fx.settle(800);

      const el = actor.sheet.element;
      expect(el).toBeTruthy();

      // Header: what the player reads at the top of the Inventory panel.
      const slotText = el.querySelector(".slot-value")?.textContent?.trim() ?? "";
      const m = slotText.match(/(\d+)\s*\/\s*(\d+)/);
      expect(m).not.toBeNull();
      const renderedUsed = parseInt(m[1], 10);
      expect(renderedUsed).toBe(total);

      // Grid: the first numbered empty cell must continue from the header.
      const emptyNums = [...el.querySelectorAll(".empty-slot .slot-number")]
        .map(n => parseInt(n.textContent.trim(), 10))
        .filter(Number.isFinite);
      expect(emptyNums.length).toBeGreaterThan(0);
      expect(emptyNums[0]).toBe(renderedUsed + 1);

      // ...and the grid must run out exactly at capacity, not before or after.
      expect(emptyNums[emptyNums.length - 1]).toBe(actor.system.inventory.baseMaxSlots);
    });

    case_("a stack spans its true footprint in the grid", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest WideStack", baseSlots: 1, quantity: 3 });

      await actor.sheet.render(true);
      ctx.cleanup(async () => { try { await actor.sheet.close(); } catch {} });
      await ctx.fx.settle(800);

      const el = actor.sheet.element;
      const card = [...el.querySelectorAll(".inventory-card")]
        .find(c => actor.items.get(c.dataset.itemId)?.name === "VCTest WideStack");
      expect(card).toBeTruthy();

      // totalSlots drives `grid-column: span N` in inventory-card.hbs. A 1-slot
      // item at qty 3 occupies 3 cells, so it must not claim just one.
      expect(card.style.gridColumn).toContain("3");
    });

  });
}
