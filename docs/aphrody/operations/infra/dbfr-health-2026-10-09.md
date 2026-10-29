# Santé de DBFR, 2026-10-09

- Avant (02:49Z) : swap 8,4/10 Go, dont 6,9 Go pour llama ; 2,9 Go disponibles ; PSI mémoire avg60 0,14 ; disque 68 %. Le forward MCP PC avait redémarré 5885 fois, le redis hôte avait échoué 6 fois, UFW écrivait environ 5700 lignes par jour.
- Après (06:30Z) : swap 0,68/7 Go (zram zstd 2,8 Go) ; 6,2 Go disponibles ; PSI mémoire et CPU avg60 0,00 ; disque 56 % (54/96 Go) ; aucune unit en échec ; aucune erreur répétée dans le journal ; 8790 et 8798 libres.
- Chat : un seul GGUF fusionné Q4_K_M (LoRA intégré, sha256 22362d57…), mmap avec `--no-repack`, `--cache-ram 256`, KV q8_0. RssAnon 0,76 Go, contre 2,4 Go avec repack et 6,9 Go en swap au départ.
- Qualité du chat : même réponse que base + LoRA sur le prompt test. Perplexité (c 512, 12 chunks) : base + LoRA 17,21, fusionné 17,36, base seule 19,54.
- Limites `mem_limit` (égales à `memswap_limit`) : chat 5g, postgres 2560m, redis 1536m, site 768m, bot 512m, gateway 256m. Mémoire mesurée à 06:30Z : 686, 858, 602, 370, 186 et 65 Mio.
- Bun : `BUN_OPTIONS=--smol` pour site et bot. Après 20 min : site 321 → 261 Mio, bot 200 → 179 Mio. Le site remonte à 370 Mio après 2 h ; à remesurer sur 24 h.
- Système : sysctl alignés sur le profil Alpine (`aphrody infra ssh tune`, fichier 95-aphrody-tune.conf, dbfr à swappiness 20). zram recréé. sshd en `ClientAliveCountMax 3`. Toutes les mises à jour apt appliquées, phasées comprises.
- Purgés : redis hôte, postgresql-18 hôte, toolchains (clang/llvm-21, gcc, cmake, nodejs), fwupd, modemmanager, multipath, lxd, landscape. Supprimés aussi : la base Q4, codex 0.160, les traces dans ~, 860 doublons de médias remplacés par des liens physiques (809 Mo).
- Forward MCP PC : backoff de 30 s à 900 s. `aphrody-jobs-worker-dbfr` est désactivé, car le binaire n'a pas la feature jobs (jobs.db est conservé).
- Retour arrière : les fichiers `compose.yaml.bak-D-*` et `release.json.bak-D-*` sont dans la release courante, `/var/backups/99-keepalive.conf.bak-D-20261009` et `/var/backups/aphrody-sysctl/`. Pour le modèle, base Q4 téléchargée depuis HF, plus `adapter.gguf`. Les traces de ~ sont archivées dans vps:/srv/archive/dbfr-home-2026-10-09.tar.gz.
- Outils : `aphrody infra status/start/stop/logs` pilote les conteneurs (`docker:`) et filtre les services par hôte. internalOnly de dbfr est à jour.
- Commits aphrody : 709f185532, 9e62e343ac, 9a1e8660d6, a8031887d9, e9e6d3d422, beefb250c3, 5e55f4615a, fc0405ad8c.
- Ouvert : redémarrer sur le noyau 7.0.0-38, une fois que P aura écrit « P: migration terminée, reboot OK » dans ~/.coord-dbfr.log, puis purger le noyau 7.0.0-27.
- Ouvert : V doit reconstruire le binaire aphrody (lifecycle docker, tune, feature jobs). Le build de site et bot n'inclut pas 046736e6c49 (`--max-old-space-size`).
- Ouvert : cloud-init, mesa et ffmpeg sont conservés.
