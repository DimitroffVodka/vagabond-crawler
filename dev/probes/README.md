# MCP Probes (vagabond-crawler)

Self-contained JS snippets that verify behaviors via the Foundry MCP
`evaluate` tool. Each probe returns `{ pass: boolean, ... }`.

## Scope

vagabond-crawler is a dungeon crawl management module. Probes should
focus on:

- Crawl state machine transitions
- `game.vagabondCrawler` subsystem singleton registration
- Combat / encounter integration
- v14 hook compatibility

## Status

| Probe | Verifies |
|---|---|
| `magic-ward-surcharge.mjs` | Magic Ward surcharge reaches the vagabond system cast cost authority (`SpellCastDialog.calculateCosts`) and the `vagabond.spellCastMessages` dialog hook. |

## How to run

```
mcp__foundry-vtt__evaluate(expression: <paste file contents here>)
```

## Adding a probe

1. Pick a behavior to falsify.
2. Self-contained snippet returning `{ pass: boolean, ... }`.
3. Clean up created docs/globals at the end.
4. Add a row in a table here.

See `shadowdark-extras/dev/probes/` for reference probes (socket auth,
formula eval, template-region pair, etc.).
