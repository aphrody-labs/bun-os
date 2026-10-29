<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualification du sccache SSH VPS — 2026-10-11

## Configuration appliquée

Une session SSH ordinaire vers `vps` ne recevait aucun `RUSTC_WRAPPER` ni
`SCCACHE_DIR`. Les builds passant par l'usine définissaient déjà ces valeurs,
mais un `cargo build` lancé depuis une nouvelle session ne sélectionnait pas
sccache. Le 2026-10-11, le fichier utilisateur Cargo suivant a été créé par
`aphrody infra ssh exec --host vps` après vérification de son absence et du
propriétaire `ubuntu` du répertoire :

```toml
[build]
rustc-wrapper = "/home/ubuntu/.cargo/bin/sccache"

[env]
SCCACHE_DIR = "/home/ubuntu/build/cache/sccache"
SCCACHE_IDLE_TIMEOUT = "0"
```

État observé après écriture : `/home/ubuntu/.cargo/config.toml`, propriétaire
`ubuntu:ubuntu`, mode `0644`, SHA-256
`9ae402337e52e9ec6951b79dd2546bd5f579a4c97fffe0f2216b6d9752c3957d`. Aucun
service ni daemon n'a été redémarré. Le serveur existant conserve son cache
local sous `/home/ubuntu/build/cache/sccache`; sa taille observée était de
4,1 GiB pour une limite de 10 GiB. La limite n'a pas été augmentée : le volume
de build était utilisé à 92 % (27 GiB libres) pendant la qualification.

Cette configuration globale ne définit ni le nombre de jobs, ni un répertoire
de sortie Cargo, ni un verrou de compilation. Une variable `RUSTC_WRAPPER`
explicitement fournie à Cargo conserve la priorité, y compris la valeur vide
utilisée comme opt-out. Les builds lourds restent à exécuter via
[`cargo-serial.sh`](../../../../scripts/aphrody/build/rust/cargo-serial.sh) ou la fabrique
VPS, qui possèdent les verrous, les limites de ressources et la politique
`CARGO_INCREMENTAL=0`. Les compilations incrémentales, les crates binaires,
les macros procédurales et les commandes que sccache ne peut pas mettre en
cache peuvent ne pas produire de hit. La configuration n'accorde pas à un
build SSH direct une lease d'usine.

## Reproduction contrôlée

L'état vient de la configuration utilisateur Cargo, pas d'un changement de
`PATH` ou d'un profil shell. Pour réinstaller sur le même hôte, appeler
l'Infra SSH owner et n'écrire que si le fichier est absent :

```sh
aphrody infra ssh exec --host vps --cmd 'set -eu
test "$(id -un)" = ubuntu
test -x /home/ubuntu/.cargo/bin/sccache
test -d /home/ubuntu/build/cache/sccache
if test -e /home/ubuntu/.cargo/config.toml || test -L /home/ubuntu/.cargo/config.toml; then
  echo "Cargo config exists; compare it and preserve it instead of overwriting" >&2
  exit 20
fi
umask 022
set -C
cat > /home/ubuntu/.cargo/config.toml <<"CARGO"
[build]
rustc-wrapper = "/home/ubuntu/.cargo/bin/sccache"

[env]
SCCACHE_DIR = "/home/ubuntu/build/cache/sccache"
SCCACHE_IDLE_TIMEOUT = "0"
CARGO
set +C
sha256sum /home/ubuntu/.cargo/config.toml
'
```

Après une future recréation de l'hôte, vérifier le propriétaire, le chemin
exécutable de sccache et le cache existant avant de réappliquer. Si le fichier
existe déjà, le comparer au bloc ci-dessus; ne pas remplacer une configuration
globale concurrente. Pour annuler uniquement cette création, supprimer le
fichier par Infra SSH uniquement si son SHA-256 correspond encore au reçu
ci-dessus; sinon le préserver et examiner les changements.

## Preuves et limites

- Avant l'ajout global, une nouvelle session SSH n'avait ni `RUSTC_WRAPPER`,
  ni `SCCACHE_DIR`, ni `CARGO_INCREMENTAL`. Le fichier `~/.cargo/config.toml`
  était absent. La configuration Cargo du workspace Aphrody ne définissait
  pas de wrapper.
- Après l'ajout, `cargo +nightly-2026-09-15 -Z unstable-options config get
  --show-origin` a résolu `build.rustc-wrapper`, `env.SCCACHE_DIR` et
  `env.SCCACHE_IDLE_TIMEOUT` vers `/home/ubuntu/.cargo/config.toml`. Cargo
  stable 1.98.1 refuse cette commande de diagnostic car elle reste
  expérimentale; les compilations utilisateur continuent d'utiliser Cargo
  stable.
- Le daemon existant est détenu par `ubuntu`, utilise le même cache persistant,
  et a `SCCACHE_IDLE_TIMEOUT=0`. Les statistiques cumulées observées avant le
  changement montraient zéro timeout, zéro erreur de lecture et zéro erreur
  d'écriture. Elles incluaient 869 entrées `Cache errors` (292
  `assemblerToPreprocess[gcc]`, 574 `c[gcc]`, 3 Rust) et 4 963 appels
  `Non-cacheable calls`, principalement les crate types non pris en charge
  (2 780), les appels multi-fichiers (1 596) et l'absence d'informations
  d'entrée/sortie. Ces compteurs ne prouvent pas une corruption; aucun cache
  n'a été supprimé ni réinitialisé.
- La sonde a attendu puis acquis le verrou lourd sans interrompre le build
  existant. Une micro-crate temporaire a été compilée deux fois avec
  Cargo stable, `--offline`, `CARGO_INCREMENTAL=0` et `RUSTC_WRAPPER` explicitement
  absent. La première passe a ajouté un miss Rust (53 hits / 23 248 misses avant,
  puis 53 / 23 249); `cargo clean` a retiré uniquement les 10 fichiers de la
  cible temporaire (4,2 KiB). La seconde passe, après ce nettoyage, a ajouté un
  hit Rust (54 / 23 249), en 0,12 s. Le premier check a terminé en 0,16 s.
  Cela prouve que Cargo stable a lu le `build.rustc-wrapper` global et réutilisé
  sccache après un clean de cible. Le répertoire de sonde temporaire a ensuite
  été supprimé et vérifié absent. Les statistiques n'ont pas été réinitialisées;
  les compteurs `Cache errors` C/assembler sont restés inchangés à 869 et les
  compteurs d'erreurs/timeouts de lecture/écriture sont restés à zéro.

Les règles de l'usine restent dans
[`RUST-BUILD-FACTORY.md`](../infra/RUST-BUILD-FACTORY.md), sa configuration
dans [`build-factory.json`](../../../../tools/aphrody/config/build-factory.json), et
l'initialisation du daemon dans
[`build-factory-cleanup.ts`](../../../../packages/workspace/src/build-factory-cleanup.ts).
Références : [configuration Cargo](https://doc.rust-lang.org/cargo/reference/config.html)
et [configuration sccache](https://github.com/mozilla/sccache/blob/main/docs/Configuration.md).
