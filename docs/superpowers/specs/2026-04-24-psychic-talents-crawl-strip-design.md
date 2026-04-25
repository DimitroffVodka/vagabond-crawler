# Psychic Talents — Crawl Strip Tab — Design

**Date:** 2026-04-24
**Status:** Approved for plan-writing
**Author(s):** DimitroffVodka + Claude
**Related:** `vagabond-character-enhancer/docs/superpowers/specs/2026-04-24-psychic-class-design.md`

## Summary

Surface a Psychic actor's Talents in the Crawl Strip's per-card combat dropdown — the same dropdown that already lists Weapons / Spells / Craft / Step Up / Virtuoso / Summon / Gold Sink. Click a damage or effect Talent → opens VCE's existing TalentCastDialog. Click a buff Talent → toggles Focus directly. No new dialogs, no reorganization of existing tabs.

## Why

The Crawl Strip's per-card dropdown is where players actually act during combat. For every other class, the player's primary cast surface is reachable from the strip without opening their character sheet. Psychics are the exception today — their Talents tab lives only on the sheet. This closes that gap so a Psychic plays at the same speed as a Wizard or Druid.

## Non-goals

- Reordering existing tabs. Spells stays in slot B for everyone (auto-hides when empty per existing behavior).
- Showing currently-focused state on damage/effect Talents. Focus is reflected on the character sheet's Talents tab; the strip dropdown is a launch surface, not a status display.
- Multi-Focus management UI from the strip. Toggling buff Talents past `maxFocus` shows a `ui.notifications.warn` and does nothing — the player manages capacity from the sheet.
- Loadout / known-talent picker from the strip. Pick dialog stays sheet-side per the psychic spec.
- Showing Talents for non-Psychic actors. Detection is "actor has talent items" (via `getTalentData`), not class name — covers multiclass cleanly without touching this spec.

## Architecture

The work is a thin integration layer. VCE owns the talent data, the cast dialog, the focus state, and the AE wiring. Crawler owns the strip's tab UI and routes clicks back to VCE. This mirrors the existing alchemy / polymorph / virtuoso / summon / gold-sink integrations.

### VCE-side API additions

Added in VCE's ready hook on `game.vagabondCharacterEnhancer`:

```js
getTalentData(actor)
  // → { hasTalents, talents: [{ id, name, dmgLabel, isBuff, isFocused }], focusedIds, maxFocus }
  // → null if actor has no talent items

castTalent(actor, talentItemId)
  // Opens TalentCastDialog for the given talent item.

toggleTalentFocus(actor, talentItemId)
  // Add/remove from flags.vagabond-character-enhancer.psychicTalents.focusedIds.
  // Apply/remove focusBuffAE if the talent is a buff Talent.
  // Reject with ui.notifications.warn if at maxFocus capacity.
```

`castTalent` and `toggleTalentFocus` are not new behaviors — they are required by the Talents tab on the character sheet (psychic spec Phases 5 & 6). This work just guarantees they're exposed on the public API surface that the crawler consumes.

`getTalentData` returns a flat, render-ready shape so Crawler does not need to know VCE's flag structure or item type. Per-talent fields:

- `id` — talent item id
- `name` — display label
- `dmgLabel` — pre-formatted right-side preview string (e.g. `1d6 fire`); empty for non-damage talents
- `isBuff` — true for the four self-buff Talents (Absence, Evade, Shield, Transvection)
- `isFocused` — current focus state; used only for the buff-toggle affordance

### Crawler-side changes

Two functions in `scripts/npc-action-menu.mjs` extend. No other files change.

**`_buildMenuData` (player branch)** gets one new block, parallel to the existing alchemy / polymorph / virtuoso / summon / gold-sink blocks:

```js
const talentData = game.vagabondCharacterEnhancer?.getTalentData?.(actor);
if (talentData?.hasTalents) {
  const talentItems = talentData.talents.map(t => ({
    label: t.name,
    dmg:   t.dmgLabel,
    type:  t.isBuff ? "talentBuff" : "talent",
    itemId: t.id,
    isFocused: t.isFocused,
  }));
  if (!result.tabC) { result.tabC = "Talents"; result.itemsC = talentItems; }
  else if (!result.tabD) { result.tabD = "Talents"; result.itemsD = talentItems; }
}
```

This sits after the existing Gold Sink block. Slot priority is "first free of C/D"; if both are taken by other features (rare — would require alchemy + dance + bard + summon + gold-sink + psychic on one actor), Talents doesn't appear. Same trade-off Gold Sink already accepts and documents.

**`_fireAction`** gets two new branches alongside `weapon`, `spell`, `craft`, etc.:

```js
} else if (type === "talent") {
  await game.vagabondCharacterEnhancer.castTalent(actor, itemId);
} else if (type === "talentBuff") {
  await game.vagabondCharacterEnhancer.toggleTalentFocus(actor, itemId);
}
```

Both are graceful no-ops if VCE is not installed (`?.` chain on `game.vagabondCharacterEnhancer`).

### Visual

Talent rows render with the existing `.vcs-panel-item` class — same look as spell / weapon rows. The right-side preview slot uses VCE-supplied `dmgLabel` (e.g. `1d6 fire` for Pyrokinesis, empty for Befuddle / Seize / buff Talents). Damage Talents read identical to spell rows; non-damage Talents look identical to existing label-less rows (Step Up's "Bonus Action" omitted case, etc.).

**Focused-buff affordance** is the one new visual: a focused buff Talent gets a `.vcs-panel-item-focused` class on the row, styled with a subtle accent dot or border highlight. This is the minimum needed to make the toggle button useful — without it the player can't see whether clicking Shield will turn it on or off. Style added to `styles/vagabond-crawler.css` under the existing strip section, using `--vcb-*` tokens (no hardcoded hex).

No new icons, no badges, no tooltip changes. Anything beyond a focus indicator belongs on the character sheet.

## Data flow

```
[player clicks talent row]
  → strip click handler reads dataset.type, dataset.itemId
  → _fireAction(actor, "talent" | "talentBuff", _, itemId)
  → game.vagabondCharacterEnhancer.castTalent  (opens TalentCastDialog → existing pipeline)
    OR
    game.vagabondCharacterEnhancer.toggleTalentFocus
      → mutates flags.vagabond-character-enhancer.psychicTalents.focusedIds
      → if buff: applies/removes focusBuffAE on actor
      → re-renders Talents tab on the character sheet (existing reactivity)
      → strip's queueRender fires on actor update → row re-renders with new isFocused
  → strip dropdown closes (existing _removePanel after _fireAction)
```

The actor-update reactivity that drives the strip's portrait re-render also catches focus toggles automatically — no new hook needed in Crawler.

## Error handling

- **VCE not installed / older version**: `game.vagabondCharacterEnhancer?.getTalentData?.(actor)` resolves to `undefined`, the talent block is skipped entirely. No tab, no error.
- **Slot exhaustion (C and D both taken)**: Talents tab silently doesn't appear. Documented as a known trade-off in this spec; matches Gold Sink behavior. Mitigation if it bites in practice: VCE-side priority hint that pushes Talents into D when collision detected (future work, not in scope).
- **toggleTalentFocus past maxFocus**: VCE-side `ui.notifications.warn`, no state change. Crawler doesn't need to pre-check capacity; VCE is the source of truth.
- **Non-owner clicks**: existing `_fireAction` ownership check (`if (!resolvedActor?.isOwner) return`) catches this before the VCE call fires.

## Testing

Manual via Foundry MCP — these match the success criteria.

1. **Vanilla Psychic, no spells**: tab strip shows `[Weapons] [Talents]`. Click Pyrokinesis → TalentCastDialog opens. Cancel → no chat card.
2. **Pyrokinesis full path**: TalentCastDialog → Touch delivery → Cast → 1d6 fire damage chat card. Save button on card works.
3. **Buff toggle**: Click Shield → focus on, `.vcs-panel-item-focused` class applied next render, AE present on actor. Click Shield again → focus off, AE gone.
4. **Capacity reject**: at `maxFocus = 1`, focus Shield. Try to focus Evade → `ui.notifications.warn`, Evade not focused.
5. **Magical Secret multiclass**: Psychic with one Wizard spell. Tab strip shows `[Weapons] [Spells] [Talents]`. Both tabs functional.
6. **Slot collision**: Psychic + Alchemist + Bard (Craft + Virtuoso + Summon if applicable). Verify Talents lands in D when C is taken; or silently drops if D also taken (acceptable per non-goals).
7. **VCE absent**: disable VCE, reload. No errors. Tab strip on player cards shows `[Weapons] [Spells]` only — no Talents tab, no console errors.
8. **Non-owner click**: GM clicks a player's Talent row from a non-owned card → ownership warning, no dialog. (Existing behavior, regression check.)

## Files

### Modified — Crawler

- `scripts/npc-action-menu.mjs` — talent block in `_buildMenuData`; two branches in `_fireAction`.
- `styles/vagabond-crawler.css` — `.vcs-panel-item-focused` rule.

### Modified — VCE (depends on psychic spec Phases 5–6 landing first)

- `scripts/vagabond-character-enhancer.mjs` — expose `getTalentData`, `castTalent`, `toggleTalentFocus` on `game.vagabondCharacterEnhancer` at ready.
- `scripts/talent/talents-tab.mjs` (or wherever `castTalent` / `toggleTalentFocus` end up implemented) — make these callable from outside the tab handler. They're called internally by the sheet UI per the psychic spec; this work just exports them.

### New — none.

## Risks

- **VCE API timing.** Crawler's `_buildMenuData` runs every strip render; VCE registers its API in its `ready` hook. If VCE loads slower than expected, `getTalentData` is briefly `undefined`. The optional-chain handles this — the tab simply doesn't appear until VCE is ready, then appears on the next render. No error path needed.
- **Class detection drift.** Detection is "actor has talent items" — relies on the items existing. If a player drags talents off their actor for any reason (loadout swap mid-session?), the Talents tab disappears until they're re-added. This matches the spec's "no loadout management UI" non-goal and is correct behavior.
- **Multi-feature slot exhaustion.** As noted, Psychic + Alchemist + Bard + Summoner + Merchant on one actor would push Talents off the strip. Edge case. If it ever bites, fix is VCE-side priority (Talents wins over Gold Sink, etc.) not a Crawler change.

## Success criteria

- A Psychic player can cast Pyrokinesis from the Crawl Strip without opening their character sheet, and the chat card / save flow works identically to a sheet-launched cast.
- A Psychic player can toggle Focus on Shield from the strip; the buff AE applies and is visible on the portrait's effects row.
- VCE-uninstalled and non-Psychic actors are unaffected.
- No regressions in existing dropdown tabs (Weapons, Spells, Craft, Step Up, Virtuoso, Summon, Gold Sink).
