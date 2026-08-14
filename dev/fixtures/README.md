# Test Fixtures (vagabond-crawler)

Reproducible Foundry-side test data for probes. None yet.

## When to add

When a probe needs known-shape data (e.g., a Vagabond actor with
specific abilities/powers, a combat with specific tokens), create:

- `setup.mjs` — idempotently creates fixtures inside a
  `_VC Test Fixtures` folder.
- `teardown.mjs` — removes the folder + contents.

See `shadowdark-extras/dev/fixtures/setup.mjs` for the reference pattern
(spellcaster TestPC recipe — Vagabond's equivalent would differ in
data model).
