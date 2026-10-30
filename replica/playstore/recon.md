# Google Play recon (user-level observation, clean room)

Observed 2026-10-30 on the public pages `store/games?device=windows`, a game detail page and a search page, signed out. Nothing was copied (no markup, styles, scripts, images or text); everything below is a paraphrase of what a visitor sees and does.

## Screen inventory

| id | screen | what a visitor sees |
|----|--------|---------------------|
| P01 | Home (Games tab) | Top bar: logo, four top-level tabs (Games, Apps, Books, Kids), search, help, account. Under it a row of device chips (PC, phone, tablet, TV, desktop, watch, XR) that re-filters the page. A hero carousel of large "moment" cards: backdrop, one-line pitch, second line, app icon, name, developer, age rating and an install button, plus small tags (in-app purchases, pre-register, available now). Then horizontal shelves of compact tiles (icon, name, category or developer, star rating, price when paid): a curated selection, new releases, big-screen favourites. |
| P02 | Apps tab | Same frame, shelves of non-game apps, top charts entry. |
| P03 | Search results | Query box with suggestions while typing; results as a grid of tiles with rating, category, price; a type filter (apps, games, books). |
| P04 | App detail | Dark header with a large title, developer link, badges (in-app purchases, editor pick), stat strip (rating with review count, age rating, download bucket), primary install button, secondary "install on more devices", share and wishlist. Then a screenshots/trailer carousel, "About" with a short text and an arrow to the full text, a data-safety summary, ratings and reviews (histogram plus review cards), "What is new", developer support block, "More by this developer" and "Similar" shelves. |
| P05 | Category/collection page | Title plus a grid of tiles, reached from shelf headings (an arrow after the title). |
| P06 | Library / installed | In the account menu; not visible signed out. |
| P07 | Updates | Account area; not visible signed out. |

## Flows

1. Home, hero card, detail, install (target chosen with the device chip).
2. Home, shelf heading arrow, collection page, detail.
3. Search box, suggestions, results, detail.
4. Detail, similar shelf, another detail.

## Components

Top app bar with tabs; device chip row; hero carousel with dots and arrows; app tile (icon, text, rating); shelf with heading and scroll arrows; detail header; stat strip (rating, age, downloads); install button group; screenshots carousel with lightbox; expandable description; ratings histogram; review card; data-safety card; footer with locale.

## Install button states seen or implied

Install, Install on platform, Install on more devices, Pre-register, a price button for paid apps; Open, Update and Uninstall once signed in (not observed).

## States

- Loading: grey skeleton blocks in tiles and the hero while shelves load.
- Empty: a search with no match shows a short message and suggestions.
- Error: a "something went wrong, try again" panel with a retry control.

## Takeaways for Bun OS

The pull of Play is a hero card with an immediate install button, dense shelves with stars, and a long detail page whose top strip answers "is it good, is it safe, how big". Bun OS fills each slot only from real data: the ratings slot says no ratings yet, the download bucket becomes a real size and version.
