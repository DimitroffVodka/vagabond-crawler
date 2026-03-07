/**
 * Vagabond Crawler — Crawl Strip
 */

import { MODULE_ID }  from "./vagabond-crawler.mjs";
import { CrawlState } from "./crawl-state.mjs";

const STRIP_ID = "vagabond-crawler-strip";

export const CrawlStrip = {

  _el: null,

  mount() {
    if (document.getElementById(STRIP_ID)) return;
    const strip = document.createElement("div");
    strip.id = STRIP_ID;
    strip.classList.add("vagabond-crawler-strip");
    const uiTop = document.getElementById("ui-top");
    uiTop
      ? uiTop.parentNode.insertBefore(strip, uiTop)
      : document.getElementById("interface")?.prepend(strip);
    this._el = strip;
    this.render();
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

    // During combat: heroes = players only, npcs = npc type only (no GM)
    // During crawl:  heroes = players, npcs = gm only
    let heroes, npcs;
    if (inCombat) {
      heroes = state.members.filter(m => m.type === "player");
      npcs   = state.members.filter(m => m.type === "npc");
    } else {
      heroes = state.members.filter(m => m.type === "player");
      npcs   = state.members.filter(m => m.type === "gm");
    }

    // Check if all heroes have acted — if so, swap layout (NPCs on left)
    const allHeroesActed = inCombat && heroes.length > 0 && heroes.every(m => {
      const c = game.combat?.combatants.find(cb => cb.tokenId === m.tokenId);
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
      const isCurrent    = !!m.tokenId && game.combat?.combatant?.tokenId === m.tokenId;
      const combatant  = game.combat?.combatants.find(c => c.tokenId === m.tokenId);
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
          <div class="vcs-pill ${luckClass}"><i class="fas fa-clover"></i>${data.luck}</div>
          <div class="vcs-pill ${moveClass}"><i class="fas fa-person-walking"></i>${data.moveRemaining}/${data.activeSpeed}ft</div>
        </div>` : "";

      return `
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
          ${isCurrent ? '<div class="vcs-turn-badge"><i class="fas fa-chevron-right"></i></div>' : ""}
          ${isDefeated ? '<div class="vcs-defeated-icon"><i class="fas fa-skull"></i></div>' : ""}
          ${m.type === "gm" ? '<i class="fas fa-crown vcs-gm-icon"></i>' : ""}
          ${game.user.isGM ? `<button class="vcs-remove" data-id="${m.id}" title="Remove">×</button>` : ""}
        </div>`;
    };

    const heroCards = heroes.map(makeCard).join("");
    const npcCards  = npcs.map(makeCard).join("");

    // Turn number — floating, no background
    const turnNum = `<div class="vcs-turn-num">${state.turnCount}</div>`;

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
      <div class="vcs-turn-num">${state.turnCount}</div>
      <div class="vcs-inner ${inCombat ? "vcs-paused" : ""}">
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
  },

  _extractData(actor, inCombat = false) {
    const s           = actor.system;
    const combatSpeed = s.speed?.base  ?? 0;
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
      card.addEventListener("click", async (ev) => {
        if (ev.target.closest(".vcs-remove")) return;
        const tokenId = card.dataset.tokenId;
        if (!tokenId) return;
        const token = canvas.tokens?.get(tokenId);
        if (!token) return;
        token.control({ releaseOthers: !ev.shiftKey });
        await canvas.animatePan({ x: token.center.x, y: token.center.y,
          scale: Math.max(canvas.stage.scale.x, 0.5) });
      });
    });
    if (!game.user.isGM) return;
    this._el.querySelectorAll(".vcs-remove").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        await CrawlState.removeMember(btn.dataset.id);
        this.render();
      });
    });
  },

  updateMember(actorId) {
    if (CrawlState.active) this.render();
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
  CrawlStrip.render();
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

Hooks.on("updateItem", () => { if (CrawlState.active) CrawlStrip.render(); });
Hooks.on("updateCombatant", () => { if (CrawlState.active) CrawlStrip.render(); });
Hooks.on("updateCombat", () => { if (CrawlState.active) CrawlStrip.render(); });

