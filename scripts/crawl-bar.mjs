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
import { CrawlClock }      from "./crawl-clock.mjs";
// LightTracker now lives in the system — access via globalThis

/**
 * Pick the best static image for a token's crawl strip portrait.
 * Prefers the token texture, but falls back to the actor portrait
 * if the texture is a video (.webm) or missing.
 */
function _memberImg(tokenSrc, actor) {
  if (tokenSrc && !tokenSrc.endsWith('.webm')) return tokenSrc;
  return actor?.img || tokenSrc || 'icons/svg/mystery-man.svg';
}
const _getLightTracker = () => globalThis.vagabond?.lightTracker;
import { ICONS }           from "./icons.mjs";

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


    if (!state.active) {
      this._el.innerHTML = `
        <div class="vcb-inner vcb-inactive">
          <button class="vcb-btn vcb-start-btn" data-action="startCrawl">
            ${ICONS.startCrawl} Start Crawl
          </button>
        </div>`;
      this._bindEvents();
      return;
    }

    if (state.paused) {
      const combatStarted = game.combat?.started ?? false;
      this._el.innerHTML = `
        <div class="vcb-inner">
          <span class="vcb-phase-badge vcb-phase-combat">${ICONS.combat} Combat Active</span>
          ${combatStarted
            ? `<button class="vcb-btn vcb-danger-btn" data-action="endEncounter">${ICONS.close} End Encounter</button>`
            : `<button class="vcb-btn vcb-combat-btn" data-action="beginEncounter">${ICONS.combat} Begin Encounter</button>`
          }
          <button class="vcb-btn" data-action="addSelectedTokens" title="Add selected tokens to combat">
            ${ICONS.addTokens} Add Tokens
          </button>
          <button class="vcb-btn vcb-danger-btn" data-action="deleteEncounter" title="Delete encounter without resuming crawl">
            <i class="fa-solid fa-trash"></i> Delete Encounter
          </button>
          <button class="vcb-btn vcb-danger-btn" data-action="endCrawl">${ICONS.close} End Crawl</button>
        </div>`;
      this._bindEvents();
      return;
    }

    const isHeroes   = state.isHeroesPhase;
    const phaseLabel = isHeroes ? "Heroes Turn" : "GM Turn";
    const phaseIcon  = isHeroes ? ICONS.heroes : ICONS.gm;
    const nextLabel  = isHeroes ? "GM Turn" : "Heroes Turn";

    this._el.innerHTML = `
      <div class="vcb-inner vcb-active">

        <span class="vcb-phase-badge ${isHeroes ? "vcb-phase-heroes" : "vcb-phase-gm"}">
          ${phaseIcon} ${phaseLabel}
        </span>
        <button class="vcb-btn vcb-next-btn" data-action="nextTurn">
          ${ICONS.nextTurn} ${nextLabel}
        </button>

        <div class="vcb-divider"></div>

        <button class="vcb-btn" data-action="addSelectedTokens" title="Add selected tokens to tracker">
          ${ICONS.addTokens} Add Tokens
        </button>
        <button class="vcb-btn vcb-combat-btn" data-action="startCombat">
          ${ICONS.combat} Combat
        </button>

        <div class="vcb-divider"></div>

        <button class="vcb-btn" data-action="encounterCheck"
                title="Left-click: roll d6 encounter check (${game.settings.get(MODULE_ID, "encounterThreshold")}-in-6)&#10;Right-click: options (threshold, instant, table builder)">
          ${ICONS.encCheck} Encounter
        </button>

        ${CrawlClock.available ? `
        <div class="vcb-clock-widget" data-action="advanceClock"
             title="Crawl Clock: ${CrawlClock.filled}/${CrawlClock.segments}&#10;Left-click: advance 1 scene&#10;Right-click: options">
          ${CrawlClock.svgPath ? `<img class="vcb-clock-svg" src="${CrawlClock.svgPath}" alt="Crawl Clock" />` : ICONS.clock}
          <span class="vcb-clock-label">${CrawlClock.filled}/${CrawlClock.segments}</span>
        </div>
        ` : ""}

        <div class="vcb-divider"></div>

        <button class="vcb-btn" data-action="restBreather">
          ${ICONS.rest} Rest
        </button>
        <button class="vcb-btn vcb-danger-btn" data-action="endCrawl">
          ${ICONS.close} End
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

    // Right-click context menu on clock widget
    const clockWidget = this._el.querySelector(".vcb-clock-widget");
    if (clockWidget) {
      clockWidget.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._showClockMenu(ev);
      });
    }

    // Right-click on Encounter button → options menu
    const encCheckBtn = this._el.querySelector('[data-action="encounterCheck"]');
    if (encCheckBtn) {
      encCheckBtn.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._showEncounterMenu(ev, encCheckBtn);
      });
    }
  },

  async _onAction(action) {
    switch (action) {

      case "startCrawl":
        await CrawlState.start();
        await CrawlClock.ensure();
        this.render();
        (await import("./crawl-strip.mjs")).CrawlStrip.render();
        break;

      case "beginEncounter":
        // Start the Foundry combat (rolls initiative, begins turn tracking)
        if (game.combat && !game.combat.started) {
          await game.combat.startCombat();
        }
        this.render();
        break;

      case "endEncounter":
        // End the Foundry combat — the deleteCombat hook handles crawl resume
        if (game.combat) {
          await game.combat.endCombat();
        }
        break;

      case "deleteEncounter":
        // Delete the combat entirely without the normal end-combat flow
        if (game.combat) {
          await game.combat.delete();
          ui.notifications.info("Encounter deleted.");
        }
        this.render();
        break;

      case "endCrawl": {
        const ok = await confirmDialog({ title: "End Crawl", content: "End crawl mode?" });
        if (ok) {
          await CrawlClock.cleanup();
          await CrawlState.end();
          this.render();
          (await import("./crawl-strip.mjs")).CrawlStrip.render();
        }
        break;
      }

      case "nextTurn": {
        const result = await CrawlState.nextTurn();
        if (result?.newTurn) {
          await MovementTracker.resetAll();
          // A new crawl turn = 1 Scene: advance clock, burn lights, track time
          if (CrawlClock.available) await CrawlClock.advance("scene");
          const mins = game.settings.get(MODULE_ID, "timePassesMinutes");
          await _getLightTracker()?.advanceTime(mins * 60);
          await CrawlState.addTime(mins);
        }
        this.render();
        (await import("./crawl-strip.mjs")).CrawlStrip.render();
        break;
      }

      case "addSelectedTokens":
        await this._addSelectedTokens();
        break;

      case "advanceClock": {
        const clockResult = await CrawlClock.advance("scene");
        if (clockResult?.wasReset) ui.notifications.info("Crawl clock filled and reset!");
        this.render();
        break;
      }

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

      case "lightTracker":
        _getLightTracker()?.openTracker();
        break;

      case "startCombat":
        await this._startCombat();
        break;

      case "restBreather":
        await RestBreather.show();
        break;
    }
  },

  // ── Clock context menu ────────────────────────────────────────────────────

  _showClockMenu(ev) {
    this._dismissClockMenu();

    const menu = document.createElement("div");
    menu.className = "vcb-clock-menu";

    menu.innerHTML = `
      <div class="vcb-clock-menu-item" data-clock="rollBack">
        ${ICONS.rollBack} Roll Back
      </div>
      <div class="vcb-clock-menu-item" data-clock="configure">
        ${ICONS.configure} Configure
      </div>`;

    // Position near the click
    menu.style.left = `${ev.clientX}px`;
    menu.style.top  = `${ev.clientY}px`;
    document.body.appendChild(menu);

    // Adjust if it overflows the viewport
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) menu.style.top = `${ev.clientY - rect.height}px`;
    if (rect.right > window.innerWidth)   menu.style.left = `${ev.clientX - rect.width}px`;

    menu.querySelectorAll("[data-clock]").forEach(item => {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        this._dismissClockMenu();
        const action = item.dataset.clock;
        if (action === "rollBack") {
          await CrawlClock.rollBack();
          this.render();
        } else if (action === "configure") {
          await CrawlClock.openConfig();
        }
      });
    });

    // Click-away dismiss
    this._clockMenuDismiss = (e) => {
      if (!menu.contains(e.target)) this._dismissClockMenu();
    };
    setTimeout(() => document.addEventListener("pointerdown", this._clockMenuDismiss), 0);
    this._clockMenu = menu;
  },

  _dismissClockMenu() {
    if (this._clockMenu) {
      this._clockMenu.remove();
      this._clockMenu = null;
    }
    if (this._clockMenuDismiss) {
      document.removeEventListener("pointerdown", this._clockMenuDismiss);
      this._clockMenuDismiss = null;
    }
  },

  // ── Encounter threshold popover ──────────────────────────────────────────

  _showThresholdPopover(anchor) {
    this._dismissThresholdPopover();

    const current = game.settings.get(MODULE_ID, "encounterThreshold");
    const pop = document.createElement("div");
    pop.className = "vcb-threshold-popover";

    let html = `<div class="vcb-threshold-title">Encounter Threshold</div>
      <div class="vcb-threshold-options">`;
    for (let i = 1; i <= 5; i++) {
      html += `<button class="vcb-threshold-opt ${i === current ? "active" : ""}" data-val="${i}">${i}-in-6</button>`;
    }
    html += `</div>`;
    pop.innerHTML = html;

    // Position above the anchor (bar sits at screen bottom)
    const rect = anchor.getBoundingClientRect();
    pop.style.left   = `${rect.left}px`;
    pop.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(pop);

    // Adjust if overflow
    const popRect = pop.getBoundingClientRect();
    if (popRect.right > window.innerWidth) pop.style.left = `${window.innerWidth - popRect.width - 8}px`;

    pop.querySelectorAll(".vcb-threshold-opt").forEach(btn => {
      btn.addEventListener("click", async () => {
        await game.settings.set(MODULE_ID, "encounterThreshold", parseInt(btn.dataset.val));
        this._dismissThresholdPopover();
        this.render();
        ui.notifications.info(`Encounter threshold: ${btn.dataset.val}-in-6`);
      });
    });

    this._thresholdDismiss = (e) => {
      if (!pop.contains(e.target)) this._dismissThresholdPopover();
    };
    setTimeout(() => document.addEventListener("pointerdown", this._thresholdDismiss), 0);
    this._thresholdPop = pop;
  },

  _dismissThresholdPopover() {
    if (this._thresholdPop) {
      this._thresholdPop.remove();
      this._thresholdPop = null;
    }
    if (this._thresholdDismiss) {
      document.removeEventListener("pointerdown", this._thresholdDismiss);
      this._thresholdDismiss = null;
    }
  },

  // ── Encounter right-click menu ───────────────────────────────────────────

  _showEncounterMenu(ev, anchor) {
    this._dismissEncounterMenu();

    const current = game.settings.get(MODULE_ID, "encounterThreshold");
    const menu = document.createElement("div");
    menu.className = "vcb-threshold-popover vcb-encounter-menu";

    // Build threshold row
    let thresholdBtns = '';
    for (let i = 1; i <= 5; i++) {
      thresholdBtns += `<button class="vcb-threshold-opt ${i === current ? "active" : ""}" data-val="${i}">${i}-in-6</button>`;
    }

    menu.innerHTML = `
      <div class="vcb-threshold-title">Encounter Threshold</div>
      <div class="vcb-threshold-options">${thresholdBtns}</div>
      <hr style="border-color: rgba(197,164,114,0.3); margin: 6px 0;">
      <button class="vcb-btn vcb-encounter-menu-btn" data-menu-action="instant">
        <i class="fas fa-bolt"></i> Instant Encounter
      </button>
      <button class="vcb-btn vcb-encounter-menu-btn" data-menu-action="tableBuilder">
        <i class="fas fa-table"></i> Open Table Builder
      </button>
    `;

    // Position above anchor
    const rect = anchor.getBoundingClientRect();
    menu.style.left   = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(menu);

    // Adjust if overflow
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) menu.style.left = `${window.innerWidth - menuRect.width - 8}px`;

    // Threshold buttons
    menu.querySelectorAll(".vcb-threshold-opt").forEach(btn => {
      btn.addEventListener("click", async () => {
        await game.settings.set(MODULE_ID, "encounterThreshold", parseInt(btn.dataset.val));
        this._dismissEncounterMenu();
        this.render();
        ui.notifications.info(`Encounter threshold: ${btn.dataset.val}-in-6`);
      });
    });

    // Menu action buttons
    menu.querySelectorAll("[data-menu-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.menuAction;
        this._dismissEncounterMenu();
        if (action === "instant") {
          EncounterTools.rollInstantEncounter();
        } else if (action === "tableBuilder") {
          EncounterTools.openTableBuilder();
        }
      });
    });

    // Dismiss on outside click
    this._encounterMenuDismiss = (e) => {
      if (!menu.contains(e.target)) this._dismissEncounterMenu();
    };
    setTimeout(() => document.addEventListener("pointerdown", this._encounterMenuDismiss), 0);
    this._encounterMenu = menu;
  },

  _dismissEncounterMenu() {
    if (this._encounterMenu) {
      this._encounterMenu.remove();
      this._encounterMenu = null;
    }
    if (this._encounterMenuDismiss) {
      document.removeEventListener("pointerdown", this._encounterMenuDismiss);
      this._encounterMenuDismiss = null;
    }
  },

  // ── Token management ─────────────────────────────────────────────────────

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
        img:     _memberImg(token.document.texture?.src, token.actor),
        type,
        actorId: token.actor.id,
        tokenId: token.id,
      });
      // Reset movement to full crawl/combat speed so tokens start with correct budget
      if (type === "player") {
        await MovementTracker.resetActor(token.actor);
        MovementTracker.snapshotPosition(token.id);
      }
      added++;
    }
    if (added) {
      ui.notifications.info(`Added ${added} token(s).`);
      this.render();
      (await import("./crawl-strip.mjs")).CrawlStrip.render();
    }
  },

  async _startCombat() {
    if (CrawlClock.available) await CrawlClock.hide();
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
        img:     _memberImg(token.texture?.src, token.actor),
        type,
        actorId: token.actor.id,
        tokenId: token.id,
        source:  type === "npc" ? "combat" : undefined,
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

// Re-render bar when combat starts (Begin Encounter from sidebar) so button swaps
Hooks.on("combatStart", () => {
  if (game.user.isGM && CrawlState.paused) CrawlBar.render();
});

// Re-render bar on combat turn/round changes (keeps bar in sync with sidebar)
Hooks.on("updateCombat", (combat, changes) => {
  if (game.user.isGM && CrawlState.paused && changes.round !== undefined) CrawlBar.render();
});

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
    img:     _memberImg(token.texture?.src, token.actor),
    type,
    actorId: token.actor.id,
    tokenId: token.id,
    source:  type === "npc" ? "combat" : undefined,
  });
  const { CrawlStrip } = await import("./crawl-strip.mjs");
  CrawlStrip.render();
});

// Resume prompt when combat ends
Hooks.on("deleteCombat", async () => {
  if (!game.user.isGM || !CrawlState.paused) return;
  await new Promise(r => setTimeout(r, 500));

  // Remove only NPCs that were added for this combat (not persistent crawl NPCs)
  const npcIds = CrawlState.members
    .filter(m => m.type === "npc" && m.source === "combat")
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
    if (CrawlClock.available) await CrawlClock.show();
    const { MovementTracker } = await import("./movement-tracker.mjs");
    await MovementTracker.resetAll(); // resets to crawl speed since CrawlState.paused is now false
    CrawlBar.render();
    (await import("./crawl-strip.mjs")).CrawlStrip.render();
  }
});
