# Exploration

Use these tools to check for encounters, build encounter tables, create NPCs, choose their Hit Dice, and track carried light.

---

## Encounter System

The Encounter System has two parts. **Encounter Check** rolls `1d6` against the current threshold. **Encounter Roller** is a four-tab window for building tables, browsing NPCs, rolling existing tables, and creating monsters.

On a hit, Crawler can pause the world, open the roller, and roll the active table. On a miss, it posts **No Encounter** to chat. Result cards show enemy count, distance, and reaction. Each part has its own reroll control, so changing the reaction does not reroll the count. The GM can post the result to chat or place Actor results on the active scene.

### Run an encounter

1. Right-click **Encounter** on the GM's Crawl Bar and choose **Encounter Check**. A result at or below the threshold is a hit.
2. Left-click **Encounter** to open the roller. In **Build Table**, choose a die type, name the table, and drag NPCs into its numbered slots. Set **# Appearing** for each entry.
3. Use **Browse NPCs** to filter World NPCs, Scene NPCs, Bestiary, or Humanlike by name, being type, Threat Level, senses, weaknesses, immunities, abilities, or cast attacks. Click the plus control to fill the next empty Build Table slot.
4. In **Roll Tables**, roll any world RollTable or click **Set Active** so encounter hits use it automatically.
5. Open **Monster Creator** to build or mutate a world NPC without leaving the Encounter Roller.

**Place Token(s)** needs an active scene and a table result that resolves to an Actor UUID. Text-only results can be rolled and posted, but Crawler cannot turn them into tokens.

> **Version 1.18.0 limitation:** when Crawler creates a new table, it prefixes the selected die type with `1`. Choosing `2d6` therefore saves `12d6`. Use a single-die type for a new table or correct the world RollTable formula afterward.

### Settings

| Setting | Effect | Default |
|---|---|---|
| Encounter Roll: GM Only | Whisper check results to the GM instead of broadcasting | On |
| Pause Game on Encounter Hit | Pause before handling a successful check | On |
| Default Encounter Threshold | N-in-6 chance on a `1d6` check | 1 |
| Active Encounter Table | Table UUID rolled on a hit | None |
| Excluded Table Folders | Folder IDs hidden from Roll Tables | None |

### Encounter notes

- Version `1.18.0` offers World NPCs, Scene NPCs, Bestiary, and Humanlike sources. The older guide's claim that arbitrary module or VCE packs appear in the source list is stale.
- Filters survive tab changes, so opening Build Table and returning to Browse NPCs keeps the current search.
- Without an active table, Encounter Check reports the hit or miss but has nothing to preroll.
- Monster Creator saves a new world actor and never edits the source compendium.

---

## Monster Creator

Monster Creator builds a new Vagabond NPC world actor from scratch or prefills one from the core Bestiary or Humanlike compendium. Its collapsible sections cover identity, defenses, actions, abilities, mutations, and description. Saving creates a new world actor and leaves the source compendium alone.

The old Monster Mutator now lives inside this window. Its 64 mutations can change names, actions, abilities, and derived numbers. Action and Ability Quick Picks cover common entries such as "Claws 2d6 piercing" or "Magic Ward II." A green ✓ marks live automation, ⚠ marks a catalogued but unautomated entry, and 📖 marks reference text.

### Create a monster

1. Open **Encounter → Monster Creator** as GM.
2. Optionally load a monster from Bestiary or Humanlike. Filter the list, then click a row to prefill the form. Portrait, token image, senses, speed modes, actions, and abilities come across when available.
3. Fill in name, size, being type, zone, Hit Dice, morale, appearing, speed, senses, armor, portrait, and token image.
4. Review the derived values. Version `1.18.0` does not expose editable Might, Dexterity, Awareness, Reason, Presence, or Luck controls here. New actors receive 8 in all six base stats.
5. Add damage immunities, weaknesses, and status immunities.
6. Build actions from Quick Picks or fill in name, damage, range, status, countdown, drain, and target fields yourself.
7. Add abilities and check their automation badges.
8. Apply any mutations.
9. Click **Create World Actor**.

A name is required. Saving creates a new world actor rather than updating the loaded source.

### Creator notes

- Check the ability badge rather than assuming every Quick Pick is automated.
- Mutations can recalculate HP and DPR and add generated name fragments.
- Senses text from a loaded monster is parsed into supported Foundry sight modes.
- The installed module archive omits `docs/audit`, so an installed release may not show audit-only ability entries and usage counts. The repository's [`abilities.md`](https://github.com/DimitroffVodka/vagabond-crawler/blob/main/docs/audit/abilities.md) has the generated coverage report.

---

## Hit Die Configuration

Vagabond normally calculates NPC HP as `HD × 4.5`. Crawler can replace that rule for individual monsters:

- **Hit Die** chooses `d4` through `d14`, or **From Size**.
- **Roll HP on Spawn** gives each new unlinked token its own HP roll.
- **Hit Die Configuration** maps each NPC size to the die used by **From Size**.
- **Bestiary fallback** applies that size map to compendium NPCs without authored Crawler flags. It is off by default.

Linked tokens are skipped because they share HP with the world actor. Small monsters use `max(1, HD)` instead of the larger-die formula.

Open Hit Die Configuration by right-clicking **Forge & Loot** or from the Vagabond Crawler module settings.

---

## Light Tracker

Light Tracker records carried sources, applies their Foundry token light, and reduces their remaining burn time. Twelve source types ship with their own radii, colors, animations, and fuel rules. With real-time burn off, returning from GM to Heroes adds crawl time and burns active sources. With it on, unpaused world time drives the countdown. Lanterns refuel from supported oil when they run dry; torches and candles go out.

### Use a light source

1. Right-click a supported inventory item and choose **Light**.
2. Open **Lights** on the Crawl Bar to check the active sources and their remaining time.
3. Advance from GM to Heroes, use the time controls inside Light Tracker, or enable **Real-Time Light Burn** while Foundry is unpaused.
4. Right-click the item and choose **Extinguish** to preserve its remaining time.
5. Drag a lit source onto the canvas to leave it behind. Use its Token HUD pickup control to assign it to an eligible actor again.

Lighting one item from a stack splits it into an independent lit item.

### Source types

| Source | Bright | Dim | Built-in duration | Notes |
|---|---:|---:|---:|---|
| Torch | 15 ft | 30 ft | 1 hour | Consumed at burnout |
| Lantern, Hooded | 15 ft | 30 ft | 1 hour | 90-degree cone; uses oil |
| Lantern, Bullseye | 30 ft | 60 ft | 1 hour | Uses oil |
| Candle | 5 ft | 10 ft | 1 hour | Basic candle |
| Candle, Calming | 5 ft | 10 ft | 1 hour | Blue light |
| Candle, Insectbane | 5 ft | 10 ft | 1 hour | Green light |
| Candle, Restful | 5 ft | 10 ft | 1 hour | Warm light |
| Sunrod | 15 ft | 30 ft | 1 hour | Sunburst animation |
| Torch, Tindertwig | 15 ft | 30 ft | 999,999 seconds | Very long, but finite |
| Torch, Sentry | 15 ft | 30 ft | 1 hour | Pale light; no source-backed invisibility rule |
| Torch, Repel Beast | 15 ft | 30 ft | 1 hour | Red light |
| Torch, Frigidflame | 15 ft | 30 ft | 1 hour | Cold blue light |

### Light Sources Configuration

Right-click **Lights** to change a source's radius, color, intensity, angle, animation, or longevity.

> **Version 1.18.0 limitation:** a custom **Longevity (secs)** applies when a source is lit or refuelled, but burn clamping and the tracker's remaining-time percentage still read the built-in value. Setting a longevity above the built-in one therefore gets clamped back down on the first burn tick, and the percentage is measured against the wrong maximum.

**Real-Time Light Burn** is off by default. The Light Tracker also has a time input with plus and minus controls. In version `1.18.0`, the minus path burns light but passes negative minutes into crawl elapsed time. Prefer normal crawl-turn advancement or real-time tracking when elapsed-time accuracy matters.

### Light notes

- Tindertwig has a long finite duration rather than a true infinite value.
- The source defines Sentry's light appearance but does not implement the older guide's invisibility-suppression claim.
- When a lantern runs dry, Crawler looks for supported oil and reports the remaining count in chat.
- A dropped light is represented by a temporary actor and token until someone picks it up.
- Party tokens transfer carried lights between the party token and its members.
