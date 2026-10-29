# Persistance au boot

Directive propriétaire (2026-10-09) : tout Aphrody redémarre seul après un reboot, sur Win11 et Ubuntu, depuis un état désiré unique.

## Modèle déclaratif

Source : `tools/config/service-catalog.json`.

- Dérivé automatiquement : chaque `services[]` non `retired` avec `host` devient une entrée `docker` (si `container`) ou `systemd` (si `unit`). Les services `status: retired-*` ne sont jamais audités ni corrigés.
- Explicite : `boot.entries[]` ajoute minuteries, sockets, wrappers `-docker`, tâches planifiées et services Windows. Une entrée explicite l'emporte sur la dérivée.
- `hold` : l'entrée est auditée mais `apply` ne la corrige pas (travail d'un autre propriétaire, déploiement à planifier).

| kind | attendu | correction (`apply`) |
|---|---|---|
| `systemd` | activée au boot, active, `Restart=always|on-failure|on-abnormal` (hors oneshot/timer/socket) | `systemctl enable --now` ou `reset-failed` + `start` ; `Restart=` absent ou unité absente = correction de la source (drop-ins/déploiement), jamais de modification ad hoc |
| `docker` | restart policy `always` ou `unless-stopped`, en cours | `docker update --restart unless-stopped` + `docker start` |
| `scheduledTask` | cachée, principal attendu (`system` = LocalSystem, `user` = S4U, `desktop` = session interactive sous `conhost --headless`), déclencheurs déclarés, action déclarée (`execute`/`arguments`/`workingDirectory`), activée ; hors `periodic` : redémarrage sur échec (999 x 1 min) et en cours | définition XML du Planificateur corrigée ou enregistrée via COM `ITaskService` (déclencheurs manquants ajoutés, le reste conservé), puis démarrage |
| `windowsService` | démarrage Automatic, en cours, actions de reprise si `restartOnFailure` | Service Control Manager : `ChangeServiceConfigW`, `ChangeServiceConfig2W` (redémarrage 5 s/5 s/60 s, remise à zéro 24 h), `StartServiceW` |

`Aphrody Remote Desktop` reste `atLogon` : la capture d'écran exige la session interactive.

Champs d'une tâche : `name`, `path` (défaut `\Aphrody\`), `triggers` (`atStartup`, `atLogon`, `every:<N>m` depuis minuit, `daily@HH:MM` heure locale), `execute`, `arguments`, `workingDirectory` (`{root}` = checkout, `%VAR%` = environnement), `description`, `principal` (`system`|`user`), `runLevel` (`highest` par défaut, `limited`), `desktop`, `periodic`, `timeLimitMinutes` (posé à l'enregistrement). Une tâche absente n'est enregistrée que si `execute` est déclaré.

## Commandes

```text
aphrody infra boot audit [--host vps|dbfr|local] [--json]   # lit l'état réel ; code de sortie 1 s'il reste une dérive non retenue
aphrody infra boot plan  [--host ...]                         # liste les commandes qui corrigeraient, sans rien exécuter
aphrody infra boot apply [--host ...]                         # exécute le plan puis relit l'état
aphrody infra boot apply --host local --entry Container       # une seule entrée (nom ou libellé hôte:nom)
```

Sans `--host`, tous les hôtes déclarés sont traités. Les hôtes distants passent par SSH (`sudo -n` pour systemd) ; `local` est la machine courante : les entrées Windows sont lues et corrigées en processus (Planificateur de tâches COM, Service Control Manager), sans PowerShell ni console. Si une correction Windows est due et que le jeton n'est pas élevé, `apply` se relance élevé (`sudo.exe` en ligne quand Sudo pour Windows est activé, sinon invite UAC) puis relit l'état.

`--entry` limite l'audit, le plan ou l'apply à une entrée : c'est ainsi qu'un autre PC (celui d'Omar, depuis son
checkout) enregistre une tâche déclarée sans appliquer les entrées propres au PC du propriétaire. Tâches déclarées
qui remplacent d'anciens scripts PowerShell : `Container` (`scripts/install/container-service.ts`, `--pc` lu dans
`APHRODY_PC`), `Aphrody self update` (`aphrody self update`), `AphrodyBunHygiene` (`scripts/tools/bun-hygiene.ts`).
## État observé (2026-10-09)

- `vps` et `local` : conformes (la tâche `Aphrody MCP HTTP` a reçu le déclencheur AtStartup, principal S4U).
- `dbfr` : conforme sauf deux entrées retenues : `aphrody-jobs-worker-dbfr.service` (désactivé, en échec ; worker corrigé séparément) et `aphrody-a2a.service` (déclaré sur dbfr par le catalogue mais unité absente ; à déployer via `aphrody infra deploy`).
- Les conteneurs de build du vps (`stab-rel-glibc`, `aphrody-setup-ubuntu`) sont éphémères et non déclarés.

Implémentation : `crates/infra/infra/src/boot.rs`, `wintask.rs` (XML du Planificateur et COM), `winsvc.rs` (SCM), tests unitaires inclus (aller-retour réel sur le Planificateur local sous Windows).
