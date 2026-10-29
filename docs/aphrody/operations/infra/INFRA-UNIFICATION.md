# Unification & Centralisation de l'Infrastructure Aphrody

> **Inventaire historique, pas une déclaration d’état courant.** Les chemins
> et unités ci-dessous proviennent de la consolidation des anciens dépôts.
> Depuis, les owners, manifests et catalogues du monorepo ont évolué. Pour les
> workloads et routes déclarés, consulter `tools/config/service-catalog.json`,
> `tools/config/host/nginx/routes.json` et `tools/config/production-topology.json`. Pour
> l’implémentation, consulter les fichiers actuels `crates/infra/infra/`,
> `packages/infra/workspace/` et `scripts/`. L’observation hôte datée est
> séparée dans `VPS-STATUS-2026-10-02.md`.

Ce document établit la source de vérité unifiée et le bilan de consolidation de l'ensemble des scripts, configurations et documentations d'infrastructure pour l'écosystème Aphrody (`aphrody-infra`, `aphrody`, `aphrody-os`, `nie`, `iecode`).

> **Host config home (2026-10-04).** systemd units/drop-ins and nginx sites of
> aphrody and nie live in this repository: `tools/config/host` (checkout
> `~/src/aphrody` on the hosts), indexed by `catalog.json` (service, unit, site, owner repo, target
> host). Shared sandbox/identity directives are drop-ins in `systemd/shared`
> and proxy headers are `nginx/snippets/*.inc`; compose with
> `bun packages/engine/core/src/host/cli.ts compose-unit|compose-nginx|check`.
> `tools/config/service-catalog.json` and `tools/config/host/nginx/routes.json` remain here as
> declared intent (their `vhost` paths are relative to the yolo host config root).

---

## 1. Principe d'Autorité Unique

`aphrody-infra` est l'unique dépositaire et autorité d'exploitation pour :
- **Supervision & Cycle de vie** : Définition des unités systemd, timers et drop-ins.
- **Routage & Passerelle Web** : Vhosts Nginx, certificats Let's Encrypt et table de routes publiques (`tools/config/host/nginx/routes.json`).
- **Catalogue de Services** : Unique registre de tous les workloads applicatifs (`tools/config/service-catalog.json`).
- **Gestion des Réseaux & Proxies** : Mullvad WireGuard (`wg0`), passerelle Privoxy (`127.0.0.1:8119`), tunnels PostgreSQL (`15433`).
- **Pipelines de Déploiement** : Assemblage d'artefacts scellés et bascules atomiques blue/green (`scripts/atomic-deploy*.sh`).
- **Sauvegardes & Rétention** : Backups automatiques journaliers (PostgreSQL logique, SQLite WAL, synchronisation offsite).
- **Gestion Souveraine des Secrets** : Chiffrement AES-256-GCM / PBKDF2 (`ring` et WebCrypto), masquage mémoire (`zeroize`), audits de fuites statiques (`secrets audit`).

---

## 2. Cartographie de Centralisation des Scripts

| Domaine / Projet | Emplacement Centralisé (`aphrody-infra`) | Ancien Emplacement (Dépôt Sœur) | Rôle & Optimisations |
|---|---|---|---|
| **NIE 3D Model Prewarm** | `scripts/nie/model-serve-prewarm.sh` (not in repo) | `nie/scripts/ops/model-serve-prewarm.sh` | Pré-chauffage du cache 3D (`nie-model-serve` :8792) pour les modèles GLB et Keshin critiques. Support `--json` et paramétrage du port. |
| **NIE Sync Main** | `iecode/scripts/tools/sync-main.ts` | `nie/scripts/workspace-transfer.ts` | Synchronisation de checkout entre station de travail et VPS. |
| **Kernel & VPS Tuning** | `tools/config/host/aphrody-os/VPS-TUNING.md` (`90-aphrody-bun.conf`, paquet `aphrody-sysctl`) | `aphrody/docs/aphrody-os/vps_tuning.md`<br>`aphrody-os/docs/vps_tuning.md` | Configuration sysctl unifiée (BBR, FQ, somaxconn, buffers TCP), optimisation VirtIO KVM. |
| **DNS OVH & Domaines** | `crates/infra/ovh` (`aphrody infra ovh dns`) | Scripts shell et Python OVH disparates | Gestion unifiée DNSSEC, records A/AAAA/CNAME/MX, bascules d'apex et audits de zones en Rust natif. |

---

## 3. Structure des Répertoires `aphrody-infra`

```text
aphrody-infra/
├── config/
│   ├── service-catalog.json       # Unique registre des workloads (ports, unités, santé)
│   ├── nginx-routes.json          # Table canonique des routes publiques
│   ├── production-topology.json   # Répartition des hôtes vps (51.77.147.152) et dbfr (51.255.162.6)
│   ├── pipeline.json              # Orchestration unifiée CI/CD (7 projets)
│   └── secrets-contract.json      # Schéma de validation des variables d'environnement
├── host/
│   ├── privoxy/                   # Configuration du pont HTTP Mullvad
│   ├── sysctl/                    # Réglages kernel 99-aphrody-tuning.conf
│   ├── logrotate/                 # Règles de rotation des logs applicatifs
│   └── aphrody-os/                # Documentation de référence du tuning système
├── systemd/                       # Unités systemd (.service, .timer, drop-ins)
├── nginx/                         # Gabarits de serveurs virtuels Nginx et errorpages
├── scripts/
│   ├── ops/                       # Scripts transversaux (watchdog, sync, backups, audit)
│   ├── nie/                       # Automatisation NIE (model pre-warming, sync main)
│   ├── aphrody/                   # Automatisation Aphrody Core & GCP
│   └── aphrody-os/                # Automatisation réseau & namespace WireGuard
└── crates/                        # Binaires et bibliothèques Rust d'infrastructure
    ├── aphrody-infra              # CLI central, contrôle, secrets, pipeline, HTTP daemon
    ├── aphrody-ssh                # SSH/SFTP in-process, rsync pur Rust, métriques système
    ├── aphrody-ovh                # Moteur API OVH in-process
    ├── aphrody-vpn                # Contrôleur Mullvad VPN
    └── aphrody-git                # Primitives Git (gix) et workflows CI
```

---

## 4. Matrice Consolidée des Workloads & Ports de Production

| Service ID | Runtime | Hôte | Port Loopback | Endpoint Santé | Route Publique (Nginx) | Rôle |
|---|---|---|---|---|---|---|
| `aphrody-site` | Rust (Actix/Axum) | `vps` | `8083` | `/healthz` | `aphrody.com/` | Portail Aphrody, interface, documentation, docs RAG |
| `aphrody-web-api` | Bun (Hono/Elysia) | `vps` | `3007` | `/health` | via `aphrody-site` `/api/v1/web/` | API de navigation, extraction et headless browser |
| `aphrody-ai-http` | Rust | `vps` | `8789` | `/healthz` | `/api/v1/models`, `/api/v1/rag/*` | Moteur d'inférence RAG et agents A2A |
| `aphrody-embed`| Rust (`aphrody-embed serve`) | `vps` | `8794` | `/health` | Interne | Service d'embeddings sémantiques E5 compatible OpenAI |
| `aphrody-a2a` | Rust | `vps` | `8788` | `/ping` | `/.well-known/agent-card.json` | Routage d'enveloppes inter-agents A2A 1.0 |
| `nie-site` | Rust | retiré 2026-09-25 | `8085` | `/healthz` | `nie.aphrody.com/` | Catalogue et recherche VFS Inazuma (pas de release VPS) |
| `nie-model-serve` | Rust | retiré 2026-09-25 | `8792` | `/health` | via Nginx `/cdn/` | Serveur de géométrie 3D GLB, animations et textures (pas de release VPS) |

---

## 5. Automatisation & Commandes Disponibles

### Inspection & Observabilité
```bash
# Rapport complet des unités, sondes HTTP/TCP, disque et ressources hôtes
bun scripts/tools/infra/infra-status.ts status

# Vérification stricte sans mutation
aphrody-infra validate

# Audit de sécurité statique des fuites de secrets dans le code
aphrody-infra secrets audit

# Validation des contrats de configuration pour un service
aphrody-infra secrets check --service aphrody-web-api
```

### Déploiement & Pré-chauffage
```bash
# Pré-chauffage du cache de modèles 3D NIE
./scripts/nie/model-serve-prewarm.sh --json
```
