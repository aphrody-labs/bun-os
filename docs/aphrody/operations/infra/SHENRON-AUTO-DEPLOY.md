<!-- SPDX-License-Identifier: Apache-2.0 -->

Correction du 2026-10-29 : Shenron prend Next.js depuis le registre npm (`next`, `@next/env` et
`@next/third-parties` épinglés à une même version exacte dans le catalogue). Le service vérifie
ce catalogue et `bun.lock` avant l'installation gelée (`verifyNextCatalog`) ; les archives
`vendor/next-fork/` n'existent plus.
Une attente du verrou de factory (code 75) est réessayée par le timer et ne prouve
pas un déploiement terminé.

# Synchronisation et déploiement automatiques de Shenron

La demande propriétaire du 14 octobre 2026 autorise le suivi automatique de
`origin/main`, le build qualifié sur VPS et l'activation scellée sur DBFR.
Le propriétaire de l'orchestration et des unités reste Aphrody Infra.

`tools/config/shenron-auto-deploy.json` déclare les chemins et le runtime Bun
1.4.4. Deux timers systemd utilisateur, avec linger actif, tournent toutes les
deux minutes : `shenron-sync.timer` synchronise le checkout canonique et
`shenron-auto-deploy.timer` vérifie la révision active sur DBFR. Les unités
sont dans `tools/config/host/systemd/shenron/` et déclarées au catalogue.

La synchronisation est exclusivement fast-forward sur `main`. Toute modification
locale, branche différente ou divergence suspend cette passe avec code 75 et
préserve les fichiers. Aucun reset, clean forcé, stash ou force-push n'est utilisé.
Le verrou de source sérialise les synchronisations. Le verrou lourd existant de
la fabrique couvre tout le build et la promotion ; un verrou occupé est retenté
au prochain passage. Les commits sont figés dans un worktree dédié à cette
fabrique ; les autres worktrees et les claims restent intacts.

Le build installe le lockfile figé, prépare les propriétaires vendor et config,
vérifie la provenance native et le VFS public, puis exécute les gates produit,
construit bot, serveur et image et contrôle les exécutables de l'image. Des
binaires natifs qualifiés ne sont réutilisés que si leurs entrées source et
SHA-256 correspondent aux révisions déclarées. Sinon les gates Cargo et la
compilation sont exécutées. Une erreur arrête la passe avant promotion.

La promotion transfère l'image et le CDN avec contrôle SHA-256 sur DBFR.
`prepare-shenron-auto-release.py` clone exclusivement la configuration publique
scellée de la release active, conserve les stores et identités d'infrastructure,
prépare l'union des chunks immuables et scelle le candidat avec les helpers
existants. L'adaptateur Infra vérifie et active la release, avec son mécanisme
transactionnel de retour arrière. Aucun build n'est exécuté sur DBFR.
Un changement concurrent de la release active pendant le build refuse la
promotion de cette passe. La révision active et la santé publique sont relues.

Les états privés sont sous `~/.local/state/shenron-auto-deploy/` ; les journaux
restent dans journald. Une unité activée ne prouve pas un déploiement réussi :
`deploy.json`, l'état systemd et le `current` distant sont les preuves séparées.

Depuis le 15 octobre 2026, le build réutilise le budget de la factory Infra :
12 jobs sur VPS, avec admission fraîche de l'affinité CPU, de `MemAvailable` et
du disque sous les verrous lourd et source. Les caches et artefacts utilisent
`/home/ubuntu/build/storage` ; le worktree persistant est sous
`artifacts/shenron-auto-deploy/worktree`, hors du répertoire temporaire nettoyé
par la factory. Aucun ancien worktree ni cache n'est supprimé par ce changement.
L'unité VPS permet 12 CPU, avec `MemoryHigh=32G` et `MemoryMax=37G` ; DBFR ne
reçoit pas cette allocation. Le runtime reste lié à son SHA-256 et à sa
provenance déclarés ; la version attendue suit ces pins lors d'une prochaine
release qualifiée.

Le contrat optionnel `deploymentIdentity: "source-runtime-v1"` compare ensemble
le commit Shenron et les pins Bun (SHA-256 du binaire, version, révision et URL
de provenance). À source Shenron identique, un runtime différent déclenche donc
un nouveau build ; une identité identique conserve le saut du build. Le tag
Docker et le dossier d'artefacts utilisent ce digest. Le dossier de release
`docker-<commit-Shenron>-<digest>` et son reçu public `deployment` sont vérifiés
par les mêmes propriétaires de préparation, de scellement et d'activation.
Le champ `commit` et les labels OCI conservent le vrai commit Shenron.

Ce mode doit être activé avec les pins d'un runtime qualifié et l'adaptateur
correspondant installé sur DBFR. Le paquet canonique
`scripts/tools/install-vps-adapter.sh --stack shenron` inclut désormais le module
`shenron_deployment_identity.py`, dont le hash figure dans le manifeste scellé
de source puis dans `ADAPTER.json`. Sans ce mode explicite, le contrat historique
reste valide. Cette évolution source ne change ni les pins concrets de la
configuration ni les services actifs ; leur avancée reste une étape distincte,
avec plan Infra, comparaison de l'état initial et relecture des preuves.

```sh
systemctl --user status shenron-sync.timer shenron-auto-deploy.timer
systemctl --user start shenron-sync.service
systemctl --user start --no-block shenron-auto-deploy.service
journalctl --user -u shenron-auto-deploy.service -f
```

## Documentation primaire consultée

Consultée le 14 octobre 2026 ; les exemples historiques de la file `bun-probe`
ne sont pas une promotion d'image Shenron.

- [Index du fork Aphrody Bun 1.4.4](https://aphrody.app/llms.txt)
- [Bun avec systemd](https://aphrody.app/docs/guides/ecosystem/systemd.md)
- [File de déploiement Bun existante](https://aphrody.app/docs/project/auto-deploy.md)
- [Archives natives Bun](https://aphrody.app/docs/runtime/archive.md)
- [Bun avec Next.js](https://aphrody.app/docs/guides/ecosystem/nextjs.md)
- [Bun dans Docker](https://aphrody.app/docs/guides/ecosystem/docker.md)
- [tmux : détachement et sessions](https://github.com/tmux/tmux/wiki/Getting-Started)
- [Docker Compose en production](https://docs.docker.com/compose/how-tos/production/)
- [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)
- [GitHub : assets et digest SHA-256](https://docs.github.com/en/rest/releases/assets)
- [Next.js 16](https://nextjs.org/blog/next-16)
- [Next.js : sorties standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

systemd possède le cycle de vie persistant et les reprises ; tmux reste un
outil de diagnostic interactif. Les flags Compose et le scellement restent
ceux de l'adaptateur canonique, pas d'un second moteur de déploiement.
