// scripts/light-sources-config.mjs
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "vagabond-crawler";

/**
 * Human-readable labels for each light source key.
 */
const LIGHT_SOURCE_LABELS = {
  "torch":              "Torch",
  "lantern-hooded":     "Lantern, Hooded",
  "lantern-bullseye":   "Lantern, Bullseye",
  "candle":             "Candle",
  "candle-calming":     "Candle, Calming",
  "candle-insectbane":  "Candle, Insectbane",
  "candle-restful":     "Candle, Restful",
  "sunrod":             "Sunrod",
  "torch-tindertwig":   "Torch, Tindertwig",
  "torch-sentry":       "Torch, Sentry",
  "torch-repel-beast":  "Torch, Repel Beast",
  "torch-frigidflame":  "Torch, Frigidflame",
};

/** Known Foundry v13 light animation type values. */
const ANIMATION_TYPES = [
  { value: "none",          label: "None" },
  { value: "torch",         label: "Torch" },
  { value: "sunburst",      label: "Sunburst" },
  { value: "pulse",         label: "Pulse" },
  { value: "chroma",        label: "Chroma" },
  { value: "wave",          label: "Wave" },
  { value: "fog",           label: "Fog" },
  { value: "smokepatch",    label: "Smoke Patch" },
  { value: "emanation",     label: "Emanation" },
  { value: "ghost",         label: "Ghost" },
  { value: "energy",        label: "Energy" },
  { value: "grid",          label: "Grid" },
  { value: "hexa",          label: "Hexa" },
  { value: "vortex",        label: "Vortex" },
  { value: "radialrainbow", label: "Radial Rainbow" },
  { value: "roiling",       label: "Roiling" },
  { value: "siren",         label: "Siren" },
  { value: "luminous",      label: "Luminous" },
  { value: "starlight",     label: "Starlight" },
  { value: "fairy",         label: "Fairy" },
  { value: "witchwave",     label: "Witch Wave" },
  { value: "rainbowswirl",  label: "Rainbow Swirl" },
];

/** Get the live animation types from CONFIG.Canvas.lightAnimations if available,
 *  supplemented/overridden by our known list. */
function _getAnimationTypes() {
  const live = CONFIG?.Canvas?.lightAnimations;
  if (live && typeof live === "object") {
    const liveTypes = Object.entries(live).map(([value, data]) => ({
      value,
      label: data.label ? game.i18n.localize(data.label) : value,
    }));
    // Prepend "none" if not present
    if (!liveTypes.find(t => t.value === "none")) {
      liveTypes.unshift({ value: "none", label: "None" });
    }
    return liveTypes;
  }
  return ANIMATION_TYPES;
}

export class LightSourcesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-light-sources-config",
    tag: "form",
    window: { title: "Light Sources Configuration", resizable: true },
    position: { width: 820, height: 700 },
    form: {
      handler: LightSourcesConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: false,
    },
    actions: {
      selectSource:    LightSourcesConfigApp.#onSelectSource,
      resetSource:     LightSourcesConfigApp.#onResetSource,
      resetAll:        LightSourcesConfigApp.#onResetAll,
      saveAndClose:    LightSourcesConfigApp.#onSaveAndClose,
      cancel:          LightSourcesConfigApp.#onCancel,
      testOnToken:     LightSourcesConfigApp.#onTestOnToken,
      stopTest:        LightSourcesConfigApp.#onStopTest,
    },
  };

  /**
   * Tokens whose `light` we transiently overwrote via Test on Token.
   * Stored as `"<sceneId>:<tokenId>"` so cleanup works even after the GM
   * navigates to a different scene before closing the window.
   */
  _testedTokens = new Set();

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/light-sources-config.hbs" },
  };

  /** Currently selected source key. */
  _selectedKey = "torch";
  /** Working copy of the config (editable, not yet persisted). */
  _workingConfig = null;

  async _prepareContext() {
    if (!this._workingConfig) {
      this._workingConfig = foundry.utils.deepClone(
        game.settings.get(MODULE_ID, "lightSourcesConfig")
      );
    }

    const animTypes = _getAnimationTypes();
    const sourceList = Object.keys(LIGHT_SOURCE_LABELS).map(key => ({
      key,
      label: LIGHT_SOURCE_LABELS[key],
      active: key === this._selectedKey,
    }));

    const selected = this._workingConfig[this._selectedKey] ?? {};
    const anim = selected.animation ?? {};

    return {
      sourceList,
      selectedKey: this._selectedKey,
      selectedLabel: LIGHT_SOURCE_LABELS[this._selectedKey] ?? this._selectedKey,
      src: selected,
      anim,
      animTypes: animTypes.map(t => ({
        ...t,
        selected: t.value === (anim.type ?? "torch"),
      })),
    };
  }

  // ── Action handlers ──────────────────────────────────────────────────────────

  static async #onSelectSource(event, target) {
    this._saveFormToWorking();
    this._selectedKey = target.dataset.key;
    this.render();
  }

  static async #onResetSource(event, target) {
    const key = this._selectedKey;
    const { LightTracker } = await import("./light-tracker.mjs");
    const defaults = LightTracker._getDefaultLightSourcesConfig();
    if (defaults?.[key]) {
      this._workingConfig[key] = foundry.utils.deepClone(defaults[key]);
      this.render();
    }
  }

  static async #onResetAll(event, target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reset All Light Sources" },
      content: "<p>Reset <strong>all 12 light sources</strong> to their default values? Unsaved changes will be lost.</p>",
    });
    if (!confirmed) return;
    const { LightTracker } = await import("./light-tracker.mjs");
    this._workingConfig = foundry.utils.deepClone(LightTracker._getDefaultLightSourcesConfig());
    this.render();
  }

  static async #onSubmit(event, form, formData) {
    this._saveFormToWorking();
    await game.settings.set(MODULE_ID, "lightSourcesConfig", this._workingConfig);
    this._flashSaved();
  }

  static async #onSaveAndClose(event, target) {
    await this.submit();
    this.close();
  }

  static async #onCancel(event, target) {
    this.close();
  }

  static async #onTestOnToken(event, target) {
    this._saveFormToWorking();
    const token = canvas.tokens?.controlled[0];
    if (!token) { ui.notifications.warn("Select a token first."); return; }
    const cfg = this._workingConfig[this._selectedKey];
    if (!cfg) return;

    // Snapshot the token's current `light` data BEFORE we overwrite it, so
    // Stop Test (or app-close auto-restore) can put it back. Snapshot only
    // once per token — repeated previews on the same token shouldn't lose
    // the original baseline.
    const existingSnapshot = token.document.getFlag(MODULE_ID, "lightTestSnapshot");
    if (!existingSnapshot) {
      const original = foundry.utils.deepClone(token.document.toObject().light ?? {});
      await token.document.setFlag(MODULE_ID, "lightTestSnapshot", original);
    }
    this._testedTokens.add(`${token.scene.id}:${token.id}`);

    // Apply transient light to the selected token so the GM can see the effect
    const lightData = {
      bright:     cfg.bright ?? 15,
      dim:        cfg.dim ?? 30,
      color:      cfg.color ?? "#ff9900",
      alpha:      cfg.colorIntensity ?? 0.4,
      angle:      cfg.angle ?? 360,
      animation:  cfg.animation ?? { type: "torch", speed: 5, intensity: 5 },
      priority:   cfg.priority ?? 0,
      darkness:   { min: 0, max: 1 },
      luminosity: 0.5,
      attenuation: 0.5,
    };
    if (cfg.isDarkness) lightData.darkness = { min: 1, max: 1 };
    await token.document.update({ light: lightData });
    ui.notifications.info(`Light preview applied to ${token.name}. Click "Stop Test" or close this window to restore.`);
  }

  static async #onStopTest(event, target) {
    await this._restoreAllTestedTokens({ silent: false });
  }

  /**
   * Restore every token that we transiently overwrote during this app's
   * lifetime. Resolves each entry via `game.scenes.get(sceneId).tokens.get(tokenId)`
   * so cleanup works even after the GM navigates to a different scene before
   * closing the window. Stale entries (token deleted, snapshot missing) are
   * skipped silently.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.silent=false]  When true, suppress the "No active
   *   light test to stop." toast on the empty-Set path. Set by `_onClose` so
   *   the close-without-testing path doesn't pop a confusing notification.
   */
  async _restoreAllTestedTokens({ silent = false } = {}) {
    if (this._testedTokens.size === 0) {
      if (!silent) ui.notifications.info("No active light test to stop.");
      return;
    }
    let restored = 0;
    for (const key of this._testedTokens) {
      const [sceneId, tokenId] = key.split(":");
      const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
      if (!tokenDoc) continue;
      const snap = tokenDoc.getFlag(MODULE_ID, "lightTestSnapshot");
      if (!snap) continue;
      try {
        await tokenDoc.update({ light: snap });
        await tokenDoc.unsetFlag(MODULE_ID, "lightTestSnapshot");
        restored++;
      } catch (e) {
        console.warn(`${MODULE_ID} | Failed to restore light test on ${tokenDoc.name}:`, e);
      }
    }
    this._testedTokens.clear();
    if (restored > 0) ui.notifications.info(`Restored light on ${restored} token(s).`);
  }

  /**
   * ApplicationV2 close hook — auto-restore any tested tokens so the GM
   * never gets stuck with a preview light burned onto a token because they
   * forgot to click Stop Test. Silenced empty-Set path so closing the
   * window without ever testing doesn't pop a stray notification.
   */
  async _onClose(options) {
    await this._restoreAllTestedTokens({ silent: true })
      .catch(e => console.warn(`${MODULE_ID} | Light test cleanup failed:`, e));
    return super._onClose(options);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Read the current form's fields into _workingConfig without a full re-render. */
  _saveFormToWorking() {
    const formEl = this.element instanceof HTMLFormElement
      ? this.element
      : this.element?.querySelector("form") ?? this.element;
    if (!formEl) return;
    const fd = new FormDataExtended(formEl);
    const raw = fd.object;

    // All field names are prefixed with "src." — map them into _workingConfig[selectedKey]
    const cfg = this._workingConfig[this._selectedKey] ?? {};
    for (const [name, value] of Object.entries(raw)) {
      if (name.startsWith("src.")) {
        const path = name.slice(4); // strip "src."
        foundry.utils.setProperty(cfg, path, value);
      }
    }
    // Coerce types that FormDataExtended may not handle perfectly
    if (cfg.bright !== undefined)        cfg.bright = Number(cfg.bright);
    if (cfg.dim !== undefined)           cfg.dim = Number(cfg.dim);
    if (cfg.angle !== undefined)         cfg.angle = Number(cfg.angle);
    if (cfg.colorIntensity !== undefined) cfg.colorIntensity = Number(cfg.colorIntensity);
    if (cfg.longevitySecs !== undefined) cfg.longevitySecs = Number(cfg.longevitySecs);
    if (cfg.priority !== undefined)      cfg.priority = Number(cfg.priority);
    if (cfg.consumable !== undefined)    cfg.consumable = Boolean(cfg.consumable);
    if (cfg.isDarkness !== undefined)    cfg.isDarkness = Boolean(cfg.isDarkness);
    if (cfg.animation) {
      if (cfg.animation.speed !== undefined)     cfg.animation.speed = Number(cfg.animation.speed);
      if (cfg.animation.intensity !== undefined) cfg.animation.intensity = Number(cfg.animation.intensity);
      if (cfg.animation.reverse !== undefined)   cfg.animation.reverse = Boolean(cfg.animation.reverse);
    }
    this._workingConfig[this._selectedKey] = cfg;
  }

  _flashSaved() {
    const el = this.element?.querySelector(".vcls-save-flash");
    if (!el) return;
    el.classList.add("vcls-flash");
    setTimeout(() => el.classList.remove("vcls-flash"), 800);
  }
}
