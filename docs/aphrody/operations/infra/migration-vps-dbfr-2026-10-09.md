# Migration de la production VPS → dbfr (2026-10-09, état final)

- **dbfr (51.255.162.6), production :** aphrody-a2a (8788, wg1 10.200.77.3:8788, Codex copié), aphrody-downloads (8797), aphrody-fonts-proxy (8796), aphrody-discord-dev (4010), aphrody-discord-ai-lab, aphrody-discord-debate et aphrody-mcp-http-dbfr (8793). Le drop-in `50-migration-vps.conf` reprend la base RAG du debate (5432 local) et les hôtes d'outils yolo/m3.
- **DNS :** OVH. Les A de aphrody.com (@, inacord, n2b) pointent vers 51.255.162.6. La zone rpbey.fr pointe encore vers 51.77.147.152, où plus rien n'est servi.
- **Pare-feu dbfr :** 80/tcp, 443/tcp et 443/udp sont ouverts. Comme le gateway tourne en network host, ufw bloquait l'entrée publique. 8788/tcp est ouvert sur wg1 pour 10.200.77.0/24.
- **Arrêtés sur décision utilisateur :** aphrody-llama-gemma4 (VPS) et aphrody-discord-omar-monitor. Leurs units et données sont conservées sur le VPS.
- **Retirés du VPS :** aphrody-mcp-http (fusionné dans mcp-http-dbfr), aphrody-jobs-worker-vps, aphrody-web-browser-vps, redis-server, nginx, certbot.timer et aphrody-wg-proxy@8788/8793. Les unit files sont dans `/var/backups/P-units-20261009`.
- **VPS, rôle restant :** build, docker, sshd et outils système. Le plan de contrôle du hub wg1 y reste aussi : drive-sync, discord-control-plane, discord-lab-telemetry, omar-admin, omar-link et selfheal.
- **Publication :** `publish-creator.ts` cible dbfr. `publish-downloads.ts` construit et scanne sur la factory du VPS, puis pousse l'archive vers dbfr (`factory.target`/`pushTo`).
- **production-topology.json (codex), alignement des sources effectué :**
  - `hosts.vps.network` : publicPorts `[]` ; 4010, 8788, 8793, 8796, 8797, 8798, 8799 et 15433 retirés de internalOnly.
  - `hosts.dbfr.network.internalOnly` : 4010, 8788, 8796 et 8797 déjà déclarés et conservés. Cet alignement ne modifie pas les hôtes ni leurs pare-feu.
- **Retour arrière :** remettre les units de `/var/backups/P-units-20261009` dans /etc/systemd/system, réactiver nginx, puis `aphrody infra ovh dns set-a <zone> 51.77.147.152 --subdomain … --apply`. Les sauvegardes `*.before-P-*` sont sur dbfr (policies, ssh, hook, compose).
