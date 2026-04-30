# Vagabond Crawler

Dungeon crawl management module for the **Vagabond RPG** system on Foundry VTT v13+.

## Quick Reference

- **Module ID**: `vagabond-crawler`
- **Entry point**: `scripts/vagabond-crawler.mjs`
- **System dependency**: vagabond v4.1.0+
- **Optional dependency**: vagabond-extras
- **No build step** — raw ES modules (`.mjs`), single CSS file, Handlebars templates

## Architecture

### Subsystem Pattern

Every feature is a **singleton object** (not a class) exported by name, registered on `game.vagabondCrawler`, and initialized in the main entry point:

```js
// Declare
export const FeatureName = {
  _state: null,
  get active() { return this._state?.active ?? false; },
  async init() { /* hook registration, etc. */ },
  render() { /* DOM update */ },
};

// Register in vagabond-crawler.mjs
import { FeatureName } from "./feature-name.mjs";
// Hooks.once("init")  → register settings
// Hooks.once("ready") → game.vagabondCrawler.featureName = FeatureName; FeatureName.init();
```

Exceptions: `EncounterRollerApp`, `RelicForgeApp`, `LootManagerApp`, `LootTrackerApp`, `ScrollForgeApp`, `LootGeneratorApp`, `AnimationFxConfigApp`, `LightSourcesConfigApp` — these are `ApplicationV2` window classes using `HandlebarsApplicationMixin`.

### State & Sync

- **Persistence**: `game.settings.set(MODULE_ID, key, value)` for world-scoped data
- **Multi-client sync**: GM broadcasts via `game.socket.emit("module.vagabond-crawler", { action, ... })`, clients apply in the socket handler
- **Deep clone** state before persisting or broadcasting: `foundry.utils.deepClone()`
- **Actor flags**: `actor.getFlag(MODULE_ID, key)` / `actor.setFlag(MODULE_ID, key, value)` for per-actor data

### UI Components

Two patterns:

**1. Singleton DOM components** (CrawlBar, CrawlStrip):
- `mount()` — create root element, append to Foundry UI, store as `_el`, call `render()`
- `render()` — rebuild `_el.innerHTML`, then `_bindEvents()`
- `_bindEvents()` — delegate via `[data-action]` attributes
- Guard: `if (!this._el) return;` at top of render

**2. ApplicationV2 windows** (encounter roller, relic forge, loot manager/tracker, scroll forge, merchant shop, party inventory, animation FX config):
```js
class MyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { id: "vagabond-crawler-my-app", window: { title: "..." }, position: { width: 700 } };
  static PARTS = { form: { template: "modules/vagabond-crawler/templates/my-app.hbs" } };
  async _prepareContext() { return { /* template data */ }; }
}
```

### Hook Management

- `Hooks.once("init")` — register settings only
- `Hooks.once("ready")` — mount UI, restore state, call `.init()` on subsystems
- `Hooks.on(...)` — continuous listeners; store IDs in `_hookIds` array for cleanup
- Always guard: `if (!game.user.isGM) return;` for GM-only operations

## File Map

| File | Purpose |
|---|---|
| `vagabond-crawler.mjs` | Entry point — settings, ready hook, socket handler, global exposure, inventory patches (auto-stack, qty badges, slot counting, weightless flag, scroll context menu) |
| `crawl-state.mjs` | Single source of truth for crawl mode (active, phase, members, turns, clock) |
| `crawl-bar.mjs` | Bottom GM-only control bar + Forge & Loot tool picker panel |
| `crawl-strip.mjs` | Top HUD strip for all players — portraits, HP, status, NPC action menus. Disposition-based hero/NPC split |
| `movement-tracker.mjs` | TokenRuler subclass — movement budget enforcement (crawl + combat), terrain difficulty, rollback (GM + player via socket) |
| `encounter-tools.mjs` | Encounter check (d6), EncounterRollerApp (table builder, NPC browser, mutator) |
| `monster-mutator.mjs` | 64 mutations with stat recalculation, custom names |
| `mutation-data.mjs` | Mutation definitions and conflict rules |
| `light-tracker.mjs` | Light source burn time, fuel system (lanterns consume oil), 12 light source types, real-time mode, canvas drop/pickup, party token light transfer |
| `morale-checker.mjs` | Auto morale checks on death/half-defeated/solo-half-HP |
| `rest-breather.mjs` | Recovery dialog — breather (ration + heal) and full rest |
| `flanking-checker.mjs` | Auto-apply Vulnerable when 2+ allies adjacent to foe, mirrors outgoingSavesModifier to world actor for unlinked tokens |
| `npc-abilities.mjs` | Passive hooks: Pack Instincts/Tactics (save hinder), Magic Ward I/II/III (cast penalty), npcAction wrapper |
| `animation-fx.mjs` | Animation FX subsystem — unified resolver + playback for weapons, alchemical, gear, NPC actions. Chat hook trigger. Per-item/per-action override flags. |
| `animation-fx-config.mjs` | ApplicationV2 config window for Animation FX — 6 tabs (Weapons, Skill Fallbacks, Alchemical, Gear, NPC Actions, Settings) with hit/miss animation editor |
| `light-sources-config.mjs` | Light Sources Configuration ApplicationV2 window — edit per-type Foundry light properties (dim/bright/color/animation) for the 12 light source types |
| `animation-fx-defaults.mjs` | Default Animation FX preset data (JB2A-aware at runtime) |
| `npc-action-menu.mjs` | Combat action dropdown + spell cast dialog with mana cost calc, CrawlerSpellDialog |
| `combat-helpers.mjs` | Shared utilities for combat-related subsystems (plain module, not a singleton) |
| `countdown-roller.mjs` | Auto-rolls countdown dice at round start, applies tick damage, cleans up on combat end |
| `scroll-forge.mjs` | Spell Scroll Forge ApplicationV2 — create consumable scrolls from compendium, use via context menu |
| `relic-forge.mjs` | Relic crafting ApplicationV2 window |
| `relic-effects.mjs` | Relic power application and active effects |
| `relic-powers.mjs` | Relic power definitions |
| `loot-drops.mjs` | Automatic loot assignment on NPC defeat (Owner permission for all players) |
| `loot-manager.mjs` | Loot distribution ApplicationV2 window |
| `loot-tracker.mjs` | Session loot tracking ApplicationV2 window |
| `loot-tables.mjs` | Loot table definitions and roll logic |
| `loot-generator.mjs` | Loot Generator — roll on core Vagabond loot tables (Levels 1-10) with compendium item creation |
| `loot-data.mjs` | Embedded loot table data from the Vagabond core book |
| `merchant-shop.mjs` | Two-mode shop ApplicationV2 — compendium global inventory or NPC actor inventory; GM opens for all players |
| `party-inventory.mjs` | Party inventory view ApplicationV2 — side-by-side member inventories for loot redistribution |
| `item-drops.mjs` | Canvas item drop handling (Owner permission, skipStack on pickup) |
| `crawl-clock.mjs` | SVG progress clock on canvas |
| `dialog-helpers.mjs` | `confirmDialog()` and `waitDialog()` wrappers around DialogV2 |
| `icons.mjs` | Centralized icon registry (FontAwesome + custom SVGs) |
| `chat-tooltips.mjs` | Inline damage dice tooltips in chat |

## Documentation

- `docs/*.md` — **GM-facing guide.** Usage-first, with screenshots/gifs. Organized by use-case (`crawl-loop`, `combat`, `exploration`, `crafting-loot`, `session-tracking`, `player-quickref`). Landing page for module users; README cross-links into this track.
- `docs/dev/*.md` — **Contributor / technical reference.** Architecture tables, state shapes, hook names, setting keys, file roles. The old top-level `docs/*.md` files (crawl-system, combat-tools, exploration-tools, utilities) live here now.
- `docs/audit/` — Monster dataset (JSON + markdown views of the 348-monster bestiary, ability automation status, findings). Regenerated via `scripts/audit/`.
- `docs/superpowers/` — Planning system. `specs/` holds design docs, `plans/` holds implementation plans and `.tasks.json` state files.
- `README.md` — Short landing page. Headline features grid links into `docs/`.

**When changing module behavior:** update the matching guide file under `docs/` (for user-visible changes) AND the matching reference file under `docs/dev/` (for architectural changes). The two tracks should stay in sync — one is what players and GMs read, the other is what future-Claude and contributors read.

## Naming Conventions

- **Files**: `kebab-case.mjs`
- **Exports**: `PascalCase` singletons (`CrawlState`, `CrawlBar`), `camelCase` functions (`confirmDialog`)
- **Constants**: `SCREAMING_SNAKE_CASE` (`MODULE_ID`, `ICONS`)
- **Private members**: `_` prefix (`_state`, `_el`, `_save()`, `_broadcast()`)
- **CSS classes**: prefixed — `vcb-` (bar), `vcs-` (strip), `vcl-` (light tracker)
- **CSS variables**: `--vcb-*` (surfaces, accents, phase colors, shadows)
- **DOM IDs**: `vagabond-crawler-*` (full descriptive kebab-case)
- **Settings keys**: `camelCase` (`encounterThreshold`, `hideNpcNames`)
- **i18n keys**: `VAGABOND_CRAWLER.PascalCaseKey`

## CSS Theming

All colors use CSS custom properties defined on `:root` (dark default) with `body.theme-light` overrides. Organized into sections: surfaces, borders, accents, text, shadows, phase colors (`--vcb-heroes`, `--vcb-gm`, `--vcb-combat`). Single file: `styles/vagabond-crawler.css`.

## Design Context

Full design guidelines live in `.impeccable.md` at the repo root — read that file for the complete context before any visual/UI work. Summary:

- **Users:** GMs running dungeon-crawl sessions at the table. Decisions made in seconds; fiction momentum is priority.
- **Personality:** Gritty, atmospheric, functional. GM-to-GM voice. Confident, concise.
- **Emotional goal:** GM feels in control and confident — informative density without visual chaos.
- **Reference corpus:** Video game RPG UIs — Baldur's Gate 3, Pathfinder: WotR, Darkest Dungeon. Worn textures, ornamental borders, strong typography on chrome.
- **Anti-references:** Modern SaaS aesthetic (Linear/Notion), neon/cyber palettes, generic AI-polish look (purple gradients, emoji decoration).

**Five principles:**

1. **Legibility over mood.** The Crawl Strip must pass the "one-second glance" test during combat. If atmosphere slows the read, cut it.
2. **Phase semantics are sacred.** Heroes green / GM blue / Combat red is game grammar. Never recolor; extend scales instead.
3. **Atmosphere lives in the chrome, not the data.** Textures and ornaments on window frames, headers, banners. Never on HP bars, portraits, settings, data cards.
4. **Dark is the pilot, light is the co-pilot.** Dark mode is primary; light must stay functional but doesn't need to match mood intensity.
5. **WCAG AA + reduced motion.** Meet AA text/UI contrast. Never rely on color alone — always pair with icon/label. Respect `prefers-reduced-motion`.

**Never hardcode hex colors in new CSS** — use the `--vcb-*` token system exclusively. Additions go in the matching subsystem's section of `styles/vagabond-crawler.css` with a comment banner.

## Commits

Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`. Short imperative description.

## Common Patterns

- **Safe defaults**: `value ?? fallback`, `obj?.prop`
- **Early returns**: guard clauses at top of every method
- **GM check**: `if (!game.user.isGM) return;` before state mutations or broadcasts
- **Render debounce**: CrawlStrip uses `requestAnimationFrame` queuing
- **Linked + unlinked tokens**: always handle both — use `token.actor` (synthetic) not just actor ID
- **World actor vs token actor**: the save system uses `game.actors.get(actorId)` (world actor). When applying effects to unlinked tokens, mirror relevant changes (e.g. `outgoingSavesModifier`) to the world actor too. See flanking-checker and npc-abilities for examples.
- **Passing actors to npc-abilities helpers**: `applyPackInstincts` and similar expect the synthetic token actor (`tok.actor`), not the world actor. World-actor `getActiveTokens(true)` often returns empty for unlinked tokens, causing the helper to silently no-op.
- **Disposition over actor type**: use `token.document.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY` for hero/NPC classification, NOT `actor.type === "character"`. Friendly NPC summons must appear on the Heroes side.
- **Party actor speed**: `system.speed` is an object `{ base, crawl }` on characters but a flat number on party actors. Always check `typeof system.speed === "object"` before accessing `.base` / `.crawl`.
- **skipStack option**: pass `{ skipStack: true }` to `createEmbeddedDocuments` when creating items that should NOT auto-merge (lit torches, picked-up items with state).
- **Player actions via socket**: players can't modify GM-owned data directly. Relay via `game.socket.emit("module.vagabond-crawler", { action, ... })` and handle on the GM client. See rollbackMove, itemDrop:pickup, dropLight.
- **ApplicationV2 render hooks**: Foundry v13 fires `render{ClassName}` (e.g. `renderVagabondCharacterSheet`), NOT `renderActorSheet`. Hook both for safety.
- **Foundry API**: prefer `foundry.utils.deepClone()`, `foundry.utils.mergeObject()`, `fromUuidSync()`

## Debugging

```js
game.vagabondCrawler.state            // crawl state object
game.vagabondCrawler.debugCombat()    // active combat summary
game.vagabondCrawler.debugSpeed()     // selected token's speed data
game.vagabondCrawler.scrollForge.open()  // open Scroll Forge
game.vagabondCrawler.animationFx.syncToItems()  // push config → item.system.itemFx for all world weapons
game.vagabondCrawler.animationFx.startPersistent(preset, token)  // idempotent light-on
game.vagabondCrawler.animationFx.stopPersistent(preset, token)   // idempotent light-off
game.vagabondCrawler.movement._turnStartPos  // rollback position snapshots
game.vagabondCrawler.lightTracker.openSourcesConfig()  // open light sources config
game.vagabondCrawler.lightTracker.getLightSourcesConfig()  // inspect current overrides
game.patrol                           // Patrol module instances (if installed)
```

**Foundry MCP testing — use it.** A live FoundryVTT instance is reachable via the `foundry-mcp-bridge` module's MCP tools. When you make a change that touches runtime behavior — a hook, a singleton's state, a socket message, a render path, anything that only matters at runtime — drive it through the live game and verify the actual chat messages, flag state, socket traffic, and console output before reporting "done." **Don't ask the user to F5 and report results back unless you genuinely have no MCP access; reload it yourself via `evaluate({ code: 'setTimeout(() => window.location.reload(), 100); "reloading"' })` and test.**

For state-leak / hook-order / socket-desync investigations specifically (the dominant Crawler failure modes):
- **Hook ordering** → `trace_hooks` with the relevant pre/post hooks; inspect the timeline `dt` values.
- **Socket desync** → `trace_socket` with `filter: "module.vagabond-crawler"` during the action; verify GM emit ↔ client receive ordering.
- **State changes** → `snapshot_actor` before, perform action, `diff_actor` after to verify the change footprint matches intent.
- **Silent failures** → `get_console_errors` with `sinceMs` scoped to the action window.

Notes:
- `mcp__foundry-vtt__evaluate` runs JS in the live game context. Module-wrapped classes (`SpellHandler`, `VagabondItem`) are already wrapped — test against live behavior, not the raw system code.
- Reload via `evaluate { setTimeout(() => window.location.reload(), 100); "reloading" }`. Wait ~3-5s then re-query. The MCP reconnects automatically.
- Results larger than ~256KB are saved to a file path instead of returned inline; use `jq` on the file to extract.
- For weapon-attack tests, VCE's `RangeValidator` returns `null` from `rollAttack` if target is out of range — pick an adjacent target or expect no roll formula in the result.
- For transient test actors/tokens: create unlinked tokens from a cloned world actor so `token.actor` is synthetic (matches the real runtime path for NPCs); clean up both tokens and world actors in `finally`.

If MCP testing isn't possible (server down, no connection), explicitly say so rather than just claiming the work is done off-disk.

## System / Module Wrap Chain Gotchas

The `vagabond-character-enhancer` (VCE) module wraps several system methods in its `ready` hook. Since it's alphabetically before `vagabond-crawler`, VCE's ready fires first. Consequences:

- **VCE wraps** `SpellHandler.castSpell`, `VagabondItem.rollAttack`, `VagabondRollBuilder.buildAndEvaluateD20WithRollData`, `VagabondDamageHelper.calculateFinalDamage`, etc.
- **`_rangeFavorHinder` pattern**: VCE's `rollAttack` wrap strips the `favorHinder` argument and re-injects it via module-scope state inside its `buildAndEvaluateD20` wrap. A wrap that modifies `favorHinder` BEFORE VCE runs its combine will be overwritten.
- **Fix for "run after VCE's favor combine"**: wrap in `Hooks.once("setup", ...)` (fires before any `ready` hook). Our wrap becomes innermost → VCE calls through to us with the fully-combined favor. See `registerEarlyRollBuilderWrap()` in `scripts/npc-abilities.mjs`.
- **For weapon attacks**: the system's target-side `incomingAttacksModifier` is applied inside `rollAttack` using 1-for-1 cancellation (`systems/vagabond/module/documents/item.mjs:592`). By the time `buildAndEvaluateD20` fires, target modifiers are already baked into `favorHinder`.
- **Damage resolution**: `VagabondDamageHelper.calculateFinalDamage` (`systems/vagabond/module/helpers/damage-helper.mjs:1117`) reads `actor.system.armor` directly. Active Effects with `system.armor` OVERRIDE work transparently — no need to wrap the damage helper (see Soft Underbelly).

## Monster Audit Database (`docs/audit/`)

Committed dataset of every NPC across the Vagabond compendium packs. Source JSON + derived Markdown. Used as the ground-truth reference for ability automation work in `scripts/npc-abilities.mjs`.

- **Source files**: `docs/audit/{monsters,abilities,actions,findings}.json`
- **Readable views**: `docs/audit/abilities.md`, `actions.md`, `by-type/*.md`, `INDEX.md`
- **Regenerate** (after compendium changes): run `scripts/audit/extract.mjs`'s body via `mcp__foundry-vtt__evaluate`, write result to `monsters.json`, then `node scripts/audit/analyze.mjs && node scripts/audit/markdown.mjs`. Output is deterministic.
- **`scripts/audit/analyze.mjs` mirrors `PASSIVE_ABILITIES`** from `scripts/npc-abilities.mjs` — update both when adding ability automation so the audit flips the entry from `unimplemented` to `implemented`.
- **Implementing a new ability**: add `PASSIVE_ABILITIES` entry in `scripts/npc-abilities.mjs`, mirror in `scripts/audit/analyze.mjs`, re-run audit, test via Foundry MCP with live actor tokens (spawn temp world actors for unlinked-token cases).

## Releasing a New Version

1. Bump `"version"` in `module.json`
2. Update `CHANGELOG.md` and the README version badge
3. Commit and push
4. Build `module.zip` with all files inside a `vagabond-crawler/` wrapper folder (Foundry requires this structure). No `.git`, `.claude`, `docs`, or `data` dirs:
   ```python
   python -c "
   import zipfile, os
   with zipfile.ZipFile('module.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
       for folder in ['scripts', 'styles', 'templates', 'languages', 'icons']:
           for root, dirs, files in os.walk(folder):
               for f in files:
                   fp = os.path.join(root, f)
                   zf.write(fp, 'vagabond-crawler/' + fp.replace(os.sep, '/'))
       for f in ['module.json', 'CHANGELOG.md', 'README.md', 'CLAUDE.md']:
           if os.path.exists(f): zf.write(f, 'vagabond-crawler/' + f)
   "
   ```
5. Create the GitHub release with **both** `module.json` and `module.zip` as assets:
   ```bash
   gh release create vX.Y.Z module.json module.zip --title "vX.Y.Z" --notes "..."
   ```

**Critical**: The `module.json` manifest URLs must be:
- `"manifest"`: `https://github.com/DimitroffVodka/vagabond-crawler/releases/latest/download/module.json`
- `"download"`: `https://github.com/DimitroffVodka/vagabond-crawler/releases/latest/download/module.zip`

Both use the `latest` redirect so existing users always find the newest release. **Never** hardcode a version in these URLs. The `module.zip` asset **must** be uploaded to every release or the download will 404.

## Adding a New Feature

1. Create `scripts/feature-name.mjs` — export singleton object with `init()` and any needed methods
2. Import in `vagabond-crawler.mjs`
3. Register settings in `Hooks.once("init")` (or delegate to `FeatureName.registerSettings()`)
4. Add to `game.vagabondCrawler` and call `FeatureName.init()` in `Hooks.once("ready")`
5. If it needs sync: add a socket action in the socket handler
6. If it has UI: add CSS with `vcb-` prefix to `vagabond-crawler.css`, add `--vcb-*` variables for any colors
7. If it needs a window: extend `HandlebarsApplicationMixin(ApplicationV2)`, add `.hbs` template in `templates/`
