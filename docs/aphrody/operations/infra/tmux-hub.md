<!-- SPDX-License-Identifier: Apache-2.0 -->
# Hub tmux persistant

Observation du 2026-10-15 : OpenSSH Windows (Win32 et MSYS, 10.5p1) ouvre un
maître `ControlMaster` mais ne peut pas y rattacher de session
(`mux_client_request_session: Connection reset by peer`). Le multiplexage
reste donc côté Linux : `~/.ssh/multiplex.conf` sur vps et dbfr.

Le poste Windows ouvre une seule connexion interactive, `ssh vps-t`, qui
s'attache à la session tmux `main` du VPS. Sa fenêtre `dbfr` rejoint la
session `main` de dbfr par le maître multiplexé du VPS et se reconnecte en
boucle. `ssh dbfr-t` s'attache directement à dbfr.

Sources : [`aphrody-tmux-main`](../../../../infra/config/host/tmux/aphrody-tmux-main),
[service](../../../../infra/config/host/tmux/aphrody-tmux.service) et
[timer](../../../../infra/config/host/tmux/aphrody-tmux.timer). Installation
utilisateur (linger actif) : script dans `~/.local/bin`, unités dans
`~/.config/systemd/user`, `systemctl --user enable --now aphrody-tmux.timer`.
Les pairs sont listés dans `~/.config/aphrody/tmux-peers` (vps : `dbfr`).
Le timer recrée la session sous une minute, y compris après redémarrage.

Validation : timer actif sur les deux serveurs, fenêtres `main` présentes,
fenêtre `dbfr` du VPS attachée à `main` sur dbfr. Aucun redémarrage serveur
n'a été effectué.
