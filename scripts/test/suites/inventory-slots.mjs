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
 *   - a stack costs `baseSlots × quantity` (the system does this natively on
 *     5.38+; Crawler adds it on legacy systems — never both)
 *   - the "Weightless" flag forgoes the stack multiplier
 */

import { suite, case_, expect } from "../harness.mjs";
import {
  MODULE_ID,
  getExtraOccupiedSlots,
  getTotalOccupiedSlots,
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

/** True when the system charges `baseSlots × quantity` itself (vagabond 5.38+). */
const nativeStacking = () =>
  typeof globalThis.vagabond?.utils?.EquipmentHelper?.itemStackCost === "function";

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

      // Native: system charges 3, Crawler adds 0. Legacy: system 1, Crawler +2.
      // The double-count regression was native 3 + Crawler 2 = 5.
      expect(actor.system.inventory.occupiedSlots).toBe(nativeStacking() ? 3 : 1);
      expect(getExtraOccupiedSlots(actor)).toBe(nativeStacking() ? 0 : 2);
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

      // Flagged items cost baseSlots once — they only opt out of the quantity
      // multiplier. On native systems Crawler subtracts the system's multiplier.
      expect(getExtraOccupiedSlots(actor)).toBe(nativeStacking() ? -3 : 0);
      expect(headerTotal(actor)).toBe(1);
    });

    case_("Weightless zero-slot stack stays out of the 10-per-slot pool", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest Pebbles", baseSlots: 0, quantity: 100, weightless: true });
      await addGear(actor, { name: "VCTest Rations", baseSlots: 0, quantity: 10 });

      // Rations still pool RAW on native systems (10 → 1 slot); Pebbles add nothing.
      expect(headerTotal(actor)).toBe(nativeStacking() ? 1 : 0);
    });

    case_("Materials cost 1 Slot per 1g or part of one (VCE conversion)", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // VCE's alchemy converts Materials to exactly this: baseSlots 0, qty = silver, Weightless.
      const mat = await addGear(actor, { name: "VCTest Materials (1g 50s) (Consumable)", baseSlots: 0, quantity: 150, weightless: true });
      await mat.update({ "system.isConsumable": true });
      expect(headerTotal(actor)).toBe(2);

      await mat.update({ "system.quantity": 100 });
      expect(headerTotal(actor)).toBe(1);
      await mat.update({ "system.quantity": 5 });
      expect(headerTotal(actor)).toBe(1);

      await actor.sheet.render(true);
      ctx.cleanup(async () => { try { await actor.sheet.close(); } catch {} });
      await ctx.fx.settle(800);
      const emptyNums = [...actor.sheet.element.querySelectorAll(".empty-slot .slot-number")]
        .map(n => parseInt(n.textContent.trim(), 10)).filter(Number.isFinite);
      expect(emptyNums[0]).toBe(headerTotal(actor) + 1);
    });

    case_("realistic loadout of quantity-1 items matches system occupiedSlots with 100% parity", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // Mixed realistic loadout: weapons, armor, containers, stowed items, and zero-slot trinkets
      await addGear(actor, { name: "VCTest Longsword", baseSlots: 1, quantity: 1 });
      await addGear(actor, { name: "VCTest Chainmail", baseSlots: 2, quantity: 1 });
      await addGear(actor, { name: "VCTest Shield", baseSlots: 1, quantity: 1 });
      await addGear(actor, { name: "VCTest Backpack", baseSlots: 0, quantity: 1, gearCategory: "Outdoors" });
      await addGear(actor, { name: "VCTest Stowed Torch", baseSlots: 1, quantity: 1, containerId: "vctest-backpack" });
      await addGear(actor, { name: "VCTest Holy Symbol", baseSlots: 0, quantity: 1, gearCategory: "Books & Magic" });

      // When all quantities are 1, Crawler must add 0 extra slots and match system occupiedSlots exactly.
      expect(getExtraOccupiedSlots(actor)).toBe(0);
      expect(getTotalOccupiedSlots(actor)).toBe(actor.system.inventory.occupiedSlots);
      expect(headerTotal(actor)).toBe(4); // Longsword(1) + Chainmail(2) + Shield(1) = 4
    });

    case_("quantity 0 matches the system's charge", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // Emptying a stack without deleting the item is ordinary play (ammo,
      // consumables). Legacy systems charge baseSlots regardless of quantity;
      // native systems charge 0. Crawler must add nothing either way.
      await addGear(actor, { name: "VCTest Emptied Quiver", baseSlots: 1, quantity: 0 });

      const expected = nativeStacking() ? 0 : 1;
      expect(actor.system.inventory.occupiedSlots).toBe(expected);
      expect(getExtraOccupiedSlots(actor)).toBe(0);
      expect(headerTotal(actor)).toBe(expected);
    });

    case_("negative baseSlots contributes nothing rather than subtracting", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      // The schema puts no `min` on baseSlots. The system only adds it when > 0,
      // so a negative value must contribute 0 on our side too — never a credit
      // that masks other items' weight.
      await addGear(actor, { name: "VCTest Impossible", baseSlots: -3, quantity: 2 });
      await addGear(actor, { name: "VCTest Real Torch", baseSlots: 1, quantity: 2 });

      expect(getExtraOccupiedSlots(actor)).toBe(nativeStacking() ? 0 : 1);  // legacy: torch's second unit
      expect(headerTotal(actor)).toBe(2);
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
      // A stack is required: on legacy systems the header patch early-returns
      // when extras are 0, so without one the renumber isn't exercised.
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

    case_("header and grid agree for a quantity-0 item", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest Emptied Pouch", baseSlots: 1, quantity: 0 });
      const total = headerTotal(actor);

      await actor.sheet.render(true);
      ctx.cleanup(async () => { try { await actor.sheet.close(); } catch {} });
      await ctx.fx.settle(800);

      const el = actor.sheet.element;
      const emptyNums = [...el.querySelectorAll(".empty-slot .slot-number")]
        .map(n => parseInt(n.textContent.trim(), 10)).filter(Number.isFinite);
      expect(emptyNums.length).toBeGreaterThan(0);
      // The regression: grid used to start at 1 while the header said 1 occupied.
      expect(emptyNums[0]).toBe(total + 1);
    });

    case_("a stack's card width follows the system generation", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest WideStack", baseSlots: 1, quantity: 3 });

      await actor.sheet.render(true);
      ctx.cleanup(async () => { try { await actor.sheet.close(); } catch {} });
      await ctx.fx.settle(800);

      const el = actor.sheet.element;
      const card = [...el.querySelectorAll(".inventory-card")]
        .find(c => actor.items.get(c.dataset.itemId)?.name === "VCTest WideStack");
      expect(card).toBeTruthy();

      // totalSlots drives `grid-column: span N` in inventory-card.hbs. Legacy:
      // Crawler widens the stack to 3. Native: the system keeps per-unit width.
      expect(card.style.gridColumn).toContain(nativeStacking() ? "1" : "3");
    });

    case_("Weightless stack spans single slot in rendered grid", async (ctx) => {
      const { actor } = await ctx.fx.createTestPC(ctx);
      await addGear(actor, { name: "VCTest Weightless Feathers", baseSlots: 1, quantity: 4, weightless: true });

      await actor.sheet.render(true);
      ctx.cleanup(async () => { try { await actor.sheet.close(); } catch {} });
      await ctx.fx.settle(800);

      const el = actor.sheet.element;
      const card = [...el.querySelectorAll(".inventory-card")]
        .find(c => actor.items.get(c.dataset.itemId)?.name === "VCTest Weightless Feathers");
      expect(card).toBeTruthy();

      // Weightless items opt out of the quantity multiplier, so totalSlots is 1 instead of 4
      expect(card.style.gridColumn).toContain("1");
    });

  });
}
