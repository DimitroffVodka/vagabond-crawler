# Player Quick Reference

This page covers the Crawler controls a player uses during crawl turns, combat, light use, shopping, and item handoff.

Foundry keybindings can change by version, browser, and installed modules. Use **Game Settings → Configure Controls** for the bindings active in your world. The shortcut tables in the older repository guide were not Crawler features and have not been carried over as Crawler guarantees.

Target the intended enemy before an attack, spell, or target-side save. Crawler reads the current target set for Magic Ward, Nimble, target-side modifiers, and spell scrolls.

---

## Vagabond Crawler player features

### Crawl Strip

- Click a card once to select and pan to its token.
- Shift-click to add the token to your current selection.
- Double-click to open the actor sheet.
- Hover a card you own during combat to open its available action tabs.
- Your card can show HP, Luck, status, movement, movement mode, defeated state, and turn highlighting.

During a crawl, move within the budget shown on your card. Version `1.18.0` does not use the Heroes/GM phase as a hard movement lock, so follow the GM's phase call even though the ruler can still enforce movement during GM Turn. In combat, Rush can extend movement to twice the active speed unless the actor is overloaded.

When the Token HUD offers **Rollback**, it returns the token to its turn-start position and restores the movement budget. A player request needs a connected GM client.

### Inventory

- Right-click supported items for actions such as **Light**, **Extinguish**, and **Use Scroll**.
- Matching items can merge into a quantity stack and receive a quantity badge.
- Zero-slot items (rations, coins, backpacks) are free, same as the core rules.
- A stack of N costs N × the item's slot value — two torches use two slots.
- Slot cost comes from the item, not its name: a plain **Candle** is free, an alchemical **Candle, Basic** costs one.
- Items stowed inside a container cost nothing; the container's own slots cover them.

### Light sources

Right-click a supported source and choose **Light**. Choose **Extinguish** to preserve the remaining time. Real-time burn is off by default; without it, the GM's crawl-time changes burn active sources. Lanterns use supported oil when they run dry.

Drag a lit source onto the canvas to leave it behind. Use its Token HUD pickup control to assign it to an eligible actor again.

### Combat

- Supported non-recharge countdowns can roll at round start when the GM leaves **Auto-Roll Countdown Dice** on.
- Two allies within 5 feet can make a foe **Vulnerable** when the size rule permits the flank.
- Morale checks run for enemy groups and solo enemies at the configured triggers; GMs receive the result.

### Weapons, spells, and actions

PC cards can show **Weapons**, **Spells**, and situational tabs supplied by Vagabond or Character Enhancer. Owned NPC cards can show **Actions** and **Abilities**. Weapon and action choices use Vagabond's normal roll paths. Spell choices open the shared cast dialog.

### Spell scrolls

Right-click a Crawler scroll and choose **Use Scroll**. It costs no mana, skips the Cast Check, reads your targets, rolls supported damage and FX, and is consumed or decremented.

A scroll never crits in version `1.18.0`, so any critical rider on the spell cannot fire. The scroll also reads the spell live from the compendium, so a GM editing that spell changes what your existing scrolls do.

### Merchant Shop

When the GM makes a shop available, open it from the chat card or the Crawl Strip. Choose the correct owned character before buying, selling, browsing the Catalog, or gambling. A connected GM client processes the request.

The shop does not force itself open for every player. Use it only with trusted players in version `1.18.0`; its GM socket handlers do not independently re-check every ownership and pricing input.

### Session Recap

Type `!recap` in chat to open the recap locally. Players can review and copy recap information; the GM controls the lifecycle and destructive actions.

---

## See also

- [Crawl Loop](Crawl-Loop): turn structure and movement budgets.
- [NPC Combat Automation](NPC-Combat-Automation#flanking-checker): flanking and other NPC-side rules.
- [Crafting and Loot: Item Drops](Crafting-and-Loot#item-drops): picking up items from the canvas.
- [Session Recap](Session-Tracking#session-recap): type `!recap` in chat to see session stats.
