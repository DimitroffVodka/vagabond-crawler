# Crawl Loop

This is the table loop: track the party, switch phases, move, enter combat, and recover afterward.

---

## Crawl Bar

The Crawl Bar sits at the bottom of the GM's screen. Its buttons control the active crawl and open the tools covered in these guides.

- **Start Crawl / End:** begin or end a crawl session.
- **GM Turn / Heroes Turn:** advance to the destination phase shown on the button.
- **Add Tokens:** add selected tokens to the tracker.
- **Encounter:** left-click opens the roller; right-click opens checks and table controls. See [Encounter System](Exploration#encounter-system).
- **Lights:** open the tracker; right-click opens source configuration. See [Light Tracker](Exploration#light-tracker).
- **Combat:** add heroes and NPCs to the combat tracker.
- **Rest:** see [Rest & Breather](#rest--breather).
- **Forge & Loot:** see [Crafting and Loot](Crafting-and-Loot).

There is no separate **Time Passes** button on the current Crawl Bar. Returning from GM to Heroes adds the configured elapsed time; manual time controls are inside the Light Tracker.

---

## Crawl Strip

The Crawl Strip is a top-of-screen HUD visible to everyone while a crawl is active. Heroes appear on the left; NPCs and the GM appear on the right. Each card has a portrait, HP bar, status icons, and name. PC cards, and NPC cards during combat, also show Luck or remaining movement. Crawler sorts the two sides by token disposition, so a friendly NPC summon appears with the Heroes.

Cards brighten or dim with the phase. Hero cards glow during the Heroes phase, and NPC cards glow during the GM phase. In combat, the strip follows the current turn and marks combatants who have acted. Once every hero has acted, the sides swap so the next group stays on the left. The turn counter becomes a round badge with previous and next controls, while hover controls let the GM activate or end a turn.

### Use the strip

1. Select tokens and click **Add Tokens** on the Crawl Bar. They appear as cards, then sort by combat order when combat starts.
2. **Single-click** a card to select and pan to the token. Shift-click to add to the selection. **Double-click** opens the sheet.
3. Hover a card during combat to reveal the tab-strip dropdown (see [Combat Dropdown](#combat-dropdown)).
4. GM-only hover buttons: red × removes the card, activate/end-turn drives the combat tracker, round arrows step round or turn without opening the tracker panel.

#### Movement Tracker

Movement is budgeted and color-coded on the token ruler. During an active crawl the budget is the actor's **crawl speed**; exceed it and the move is blocked with a warning. Terrain difficulty multiplies distance when crossing a Scene Region with a **Modify Movement Cost** behavior (up to 3× for walk). The "Treads Lightly" perk bypasses walk terrain difficulty. Version `1.17.2` does not check the Heroes/GM phase before enforcing that budget, so the phase remains a table-workflow indicator rather than a hard movement lock.

In combat, the budget uses the fastest available movement mode: walk, fly, swim, climb, phase, or cling. A Bat with walk 5 and fly 30 gets 30; a Dragon with walk 40 and fly 80 gets 80. The GM can pin a mode from the Token HUD, and the strip uses the same icon. A combatant can move up to twice that speed by Rushing. The ruler turns red after base speed and blocks movement past twice the speed. A negative `moveRemaining` value shows how much Rush movement was spent.

**Rollback.** At the start of each turn, Crawler stores every tracked token's position. The Token HUD then offers a rollback button at the appropriate phase or combat turn. It returns the token without animation, ignores walls, and restores the movement budget. Player requests go through the connected GM client.

#### Combat Dropdown

Hover a card during combat to open its action tabs. PC cards show **Weapons** and **Spells**, plus situational tabs such as Craft, Beast, Step Up, Virtuoso, or Specialty. NPC cards show **Actions** and **Abilities**.

Click a weapon or NPC action to use Vagabond's normal attack path, including VCE's Favor and Hinder handling when that module is active. Spells open the shared **Cast Spell Dialog**, where you can choose delivery, adjust damage dice, toggle FX, increase area or range, and mark a Focus cast. The mana total updates with those choices and includes Magic Ward surcharges from targeted enemies. Only the card's owners see its menu. The older **NPC Action Menu** setting no longer exists; the menu now depends on ownership and an active combat.

#### HP + Stats Quick Reference

Every card has an HP bar, a current-turn chevron, and a skull when defeated. Hero cards add status icons, with remaining rounds on hover, plus Luck and movement pills. NPC cards show movement during combat unless **Hide NPC Health Bar from Players** is on; that setting hides both HP and movement from non-GMs. A crown marks the GM entry.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Hide NPC Names from Players | Remove NPC names from non-GM strip cards | Off |
| Hide NPC Health Bar from Players | Players can't see NPC HP bars or movement pills; GM still sees them | Off |
| Auto-Hide Defeated Tokens | Defeated tokens disappear from the strip instead of showing a skull | Off |
| Enforce Crawl Movement | Block tracked tokens from exceeding crawl speed while a crawl is active | On |
| Enforce Combat Movement | Block tokens from exceeding 2× base speed during combat | On |
| Enforce NPC Movement | Apply movement enforcement to hostile NPCs too (off = only players are enforced) | Off |

### Token and party notes

- The strip reads HP from `token.actor`, so unlinked NPC tokens keep their own HP instead of borrowing the world actor's value.
- Friendly NPC summons appear on the Heroes side because the strip uses disposition rather than actor type.
- Party actors store speed differently from characters, but the strip handles both shapes.
- Auto-hide does not remove a defeated token. Clear the defeated flag and its card returns.
- Rollback requires a connected GM client when a player requests it.

---

### Crawl Clock

The six-segment progress clock sits on the canvas and uses Vagabond's `ProgressClock` API. Advancing from GM to Heroes fills one segment and runs an Encounter Check. At six segments, the clock resets. Its size and default position are stored in the world, so a new crawl restores them. The clock hides during combat and returns afterward. Right-click it as GM to change its size or position.

### Rest & Breather

The recovery dialog puts every PC's HP, Luck, Mana, Fatigue, Might, and rations in one table. **Rest** restores HP, Luck, and Mana. A character who began at full HP also removes one Fatigue. **Breather** spends one ration and heals HP equal to Might. Crawler finds rations among equipment marked as supplies. A character with none can still appear in the Breather table, but the row says **None!** in red. Cancel closes the dialog without changing anything. Open it with **Rest** on the Crawl Bar.
