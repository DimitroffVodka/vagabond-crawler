/**
 * Vagabond Crawler — Inventory Stack Split / Merge
 *
 * Three gestures on the actor inventory grid:
 *
 *   1. Left-click drag a stacked item (qty > 1) onto an empty slot → peels 1 off
 *   2. Right-click a stacked item → "Split Stack…" context entry opens a dialog
 *      with a quantity input (1 .. qty-1)
 *   3. Left-click drag one card onto another of the SAME identity → merges stacks
 *
 * Intercepts the grid's drop event in capture phase so it runs before the
 * vagabond system's reorder handler. When we act, we stopImmediatePropagation
 * so the reorder doesn't also fire.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

export const StackSplit = {
  _dragSrcItemId: null,
  _dragSrcActorId: null,

  init() {
    const wire = this._wire.bind(this);
    Hooks.on("renderVagabondCharacterSheet", wire);
    Hooks.on("renderVagabondNPCSheet",       wire);
    Hooks.on("renderActorSheet",             wire);
  },

  /**
   * True when two items should be treated as the "same stack" — used by both
   * the auto-stack hook (on create) and the merge gesture (on drag onto).
   */
  sameStackIdentity(a, b) {
    if (!a || !b) return false;
    if (a.name !== b.name) return false;
    if (a.type !== b.type) return false;
    // Lit light sources must stay separate (matches existing auto-stack guard)
    const aLit = !!(a.flags?.[MODULE_ID]?.lit ?? a.getFlag?.(MODULE_ID, "lit"));
    const bLit = !!(b.flags?.[MODULE_ID]?.lit ?? b.getFlag?.(MODULE_ID, "lit"));
    if (aLit || bLit) return false;
    // Junk marking must match
    const aJunk = !!a.getFlag?.(MODULE_ID, "junk");
    const bJunk = !!b.getFlag?.(MODULE_ID, "junk");
    if (aJunk !== bJunk) return false;
    return true;
  },

  _wire(sheet) {
    const el = sheet.element;
    const actor = sheet.actor;
    if (!el || !actor) return;
    if (!actor.isOwner) return;

    // Bind drop/dragstart capture listeners once per grid (per render).
    // Foundry re-renders replace the DOM, so a dataset flag per-element is safe.
    const grid = el.querySelector(".inventory-grid");
    if (grid && !grid.dataset.vcSplitBound) {
      grid.dataset.vcSplitBound = "1";

      grid.addEventListener("dragstart", (e) => {
        const card = e.target?.closest?.(".inventory-card");
        if (!card) return;
        this._dragSrcItemId  = card.dataset.itemId || null;
        this._dragSrcActorId = actor.id;
      }, true);

      grid.addEventListener("drop", async (e) => {
        const srcId       = this._dragSrcItemId;
        const srcActorId  = this._dragSrcActorId;
        // Consume state regardless; every drop is terminal for the drag
        this._dragSrcItemId  = null;
        this._dragSrcActorId = null;
        if (!srcId || srcActorId !== actor.id) return;

        const srcItem = actor.items.get(srcId);
        if (!srcItem) return;

        const targetEmpty = e.target?.closest?.(".inventory-slot.empty-slot");
        const targetCard  = e.target?.closest?.(".inventory-card");

        // ── Gesture 1: peel one off to empty slot ───────────────────────────
        if (targetEmpty && (srcItem.system?.quantity ?? 1) > 1) {
          e.preventDefault();
          e.stopImmediatePropagation();
          await this.splitN(srcItem, 1);
          return;
        }

        // ── Gesture 3: merge onto same-identity card ────────────────────────
        if (targetCard && targetCard.dataset.itemId && targetCard.dataset.itemId !== srcId) {
          const targetItem = actor.items.get(targetCard.dataset.itemId);
          if (!targetItem) return;

          if (this.sameStackIdentity(srcItem, targetItem)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            await this.merge(srcItem, targetItem);
            return;
          }

          // Same name+type but identity mismatch (lit vs unlit, junk vs not):
          // user clearly intended a merge — warn so they know why it didn't merge
          if (srcItem.name === targetItem.name && srcItem.type === targetItem.type) {
            e.preventDefault();
            e.stopImmediatePropagation();
            ui.notifications.warn(`Can't merge "${srcItem.name}" — items differ (e.g. lit, junk-marked, or flagged differently).`);
            return;
          }
        }

        // Otherwise: let the system's reorder handler run
      }, true);
    }

    // ── Right-click "Split Stack…" context menu entry ─────────────────────
    for (const card of el.querySelectorAll(".inventory-card")) {
      if (card.dataset.vcSplitCtxBound) continue;
      const item = actor.items.get(card.dataset.itemId);
      if (!item) continue;
      if ((item.system?.quantity ?? 1) <= 1) continue;
      card.dataset.vcSplitCtxBound = "1";

      card.addEventListener("contextmenu", () => {
        let attempts = 0;
        const poll = setInterval(() => {
          const menu = document.querySelector(".inventory-context-menu");
          if (menu) {
            clearInterval(poll);
            if (menu.querySelector(".vc-split-ctx-item")) return;
            // Match the system's entry structure so we inherit layout/kerning:
            //   <div class="context-menu-item"> <i ...></i> <span>Label</span> </div>
            const entry = document.createElement("div");
            entry.className = "context-menu-item vc-split-ctx-item";
            entry.innerHTML = `<i class="fas fa-scissors"></i><span>Split Stack…</span>`;
            entry.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              menu.remove();
              await this.openSplitDialog(item);
            });
            menu.insertBefore(entry, menu.firstChild);
          } else if (++attempts >= 10) {
            clearInterval(poll);
          }
        }, 10);
      });
    }
  },

  // ── Actions ──────────────────────────────────────────────────────────────

  async splitN(item, n) {
    const qty = item.system?.quantity ?? 1;
    const amount = Math.max(1, Math.min(n | 0, qty - 1));
    if (amount <= 0 || amount >= qty) return;

    const actor = item.parent;
    if (!actor?.isOwner) return;

    // Clone full item data for the split piece — preserves flags, effects, etc.
    const data = item.toObject();
    delete data._id;
    data.system = foundry.utils.mergeObject(data.system ?? {}, { quantity: amount });
    delete data.system.gridPosition;  // let system assign next available slot

    await item.update({ "system.quantity": qty - amount });
    await actor.createEmbeddedDocuments("Item", [data], { skipStack: true });
  },

  async merge(sourceItem, targetItem) {
    const actor = sourceItem.parent;
    if (!actor?.isOwner) return;
    const srcQty = sourceItem.system?.quantity ?? 1;
    const tgtQty = targetItem.system?.quantity ?? 1;
    await targetItem.update({ "system.quantity": tgtQty + srcQty });
    await sourceItem.delete();
  },

  async openSplitDialog(item) {
    const qty = item.system?.quantity ?? 1;
    if (qty <= 1) return;
    const max = qty - 1;
    const def = Math.max(1, Math.floor(qty / 2));

    const content = `
      <div style="font-family:var(--vcb-font,sans-serif);padding:4px 2px;">
        <p style="margin:0 0 8px 0;">Split <strong>${foundry.utils.escapeHTML?.(item.name) ?? item.name}</strong> (×${qty})</p>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="min-width:90px;">Split off:</span>
          <input type="number" name="amount" min="1" max="${max}" value="${def}" step="1"
                 style="width:70px;text-align:center;" autofocus />
          <span style="color:var(--vcb-text-muted,#888);">of ${qty}</span>
        </label>
        <p style="margin:0;font-size:12px;color:var(--vcb-text-muted,#888);">
          Keep ×(${qty} − N) in original stack; ×N goes into first empty slot.
        </p>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Split Stack — ${item.name}` },
      content,
      ok: {
        label: "Split",
        icon: "fas fa-scissors",
        callback: (event, button) => {
          const raw = parseInt(button.form.elements.amount.value, 10);
          if (!Number.isFinite(raw)) return null;
          return Math.max(1, Math.min(max, raw));
        },
      },
      rejectClose: false,
    });

    if (typeof result === "number" && result > 0) {
      await this.splitN(item, result);
    }
  },
};
