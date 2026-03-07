/**
 * Vagabond Crawler — Morale Checker
 *
 * Hook pattern copied exactly from vagabond-extras/gm-tools.mjs.
 * - Group: first death, half dead (updateCombatant, changes.defeated === true)
 * - Solo:  drops to half HP (updateActor, changes.system.health.value)
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";

let _state = {
  initialNPCCount: 0,
  isSolo:          false,
  firstDeathFired: false,
  halfGroupFired:  false,
  halfHPFired:     false,
};

export const MoraleChecker = {

  init() {
    const initState = (combat) => {
      const npcCount = combat.combatants.filter(c => c.actor?.type === "npc").length;
      _state = {
        initialNPCCount: npcCount,
        isSolo:          npcCount === 1,
        firstDeathFired: false,
        halfGroupFired:  false,
        halfHPFired:     false,
      };
      console.log(`${MODULE_ID} | Morale init: ${npcCount} NPCs, solo=${npcCount === 1}`);
    };

    // combatStart fires when GM clicks Start Combat in the tracker UI
    Hooks.on("combatStart", initState);

    // createCombat fires when the combat document is first created —
    // catches cases where we create combat programmatically (crawler's Combat button)
    // Note: combatants may not exist yet at this point, so we re-init on first updateCombatant too
    Hooks.on("createCombat", combat => {
      _state = { initialNPCCount: 0, isSolo: false, firstDeathFired: false, halfGroupFired: false, halfHPFired: false };
    });

    // Re-initialize once combatants are added (fallback for programmatic combat creation)
    // Defer slightly so all combatants finish creating before we count
    Hooks.on("createCombatant", () => {
      if (_state.initialNPCCount > 0) return; // already initialized via combatStart
      clearTimeout(this._moraleInitTimer);
      this._moraleInitTimer = setTimeout(() => {
        if (!game.combat) return;
        const npcCount = game.combat.combatants.filter(c => c.actor?.type === "npc").length;
        if (npcCount > 0 && _state.initialNPCCount === 0) {
          _state.initialNPCCount = npcCount;
          _state.isSolo = npcCount === 1;
          console.log(`${MODULE_ID} | Morale init (createCombatant): ${npcCount} NPCs, solo=${_state.isSolo}`);
        }
      }, 300);
    });

    // Group morale — exact pattern from vagabond-extras
    Hooks.on("updateCombatant", async (combatant, changes) => {
      if (!game.user.isGM || !game.combat) return;
      if (combatant.actor?.type !== "npc") return;
      if (changes.defeated !== true) return;   // exact match, no extras
      if (_state.isSolo) return;

      const allNPC   = game.combat.combatants.filter(c => c.actor?.type === "npc");
      const defeated = allNPC.filter(c => c.defeated).length;

      if (!_state.firstDeathFired && defeated >= 1) {
        _state.firstDeathFired = true;
        await this._check("First death in the group");
      } else if (!_state.halfGroupFired && defeated >= Math.ceil(_state.initialNPCCount / 2)) {
        _state.halfGroupFired = true;
        await this._check("Half the group is dead");
      }
    });

    // Solo morale — exact pattern from vagabond-extras
    Hooks.on("updateActor", async (actor, changes) => {
      if (!game.user.isGM || !game.combat) return;
      if (actor.type !== "npc") return;
      if (!_state.isSolo) return;
      if (_state.halfHPFired) return;

      const newHP = changes?.system?.health?.value;
      if (newHP === undefined) return;
      const maxHP = actor.system.health.max;
      if (maxHP > 0 && newHP <= Math.floor(maxHP / 2)) {
        _state.halfHPFired = true;
        await this._check(`${actor.name} is at half HP or less`);
      }
    });
  },

  async _check(reason) {
    const combat = game.combat;
    if (!combat) return;

    const npcAlive = combat.combatants.filter(c => c.actor?.type === "npc" && !c.defeated);
    if (!npcAlive.length) return;

    // Highest threat level NPC leads — exact field from vagabond-extras
    let leader = null, highestTL = -Infinity;
    for (const c of npcAlive) {
      const tl = c.actor.system.threatLevel ?? 0;
      if (tl > highestTL) { highestTL = tl; leader = c.actor; }
    }
    // Fall back to first alive NPC if no TL data
    if (!leader) leader = npcAlive[0]?.actor;
    if (!leader) return;

    const morale = leader.system.morale ?? 7;
    const roll   = await new Roll("2d6").evaluate();
    const passed = roll.total <= morale;

    await ChatMessage.create({
      content: `<div class="vagabond-crawler-chat morale-check">
        <h3><i class="fas fa-flag"></i> Morale Check</h3>
        <div class="morale-body">
          <p><strong>Trigger:</strong> ${reason}</p>
          <p><strong>Leader:</strong> ${leader.name} (TL ${highestTL === -Infinity ? "?" : highestTL})</p>
          <p><strong>Morale:</strong> ${morale} | <strong>Roll:</strong> ${roll.total} (${roll.result})</p>
          <p class="morale-result ${passed ? "morale-pass" : "morale-fail"}">
            <i class="fas ${passed ? "fa-shield-alt" : "fa-person-running"}"></i>
            ${passed ? "HOLDS — The group stands firm!" : "FAILS — The group retreats or surrenders!"}
          </p>
        </div>
      </div>`,
      speaker: { alias: "Morale" },
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      rolls:   [roll],
    });
  },

  async manualCheck(reason = "Manual morale check") {
    await this._check(reason);
  },
};
