# Inventory Stack Split — Design Spec

**Date:** 2026-04-22
**Status:** Design (awaiting implementation plan)
**Module:** `vagabond-crawler`

## Problem

Items in the Vagabond actor sheet inventory are automatically merged into stacks by the existing auto-stack hook in `vagabond-crawler.mjs` ([`preCreateItem`, lines 293–318](../../../scripts/vagabond-crawler.mjs)). Once stacked, there is no way to peel items back off a stack. This blocks common table moments:

- Giving *some* of a stacked item (rations, arrows, potions) to another party member.
- Dropping *some* of a stack on the ground via a canvas drop.
- Separating a portion for a specific encounter use (e.g. set aside 2 rations for a breather).

A companion gap: there is no deliberate way to *re-merge* two stacks that got orphaned (e.g. from prior splits, from picked-up drops that used `skipStack: true`, or from legacy data).

## Goals

1. **Split** a stack into two piles inside the same inventory, preserving all other item data (flags, enchantments, custom name, description, etc.).
2. **Merge** two same-item stacks in the same inventory back into one.
3. Use gestures that fit the Vagabond grid-based inventory UX and do not fight the system's existing drag-to-reorder handler.
4. Any actor **owner** can split/merge on sheets they own. No GM gating, no socket hops.

## Non-Goals

- Cross-actor splitting in a single gesture (dragging a partial stack directly to another character sheet). That is covered later by the existing party-inventory and drag-to-sheet flows once split pieces exist.
- Splitting items that do not have `system.quantity` (non-equipment).
- Changing the auto-stack-on-create behavior.
- A full inventory-grid rewrite — we layer on top of the system's existing `InventoryHandler`.

## Users & Context

Players and GMs running dungeon-crawl sessions at the table. Decisions happen in seconds. Both gestures must be fast enough to use mid-combat without leaving the sheet. The right-click path is for deliberate "give me exactly N" moments; the drag path is for "peel one off" reflexes.

## UX — Three Gestures

### Gesture 1: Peel one off (drag to empty slot)

- Precondition: inventory item with `system.quantity > 1`.
- User drags the card and drops it onto an `.inventory-slot.empty-slot` element.
- Result:
  - Source item's quantity decreases by 1.
  - A new item is created with `quantity = 1`, **created with `skipStack: true`** so the auto-stack hook does not immediately merge it back.
  - The new item is a deep clone of the source's full data (flags, effects, custom fields) except quantity.
  - Landing position: new item takes the first available empty slot in the grid. We do not try to land it at the exact pixel position of the drop; the grid is order-based and the system's reorder handler owns position rules. Users who want it elsewhere can drag it after.
- Dragging a `quantity = 1` card onto an empty slot falls through to the existing reorder handler unchanged.
- Dragging a stacked card between two other cards (standard reorder gesture) falls through to existing reorder behavior — split only triggers on a true empty-slot drop target.

### Gesture 2: Split N (right-click context menu)

- Precondition: inventory item with `system.quantity > 1`.
- User right-clicks the card. Alongside the existing system context menu and the module's existing entries (Use Scroll, Use Enchantment Scroll, Mark as Junk), a new entry appears:
  > `<i class="fas fa-arrows-left-right-to-line"></i> Split Stack…`
- Clicking opens the **Split Stack dialog**:
  - Title: `Split "<item name>" ×<qty>`
  - Body: a range slider (min 1, max `qty − 1`, default `Math.floor(qty / 2)`) + a number input bound to the slider, plus a read-only line: `Keep <qty − N> / Split <N>`.
  - Buttons: `Split` (primary) and `Cancel`.
- On confirm:
  - Source quantity decreases by N.
  - New item created with quantity = N, `skipStack: true`, full clone of source data.
  - New item lands in the first available empty slot (no drop position context).
- Only added to the context menu when `item.system.quantity > 1`.

### Gesture 3: Merge (drag onto same item)

- Precondition: source and target are inventory cards on the same sheet with matching `name` AND matching `type`.
- User drags source card onto target card.
- Result:
  - Target quantity += source quantity.
  - Source item is **deleted**.
  - No confirmation dialog (symmetry with auto-stack on create).
- Mismatched name/type → falls through to the existing reorder handler (no warning — the user is clearly reordering, not merging).
- If name/type match but the identity check (see next section) fails — e.g. a lit torch vs an unlit torch, a junk-marked stack vs a non-junk stack — **skip the merge** and show `ui.notifications.warn("Items differ — cannot merge.")`. The warning is only shown when the user clearly *intended* a merge (same name, same type) but the details diverge.

## Data Model — What "Same Item" Means

For auto-merge (Gesture 3) and in the `preCreateItem` auto-stack hook, two items are the "same" when ALL of these match:

- `name`
- `type`
- Core identity flags, specifically:
  - No `lit` flag on either side (lit light sources are explicitly separate).
  - Junk status matches (`getFlag(MODULE_ID, "junk")`).
  - Custom/enchantment flags match (any `vagabond-crawler:enchant*` flags, relic flags).

This identity check lives in a single helper `_sameStackIdentity(a, b)` in the new module, reused by both the existing auto-stack hook (replacing the inline `name + type + lit` check) and the new merge gesture. That unifies the rule in one place.

## Architecture

### New file: `scripts/stack-split.mjs`

Singleton following the existing module pattern:

```js
export const StackSplit = {
  _hookIds: [],
  init() { /* bind render hooks, wire context menu, wire drag/drop interception */ },
  splitOne(item) { /* Gesture 1 action */ },
  splitN(item, n) { /* Gesture 2 action, called from dialog */ },
  merge(sourceItem, targetItem) { /* Gesture 3 action */ },
  openSplitDialog(item) { /* builds + awaits the dialog */ },
  _sameStackIdentity(a, b) { /* identity helper */ },
  _cloneForSplit(item, qty) { /* produces createEmbeddedDocuments payload */ },
};
```

Registered as `game.vagabondCrawler.stackSplit` in `Hooks.once("ready")` after the existing inventory patch blocks.

### Touchpoints in existing files

- **`scripts/vagabond-crawler.mjs`**:
  1. Import `StackSplit`, call `StackSplit.init()` in the ready hook.
  2. Refactor the existing auto-stack `preCreateItem` handler to call `StackSplit._sameStackIdentity` instead of its inline `name + type + lit` check. Consolidates the "same stack" rule.
  3. No changes to existing context-menu wiring for scrolls/junk/enchantment — StackSplit adds its own menu entry using the same delayed-inject pattern.
- **`templates/`**: new file `templates/stack-split-dialog.hbs` for the dialog body.
- **`styles/vagabond-crawler.css`**: new section for `.vcb-stack-split-dialog` using existing `--vcb-*` tokens. Minimal — slider + number input + read-out row.
- **No changes to the system's `InventoryHandler`**. We intercept at the grid-level drop event using capture-phase binding on `.inventory-grid`, detect split/merge cases, and call `e.stopImmediatePropagation()` only when we act. All other drops pass through untouched.

### Drag/Drop Interception (Gestures 1 & 3)

Binding strategy:

1. On `renderVagabondCharacterSheet` / `renderVagabondNPCSheet` / `renderActorSheet`, find `.inventory-grid` and attach a **capture-phase** listener for `drop`.
2. Classify the drop:
   - Target is `.inventory-slot.empty-slot` AND source card has `data-item-id` AND source item qty > 1 → **Gesture 1**. Call `splitOne`. `stopImmediatePropagation`.
   - Target is `.inventory-card` with a different `data-item-id` AND `_sameStackIdentity(source, target)` → **Gesture 3**. Call `merge`. `stopImmediatePropagation`.
   - Otherwise: do nothing. System's reorder handler runs normally.
3. Source item id is read from the `dragstart` payload. We cache it on our own `_pendingDrag` state set in a capture-phase `dragstart` listener so we do not have to re-parse `dataTransfer` (which the system may have claimed).

Capture phase is critical because the system's handler on the same `.inventory-grid` uses `stopPropagation()` on some drops. Capture runs first regardless.

### Permissions & Sync

- Owner check: `if (!item.actor.isOwner) return;` at the top of every split/merge action.
- No socket traffic. Players own their own actors; GM owns all. All mutations go through `actor.updateEmbeddedDocuments` / `actor.createEmbeddedDocuments` / `item.delete`, which Foundry syncs to other clients automatically.
- The `skipStack: true` creation option is passed in the third arg to `createEmbeddedDocuments`; the existing auto-stack hook already honors it.

## Error Handling

- qty ≤ 1 when Gesture 1 fires: no-op, pass through to reorder.
- qty ≤ 1 when Gesture 2 opens the dialog: menu entry not added.
- Split N out of range (should not happen with slider bounds but defensive): clamp to `[1, qty − 1]`.
- Merge on non-matching identity: no-op with `ui.notifications.warn`.
- Merge where target is the same item id (self-drop): no-op, pass through to reorder.
- Non-owner trying to act (shouldn't reach UI, but defensive): return silently.

## Testing

Manual test matrix run in Foundry via `mcp__foundry-vtt__evaluate`:

1. Stack of 3 rations → drag to empty slot → source becomes 2, new item created at qty 1. Repeat → source becomes 1 (no stack).
2. Stack of 10 arrows → right-click → Split Stack dialog → set 4 → source becomes 6, new item at qty 4.
3. Two separate stacks of arrows (qty 4 and qty 3) → drag one onto the other → one stack of qty 7, other deleted.
4. Lit torch + unlit torch stack → drag unlit onto lit → warn notification, no merge.
5. Two stacks of the same item where one is marked junk, the other is not → drag → warn, no merge.
6. Stack of 1 dragged to empty slot → reorder (unchanged behavior), no split.
7. Stack of 5 dragged between two other cards → reorder (unchanged behavior), no split.
8. Player on own sheet: all three gestures work. Player on another player's sheet: no gestures work (not owner).
9. GM on any sheet: all three gestures work.
10. Split a stacked custom-enchanted weapon → new piece preserves all enchant flags and effects.

## Open Questions

None at time of writing. All design decisions resolved during brainstorming.

## Out of Scope — Possible Follow-ups

- Quantity indicator on the drag cursor (ghost showing `×1` during Gesture 1).
- Scroll-wheel-during-drag to adjust split quantity (alternative to right-click dialog).
- Cross-actor partial-stack drag (drag split straight to another sheet in one gesture).
- Canvas partial-stack drop (drag split directly to canvas to create a ground loot pile of N).
