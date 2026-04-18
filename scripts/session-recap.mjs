/**
 * Vagabond Crawler — Session Recap
 *
 * Singleton data layer for tracking session events (combat, loot, XP, rolls).
 * Persists to world setting `sessionRecap`. Provides logging methods and
 * Discord markdown export.
 */

import { MODULE_ID } from "./vagabond-crawler.mjs";
import { waitDialog } from "./dialog-helpers.mjs";

const SETTING_KEY = "sessionRecap";

const DEFAULT_DATA = {
  sessionState: "inactive",
  sessionStart: null,
  loot: [],
  xp: [],
  combats: [],
  playerStats: {},
};

export const SessionRecap = {
  _app: null,

  // Transient combat state (not persisted — lives only during active combats)
  _activeCombats: new Map(),
  _killMap: new Map(),
  _hasDamageLog: false,

  // ── Settings ───────────────────────────────────────────────

  registerSettings() {
    game.settings.register(MODULE_ID, SETTING_KEY, {
      scope: "world",
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULT_DATA),
    });
    game.settings.register(MODULE_ID, "sessionHistory", {
      scope: "world",
      config: false,
      type: Array,
      default: [],
    });
  },

  // ── Read / Write ───────────────────────────────────────────

  getData() {
    return game.settings.get(MODULE_ID, SETTING_KEY) ?? foundry.utils.deepClone(DEFAULT_DATA);
  },

  getHistory() {
    return game.settings.get(MODULE_ID, "sessionHistory") ?? [];
  },

  async _saveHistory(history) {
    await game.settings.set(MODULE_ID, "sessionHistory", history);
    if (this._app?.rendered) this._app.render();
  },

  async _save(data) {
    await game.settings.set(MODULE_ID, SETTING_KEY, data);
    if (this._app?.rendered) this._app.render();
  },

  _ensureStart(data) {
    if (!data.sessionStart) data.sessionStart = Date.now();
  },

  // ── Loot Logging ───────────────────────────────────────────

  async logLoot(entry) {
    const data = this.getData();
    this._ensureStart(data);
    data.loot.push({
      // Default to claimed so pre-existing call-sites (pickups, currency
      // claims, bag shares) keep their previous behavior. The drop/claim
      // flow below overrides this to track unclaimed rolls.
      claimed: true,
      ...entry,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    await this._save(data);
  },

  /**
   * Log a loot drop as unclaimed. Use when loot is rolled for a player and
   * a chat-card claim button is waiting to be clicked. Pass `messageId`
   * (the Foundry chat message id) so `markClaimed()` can later flip the
   * entry to claimed without duplicating it. If the card is never clicked,
   * the entry surfaces in the session recap as unclaimed loot.
   */
  async logDrop(entry) {
    await this.logLoot({ claimed: false, ...entry });
  },

  /**
   * Flip every unclaimed loot entry tied to `messageId` to claimed state.
   * Safe no-op if no matching entry exists (e.g. card predates the
   * drop-tracking, or was logged via the old logClaim path).
   */
  async markClaimed(messageId, claimedByName = null) {
    if (!messageId) return;
    const data = this.getData();
    let changed = false;
    for (const entry of data.loot) {
      if (entry.messageId !== messageId) continue;
      if (entry.claimed) continue;
      entry.claimed = true;
      if (claimedByName) entry.claimedBy = claimedByName;
      changed = true;
    }
    if (changed) await this._save(data);
  },

  // ── XP Logging ─────────────────────────────────────────────

  async logXp({ player, actorId, questions, totalXp }) {
    const data = this.getData();
    this._ensureStart(data);
    data.xp.push({
      player,
      actorId,
      questions,
      totalXp,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    await this._save(data);
  },

  // ── Combat Logging ─────────────────────────────────────────

  async logCombat(combatEntry) {
    const data = this.getData();
    this._ensureStart(data);
    data.combats.push(combatEntry);
    await this._save(data);
  },

  // ── Player Stat Updates ────────────────────────────────────

  async updatePlayerStat(actorId, name, path, delta) {
    const data = this.getData();
    this._ensureStart(data);
    if (!data.playerStats[actorId]) {
      data.playerStats[actorId] = {
        name,
        attacks: { hits: 0, misses: 0, nat20s: 0, nat1s: 0 },
        saves: { passes: 0, fails: 0, nat20s: 0, nat1s: 0 },
        rolls: { total: 0, sum: 0 },
        damageDealt: 0,
        damageTaken: 0,
        kills: 0,
      };
    }
    // path is dot-separated, e.g. "attacks.hits" or "damageDealt"
    const parts = path.split(".");
    let obj = data.playerStats[actorId];
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] += delta;
    await this._save(data);
  },

  // ── Clear ──────────────────────────────────────────────────

  async clear() {
    const fresh = foundry.utils.deepClone(DEFAULT_DATA);
    fresh.sessionState = "inactive";
    fresh.sessionStart = null;
    await this._save(fresh);
  },

  // ── Migration ──────────────────────────────────────────────

  async migrateFromLootLog() {
    // Legacy setting — only read if still registered (was removed in a later version)
    if (!game.settings.settings.has(`${MODULE_ID}.lootLog`)) return;
    const oldLog = game.settings.get(MODULE_ID, "lootLog");
    if (!oldLog?.length) return;
    const data = this.getData();
    if (data.loot.length > 0) return; // already has data, skip
    data.loot = foundry.utils.deepClone(oldLog);
    if (!data.sessionStart && oldLog.length > 0) {
      data.sessionStart = oldLog[0].timestamp ?? Date.now();
    }
    await this._save(data);
    console.log(`${MODULE_ID} | Migrated ${oldLog.length} loot entries to sessionRecap`);
  },

  // ── Combat & Damage Hooks ─────────────────────────────────

  _initCombatHooks() {
    if (!game.user.isGM) return;

    this._hasDamageLog = game.modules.get("damage-log")?.active ?? false;

    // Last attacker seen on an attack chat card. Used to credit damage-log
    // HP changes to the actual attacker instead of the current combat
    // turn-holder (which is unreliable — AOE spells, reactions, and
    // familiars in the initiative order all break turn-holder attribution).
    this._lastAttacker = null;

    // ── Attack card speaker tracker ────────────────────────
    // On any chat card that resolves an attack roll as HIT (weapon attack,
    // damaging spell, etc.), remember the speaker. The next damage-log
    // message that fires within the time window is attributed to them.
    Hooks.on("createChatMessage", (message) => {
      if (this.getData().sessionState !== "active") return;
      // Skip damage-log's own messages — those are the *target* updates,
      // handled below.
      if (message.flags?.["damage-log"]?.changes?.length) return;
      const content = message.content ?? "";
      // Only damage-dealing resolutions. Attacks that miss don't apply HP,
      // and saves / checks use PASS/FAIL and never trigger damage-log.
      if (!/\bHIT\b/.test(content)) return;
      const actorId = message.speaker?.actor;
      if (!actorId) return;
      const actor = game.actors.get(actorId);
      if (!actor) return;
      this._lastAttacker = {
        actorId: actor.id,
        actor,
        name: actor.name,
        timestamp: Date.now(),
      };
    });

    // ── Combat start ───────────────────────────────────────
    Hooks.on("combatStart", (combat) => {
      if (this.getData().sessionState !== "active") return;
      const participants = [];
      for (const c of combat.combatants) {
        if (!c.actor || !c.token) continue;
        const disp = c.token.disposition ?? c.token.document?.disposition;
        if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY && c.actor.hasPlayerOwner) {
          participants.push({ name: c.actor.name, actorId: c.actor.id });
        }
      }
      this._activeCombats.set(combat.id, {
        startTime: Date.now(),
        participants,
      });
    });

    // ── Combat end ─────────────────────────────────────────
    Hooks.on("deleteCombat", async (combat) => {
      if (this.getData().sessionState !== "active") return;
      const active = this._activeCombats.get(combat.id);
      if (!active) return;

      const enemies = [];
      for (const c of combat.combatants) {
        if (!c.actor) continue;
        const disp = c.token?.disposition ?? c.token?.document?.disposition;
        if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;

        const hp = c.actor.system?.health;
        const defeated = c.defeated || (hp && hp.value <= 0);
        const tokenId = c.token?.id ?? c.token?.document?.id;
        enemies.push({
          name: c.actor.name,
          defeated: !!defeated,
          killedBy: defeated ? (this._killMap.get(tokenId) ?? null) : null,
        });
      }

      await this.logCombat({
        id: combat.id,
        rounds: combat.round ?? 0,
        startTime: active.startTime,
        endTime: Date.now(),
        enemies,
        participants: active.participants,
      });

      this._activeCombats.delete(combat.id);
      this._killMap.clear();
    });

    // ── Damage-log chat messages ───────────────────────────
    if (this._hasDamageLog) {
      Hooks.on("createChatMessage", (message) => {
        if (this.getData().sessionState !== "active") return;
        const flags = message.flags?.["damage-log"];
        if (!flags?.changes?.length) return;

        const targetActorId = message.speaker?.actor;
        if (!targetActorId) return;
        const targetActor = game.actors.get(targetActorId);
        if (!targetActor) return;

        // Resolve the attacker. Prefer the most recent HIT chat card
        // (within the freshness window), fall back to the current
        // combat turn-holder only if nothing recent is tracked.
        const FRESH_MS = 60_000;
        let attackerActor = null;
        if (this._lastAttacker && Date.now() - this._lastAttacker.timestamp < FRESH_MS) {
          attackerActor = this._lastAttacker.actor;
        }
        if (!attackerActor) {
          attackerActor = game.combat?.combatant?.actor ?? null;
        }
        // Unwrap familiars / polymorph to the controlling PC so stats
        // credit the player rather than their pet or transformed form.
        attackerActor = this._unwrapToPC(attackerActor) ?? attackerActor;

        const attackerIsPC = !!attackerActor?.hasPlayerOwner
          && attackerActor.type === "character";

        for (const change of flags.changes) {
          if (change.id !== "hp") continue;
          const diff = (change.new ?? 0) - (change.old ?? 0);
          if (diff >= 0) continue;
          const absDiff = Math.abs(diff);

          const targetIsPC = targetActor.hasPlayerOwner && targetActor.type === "character";

          if (targetIsPC) {
            this.updatePlayerStat(targetActorId, targetActor.name, "damageTaken", absDiff);
          } else if (attackerIsPC && attackerActor) {
            this.updatePlayerStat(attackerActor.id, attackerActor.name, "damageDealt", absDiff);

            const tokenId = message.speaker?.token;
            if (tokenId) {
              this._killMap.set(tokenId, attackerActor.name);
            }

            if ((change.new ?? 0) <= 0) {
              this.updatePlayerStat(attackerActor.id, attackerActor.name, "kills", 1);
            }
          }
        }
      });
    }
  },

  /**
   * Resolve a combat actor to its controlling PC, if any.
   *
   * Handles:
   *  - actor is already a PC → return as-is
   *  - polymorph (flags.core.originalActor holds a uuid) → original PC
   *  - familiar / summon / minion owned by a user whose assigned
   *    .character is a different PC → that PC
   *
   * Returns null if no controlling PC can be resolved.
   */
  _unwrapToPC(actor) {
    if (!actor) return null;
    if (actor.type === "character" && actor.hasPlayerOwner) return actor;

    // Polymorph: system-agnostic core flag set by Foundry's polymorph flow.
    const origUuid = actor.flags?.core?.originalActor;
    if (origUuid) {
      try {
        const orig = fromUuidSync(origUuid);
        if (orig?.hasPlayerOwner && orig.type === "character") return orig;
      } catch { /* fall through */ }
    }

    // Familiar / summon: player-owned NPC actor. Find an owning user
    // whose assigned character is a different PC.
    if (actor.hasPlayerOwner) {
      const ownership = actor.ownership || {};
      for (const [uid, level] of Object.entries(ownership)) {
        if (uid === "default") continue;
        if (level < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) continue;
        const user = game.users.get(uid);
        const pc = user?.character;
        if (pc && pc.id !== actor.id && pc.type === "character") return pc;
      }
    }

    return null;
  },

  // ── Roll Stats Hooks ──────────────────────────────────────

  _initRollHooks() {
    if (!game.user.isGM) return;

    Hooks.on("createChatMessage", (message) => {
      if (this.getData().sessionState !== "active") return;
      if (!message.rolls?.length) return;

      const actorId = message.speaker?.actor;
      if (!actorId) return;
      const actor = game.actors.get(actorId);
      if (!actor?.hasPlayerOwner) return;

      const roll = message.rolls[0];
      const d20Die = roll.dice?.find(d => d.faces === 20);
      const naturalResult = d20Die?.results?.[0]?.result;
      if (naturalResult == null) return;

      const isNat20 = naturalResult === 20;
      const isNat1 = naturalResult === 1;
      const name = actor.name;

      this.updatePlayerStat(actorId, name, "rolls.total", 1);
      this.updatePlayerStat(actorId, name, "rolls.sum", naturalResult);

      const content = message.content ?? "";
      const isAttack = /\bHIT\b/.test(content) || /\bMISS\b/.test(content);
      const isSave = /\bPASS\b/.test(content) || /\bFAIL\b/.test(content);

      if (isAttack) {
        const isHit = /\bHIT\b/.test(content);
        this.updatePlayerStat(actorId, name, isHit ? "attacks.hits" : "attacks.misses", 1);
        if (isNat20) this.updatePlayerStat(actorId, name, "attacks.nat20s", 1);
        if (isNat1) this.updatePlayerStat(actorId, name, "attacks.nat1s", 1);
      } else if (isSave) {
        const isPassed = /\bPASS\b/.test(content);
        this.updatePlayerStat(actorId, name, isPassed ? "saves.passes" : "saves.fails", 1);
        if (isNat20) this.updatePlayerStat(actorId, name, "saves.nat20s", 1);
        if (isNat1) this.updatePlayerStat(actorId, name, "saves.nat1s", 1);
      }
    });
  },

  // ── Export ─────────────────────────────────────────────────

  _formatDuration(ms) {
    if (!ms || ms < 0) return "0m";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  },

  formatForDiscordFromData(data, startTime, endTime) {
    const lines = [];

    const duration = startTime
      ? this._formatDuration((endTime ?? Date.now()) - startTime)
      : "N/A";
    lines.push("# Session Recap");
    lines.push(`**Duration:** ${duration}`);
    lines.push("");

    // ── Combat ─────────────────────────────────────────────
    if (data.combats.length > 0) {
      lines.push("## Combat");
      data.combats.forEach((combat, idx) => {
        const combatDuration = combat.startTime && combat.endTime
          ? ` (${this._formatDuration(combat.endTime - combat.startTime)})`
          : "";
        lines.push(`**Encounter ${idx + 1}** — ${combat.rounds} rounds${combatDuration}`);

        const enemyCounts = {};
        for (const e of combat.enemies) {
          if (!enemyCounts[e.name]) enemyCounts[e.name] = { total: 0, defeated: 0, killers: [] };
          enemyCounts[e.name].total++;
          if (e.defeated) {
            enemyCounts[e.name].defeated++;
            if (e.killedBy) enemyCounts[e.name].killers.push(e.killedBy);
          }
        }

        const enemyList = Object.entries(enemyCounts)
          .map(([name, c]) => `${name}${c.total > 1 ? ` x${c.total}` : ""}`)
          .join(", ");
        lines.push(`- Enemies: ${enemyList}`);

        const defeatedParts = [];
        for (const [name, c] of Object.entries(enemyCounts)) {
          if (c.defeated === 0) continue;
          const killerCounts = {};
          c.killers.forEach(k => { killerCounts[k] = (killerCounts[k] || 0) + 1; });
          const killerStr = Object.entries(killerCounts)
            .map(([k, n]) => n > 1 ? `${k} x${n}` : k)
            .join(", ");
          const label = c.defeated > 1 ? `${name} x${c.defeated}` : name;
          defeatedParts.push(killerStr ? `${label} (${killerStr})` : label);
        }
        if (defeatedParts.length > 0) {
          lines.push(`- Defeated: ${defeatedParts.join(", ")}`);
        }
        lines.push("");
      });
    }

    // ── Player Stats ───────────────────────────────────────
    const statEntries = Object.entries(data.playerStats).filter(([, s]) => {
      return s.attacks.hits + s.attacks.misses > 0
        || s.saves.passes + s.saves.fails > 0
        || s.damageDealt > 0 || s.damageTaken > 0 || s.kills > 0;
    });

    if (statEntries.length > 0) {
      lines.push("## Player Stats");
      for (const [, stats] of statEntries) {
        lines.push(`### ${stats.name}`);

        const totalAtk = stats.attacks.hits + stats.attacks.misses;
        if (totalAtk > 0) {
          const hitPct = Math.round((stats.attacks.hits / totalAtk) * 100);
          let atkLine = `- **Attacks:** ${stats.attacks.hits}/${totalAtk} hit (${hitPct}%)`;
          const atkParts = [];
          if (stats.attacks.nat20s > 0) atkParts.push(`${stats.attacks.nat20s} nat 20${stats.attacks.nat20s > 1 ? "s" : ""}`);
          if (stats.attacks.nat1s > 0) atkParts.push(`${stats.attacks.nat1s} nat 1${stats.attacks.nat1s > 1 ? "s" : ""}`);
          if (atkParts.length > 0) atkLine += ` — ${atkParts.join(", ")}`;
          lines.push(atkLine);
        }

        const totalSave = stats.saves.passes + stats.saves.fails;
        if (totalSave > 0) {
          let saveLine = `- **Saves:** ${stats.saves.passes}/${totalSave} passed`;
          const saveParts = [];
          if (stats.saves.nat20s > 0) saveParts.push(`${stats.saves.nat20s} nat 20${stats.saves.nat20s > 1 ? "s" : ""}`);
          if (stats.saves.nat1s > 0) saveParts.push(`${stats.saves.nat1s} nat 1${stats.saves.nat1s > 1 ? "s" : ""}`);
          if (saveParts.length > 0) saveLine += ` — ${saveParts.join(", ")}`;
          lines.push(saveLine);
        }

        if (stats.rolls.total > 0) {
          const avg = (stats.rolls.sum / stats.rolls.total).toFixed(1);
          lines.push(`- **Avg d20:** ${avg}`);
        }

        if (stats.damageDealt > 0 || stats.damageTaken > 0) {
          lines.push(`- **Damage:** ${stats.damageDealt} dealt / ${stats.damageTaken} taken`);
        }

        if (stats.kills > 0) {
          lines.push(`- **Kills:** ${stats.kills}`);
        }
        lines.push("");
      }
    }

    // ── Loot ───────────────────────────────────────────────
    if (data.loot.length > 0) {
      // Claimed / picked-up loot is attributed to the owner; unclaimed
      // rolls still carry the original intended recipient in `player`.
      const claimedByPlayer = {};
      const unclaimedByPlayer = {};
      for (const entry of data.loot) {
        const bucket = entry.claimed === false ? unclaimedByPlayer : claimedByPlayer;
        if (!bucket[entry.player]) bucket[entry.player] = [];
        bucket[entry.player].push(entry);
      }

      lines.push("## Loot");
      for (const [player, entries] of Object.entries(claimedByPlayer)) {
        lines.push(`### ${player}`);

        const currencyEntries = entries.filter(e => e.type === "currency");
        const itemEntries = entries.filter(e => e.type === "item" || e.type === "pickup");

        if (currencyEntries.length > 0) {
          let totalGold = 0, totalSilver = 0, totalCopper = 0;
          for (const e of currencyEntries) {
            const gm = e.detail.match(/(\d+)\s*Gold/i);
            const sm = e.detail.match(/(\d+)\s*Silver/i);
            const cm = e.detail.match(/(\d+)\s*Copper/i);
            if (gm) totalGold += parseInt(gm[1]);
            if (sm) totalSilver += parseInt(sm[1]);
            if (cm) totalCopper += parseInt(cm[1]);
          }
          const parts = [];
          if (totalGold > 0) parts.push(`${totalGold}g`);
          if (totalSilver > 0) parts.push(`${totalSilver}s`);
          if (totalCopper > 0) parts.push(`${totalCopper}c`);
          if (parts.length > 0) lines.push(`- **Currency:** ${parts.join(", ")}`);
        }

        if (itemEntries.length > 0) {
          lines.push("- **Items:**");
          for (const e of itemEntries) {
            const source = e.source !== "Ground" ? ` *(from ${e.source})*` : " *(picked up)*";
            lines.push(`  - ${e.detail}${source}`);
          }
        }
        lines.push("");
      }

      // ── Unclaimed drops (rolled but Claim button never pressed) ──
      const unclaimedPlayers = Object.entries(unclaimedByPlayer);
      if (unclaimedPlayers.length > 0) {
        lines.push("### Unclaimed");
        for (const [player, entries] of unclaimedPlayers) {
          const itemEntries = entries.filter(e => e.type === "item" || e.type === "pickup");
          const currencyEntries = entries.filter(e => e.type === "currency");

          const bits = [];
          if (currencyEntries.length > 0) {
            let tg = 0, ts = 0, tc = 0;
            for (const e of currencyEntries) {
              const gm = e.detail.match(/(\d+)\s*Gold/i);
              const sm = e.detail.match(/(\d+)\s*Silver/i);
              const cm = e.detail.match(/(\d+)\s*Copper/i);
              if (gm) tg += parseInt(gm[1]);
              if (sm) ts += parseInt(sm[1]);
              if (cm) tc += parseInt(cm[1]);
            }
            const cparts = [];
            if (tg > 0) cparts.push(`${tg}g`);
            if (ts > 0) cparts.push(`${ts}s`);
            if (tc > 0) cparts.push(`${tc}c`);
            if (cparts.length > 0) bits.push(cparts.join(", "));
          }
          for (const e of itemEntries) {
            const source = e.source && e.source !== "Ground" ? ` *(from ${e.source})*` : "";
            bits.push(`${e.detail}${source}`);
          }
          if (bits.length > 0) {
            lines.push(`- **${player}** (rolled, not claimed): ${bits.join(", ")}`);
          }
        }
        lines.push("");
      }
    }

    // ── XP ─────────────────────────────────────────────────
    if (data.xp.length > 0) {
      const byPlayer = {};
      for (const entry of data.xp) {
        if (!byPlayer[entry.player]) byPlayer[entry.player] = { entries: [], total: 0 };
        byPlayer[entry.player].entries.push(entry);
        byPlayer[entry.player].total += entry.totalXp;
      }

      lines.push("## XP");
      for (const [player, { entries, total }] of Object.entries(byPlayer)) {
        lines.push(`### ${player}`);
        for (const entry of entries) {
          for (const q of entry.questions) {
            lines.push(`- ${q.label} — x${q.count} = ${q.count * q.xp} XP`);
          }
        }
        lines.push(`- **Total: ${total} XP**`);
        lines.push("");
      }
    }

    if (lines.length <= 3) return "No session activity recorded.";
    return lines.join("\n");
  },

  formatForDiscord() {
    const data = this.getData();
    return this.formatForDiscordFromData(data, data.sessionStart, Date.now());
  },

  // ── Session Lifecycle ──────────────────────────────────────

  _generateSessionName(timestamp) {
    const d = new Date(timestamp);
    const base = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} Session`;
    const history = this.getHistory();
    const existing = history.filter(s => s.name.startsWith(base));
    if (existing.length === 0) return base;
    return `${base} ${existing.length + 1}`;
  },

  async startSession() {
    const fresh = foundry.utils.deepClone(DEFAULT_DATA);
    fresh.sessionState = "active";
    fresh.sessionStart = Date.now();
    await this._save(fresh);
  },

  async continueSession() {
    const data = this.getData();
    data.sessionState = "active";
    await this._save(data);
  },

  async pauseSession() {
    const data = this.getData();
    data.sessionState = "paused";
    await this._save(data);
  },

  async endAndSave() {
    const data = this.getData();
    const now = Date.now();
    const history = this.getHistory();

    const snapshot = {
      id: `session-${now}`,
      name: this._generateSessionName(data.sessionStart ?? now),
      startTime: data.sessionStart ?? now,
      endTime: now,
      data: {
        loot: data.loot,
        xp: data.xp,
        combats: data.combats,
        playerStats: data.playerStats,
      },
    };

    history.unshift(snapshot);
    await this._saveHistory(history);
    await this.clear();
    ui.notifications.info(`Session saved: ${snapshot.name}`);
  },

  async discardSession() {
    await this.clear();
    ui.notifications.info("Session discarded.");
  },

  async deleteFromHistory(id) {
    const history = this.getHistory().filter(s => s.id !== id);
    await this._saveHistory(history);
  },

  // ── Lifecycle Hooks ────────────────────────────────────────

  _initLifecycleHooks() {
    if (!game.user.isGM) return;

    // ── Crawl Start popup ──────────────────────────────────
    Hooks.on("vagabondCrawler.crawlStart", async () => {
      const data = this.getData();
      const isPaused = data.sessionState === "paused";

      const buttons = [
        { label: "Start New Session", icon: "fas fa-play", value: "start" },
      ];
      if (isPaused) {
        buttons.push({ label: "Continue Session", icon: "fas fa-forward", value: "continue" });
      }
      buttons.push({ label: "No Tracking", icon: "fas fa-ban", value: "skip" });

      const choice = await waitDialog({
        title: "Session Tracking",
        content: isPaused
          ? "<p>A paused session exists. What would you like to do?</p>"
          : "<p>Start tracking a new session?</p>",
        buttons,
        defaultButton: isPaused ? "continue" : "start",
      });

      if (choice === "start") {
        await this.startSession();
      } else if (choice === "continue") {
        await this.continueSession();
      }
    });

    // ── Crawl End popup ────────────────────────────────────
    Hooks.on("vagabondCrawler.crawlEnd", async () => {
      const data = this.getData();
      if (data.sessionState !== "active" && data.sessionState !== "paused") return;

      const hasData = data.loot.length > 0 || data.xp.length > 0
        || data.combats.length > 0 || Object.keys(data.playerStats).length > 0;

      const buttons = [
        { label: "End & Save", icon: "fas fa-save", value: "save" },
        { label: "Pause Session", icon: "fas fa-pause", value: "pause" },
      ];
      if (hasData) {
        buttons.push({ label: "Discard", icon: "fas fa-trash", value: "discard" });
      }

      const choice = await waitDialog({
        title: "Session Tracking",
        content: "<p>The crawl is ending. What would you like to do with this session?</p>",
        buttons,
        defaultButton: "save",
      });

      if (choice === "save") {
        await this.endAndSave();
      } else if (choice === "pause") {
        await this.pauseSession();
      } else if (choice === "discard") {
        await this.discardSession();
      } else if (choice === null) {
        await this.pauseSession();
      }
    });
  },

  // ── Init ───────────────────────────────────────────────────

  init() {
    this.migrateFromLootLog();
    this._initCombatHooks();
    this._initRollHooks();
    this._initLifecycleHooks();
    console.log(`${MODULE_ID} | Session Recap initialized.`);
  },

  // ── Open Window ────────────────────────────────────────────

  async open() {
    if (!this._app) {
      const { SessionRecapApp } = await import("./session-recap-app.mjs");
      this._app = new SessionRecapApp();
    }
    this._app.render(true);
  },
};
