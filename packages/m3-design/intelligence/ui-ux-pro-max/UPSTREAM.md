# Upstream: UI/UX Pro Max

- Project: UI/UX Pro Max skill by Next Level Builder
- Repository: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- License: MIT, Copyright (c) 2024 Next Level Builder (see `LICENSE` in this directory)
- Compared against: upstream `skill.json` version 2.15.0, commit
  `04cfb449bd8494811ad63e94172a308fa25a551a` (2026-10-23), path `src/ui-ux-pro-max/`

## What Bun OS changed

- `scripts/*.ts` is a Bun-native port of the upstream Python scripts (`core.py`,
  `design_system.py`, `reasoning_contract.py`, `search.py`, `validate_data.py`). It uses
  only Bun built-ins and reads the same `data/*.csv` catalogs. The upstream Python files are
  not vendored; use the upstream repository at the commit above as the reference.
- `SKILL.md` gained the Bun OS and Aphrody Labs Material 3 contract, and its commands call
  the Bun scripts (also shipped as `m3-design search` / `m3-design system`).
- Data additions: `data/brands.csv` (Aphrody brand themes), `data/stacks/m3.csv`, plus Bun OS edits in `ux-guidelines.csv`, `catalog-summary.json`
  and the `astro`, `html-tailwind`, `nextjs`, `nuxt-ui`, `shadcn`, `threejs` and `vue` stacks.
  `references/bun-os.md` is first-party.
- The design-system checklist adds Bun OS accessibility and performance items (Material
  Symbols, forced-colors focus, `color-scheme`, LCP image priority).

## Parity

On the upstream commit above, with this directory's data, the upstream `search.py` and the
Bun `search.ts` print byte-identical output for domain, stack, auto-detected and `--json`
searches. `--design-system` output differs only by the Bun OS checklist items listed above.
