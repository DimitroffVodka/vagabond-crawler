// scripts/animation-fx-override.mjs
// Full-featured editor for per-item and per-action Animation FX overrides.
// Mirrors the field set of the global AnimationFxConfigApp so sheet tweaks
// have parity with the global NPC action presets.

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "vagabond-crawler";

/**
 * Options:
 *   { kind: "item", target: Item }
 *   { kind: "action", target: Actor, index: Number }
 *
 * For unlinked-token NPC sheets, the caller should pass the world actor. The
 * wrapper in animation-fx.mjs does this redirection automatically.
 */
export class AnimationFxOverrideApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-animation-fx-override-{id}",
    tag: "form",
    window: { title: "Animation FX Override", resizable: true, contentClasses: ["vcfx-config", "vcfx-override"] },
    position: { width: 720, height: 620 },
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      save: AnimationFxOverrideApp.#onSave,
      saveAndClose: AnimationFxOverrideApp.#onSaveAndClose,
      cancel: AnimationFxOverrideApp.#onCancel,
      preview: AnimationFxOverrideApp.#onPreview,
      promoteToGlobal: AnimationFxOverrideApp.#onPromoteToGlobal,
      pickFile: AnimationFxOverrideApp.#onPickFile,
      pickSound: AnimationFxOverrideApp.#onPickSound,
    },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/animation-fx-override.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this._kind = options.kind;
    this._editTarget = options.target;  // avoid clashing with ApplicationV2 internals
    this._index = options.index ?? null;
    // Redirect unlinked-token synthetic actors to the world actor so flags land
    // where _onChatMessage reads them.
    if (this._editTarget?.isToken) {
      const world = game.actors.get(this._editTarget.id);
      if (world) this._editTarget = world;
    }
    this._preset = this._loadPreset();
  }

  get title() {
    if (this._kind === "item") return `Animation FX: ${this._editTarget?.name}`;
    const action = this._editTarget?.system?.actions?.[this._index];
    const name = action?.name ?? `Action ${this._index}`;
    return `Action Override: ${this._editTarget?.name} — ${name}`;
  }

  _loadPreset() {
    if (this._kind === "item") {
      const override = this._editTarget.getFlag(MODULE_ID, "animationOverride") ?? {};
      const disabled = !!this._editTarget.getFlag(MODULE_ID, "disabled");
      return this._normalize({ ...override, disabled });
    }
    const all = this._editTarget.getFlag(MODULE_ID, "actionOverrides") ?? {};
    const raw = all[this._index] ?? {};
    return this._normalize(raw);
  }

  _normalize(preset) {
    return {
      label: preset.label ?? "",
      disabled: !!preset.disabled,
      type: preset.type ?? "onToken",
      target: preset.target ?? "target",
      persist: !!preset.persist,
      hit: {
        file: preset.hit?.file ?? "",
        scale: preset.hit?.scale ?? 1,
        duration: preset.hit?.duration ?? 800,
        offsetX: preset.hit?.offsetX ?? "",
        sound: preset.hit?.sound ?? "",
        soundVolume: preset.hit?.soundVolume ?? "",
      },
      miss: {
        file: preset.miss?.file ?? "",
        scale: preset.miss?.scale ?? "",
        duration: preset.miss?.duration ?? "",
        sound: preset.miss?.sound ?? "",
        soundVolume: preset.miss?.soundVolume ?? "",
      },
    };
  }

  async _prepareContext() {
    const isAction = this._kind === "action";
    const isItem = this._kind === "item";
    const eq = isItem ? this._editTarget.system?.equipmentType : null;
    return {
      preset: this._preset,
      targetLabel: isAction
        ? `${this._editTarget.system?.actions?.[this._index]?.name ?? `Action ${this._index}`}`
        : this._editTarget.name,
      scopeNote: isAction ? `override on ${this._editTarget.name}` : null,
      showPromote: isAction,
      showPersist: isItem && (eq === "gear" || this._editTarget.type === "gear"),
      hasMissFile: !!this._preset.miss?.file,
    };
  }

  /**
   * Collect current form state into a preset object shaped like the global config entries.
   * Empty strings and null/NaN numerics collapse to absent fields so the saved
   * preset stays minimal (and so _play's `?? defaults` fallbacks work).
   */
  _readForm() {
    const formEl = this.element instanceof HTMLFormElement
      ? this.element
      : this.element?.querySelector("form") ?? this.element;
    if (!formEl) return null;
    const raw = new FormDataExtended(formEl).object;

    const numOrUndef = v => {
      if (v === "" || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const strOrEmpty = v => (v ?? "").toString().trim();

    const preset = {
      label: strOrEmpty(raw.label),
      disabled: !!raw.disabled,
      type: raw.type ?? "onToken",
      target: raw.target ?? "target",
      hit: {
        file: strOrEmpty(raw["hit.file"]),
        scale: numOrUndef(raw["hit.scale"]) ?? 1,
        duration: numOrUndef(raw["hit.duration"]) ?? 800,
      },
    };
    const offX = numOrUndef(raw["hit.offsetX"]);
    if (offX !== undefined) preset.hit.offsetX = offX;
    const hitSound = strOrEmpty(raw["hit.sound"]);
    if (hitSound) preset.hit.sound = hitSound;
    const hitVol = numOrUndef(raw["hit.soundVolume"]);
    if (hitVol !== undefined) preset.hit.soundVolume = hitVol;

    const missFile = strOrEmpty(raw["miss.file"]);
    if (missFile) {
      preset.miss = {
        file: missFile,
        scale: numOrUndef(raw["miss.scale"]) ?? 1,
        duration: numOrUndef(raw["miss.duration"]) ?? 600,
      };
      const missSound = strOrEmpty(raw["miss.sound"]);
      if (missSound) preset.miss.sound = missSound;
      const missVol = numOrUndef(raw["miss.soundVolume"]);
      if (missVol !== undefined) preset.miss.soundVolume = missVol;
    }

    if (raw.persist) preset.persist = true;
    return preset;
  }

  async _persist(preset) {
    const hasContent = preset.disabled || !!preset.hit.file;
    if (this._kind === "item") {
      await this._editTarget.setFlag(MODULE_ID, "disabled", !!preset.disabled);
      if (preset.hit.file || preset.disabled) {
        await this._editTarget.setFlag(MODULE_ID, "animationOverride", preset);
      } else {
        await this._editTarget.unsetFlag(MODULE_ID, "animationOverride");
      }
      // Mirror to system.itemFx for weapon/alchemical items — those are played
      // by the Vagabond system's own pipeline, not by the crawler.
      const eq = this._editTarget.system?.equipmentType;
      const usesSystemFx = eq === "weapon" || eq === "alchemical" || this._editTarget.type === "alchemical";
      if (usesSystemFx) {
        if (preset.disabled) {
          await this._editTarget.update({ "system.itemFx.enabled": false });
        } else if (preset.hit.file) {
          const fx = game.vagabondCrawler.animationFx._presetToSystemFx(preset);
          if (fx) await this._editTarget.update({ "system.itemFx": fx });
        } else {
          await this._editTarget.update({ "system.itemFx.enabled": true });
        }
      }
    } else {
      const overrides = foundry.utils.deepClone(this._editTarget.getFlag(MODULE_ID, "actionOverrides") ?? {});
      if (hasContent) {
        overrides[this._index] = preset;
      } else {
        delete overrides[this._index];
      }
      await this._editTarget.setFlag(MODULE_ID, "actionOverrides", overrides);
    }
    this._flashSaved();
  }

  _flashSaved() {
    const el = this.element?.querySelector(".vcfx-save-flash");
    if (!el) return;
    el.style.transition = "none"; el.style.opacity = "1";
    requestAnimationFrame(() => { el.style.transition = "opacity 0.6s ease"; el.style.opacity = "0"; });
  }

  static async #onSave(event, target) {
    const preset = this._readForm();
    if (!preset) return;
    this._preset = this._normalize(preset);
    await this._persist(preset);
    // Re-render from the persisted state so the DOM can't drift out of sync
    // with the flags (e.g. checkbox `checked` attribute vs `.checked` property).
    this.render();
  }

  static async #onSaveAndClose(event, target) {
    const preset = this._readForm();
    if (!preset) return;
    await this._persist(preset);
    this.close();
  }

  static async #onCancel() { this.close(); }

  static async #onPreview() {
    const preset = this._readForm();
    if (!preset?.hit?.file) {
      ui.notifications.warn("Set a hit file before previewing.");
      return;
    }
    const source = canvas.tokens.controlled[0]
      ?? (this._kind === "action" ? this._editTarget.getActiveTokens?.()[0] : null);
    if (!source) {
      ui.notifications.warn("Select a token on the canvas first (to play the preview from).");
      return;
    }
    let targets;
    const needsDirection = preset.type === "projectile" || preset.type === "cone";
    if (needsDirection) {
      const userTarget = game.user.targets.first();
      if (userTarget && userTarget !== source) {
        targets = [userTarget];
      } else {
        targets = [{ x: source.x + (source.w ?? 0) + 400, y: source.y, w: 1, h: source.h ?? 1, id: "_preview" }];
      }
    } else {
      targets = [source];
    }
    await game.vagabondCrawler.animationFx._play(preset, source, targets, event.shiftKey ? "miss" : "hit");
  }

  static async #onPromoteToGlobal() {
    if (this._kind !== "action") return;
    const preset = this._readForm();
    if (!preset?.hit?.file) {
      ui.notifications.warn("Set a hit file before promoting to the global config.");
      return;
    }
    const action = this._editTarget.system?.actions?.[this._index];
    const suggestedKey = (action?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
      || `action_${this._index}`;
    const suggestedPattern = action?.name ?? "";

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Promote to Global NPC Action" },
      content: `
        <div style="display:flex;flex-direction:column;gap:0.4em;padding:0.4em 0">
          <p style="margin:0;font-size:0.9em;opacity:0.85">
            This will copy the current override into <b>Animation FX Configuration → NPC Actions</b>
            as a named preset. Any NPC whose action name matches the <b>Pattern</b> will use this animation.
          </p>
          <label>Key <input name="key" type="text" value="${suggestedKey}" required style="width:100%"/></label>
          <label>Label <input name="label" type="text" value="${preset.label || action?.name || suggestedKey}" style="width:100%"/></label>
          <label>Pattern (regex, case-insensitive)
            <input name="pattern" type="text" value="${suggestedPattern}" style="width:100%"/>
          </label>
          <p style="margin:0;font-size:0.8em;opacity:0.6">
            Example: <code>bite|maul</code> matches "Bite", "Vicious Maul", etc.
          </p>
        </div>`,
      ok: {
        label: "Promote",
        callback: (ev, btn) => {
          const f = btn.form;
          return {
            key: (f.elements.key?.value ?? "").trim().toLowerCase(),
            label: (f.elements.label?.value ?? "").trim(),
            pattern: (f.elements.pattern?.value ?? "").trim(),
          };
        },
      },
      rejectClose: false,
    });
    if (!result || !result.key) return;
    if (!/^[a-z0-9_\-]+$/.test(result.key)) {
      ui.notifications.warn("Key must be lowercase letters, numbers, underscore, or hyphen.");
      return;
    }

    const stored = game.settings.get(MODULE_ID, "animationFxConfig") ?? {};
    const clone = foundry.utils.deepClone(stored);
    clone.npcActions ??= {};
    if (clone.npcActions[result.key]) {
      const overwrite = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Overwrite?" },
        content: `<p>A global preset with key <b>${result.key}</b> already exists. Overwrite?</p>`,
      });
      if (!overwrite) return;
    }
    clone.npcActions[result.key] = {
      label: result.label || result.key,
      patterns: result.pattern,
      type: preset.type,
      target: preset.target,
      hit: foundry.utils.deepClone(preset.hit),
      ...(preset.miss ? { miss: foundry.utils.deepClone(preset.miss) } : {}),
    };
    await game.settings.set(MODULE_ID, "animationFxConfig", clone);
    ui.notifications.info(`[Animation FX] Promoted to global NPC action "${result.key}" (pattern: ${result.pattern || "(none)"})`);
  }

  static async #onPickFile(event, target) {
    const fieldName = target.dataset.target;
    const input = this.element.querySelector(`[name="${fieldName}"]`);
    new foundry.applications.apps.FilePicker.implementation({
      type: "imagevideo",
      current: input?.value ?? "",
      callback: (path) => { if (input) input.value = path; },
    }).browse();
  }

  static async #onPickSound(event, target) {
    const fieldName = target.dataset.target;
    const input = this.element.querySelector(`[name="${fieldName}"]`);
    new foundry.applications.apps.FilePicker.implementation({
      type: "audio",
      current: input?.value ?? "",
      callback: (path) => { if (input) input.value = path; },
    }).browse();
  }
}
