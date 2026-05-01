/**
 * Vagabond Crawler — Crawl Strip
 */

import { MODULE_ID }        from "./vagabond-crawler.mjs";
import { CrawlState }       from "./crawl-state.mjs";
import { buildTabStripHTML, bindNPCMenuEvents } from "./npc-action-menu.mjs";
import { ICONS }            from "./icons.mjs";
import { getEffectiveMovement, MOVEMENT_MODE_ICON } from "./combat-helpers.mjs";

const STRIP_ID = "vagabond-crawler-strip";

export const CrawlStrip = {

  _el:             null,
  _renderQueued:   false,
  _hookIds:        [],
  _resizeListener: null,

  queueRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this.render();
    });
  },

  destroy() {
    if (this._resizeListener) {
      window.removeEventListener("resize", this._resizeListener);
      this._resizeListener = null;
    }
    for (const id of this._hookIds) Hooks.off(id);
    this._hookIds = [];
    this._el?.remove();
    this._el = null;
  },

  mount() {
    if (document.getElementById(STRIP_ID)) return;
    const strip = document.createElement("div");
    strip.id = STRIP_ID;
    strip.classList.add("vagabond-crawler-strip");

    // Mount into #interface so we can push left past #ui-top's left edge
    const iface = document.getElementById("interface");
    if (iface) {
      iface.prepend(strip);
    } else {
      document.getElementById("ui-top")?.prepend(strip);
    }
    this._el = strip;
    this.render();

    const updateBounds = () => {
      if (!this._el) return;
      const sceneNav = document.getElementById("scene-navigation");
      const sidebar  = document.getElementById("sidebar");
      const iface    = document.getElementById("interface");
      if (!iface) return;

      const ifaceRect = iface.getBoundingClientRect();
      const leftEdge  = sceneNav
        ? sceneNav.getBoundingClientRect().right - ifaceRect.left
        : 0;
      const rightEdge = sidebar
        ? sidebar.getBoundingClientRect().left - ifaceRect.left
        : ifaceRect.width;

      this._el.style.left  = leftEdge + "px";
      this._el.style.width = (rightEdge - leftEdge) + "px";
      this._sizeCards();
    };
    this._resizeListener = updateBounds;
    window.addEventListener("resize", updateBounds);
    this._hookIds.push(Hooks.on("collapseSidebar", () => setTimeout(updateBounds, 350)));
    this._hookIds.push(Hooks.on("renderSidebar",   () => setTimeout(updateBounds, 350)));
    updateBounds();
  },

  render() {
    if (!this._el) return;
    const state = CrawlState;

    if (!state.active) {
      this._el.innerHTML = "";
      this._el.classList.remove("vcs-visible");
      document.body.classList.remove("vcs-active");
      return;
    }

    this._el.classList.add("vcs-visible");
    document.body.classList.toggle("vcs-paused", state.paused);

    const isHeroes   = state.isHeroesPhase;
    const inCombat   = state.paused;
    const hideNames  = game.settings.get(MODULE_ID, "hideNpcNames") && !game.user.isGM;
    const hideNpcHp  = game.settings.get(MODULE_ID, "hideNpcHpBar") && !game.user.isGM;
    const autoRemove = game.settings.get(MODULE_ID, "autoRemoveDefeated");

    // Build combatant lookup map once instead of repeated .find() calls
    const combatantMap = new Map(
      (game.combat?.combatants ?? []).map(c => [c.tokenId, c])
    );

    // During combat: heroes = players only, npcs = npc type only (no GM)
    // During crawl:  heroes = players, npcs = gm only
    let heroes, npcs;
    if (inCombat) {
      // Sort members to match combat tracker turn order
      const turns = game.combat?.turns ?? [];
      const turnOrder = new Map(turns.map((c, i) => [c.tokenId, i]));
      const sortByTurn = (a, b) => {
        const ai = turnOrder.has(a.tokenId) ? turnOrder.get(a.tokenId) : 999;
        const bi = turnOrder.has(b.tokenId) ? turnOrder.get(b.tokenId) : 999;
        return ai - bi;
      };
      heroes = state.members.filter(m => m.type === "player").sort(sortByTurn);
      npcs   = state.members.filter(m => m.type === "npc").sort(sortByTurn);
    } else {
      heroes = state.members.filter(m => m.type === "player");
      npcs   = state.members.filter(m => m.type === "gm");
    }

    // Check if all heroes have acted — if so, swap layout (NPCs on left)
    const allHeroesActed = inCombat && heroes.length > 0 && heroes.every(m => {
      const c = combatantMap.get(m.tokenId);
      return c?.flags?.vagabond?.activations?.value === 0;
    });

    const makeCard = (m) => {
      // For NPC tokens, read from the token's synthetic actor (unlinked tokens
      // store HP on the token, not the base actor)
      let actor = null;
      let tokenDoc = null;
      if (m.tokenId) {
        const token = canvas.tokens?.get(m.tokenId);
        actor = token?.actor ?? (m.actorId ? game.actors.get(m.actorId) : null);
        tokenDoc = token?.document ?? null;
      } else if (m.actorId) {
        actor = game.actors.get(m.actorId);
      }
      const data  = actor ? this._extractData(actor, inCombat, tokenDoc) : null;
      const isCurrent  = !!m.tokenId && game.combat?.combatant?.tokenId === m.tokenId;
      const combatant  = combatantMap.get(m.tokenId);
      const isDefeated = combatant?.defeated ?? false;

      // Skip defeated if auto-remove enabled
      if (isDefeated && autoRemove) return "";

      // Visibility rules:
      //   • Hidden in BOTH tracker and scene → drop the card for everyone
      //     (GM is already tracking them on the canvas and tracker; no need
      //     for a strip duplicate of an enemy the party hasn't spotted).
      //   • Hidden on only one side → only hide from non-GM players; GM
      //     keeps the card so the partial-hidden state stays visible.
      const combatantHidden = combatant?.hidden === true;
      const tokenHidden     = tokenDoc?.hidden === true;
      if (combatantHidden && tokenHidden) return "";
      if ((combatantHidden || tokenHidden) && !game.user.isGM) return "";

      const activations  = combatant?.flags?.vagabond?.activations;
      const hasActed     = activations ? activations.value === 0 : false;

      const isActivePhase = inCombat
        ? !hasActed
        : (m.type === "player" ? isHeroes : !isHeroes);

      const displayName = (m.type === "npc" && hideNames) ? "" : m.name;
      const isNpcMember = m.type === "npc" || m.type === "gm";
      const hideHpBar   = isNpcMember && hideNpcHp;

      const hpPct   = data && data.hpMax > 0 ? Math.max(0, Math.min(100, Math.round((data.hp / data.hpMax) * 100))) : 0;
      const hpClass = !data || data.hp <= 0     ? "vcs-hp-dead"
        : data.hp <= data.hpMax * 0.25          ? "vcs-hp-critical"
        : data.hp <= data.hpMax * 0.50          ? "vcs-hp-low"
        : data.hp <= data.hpMax * 0.75          ? "vcs-hp-mid"
        : "vcs-hp-ok";
      const luckClass = data?.luck === 0 ? "vcs-pill-empty" : "";
      const moveClass = data?.moveExhausted ? "vcs-pill-empty" : "";

      // Pills:
      //   - PCs: luck + movement (always)
      //   - NPCs in combat: movement-only, hidden when hideHpBar is on
      //     (follows the "Hide NPC Health Bar from Players" setting; GM always sees)
      //   - GM-member cards and NPCs out of combat: no pill
      // Movement pill icon reflects the active mode (walk/fly/swim/climb/phase/cling);
      // resolved by getEffectiveMovement in _extractData and exposed on `data.movementMode`.
      const moveIcon = data ? (ICONS[MOVEMENT_MODE_ICON[data.movementMode] ?? "walking"] ?? ICONS.walking) : ICONS.walking;
      let pills = "";
      if (data) {
        if (m.type !== "npc" && m.type !== "gm") {
          pills = `
        <div class="vcs-pills">
          <div class="vcs-pill ${luckClass}">${ICONS.shamrock}${data.luck}</div>
          <div class="vcs-pill ${moveClass}">${moveIcon}${data.moveRemaining}/${data.activeSpeed}ft</div>
        </div>`;
        } else if (m.type === "npc" && inCombat && !hideHpBar) {
          pills = `
        <div class="vcs-pills">
          <div class="vcs-pill ${moveClass}">${moveIcon}${data.moveRemaining}/${data.activeSpeed}ft</div>
        </div>`;
        }
      }

      // Active effects row — only status conditions (effects with a non-empty statuses set)
      let effectsRow = "";
      if (actor) {
        const activeEffects = actor.effects.filter(e => !e.disabled && e.statuses?.size > 0);
        if (activeEffects.length) {
          const icons = activeEffects.map(e => {
            const icon = e.img || "icons/svg/aura.svg";
            const label = e.name || "Effect";
            const durationInfo = e.duration?.rounds
              ? ` (${e.duration.rounds}R)`
              : "";
            return `<img class="vcs-effect-icon" src="${icon}" title="${label}${durationInfo}" alt="${label}" width="18" height="18" />`;
          }).join("");
          effectsRow = `<div class="vcs-effects-row">${icons}</div>`;
        }
      }

      // Action menu tab strip — only during combat, below the card
      const isNPC = actor?.type === "npc" || m.type === "gm";
      const showMenu = inCombat && actor?.isOwner;
      const tabStrip = showMenu ? buildTabStripHTML(actor, isNPC) : "";
      const hasMenu  = showMenu && !!tabStrip;

      const cardHTML = `
        <div class="vcs-member ${isActivePhase ? "vcs-active" : "vcs-dim"} ${isCurrent ? "vcs-is-turn" : ""} ${isDefeated ? "vcs-defeated" : ""} vcs-type-${m.type}"
             data-member-id="${m.id}" data-token-id="${m.tokenId ?? ""}">
          <img class="vcs-portrait" src="${m.img}" alt="${m.name}" />
          <div class="vcs-overlay">
            ${displayName ? `<div class="vcs-name">${displayName}</div>` : ""}
            ${effectsRow}
            <div class="vcs-bottom">
              ${hideHpBar ? "" : `
              <div class="vcs-hp-bar-wrap">
                <div class="vcs-hp-bar ${hpClass}" style="width:${hpPct}%"></div>
                <span class="vcs-hp-label">${data ? `${data.hp}/${data.hpMax}` : ""}</span>
              </div>`}
              ${pills}
            </div>
          </div>
          ${isCurrent ? `<div class="vcs-turn-badge">${ICONS.turnArrow}</div>` : ""}
          ${isDefeated ? `<div class="vcs-defeated-icon">${ICONS.skull}</div>` : ""}
          ${m.type === "gm" ? ICONS.gmCrown : ""}
          ${game.user.isGM ? `<button class="vcs-remove" data-id="${m.id}" title="Remove ${m.name}" aria-label="Remove ${m.name}">×</button>` : ""}
          ${inCombat && combatant && game.user.isGM ? `<button class="vcs-activate-btn ${isCurrent ? "vcs-activate-active" : ""}" data-combatant-id="${combatant.id}" data-action="${isCurrent ? "deactivate" : "activate"}" title="${isCurrent ? "End Turn" : "Activate Turn"}" aria-label="${isCurrent ? `End ${m.name}'s turn` : `Activate ${m.name}'s turn`}">${isCurrent ? ICONS.deactivate : ICONS.activate}</button>` : ""}
        </div>`;

      // Wrap card + tab strip together so hover works across both
      return `<div class="vcs-card-wrap ${hasMenu ? "" : ""}"
                   ${hasMenu ? `data-has-menu data-actor-id="${actor.id}" data-is-npc="${isNPC ? 1 : 0}"` : ""}>
        ${cardHTML}
        ${tabStrip}
      </div>`;
    };

    const heroCards = heroes.map(makeCard).join("");
    const npcCards  = npcs.map(makeCard).join("");

    // Left badge: combat controls when in combat, crawl round otherwise
    const leftBadge = inCombat ? `
      <div class="vcs-combat-controls">
        <button class="vcs-cbtn" data-combat="prevRound" title="Previous Round">${ICONS.prevRound}</button>
        <button class="vcs-cbtn" data-combat="prevTurn"  title="Previous Turn">${ICONS.prevRound}</button>
        <div class="vcs-round-num">R${game.combat?.round ?? 1}</div>
        <button class="vcs-cbtn" data-combat="nextTurn"  title="Next Turn">${ICONS.nextRound}</button>
        <button class="vcs-cbtn" data-combat="nextRound" title="Next Round">${ICONS.nextRound}</button>
      </div>` : `<div class="vcs-turn-num">${state.turnCount}</div>`;

    // Swap sides when all heroes have acted
    const leftGroup  = allHeroesActed ? "vcs-group-npcs"   : "vcs-group-heroes";
    const rightGroup = allHeroesActed ? "vcs-group-heroes"  : "vcs-group-npcs";
    const leftLabel  = allHeroesActed ? "NPCS"              : "HEROES";
    const rightLabel = allHeroesActed ? "HEROES"            : "NPCS";
    const leftCards  = allHeroesActed ? npcCards            : heroCards;
    const rightCards = allHeroesActed ? heroCards           : npcCards;
    const leftClass  = allHeroesActed ? "vcs-label-npcs"    : "vcs-label-heroes";
    const rightClass = allHeroesActed ? "vcs-label-heroes"  : "vcs-label-npcs";

    // Tools badge — visible to everyone when shop is available to
    // players. Provides an opt-in entry point so the GM can leave the
    // shop "open" without forcing a window on every player.
    const shopAvailable = game.settings.get(MODULE_ID, "shopAvailableToPlayers");
    const shopName = game.settings.get(MODULE_ID, "shopName") || "Merchant";
    const toolsBadge = shopAvailable ? `
      <div class="vcs-tools">
        <button class="vcs-tool-btn vcs-tool-shop" type="button"
                title="Open ${shopName}" aria-label="Open ${shopName}">
          <i class="fas fa-store"></i>
        </button>
      </div>` : "";

    this._el.innerHTML = `
      <div class="vcs-inner ${inCombat ? "vcs-paused" : ""}">
        ${toolsBadge}
        ${leftBadge}
        <div class="vcs-group ${leftGroup}">
          <div class="vcs-group-label ${leftClass}">${leftLabel}</div>
          <div class="vcs-members">${leftCards || '<span class="vcs-empty">—</span>'}</div>
        </div>
        <div class="vcs-group ${rightGroup}">
          <div class="vcs-group-label ${rightClass}">${rightLabel}</div>
          <div class="vcs-members">${rightCards || '<span class="vcs-empty">—</span>'}</div>
        </div>
      </div>`;

    this._bindEvents();
    this._sizeCards();
    requestAnimationFrame(() => {
      if (!this._el) return;
      const h = this._el.getBoundingClientRect().height ?? 0;
      if (h > 0) document.documentElement.style.setProperty("--vcs-strip-height", Math.ceil(h) + "px");
    });
  },

  _sizeCards() {
    if (!this._el) return;
    const available = this._el.getBoundingClientRect().width;
    if (available < 10) return;

    const cards = this._el.querySelectorAll(".vcs-member");
    if (!cards.length) return;

    const n      = cards.length;
    const gap    = 2;
    const reserved = 36 + 16 + 16 + 32;
    const maxW   = 110;
    const maxH   = 130;

    const idealW = (available - reserved - gap * (n - 1)) / n;
    const cardW  = Math.min(maxW, Math.max(36, Math.floor(idealW)));
    const cardH  = Math.round(cardW * (maxH / maxW));

    cards.forEach(c => {
      c.style.width  = cardW + "px";
      c.style.height = cardH + "px";
    });
  },

  _extractData(actor, inCombat = false, tokenDoc = null) {
    const s           = actor.system;
    // Combat: effective-mode speed (walk / fly / swim / climb / phase / cling).
    //   Fastest available mode by default; GM override via tokenDoc.movementAction.
    // Crawl: exploration speed (per-minute overland pace, no fly shenanigans).
    let activeSpeed, movementMode;
    if (inCombat) {
      const eff   = getEffectiveMovement(actor, tokenDoc);
      activeSpeed = eff.speed;
      movementMode = eff.mode;
    } else {
      let crawl = typeof s.speed === "object" ? (s.speed?.crawl ?? 0) : (s.crawl ?? 0);
      // Friendly NPCs (summons, familiars, hirelings, beast companions) don't
      // carry a crawl-speed field — default to base × 3 so they keep up with
      // the party on the overland/dungeon pace. Matches _getBaseSpeed in
      // movement-tracker.mjs so display and enforcement agree.
      if (crawl === 0 && actor.type === "npc") {
        const disp = tokenDoc?.disposition ?? actor.prototypeToken?.disposition;
        if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
          const base = typeof s.speed === "number" ? s.speed : 0;
          crawl = base * 3;
        }
      }
      activeSpeed = crawl;
      movementMode = "walk";
    }
    const rawRemaining  = actor.getFlag(MODULE_ID, "moveRemaining") ?? activeSpeed;
    const moveRemaining = Math.round(rawRemaining / 5) * 5;
    return {
      hp:           s.health?.value ?? 0,
      hpMax:        s.health?.max   ?? 0,
      hpLow:        (s.health?.value ?? 0) <= Math.ceil((s.health?.max ?? 1) / 4),
      luck:         s.currentLuck ?? 0,
      activeSpeed,
      moveRemaining,
      movementMode,
      moveExhausted: moveRemaining <= 0,
    };
  },

  _bindEvents() {
    if (!this._el) return;
    this._el.querySelectorAll(".vcs-member").forEach(card => {
      card.addEventListener("dblclick", async (ev) => {
        if (ev.target.closest(".vcs-remove")) return;
        if (ev.target.closest(".vcs-action-menu")) return;
        if (ev.target.closest(".vcs-activate-btn")) return;
        const tokenId = card.dataset.tokenId;
        const token = tokenId ? canvas.tokens?.get(tokenId) : null;
        const actor = token?.actor
          ?? (card.dataset.memberId ? game.actors.get(CrawlState.members.find(m => m.id === card.dataset.memberId)?.actorId) : null);
        if (actor) actor.sheet.render(true);
      });
      card.addEventListener("click", async (ev) => {
        if (ev.target.closest(".vcs-remove")) return;
        if (ev.target.closest(".vcs-action-menu")) return;
        if (ev.target.closest(".vcs-activate-btn")) return;
        const tokenId = card.dataset.tokenId;
        if (!tokenId) return;
        const token = canvas.tokens?.get(tokenId);
        if (!token) return;
        token.control({ releaseOthers: !ev.shiftKey });
        await canvas.animatePan({ x: token.center.x, y: token.center.y,
          scale: Math.max(canvas.stage.scale.x, 0.5) });
      });
    });
    bindNPCMenuEvents(this._el);

    // Tool buttons (shop, etc.) — bound for everyone before the GM gate
    // since players are the primary audience for the merchant shortcut.
    this._el.querySelector(".vcs-tool-shop")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      game.vagabondCrawler?.merchantShop?.openLocally?.();
    });

    if (!game.user.isGM) return;

    // Combat control buttons (prev/next round/turn, end encounter)
    this._el.querySelectorAll(".vcs-cbtn").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const action = btn.dataset.combat;
        const combat = game.combat;
        if (!combat) return;
        if      (action === "nextTurn")   await combat.nextTurn();
        else if (action === "prevTurn")   await combat.previousTurn();
        else if (action === "nextRound")  await combat.nextRound();
        else if (action === "prevRound")  await combat.previousRound();
        else if (action === "endCombat")  await combat.endCombat();
      });
    });

    // Activate / end turn buttons — click the real combat tracker button
    this._el.querySelectorAll(".vcs-activate-btn").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const combatantId = btn.dataset.combatantId;
        const action      = btn.dataset.action;
        // Find the matching button in the combat tracker and click it
        const trackerBtn = document.querySelector(
          `.combatant[data-combatant-id="${combatantId}"] .combatant-control[data-action="${action}"]`
        );
        if (trackerBtn) {
          trackerBtn.click();
        } else {
          // Fallback: manipulate flags directly
          const combatant = game.combat?.combatants.get(combatantId);
          if (!combatant) return;
          const activations = combatant.flags?.vagabond?.activations;
          if (!activations) return;
          if (action === "activate") {
            await combatant.setFlag("vagabond", "activations", { ...activations, value: Math.max(0, activations.value - 1) });
          } else {
            await combatant.setFlag("vagabond", "activations", { ...activations, value: activations.max ?? 1 });
          }
        }
      });
    });

    this._el.querySelectorAll(".vcs-remove").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        await CrawlState.removeMember(btn.dataset.id);
        this.render();
      });
    });
  },

  updateMember(actorId) {
    if (CrawlState.active) this.queueRender();
  },
};

// Re-render on actor changes
Hooks.on("updateActor", async (actor) => {
  if (!CrawlState.active) return;
  CrawlStrip.updateMember(actor.id);
  // Auto-defeat at 0 HP — use token ID for unlinked, actor ID for linked
  if (game.user.isGM && game.combat) {
    const hp = actor.system?.health?.value ?? null;
    if (hp !== null && hp <= 0) {
      const tokenId = actor.token?.id;
      const combatant = tokenId
        ? game.combat.combatants.find(c => c.tokenId === tokenId && !c.defeated)
        : game.combat.combatants.find(c => c.actorId === actor.id && !c.defeated);
      if (combatant) {
        try {
          await combatant.update({ defeated: true });
        } catch (err) {
          console.warn(`vagabond-crawler | auto-defeat update failed for ${actor.name}:`, err);
        }
        const tokenObj = canvas.tokens?.get(combatant.tokenId);
        if (tokenObj?.actor) {
          // Wrap toggleStatusEffect — if the token's UUID is stale (deleted,
          // cross-scene, or the system's own updateActor hook already tried
          // this and failed), the ActiveEffect create can throw on parent
          // resolution. We don't want it to crash the whole hook.
          try {
            await tokenObj.actor.toggleStatusEffect("dead", { active: true, overlay: true });
          } catch (err) {
            console.warn(`vagabond-crawler | dead-status toggle failed for ${actor.name}:`, err);
          }
        }
      }
    }
  }
});

// Catch HP/hidden changes on tokens (unlinked NPC HP + visibility sync)
Hooks.on("updateToken", async (tokenDoc, changes) => {
  if (!CrawlState.active) return;
  const hpChanged     = changes.actorData || changes.delta || changes.system;
  const hiddenChanged = "hidden" in changes;
  if (!hpChanged && !hiddenChanged) return;
  CrawlStrip.queueRender();

  // Sync token.hidden → combatant.hidden so the tracker's eye icon matches
  // the token's visibility state. Guard: only act if they actually differ
  // (prevents loops with the reverse updateCombatant sync below).
  if (hiddenChanged && game.user.isGM && game.combat) {
    const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
    if (combatant && combatant.hidden !== changes.hidden) {
      await combatant.update({ hidden: changes.hidden });
    }
  }

  // Auto-defeat unlinked tokens at 0 HP
  if (hpChanged && game.user.isGM && game.combat) {
    const hp = tokenDoc.actor?.system?.health?.value ?? null;
    if (hp !== null && hp <= 0) {
      const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id && !c.defeated);
      if (combatant) {
        try {
          await combatant.update({ defeated: true });
        } catch (err) {
          console.warn(`vagabond-crawler | auto-defeat update failed for ${tokenDoc.name}:`, err);
        }
        // Apply dead overlay — must use the token document's actor for unlinked tokens
        const tokenObj = canvas.tokens?.get(combatant.tokenId);
        if (tokenObj?.actor) {
          try {
            await tokenObj.actor.toggleStatusEffect("dead", { active: true, overlay: true });
          } catch (err) {
            console.warn(`vagabond-crawler | dead-status toggle failed for ${tokenDoc.name}:`, err);
          }
        }
      }
    }
  }
});

// Clean up strip members when their underlying token is deleted from ANY
// scene — prevents orphans from summons despawning, tokens being manually
// removed, or scene-switch churn. Runs regardless of combat state since the
// stale entry causes create errors whenever a sync next runs.
Hooks.on("deleteToken", async (tokenDoc) => {
  if (!game.user.isGM || !CrawlState.active) return;
  const memberId = `token-${tokenDoc.id}`;
  const idx = CrawlState.members.findIndex(m => m.id === memberId);
  if (idx === -1) return;
  CrawlState._state.members.splice(idx, 1);
  await CrawlState._save();
  CrawlStrip.queueRender();
});

// Sync combatant.hidden → token.hidden for the reverse direction (e.g. the GM
// toggles hidden in the combat tracker; the canvas token should update too).
Hooks.on("updateCombatant", async (combatant, changes) => {
  if (!game.user.isGM) return;
  if (!("hidden" in changes)) return;
  const tokenDoc = combatant.token;
  if (!tokenDoc) return;
  if (tokenDoc.hidden === changes.hidden) return;  // already in sync
  await tokenDoc.update({ hidden: changes.hidden });
});

Hooks.on("updateItem", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("updateCombatant", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("updateCombat", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("createActiveEffect", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("deleteActiveEffect", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("updateActiveEffect", () => { if (CrawlState.active) CrawlStrip.queueRender(); });

