// scripts/animation-fx.mjs
import { DEFAULT_ANIMATION_FX_CONFIG, buildDefaultAnimationFxConfig } from "./animation-fx-defaults.mjs";
import { AnimationFxConfigApp } from "./animation-fx-config.mjs";
import { AnimationFxOverrideApp } from "./animation-fx-override.mjs";

const MODULE_ID = "vagabond-crawler";

export const AnimationFx = {
  _hookIds: [],
  _ready: false,

  get active() { return this._ready; },

  registerSettings() {
    game.settings.register(MODULE_ID, "animationFxConfig", {
      scope: "world",
      config: false,
      type: Object,
      default: foundry.utils.deepClone(DEFAULT_ANIMATION_FX_CONFIG),
    });
    game.settings.register(MODULE_ID, "animationFxTriggerOn", {
      name: "Animation FX: Trigger On",
      hint: "When to play hit animations for weapon attacks. 'On hit only' skips animations for missed rolls.",
      scope: "world",
      config: false,
      type: String,
      choices: { always: "Always", hit: "On Hit Only" },
      default: "always",
    });
    // Per-client animation toggles — shown directly in the main Foundry module
    // settings panel so every user (players + GM) can tweak their own playback.
    // Global Scale stays config:false — it's advanced and still editable inside
    // the GM-only Animation FX Config window's Settings tab.
    game.settings.register(MODULE_ID, "animationFxEnabled", {
      name: "Animation FX",
      hint: "Play hit/miss animations for weapon attacks, alchemy, gear, and NPC actions. Affects only your machine.",
      scope: "client", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "animationFxScale", {
      name: "Animation FX: Global Scale",
      hint: "Multiplier applied to every animation's scale. 1.0 = normal, 0.5 = half size, 2.0 = doubled.",
      scope: "client", config: false, type: Number, default: 1.0,
      range: { min: 0.25, max: 3, step: 0.05 },
    });
    game.settings.register(MODULE_ID, "animationFxSoundEnabled", {
      name: "Animation FX: Sound",
      hint: "Play hit/miss sound effects alongside animations. Affects only your machine.",
      scope: "client", config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, "animationFxMasterVolume", {
      name: "Animation FX: Master Volume",
      hint: "Master volume for animation sounds (0 – 1). Affects only your machine.",
      scope: "client", config: true, type: Number, default: 0.8,
      range: { min: 0, max: 1, step: 0.05 },
    });

    // Category toggles — world-scoped so the GM decides for the table.
    // Each corresponds to one tab of the Animation FX Configuration window.
    // Edits in either location (module settings or the config window) write to
    // the same key, so both UIs stay in sync automatically.
    const registerCat = (key, name, hint) => {
      game.settings.register(MODULE_ID, key, {
        name, hint, scope: "world", config: false, type: Boolean, default: true,
      });
    };
    registerCat("animationFxCategoryWeapons", "Animation FX → Weapons",
      "Play hit/miss animations for weapon attacks (named presets in the Weapons tab).");
    registerCat("animationFxCategorySkills", "Animation FX → Skill Fallbacks",
      "Play animations for weapons that have no named preset, based on their weaponSkill (melee/ranged/etc).");
    registerCat("animationFxCategoryAlchemical", "Animation FX → Alchemical",
      "Play animations for alchemical item use (bombs, elixirs, etc).");
    registerCat("animationFxCategoryGear", "Animation FX → Gear",
      "Play animations for gear item use (torches, instruments, etc — includes persistent effects).");
    registerCat("animationFxCategoryNpcActions", "Animation FX → NPC Actions",
      "Play animations for NPC-sheet actions (Bite, Frost Breath, Gust, etc).");

    game.settings.registerMenu(MODULE_ID, "animationFxConfigMenu", {
      name: "Animation FX Configuration",
      label: "Configure Animation FX",
      hint: "Open the full per-preset editor for weapons, NPC actions, alchemical, and gear animations.",
      icon: "fas fa-film",
      type: class extends FormApplication {
        constructor() { super(); game.vagabondCrawler?.animationFx?.open(); }
        async _updateObject() {}
        render() { this.close(); return this; }
      },
      restricted: true,
    });
  },

  /**
   * Returns the category key (as in the config tabs) a given source belongs to.
   * Used to short-circuit playback when the GM has disabled that category.
   */
  _categoryForItem(item) {
    if (!item) return null;
    const eq = item.system?.equipmentType;
    if (eq === "weapon") return "weapons";
    if (eq === "alchemical" || item.type === "alchemical") return "alchemical";
    if (eq === "gear" || item.type === "gear") return "gear";
    return null;
  },

  _isCategoryEnabled(category) {
    if (!category) return true;
    const key = {
      weapons:         "animationFxCategoryWeapons",
      weaponSkillFallbacks: "animationFxCategorySkills",
      alchemical:      "animationFxCategoryAlchemical",
      gear:            "animationFxCategoryGear",
      npcActions:      "animationFxCategoryNpcActions",
    }[category];
    if (!key) return true;
    try { return game.settings.get(MODULE_ID, key) !== false; }
    catch { return true; }  // setting not registered yet during early init
  },

  /**
   * Return the label of a missing-but-required asset module for `file`, or null
   * if the file is playable. Handles both `modules/<id>/...` paths and the
   * `jb2a.xxx` database-key format (which Sequencer resolves if either JB2A
   * pack is active — the database is shared).
   *
   * Note: `modules/JB2A_DnD5e/` and `modules/jb2a_patreon/` are NOT aliases at
   * the file-path level — each module ships its own file tree. Same for
   * `modules/psfx/` vs `modules/psfx-patreon/`. So a literal `modules/<id>/...`
   * path requires THAT specific module to be active.
   */
  _fileReferencesMissingModule(file) {
    if (!file || typeof file !== "string") return null;
    if (file.startsWith("modules/")) {
      const moduleId = file.split("/")[1];
      if (moduleId && !game.modules.get(moduleId)?.active) return moduleId;
      return null;
    }
    if (file.startsWith("jb2a.")) {
      // jb2a.xxx is a Sequencer database key that works with either JB2A pack.
      const hasJb2a = game.modules.get("JB2A_DnD5e")?.active || game.modules.get("jb2a_patreon")?.active;
      if (!hasJb2a) return "JB2A (free or patreon)";
    }
    return null;
  },

  /**
   * Snapshot of which third-party asset modules are installed and active.
   * Surfaced in the Animation FX Configuration UI so the GM can see at a
   * glance which libraries are available.
   */
  _moduleAvailability() {
    const mod = id => game.modules.get(id);
    const jb2aFree = mod("JB2A_DnD5e");
    const jb2aPat = mod("jb2a_patreon");
    const psfxFree = mod("psfx");
    const psfxPat = mod("psfx-patreon");
    const sequencer = mod("sequencer");
    return {
      sequencer: { installed: !!sequencer, active: !!sequencer?.active },
      jb2aFree:  { installed: !!jb2aFree,  active: !!jb2aFree?.active },
      jb2aPatreon: { installed: !!jb2aPat, active: !!jb2aPat?.active },
      anyJb2a: !!jb2aFree?.active || !!jb2aPat?.active,
      psfxFree: { installed: !!psfxFree, active: !!psfxFree?.active },
      psfxPatreon: { installed: !!psfxPat, active: !!psfxPat?.active },
      anyPsfx: !!psfxFree?.active || !!psfxPat?.active,
    };
  },

  async init() {
    // Register the chat message hook immediately.
    const hookId = Hooks.on("createChatMessage", (msg, opts, userId) => this._onChatMessage(msg, opts, userId));
    this._hookIds.push(hookId);
    this._registerSheetButtons();
    this._ready = true;
    // Defer the npcAction wrap to a macrotask so it runs after npc-abilities.mjs
    // finishes its own async wrap chain (which uses multiple await-import steps).
    // 100ms is enough for all pending microtask chains to complete.
    setTimeout(() => this._wrapNpcAction(), 100);
    // Run scale migration non-blocking (fixes stale scale values from pre-fix config)
    this._migrateScaleValues().catch(e => console.warn("[vagabond-crawler] scale migration failed:", e));
  },

  async _migrateScaleValues() {
    if (!game.user.isGM) return;
    const MIGRATION_FLAG = "scaleMigration_v1";
    const stored = game.settings.get(MODULE_ID, "animationFxConfig") ?? {};
    if (stored.__migrations?.[MIGRATION_FLAG]) return;

    let changed = false;

    // Delete the 11 legacy weapon keys (superseded by xlsx-imported entries)
    const legacyKeys = ["sword", "dagger", "axe", "hammer", "polearm", "whip", "fist", "shield", "bow", "firearm", "thrown"];
    if (stored.weapons) {
      for (const k of legacyKeys) {
        if (stored.weapons[k]) { delete stored.weapons[k]; changed = true; }
      }
    }

    // Normalize onToken/self scales > 1 in non-weapon categories
    for (const cat of ["weaponSkillFallbacks", "alchemical", "gear", "npcActions"]) {
      const entries = stored[cat];
      if (!entries) continue;
      for (const [key, preset] of Object.entries(entries)) {
        const t = preset?.type ?? "onToken";
        if (t === "onToken" || t === "self") {
          if (preset?.hit?.scale > 1) { preset.hit.scale = 1; changed = true; }
          if (preset?.miss?.scale > 1) { preset.miss.scale = 1; changed = true; }
        }
      }
    }

    // Also normalize weapon onToken scales > 1 in stored config
    if (stored.weapons) {
      for (const [key, preset] of Object.entries(stored.weapons)) {
        if ((preset?.type === "onToken" || !preset?.type) && preset?.hit?.scale > 1) {
          preset.hit.scale = 1;
          changed = true;
        }
      }
    }

    // Mark migration done and persist
    stored.__migrations = { ...(stored.__migrations ?? {}), [MIGRATION_FLAG]: true };
    await game.settings.set(MODULE_ID, "animationFxConfig", stored);
    if (changed) {
      console.log("[vagabond-crawler] Animation FX scale migration v1 applied.");
    }

    // npcActions._default removal (separate migration — runs independently).
    await this._migrateRemoveNpcDefault();
  },

  async _migrateRemoveNpcDefault() {
    if (!game.user.isGM) return;
    const MIGRATION_FLAG = "npcDefaultRemoval_v1";
    const stored = game.settings.get(MODULE_ID, "animationFxConfig") ?? {};
    if (stored.__migrations?.[MIGRATION_FLAG]) return;
    if (stored.npcActions?._default) {
      delete stored.npcActions._default;
      console.log("[vagabond-crawler] Removed legacy Generic NPC Action fallback.");
    }
    stored.__migrations = { ...(stored.__migrations ?? {}), [MIGRATION_FLAG]: true };
    await game.settings.set(MODULE_ID, "animationFxConfig", stored);
  },

  async _wrapNpcAction() {
    let VCC;
    try {
      ({ VagabondChatCard: VCC } = await import("../../../systems/vagabond/module/helpers/chat-card.mjs"));
    } catch (err) {
      console.warn(`${MODULE_ID} | AnimationFx: could not import VagabondChatCard — actionIndex wrap skipped`, err);
      return;
    }
    if (!VCC || typeof VCC.npcAction !== "function") return;
    // Avoid double-wrapping
    if (VCC.npcAction.__vcAnimFxWrapped) return;

    const original = VCC.npcAction.bind(VCC);
    const wrapped = async function (actor, action, actionIndex, targets, ...rest) {
      // VagabondChatCard.npcAction is reused by the system for both actions
      // (system.actions[i]) AND abilities (system.abilities[i] — see
      // _onClickAbilityName at chat-card.mjs:1070). The `actionIndex` in those
      // two calls belongs to different arrays. If we blindly stamp the flag,
      // clicking an ability like "Pack Hunter" would make _resolve read
      // actor.system.actions[0] and play whatever action sits there.
      //
      // Only install the stamping hook when the passed `action` is really one
      // of the actor's actions at the given index.
      const actual = actor?.system?.actions?.[actionIndex];
      const isRealAction = !!actual && (actual === action || actual.name === action?.name);
      if (!isRealAction) {
        return await original(actor, action, actionIndex, targets, ...rest);
      }

      // Stash actionIndex and tokenId on the FIRST preCreateChatMessage that matches this actor.
      // We keep the hook alive across non-matching messages (e.g. Pack Hunter notices posted by
      // npc-abilities before the action card) and only deregister once we've stamped a message
      // or when the npcAction call finishes (via the `finally` block).
      let stamped = false;
      const preHook = Hooks.on("preCreateChatMessage", (msg, data, opts, userId) => {
        if (stamped) return;
        const flags = foundry.utils.getProperty(data, "flags.vagabond") ?? {};
        if (flags.actorId !== actor?.id) return;  // skip non-matching messages
        const update = {};
        if (typeof flags.actionIndex !== "number") {
          update["flags.vagabond.actionIndex"] = actionIndex;
        }
        if (!flags.tokenId) {
          let tok = null;
          const controlled = canvas.tokens?.controlled ?? [];
          for (const c of controlled) {
            if (c.actor?.id === actor.id) { tok = c; break; }
          }
          if (!tok) {
            const tokens = actor.getActiveTokens?.(false, false) ?? [];
            tok = tokens.find(t => t.scene?.id === canvas.scene?.id) ?? tokens[0] ?? null;
          }
          if (tok) update["flags.vagabond.tokenId"] = tok.id;
        }
        if (Object.keys(update).length > 0) msg.updateSource(update);
        stamped = true;
        Hooks.off("preCreateChatMessage", preHook);
      });
      try {
        return await original(actor, action, actionIndex, targets, ...rest);
      } finally {
        // Safety net: if no matching message ever appeared, still clean up the hook.
        if (!stamped) Hooks.off("preCreateChatMessage", preHook);
      }
    };
    wrapped.__vcAnimFxWrapped = true;
    VCC.npcAction = wrapped;
    console.log(`${MODULE_ID} | AnimationFx: wrapped VagabondChatCard.npcAction (actionIndex flag)`);
  },

  getConfig() {
    const stored = game.settings.get(MODULE_ID, "animationFxConfig") ?? {};
    // Use the live JB2A-aware defaults if available, else fall back to the empty stub.
    const defaults = buildDefaultAnimationFxConfig() ?? foundry.utils.deepClone(DEFAULT_ANIMATION_FX_CONFIG);
    return foundry.utils.mergeObject(
      foundry.utils.deepClone(defaults),
      stored,
      { inplace: false }
    );
  },

  _matchesPattern(name, patterns) {
    if (!patterns || !name) return false;
    try {
      return new RegExp(patterns, "i").test(name);
    } catch (e) {
      return false;
    }
  },

  /**
   * Return the length of the matched substring for this pattern against `name`,
   * or 0 if the pattern doesn't match. Used as a specificity score to break
   * ties when multiple presets match the same action/item name — more specific
   * patterns (those matching longer substrings) win over generic catch-alls.
   *
   * Example: action "Frost Breath"
   *   - pattern "breath|exhale|spray|cone of"  → matches "Breath"       (6)
   *   - pattern "Frost Breath"                 → matches "Frost Breath" (12)  ← wins
   */
  _patternMatchScore(name, patterns) {
    if (!patterns || !name) return 0;
    try {
      const m = new RegExp(patterns, "i").exec(name);
      return m ? m[0].length : 0;
    } catch (e) {
      return 0;
    }
  },

  /**
   * Pick the most specific preset from a name-keyed preset map, ignoring `_default`.
   * Returns the preset with the longest matched substring, or null if nothing matches.
   */
  _pickBestPattern(name, presetMap) {
    let best = null;
    let bestScore = 0;
    for (const [key, preset] of Object.entries(presetMap ?? {})) {
      if (key === "_default") continue;
      const score = this._patternMatchScore(name, preset?.patterns);
      if (score > bestScore) { best = preset; bestScore = score; }
    }
    return best;
  },

  _resolveWeapon(item, config) {
    const name = item.name ?? "";
    if (this._isCategoryEnabled("weapons")) {
      const best = this._pickBestPattern(name, config.weapons);
      if (best) return best;
    }
    if (this._isCategoryEnabled("weaponSkillFallbacks")) {
      const skill = item.system?.weaponSkill;
      if (skill && config.weaponSkillFallbacks?.[skill]) return config.weaponSkillFallbacks[skill];
      return config.weaponSkillFallbacks?._default ?? null;
    }
    return null;
  },

  _resolveAlchemical(item, config) {
    if (!this._isCategoryEnabled("alchemical")) return null;
    const name = (item.name ?? "").toLowerCase();
    if (config.alchemical?.[name]) return config.alchemical[name];
    for (const [key, preset] of Object.entries(config.alchemical ?? {})) {
      if (key === "_default") continue;
      if (name.includes(key)) return preset;
    }
    return config.alchemical?._default ?? null;
  },

  _resolveGear(item, config) {
    if (!this._isCategoryEnabled("gear")) return null;
    const name = (item.name ?? "").toLowerCase();
    if (config.gear?.[name]) return config.gear[name];
    for (const [key, preset] of Object.entries(config.gear ?? {})) {
      if (name.includes(key)) return preset;
    }
    return null; // No default for gear
  },

  _resolveNpcAction(actor, actionIndex, config) {
    if (!this._isCategoryEnabled("npcActions")) return null;
    const action = actor.system?.actions?.[actionIndex];
    if (!action) return null;
    // Most-specific-pattern wins. `Frost Breath` beats the generic `breath` preset
    // because its matched substring is longer. Insertion order no longer matters.
    return this._pickBestPattern(action.name, config.npcActions);
  },

  _getSourceToken(actor, preferredTokenId = null) {
    if (!actor) return null;
    if (preferredTokenId) {
      const tok = canvas.tokens.get(preferredTokenId);
      if (tok && tok.actor?.id === actor.id) return tok;
    }
    const controlled = canvas.tokens.controlled;
    for (const c of controlled) {
      if (c.actor?.id === actor.id) return c;
    }
    const tokens = actor.getActiveTokens(false, false);
    const sceneTok = tokens.find(t => t.scene?.id === canvas.scene?.id);
    return sceneTok ?? tokens[0] ?? null;
  },

  _getTargets(message) {
    const stored = message.flags?.vagabond?.targetsAtRollTime;
    if (Array.isArray(stored) && stored.length > 0) {
      // `stored` can take several shapes depending on which system path wrote it:
      //   - array of token-ID strings
      //   - array of serialized TokenDocuments (has `_id`)
      //   - array of `{ tokenId, sceneId, actorId, ... }` summary objects (NPC action path)
      // Normalize each entry to a token-ID string, then look up the placeable.
      return stored
        .map(entry => {
          if (typeof entry === "string") return entry;
          return entry?.tokenId ?? entry?._id ?? entry?.id ?? null;
        })
        .filter(Boolean)
        .map(id => canvas.tokens.get(id))
        .filter(t => t);
    }
    return Array.from(game.user.targets).map(t => t.document)
      .map(td => canvas.tokens.get(td.id)).filter(t => t);
  },

  _determineOutcome(message) {
    const flag = message.flags?.vagabond?.rollOutcome;
    if (flag === "hit" || flag === "miss") return flag;
    const content = message.content ?? "";
    if (/\bMISS\b/i.test(content) && !/\bHIT\b/i.test(content)) return "miss";
    return "hit";
  },

  async _onChatMessage(message, options, userId) {
    if (userId !== game.userId) return;
    if (!game.settings.get("vagabond-crawler", "animationFxEnabled")) return;

    const flags = message.flags?.vagabond;
    if (!flags?.actorId) return;
    const actor = game.actors.get(flags.actorId);
    if (!actor) return;

    let preset = null;
    if (flags.itemId) {
      const item = actor.items.get(flags.itemId);
      if (!item) return;
      // Weapon animations are played by the system's own Item FX pipeline
      // (we sync the config there via syncToItems). Skip crawler playback.
      if (item.system?.equipmentType === "weapon") return;
      preset = this._resolve({ item });
    } else if (typeof flags.actionIndex === "number") {
      preset = this._resolve({ actor, actionIndex: flags.actionIndex });
    }
    if (!preset) return;

    // Determine outcome, but for NPC actions (triggered via action menu)
    // always treat as "hit" — they don't roll, so hit/miss is meaningless.
    const isNpcAction = typeof message.flags?.vagabond?.actionIndex === "number"
                      && !message.flags?.vagabond?.itemId;
    const outcome = isNpcAction ? "hit" : this._determineOutcome(message);
    const triggerOn = game.settings.get("vagabond-crawler", "animationFxTriggerOn");
    if (!isNpcAction && outcome === "miss" && triggerOn === "hit") return;

    const sourceToken = this._getSourceToken(actor, message.flags?.vagabond?.tokenId ?? null);
    if (!sourceToken) return;
    const targets = this._getTargets(message);

    await this._play(preset, sourceToken, targets, outcome);
  },

  _resolve(source) {
    const config = this.getConfig();

    // NPC action path
    if (source.actor && typeof source.actionIndex === "number") {
      const actorOverrides = source.actor.getFlag(MODULE_ID, "actionOverrides") ?? {};
      const ov = actorOverrides[source.actionIndex];
      if (ov) {
        if (ov.disabled) return null;
        return ov;
      }
      return this._resolveNpcAction(source.actor, source.actionIndex, config);
    }

    // Item path
    const item = source.item ?? source;
    if (!item?.type) return null;
    if (item.getFlag(MODULE_ID, "disabled")) return null;
    const override = item.getFlag(MODULE_ID, "animationOverride");
    if (override) return override;

    // Skip unsupported types
    if (item.type === "spell") return null;
    const equipType = item.system?.equipmentType;
    if (equipType === "armor" || equipType === "relic") return null;

    if (equipType === "weapon") return this._resolveWeapon(item, config);
    if (equipType === "alchemical" || item.type === "alchemical") return this._resolveAlchemical(item, config);
    if (equipType === "gear" || item.type === "gear") return this._resolveGear(item, config);

    return null;
  },

  // ── Playback helpers ────────────────────────────────────────────────────────

  _getClientScale() {
    return game.settings.get(MODULE_ID, "animationFxScale") ?? 1.0;
  },

  _getMasterVolume() {
    return game.settings.get(MODULE_ID, "animationFxMasterVolume") ?? 0.8;
  },

  async _playSound(block) {
    if (!block?.sound) return;
    if (!game.settings.get(MODULE_ID, "animationFxSoundEnabled")) return;
    // Alias-aware module check: psfx ⟷ psfx-patreon, JB2A_DnD5e ⟷ jb2a_patreon.
    const missing = this._fileReferencesMissingModule(block.sound);
    if (missing) {
      console.debug(`[vagabond-crawler] skipping sound — "${missing}" not active (src: ${block.sound})`);
      return;
    }
    const volume = (block.soundVolume ?? 0.6) * this._getMasterVolume();
    try {
      await foundry.audio.AudioHelper.play({ src: block.sound, volume, autoplay: true, loop: false });
    } catch (e) {
      console.warn("[vagabond-crawler] animation sound failed:", e);
    }
  },

  _computeConeAngle(sourceToken, targets) {
    const sx = sourceToken.x + (sourceToken.w / 2);
    const sy = sourceToken.y + (sourceToken.h / 2);
    let cx = 0, cy = 0;
    for (const t of targets) {
      cx += t.x + (t.w / 2);
      cy += t.y + (t.h / 2);
    }
    cx /= targets.length;
    cy /= targets.length;
    return Math.toDegrees(Math.atan2(cy - sy, cx - sx));
  },

  async _play(preset, sourceToken, targets, outcome = "hit") {
    if (!preset) return;
    if (typeof Sequence === "undefined") return;
    const block = preset[outcome];
    // Skip animations whose assets live in a module that isn't installed/active.
    // Prevents Sequencer from throwing on unresolved files / jb2a DB lookups.
    if (block?.file) {
      const missing = this._fileReferencesMissingModule(block.file);
      if (missing) {
        console.debug(`[vagabond-crawler] skipping "${preset.label ?? "?"}" — "${missing}" not active (file: ${block.file})`);
        return;
      }
    }
    if (!block?.file) return;

    const globalScale = this._getClientScale();
    const fadeIn = preset.fadeIn ?? 200;
    const fadeOut = preset.fadeOut ?? 200;
    const opacity = preset.opacity ?? 1.0;

    // Persistent gear toggle
    if (preset.persist && sourceToken) {
      const effectName = `${MODULE_ID}-fx-${preset.label}-${sourceToken.id}`;
      const existing = Sequencer.EffectManager.getEffects({ name: effectName });
      if (existing.length > 0) {
        await Sequencer.EffectManager.endEffects({ name: effectName });
        return;
      }
      const seq = new Sequence(MODULE_ID);
      seq.effect()
        .file(block.file)
        .atLocation(sourceToken)
        .scale(block.scale * globalScale)
        .fadeIn(fadeIn)
        .fadeOut(fadeOut)
        .opacity(opacity)
        .persist()
        .name(effectName);
      await seq.play();
      await this._playSound(block);
      return;
    }

    // Non-persistent: iterate targets with stagger.
    // For projectile/cone, we need a target at a different location than the source,
    // otherwise Sequencer's stretchTo warns about zero distance. Fall back to source
    // only for onToken animations.
    const needsDistance = preset.type === "projectile" || preset.type === "cone";
    let targetList;
    if (targets && targets.length > 0) {
      targetList = needsDistance
        ? targets.filter(t => t && t.id !== sourceToken.id)
        : targets;
    } else {
      targetList = needsDistance ? [] : [sourceToken];
    }
    if (targetList.length === 0) {
      if (needsDistance) {
        console.debug(`[vagabond-crawler] skipping ${preset.type} for "${preset.label ?? "?"}" — no distinct target`);
      }
      return;
    }
    for (let i = 0; i < targetList.length; i++) {
      const target = targetList[i];
      const delay = i * 150;
      setTimeout(() => this._playOne(preset, block, sourceToken, target, targetList, globalScale, fadeIn, fadeOut, opacity), delay);
    }
    await this._playSound(block);
  },

  async _playOne(preset, block, sourceToken, target, allTargets, globalScale, fadeIn, fadeOut, opacity) {
    try {
    const seq = new Sequence(MODULE_ID);
    const effect = seq.effect().file(block.file);

    // Unique name for belt-and-suspenders cleanup of transient effects
    const safetyName = `${MODULE_ID}-fx-transient-${foundry.utils.randomID(8)}`;
    let hardDuration;

    if (preset.type === "projectile") {
      hardDuration = block.duration || 1500;
      // Distance-aware Y scale, matching the system's _beamEffect formula
      // (systems/vagabond/module/helpers/item-sequencer.mjs). Y shrinks with
      // distance^0.73, floored at 3 grids so short beams don't look bloated.
      const baseScale = (block.scale ?? 1) * globalScale;
      const sx = sourceToken.x + ((sourceToken.w ?? 0) / 2);
      const sy = sourceToken.y + ((sourceToken.h ?? 0) / 2);
      const tx = target.x + ((target.w ?? 0) / 2);
      const ty = target.y + ((target.h ?? 0) / 2);
      const dist = Math.hypot(tx - sx, ty - sy);
      const gridSize = canvas?.grid?.size || 100;
      const gridsAway = Math.max(3, dist / gridSize);
      const scaleY = baseScale / Math.pow(gridsAway, 0.73);
      effect
        .atLocation(sourceToken).stretchTo(target)
        .scale({ y: scaleY })
        .fadeIn(100).fadeOut(100).opacity(opacity)
        .duration(hardDuration)
        .name(safetyName);
    } else if (preset.type === "cone") {
      hardDuration = block.duration ?? 1500;
      const angle = this._computeConeAngle(sourceToken, allTargets);
      effect
        .atLocation(sourceToken)
        .rotate(-angle)
        .scale(block.scale * globalScale)
        .anchor({ x: 0, y: 0.5 })
        .duration(hardDuration)
        .fadeIn(fadeIn).fadeOut(fadeOut).opacity(opacity)
        .name(safetyName);
    } else {
      // onToken
      hardDuration = block.duration ?? 800;
      const anchorToken = preset.target === "self" ? sourceToken : target;
      effect
        .atLocation(anchorToken)
        .scale(block.scale * globalScale)
        .fadeIn(fadeIn).fadeOut(fadeOut).duration(hardDuration).opacity(opacity)
        .name(safetyName);
      if (typeof block.offsetX === "number") effect.spriteOffset({ x: block.offsetX });
    }

    try {
      await seq.play();
      // Safety net: guarantee cleanup even if the webm has no natural end or is looped
      const cleanupAfter = hardDuration + fadeOut + 200;
      setTimeout(() => {
        try {
          const existing = Sequencer.EffectManager?.getEffects?.({ name: safetyName }) ?? [];
          if (existing.length > 0) {
            Sequencer.EffectManager.endEffects({ name: safetyName });
          }
        } catch (e) { /* silent */ }
      }, cleanupAfter);
    } catch (e) {
      console.warn("[vagabond-crawler] animation play failed:", e);
    }
    } catch (outer) {
      // Catch-all for synchronous Sequencer failures (invalid file path, JB2A
      // database lookup miss, etc.). Without this, a bad preset can throw out
      // of the chat-message hook and derail the action card.
      console.warn(`[vagabond-crawler] animation setup failed for "${preset?.label ?? "?"}" (${block?.file ?? "?"}):`, outer);
    }
  },

  // ── Override dialog ──────────────────────────────────────────────────────

  /**
   * Open the dedicated Animation FX override window.
   * kind: "item" → target is an Item (weapon / alchemical / gear)
   * kind: "action" → target is an Actor, index is the action index
   * Unlinked-token synthetic actors are redirected to the world actor inside
   * the app constructor.
   */
  openOverrideDialog(target, kind, index = null) {
    const app = new AnimationFxOverrideApp({ kind, target, index });
    app.render(true);
  },

  _registerSheetButtons() {
    // Item sheet header button — v13 fires getHeaderControls{ClassName} (callAll variant).
    // The callback receives (app, controlsArray); push a control object onto the array.
    const itemHeaderHook = (app, controls) => {
      const item = app.document;
      if (!item) return;
      const eq = item.system?.equipmentType;
      const eligible = eq === "weapon" || item.type === "alchemical" || item.type === "gear" || eq === "gear";
      if (!eligible) return;
      controls.push({
        icon: "fas fa-film",
        label: "Animation FX",
        action: "vcfx-override",
        visible: true,
        onClick: () => this.openOverrideDialog(item, "item"),
      });
    };
    // v13 fires getHeaderControlsVagabondItemSheet (the most-derived hook name).
    // Parent-class variants (ItemSheetV2, ApplicationV2) also fire but we only need one.
    Hooks.on("getHeaderControlsVagabondItemSheet", itemHeaderHook);

    // NPC sheet action rows — inject ⚡ button next to each [data-action-index] row.
    // v13 fires renderVagabondNPCSheet(sheet) where sheet.element is the HTMLElement.
    const npcHook = (sheet) => {
      const actor = sheet.actor ?? sheet.document;
      if (!actor || actor.type !== "npc") return;
      const el = sheet.element;
      if (!el) return;
      const rows = el.querySelectorAll("[data-action-index]");
      rows.forEach(row => {
        if (row.querySelector(".vcfx-action-override")) return;
        const idx = Number(row.dataset.actionIndex);
        if (Number.isNaN(idx)) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vcfx-action-override";
        btn.title = "Animation FX override";
        btn.innerHTML = "⚡";
        btn.style.cssText = "margin-left:auto;padding:0 4px;font-size:0.9em;cursor:pointer;background:transparent;border:none;opacity:0.7;";
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.openOverrideDialog(actor, "action", idx);
        });
        row.appendChild(btn);
      });
    };
    Hooks.on("renderVagabondNPCSheet", npcHook);
    Hooks.on("renderActorSheet", npcHook);  // fallback
  },

  // ── Sync to Items ───────────────────────────────────────────────────────────

  _presetToSystemFx(preset) {
    if (!preset?.hit?.file) return null;
    const animType = preset.type === "projectile" ? "ranged"
                   : preset.type === "cone" ? "cone"
                   : "melee";
    return {
      enabled: true,
      animType,
      hitFile: preset.hit.file,
      hitScale: preset.hit.scale ?? 1,
      hitOffsetX: preset.hit.offsetX ?? 0,
      hitDuration: preset.hit.duration ?? 800,
      hitSound: preset.hit.sound ?? "",
      missFile: preset.miss?.file ?? "",
      missScale: preset.miss?.scale ?? 1,
      missDuration: preset.miss?.duration ?? 600,
      missSound: preset.miss?.sound ?? "",
      soundVolume: preset.hit.soundVolume ?? preset.miss?.soundVolume ?? 0.6,
    };
  },

  async syncToItems({ confirm = true } = {}) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can sync Animation FX to items.");
      return null;
    }
    const worldActors = game.actors.filter(a => !a.pack);

    // Count what WOULD be updated first
    const targets = [];
    for (const actor of worldActors) {
      for (const item of actor.items) {
        const et = item.system?.equipmentType;
        if (et !== "weapon") continue;
        const preset = this._resolve({ item });
        if (!preset) continue;
        const fx = this._presetToSystemFx(preset);
        if (!fx) continue;
        targets.push({ item, actor, preset, fx });
      }
    }

    if (targets.length === 0) {
      ui.notifications.info("No matching weapon items found to sync.");
      return { updated: 0, actors: 0 };
    }

    if (confirm) {
      const actorCount = new Set(targets.map(t => t.actor.id)).size;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Sync Animation FX to Items" },
        content: `<p>This will update <b>${targets.length}</b> weapon(s) across <b>${actorCount}</b> actor(s).</p>
                  <p>Each weapon's <b>Item FX (Sequencer)</b> panel will be overwritten with the matching preset from the Animation FX config.</p>
                  <p>Continue?</p>`,
      });
      if (!ok) return null;
    }

    // Batch updates per actor
    const byActor = new Map();
    for (const t of targets) {
      if (!byActor.has(t.actor)) byActor.set(t.actor, []);
      byActor.get(t.actor).push({ _id: t.item.id, "system.itemFx": t.fx });
    }

    let updated = 0;
    let errored = 0;
    for (const [actor, updates] of byActor) {
      try {
        await actor.updateEmbeddedDocuments("Item", updates);
        updated += updates.length;
      } catch (e) {
        errored += updates.length;
        console.error(`[vagabond-crawler] sync failed for actor ${actor.name}:`, e);
      }
    }

    ui.notifications.info(`Animation FX synced: ${updated} weapon(s) across ${byActor.size} actor(s)${errored ? ` (${errored} failed)` : ""}.`);
    return { updated, actors: byActor.size, errored };
  },

  // ── Persistent light FX helpers ────────────────────────────────────────────

  _persistentNameFor(preset, token) {
    return `vagabond-crawler-fx-${preset.label}-${token.id}`;
  },

  async startPersistent(preset, token) {
    if (!preset || !preset.hit?.file || !token) return;
    if (!preset.persist) return;
    if (typeof Sequencer === "undefined") return;
    if (!game.settings.get(MODULE_ID, "animationFxEnabled")) return;
    const name = this._persistentNameFor(preset, token);
    const existing = Sequencer.EffectManager.getEffects({ name }) ?? [];
    if (existing.length > 0) return; // already running
    const globalScale = this._getClientScale();
    const fadeIn = preset.fadeIn ?? 200;
    const fadeOut = preset.fadeOut ?? 200;
    const opacity = preset.opacity ?? 1.0;
    const seq = new Sequence(MODULE_ID);
    seq.effect()
      .file(preset.hit.file)
      .atLocation(token)
      .scale(preset.hit.scale * globalScale)
      .fadeIn(fadeIn)
      .fadeOut(fadeOut)
      .opacity(opacity)
      .persist()
      .name(name);
    try {
      await seq.play();
    } catch (e) {
      console.warn("[vagabond-crawler] startPersistent failed:", e);
    }
    this._playSound(preset.hit);
  },

  async stopPersistent(preset, token) {
    if (!preset || !token) return;
    if (typeof Sequencer === "undefined") return;
    const name = this._persistentNameFor(preset, token);
    const existing = Sequencer.EffectManager.getEffects({ name }) ?? [];
    if (existing.length === 0) return; // already stopped
    try {
      await Sequencer.EffectManager.endEffects({ name });
    } catch (e) {
      console.warn("[vagabond-crawler] stopPersistent failed:", e);
    }
  },

  resolveGearPresetByLightType(lightType) {
    // Maps light-tracker's LIGHT_SOURCES key → gear preset key in the AnimationFx config
    const keyByLightType = {
      torch:              "torch",
      "torch-tindertwig": "torch",
      "torch-sentry":     "torch",
      "torch-repel-beast":"torch",
      "torch-frigidflame":"torch",
      candle:             "torch",
      "candle-calming":   "torch",
      "candle-insectbane":"torch",
      "candle-restful":   "torch",
      "lantern-hooded":   "lantern",
      "lantern-bullseye": "lantern",
      lantern:            "lantern",
      sunrod:             "sunrod",
    };
    const gearKey = keyByLightType[lightType] ?? lightType;
    const config = this.getConfig();
    return config.gear?.[gearKey] ?? null;
  },

  // ── FX cleanup ──────────────────────────────────────────────────────────────

  clearAllFx() {
    if (typeof Sequencer === "undefined") return 0;
    const allEffects = Sequencer.EffectManager?.getEffects?.({}) ?? [];
    const count = allEffects.filter(e =>
      (e?.data?.moduleName === MODULE_ID) || /vagabond-crawler/i.test(e?.data?.name ?? "")
    ).length;
    try {
      // End by module name (covers both persist and transient registered under MODULE_ID)
      Sequencer.EffectManager.endEffects({ moduleName: MODULE_ID });
      // Sweep by name prefix as a fallback
      const remaining = Sequencer.EffectManager?.getEffects?.({}) ?? [];
      for (const fx of remaining) {
        const n = fx?.data?.name ?? "";
        if (/^vagabond-crawler/.test(n)) {
          try { fx.endEffect?.(); } catch {}
        }
      }
    } catch (e) {
      console.warn("[vagabond-crawler] clearAllFx failed:", e);
    }
    ui.notifications.info(`Cleared ${count} Animation FX effect(s).`);
    return count;
  },

  // ── Config UI ───────────────────────────────────────────────────────────────

  async open() {
    new AnimationFxConfigApp().render(true);
  },
};
