/**
 * Vagabond Crawler — Rest & Breather
 *
 * Combined dialog for Rest (full recovery) and Breather (ration heal).
 * Ported from vagabond-extras/gm-tools.mjs.
 */

import { MODULE_ID }    from "./vagabond-crawler.mjs";
import { waitDialog }   from "./dialog-helpers.mjs";

export const RestBreather = {

  async show() {
    const characters = game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
    if (!characters.length) { ui.notifications.warn("No player characters found."); return; }

    const rows = characters.map(a => {
      const s = a.system;
      const ration = a.items.find(i => /^ration/i.test(i.name.trim()));
      const rations = ration ? (ration.system.quantity ?? 1) : 0;
      return `<tr>
        <td><strong>${a.name}</strong></td>
        <td>${s.health.value}/${s.health.max}</td>
        <td>${s.currentLuck ?? 0}/${s.stats?.luck?.total ?? 0}</td>
        <td>${(s.mana?.max ?? 0) > 0 ? `${s.mana?.current ?? 0}/${s.mana.max}` : "—"}</td>
        <td>${s.fatigue ?? 0}</td>
        <td>${s.stats?.might?.total ?? 0}</td>
        <td class="${rations === 0 ? "vcb-no-rations" : ""}">${rations > 0 ? rations : "None!"}</td>
      </tr>`;
    }).join("");

    const content = `
      <div class="vagabond-crawler-rest-dialog">
        <table class="vcb-rest-table">
          <thead><tr>
            <th>Character</th><th>HP</th><th>Luck</th><th>Mana</th>
            <th>Fatigue</th><th>Might</th><th>Rations</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <hr/>
        <p class="vcb-rest-desc">
          <i class="fas fa-bed"></i> <strong>Rest:</strong>
          Restores HP, Luck, and Mana to max. If HP is full, removes 1 Fatigue.
        </p>
        <p class="vcb-rest-desc">
          <i class="fas fa-utensils"></i> <strong>Breather:</strong>
          Deducts 1 ration, heals HP equal to Might. Requires rations.
        </p>
      </div>`;

    const choice = await waitDialog({
      title: "Rest & Breather",
      content,
      buttons: [
        { label: "Rest",     icon: "fas fa-bed",      value: "rest"     },
        { label: "Breather", icon: "fas fa-utensils", value: "breather" },
        { label: "Cancel",   icon: "fas fa-times",    value: null       },
      ],
      defaultButton: "rest",
      width: 660,
    });

    if (!choice) return;
    if (choice === "rest")     await this._doRest(characters);
    else                       await this._doBreather(characters);
  },

  async _doRest(characters) {
    const results = [];
    for (const actor of characters) {
      const s = actor.system, hp = s.health, updates = {}, desc = [];

      if (hp.value >= hp.max) {
        if ((s.fatigue ?? 0) > 0) {
          updates["system.fatigue"] = s.fatigue - 1;
          desc.push(`Fatigue ${s.fatigue} → ${s.fatigue - 1}`);
        } else {
          desc.push("Fully rested");
        }
      } else {
        updates["system.health.value"] = hp.max;
        desc.push(`HP ${hp.value} → ${hp.max}`);
      }

      const luckMax = s.stats?.luck?.total ?? 0;
      if ((s.currentLuck ?? 0) < luckMax) {
        updates["system.currentLuck"] = luckMax;
        desc.push(`Luck → ${luckMax}`);
      }

      const manaMax = s.mana?.max ?? 0;
      if (manaMax > 0 && (s.mana?.current ?? 0) < manaMax) {
        updates["system.mana.current"] = manaMax;
        desc.push(`Mana → ${manaMax}`);
      }

      if (Object.keys(updates).length) await actor.update(updates);
      results.push({ name: actor.name, desc: desc.join(", ") || "No changes" });
    }

    const lines = results.map(r => `<p><strong>${r.name}:</strong> ${r.desc}</p>`).join("");
    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat">
        <h3><i class="fas fa-bed"></i> Rest</h3>
        <div class="vcb-rest-results">${lines}</div>
      </div>`,
      speaker: { alias: "Crawler" },
    });
  },

  async _doBreather(characters) {
    const results = [];
    for (const actor of characters) {
      const s = actor.system;
      const might = s.stats?.might?.total ?? 0;
      const hp    = s.health;
      const desc  = [];

      const ration = actor.items.find(i => /^ration/i.test(i.name.trim()));
      if (!ration) { results.push({ name: actor.name, desc: "No rations — skipped" }); continue; }

      const qty = ration.system.quantity ?? 1;
      if (qty <= 1) { await ration.delete(); desc.push("Used last ration"); }
      else          { await ration.update({ "system.quantity": qty - 1 }); desc.push(`Rations: ${qty} → ${qty - 1}`); }

      const newHP = Math.min(hp.value + might, hp.max);
      if (newHP > hp.value) {
        await actor.update({ "system.health.value": newHP });
        desc.push(`HP ${hp.value} → ${newHP} (+${might})`);
      } else {
        desc.push("HP already at max");
      }

      results.push({ name: actor.name, desc: desc.join(", ") });
    }

    const lines = results.map(r => `<p><strong>${r.name}:</strong> ${r.desc}</p>`).join("");
    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat">
        <h3><i class="fas fa-utensils"></i> Breather</h3>
        <div class="vcb-rest-results">${lines}</div>
      </div>`,
      speaker: { alias: "Crawler" },
    });
  },
};
