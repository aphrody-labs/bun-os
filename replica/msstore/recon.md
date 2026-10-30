# Microsoft Store (web) recon (user-level observation, clean room)

Observed 2026-10-30 on the public home page (French locale), a product detail page (English) and a not-found page, signed out. Optional cookies declined, locale prompt dismissed with "stay". Nothing was copied.

## Screen inventory

| id | screen | what a visitor sees |
|----|--------|---------------------|
| M01 | Home | Slim top bar: logo, tabs (Home, Apps, Games, Themes, About), search, sign-in. Full-width hero carousel with a brand backdrop, a headline, a short sentence and a get button, dots below and a peek of the next slide at the right. Below, two side-by-side lists ("trending games", "trending apps") with a few rows each: icon, name, category, rating with a star, price or Free, with arrow controls for more. More shelves further down. |
| M02 | Apps / Games / Themes tabs | Same frame with category chips and top-chart lists. |
| M03 | Search | Wide search field in the bar with live suggestions (icons and names). Results page with product tiles. |
| M04 | Product detail | Large icon, title, publisher link, rating value with rating count and category, a description clipped with "read more", a primary Download button plus "View in Store", age and content info, then a media carousel. Scrolling pins a compact sticky bar with icon, name and Download. Sections: description, ratings and reviews (big average, histogram, review cards with stars, text, date, helpful counts), system requirements (OS, memory, architecture), publisher info, related products. |
| M05 | Not found | Illustration, a message that the product could not be found or is unavailable in the market, a search field and a Refresh button. |
| M06 | Library / updates | Part of the desktop client, not the website. |

## Flows

Hero, product, download; trending row, product; search suggestion, product; sticky bar download after scrolling.

## Components

Top bar; carousel with dots; ranked list card with header arrows; product row; product header; badge row (age, in-app purchases); media carousel; expandable text; rating summary; review card; requirements table; sticky install bar; locale dialog; cookie banner; empty/error panel.

## States

- Loading: dark placeholder panels where the hero and media will appear.
- Empty and error: the M05 pattern, a message, a search field and a retry.
- Install: get/download, view in store, then open in the client.

## Takeaways for Bun OS

Two-column trending lists are compact and scannable, the sticky install bar keeps the action reachable on long pages, and the error panel offers search instead of a dead end. Review cards and ratings stay empty in Bun OS (no data); requirements map to real package facts (architecture, dependencies, size, license).
