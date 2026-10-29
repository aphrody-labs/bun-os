<!-- SPDX-License-Identifier: Apache-2.0 -->
# Hébergement Aphrody : besoins réels et offres du marché (2026-10-05)

Étude en lecture seule. Aucun build, aucun Cargo, aucune commande ni modification d'hôte. Seules deux lectures
ont été faites sur les hôtes : `lscpu`, `free`, `df` et `du` bornés via `aphrody-infra ssh exec`, puis
`aphrody-infra ovh vps list|info`.

Légende : **[V]** fait vérifié sur une source officielle (URL et date en fin de document) · **[D]** relevé dans le
dépôt · **[H]** relevé sur l'hôte le 2026-10-05 · **[E]** estimation raisonnée, non mesurée. Tous les prix sont
**HT par mois**, sauf mention contraire.

## Recommandation

**Scénario principal B : compléter.** Ajouter un dédié **OVHcloud RISE-M** (Ryzen 9 9900X, 12 c / 24 t,
4,4 / 5,6 GHz, 64 Go DDR5, 2 × 512 Go NVMe, 1 Gbit/s illimité) qui sert **uniquement de fabrique**. Le VPS-4 actuel
garde la production et dbfr reste l'hôte secondaire.

- **Coût** :
  - avec 12 mois payés d'avance : 94,99 € + VPS-4 31,44 € + sauvegarde 1,30 € + dbfr 10,40 € = **138,13 €/mois**
    (165,76 € TTC) ;
  - sans engagement : 150,52 €/mois, plus 99,99 € d'installation.
- **Pourquoi** :
  - la fabrique est le goulot (WSL ne peut pas compiler) ;
  - le travail reproductible part sur du métal dédié, tandis que la production reste sur un VPS qui garde snapshots
    et adresse IP ;
  - le dépôt pilote déjà l'API OVH (`crates/infra/ovh`) ;
  - la machine est livrable en 1 h à Roubaix et Gravelines.
- **Alternative A, tout-en-un** : un RISE-L (16 c / 32 t, 128 Go, 2 × 960 Go) à 142,49 €/mois sur 12 mois porte la
  fabrique et toute la production, puis le VPS-4 est résilié.

## Étape 1 : besoins réels

### Situation actuelle

| Hôte | Offre (API OVH) | Ressources | Prix catalogue | Relevé |
| --- | --- | --- | --- | --- |
| `vps` (`vps-203bea89`, os-sbg6) | `vps-2025-model4` « VPS-4 2026 » | 12 vCores, 48 Go, 300 Go NVMe, 2 Gbit/s | 36,99 € sans engagement, 31,44 € sur 12 mois ; sauvegarde 1 jour 1,30 € ou 7 jours 7,35 € ; snapshot 2,10 € [V] | **[H]** modèle de CPU masqué (« Intel Core Processor (Haswell, no TSX) »), 1 thread par cœur, AVX2 sans AVX-512 ; RAM 45 Gio dont 35 libres ; `/` 125 Go utilisés sur 290 (44 %) ; **charge 29,75 / 18,57 / 8,87 sur 12 vCPU** |
| `dbfr` (`vps-6732365f`, os-gra6) | `vps-2027-model3` « VPS-3 2027 » | 6 vCores, 12 Go, 100 Go | 12,24 € sans engagement, 10,40 € sur 12 mois [V] | **[H]** RAM 11 Gio dont 6 libres ; **disque à 93 % (89 Go sur 96)** |

Coût actuel : **50,53 à 56,58 €/mois** selon l'option de sauvegarde du VPS-4. L'échéance manquée du 2026-10-01
vient de `automatic_renew = false` [D : `crates/infra/ovh/src/vps.rs`].

### Besoins chiffrés

| Besoin | Constat chiffré | Source | Cible |
| --- | --- | --- | --- |
| CPU de la fabrique Rust | 233 membres de workspace (16 globs), 2 766 paquets dans `Cargo.lock` (dont 2 532 externes) ; dépendances lourdes : `v8` 150.4.0 (bibliothèque précompilée, `V8_FROM_SOURCE` absent), `deno_core` 0.412, `wgpu` 23 et 30, `candle` 0.11, `mistralrs` 0.9.4, `ort` rc.12, 54 crates de fork Tauri | [D] `Cargo.toml`, `Cargo.lock` | ≥ 12 cœurs **physiques** à haute fréquence (Zen 4/5) |
| Parallélisme imposé | `rust.maxJobs = 6`, sérialisé, `incremental = false`, sccache, verrou `heavy.lock` ; `cargo-serial.sh` refuse `APHRODY_CARGO_JOBS` > 6 | [D] `tools/config/build-factory.json`, `scripts/build/rust/cargo-serial.sh:32-41` | relever le plafond pour exploiter plus de 6 cœurs |
| Fork Bun (LLVM) | `bun-forge` : LLVM 23.1.1, cmake 3.30.5, release avec LTO, un build par commit de `yolo` (sondage toutes les 120 s), zone temporaire de **96 Go** par commit ; premier build complet sur la fabrique en **7 min 10 s** | [D] `tools/config/bun-forge.json`, PLAN §6 | RAM et NVMe locaux |
| GPU | Aucun besoin au build : `aphrody-llama-sys` et `torch-sys` chargent llama.cpp et libtorch par `libloading`, et `ml-runtime` télécharge les bibliothèques CUDA 13 et cuDNN 9.25 à l'exécution (détection HIP et Vulkan présente). En production, aucun LLM local : la génération passe par Gemini (service distant). L'inférence locale tourne sur le poste Windows (GPU de 12 Go). Le modèle principal (30B MoE Q4_K_M) pèse 17,28 Gio, donc 24 Go de VRAM sont nécessaires pour le loger entièrement | [D] `crates/ml/*`, `tools/config/local-ai.json`, `docs/reference/ai/LOCAL-AI-MODELS.md` | **GPU facultatif**, à la demande |
| Automatisation | `crates/infra/ovh` : `/vps`, `/service/{id}/renew` (devis, commande, paiement), `/me/order` ; `aphrody-infra ovh dns\|vps\|email`. **Les serveurs dédiés (`/dedicated/server`) ne sont pas encore couverts**, mais le client signé est réutilisable | [D] | OVH : extension d'un client existant ; autre fournisseur : nouveau client |
| Renouvellement | Expiration du 2026-10-01 | énoncé et [D] | renouvellement automatique, ou 12 mois payés d'avance |
| Compatibilité glibc | La fabrique (Ubuntu 26.04, glibc 2.43) produit des binaires refusés par WSL (glibc 2.39) | MEMORY « Fabrique 2026-10-05 » | sur un nouvel hôte, Ubuntu 24.04 (2.39) produit des binaires exécutables sur les deux [E] |

## Étape 2 : marché au 2026-10-05

Méthode :

- les pages officielles ont été lues par `aphrody web fetch` (HTML statique) ;
- OVH a été interrogé par son **API publique de catalogue** et ses disponibilités ;
- les prix Hetzner viennent du **JSON officiel que charge le site** (`live_data_prices.json` et
  `website-price-api.hetzner.com`). Ce sont des prix nets : la TVA est ajoutée côté client, et l'IPv4 à 1,70 € est
  bien le tarif net. Chaque produit est associé à son prix par le `product-key` de son configurateur ;
- les prix Contabo sont des promotions des 12 ou 24 premiers mois, avec affichage TTC ou HT selon un sélecteur non
  résolu dans le HTML statique.

### Machines de classe « fabrique » (≥ 8 cœurs, ≥ 64 Go)

| Offre | Type | CPU | RAM | NVMe | Réseau | Prix HT/mois | Installation | Engagement |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| OVH VPS-4 2026 (**actuel**) | VPS KVM, vCores | 12 vCPU (modèle masqué) | 48 Go | 300 Go | 2 Gbit/s illimité | 36,99 (31,44 sur 12 m) | 0 | aucun |
| OVH VPS-5 2026 | VPS | 16 vCPU | 64 Go | 350 Go | 2,5 Gbit/s | 54,99 (46,74) | 0 | aucun |
| OVH VPS-6 2026 | VPS | 24 vCPU | 96 Go | 400 Go | 3 Gbit/s | 72,99 (62,04) | 0 | aucun |
| **OVH RISE-M** | dédié | Ryzen 9 9900X 12 c / 24 t, 4,4 / 5,6 GHz, score OVH 54 712 | 64 Go DDR5 ECC on-die | 2 × 512 Go | 1 Gbit/s illimité, vRack | **99,99** (94,99 sur 12 m) | 99,99 (0 si engagement ≥ 12 m) | aucun, ou 12 / 24 m |
| **OVH RISE-L** | dédié | Ryzen 9 9950X 16 c / 32 t, 4,3 / 5,7 GHz, score 66 089 | 128 Go | 2 × 960 Go | 1 Gbit/s illimité | **149,99** (142,49 sur 12 m) | 149,99 (0 si ≥ 12 m) | idem |
| OVH RISE-XL | dédié | EPYC 9455 48 c / 96 t, 3,15 / 4,4 GHz | 128 Go | 2 × 1,92 To | 1–3 Gbit/s | 299,99 | 299,99 | idem |
| OVH Advance-4 (2026) | dédié | EPYC 4585PX 16 c / 32 t, 4,3 / 5,7 GHz, score 68 862 | 64–256 Go | NVMe | 1–5 Gbit/s | 299,99 | 299,99 | idem |
| OVH Game-2 (2026) | dédié | Ryzen 9 9950X3D 16 c / 32 t | 64–256 Go | NVMe | 1 Gbit/s | 313,99 | 313,99 | idem |
| OVH KS-6 (Kimsufi) | dédié, ancien | EPYC 7351P 16 c / 32 t, 2,4 / 2,9 GHz, score 19 589 | 128 Go | 2 × 500 Go – 2 × 8 To | 500 Mbit/s | 38,99 | 38,99 | aucun |
| OVH c3-64 (Public Cloud) | instance | 32 vCore | 64 Go | local | 4 Gbit/s | 0,7301 €/h (453,03 sur 12 m) | 0 | à l'heure |
| Hetzner AX42 | dédié | Ryzen 7 PRO 8700GE 8 c / 16 t | 64 Go DDR5 ECC | 2 × 512 Go | 1 Gbit/s illimité | 99,00 (97,30 + IPv4 1,70) | 49 | aucun |
| Hetzner EX63 | dédié | Core Ultra 7 265 (8 P + 12 E) | 64 Go DDR5 ECC | 2 × 1 To | 1 Gbit/s | 149,00 | 74 | aucun |
| Hetzner AX102 | dédié | Ryzen 9 7950X3D 16 c / 32 t | 128 Go DDR5 ECC | 2 × 1,92 To DC | 1 Gbit/s | 259,00 | 129 | aucun |
| Hetzner, enchère | dédié d'occasion | Ryzen 9 5950X 16 c / 32 t | 128 Go ECC | 2 × 3,84 To | 1 Gbit/s | 290 (HEL1, prix le plus bas relevé) | 0 | aucun |
| Hetzner CCX43 | cloud, vCPU dédiés | 16 vCPU | 64 Go | — | — | 276,49 (275,99 + IPv4 0,50) ¹ | 0 | aucun |
| Scaleway EM-B330E-NVMe-128G | dédié | EPYC 4465P 12 C / 24 T, 3,4 GHz | 128 Go DDR5 | 2 × 2,05 To | 3 Gbit/s | 189,99 (0,521 €/h) | 0, mais frais d'engagement = 1 mois en mensuel | — |
| Scaleway EM-B430E-NVMe-128G | dédié | EPYC 4545P 16 C / 32 T, 3,0 GHz | 128 Go | 2 × 3,84 To | 3 Gbit/s | 229,99 | idem | — |
| Netcup RS 8000 G12.5 | VM KVM, cœurs dédiés | 16 cœurs EPYC 9645 | 64 Go | 1 To | — | 148,42 (tarif 12 m) | — | 12 m (1 et 24 m aussi proposés) |
| Netcup RS 16000 G12.5 | VM KVM, cœurs dédiés | 24 cœurs EPYC 9645 | 128 Go | 2 To | — | 289,46 (12 m) | — | 12 m |
| Contabo « AMD Ryzen 12 Cores » | dédié | Ryzen 9 7900, 12 c | 64 Go | 1 To | 1 Gbit/s illimité | 109,65 la 1re année (149,00 ensuite) ² | 0 | 12 m |
| Contabo « AMD Genoa 24 Cores » | dédié | EPYC 9224, 24 c, 2,5 / 3,7 GHz | 128 Go ECC | 2 × 1 To SSD | 1 Gbit/s | 179,10 la 1re année (199,00) ² | 0 | 12 m |

¹ Prix tiré du JSON officiel. L'association `CLOUD_115`–`CLOUD_120` = CCX13–CCX63 est déduite par égalité avec les
prix rapportés par des sources secondaires (hausses Hetzner du 2026-04-01 et du 2026-06-15).
² Promotion. L'inclusion de la TVA n'a pas pu être déterminée sans exécuter le JavaScript de la page.

Disponibilité OVH (API `/dedicated/server/datacenter/availabilities`, 2026-10-05) [V] :

- **RISE-L** : seulement `rbx` (livraison en 1 h) ;
- **RISE-M** : `rbx`, `gra` et `bhs` (1 h) ;
- RISE-S : `sbg`, stock faible.

Le catalogue autorise `sbg`, mais le stock n'y était pas confirmé pour M et L. RISE-M et RISE-L n'ont **aucune
option** de mémoire ni de disque : leur configuration est fixe.

### GPU

| Offre | GPU | VRAM | CUDA | Prix HT | Facturation |
| --- | --- | --- | --- | --- | --- |
| OVH RISE-GPU-1 | AMD Radeon RX 6700 XT | 12 Go | non (ROCm / Vulkan) | 129,99 €/mois + 129,99 € d'installation | mensuelle, `gra` et `rbx` |
| OVH Public Cloud `l4-90` | NVIDIA L4 | 24 Go | oui | **0,75 €/h** (540 €/mois) | à l'heure |
| OVH Public Cloud `l40s-90` | NVIDIA L40S | 48 Go | oui | 1,40 €/h (1 008 €/mois) | à l'heure |
| Scaleway `L4-1-24G` | NVIDIA L4 | 24 Go | oui | 0,79 €/h (≈ 574,87 €/mois) | à l'heure |
| Hetzner GEX45 | RTX PRO 4000 Blackwell SFF | 24 Go GDDR7 ECC | oui | **214,00 €/mois** + 209 € d'installation (0,3402 €/h) | mensuelle ou horaire |
| Hetzner GEX131 | RTX PRO 6000 Blackwell Max-Q | 96 Go | oui | 1 199,00 €/mois + 599 € | idem |

### Services communs

| Fournisseur | API | Renouvellement | Sauvegarde et snapshot | UE |
| --- | --- | --- | --- | --- |
| OVHcloud | REST, **déjà intégrée** (VPS, renouvellement, commande) ; `/dedicated/server` à ajouter | manuel ou automatique (page Rise) ; 6, 12 ou 24 mois payés d'avance | VPS 2027 : sauvegarde quotidienne incluse, snapshot dès 0,30 € ; **dédiés : 500 Go de Backup Storage inclus** (FTP, FTPS, NFS, CIFS, jusqu'à 10 To) | FR (RBX, GRA, SBG), DE (FRA), PL (WAW) |
| Hetzner | Robot webservice (reset, rescue, IP), API Cloud | aucune durée minimale, résiliation immédiate | Storage Box en option ; snapshots sur le Cloud seulement | DE, FI ; centres ISO 27001 ; DPA optionnel |
| Scaleway | API Elastic Metal | facturation horaire ou mensuelle | — | FR (PAR), autres zones UE |
| Netcup | non vérifiée | contrats de 1, 12 ou 24 mois (−13 % ou −26 %) | snapshots inclus (VM) | DE (Nuremberg) |
| Contabo | REST (`api.contabo.com`) | contrat de 12 mois sur les dédiés | — | DE et autres régions |

Non retenus faute de prix lisibles dans le HTML statique : IONOS (serveurs dédiés) et Leaseweb.

**Lecture du marché [V et E]** : après les deux hausses Hetzner de 2026 (sources secondaires), **OVH Rise est le
moins cher** des serveurs 12–16 cœurs Zen 5. RISE-L coûte 149,99 € contre 259 € pour l'AX102 Hetzner, CPU équivalent.
Netcup et les VPS restent virtualisés, et l'offre Contabo est une promotion temporaire. Hors GPU, aucune offre n'est
plus avantageuse au cœur physique et au GHz que RISE-M ou RISE-L.

## Étape 3 : scénarios

| Scénario | Composition | HT/mois, 12 m d'avance | HT/mois, sans engagement | Écart avec l'actuel (≈ 50,5 €) |
| --- | --- | ---: | ---: | ---: |
| **B, compléter (principal)** | RISE-M (fabrique) + VPS-4 2026 (production) + sauvegarde 1 jour + dbfr | **138,13** | 150,52, plus 99,99 € une fois | +87,6 €/mois |
| A, tout-en-un | RISE-L (fabrique et production) + dbfr (secondaire et sauvegardes) ; VPS-4 résilié | 152,89 | 162,23, plus 149,99 € une fois | +102,4 €/mois |
| C, changement minimal | VPS-4 2026 passé en VPS-6 2026 (24 vCPU, 96 Go, 400 Go) + sauvegarde + dbfr | 74,14 | 86,93 | +23,6 €/mois |
| Option GPU, à ajouter | OVH `l4-90` à la demande (même compte et même API) | 0,75 €/h, soit 30 € pour 40 h [E] | idem | selon l'usage |
| Option GPU permanente | Hetzner GEX45 (CUDA, 24 Go) | — | 214,00, plus 209 € une fois | +214 €/mois |
| Option disque dbfr | VPS-3 2027 passé en VPS-4 2027 (200 Go) | +9,56 | +11,25 | — |

### Gain estimé sur la fabrique [E]

Aucune mesure n'a été faite sur le matériel cible. Le raisonnement :

- **Le VPS actuel ne publie ni son CPU ni sa fréquence** : 12 vCPU KVM présentés comme un modèle générique « Haswell »,
  sans AVX-512. Il est partagé avec la production, et sa charge observée atteint 2,5 fois le nombre de vCPU.
- **RISE-M** apporte 12 cœurs physiques Zen 5 à 5,6 GHz en pointe, sans voisins.
  - Avec le plafond actuel de 6 jobs, le gain vient du débit par cœur et de l'absence de contention : **≈ 1,5 à 2
    fois** sur un build à froid.
  - En relevant `cargo-serial.sh` et `rust.maxJobs` à 12 : **≈ 2 à 3 fois** sur les phases parallèles. La chaîne
    critique (gros crates, édition de liens avec V8, LTO de Bun) gagne ≈ 1,5 à 2 fois grâce à la fréquence.
- **RISE-L** ajoute ≈ 21 % de débit selon le score CPU OVH (66 089 contre 54 712), double la RAM et le disque, et
  justifie un plafond de 16 à 24 jobs.
- **VPS-6 (scénario C)** double les vCPU de même classe : les phases parallèles gagnent peut-être 1,5 fois, la chaîne
  critique presque rien.
- **À qualifier** en rejouant sur la même révision : `check` à froid de l'Infra (référence 101,65 s), `bun-forge`

### Risques

- **B** :
  - trois hôtes à maintenir ;
  - RISE-M a une configuration fixe : 64 Go, et 512 Go en RAID1 ou ≈ 1 To en RAID0 (acceptable pour un cache
    reproductible) ;
  - plateforme grand public (ECC on-die seulement, une seule alimentation), SLA de 99,90 % sur la page Rise ;
  - fabrique à Roubaix ou Gravelines, production à Strasbourg : liaison par WireGuard ou SSH, le vRack ne reliant pas
    le VPS.
- **A** :
  - production et builds sur le même hôte, contention à contenir par des slices systemd (les unités portent déjà
    `CPUWeight` et `MemoryHigh`) ;
  - pas de snapshot d'hyperviseur, point de défaillance unique ;
- **C** :
  - vCPU partagés, aucun gain par cœur, 400 Go de disque déjà proche de l'incident du 2026-09-25 ;
  - la possibilité de passer en place à `vps-2025-model6` **n'est pas vérifiée** : la page publique n'affiche plus que
    la gamme 2027.
- **Tous scénarios** :
  - prix volatils en 2026 (pénurie de DRAM, deux hausses Hetzner) : revérifier à la commande ;
  - le disque de dbfr à 93 % est un risque immédiat, indépendant du choix.

## Plan de migration (scénario B)

1. **Renouvellement** : passer le VPS-4 et dbfr en renouvellement automatique (Manager ou API OVH `/service`), ou
   payer 12 mois d'avance (VPS-4 : 31,44 €/mois, dbfr : 10,40 €/mois). Le code de devis et de commande existe déjà
   dans `crates/infra/ovh/src/vps.rs`.
2. **Commande** : RISE-M à `rbx` ou `gra`. Prendre le premier mois sans engagement (99,99 € + 99,99 €) pour
   qualifier, puis passer à 12 mois d'avance (1 139,89 € HT, installation offerte), ou payer d'avance tout de suite.
3. **Système** : Ubuntu 24.04 LTS (glibc 2.39), pour que les artefacts s'exécutent sous WSL 24.04 comme sur le VPS
   26.04. Ce choix est à trancher. Le fork Bun, actuellement lié à glibc 2.43, doit lui aussi être produit dans cette
   base. Prévoir RAID1 pour le système et RAID0 ou RAID1 pour `/srv/aphrody-build`.
4. **Inventaire, avec changement de code** :
   - ajouter un alias d'hôte, par exemple `factory`, dans `crates/infra/ssh/src/lib.rs` (`enum Host`) et dans
     `tools/config/host/catalog.json` ;
   - le reporter dans `tools/config/build-factory.json` (`target`), `tools/config/host/vps-cargo.json` (`host`) et
     `tools/config/host/toolchain.json` (`hosts`).
5. **Approvisionnement** : chaîne d'outils selon `toolchain.json` (rustup 1.98.1, sccache, Bun 1.4.2, uv, outils
   installés par binstall). `bun-forge` installe lui-même LLVM 23.1.1, cmake et rustup. Créer l'arborescence
   `/srv/aphrody-build/{workspaces,cache,artifacts,locks}`.
6. **Transfert** :
   - sources récupérées par git, révisions épinglées ;
   - caches recopiés en option pour démarrer à chaud : cargo 20 Go, sccache 2,8 Go, bun 3,5 Go, bun-forge 2,8 Go,
     soit ≈ 30 Go par SSH ;
   - artefacts : 80 Mo.
7. **Qualification** : rejouer les bancs de référence à la même révision et consigner les temps dans MEMORY. Ensuite
   seulement, relever le plafond de jobs (`cargo-serial.sh`, de 1..6 à 1..12) si la RAM le permet.
8. **Bascule** : repointer le tunnel `vps-cargo` et la cible de la fabrique. Sur le VPS, supprimer les caches de
   fabrique par la liste blanche Infra et libérer le rôle de `heavy.lock`. Conserver la fabrique du VPS intacte
   jusqu'à la qualification pour pouvoir revenir en arrière.
9. **dbfr** : traiter le disque à 93 % en passant en VPS-4 2027 (+11,25 €/mois) ou en déplaçant les médias, que le

Pour le scénario A, il s'ajoute :

- abaisser le TTL DNS ;
- installer nginx, les unités systemd et les certificats depuis `tools/config/host/` ;
- configurer le Backup Storage de 500 Go ;
- résilier le VPS-4 une fois les sondes de santé vertes.

## Limites

- Aucun prix TTC hors OVH n'est vérifié (Contabo indéterminé).
- Le prix de L40S chez Scaleway n'est pas extrait, l'instance étant réservée à PAR-2.
- L'API Netcup n'est pas vérifiée.
- Le CPU hôte réel du VPS n'est pas connu.
- La pérennité de la gamme VPS 2026 n'est pas confirmée.
- Le SLA Rise est contradictoire : 99,90 % sur la page, `sla: 99.95` dans le catalogue.

## Sources (consultées le 2026-10-05)

- OVHcloud :
  - [VPS 2027](https://www.ovhcloud.com/fr/vps/) ;
  - [catalogue VPS (API)](https://eu.api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=FR) ;
  - [catalogue Eco (API)](https://eu.api.ovh.com/v1/order/catalog/public/eco?ovhSubsidiary=FR) ;
  - [disponibilités (API)](https://eu.api.ovh.com/v1/dedicated/server/datacenter/availabilities?planCode=25risel01-v1)
    (`25risem01-v2`, `25rises01-v2` et `26risegpu01-v1` interrogés de la même façon) ;
  - [Rise](https://www.ovhcloud.com/fr/bare-metal/rise/), [Eco](https://eco.ovhcloud.com/fr/),
    [Kimsufi](https://eco.ovhcloud.com/fr/kimsufi/) ;
  - [tous les serveurs dédiés](https://www.ovhcloud.com/fr/bare-metal/prices/) ;
  - [tarifs Public Cloud](https://www.ovhcloud.com/fr/public-cloud/prices/) ;
  - [Backup Storage](https://www.ovhcloud.com/fr/bare-metal/backup-storage/).
- Hetzner :
  - [AX](https://www.hetzner.com/dedicated-rootserver/matrix-ax/),
    [EX](https://www.hetzner.com/dedicated-rootserver/matrix-ex/),
    [GPU](https://www.hetzner.com/dedicated-rootserver/matrix-gpu/) ;
  - fiches [AX42](https://www.hetzner.com/dedicated-rootserver/ax42/),
    [AX102](https://www.hetzner.com/dedicated-rootserver/ax102/),
    [EX63](https://www.hetzner.com/dedicated-rootserver/ex63/),
    [GEX45](https://www.hetzner.com/dedicated-rootserver/gex45/),
    [GEX131](https://www.hetzner.com/dedicated-rootserver/gex131/) ;
  - [JSON officiel des prix](https://www.hetzner.com/_resources/app/data/app/live_data_prices.json),
    [vue nav_prices](https://website-price-api.hetzner.com/api/v1/views/nav_prices),
    [enchères](https://www.hetzner.com/_resources/app/data/app/live_data_sb.json) ;
  - [Cloud](https://www.hetzner.com/cloud/), [API Robot](https://robot.hetzner.com/doc/webservice/en.html),
    [API Cloud](https://docs.hetzner.cloud/) ;
  - sources secondaires sur les hausses de 2026 :
    [webhosting.today](https://webhosting.today/2026/06/18/hetzners-price-increases-reached-209-the-30-headline-applied-to-a-different-tier/),
    [Northflank](https://northflank.com/blog/hetzner-cloud-server-price-increases).
- Scaleway :
  - [Elastic Metal](https://www.scaleway.com/en/pricing/elastic-metal/) ;
  - [Instances](https://www.scaleway.com/en/pricing/virtual-instances/) ;
  - [GPU](https://www.scaleway.com/en/pricing/gpu/) ;
  - [API Elastic Metal](https://www.scaleway.com/en/developers/api/elastic-metal/).
- Netcup : [serveurs root](https://www.netcup.com/en/server/root-server).
- Contabo :
  - [serveurs dédiés](https://contabo.com/en/dedicated-servers/) ;
  - [VPS](https://contabo.com/en/vps/), [VDS](https://contabo.com/en/vds/) ;
  - [API](https://api.contabo.com/).
- Dépôt : `tools/config/build-factory.json`, `tools/config/bun-forge.json`, `tools/config/host/inventory/*.json`,
  `tools/config/service-catalog.json`, `tools/config/host/systemd/**`, `tools/config/host/nginx/routes.json`, `tools/config/local-ai.json`,
  `tools/config/host/toolchain.json`, `tools/config/host/vps-cargo.json`, `crates/ml/*`, `crates/infra/ovh/src/vps.rs`,
  `scripts/build/rust/cargo-serial.sh`, `Cargo.toml`, `Cargo.lock`, PLAN.md, MEMORY.md.
