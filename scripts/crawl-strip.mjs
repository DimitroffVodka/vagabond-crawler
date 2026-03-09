/**
 * Vagabond Crawler — Crawl Strip
 */

import { MODULE_ID }        from "./vagabond-crawler.mjs";
import { CrawlState }       from "./crawl-state.mjs";
import { buildTabStripHTML, bindNPCMenuEvents } from "./npc-action-menu.mjs";
import { ICONS }            from "./icons.mjs";

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
    const hideNames  = game.settings.get(MODULE_ID, "hideNpcNames");
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
      if (m.tokenId) {
        const token = canvas.tokens?.get(m.tokenId);
        actor = token?.actor ?? (m.actorId ? game.actors.get(m.actorId) : null);
      } else if (m.actorId) {
        actor = game.actors.get(m.actorId);
      }
      const data  = actor ? this._extractData(actor, inCombat) : null;
      const isCurrent  = !!m.tokenId && game.combat?.combatant?.tokenId === m.tokenId;
      const combatant  = combatantMap.get(m.tokenId);
      const isDefeated = combatant?.defeated ?? false;

      // Skip defeated if auto-remove enabled
      if (isDefeated && autoRemove) return "";

      const activations  = combatant?.flags?.vagabond?.activations;
      const hasActed     = activations ? activations.value === 0 : false;

      const isActivePhase = inCombat
        ? !hasActed
        : (m.type === "player" ? isHeroes : !isHeroes);

      const displayName = (m.type === "npc" && hideNames) ? "" : m.name;

      const hpPct   = data && data.hpMax > 0 ? Math.max(0, Math.min(100, Math.round((data.hp / data.hpMax) * 100))) : 0;
      const hpClass = !data || data.hp <= 0     ? "vcs-hp-dead"
        : data.hp <= data.hpMax * 0.25          ? "vcs-hp-critical"
        : data.hp <= data.hpMax * 0.50          ? "vcs-hp-low"
        : data.hp <= data.hpMax * 0.75          ? "vcs-hp-mid"
        : "vcs-hp-ok";
      const luckClass = data?.luck === 0 ? "vcs-pill-empty" : "";
      const moveClass = data?.moveExhausted ? "vcs-pill-empty" : "";

      const pills = (data && m.type !== "npc" && m.type !== "gm") ? `
        <div class="vcs-pills">
          <div class="vcs-pill ${luckClass}">${ICONS.shamrock}${data.luck}</div>
          <div class="vcs-pill ${moveClass}">${ICONS.walking}${data.moveRemaining}/${data.activeSpeed}ft</div>
        </div>` : "";

      // Action menu tab strip — only during combat, below the card
      const isNPC = m.type === "npc" || m.type === "gm";
      const showMenu = inCombat
        && actor?.isOwner
        && game.settings.get(MODULE_ID, "npcActionMenu");
      const tabStrip = showMenu ? buildTabStripHTML(actor, isNPC) : "";
      const hasMenu  = showMenu && !!tabStrip;

      const cardHTML = `
        <div class="vcs-member ${isActivePhase ? "vcs-active" : "vcs-dim"} ${isCurrent ? "vcs-is-turn" : ""} ${isDefeated ? "vcs-defeated" : ""} vcs-type-${m.type}"
             data-member-id="${m.id}" data-token-id="${m.tokenId ?? ""}">
          <img class="vcs-portrait" src="${m.img}" alt="${m.name}" />
          <div class="vcs-overlay">
            ${displayName ? `<div class="vcs-name">${displayName}</div>` : ""}
            <div class="vcs-bottom">
              <div class="vcs-hp-bar-wrap">
                <div class="vcs-hp-bar ${hpClass}" style="width:${hpPct}%"></div>
                <span class="vcs-hp-label">${data ? `${data.hp}/${data.hpMax}` : ""}</span>
              </div>
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

    this._el.innerHTML = `
      <div class="vcs-inner ${inCombat ? "vcs-paused" : ""}">
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
      const h = this._el?.getBoundingClientRect().height ?? 0;
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

  _extractData(actor, inCombat = false) {
    const s           = actor.system;
    const combatSpeed = s.speed?.base ?? 0;  // base move (Rush extends beyond)
    const crawlSpeed  = s.speed?.crawl ?? 0;
    const activeSpeed = inCombat ? combatSpeed : crawlSpeed;
    const rawRemaining  = actor.getFlag(MODULE_ID, "moveRemaining") ?? activeSpeed;
    const moveRemaining = Math.round(rawRemaining / 5) * 5;
    return {
      hp:           s.health?.value ?? 0,
      hpMax:        s.health?.max   ?? 0,
      hpLow:        (s.health?.value ?? 0) <= Math.ceil((s.health?.max ?? 1) / 4),
      luck:         s.currentLuck ?? 0,
      activeSpeed,
      moveRemaining,
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
  // Auto-defeat linked actors at 0 HP
  if (game.user.isGM && game.combat) {
    const hp = actor.system?.health?.value ?? null;
    if (hp !== null && hp <= 0) {
      const combatant = game.combat.combatants.find(c => c.actorId === actor.id && !c.defeated);
      if (combatant) {
        await combatant.update({ defeated: true });
        // Apply dead overlay — must use the token document's actor for unlinked tokens
        const tokenObj = canvas.tokens?.get(combatant.tokenId);
        if (tokenObj?.actor) {
          await tokenObj.actor.toggleStatusEffect("dead", { active: true, overlay: true });
        }
      }
    }
  }
});

// Catch HP changes on unlinked tokens (synthetic actors — NPCs in combat)
Hooks.on("updateToken", async (tokenDoc, changes) => {
  if (!CrawlState.active) return;
  if (!changes.actorData && !changes.delta && !changes.system) return;
  CrawlStrip.queueRender();
  // Auto-defeat unlinked tokens at 0 HP
  if (game.user.isGM && game.combat) {
    const hp = tokenDoc.actor?.system?.health?.value ?? null;
    if (hp !== null && hp <= 0) {
      const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id && !c.defeated);
      if (combatant) {
        await combatant.update({ defeated: true });
        // Apply dead overlay — must use the token document's actor for unlinked tokens
        const tokenObj = canvas.tokens?.get(combatant.tokenId);
        if (tokenObj?.actor) {
          await tokenObj.actor.toggleStatusEffect("dead", { active: true, overlay: true });
        }
      }
    }
  }
});

Hooks.on("updateItem", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("updateCombatant", () => { if (CrawlState.active) CrawlStrip.queueRender(); });
Hooks.on("updateCombat", () => { if (CrawlState.active) CrawlStrip.queueRender(); });

