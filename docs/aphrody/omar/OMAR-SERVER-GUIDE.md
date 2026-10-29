> **Legacy fork notice (2026-10-29).** This document predates the move to the unmodified upstream `bun` npm package (`1.4.4-canary.20261028.1`). The abandoned Bun fork, its fork-only commands, `bun:*` modules and `toolchains/bun` named here are history, not current instructions.

# Guide d'exploitation — Omar Server

Ce guide décrit la configuration locale vérifiée le 11 octobre 2026. Il ne contient aucun jeton, mot de passe, clé privée, cookie ou profil exporté.

## Accès

- Interface Omar WebOS : `http://localhost/` sur le PC, ou `http://10.200.77.10/` depuis les pairs WireGuard autorisés.
- Le proxy Nginx natif écoute sur le port 80 et route les services Omar. Routes : `/mcp/`, `/a2a/`, `/v1/` et `/system-stream/`.
- Santé du superviseur : `http://127.0.0.1:8797/health`.
- Index NTFS : `http://127.0.0.1:8802/health`. Cache : `http://127.0.0.1:8803/health`.
- Beszel est lié à `127.0.0.1`; son interface n'est pas publiée sur le réseau.
- Le chat OpenAI compatible est routé sous `/v1/`. llama.cpp CUDA expose aussi son serveur local sur le port `8081`.

Le pare-feu et Nginx limitent l'accès distant aux pairs configurés. Utiliser le tunnel privé WireGuard ou les forwards SSH existants; ne pas exposer les ports d'administration directement à Internet.

## Services Windows

Le service `OmarServer` démarre avec Windows sous `SYSTEM` et supervise Nginx, A2A, le flux système, llama.cpp CUDA, WebOS, le proxy de crawl Japon, l'index NTFS et le cache. Les clés et identifiants restent dans le stockage privé Aphrody et ne doivent pas être copiés dans le dépôt.

```powershell
Get-Service OmarServer
Restart-Service OmarServer
Invoke-RestMethod http://127.0.0.1:8797/health
```

Le compte Windows doit disposer des droits administrateur pour redémarrer ce service. Examiner les journaux via le superviseur/catalogue Aphrody plutôt que de copier des fichiers de secrets dans un ticket.

## SSH, accès bureau et fichiers

- Serveur OpenSSH Windows : TCP 22, accès avec les clés déjà provisionnées et les règles de pare-feu existantes.
- VNC : TCP 5900, à utiliser seulement depuis les réseaux privés autorisés.
- Bureau Aphrody : TCP 8795, via l'accès privé configuré.
- Partage SMB chiffré `Omar-C` : utiliser le chemin réseau configuré et un compte autorisé.
- WireGuard du PC : `10.200.77.10`. Les pairs VPS et le PC Aphrody utilisent les adresses inscrites dans la configuration WireGuard; conserver les ACL actuelles.

Windows Home n'héberge pas le serveur Microsoft RDP. Le bureau à distance disponible ici est le service Aphrody/VNC. Le bureau Wayland n'est pas un serveur natif Windows et n'est pas qualifié dans cette installation.

## Index et graphe

Base SQLite canonique : `server/var/index/omar.sqlite`. Les index comprennent le MFT NTFS et les chemins EXE/DLL de System32 accessibles. Certaines zones système protégées ne sont pas lisibles et sont marquées comme telles. Les graphes de code sont limités à leur périmètre et snapshot déclaré.

```powershell
bun graph
bun graph search WebOS --limit 10
bun graph status --scope bun-os --limit 5
bun graph index --scope omar-strict
bun run status
```

La base SQLite reste la source canonique; Redis est un cache authentifié lié à loopback. Le cache peut être régénéré, l'index se met à jour par le service NTFS.

## Développement et déploiement local

Racine canonique du monorepo : `C:\SSH\omar`. `codex/` contient les plugins Aphrody/Omar; `server/` contient le superviseur et les applications. Le dépôt Git est privé. `private/`, `server/var/`, `.env*`, les bases, les logs et les clés sont ignorés par Git.

Depuis la racine, avec Bun Aphrody 1.4.4 :

```powershell
bun --version
bun install --frozen-lockfile
bun run status
bun server/probe-server.ts
```

Le build WebOS s'exécute dans `server/apps/bun-webos`. Le démarrage automatique et les routes Nginx sont gérés par les catalogues Aphrody; modifier ces fichiers à travers les outils/catalogues déclarés, puis vérifier la santé HTTP avant de considérer le changement terminé.

## Limites qualifiées

- Le modèle local actuellement validé est llama.cpp CUDA sur RTX 4060.
- Le passthrough GPU de Docker VMM pour vLLM n'est pas qualifié.
- Wayland n'est pas fourni comme serveur d'affichage Windows.
- Une compilation locale Bun est distincte d'une publication distante de release.
- Le proxy Japon est réservé aux consommateurs Aphrody Web; il ne change pas la route globale du PC.

## Secrets et sécurité

Ne pas publier les variables d'environnement, fichiers d'identifiants, clés privées SSH, clés WireGuard, profils navigateur, exports de compte ou fiches personnelles. Les secrets distants sont provisionnés au niveau du service avec des ACL limitées; éviter les variables globales Windows pour les credentials qui n'ont besoin que d'un seul service.
