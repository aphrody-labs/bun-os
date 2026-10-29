# @aphrody/inagle-cross

API de données pour **Inazuma Eleven Cross** (`jp.co.level5.inazumacross`) — jeu mobile
Unity IL2CPP, **distinct** d'Inazuma Eleven: Victory Road (`@aphrody/inagle`, moteur
Level-5 / CPK). Sortie le 9/6/2026, APK récupéré et rétro-conçu statiquement.

## Contenu (Phase 0 — figé)

- `src/data/masterdata-schema.generated.ts` — **153 tables** masterdata, **1215 colonnes typées**
  (références FK + héritage résolus), extraites du dump IL2CPP (Unity 6000.0.62f1).
- `data/enums.json` — **214 énumérations** du jeu avec leurs valeurs
  (`CharacterElement` = Wind/Forest/Fire/Mountain, `CharacterPosition` = FW/MF/DF/GK, …).
- `supabase/migrations/20260610_create_inagle_cross_core.sql` — DDL des 153 tables
  `public.inagle_cross_*` (id + colonnes promues + `data jsonb` + RLS « Public Read »),
  généré depuis le schéma.
- `src/` — types (`CrossSchema`, `CrossTable`, …) + `crossTableName()`.

Le préfixe `inagle_cross_` est routé gratuitement vers le miroir SQLite d'azalée
(`server.ts` `startsWith("inagle_")`) et capté par `mirror-sync.sh` (`--prefix=inagle_`).

> **Note Phase 0** : ce dossier est de la **préparation** (schéma/DDL/types figés), pas
> encore un workspace member — le `package.json` est volontairement différé en Phase 1 pour
> ne pas régénérer `bun.lock` (v1, CI Bun 1.3.14) avec le Bun 1.4 local (écrit v2, illisible
> par la CI). À l'activation : ajouter `package.json` (`@aphrody/inagle-cross`, dep
> `workspace:*` `@aphrody/inagle`) et régénérer le lock avec Bun 1.3.x.

## Statut

|                        |                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Schéma masterdata      | ✅ 153 tables / 1215 colonnes typées                                                                                       |
| Énumérations           | ✅ 214                                                                                                                     |
| Catalogue Addressables | ✅ 25 328 objets (cf. `apps/azalee/data/cross/`)                                                                           |
| Audio (voix)           | ✅ 305 WAV décodés (CRI HCA)                                                                                               |
| **Valeurs masterdata** | ⛔ **Phase 1** — servies par le serveur du jeu derrière anti-triche (HTTP 426). Déblocage = capture runtime Android arm64. |

## Phase 1 (à venir)

Une fois `{AssetBaseUri}` / `masterDataHost` résolus (capture runtime) :
`parsers/` (bundles Unity / TSV masterdata) → `entries-cross/*.json` (JSON normalisé)
→ `push/` via `@aphrody/inagle/push-adapter` (upsert idempotent) →
`public.inagle_cross_*` → miroir azalée → pages `/cross/*`.

## Localisation

Le jeu n'expose que **en / ja / zh-Hant** (pas de français) : l'UI FR d'azalée est traduite,
non extraite.
