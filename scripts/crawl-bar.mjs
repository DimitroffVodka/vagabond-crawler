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
import { LightTracker }    from "./light-tracker.mjs";
import { ICONS }           from "./icons.mjs";
import { RelicForge }      from "./relic-forge.mjs";
import { LootTracker }     from "./loot-tracker.mjs";
import { LootManager }     from "./loot-manager.mjs";
import { LootGenerator }   from "./loot-generator.mjs";
import { ScrollForge }     from "./scroll-forge.mjs";
import { MerchantShop }    from "./merchant-shop.mjs";
import { PartyInventory } from "./party-inventory.mjs";
import { SessionRecap }   from "./session-recap.mjs";
import { AnimationFx }    from "./animation-fx.mjs";

const BAR_ID = "vagabond-crawler-bar";

// ── Shared menu helpers ────────────────────────────────────────────────────────

/** Position a popup above the click point, clamped to viewport. */
function _positionMenu(el, ev) {
  const anchor = ev.currentTarget ?? ev.target;
  const anchorRect = anchor.getBoundingClientRect();
  el.style.left = `${ev.clientX ?? anchorRect.left}px`;
  el.style.bottom = `${window.innerHeight - (ev.clientY ?? anchorRect.top) + 4}px`;
  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  if (rect.top < 0) { el.style.bottom = "auto"; el.style.top = `${(ev.clientY ?? anchorRect.bottom) + 4}px`; }
  if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
}

/** Attach a click-away dismiss handler. Returns { el, dismiss } cleanup keys stored on `self`. */
function _attachDismiss(self, el, elKey, dismissKey, excludeTarget) {
  const handler = (e) => {
    if (!el.contains(e.target) && e.target !== excludeTarget) _dismiss(self, elKey, dismissKey);
  };
  setTimeout(() => document.addEventListener("pointerdown", handler), 0);
  self[elKey] = el;
  self[dismissKey] = handler;
}

/** Remove a popup and its click-away listener. */
function _dismiss(self, elKey, dismissKey) {
  if (self[elKey]) { self[elKey].remove(); self[elKey] = null; }
  if (self[dismissKey]) { document.removeEventListener("pointerdown", self[dismissKey]); self[dismissKey] = null; }
}

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
          ${combatStarted
            ? `<button class="vcb-btn vcb-danger-btn" data-action="endEncounter">${ICONS.close} End Encounter</button>`
            : `<button class="vcb-btn vcb-combat-btn" data-action="beginEncounter">${ICONS.combat} Begin Encounter</button>`
          }
          <div class="vcb-divider"></div>
          <button class="vcb-btn" data-action="addSelectedTokens" title="Add selected tokens to tracker">
            ${ICONS.addTokens} Add Tokens
          </button>
          <button class="vcb-btn vcb-danger-btn" data-action="deleteEncounter" title="Delete the combat encounter without ending it">
            ${ICONS.close} Delete Encounter
          </button>
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

        <button class="vcb-btn" data-action="openTableBuilder"
                title="Left-click: Open encounter roller&#10;Right-click: Enc. check & threshold${tableName ? "&#10;Table: " + tableName : ""}">
          ${ICONS.encounter} Encounter${tableName ? ` <span class="vcb-enc-table-indicator">●</span>` : ""}
        </button>
        <button class="vcb-btn" data-action="lightTracker"
                title="Left-click: Tracker | Right-click: Configure light sources">
          ${ICONS.lights} Lights
        </button>
        <button class="vcb-btn" data-action="restBreather">
          ${ICONS.rest} Rest
        </button>
        <button class="vcb-btn" data-action="lootForge"
                title="Left-click: Tools&#10;Right-click: Settings">
          <i class="fas fa-hammer"></i> Forge & Loot
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
        this._onAction(el.dataset.action, ev);
      });
    });

    // Right-click context menu on Encounter button
    const encBtn = this._el.querySelector('[data-action="openTableBuilder"]');
    if (encBtn) {
      encBtn.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._showEncounterMenu(ev);
      });
    }

    // Right-click context menu on Forge & Loot button
    const forgeLootBtn = this._el.querySelector('[data-action="lootForge"]');
    if (forgeLootBtn) {
      forgeLootBtn.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._showForgeLootMenu(ev);
      });
    }

    // Right-click on Lights button → open Light Sources Config
    const lightsBtn = this._el.querySelector('[data-action="lightTracker"]');
    if (lightsBtn) {
      lightsBtn.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        LightTracker.openSourcesConfig();
      });
    }
  },

  async _onAction(action, e) {
    switch (action) {

      case "startCrawl":
        await CrawlState.start();
        await CrawlClock.ensure();
        await MovementTracker.resetAll();
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
        // Delete the combat without the "end encounter" flow (no resume prompt)
        if (game.combat) {
          const ok = await confirmDialog({ title: "Delete Encounter", content: "Delete this combat encounter? This will not trigger the end-of-combat flow." });
          if (ok) {
            await game.combat.delete();
            await CrawlState.resume();
            if (CrawlClock.available) await CrawlClock.show();
            await MovementTracker.resetAll();
            this.render();
            (await import("./crawl-strip.mjs")).CrawlStrip.render();
          }
        }
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
        // Reset movement on every phase change (Heroes→GM and GM→Heroes)
        await MovementTracker.resetAll();
        if (result?.newTurn) {
          // A new crawl turn = 1 Scene: advance clock, burn lights, track time
          if (CrawlClock.available) await CrawlClock.advance("scene");
          const mins = game.settings.get(MODULE_ID, "timePassesMinutes");
          await LightTracker.advanceTime(mins * 60);
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

      case "openTableBuilder":
        EncounterTools.openTableBuilder();
        break;

      case "lightTracker":
        LightTracker.openTracker();
        break;

      case "startCombat":
        await this._startCombat();
        break;

      case "lootForge":
        this._showForgeToolbar(e);
        break;

      case "restBreather":
        await RestBreather.show();
        break;
    }
  },

  // ── Encounter context menu (right-click) ─────────────────────────────────

  _showEncounterMenu(ev) {
    this._dismissEncounterMenu();

    const current = game.settings.get(MODULE_ID, "encounterThreshold");
    const tableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    const tableName = tableUuid ? this._getTableName(tableUuid) : null;

    const menu = document.createElement("div");
    menu.className = "vcb-clock-menu"; // reuse existing menu styles

    let thresholdBtns = "";
    for (let i = 1; i <= 5; i++) {
      thresholdBtns += `<button class="vcb-threshold-opt ${i === current ? "active" : ""}" data-val="${i}">${i}-in-6</button>`;
    }

    menu.innerHTML = `
      <div class="vcb-clock-menu-item" data-enc="check">
        ${ICONS.encCheck} Encounter Check (${current}-in-6)
      </div>
      <div class="vcb-enc-menu-divider"></div>
      <div class="vcb-enc-menu-section">
        <div class="vcb-threshold-title" style="padding:4px 8px; color:#aaa; font-size:0.8em;">Threshold</div>
        <div class="vcb-threshold-options" style="display:flex; gap:2px; padding:2px 8px;">${thresholdBtns}</div>
      </div>
      <div class="vcb-enc-menu-divider"></div>
      <div class="vcb-clock-menu-item" data-enc="setTable">
        ${ICONS.tableScroll} ${tableName ? `Table: ${tableName}` : "Set Encounter Table"}
      </div>
      ${tableName ? `<div class="vcb-clock-menu-item" data-enc="clearTable" style="color:#e74c3c;">
        ${ICONS.close} Clear Table
      </div>` : ""}
    `;

    _positionMenu(menu, ev);

    // Encounter check
    menu.querySelector('[data-enc="check"]')?.addEventListener("click", async () => {
      this._dismissEncounterMenu();
      await EncounterTools.rollEncounterCheck();
    });

    // Threshold buttons
    menu.querySelectorAll(".vcb-threshold-opt").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await game.settings.set(MODULE_ID, "encounterThreshold", parseInt(btn.dataset.val));
        this._dismissEncounterMenu();
        this.render();
        ui.notifications.info(`Encounter threshold: ${btn.dataset.val}-in-6`);
      });
    });

    // Set table (prompt to drag one onto the bar — for now just notify)
    menu.querySelector('[data-enc="setTable"]')?.addEventListener("click", () => {
      this._dismissEncounterMenu();
      ui.notifications.info("Drag a RollTable onto the Encounter button to set it.");
    });

    // Clear table
    menu.querySelector('[data-enc="clearTable"]')?.addEventListener("click", async () => {
      this._dismissEncounterMenu();
      await game.settings.set(MODULE_ID, "encounterTableUuid", "");
      this.render();
      ui.notifications.info("Encounter table cleared.");
    });


    _attachDismiss(this, menu, "_encMenu", "_encMenuDismiss");
  },

  _dismissEncounterMenu() {
    _dismiss(this, "_encMenu", "_encMenuDismiss");
  },

  // ── Forge & Loot toolbar (left-click) ────────────────────────────────────

  _showForgeToolbar(ev) {
    this._dismissForgeToolbar();

    const panel = document.createElement("div");
    panel.className = "vcb-forge-panel";

    panel.innerHTML = `
      <div class="vcb-forge-panel-header">Forge & Loot</div>
      <div class="vcb-forge-panel-tabs">
        <button class="vcb-forge-tab" data-tool="forge">
          <i class="fas fa-hammer"></i> Relic Forge
        </button>
        <button class="vcb-forge-tab" data-tool="scrollForge">
          <i class="fas fa-scroll"></i> Scroll Forge
        </button>
        <button class="vcb-forge-tab" data-tool="lootManager">
          <i class="fas fa-treasure-chest"></i> Loot Manager
        </button>
        <button class="vcb-forge-tab" data-tool="sessionRecap">
          <i class="fas fa-clipboard-list"></i> Session Recap
        </button>
        <button class="vcb-forge-tab" data-tool="lootGenerator">
          <i class="fas fa-dice-d20"></i> Loot Generator
        </button>
        <button class="vcb-forge-tab" data-tool="merchantShop">
          <i class="fas fa-shop"></i> Merchant Shop
        </button>
        <button class="vcb-forge-tab" data-tool="partyInventory">
          <i class="fas fa-users"></i> Party Inventory
        </button>
        <button class="vcb-forge-tab" data-tool="animationFx">
          <i class="fas fa-film"></i> Animation FX
        </button>
      </div>
    `;

    const btn = ev.currentTarget ?? ev.target;
    _positionMenu(panel, ev);

    // Click handlers
    const open = (tool, fn) => {
      panel.querySelector(`[data-tool="${tool}"]`).addEventListener("click", () => {
        this._dismissForgeToolbar(); fn();
      });
    };
    open("forge",         () => RelicForge.open());
    open("scrollForge",   () => ScrollForge.open());
    open("lootManager",   () => LootManager.open());
    open("sessionRecap",  () => SessionRecap.open());
    open("lootGenerator", () => LootGenerator.open());
    open("merchantShop",  () => MerchantShop.open());
    open("partyInventory",() => PartyInventory.open());
    open("animationFx",   () => AnimationFx.open());

    _attachDismiss(this, panel, "_forgeToolbar", "_forgeToolbarDismiss", btn);
  },

  _dismissForgeToolbar() {
    _dismiss(this, "_forgeToolbar", "_forgeToolbarDismiss");
  },

  // ── Forge & Loot context menu (right-click) ─────────────────────────────

  _showForgeLootMenu(ev) {
    this._dismissForgeLootMenu();

    const lootEnabled = game.settings.get(MODULE_ID, "lootDropEnabled");
    const lootChance = game.settings.get(MODULE_ID, "lootDropChance");
    const itemDropsEnabled = game.settings.get(MODULE_ID, "itemDropsEnabled");

    const menu = document.createElement("div");
    menu.className = "vcb-clock-menu";

    menu.innerHTML = `
      <div class="vcb-clock-menu-item" data-fl="forge">
        <i class="fas fa-hammer"></i> Open Relic Forge
      </div>
      <div class="vcb-clock-menu-item" data-fl="scrollForge">
        <i class="fas fa-scroll"></i> Open Scroll Forge
      </div>
      <div class="vcb-clock-menu-item" data-fl="lootManager">
        <i class="fas fa-treasure-chest"></i> Open Loot Manager
      </div>
      <div class="vcb-clock-menu-item" data-fl="sessionRecap">
        <i class="fas fa-clipboard-list"></i> Session Recap
      </div>
      <div class="vcb-clock-menu-item" data-fl="lootGenerator">
        <i class="fas fa-dice-d20"></i> Loot Generator
      </div>
      <div class="vcb-clock-menu-item" data-fl="merchantShop">
        <i class="fas fa-shop"></i> Merchant Shop
      </div>
      <div class="vcb-clock-menu-item" data-fl="partyInventory">
        <i class="fas fa-users"></i> Party Inventory
      </div>
      <div class="vcb-clock-menu-item" data-fl="animationFx">
        <i class="fas fa-film"></i> Animation FX
      </div>
      <div class="vcb-enc-menu-divider"></div>
      <div class="vcb-clock-menu-item" data-fl="toggleLoot">
        <i class="fas fa-${lootEnabled ? "toggle-on" : "toggle-off"}" style="color:${lootEnabled ? "#4caf50" : "#888"};"></i>
        Loot Drops: ${lootEnabled ? "ON" : "OFF"}
      </div>
      ${lootEnabled ? `
      <div class="vcb-enc-menu-section">
        <div style="padding:4px 8px; color:#aaa; font-size:0.8em;">Drop Chance: ${lootChance}%</div>
        <input type="range" class="vcb-loot-chance-slider" min="0" max="100" value="${lootChance}"
               style="width:calc(100% - 16px); margin:2px 8px;">
      </div>
      ` : ""}
      <div class="vcb-enc-menu-divider"></div>
      <div class="vcb-clock-menu-item" data-fl="toggleItemDrops">
        <i class="fas fa-${itemDropsEnabled ? "toggle-on" : "toggle-off"}" style="color:${itemDropsEnabled ? "#4caf50" : "#888"};"></i>
        Item Drops: ${itemDropsEnabled ? "ON" : "OFF"}
      </div>
    `;

    _positionMenu(menu, ev);

    // Open Relic Forge
    menu.querySelector('[data-fl="forge"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      RelicForge.open();
    });

    // Open Scroll Forge
    menu.querySelector('[data-fl="scrollForge"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      ScrollForge.open();
    });

    // Open Loot Manager
    menu.querySelector('[data-fl="lootManager"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      LootManager.open();
    });

    // Session Recap
    menu.querySelector('[data-fl="sessionRecap"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      SessionRecap.open();
    });

    // Loot Generator
    menu.querySelector('[data-fl="lootGenerator"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      LootGenerator.open();
    });

    // Merchant Shop
    menu.querySelector('[data-fl="merchantShop"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      MerchantShop.open();
    });

    // Party Inventory
    menu.querySelector('[data-fl="partyInventory"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      PartyInventory.open();
    });

    // Animation FX
    menu.querySelector('[data-fl="animationFx"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      AnimationFx.open();
    });

    // Toggle loot drops
    menu.querySelector('[data-fl="toggleLoot"]')?.addEventListener("click", async () => {
      await game.settings.set(MODULE_ID, "lootDropEnabled", !lootEnabled);
      this._dismissForgeLootMenu();
      ui.notifications.info(`Loot Drops ${!lootEnabled ? "enabled" : "disabled"}.`);
    });

    // Loot chance slider
    const slider = menu.querySelector(".vcb-loot-chance-slider");
    if (slider) {
      const label = slider.previousElementSibling;
      slider.addEventListener("input", () => {
        if (label) label.textContent = `Drop Chance: ${slider.value}%`;
      });
      slider.addEventListener("change", async () => {
        await game.settings.set(MODULE_ID, "lootDropChance", parseInt(slider.value));
        ui.notifications.info(`Loot drop chance: ${slider.value}%`);
      });
    }

    // Toggle item drops
    menu.querySelector('[data-fl="toggleItemDrops"]')?.addEventListener("click", async () => {
      await game.settings.set(MODULE_ID, "itemDropsEnabled", !itemDropsEnabled);
      this._dismissForgeLootMenu();
      ui.notifications.info(`Item Drops ${!itemDropsEnabled ? "enabled" : "disabled"}.`);
    });

    _attachDismiss(this, menu, "_forgeLootMenu", "_forgeLootDismiss");
  },

  _dismissForgeLootMenu() {
    _dismiss(this, "_forgeLootMenu", "_forgeLootDismiss");
  },

  // ── Token management ─────────────────────────────────────────────────────

  async _addSelectedTokens() {
    const selected = canvas.tokens?.controlled ?? [];
    if (!selected.length) { ui.notifications.warn("Select tokens first."); return; }
    let added = 0;
    const addedTokenDocs = [];
    for (const token of selected) {
      if (!token.actor) continue;
      const type = (token.document ?? token).disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY ? "player" : "npc";
      await CrawlState.addMember({
        id:      `token-${token.id}`,
        name:    token.name,
        img:     token.document.texture?.src ?? token.actor.img,
        type,
        actorId: token.actor.id,
        tokenId: token.id,
      });
      // Reset movement budget and snapshot current position as the rollback
      // origin. Done for both PCs and NPCs so rollback works from the moment
      // a token joins the roster (e.g. mid-combat reinforcements or summons).
      await MovementTracker.resetActor(token.actor, token.document);
      MovementTracker.snapshotPosition(token.id);
      addedTokenDocs.push(token.document);
      added++;
    }

    // If we're in combat, also add the tokens to the encounter tracker — a
    // mid-combat reinforcement or summon needs to be in the turn order, not
    // just the strip. Uses the same API the Start Combat button uses.
    if (added && CrawlState.paused && game.combat) {
      const existingTokenIds = new Set(game.combat.combatants.map(c => c.tokenId));
      const newInCombat = addedTokenDocs.filter(td => !existingTokenIds.has(td.id));
      if (newInCombat.length) {
        await TokenDocument.implementation.createCombatants(newInCombat);
      }
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

    // Collect token documents to add — ALL crawl members (players + NPCs) + selected tokens, deduped
    const existingTokenIds = new Set(combat.combatants.map(c => c.tokenId));

    const tokenDocs = new Map();
    // Add all crawl strip members (players AND NPCs)
    for (const m of CrawlState.members) {
      if (m.type === "gm") continue; // skip GM placeholder
      if (!m.tokenId || existingTokenIds.has(m.tokenId)) continue;
      const token = canvas.tokens?.get(m.tokenId)?.document;
      if (token) tokenDocs.set(m.tokenId, token);
    }
    // Also add any currently selected tokens not already tracked
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
      const type = (token.document ?? token).disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY ? "player" : "npc";
      await CrawlState.addMember({
        id:      memberId,
        name:    token.name,
        img:     token.texture?.src ?? token.actor.img,
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
    try { return fromUuidSync(uuid)?.name ?? null; }
    catch { return null; }
  },
};

// Shared reconciler — keeps the strip in sync with the combat tracker regardless
// of how combatants get added/removed (drop, encounter roller, dead-token cleanup,
// manual add, etc). Called on every combat-related hook so no add/remove can slip
// through a timing gap where CrawlState wasn't yet active.
async function _syncCombatToStrip() {
  if (!game.user.isGM || !CrawlState.active) return;
  const { added, removed } = await CrawlState.syncCombatMembers();
  if (!added.length && !removed.length) return;
  const { CrawlStrip } = await import("./crawl-strip.mjs");
  CrawlStrip.render();
}

// When a combat is created (e.g. right-click Toggle Combat State), auto-pause crawl
Hooks.on("createCombat", async () => {
  if (!game.user.isGM || !CrawlState.active) return;
  if (CrawlState.paused) return; // already in combat mode
  if (CrawlClock.available) await CrawlClock.hide();
  await CrawlState.pause();
  CrawlBar.render();
  await _syncCombatToStrip();
  const { CrawlStrip } = await import("./crawl-strip.mjs");
  CrawlStrip.render();
});

// Re-render bar when combat starts (Begin Encounter from sidebar) so button swaps.
// Also reconcile — if combatants were added before the crawl was active, catch them now.
Hooks.on("combatStart", async () => {
  if (game.user.isGM && CrawlState.paused) CrawlBar.render();
  await _syncCombatToStrip();
});

// Re-render bar on combat turn/round changes (keeps bar in sync with sidebar)
Hooks.on("updateCombat", (combat, changes) => {
  if (game.user.isGM && CrawlState.paused && changes.round !== undefined) CrawlBar.render();
});

// Auto-add any token added to the combat tracker into the crawl strip
Hooks.on("createCombatant", _syncCombatToStrip);

// When a combatant is removed from the tracker (right-click Remove Participant,
// etc.), also drop any matching strip member — strip removal goes first so
// _syncCombatToStrip's Combat←Strip re-push won't immediately re-add heroes.
Hooks.on("deleteCombatant", async (combatant) => {
  if (!game.user.isGM || !CrawlState.active) return;
  if (combatant?.tokenId) {
    const member = CrawlState.members.find(m => m.tokenId === combatant.tokenId);
    // Use the internal splice path — not removeMember — because removeMember
    // cascades back to combat, but this combatant is already being deleted.
    if (member) {
      const idx = CrawlState.members.findIndex(m => m.id === member.id);
      if (idx !== -1) {
        CrawlState._state.members.splice(idx, 1);
        await CrawlState._save();
      }
    }
  }
  await _syncCombatToStrip();
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
  } else {
    // User declined resume — end the crawl entirely
    await CrawlClock.cleanup();
    await CrawlState.end();
    CrawlBar.render();
    (await import("./crawl-strip.mjs")).CrawlStrip.render();
  }
});
