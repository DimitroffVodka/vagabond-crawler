# Monster Creator — Hit Die Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-monster Hit Die selection (`d4`–`d14`, plus a "From Size" mode), per-monster "Roll HP on spawn" toggle, and a GM-facing Hit Die Configuration window that owns the size→die map. Roll HP fresh on unlinked NPC token spawn when opted in. Stay byte-for-byte backward-compatible for any actor that doesn't carry the new flags (with an opt-in world setting that flips the default for legacy bestiary drops).

**Architecture:** Per-actor flags under `flags.vagabond-crawler` (`hitDie`, `rollHpOnSpawn`) drive runtime behavior. Two new world settings (`hitDieSizeMap`, `bestiaryHitDieFallback`) drive defaults. A new singleton `HitDieConfigApp` (ApplicationV2 + HandlebarsApplicationMixin) owns the editing UI, mirroring `LightSourcesConfigApp`. A `preCreateToken` hook rolls fresh HP into the token's `delta.system.health` for unlinked tokens. `calculateHP` gains an optional third argument with a back-compat default.

**Tech Stack:** Foundry VTT v13 ApplicationV2 + Handlebars. Vanilla ES modules (no build step). No test runner — verification is manual + MCP-driven (`mcp__foundry-vtt__evaluate` after `window.location.reload()`).

**Spec:** [docs/superpowers/specs/2026-04-25-monster-creator-hit-die-config-design.md](../specs/2026-04-25-monster-creator-hit-die-config-design.md)

**Conventions for every task:**
- Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Verification favors `Grep` / `Glob` for static checks and `mcp__foundry-vtt__evaluate` for live behavior. After any `.mjs` or `.hbs` edit, reload Foundry: `window.location.reload()` via `mcp__foundry-vtt__evaluate`, wait ~1s, then re-query.
- Module ID literal is `"vagabond-crawler"` — but in module code always import the constant from `scripts/vagabond-crawler.mjs` (`import { MODULE_ID } from "./vagabond-crawler.mjs"`).
- All new colors/spacing use the `--vcb-*` token system from `styles/vagabond-crawler.css`. **No hex colors in new CSS.**
- All new player-visible strings live in `languages/en.json` under `VAGABOND_CRAWLER.HitDieConfig.*` and `VAGABOND_CRAWLER.MonsterCreator.HitDie.*`.
- Each task ends with a single commit. No multi-task commits.

---

### Task 1: Extend `calculateHP` and add `dieAvg` helper (back-compat)

**Goal:** Make `calculateHP` aware of an arbitrary hit die without changing any existing call site's behavior. Foundation for every later task.

**Files:**
- Modify: `scripts/monster-mutator.mjs:23-28`

**Acceptance Criteria:**
- [ ] `calculateHP(hd, size)` (2-arg call) returns identical values to the pre-change implementation for every `(hd, size)` combination — Small still `max(1, hd)`, medium+ still `floor(hd * 4.5)`.
- [ ] `calculateHP(hd, size, "d6")` returns `floor(hd * 3.5)` for medium+, `max(1, hd)` for Small.
- [ ] `calculateHP(hd, size, "fromSize")` reads `game.settings.get("vagabond-crawler", "hitDieSizeMap")` and resolves the die from `size`. If the setting hasn't been registered yet (e.g. called from a unit-test-style harness before `init`), falls back to `d8`.
- [ ] `dieAvg("d4")` → 2.5, `dieAvg("d6")` → 3.5, `dieAvg("d8")` → 4.5, `dieAvg("d10")` → 5.5, `dieAvg("d12")` → 6.5, `dieAvg("d14")` → 7.5, `dieAvg("d16")` → 8.5, `dieAvg("d20")` → 10.5.
- [ ] `dieAvg("garbage")` returns `4.5` (silent fallback to d8 average) and does not throw.
- [ ] Both functions are exported.

**Verify:**
- Grep: `Grep(pattern: "export function calculateHP", path: "scripts/monster-mutator.mjs")` → 1 match.
- Grep: `Grep(pattern: "export function dieAvg", path: "scripts/monster-mutator.mjs")` → 1 match.
- MCP (after reload): `mcp__foundry-vtt__evaluate({ script: "const m = await import('/modules/vagabond-crawler/scripts/monster-mutator.mjs'); return [m.calculateHP(5,'medium'), m.calculateHP(5,'medium','d6'), m.calculateHP(5,'small','d12'), m.dieAvg('d10')];" })` → returns `[22, 17, 5, 5.5]`.

**Steps:**

- [ ] **Step 1: Replace the existing `calculateHP` and add `dieAvg` above it**

Open `scripts/monster-mutator.mjs` and replace lines 22–28 with:

```js
/**
 * Average roll value for a die expression like "d4", "d8", "d20".
 * Defaults to d8's 4.5 for any unparseable input — keeps callers tolerant
 * of legacy data and free-form strings.
 */
export function dieAvg(die) {
  const m = String(die ?? "").match(/^d(\d+)$/i);
  if (!m) return 4.5;
  const sides = parseInt(m[1], 10);
  if (!Number.isFinite(sides) || sides < 2) return 4.5;
  return (sides + 1) / 2;
}

/**
 * Calculate HP from HD.
 *
 * Vagabond rule: Small = max(1, HD); medium+ = floor(HD * dieAvg).
 * `die` defaults to "d8" so every legacy 2-arg call stays at HD * 4.5.
 *
 * `die === "fromSize"` resolves the die at call time from the world
 * setting `hitDieSizeMap` — this lets monsters declare "follow the size
 * map" once and pick up live edits to the map.
 */
export function calculateHP(hd, size = "medium", die = "d8") {
  if (size === "small") return Math.max(1, Number(hd) || 0);

  let resolved = die;
  if (die === "fromSize") {
    let map;
    try { map = game?.settings?.get?.("vagabond-crawler", "hitDieSizeMap"); }
    catch (_) { map = null; }
    resolved = map?.[size] ?? "d8";
  }

  return Math.floor((Number(hd) || 0) * dieAvg(resolved));
}
```

- [ ] **Step 2: Static check**

Run: `Grep(pattern: "calculateHP\\(.*?,.*?,.*?\\)", path: "scripts", output_mode: "content")`
Expected: only call sites we add in later tasks; no current call site is broken (since the third arg is optional).

- [ ] **Step 3: Live check via Foundry MCP**

Reload Foundry: `mcp__foundry-vtt__evaluate({ script: "window.location.reload()" })`. Wait ~1s.

Run:
```
mcp__foundry-vtt__evaluate({ script: `
  const m = await import('/modules/vagabond-crawler/scripts/monster-mutator.mjs');
  return {
    legacy:        m.calculateHP(5, 'medium'),
    d6:            m.calculateHP(5, 'medium', 'd6'),
    smallIgnoresD: m.calculateHP(5, 'small', 'd12'),
    d10Avg:        m.dieAvg('d10'),
    badInputAvg:   m.dieAvg('garbage'),
  };
` })
```
Expected: `{ legacy: 22, d6: 17, smallIgnoresD: 5, d10Avg: 5.5, badInputAvg: 4.5 }`.

- [ ] **Step 4: Commit**

```bash
git add scripts/monster-mutator.mjs
git commit -m "feat(monster-mutator): add dieAvg and optional die arg to calculateHP"
```

---

### Task 2: Register `hitDieSizeMap` and `bestiaryHitDieFallback` world settings

**Goal:** Persist the size→die map and the bestiary fallback toggle. This task only registers them — no UI yet.

**Files:**
- Modify: `scripts/vagabond-crawler.mjs` (settings registration block, around the existing `game.settings.register(MODULE_ID, ...)` cluster — insert immediately before the `AnimationFx.registerSettings();` line)

**Acceptance Criteria:**
- [ ] `game.settings.get("vagabond-crawler", "hitDieSizeMap")` after a fresh load returns the default object `{ medium: "d6", large: "d8", huge: "d10", giant: "d12", colossal: "d14" }`.
- [ ] `game.settings.get("vagabond-crawler", "bestiaryHitDieFallback")` returns `false`.
- [ ] Both settings are world-scope, GM-only via `config: false` (config menu surfaces them through `registerMenu` in Task 4 — they should not appear as raw checkbox/text rows in *Configure Settings → Module Settings*).

**Verify:**
- Grep: `Grep(pattern: "hitDieSizeMap", path: "scripts/vagabond-crawler.mjs")` → at least 1 hit.
- Grep: `Grep(pattern: "bestiaryHitDieFallback", path: "scripts/vagabond-crawler.mjs")` → at least 1 hit.
- MCP (after reload): `mcp__foundry-vtt__evaluate({ script: "return { map: game.settings.get('vagabond-crawler', 'hitDieSizeMap'), fallback: game.settings.get('vagabond-crawler', 'bestiaryHitDieFallback') };" })` → `{ map: { medium:"d6", large:"d8", huge:"d10", giant:"d12", colossal:"d14" }, fallback: false }`.

**Steps:**

- [ ] **Step 1: Add the two registrations**

In `scripts/vagabond-crawler.mjs`, inside the `Hooks.once("init", ...)` block, insert before the `AnimationFx.registerSettings();` line (around line 142):

```js
  game.settings.register(MODULE_ID, "hitDieSizeMap", {
    name: "Hit Die Size Map",
    hint: "Default hit die per creature size. Edited via the Hit Die Configuration window.",
    scope: "world",
    config: false,
    type: Object,
    default: {
      medium:   "d6",
      large:    "d8",
      huge:     "d10",
      giant:    "d12",
      colossal: "d14",
    },
  });

  game.settings.register(MODULE_ID, "bestiaryHitDieFallback", {
    name: "Apply Hit Die Map to Bestiary NPCs",
    hint: "When ON, compendium NPCs without authored hit-die flags use the size→die map and roll fresh HP per spawn. When OFF, legacy bestiary drops keep the deterministic HD × 4.5 formula.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
```

- [ ] **Step 2: Reload and verify defaults**

```
mcp__foundry-vtt__evaluate({ script: "window.location.reload()" })
// wait ~1s
mcp__foundry-vtt__evaluate({ script: "return { map: game.settings.get('vagabond-crawler','hitDieSizeMap'), fallback: game.settings.get('vagabond-crawler','bestiaryHitDieFallback') };" })
```
Expected: `{ map: { medium:"d6", large:"d8", huge:"d10", giant:"d12", colossal:"d14" }, fallback: false }`.

- [ ] **Step 3: Verify `fromSize` end-to-end now works**

```
mcp__foundry-vtt__evaluate({ script: `
  const m = await import('/modules/vagabond-crawler/scripts/monster-mutator.mjs');
  return [
    m.calculateHP(5, 'medium', 'fromSize'),    // 5 * 3.5 = 17.5 → 17
    m.calculateHP(5, 'colossal', 'fromSize'),  // 5 * 7.5 = 37.5 → 37
  ];
` })
```
Expected: `[17, 37]`.

- [ ] **Step 4: Commit**

```bash
git add scripts/vagabond-crawler.mjs
git commit -m "feat(settings): add hitDieSizeMap and bestiaryHitDieFallback"
```

---

### Task 3: Build `HitDieConfigApp` window (config UI + Handlebars template)

**Goal:** A standalone GM-only ApplicationV2 window with the size→die table and the bestiary-fallback checkbox. Reset / Save / Save&Close / Cancel buttons. No discoverability wiring yet (Task 4 wires it).

**Files:**
- Create: `scripts/hit-die-config.mjs`
- Create: `templates/hit-die-config.hbs`
- Modify: `styles/vagabond-crawler.css` (append new section)
- Modify: `languages/en.json` (add string keys)

**Acceptance Criteria:**
- [ ] `game.vagabondCrawler.hitDieConfig.open()` (after Task 4 wires it; for now manually instantiate `new HitDieConfigApp().render(true)`) opens a window titled "Hit Die Configuration".
- [ ] Window shows 6 rows: Small (read-only special), Medium, Large, Huge, Giant, Colossal. Five editable rows have a die `<select>` with options `d4, d6, d8, d10, d12, d14, d16, d20`.
- [ ] AVG cell next to each die shows the live average (changes immediately when the dropdown changes — no save needed for the cell to update).
- [ ] Bestiary-fallback checkbox is wired to the working copy and reflects the persisted setting on open.
- [ ] **Save** persists the working copy to settings and stays open. **Save & Close** persists and closes. **Cancel** closes without persisting (working copy discarded). **Reset to Defaults** repopulates the working copy with the registered defaults — but does NOT persist until the user hits Save.
- [ ] No hex colors in the new CSS — only `--vcb-*` tokens.

**Verify:**
- Glob: `Glob(pattern: "scripts/hit-die-config.mjs")` → 1 file.
- Glob: `Glob(pattern: "templates/hit-die-config.hbs")` → 1 file.
- Grep: `Grep(pattern: "#[0-9a-fA-F]{3,8}", path: "styles/vagabond-crawler.css", glob: "*.css")` for the new section only — should not appear in the lines added by this task. (Inspect the diff before commit.)
- Live: open the window, change Medium die from d6 → d10, verify AVG flips to 5.5, click Save, reload Foundry, reopen — Medium should still be d10.

**Steps:**

- [ ] **Step 1: Create `scripts/hit-die-config.mjs`**

Write the full file. Mirror the shape of `scripts/light-sources-config.mjs` — class name, DEFAULT_OPTIONS, PARTS, working-copy pattern, action handlers as private static methods.

```js
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
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("die.")) {
        const sizeKey = k.slice(4);
        if (sizeKey !== "small") this._workingMap[sizeKey] = String(v);
      } else if (k === "fallback") {
        this._workingFallback = v === "on" || v === "true";
      }
    }
    // Re-render the AVG cells without losing focus on whatever's open.
    this.render();
  }

  static async #onSubmit(_event, _form, _formData) {
    // The actual persistence happens via #onSave / #onSaveAndClose actions.
    // This handler is required by ApplicationV2 form config but is a no-op
    // here.
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

/** Singleton accessor — used by `game.vagabondCrawler.hitDieConfig`. */
export const HitDieConfig = {
  _app: null,
  open() {
    if (!this._app) this._app = new HitDieConfigApp();
    this._app.render(true);
    return this._app;
  },
};
```

- [ ] **Step 2: Create `templates/hit-die-config.hbs`**

```hbs
<form class="vcb-hitdie-config" autocomplete="off">

  <section class="vcb-hitdie-section">
    <h3>{{localize "VAGABOND_CRAWLER.HitDieConfig.SizeMapHeader"}}</h3>
    <p class="vcb-hitdie-help">{{localize "VAGABOND_CRAWLER.HitDieConfig.SizeMapHelp"}}</p>

    <table class="vcb-hitdie-table">
      <thead>
        <tr>
          <th>{{localize "VAGABOND_CRAWLER.HitDieConfig.ColSize"}}</th>
          <th>{{localize "VAGABOND_CRAWLER.HitDieConfig.ColDie"}}</th>
          <th>{{localize "VAGABOND_CRAWLER.HitDieConfig.ColAvg"}}</th>
        </tr>
      </thead>
      <tbody>
        {{#each rows}}
          <tr class="vcb-hitdie-row {{#if readonly}}vcb-hitdie-readonly{{/if}}">
            <td class="vcb-hitdie-size">{{label}}</td>
            <td class="vcb-hitdie-die">
              {{#if readonly}}
                <span class="vcb-hitdie-readonly-note">{{localize "VAGABOND_CRAWLER.HitDieConfig.SmallNote"}}</span>
              {{else}}
                <select name="die.{{key}}">
                  {{#each dieOptions}}
                    <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
                  {{/each}}
                </select>
              {{/if}}
            </td>
            <td class="vcb-hitdie-avg">{{#if avg}}{{avg}}{{else}}—{{/if}}</td>
          </tr>
        {{/each}}
      </tbody>
    </table>
  </section>

  <section class="vcb-hitdie-section">
    <h3>{{localize "VAGABOND_CRAWLER.HitDieConfig.FallbackHeader"}}</h3>
    <label class="vcb-hitdie-checkbox-row">
      <input type="checkbox" name="fallback" {{#if fallback}}checked{{/if}}>
      <span>{{localize "VAGABOND_CRAWLER.HitDieConfig.FallbackLabel"}}</span>
    </label>
    <p class="vcb-hitdie-help">{{localize "VAGABOND_CRAWLER.HitDieConfig.FallbackHelp"}}</p>
  </section>

  <footer class="vcb-hitdie-footer">
    <button type="button" data-action="resetDefaults">
      <i class="fas fa-rotate-left"></i> {{localize "VAGABOND_CRAWLER.HitDieConfig.Reset"}}
    </button>
    <span class="vcb-hitdie-spacer"></span>
    <button type="button" data-action="save">
      <i class="fas fa-floppy-disk"></i> {{localize "VAGABOND_CRAWLER.HitDieConfig.Save"}}
    </button>
    <button type="button" data-action="saveAndClose">
      <i class="fas fa-floppy-disk"></i> {{localize "VAGABOND_CRAWLER.HitDieConfig.SaveAndClose"}}
    </button>
    <button type="button" data-action="cancel">
      {{localize "VAGABOND_CRAWLER.HitDieConfig.Cancel"}}
    </button>
  </footer>
</form>
```

- [ ] **Step 3: Append a CSS section to `styles/vagabond-crawler.css`**

Find the bottom of the file. Append this block:

```css
/* ──────────────────────────────────────────────────────────────────────
   Hit Die Configuration  (HitDieConfigApp)
   Token-only colors. Never hardcode hex.
   ────────────────────────────────────────────────────────────────────── */

.vcb-hitdie-config {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 12px 12px;
  color: var(--vcb-text);
}

.vcb-hitdie-section h3 {
  margin: 0 0 6px;
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  color: var(--vcb-text-strong);
  border-bottom: 1px solid var(--vcb-border);
  padding-bottom: 4px;
}

.vcb-hitdie-help {
  margin: 0 0 8px;
  color: var(--vcb-text-muted);
  font-size: 0.85rem;
}

.vcb-hitdie-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--vcb-surface-2);
  border: 1px solid var(--vcb-border);
}

.vcb-hitdie-table th,
.vcb-hitdie-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid var(--vcb-border);
}

.vcb-hitdie-table th {
  background: var(--vcb-surface-3);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vcb-text-muted);
}

.vcb-hitdie-readonly {
  opacity: 0.7;
  font-style: italic;
}

.vcb-hitdie-readonly-note {
  color: var(--vcb-text-muted);
  font-size: 0.85rem;
}

.vcb-hitdie-die select {
  background: var(--vcb-surface-1);
  color: var(--vcb-text);
  border: 1px solid var(--vcb-border);
  padding: 2px 6px;
}

.vcb-hitdie-avg {
  font-variant-numeric: tabular-nums;
  color: var(--vcb-text-strong);
}

.vcb-hitdie-checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.vcb-hitdie-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--vcb-border);
}

.vcb-hitdie-spacer {
  flex: 1;
}
```

If any `--vcb-text-strong`, `--vcb-text-muted`, `--vcb-surface-1/2/3`, or `--vcb-border` token does not exist in the file's `:root` block, use the closest existing token (commonly `--vcb-text`, `--vcb-surface`, `--vcb-border`). Do **not** introduce new tokens for this task.

- [ ] **Step 4: Add string keys to `languages/en.json`**

Open `languages/en.json` and merge in (under `VAGABOND_CRAWLER`):

```json
"HitDieConfig": {
  "Title":           "Hit Die Configuration",
  "SizeMapHeader":   "Size → Hit Die",
  "SizeMapHelp":     "Default hit die used by monsters set to \"From Size\". Changes apply to existing monsters using \"From Size\" automatically.",
  "ColSize":         "Size",
  "ColDie":          "Die",
  "ColAvg":          "Avg",
  "SmallNote":       "Special: HP = HD (min 1)",
  "FallbackHeader":  "Bestiary Fallback",
  "FallbackLabel":   "Apply size→die map to bestiary NPCs without authored flags",
  "FallbackHelp":    "When ON, dragging a compendium NPC onto the scene rolls HP using the size→die map. When OFF (default), bestiary NPCs use the legacy HD × 4.5 formula.",
  "Reset":           "Reset to Defaults",
  "Save":            "Save",
  "SaveAndClose":    "Save & Close",
  "Cancel":          "Cancel",
  "Saved":           "Hit die configuration saved."
}
```

- [ ] **Step 5: Reload and live-check**

```
mcp__foundry-vtt__evaluate({ script: "window.location.reload()" })
// wait ~1s
mcp__foundry-vtt__evaluate({ script: `
  const { HitDieConfigApp } = await import('/modules/vagabond-crawler/scripts/hit-die-config.mjs');
  new HitDieConfigApp().render(true);
  return 'opened';
` })
```
Expected: window opens. Manually verify the table renders, the dropdowns show correct selected values, and the AVG cells match.

Then test save persistence:
```
mcp__foundry-vtt__evaluate({ script: `
  await game.settings.set('vagabond-crawler', 'hitDieSizeMap', { medium:'d10', large:'d12', huge:'d12', giant:'d14', colossal:'d20' });
  return game.settings.get('vagabond-crawler', 'hitDieSizeMap');
` })
```
Re-open the window — Medium should now show d10 selected, AVG 5.5.

Reset to defaults via the script API:
```
mcp__foundry-vtt__evaluate({ script: `
  await game.settings.set('vagabond-crawler', 'hitDieSizeMap', { medium:'d6', large:'d8', huge:'d10', giant:'d12', colossal:'d14' });
` })
```

- [ ] **Step 6: Commit**

```bash
git add scripts/hit-die-config.mjs templates/hit-die-config.hbs styles/vagabond-crawler.css languages/en.json
git commit -m "feat(hit-die-config): add ApplicationV2 window for size→die map"
```

---

### Task 4: Wire `HitDieConfig` into `game.vagabondCrawler`, register a settings menu, and add a Crawl Bar entry

**Goal:** Three discoverability paths: `game.vagabondCrawler.hitDieConfig.open()`, *Configure Settings → Module Settings*, and the Forge & Loot right-click menu.

**Files:**
- Modify: `scripts/vagabond-crawler.mjs` (import, ready hook expose, `registerMenu`)
- Modify: `scripts/crawl-bar.mjs` (right-click context menu around lines 461–520)
- Modify: `languages/en.json` (one extra key for the menu label)

**Acceptance Criteria:**
- [ ] `game.vagabondCrawler.hitDieConfig.open()` opens the window.
- [ ] Foundry's *Configure Settings → Module Settings → Vagabond Crawler* shows a "Hit Die Configuration" button that opens the window.
- [ ] Right-clicking the Forge & Loot button on the Crawl Bar shows a new menu item "Hit Die Configuration" between "Animation FX" and the divider.
- [ ] Click the menu item → window opens, right-click menu dismisses.

**Verify:**
- Grep: `Grep(pattern: "hitDieConfig", path: "scripts/vagabond-crawler.mjs")` → ≥ 2 hits.
- Grep: `Grep(pattern: "data-fl=\"hitDieConfig\"", path: "scripts/crawl-bar.mjs")` → 1 hit.
- Live: open Foundry's settings, find the menu button, click → window opens.
- Live: right-click Forge & Loot button → see "Hit Die Configuration" item.

**Steps:**

- [ ] **Step 1: Import and expose in `scripts/vagabond-crawler.mjs`**

Add import near the top (alongside existing imports):
```js
import { HitDieConfig, HitDieConfigApp } from "./hit-die-config.mjs";
```

In `Hooks.once("init", ...)`, after the two settings registered in Task 2, add:
```js
  game.settings.registerMenu(MODULE_ID, "hitDieConfigMenu", {
    name:    "VAGABOND_CRAWLER.HitDieConfig.Title",
    label:   "VAGABOND_CRAWLER.HitDieConfig.OpenButton",
    hint:    "VAGABOND_CRAWLER.HitDieConfig.MenuHint",
    icon:    "fas fa-dice",
    type:    HitDieConfigApp,
    restricted: true,
  });
```

In `Hooks.once("ready", ...)`, find the `game.vagabondCrawler = { ... }` assignment block (Grep the file for `game.vagabondCrawler` to locate it). Add the line:
```js
    hitDieConfig: HitDieConfig,
```
to the object.

- [ ] **Step 2: Add the Crawl Bar menu entry**

Open `scripts/crawl-bar.mjs`. Locate the `_showForgeLootMenu` block — specifically the menu HTML around lines 495–498:

```html
      <div class="vcb-clock-menu-item" data-fl="animationFx">
        <i class="fas fa-film"></i> Animation FX
      </div>
      <div class="vcb-enc-menu-divider"></div>
```

Insert a new item *between* the Animation FX item and the divider:

```html
      <div class="vcb-clock-menu-item" data-fl="hitDieConfig">
        <i class="fas fa-dice"></i> Hit Die Configuration
      </div>
      <div class="vcb-enc-menu-divider"></div>
```

Then, in the click-binding block below (where `[data-fl="animationFx"]` is wired), add a binding *next to* the existing items (Grep for `data-fl="animationFx"` to find the exact location):

```js
    menu.querySelector('[data-fl="hitDieConfig"]')?.addEventListener("click", () => {
      this._dismissForgeLootMenu();
      game.vagabondCrawler?.hitDieConfig?.open();
    });
```

- [ ] **Step 3: Add the menu i18n keys**

Append to the `HitDieConfig` block in `languages/en.json`:
```json
"OpenButton": "Open Configuration",
"MenuHint":   "Edit the size→die map and bestiary fallback used for HP rolling."
```

- [ ] **Step 4: Reload and exercise all three paths**

```
mcp__foundry-vtt__evaluate({ script: "window.location.reload()" })
// wait ~1s
mcp__foundry-vtt__evaluate({ script: "game.vagabondCrawler.hitDieConfig.open(); return 'ok';" })
```
Expected: window opens.

Then manually:
1. Close the window.
2. Open Foundry's *Configure Settings → Module Settings*, scroll to Vagabond Crawler, click "Open Configuration" — window opens.
3. Right-click the Forge & Loot button on the Crawl Bar — verify the new menu item appears, click it — window opens.

- [ ] **Step 5: Commit**

```bash
git add scripts/vagabond-crawler.mjs scripts/crawl-bar.mjs languages/en.json
git commit -m "feat(hit-die-config): wire into settings menu and Crawl Bar"
```

---

### Task 5: Monster Creator — new `hitDie` and `rollHpOnSpawn` fields

**Goal:** Two new editable fields in the Monster Creator's Stats section, with live HP preview reflecting the chosen die. Persist on save (as actor flags). Restore on bestiary load.

**Files:**
- Modify: `scripts/monster-creator/monster-creator-app.mjs` (default `_data`, `_dataToActorShape`, `_actorShapeToData`, `_computePreview`, save handler, load-from-bestiary handler, `_prepareContext`)
- Modify: `templates/monster-creator.hbs` (new fields right after the `mc-field-hd` field at line 112)
- Modify: `languages/en.json` (string keys)

**Acceptance Criteria:**
- [ ] New monster's `_data` defaults: `hitDie: "fromSize"`, `rollHpOnSpawn: false`.
- [ ] The Stats row shows a new "Hit Die" select (options: `From Size`, `d4`, `d6`, `d8`, `d10`, `d12`, `d14`) and a new "Roll on spawn" checkbox.
- [ ] Beneath the Stats row, a small preview line shows e.g. `HP preview: 22 (5d8 avg)`. When the die is "From Size" the formula reads `5d8 avg (from size)`. When `rollHpOnSpawn` is checked, the line appends ` — rolled at spawn`.
- [ ] Changing the Hit Die select live-updates the HP preview and the existing Stats summary number.
- [ ] On Save, the world actor receives `flags.vagabond-crawler.hitDie` and `flags.vagabond-crawler.rollHpOnSpawn`. The actor's `system.health.value` / `.max` is set to the deterministic average (the runtime roll happens at token-spawn time, not at actor save time).
- [ ] Loading from a bestiary monster reads any pre-existing flags it carries (else applies defaults: `fromSize` + `false`).
- [ ] A small "⚙ Configure size→die map" link sits below the new row and calls `game.vagabondCrawler.hitDieConfig.open()`.

**Verify:**
- Grep: `Grep(pattern: "hitDie", path: "scripts/monster-creator/monster-creator-app.mjs")` → multiple hits.
- Grep: `Grep(pattern: "name=\"hitDie\"", path: "templates/monster-creator.hbs")` → 1 hit.
- Live: open the Creator, verify the new fields show; toggle the die — preview updates; click the configure link — Hit Die Config window opens.
- Live: save a monster with `hitDie = "d12"`, `rollHpOnSpawn = true`. Then:
```
mcp__foundry-vtt__evaluate({ script: `
  const a = game.actors.find(a => a.name === 'YourMonsterName');
  return { hd: a.system.hd, hitDie: a.getFlag('vagabond-crawler', 'hitDie'), roll: a.getFlag('vagabond-crawler', 'rollHpOnSpawn') };
` })
```
Expected: `{ hd: <whatever>, hitDie: "d12", roll: true }`.

**Steps:**

- [ ] **Step 1: Extend default `_data` and the load helpers**

Find `_defaultData()` or wherever the initial `_data` object is built. Grep `scripts/monster-creator/monster-creator-app.mjs` for `hd:               3` to locate it (around line 431). In that object add:
```js
    hitDie:        "fromSize",
    rollHpOnSpawn: false,
```

In `_actorShapeToData(actorObj, prevData)` (around line 656), add:
```js
    hitDie:        actorObj.flags?.["vagabond-crawler"]?.hitDie        ?? prevData?.hitDie        ?? "fromSize",
    rollHpOnSpawn: actorObj.flags?.["vagabond-crawler"]?.rollHpOnSpawn ?? prevData?.rollHpOnSpawn ?? false,
```

In `_dataToActorShape(data)` (around line 629), the returned object's `system.health` should still use the deterministic average (rolling is a runtime concern). But also stamp the flags onto the returned object so `applyMutations` round-trips don't lose them — add a sibling `flags` key:
```js
return {
  name: data.name,
  flags: { "vagabond-crawler": { hitDie: data.hitDie, rollHpOnSpawn: data.rollHpOnSpawn } },
  system: {
    // ... existing fields ...
  },
};
```

- [ ] **Step 2: Update `_computePreview` and the mutation preview**

Find `_computePreview(data)` (around line 591). Replace:
```js
const hp = Math.round(calculateHP(data.hd, data.size) ?? 0);
```
with:
```js
const hp = Math.round(calculateHP(data.hd, data.size, data.hitDie ?? "fromSize") ?? 0);
```

Do the same in `_mutationPreview` (around lines 690 and 704):
```js
hp: Math.round(calculateHP(data.hd, data.size, data.hitDie ?? "fromSize") ?? 0),
// and:
hp: Math.round(calculateHP(mSys.hd, mSys.size, clone.flags?.["vagabond-crawler"]?.hitDie ?? "fromSize") ?? 0),
```

Update the actor-shape `system.health` line (around line 648) similarly:
```js
health: (() => {
  const v = Math.round(calculateHP(data.hd, data.size, data.hitDie ?? "fromSize") ?? 0);
  return { value: v, max: v, bonus: [] };
})(),
```

- [ ] **Step 3: Persist flags on save**

Locate the actor-creation block. Grep for `Actor.create` or `createActorData` inside `scripts/monster-creator/monster-creator-app.mjs`. The save path builds the actor data; add `flags` to that object:
```js
flags: {
  "vagabond-crawler": {
    hitDie:        data.hitDie        ?? "fromSize",
    rollHpOnSpawn: data.rollHpOnSpawn ?? false,
  },
},
```
Place it as a sibling of `name` / `type` / `system` in the create payload.

- [ ] **Step 4: Add the form fields to `templates/monster-creator.hbs`**

After line 112 (`<div class="mc-field mc-num"><label for="mc-field-hd">HD</label>...`) and before the next field, insert:

```hbs
      <div class="mc-field mc-wide">
        <label for="mc-field-hitDie">{{localize "VAGABOND_CRAWLER.MonsterCreator.HitDie.Label"}}</label>
        <select id="mc-field-hitDie" name="hitDie">
          <option value="fromSize" {{#if hitDieIsFromSize}}selected{{/if}}>
            {{localize "VAGABOND_CRAWLER.MonsterCreator.HitDie.FromSize"}}
          </option>
          {{#each hitDieOptions}}
            <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
          {{/each}}
        </select>
      </div>
      <div class="mc-field mc-checkbox">
        <label for="mc-field-rollHpOnSpawn">
          <input id="mc-field-rollHpOnSpawn" type="checkbox" name="rollHpOnSpawn" {{#if data.rollHpOnSpawn}}checked{{/if}}>
          <span>{{localize "VAGABOND_CRAWLER.MonsterCreator.HitDie.RollOnSpawn"}}</span>
        </label>
      </div>
    </div>

    <div class="mc-row mc-hp-preview-row">
      <div class="mc-hp-preview">
        {{localize "VAGABOND_CRAWLER.MonsterCreator.HitDie.PreviewLabel"}}:
        <span class="mc-hp-preview-formula">{{hpPreviewFormula}}</span>
        {{#if data.rollHpOnSpawn}}
          <span class="mc-hp-preview-rolled">— {{localize "VAGABOND_CRAWLER.MonsterCreator.HitDie.RolledAtSpawn"}}</span>
        {{/if}}
      </div>
      <a class="mc-hp-config-link" data-action="openHitDieConfig">
        <i class="fas fa-cog"></i> {{localize "VAGABOND_CRAWLER.MonsterCreator.HitDie.ConfigureLink"}}
      </a>
```

The closing `</div>` of the surrounding `mc-row` already exists — make sure your insertion respects nesting. If the row would become too crowded, break the new fields into their own `<div class="mc-row">` immediately after the existing row's closing `</div>`.

- [ ] **Step 5: Provide `_prepareContext` data for the new template variables**

Grep `_prepareContext` in `scripts/monster-creator/monster-creator-app.mjs`. In the returned context object, add:
```js
hitDieIsFromSize: (this._data.hitDie ?? "fromSize") === "fromSize",
hitDieOptions:    ["d4","d6","d8","d10","d12","d14"].map((d) => ({
                    value:    d,
                    label:    d,
                    selected: this._data.hitDie === d,
                  })),
hpPreviewFormula: (() => {
  const die       = this._data.hitDie ?? "fromSize";
  const size      = this._data.size ?? "medium";
  const hd        = Number(this._data.hd) || 0;
  const resolved  = die === "fromSize"
    ? (game.settings.get(MODULE_ID, "hitDieSizeMap")?.[size] ?? "d8")
    : die;
  const hp = Math.round(calculateHP(hd, size, die) ?? 0);
  const suffix = die === "fromSize" ? " (from size)" : "";
  return `${hp} HP — ${hd}${resolved} avg${suffix}`;
})(),
```

- [ ] **Step 6: Wire the configure-link action**

In the Creator's `static DEFAULT_OPTIONS.actions` block, add:
```js
openHitDieConfig: MonsterCreatorApp.#onOpenHitDieConfig,
```
And add the static method:
```js
static async #onOpenHitDieConfig(_event, _target) {
  game.vagabondCrawler?.hitDieConfig?.open();
}
```
(If the Creator's class name differs, use the actual class name. Grep for `class .* extends HandlebarsApplicationMixin` in the file.)

- [ ] **Step 7: Wire the form-change handler so the new fields update `_data`**

The Creator already has a form-change pipeline (Grep `_onChangeForm` or similar). Make sure the `hitDie` and `rollHpOnSpawn` fields are folded into `this._data` on change, then `this.render()` is called so the preview line refreshes. If the existing handler iterates `FormData` generically, it likely already covers them — verify by editing the die in the live UI and watching the preview line. If not, add explicit cases.

- [ ] **Step 8: Add i18n keys**

Append to `languages/en.json` under `VAGABOND_CRAWLER`:
```json
"MonsterCreator": {
  "HitDie": {
    "Label":          "Hit Die",
    "FromSize":       "From Size (uses config)",
    "RollOnSpawn":    "Roll on spawn",
    "PreviewLabel":   "HP",
    "RolledAtSpawn":  "rolled at spawn",
    "ConfigureLink":  "Configure size→die map"
  }
}
```
If `MonsterCreator` already exists in `en.json`, merge the `HitDie` block into it instead of redeclaring.

- [ ] **Step 9: Live verification**

```
mcp__foundry-vtt__evaluate({ script: "window.location.reload()" })
// wait ~1s
mcp__foundry-vtt__evaluate({ script: "game.vagabondCrawler.monsterCreator.open(); return 'ok';" })
```
Manually:
1. Set HD = 5, Size = Medium → preview should read `17 HP — 5d6 avg (from size)`.
2. Change Hit Die to `d12` → preview reads `32 HP — 5d12 avg`.
3. Check "Roll on spawn" → preview appends `— rolled at spawn`.
4. Click "Configure size→die map" → Hit Die Config window opens.
5. Save the monster with name `Test HD Goblin`. Confirm via:
```
mcp__foundry-vtt__evaluate({ script: `
  const a = game.actors.find(a => a.name === 'Test HD Goblin');
  return { hd: a.system.hd, hitDie: a.getFlag('vagabond-crawler','hitDie'), roll: a.getFlag('vagabond-crawler','rollHpOnSpawn'), hp: a.system.health };
` })
```
Expected: `hitDie: "d12"`, `roll: true`, `hp.max` = `floor(5 * 6.5) = 32`.

- [ ] **Step 10: Commit**

```bash
git add scripts/monster-creator/monster-creator-app.mjs templates/monster-creator.hbs languages/en.json
git commit -m "feat(monster-creator): add Hit Die selector and roll-on-spawn toggle"
```

---

### Task 6: `preCreateToken` hook — roll HP fresh on unlinked NPC token spawn

**Goal:** When an unlinked NPC token spawns and its actor opts in (or the bestiary fallback is on), roll `${hd}${die}` and write the result to `tokenDoc.delta.system.health.value/max`. Whisper the roll to the GM.

**Files:**
- Modify: `scripts/vagabond-crawler.mjs` (Hooks.on("preCreateToken", …) registration in the ready hook block, plus a small helper imported from monster-mutator)

**Acceptance Criteria:**
- [ ] Drag a Monster Creator–authored NPC (with `rollHpOnSpawn = true`) from the actor sidebar onto the canvas → token's HP differs from the actor's stored max in most cases (roll variance) and equals an integer in the range `[hd, hd*sides]`.
- [ ] A whisper appears in chat (GM-only) with the rolled formula and total: e.g. `Goblin spawned with 12 HP (rolled 4d6: [3,4,2,3])`.
- [ ] Drag a linked-prototype-token NPC → no roll, token HP equals actor HP.
- [ ] Drag a Monster Creator NPC with `rollHpOnSpawn = false` → no roll.
- [ ] Drag a legacy bestiary NPC with `bestiaryHitDieFallback = false` → no roll, deterministic HD × 4.5 behavior unchanged.
- [ ] Same legacy bestiary NPC with the fallback ON → rolls using the size map.
- [ ] Drag a Small NPC with `rollHpOnSpawn = true` → no roll, token HP = `max(1, HD)`.
- [ ] PCs (`actor.type === "character"`) are never affected.
- [ ] Hook is registered only on the GM client.

**Verify:**
- Grep: `Grep(pattern: "preCreateToken", path: "scripts/vagabond-crawler.mjs")` → 1 hit.
- Live: spawn variants per the criteria above. Use `mcp__foundry-vtt__evaluate` to read the resulting token's HP after each drop.

**Steps:**

- [ ] **Step 1: Add a helper to resolve the effective hit-die config for an actor**

Add to `scripts/monster-mutator.mjs` (under the existing exports):

```js
/**
 * Resolve an actor's effective hit-die configuration for HP rolling.
 *
 * Considers per-actor flags first; falls back to the world setting
 * `bestiaryHitDieFallback` when an actor lacks the flags.
 *
 * Returns `{ rollOnSpawn: boolean, die: string }` where `die` is a
 * concrete die expression (e.g. "d6"), never "fromSize".
 */
export function resolveHitDieConfig(actor) {
  if (!actor) return { rollOnSpawn: false, die: "d8" };

  const moduleId = "vagabond-crawler";
  const flagDie  = actor.getFlag?.(moduleId, "hitDie")        ?? null;
  const flagRoll = actor.getFlag?.(moduleId, "rollHpOnSpawn") ?? null;

  let rollOnSpawn;
  let die;

  if (flagDie != null || flagRoll != null) {
    rollOnSpawn = flagRoll === true;
    die         = flagDie ?? "fromSize";
  } else {
    const fallback = !!game.settings.get(moduleId, "bestiaryHitDieFallback");
    rollOnSpawn = fallback;
    die         = "fromSize";
  }

  if (die === "fromSize") {
    const size = actor.system?.size ?? "medium";
    const map  = game.settings.get(moduleId, "hitDieSizeMap") ?? {};
    die = map[size] ?? "d8";
  }

  return { rollOnSpawn, die };
}
```

- [ ] **Step 2: Register the `preCreateToken` hook in `scripts/vagabond-crawler.mjs`**

Add the import alongside the existing `monster-mutator` import:
```js
import { resolveHitDieConfig } from "./monster-mutator.mjs";
```

In `Hooks.once("ready", ...)`, after the `game.vagabondCrawler = { ... }` block, add:

```js
  if (game.user.isGM) {
    Hooks.on("preCreateToken", async (tokenDoc, _data, _options, _userId) => {
      try {
        const actor = tokenDoc.actor;
        if (!actor)                    return;
        if (actor.type === "character") return;
        if (tokenDoc.actorLink === true) return; // shared HP — never roll on spawn

        const { rollOnSpawn, die } = resolveHitDieConfig(actor);
        if (!rollOnSpawn) return;

        const hd   = Number(actor.system?.hd) || 0;
        const size = actor.system?.size ?? "medium";

        let total;
        let formula;
        let resultsText = "";

        if (size === "small") {
          total   = Math.max(1, hd);
          formula = `Small (HP = HD)`;
        } else if (hd <= 0) {
          return; // nothing sensible to roll
        } else {
          formula = `${hd}${die}`;
          const roll = await new Roll(formula).evaluate();
          total = roll.total;
          const dice = roll.dice?.[0]?.results?.map(r => r.result) ?? [];
          if (dice.length) resultsText = ` [${dice.join(", ")}]`;
        }

        // Write to the token's actor delta so the world actor stays untouched.
        tokenDoc.updateSource({
          "delta.system.health.value": total,
          "delta.system.health.max":   total,
        });

        ChatMessage.create({
          whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
          content: `<i>${actor.name}</i> spawned with <b>${total} HP</b> (rolled ${formula}${resultsText}).`,
        });
      } catch (err) {
        console.warn("[vagabond-crawler] preCreateToken HP roll failed:", err);
      }
    });
  }
```

- [ ] **Step 3: Live verification — full matrix**

After reload, run each of the following in turn:

1. **Authored monster, roll ON, Medium d12, HD 5** — drop a token, then:
```
mcp__foundry-vtt__evaluate({ script: `
  const t = canvas.tokens.controlled[0] ?? canvas.tokens.placeables.at(-1);
  return { name: t.actor.name, hp: t.actor.system.health, delta: t.document.delta?.system?.health };
` })
```
Expected: `delta.value/max` is an integer in `[5, 60]`. The chat tab shows a whispered roll.

2. **Authored monster, roll OFF** — drop, expect `delta.system.health` to be unset (token HP = actor HP).

3. **Linked prototype** — set the actor's prototype token to linked, drop, expect no roll.

4. **Legacy bestiary NPC, fallback OFF** — drop, expect HP = `floor(hd * 4.5)`. No whisper.

5. **Legacy bestiary NPC, fallback ON** — toggle the setting via:
```
mcp__foundry-vtt__evaluate({ script: "await game.settings.set('vagabond-crawler','bestiaryHitDieFallback', true);" })
```
Drop the same NPC, expect a roll.

6. **Small Authored monster, roll ON, HD 4, Small** — drop, expect HP exactly 4 (no roll variance).

- [ ] **Step 4: Commit**

```bash
git add scripts/monster-mutator.mjs scripts/vagabond-crawler.mjs
git commit -m "feat(npc-spawn): roll HP on unlinked NPC token spawn"
```

---

### Task 7: Encounter Roller display — pass the die through

**Goal:** The Encounter Roller's HP column reflects the configured die's average for flagged actors and the legacy 4.5 for unflagged ones. Append `(rolled)` when `rollHpOnSpawn` is set.

**Files:**
- Modify: `scripts/encounter-tools.mjs:883` and `:919` (the two `calculateHP` callsites)

**Acceptance Criteria:**
- [ ] Both call sites pass the appropriate die to `calculateHP`. Where the row source is a compendium *document* (line ~919, `d.system?.hd`), pass the document's flag (or `"fromSize"` when fallback is on, else `"d8"`). Where the row source is a search hit (line ~883, `s.hd`), do the same — pull from `s.flags?.["vagabond-crawler"]?.hitDie` if available.
- [ ] When the actor's `rollHpOnSpawn` is true (or fallback is on for a flagless actor), append ` (rolled)` to the HP cell in the table. **Don't bake the suffix into the `hp` number** — leave `hp` numeric and add a sibling field like `hpDisplay` consumed by the template.
- [ ] No regression: a stock pre-existing compendium NPC with no flags + fallback OFF shows the exact same HP value as before.

**Verify:**
- Grep: `Grep(pattern: "calculateHP\\(", path: "scripts/encounter-tools.mjs", output_mode: "content", -n: true)` → exactly 2 hits, both 3-arg.
- Live: open Encounter Roller. Inspect the HP column for a flagged monster vs. a vanilla compendium one.

**Steps:**

- [ ] **Step 1: Update the search-hit branch (line ~883)**

```js
const die = s.flags?.["vagabond-crawler"]?.hitDie ?? (game.settings.get("vagabond-crawler","bestiaryHitDieFallback") ? "fromSize" : "d8");
const rolled = (s.flags?.["vagabond-crawler"]?.rollHpOnSpawn === true) || (game.settings.get("vagabond-crawler","bestiaryHitDieFallback") && !s.flags?.["vagabond-crawler"]?.hitDie);
const hp = calculateHP(s.hd ?? 1, s.size ?? "medium", die);
return {
  // ... existing fields ...
  hp,
  hpDisplay: rolled ? `${hp} (rolled)` : String(hp),
  dpr: calculateDPR(s.actions ?? []),
};
```

- [ ] **Step 2: Update the document branch (line ~919)**

```js
const die    = d.flags?.["vagabond-crawler"]?.hitDie ?? (game.settings.get("vagabond-crawler","bestiaryHitDieFallback") ? "fromSize" : "d8");
const rolled = (d.flags?.["vagabond-crawler"]?.rollHpOnSpawn === true) || (game.settings.get("vagabond-crawler","bestiaryHitDieFallback") && !d.flags?.["vagabond-crawler"]?.hitDie);
const hp = calculateHP(d.system?.hd ?? 1, d.system?.size ?? "medium", die);
return {
  // ... existing fields ...
  hp,
  hpDisplay: rolled ? `${hp} (rolled)` : String(hp),
  dpr: calculateDPR(d.system?.actions ?? []),
};
```

- [ ] **Step 3: Update the Encounter Roller template to use `hpDisplay`**

Open `templates/encounter-roller.hbs`. Grep for `{{hp}}` and replace the relevant occurrence (the table cell rendering NPC HP) with `{{hpDisplay}}`. If there are multiple `{{hp}}` references, only swap the row that corresponds to the table built from these two call sites.

- [ ] **Step 4: Live verification**

After reload, open the Encounter Roller. With one Monster-Creator monster carrying `rollHpOnSpawn = true` and one stock compendium monster, confirm only the former's HP cell ends with `(rolled)`. Toggle the bestiary fallback setting and verify the stock monster's row gains `(rolled)` too.

- [ ] **Step 5: Commit**

```bash
git add scripts/encounter-tools.mjs templates/encounter-roller.hbs
git commit -m "feat(encounter-roller): show rolled-HP marker and configured-die preview"
```

---

### Task 8: Docs + CHANGELOG

**Goal:** Per CLAUDE.md, sync both the GM-facing guide track and the contributor reference track.

**Files:**
- Modify: `docs/exploration.md` (or whichever guide best fits — Encounter Roller / Monster Creator content)
- Modify: `docs/dev/utilities.md` (or whichever dev reference covers the Monster Creator settings — `Grep` for the existing Monster Creator dev section first)
- Modify: `CHANGELOG.md`
- Modify: `module.json` (bump `version`)
- Modify: `README.md` (bump version badge)

**Acceptance Criteria:**
- [ ] User-facing doc has a section titled "Hit Die Configuration" describing: per-monster Hit Die selector, "From Size" mode, Roll on spawn checkbox, the bestiary fallback toggle, and where to find the config window (Forge & Loot menu + Module Settings).
- [ ] Contributor doc lists the two new settings (`hitDieSizeMap`, `bestiaryHitDieFallback`) and the two new actor flags (`hitDie`, `rollHpOnSpawn`).
- [ ] CHANGELOG entry under a new `## [X.Y.Z]` heading, dated `2026-04-25`, calling out the three knobs (per-monster die, roll on spawn, size→die config).
- [ ] `module.json` `version` bumped (minor bump — this is a feature, not a fix).
- [ ] README badge bumped to match.

**Verify:**
- Grep: `Grep(pattern: "Hit Die Configuration", path: "docs/")` → ≥ 1 hit in user track and 1 in dev track.
- Grep: `Grep(pattern: "hitDieSizeMap", path: "docs/dev/")` → ≥ 1 hit.
- Read `module.json` → version is bumped.
- Read first lines of `CHANGELOG.md` → new section is present.

**Steps:**

- [ ] **Step 1: Pick the right user-facing guide**

Grep `docs/*.md` (top-level only, not `docs/dev/`) for "Monster Creator" / "Encounter" — add the section to whichever file already mentions the Monster Creator. If none does, add to `docs/exploration.md` since spawning monsters fits the exploration loop.

- [ ] **Step 2: Pick the right contributor reference**

Grep `docs/dev/*.md` for "Monster Creator" or for an existing `## Settings` table. Add the new settings/flags rows to that table.

- [ ] **Step 3: Write the user-facing section**

Suggested skeleton (~120 words):
```markdown
## Hit Die Configuration

Vagabond's default HP formula is `HD × 4.5`. The Crawler lets you swap that out per monster:

- **Hit Die selector** (Monster Creator → Stats): pick `d4`–`d14`, or leave on `From Size` to follow the global size→die map.
- **Roll on spawn**: when checked, every unlinked token rolls fresh HP (`HD × 1die`) at drop. The GM gets a whispered roll. Linked tokens are skipped.
- **Configure size→die map**: open from the Forge & Loot button (right-click) or Module Settings. The map controls the default die for every monster set to `From Size`.
- **Bestiary fallback** (config window): when ON, compendium NPCs without authored flags also follow the size→die map and roll on spawn.

Small monsters always use `HP = HD` (min 1) regardless of die.
```

- [ ] **Step 4: Update the dev reference**

Add a Settings row block:
```markdown
| `hitDieSizeMap` | Object | `{medium:"d6", large:"d8", huge:"d10", giant:"d12", colossal:"d14"}` | Default die per size for monsters with `flags.vagabond-crawler.hitDie === "fromSize"`. Edited via `HitDieConfigApp`. |
| `bestiaryHitDieFallback` | Boolean | `false` | When true, compendium NPCs without authored flags also use the size map and roll HP on spawn. |
```

And an Actor Flags subsection:
```markdown
### Actor Flags (`flags.vagabond-crawler`)
| Flag | Type | Values | Purpose |
| `hitDie` | string | `"d4"`–`"d14"`, or `"fromSize"` | Per-actor hit die used by `calculateHP` and the spawn roll. |
| `rollHpOnSpawn` | boolean | `true` / `false` | When true, `preCreateToken` rolls `${hd}${die}` and stamps the result into the token's actor delta. |
```

- [ ] **Step 5: CHANGELOG**

Prepend under the topmost `## [Unreleased]` (or create a new dated section):
```markdown
## [X.Y.Z] - 2026-04-25
### Added
- Monster Creator: per-monster **Hit Die** selector (`d4`–`d14`, or "From Size" to follow the global map).
- Monster Creator: **Roll on spawn** toggle. When enabled, unlinked NPC tokens roll fresh HP (`HD × 1die`) at drop time and the GM sees a whispered roll.
- New **Hit Die Configuration** window (Forge & Loot menu + Module Settings) — edit the size→die map and an optional bestiary fallback that applies the rules to compendium NPCs without authored flags.
```

- [ ] **Step 6: Bump `module.json` version and README badge**

Read `module.json`, bump the `"version"` value (minor: e.g. `1.15.0` → `1.16.0`). Update the matching badge line at the top of `README.md`.

- [ ] **Step 7: Final commit**

```bash
git add docs/ CHANGELOG.md module.json README.md
git commit -m "docs: hit-die configuration — user guide, dev reference, changelog, version bump"
```

---

## Self-review checklist (run before handoff)

- [ ] **Spec coverage**: every spec section has at least one task? Cross-checked: data model → Tasks 1–2; UX (Creator + window) → Tasks 3 & 5; behavior (spawn flow + mutations + encounter roller + back-compat) → Tasks 6–7; file map → Tasks 1–8. ✓
- [ ] **Placeholder scan**: no "TBD", no "add appropriate error handling", no "similar to Task N". ✓
- [ ] **Type consistency**: `calculateHP(hd, size, die)` signature is identical across Tasks 1, 5, 7. `resolveHitDieConfig` returns `{ rollOnSpawn, die }` everywhere. Flag keys `hitDie` / `rollHpOnSpawn` are spelled identically across Tasks 5–7.
- [ ] **No tests-as-task-boundary**: each task ends with a verify+commit, not a separate "write tests" task.
- [ ] **One commit per task**: 8 tasks → 8 commits.
