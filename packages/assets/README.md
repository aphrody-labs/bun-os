# @aphrody/assets

File-kind icons, extension badges, brand logos, images, sounds, videos and Lottie animations for the
M3 explorer surfaces, with icon resolution helpers. The icon set is derived from Spacedrive `@sd/assets` (Apache-2.0 upstream since 2026-03-24; see `ATTRIBUTION.md` and `docs/spacedrive/PROVENANCE.md`) merged with SpaceUI `@spacedrive/icons` (MIT, `LICENSE.spaceui`, `UPSTREAM-CHANGELOG.spaceui.md`).

| Import                                           | Contents                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `@aphrody/assets/icons`                          | raster file-kind icons (`*.png`, `*-20.png`, `*_Light.png`) as URLs                       |
| `@aphrody/assets/images`                         | product images                                                                            |
| `@aphrody/assets/svgs/*`                         | SVG sources; `svgs/ext/` holds the extension badges (`ext/icons.json`, `ext/Extras/urls`) |
| `@aphrody/assets/sounds`, `videos/*`, `lottie/*` | media                                                                                     |
| `@aphrody/assets/util`                           | `getIcon`, `getLayeredIcon`, `getBeardedIcon`, `getIcon20`                                |
| `@aphrody/assets/util/mobile`                    | the same without `beardedIconUrls` (React Native)                                         |

`bun run gen` regenerates the per-folder `index.ts` barrels (`scripts/generate.ts`, formatted with `bun fmt`).
`bun run test` checks the generated barrels against the folders; `bun run typecheck` runs `tsc`.
