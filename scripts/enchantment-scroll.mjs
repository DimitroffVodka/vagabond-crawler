/**
 * Vagabond Crawler — Enchantment Scroll
 *
 * A Relic: +N Enchantment Scroll is a one-shot consumable that applies a
 * Weapon +N / Armor +N / Trinket +N bonus to a target item in the holder's
 * inventory. It is NOT a spell scroll (ScrollForge handles those).
 *
 * An enchantment scroll is any equipment item carrying
 *   flags["vagabond-crawler"].enchantmentScroll = { bonus: 1|2|3 }
 *
 * The applied bonus mirrors the Relic Forge's `bonus-weapon-N`,
 * `bonus-armor-N`, and `bonus-trinket-N` powers — same AE key, same
 * flags — so the existing equip-gating and chat machinery light up for
 * free.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { waitDialog } from "./dialog-helpers.mjs";
import { RELIC_POWERS } from "./relic-powers.mjs";

/** Map target item slot → relic power id to apply for a given tier. */
const POWER_BY_SLOT = {
  weapon:  { 1: "bonus-weapon-1",  2: "bonus-weapon-2",  3: "bonus-weapon-3"  },
  armor:   { 1: "bonus-armor-1",   2: "bonus-armor-2",   3: "bonus-armor-3"   },
  trinket: { 1: "bonus-trinket-1", 2: "bonus-trinket-2", 3: "bonus-trinket-3" },
};

/** Gear categories that count as a "Trinket" for enchantment purposes. */
const TRINKET_CATEGORIES = new Set(["Trinkets", "Trinket"]);

export const EnchantmentScroll = {

  init() {
    console.log(`${MODULE_ID} | Enchantment Scroll initialized.`);
  },

  /** True if the given item is a +N Enchantment Scroll consumable. */
  isEnchantmentScroll(item) {
    if (!item || item.type !== "equipment") return false;
    const data = item.getFlag(MODULE_ID, "enchantmentScroll");
    return !!data?.bonus;
  },

  /** Classify a candidate target item as 'weapon' | 'armor' | 'trinket' | null. */
  _classifySlot(item) {
    if (!item || item.type !== "equipment") return null;
    const eq = item.system?.equipmentType;
    if (eq === "weapon") return "weapon";
    if (eq === "armor") return "armor";
    // Trinkets are gear with a Trinket-ish gearCategory.
    if (eq === "gear" && TRINKET_CATEGORIES.has(item.system?.gearCategory)) {
      return "trinket";
    }
    // Fallback: name-based heuristic for "Trinket" named gear with missing category.
    if (eq === "gear" && /trinket/i.test(item.name)) return "trinket";
    return null;
  },

  /** True if this target already has a bonus power forged into it. */
  _hasExistingBonus(target) {
    const forge = target.getFlag(MODULE_ID, "relicForge");
    if (!forge?.forged) return false;
    const powers = forge.powers || [];
    return powers.some(id => /^bonus-(weapon|armor|trinket)-[123]$/.test(id));
  },

  /**
   * Entry point. Called from the inventory context menu. Prompts the user to
   * choose a target item, applies the bonus as an Active Effect, marks the
   * target as forged, decrements the scroll quantity, and posts to chat.
   */
  async useScroll(scrollItem) {
    if (!this.isEnchantmentScroll(scrollItem)) {
      ui.notifications.warn("That item is not an enchantment scroll.");
      return;
    }
    const actor = scrollItem.parent;
    if (!actor) {
      ui.notifications.warn("Enchantment scroll is not owned by an actor.");
      return;
    }
    const { bonus } = scrollItem.getFlag(MODULE_ID, "enchantmentScroll");
    if (!bonus || bonus < 1 || bonus > 3) {
      ui.notifications.warn("Enchantment scroll has an invalid bonus tier.");
      return;
    }

    // Build candidate list: eligible items the actor owns. A candidate must
    // be a weapon, armor, or trinket that doesn't already have a +N bonus.
    const candidates = [];
    for (const item of actor.items) {
      if (item.id === scrollItem.id) continue;
      const slot = this._classifySlot(item);
      if (!slot) continue;
      if (this._hasExistingBonus(item)) continue;
      candidates.push({ item, slot });
    }
    if (candidates.length === 0) {
      ui.notifications.warn(
        `${actor.name} has no eligible weapons, armor, or trinkets to enchant.`
      );
      return;
    }

    const target = await this._pickTarget(scrollItem, bonus, candidates);
    if (!target) return;

    await this._applyBonus(scrollItem, target.item, target.slot, bonus);
  },

  /** Show a picker dialog. Returns { item, slot } or null. */
  async _pickTarget(scrollItem, bonus, candidates) {
    // Group by slot for readability
    const grouped = { weapon: [], armor: [], trinket: [] };
    for (const c of candidates) grouped[c.slot].push(c);

    const rows = [];
    const makeSection = (label, entries) => {
      if (!entries.length) return;
      rows.push(`<div class="vces-section-label">${label}</div>`);
      for (const c of entries) {
        const img = c.item.img || "icons/svg/item-bag.svg";
        rows.push(
          `<label class="vces-target-row">` +
            `<input type="radio" name="vces-target" value="${c.item.id}" data-slot="${c.slot}">` +
            `<img src="${img}" width="28" height="28" alt="">` +
            `<span>${foundry.utils.escapeHTML ? foundry.utils.escapeHTML(c.item.name) : c.item.name}</span>` +
          `</label>`
        );
      }
    };
    makeSection("Weapons", grouped.weapon);
    makeSection("Armor", grouped.armor);
    makeSection("Trinkets", grouped.trinket);

    const content = `
      <style>
        .vces-section-label { font-weight: bold; margin-top: 8px; opacity: 0.85; }
        .vces-target-row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: pointer; border-radius: 4px; }
        .vces-target-row:hover { background: rgba(255,255,255,0.06); }
        .vces-target-row input { margin: 0; }
        .vces-target-row img { border: 0; border-radius: 3px; flex-shrink: 0; }
      </style>
      <p>Choose an item to apply <strong>+${bonus}</strong> to. The scroll will be consumed.</p>
      <div class="vces-target-list">${rows.join("")}</div>
    `;

    // Cache the scrollItem so the button handler can resolve selection.
    return new Promise(async (resolve) => {
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: `Use +${bonus} Enchantment Scroll` },
        content,
        buttons: [
          {
            label: "Apply",
            icon: `<i class="fas fa-wand-magic-sparkles"></i>`,
            action: "apply",
            default: true,
            callback: (event, button, dialog) => {
              const root = dialog.element;
              const picked = root.querySelector('input[name="vces-target"]:checked');
              if (!picked) {
                ui.notifications.warn("Pick an item first.");
                return false;  // keep dialog open
              }
              return { id: picked.value, slot: picked.dataset.slot };
            },
          },
          { label: "Cancel", action: "cancel" },
        ],
        rejectClose: false,
        position: { width: 420 },
      });
      if (!choice || choice === "cancel") return resolve(null);
      const actor = scrollItem.parent;
      const item = actor?.items.get(choice.id);
      if (!item) return resolve(null);
      resolve({ item, slot: choice.slot });
    });
  },

  /** Apply +N as an Active Effect and consume one scroll charge. */
  async _applyBonus(scrollItem, target, slot, bonus) {
    const actor = scrollItem.parent;
    const powerId = POWER_BY_SLOT[slot]?.[bonus];
    if (!powerId) {
      ui.notifications.error(`Unknown enchantment tier: ${slot} +${bonus}`);
      return;
    }
    const power = RELIC_POWERS.find(p => p.id === powerId);
    if (!power) {
      ui.notifications.error(`Relic power ${powerId} not found.`);
      return;
    }

    // Build the Active Effect mirroring the Relic Forge's pipeline so the
    // existing equip-gating (relic-effects.mjs) just works.
    const effectDoc = {
      name: `Enchanted: ${power.name}`,
      icon: target.img || "icons/svg/item-bag.svg",
      changes: foundry.utils.deepClone(power.changes || []),
      disabled: !target.system?.equipped,
      transfer: true,
      flags: {
        [MODULE_ID]: {
          relicPower: power.id,
          managed: true,
          equipGated: true,
          fromEnchantmentScroll: true,
        },
      },
    };

    // Merge name format into item name — e.g. "+1 Longsword".
    const newName = this._applyNameFormat(target.name, power.nameFormat);

    const itemUpdates = {
      name: newName,
      [`flags.${MODULE_ID}.relicForge`]: {
        forged: true,
        powers: [power.id],
        userInputs: {},
        powerCost: 0,
        forgedAt: Date.now(),
        source: "enchantment-scroll",
      },
    };

    await target.update(itemUpdates);
    await target.createEmbeddedDocuments("ActiveEffect", [effectDoc]);

    // Consume one charge of the scroll.
    const qty = scrollItem.system?.quantity ?? 1;
    if (qty > 1) {
      await scrollItem.update({ "system.quantity": qty - 1 });
    } else {
      await scrollItem.delete();
    }

    // Chat announcement.
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="vagabond-chat-card-v2" data-card-type="generic">
          <div class="card-body">
            <header class="card-header">
              <div class="header-icon">
                <img src="${target.img || "icons/svg/item-bag.svg"}" alt="${target.name}">
              </div>
              <div class="header-info">
                <h3 class="header-title">Enchantment Applied</h3>
                <div class="metadata-tags-row">
                  <div class="meta-tag"><span>${actor.name}</span></div>
                </div>
              </div>
            </header>
            <section class="content-body">
              <div class="card-description" style="text-align:center; padding:4px 0;">
                <p>Enchanted <strong>${target.name}</strong> with <strong>${power.name}</strong>.</p>
                <p><em>The scroll crumbles to dust.</em></p>
              </div>
            </section>
          </div>
        </div>
      `,
    });
  },

  /** Apply the Relic Forge nameFormat to the target's base name. */
  _applyNameFormat(baseName, fmt) {
    if (!fmt) return baseName;
    if (fmt.position === "prefix") return `${fmt.text} ${baseName}`;
    if (fmt.position === "suffix") return `${baseName} ${fmt.text}`;
    if (fmt.position === "wrap" && fmt.template) {
      return fmt.template.replace("{item}", baseName).replace("{input}", "");
    }
    return baseName;
  },
};
