/**
 * Vagabond Crawler — Crawl Bar
 *
 * Persistent bottom bar (GM only) sitting above the macro bar.
 * Two-phase turn structure: Heroes → GM → Heroes → GM ...
 */

import { MODULE_ID }       from "./vagabond-crawler.mjs";
import { CrawlState }      from "./crawl-state.mjs";
import { EncounterTools }  from "./encounter-tools.mjs";
import { RestBreather }    from "./rest-breather.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import { confirmDialog }   from "./dialog-helpers.mjs";

const BAR_ID = "vagabond-crawler-bar";

export const CrawlBar = {

  _el: null,

  mount() {
    if (document.getElementById(BAR_ID)) return;
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.classList.add("vagabond-crawler-bar");

    // Append to #ui-middle as last flex child (after strip, ui-top, ui-bottom).
    // Natural block flow — no position:fixed, no z-index fighting.
    // #ui-bottom has flex-shrink:1 so it compresses to give us room.
    const uiMiddle = document.getElementById("ui-middle");
    const uiBottom = document.getElementById("ui-bottom");
    if (uiBottom) {
      uiBottom.style.flexShrink = "1";
      uiBottom.style.minHeight  = "0";
    }
    if (uiMiddle) {
      uiMiddle.appendChild(bar);
    } else {
      document.body.appendChild(bar);
    }

    this._el = bar;
    this._attachDragDrop();
    this.render();
  },

  _updateBottomOffset() {}, // no-op — natural flow handles positioning

  render() {
    if (!this._el) return;

    const state       = CrawlState;
    const tableUuid   = game.settings.get(MODULE_ID, "encounterTableUuid");
    const tableName   = tableUuid ? this._getTableName(tableUuid) : null;
    const defaultMins = game.settings.get(MODULE_ID, "timePassesMinutes");


    if (!state.active) {
      this._el.innerHTML = `
        <div class="vcb-inner vcb-inactive">
          <button class="vcb-btn vcb-start-btn" data-action="startCrawl">
            <i class="fas fa-dungeon"></i> Start Crawl
          </button>
        </div>`;
      this._bindEvents();
      return;
    }

    if (state.paused) {
      this._el.innerHTML = `
        <div class="vcb-inner">
          <span class="vcb-phase-badge vcb-phase-combat"><i class="fas fa-swords"></i> Combat Active</span>
          <button class="vcb-btn vcb-resume-btn" data-action="resumeCrawl"><i class="fas fa-play"></i> Resume Crawl</button>
          <button class="vcb-btn vcb-danger-btn" data-action="endCrawl"><i class="fas fa-times"></i> End Crawl</button>
        </div>`;
      this._bindEvents();
      return;
    }

    const isHeroes   = state.isHeroesPhase;
    const phaseLabel = isHeroes ? "Heroes Phase" : "GM Phase";
    const phaseIcon  = isHeroes ? "fa-users" : "fa-crown";
    const nextLabel  = isHeroes ? "GM Turn" : "Heroes Turn";

    this._el.innerHTML = `
      <div class="vcb-inner vcb-active">

        <span class="vcb-phase-badge ${isHeroes ? "vcb-phase-heroes" : "vcb-phase-gm"}">
          <i class="fas ${phaseIcon}"></i> ${phaseLabel}
        </span>
        <button class="vcb-btn vcb-next-btn" data-action="nextTurn">
          <i class="fas fa-chevron-right"></i> ${nextLabel}
        </button>
        <span class="vcb-turn-info">Turn ${state.turnCount} · ${state.formatElapsed()}</span>

        <div class="vcb-divider"></div>

        <button class="vcb-btn" data-action="addSelectedTokens" title="Add selected tokens to tracker">
          <i class="fas fa-user-plus"></i> Add Tokens
        </button>
        <button class="vcb-btn" data-action="addGM" title="Add GM slot">
          <i class="fas fa-crown"></i> Add GM
        </button>

        <div class="vcb-divider"></div>

        <button class="vcb-btn" data-action="encounterCheck" title="Roll d6 for encounter">
          <i class="fas fa-dice-d6"></i> Enc. Check
        </button>
        <button class="vcb-btn" data-action="openTableBuilder" title="Open encounter roller / build table">
          <i class="fas fa-dragon"></i> Encounter!
        </button>
        <div class="vcb-table-drop ${tableName ? "has-table" : ""}"
             title="${tableName ? "Active: " + tableName : "Drop a RollTable here"}">
          <i class="fas fa-scroll"></i>
          <span>${tableName ?? "Drop Table"}</span>
          ${tableName ? `<button class="vcb-clear-table" data-action="clearTable">×</button>` : ""}
        </div>

        <div class="vcb-divider"></div>

        <button class="vcb-btn" data-action="timePasses">
          <i class="fas fa-hourglass-half"></i> Time Passes
        </button>
        <input class="vcb-time-input" type="number" min="1" max="480"
               value="${defaultMins}" data-key="timeMins" />
        <span class="vcb-unit">min</span>
        <button class="vcb-btn" data-action="lightTracker">
          <i class="fas fa-fire"></i> Lights
        </button>

        <div class="vcb-divider"></div>

        <button class="vcb-btn vcb-combat-btn" data-action="startCombat">
          <i class="fas fa-swords"></i> Combat
        </button>
        <button class="vcb-btn" data-action="restBreather">
          <i class="fas fa-bed"></i> Rest
        </button>
        <button class="vcb-btn vcb-danger-btn" data-action="endCrawl">
          <i class="fas fa-times"></i> End
        </button>

      </div>`;

    this._bindEvents();
  },

  _bindEvents() {
    if (!this._el) return;
    this._el.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._onAction(el.dataset.action);
      });
    });
    this._el.querySelector("[data-key='timeMins']")?.addEventListener("change", ev => {
      const v = parseInt(ev.target.value);
      if (v > 0) game.settings.set(MODULE_ID, "timePassesMinutes", v);
    });
  },

  async _onAction(action) {
    switch (action) {

      case "startCrawl":
        await CrawlState.start();
        this.render();
        (await import("./crawl-strip.mjs")).CrawlStrip.render();
        break;

      case "resumeCrawl":
        await CrawlState.resume();
        this.render();
        (await import("./crawl-strip.mjs")).CrawlStrip.render();
        break;

      case "endCrawl": {
        const ok = await confirmDialog({ title: "End Crawl", content: "End crawl mode?" });
        if (ok) {
          await CrawlState.end();
          this.render();
          (await import("./crawl-strip.mjs")).CrawlStrip.render();
        }
        break;
      }

      case "nextTurn": {
        const result = await CrawlState.nextTurn();
        if (result?.newTurn) await MovementTracker.resetAll();
        this.render();
        (await import("./crawl-strip.mjs")).CrawlStrip.render();
        break;
      }

      case "addSelectedTokens":
        await this._addSelectedTokens();
        break;

      case "addGM":
        await CrawlState.addMember({ id: "gm", name: "Game Master", img: "icons/svg/cowled.svg", type: "gm" });
        this.render();
        (await import("./crawl-strip.mjs")).CrawlStrip.render();
        break;

      case "encounterCheck":
        await EncounterTools.rollEncounterCheck();
        break;

      case "openTableBuilder":
        EncounterTools.openTableBuilder();
        break;

      case "clearTable":
        await game.settings.set(MODULE_ID, "encounterTableUuid", "");
        this.render();
        break;

      case "timePasses": {
        const mins = parseInt(this._el?.querySelector("[data-key='timeMins']")?.value
          ?? game.settings.get(MODULE_ID, "timePassesMinutes"));
        if (mins > 0) {
          await CrawlState.addTime(mins);
          const { LightTracker } = await import("./light-tracker.mjs");
          await LightTracker.advanceTime(mins * 60);
          await ChatMessage.create({
            content: `<div class="vagabond-crawler-chat"><i class="fas fa-hourglass-half"></i> <strong>Time Passes</strong> — ${mins} minutes. (Total: ${CrawlState.formatElapsed()})</div>`,
            speaker: { alias: "Crawler" },
            whisper: game.users.filter(u => u.isGM).map(u => u.id),
          });
          this.render();
        }
        break;
      }

      case "lightTracker":
        (await import("./light-tracker.mjs")).LightTracker.openTracker();
        break;

      case "startCombat":
        await this._startCombat();
        break;

      case "restBreather":
        await RestBreather.show();
        break;
    }
  },

  async _addSelectedTokens() {
    const selected = canvas.tokens?.controlled ?? [];
    if (!selected.length) { ui.notifications.warn("Select tokens first."); return; }
    let added = 0;
    for (const token of selected) {
      if (!token.actor) continue;
      const type = token.actor.type === "character" ? "player" : "npc";
      await CrawlState.addMember({
        id:      `token-${token.id}`,
        name:    token.name,
        img:     token.document.texture?.src ?? token.actor.img,
        type,
        actorId: token.actor.id,
        tokenId: token.id,
      });
      added++;
    }
    if (added) {
      ui.notifications.info(`Added ${added} token(s).`);
      this.render();
      (await import("./crawl-strip.mjs")).CrawlStrip.render();
    }
  },

  async _startCombat() {
    await CrawlState.pause();
    this.render();

    const scene = canvas.scene;
    if (!scene) return;

    // Create combat if none exists
    let combat = game.combat;
    if (!combat) combat = await Combat.create({ scene: scene.id });

    // Activate it so it's the viewed combat
    if (combat.active === false) await combat.activate();

    // Collect token documents to add — crawl members + selected tokens, deduped
    const existingTokenIds = new Set(combat.combatants.map(c => c.tokenId));

    const tokenDocs = new Map();
    for (const m of CrawlState.playerMembers) {
      if (!m.tokenId || existingTokenIds.has(m.tokenId)) continue;
      const token = canvas.tokens?.get(m.tokenId)?.document;
      if (token) tokenDocs.set(m.tokenId, token);
    }
    for (const t of canvas.tokens?.controlled ?? []) {
      if (existingTokenIds.has(t.id)) continue;
      tokenDocs.set(t.id, t.document);
    }

    // Use the standard Foundry API — same as dragging tokens onto the tracker
    if (tokenDocs.size > 0) {
      await TokenDocument.implementation.createCombatants([...tokenDocs.values()]);
    }

    // Sync any combatants already in the tracker that aren't in crawl state yet
    // (e.g. NPCs added manually before hitting the Combat button)
    for (const c of combat.combatants) {
      const memberId = `token-${c.tokenId}`;
      if (CrawlState.members.some(m => m.id === memberId)) continue;
      const token = c.token;
      if (!token?.actor) continue;
      const type = token.actor.type === "character" ? "player" : "npc";
      await CrawlState.addMember({
        id:      memberId,
        name:    token.name,
        img:     token.texture?.src ?? token.actor.img,
        type,
        actorId: token.actor.id,
        tokenId: token.id,
      });
    }

    ui.combat?.render(true);
  },

  _attachDragDrop() {
    if (!this._el) return;
    this._el.addEventListener("dragover", ev => {
      ev.preventDefault();
      this._el.querySelector(".vcb-table-drop")?.classList.add("drag-over");
    });
    this._el.addEventListener("dragleave", ev => {
      if (!this._el.contains(ev.relatedTarget)) {
        this._el.querySelector(".vcb-table-drop")?.classList.remove("drag-over");
      }
    });
    this._el.addEventListener("drop", async ev => {
      ev.preventDefault();
      this._el.querySelector(".vcb-table-drop")?.classList.remove("drag-over");
      try {
        const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
        if (data.type !== "RollTable") { ui.notifications.warn("Drop a RollTable here."); return; }
        const table = await fromUuid(data.uuid);
        if (!table) { ui.notifications.error("Table not found."); return; }
        await game.settings.set(MODULE_ID, "encounterTableUuid", data.uuid);
        ui.notifications.info(`Encounter table set: "${table.name}"`);
        this.render();
      } catch (e) { console.error(`${MODULE_ID} | Drop error:`, e); }
    });
  },

  _getTableName(uuid) {
    try { return game.tables.get(uuid.split(".").pop())?.name ?? null; }
    catch { return null; }
  },
};

// Auto-add any token dropped onto the combat tracker into the crawl strip
Hooks.on("createCombatant", async (combatant) => {
  if (!game.user.isGM || !CrawlState.active) return;
  const token = combatant.token;
  if (!token?.actor) return;
  const memberId = `token-${token.id}`;
  if (CrawlState.members.some(m => m.id === memberId)) return;
  const type = token.actor.type === "character" ? "player" : "npc";
  await CrawlState.addMember({
    id:      memberId,
    name:    token.name,
    img:     token.texture?.src ?? token.actor.img,
    type,
    actorId: token.actor.id,
    tokenId: token.id,
  });
  const { CrawlStrip } = await import("./crawl-strip.mjs");
  CrawlStrip.render();
});

// Resume prompt when combat ends
Hooks.on("deleteCombat", async () => {
  if (!game.user.isGM || !CrawlState.paused) return;
  await new Promise(r => setTimeout(r, 500));

  // Remove NPC combat members, restore GM if they were removed
  const npcIds = CrawlState.members
    .filter(m => m.type === "npc")
    .map(m => m.id);
  for (const id of npcIds) await CrawlState.removeMember(id);

  // Re-add GM if not already present
  if (!CrawlState.members.some(m => m.type === "gm")) {
    await CrawlState.addMember({
      id: "gm", name: "Game Master",
      img: "icons/svg/cowled.svg", type: "gm",
    });
  }

  const { confirmDialog } = await import("./dialog-helpers.mjs");
  const resume = await confirmDialog({
    title: "Combat Ended",
    content: "Combat is over. Resume crawl mode?",
  });
  if (resume) {
    await CrawlState.resume();
    const { MovementTracker } = await import("./movement-tracker.mjs");
    await MovementTracker.resetAll(); // resets to crawl speed since CrawlState.paused is now false
    CrawlBar.render();
    (await import("./crawl-strip.mjs")).CrawlStrip.render();
  }
});
