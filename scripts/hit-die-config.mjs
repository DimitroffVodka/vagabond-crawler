// scripts/hit-die-config.mjs
import { MODULE_ID } from "./vagabond-crawler.mjs";
import { dieAvg } from "./monster-mutator.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SIZE_ROWS = [
  { key: "small",    label: "Small",    readonly: true },
  { key: "medium",   label: "Medium",   readonly: false },
  { key: "large",    label: "Large",    readonly: false },
  { key: "huge",     label: "Huge",     readonly: false },
  { key: "giant",    label: "Giant",    readonly: false },
  { key: "colossal", label: "Colossal", readonly: false },
];

const DIE_OPTIONS = ["d4", "d6", "d8", "d10", "d12", "d14", "d16", "d20"];

const DEFAULT_MAP = {
  medium:   "d6",
  large:    "d8",
  huge:     "d10",
  giant:    "d12",
  colossal: "d14",
};

export class HitDieConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "vagabond-crawler-hit-die-config",
    tag: "form",
    window: { title: "VAGABOND_CRAWLER.HitDieConfig.Title", resizable: true },
    position: { width: 560, height: "auto" },
    form: {
      handler:        HitDieConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit:  false,
    },
    actions: {
      resetDefaults: HitDieConfigApp.#onResetDefaults,
      save:          HitDieConfigApp.#onSave,
      saveAndClose:  HitDieConfigApp.#onSaveAndClose,
      cancel:        HitDieConfigApp.#onCancel,
    },
  };

  static PARTS = {
    form: { template: "modules/vagabond-crawler/templates/hit-die-config.hbs" },
  };

  /** Working copy of `hitDieSizeMap`. Edits live here until Save. */
  _workingMap = null;
  /** Working copy of `bestiaryHitDieFallback`. */
  _workingFallback = null;

  async _prepareContext() {
    if (this._workingMap == null) {
      this._workingMap = foundry.utils.deepClone(
        game.settings.get(MODULE_ID, "hitDieSizeMap")
      );
    }
    if (this._workingFallback == null) {
      this._workingFallback = !!game.settings.get(MODULE_ID, "bestiaryHitDieFallback");
    }

    const rows = SIZE_ROWS.map((r) => {
      if (r.readonly) {
        return { ...r, die: null, dieOptions: [], avg: null };
      }
      const die = this._workingMap[r.key] ?? DEFAULT_MAP[r.key] ?? "d8";
      return {
        ...r,
        die,
        avg: dieAvg(die),
        dieOptions: DIE_OPTIONS.map((d) => ({ value: d, label: d, selected: d === die })),
      };
    });

    return { rows, fallback: this._workingFallback };
  }

  /** Read the form fields back into the working copy whenever any input
   *  changes, so AVG cells re-render live without an explicit Save. */
  _onChangeForm(formConfig, event) {
    super._onChangeForm?.(formConfig, event);
    const form = this.element?.querySelector("form") ?? this.element;
    if (!form) return;
    const fd = new FormData(form);
    // Reset fallback first — unchecked checkboxes are absent from FormData
    this._workingFallback = false;
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("die.")) {
        const sizeKey = k.slice(4);
        if (sizeKey !== "small") this._workingMap[sizeKey] = String(v);
      } else if (k === "fallback") {
        this._workingFallback = v === "on" || v === "true" || v === "1";
      }
    }
    // Re-render the AVG cells live.
    this.render();
  }

  static async #onSubmit(_event, _form, _formData) {
    // Persistence happens via #onSave / #onSaveAndClose actions. No-op here.
  }

  static async #onResetDefaults(_event, _target) {
    this._workingMap      = foundry.utils.deepClone(DEFAULT_MAP);
    this._workingFallback = false;
    this.render();
  }

  static async #onSave(_event, _target) {
    await game.settings.set(MODULE_ID, "hitDieSizeMap", foundry.utils.deepClone(this._workingMap));
    await game.settings.set(MODULE_ID, "bestiaryHitDieFallback", !!this._workingFallback);
    ui.notifications?.info(game.i18n.localize("VAGABOND_CRAWLER.HitDieConfig.Saved"));
  }

  static async #onSaveAndClose(event, target) {
    await HitDieConfigApp.#onSave.call(this, event, target);
    this.close();
  }

  static async #onCancel(_event, _target) {
    this._workingMap      = null;
    this._workingFallback = null;
    this.close();
  }
}

/** Singleton accessor — used by `game.vagabondCrawler.hitDieConfig` (wired in Task 4). */
export const HitDieConfig = {
  _app: null,
  open() {
    if (!this._app) this._app = new HitDieConfigApp();
    this._app.render(true);
    return this._app;
  },
};
