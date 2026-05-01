/**
 * XP Counter Patch
 *
 * Monkey-patches the base system's LevelUpDialog so the XP questionnaire
 * uses unlimited numeric counters instead of simple on/off checkboxes.
 *
 * Left-click  → increment count
 * Right-click → decrement count (minimum 0)
 */

import { SessionRecap } from "./session-recap.mjs";

export const XpCounterPatch = {
  _LevelUpDialog: null,

  async init() {
    const mod = await import("/systems/vagabond/module/applications/level-up-dialog.mjs");
    this._LevelUpDialog = mod.LevelUpDialog;
    this._patchClass();
    Hooks.on("renderLevelUpDialog", (app, html) => this._onRender(app, html));
  },

  // ── Class patches ────────────────────────────────────────────

  _patchClass() {
    const cls = this._LevelUpDialog;

    // --- toggleQuestion: increment instead of toggle ---
    cls.DEFAULT_OPTIONS.actions.toggleQuestion = function (_event, target) {
      const index = parseInt(target.dataset.index);
      const maxIndex = CONFIG.VAGABOND?.homebrew?.leveling?.xpQuestions?.length ?? 5;
      if (isNaN(index) || index < 0 || index >= maxIndex) return;
      _ensureNumeric(this);
      this.questions[index]++;
      this.render();
    };

    // --- _prepareQuestionnaireContext: count-based XP ---
    cls.prototype._prepareQuestionnaireContext = function () {
      _ensureNumeric(this);
      const sys = this.actor.system;
      const xpQuestions = CONFIG.VAGABOND?.homebrew?.leveling?.xpQuestions ?? [];

      const xpGained = xpQuestions.reduce(
        (sum, q, i) => sum + (this.questions[i] || 0) * (q.xp || 1), 0,
      );
      const currentXP = sys.attributes.xp || 0;
      const xpRequired = sys.attributes.xpRequired || 10;
      const projectedXP = currentXP + (this.xpAwarded ? 0 : xpGained);
      const canLevelUp = projectedXP >= xpRequired && !this.levelApplied;
      const currentLevel = sys.attributes.level.value || 1;
      const xpProgress = Math.min(100, Math.round((projectedXP / xpRequired) * 100));

      return {
        questions: xpQuestions.map((q, i) => ({
          index: i,
          label: q.question,
          xp: q.xp || 1,
          checked: (this.questions[i] || 0) > 0,
          count: this.questions[i] || 0,
        })),
        xpGained,
        currentXP,
        xpRequired,
        projectedXP,
        xpProgress,
        currentLevel,
        nextLevel: currentLevel + 1,
        canLevelUp,
        xpAwarded: this.xpAwarded,
        alreadyCanLevel: sys.attributes.canLevelUp && !this.levelApplied,
      };
    };

    // --- awardXP: count-based, reset to zeros ---
    cls.DEFAULT_OPTIONS.actions.awardXP = async function (_event, _target) {
      _ensureNumeric(this);
      const xpQuestions = CONFIG.VAGABOND?.homebrew?.leveling?.xpQuestions ?? [];
      const xpGained = xpQuestions.reduce(
        (sum, q, i) => sum + (this.questions[i] || 0) * (q.xp || 1), 0,
      );

      if (xpGained === 0) {
        ui.notifications.warn("No XP to award — answer at least one question.");
        return;
      }

      // Snapshot question counts BEFORE the reset on line below — otherwise
      // the recap snapshot reads zeros and the "breakdown" shows nothing.
      const questionSnapshot = xpQuestions
        .map((q, i) => ({ label: q.question, xp: q.xp || 1, count: this.questions[i] || 0 }))
        .filter(q => q.count > 0);

      const currentXP = this.actor.system.attributes.xp || 0;
      const newXP = currentXP + xpGained;

      await this.actor.update({ "system.attributes.xp": newXP });
      this.xpAwarded = true;
      this.questions = new Array(xpQuestions.length || 5).fill(0);

      ui.notifications.info(`Awarded ${xpGained} XP to ${this.actor.name}. Total: ${newXP}`);

      SessionRecap.logXp({
        player: this.actor.name,
        actorId: this.actor.id,
        questions: questionSnapshot,
        totalXp: xpGained,
      });

      this.render();
    };
  },

  // ── Render hook — DOM modifications ──────────────────────────

  _onRender(app, html) {
    _ensureNumeric(app);
    const el = html instanceof HTMLElement ? html : html[0];
    if (!el) return;

    // Abort previous listeners so they don't stack on re-render
    app._vcbXpAbort?.abort();
    app._vcbXpAbort = new AbortController();
    const signal = app._vcbXpAbort.signal;

    const labels = el.querySelectorAll("[data-action=\"toggleQuestion\"]");
    const xpQuestions = CONFIG.VAGABOND?.homebrew?.leveling?.xpQuestions ?? [];

    labels.forEach((label) => {
      const index = parseInt(label.dataset.index);
      if (isNaN(index)) return;
      const count = app.questions[index] || 0;
      const perXp = xpQuestions[index]?.xp || 1;

      // Replace checkbox icon with counter badge
      const checkbox = label.querySelector(".lu-checkbox");
      if (checkbox) {
        if (count > 0) {
          checkbox.innerHTML =
            `<span class="vcb-xp-count">${count}</span>`;
        } else {
          checkbox.innerHTML = `<i class="far fa-square"></i>`;
        }
      }

      // Show per-question XP subtotal when count > 1
      let subtotal = label.querySelector(".vcb-xp-subtotal");
      if (count > 1) {
        if (!subtotal) {
          subtotal = document.createElement("span");
          subtotal.className = "vcb-xp-subtotal";
          label.appendChild(subtotal);
        }
        subtotal.textContent = `×${count} = ${count * perXp} XP`;
      } else if (subtotal) {
        subtotal.remove();
      }

      // Right-click to decrement
      label.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _ensureNumeric(app);
        if (app.questions[index] > 0) {
          app.questions[index]--;
          app.render();
        }
      }, { signal });
    });
  },
};

// ── Helpers ──────────────────────────────────────────────────

/** Convert legacy boolean array to numeric on first access. */
function _ensureNumeric(app) {
  if (app.questions?.length && typeof app.questions[0] === "boolean") {
    app.questions = app.questions.map((q) => (q ? 1 : 0));
  }
}
