<!-- SPDX-License-Identifier: Apache-2.0 -->
# SVG — référence pour le propriétaire identity

Ce document garde les mesures de l'`icon.svg` du logo ; il ne maintient pas de liste de versions,
générateurs ou commandes de déploiement.

Le propriétaire identity produit ses assets natifs dans
[src/assets.rs](../src/assets.rs). Distinguer atlas/pet natif, dessin SVG
applicatif et rasterisation ; une méthode applicative ne remplace pas implicitement
le pipeline identity.

Les anciens nombres de glyphes, dépendances et scripts de cette copie étaient
un relevé daté. Pour une modification : vérifier le source owner, préserver
provenance/licences et valider le consommateur sélectionné.
Les références de reverse engineering IECODE appartiennent à leur domaine,
pas au contrat d'assets identity.

## `icon.svg` du logo (2026-10-09)

`logo::svg_vectoriel` décalque le cadre large de `assets/logo/source/byron_r0.png` avec
`pixel::vectoriser`, puis mesure le SSIM entre le SVG rastérisé (resvg) et l'icône PNG de même
taille, posés sur la surface claire du thème. Un seul `icon.svg` suffit : il tient sous le plafond
de 150 Ko avec une fidélité élevée, sans second `logo.svg` détaillé.

Réglages retenus (`logo::SVG`) : 256 px, 24 couches, tolérance Douglas-Peucker 0,5 px, sans trait,
silhouette sombre sous les couches, chemins en coordonnées relatives compactées. Résultat :
93 766 o, SSIM 0,926, 92,8 % des pixels à ±16 niveaux. Le test `le_svg_se_rasterise_fidelement`
refuse un SSIM sous 0,90 ou plus de 150 Ko.

| Résolution | Couches | Tolérance | Trait | Octets | SSIM |
| --- | --- | --- | --- | --- | --- |
| 256 | 24 | 0,5 | 0 | 93 766 | 0,926 |
| 256 | 16 | 0,5 | 0 | 86 795 | 0,925 |
| 256 | 32 | 0,5 | 0 | 111 283 | 0,929 |
| 192 | 16 | 0,5 | 0 | 55 258 | 0,910 |
| 256 | 16 | 0,75 | 0 | 29 204 | 0,828 |
| 256 | 16 | 0,75 | 0,4 | 29 519 | 0,873 |
| 320 | 32 | 0,5 | 0 | 165 259 | 0,906 |
| 256 | 12 | 0,75 | 0, sans silhouette ni compaction | 58 375 | 0,779 |

Écartés : la tolérance de 0,75 px et plus (les mèches fines disparaissent, SSIM < 0,85), le trait
par couche (il épaissit les contours, SSIM en baisse à tolérance égale), 320 px (plus lourd, moins
fidèle à 256 px de mesure) et le décalque sans silhouette, qui laisse voir le fond entre deux
couches voisines.
