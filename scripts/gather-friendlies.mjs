/**
 * Vagabond Crawler — Gather Friendlies
 *
 * Adds a "Gather My Friendlies" button to each character token's right-click
 * HUD. Teleports every FRIENDLY-disposition NPC token on the scene that the
 * hero's owners also own (summons, familiars, beast companions, hirelings
 * linked to that player) to free squares adjacent to the hero.
 *
 * Ownership filter: a friendly is gathered if any non-GM user with OWNER
 * permission on the hero also has OWNER permission on the friendly. Keeps
 * another player's summons from being pulled by the wrong hero's gather.
 *
 * Unlike the system's Gather Party, this does NOT delete tokens or store
 * snapshots — friendlies stay on the canvas as tactical pieces, just
 * repositioned so they catch up after combat.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

export const GatherFriendlies = {
  init() {
    Hooks.on("renderTokenHUD", this._onRenderTokenHUD.bind(this));
  },

  _onRenderTokenHUD(hud, html) {
    const token = hud.object;
    if (token?.actor?.type !== "character") return;
    // Only render for users with OWNER permission on the hero
    if (!token.actor.isOwner) return;

    const leftCol = html.querySelector(".col.left");
    if (!leftCol) return;
    if (leftCol.querySelector(".vcb-gather-friendlies")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("control-icon", "vcb-gather-friendlies");
    btn.setAttribute("data-tooltip", `Gather ${token.actor.name}'s Friendlies`);
    btn.innerHTML = `<i class="fas fa-paw"></i>`;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this.gatherForHero(token);
      hud.render();
    });
    leftCol.appendChild(btn);
  },

  /**
   * Return the set of non-GM user IDs with OWNER permission on an actor.
   */
  _ownerUserIds(actor) {
    const ids = new Set();
    const ownership = actor?.ownership ?? {};
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    for (const [userId, level] of Object.entries(ownership)) {
      if (userId === "default") continue;
      if (level < OWNER) continue;
      const user = game.users.get(userId);
      if (!user || user.isGM) continue;
      ids.add(userId);
    }
    return ids;
  },

  /**
   * Teleport every FRIENDLY NPC token on the scene that shares a non-GM
   * owner with the hero to a free adjacent square around the hero's token.
   * For GM-owned heroes with no player owner, falls back to "any friendly
   * the GM owns" — GMs can use this to herd unassigned friendlies too.
   */
  async gatherForHero(heroToken) {
    if (!heroToken?.document) return;
    const scene = heroToken.document.parent;
    if (!scene) return;

    const hero = heroToken.actor;
    const heroOwners = this._ownerUserIds(hero);
    const isGMFallback = heroOwners.size === 0 && game.user.isGM;

    const friendlies = canvas.tokens.placeables.filter(t => {
      if (t.id === heroToken.id) return false;
      if (t.actor?.type !== "npc") return false;
      if (t.document.disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) return false;
      if (isGMFallback) return true;
      // Friendly must share at least one non-GM owner with the hero
      const friendlyOwners = this._ownerUserIds(t.actor);
      for (const uid of heroOwners) {
        if (friendlyOwners.has(uid)) return true;
      }
      return false;
    });

    if (!friendlies.length) {
      ui.notifications.info(`No friendly NPCs owned by ${hero.name}'s player on this scene.`);
      return;
    }

    const px = heroToken.document.x;
    const py = heroToken.document.y;
    const gridSize = canvas.grid.size;

    // 8 adjacent squares first, then outer ring of 16 — plenty for the
    // summon-heavy parties this feature is designed for.
    const offsets = [
      [-1, -1], [ 0, -1], [ 1, -1],
      [-1,  0],           [ 1,  0],
      [-1,  1], [ 0,  1], [ 1,  1],
      [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2],
      [-2, -1],                             [2, -1],
      [-2,  0],                             [2,  0],
      [-2,  1],                             [2,  1],
      [-2,  2], [-1,  2], [0,  2], [1,  2], [2,  2],
    ];

    // Occupied: hero's square + every non-friendly token already on the scene
    const occupied = new Set([`${px},${py}`]);
    for (const t of canvas.tokens.placeables) {
      if (friendlies.includes(t)) continue;
      occupied.add(`${t.document.x},${t.document.y}`);
    }

    const updates = [];
    for (const f of friendlies) {
      // Already within 2 squares — leave alone
      const dx0 = (f.document.x - px) / gridSize;
      const dy0 = (f.document.y - py) / gridSize;
      if (Math.abs(dx0) <= 2 && Math.abs(dy0) <= 2) {
        occupied.add(`${f.document.x},${f.document.y}`);
        continue;
      }
      let placed = false;
      for (const [dx, dy] of offsets) {
        const nx = px + dx * gridSize;
        const ny = py + dy * gridSize;
        const key = `${nx},${ny}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        updates.push({ _id: f.id, x: nx, y: ny });
        placed = true;
        break;
      }
      if (!placed) updates.push({ _id: f.id, x: px, y: py });  // stack on hero as fallback
    }

    if (updates.length) {
      await scene.updateEmbeddedDocuments("Token", updates);
      ui.notifications.info(`Gathered ${updates.length} friendly NPC${updates.length === 1 ? "" : "s"} to ${hero.name}.`);
    } else {
      ui.notifications.info(`All of ${hero.name}'s friendlies are already nearby.`);
    }
  },
};
