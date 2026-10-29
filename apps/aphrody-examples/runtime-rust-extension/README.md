<!-- SPDX-License-Identifier: Apache-2.0 -->

# Extension Rust sur le SDK précompilé

Ce consommateur Cargo indépendant produit une bibliothèque dynamique Rust avec
la bibliothèque standard seule. Il lie le SDK natif installé, sans importer
les crates moteurs du monorepo ni lancer leur build.

Le contrat est la section yolo_* de `crates/interop/ffi/include/aphrody.h` :
handle opaque, buffer avec longueur, négociation ABI avant appel de ressource,
libération du buffer par son allocateur. L'hôte conserve le runtime et la
bibliothèque chargée ; il libère chaque buffer avec `yolo_buffer_free`.

Définir `YOLO_RUNTIME_LIB_DIR` vers le dossier du SDK précompilé correspondant
à la cible, puis utiliser `cargo build --release --locked`. Le chargeur du
processus hôte doit résoudre cette même bibliothèque. Sur Linux, cela peut se
faire avec `LD_LIBRARY_PATH` limité à ce processus.

L'export `yolo_extension_system_stats` emprunte un runtime existant et renvoie
les statistiques natives dans un buffer vide fourni par l'hôte. Aucun droit
de page ou d'extension n'est accordé par cet exemple. Il ne constitue pas le
chargeur d'extensions d'une application.

La qualification Linux et ses limites sont consignées dans
le reçu.
Les artefacts SDK et leur provenance restent dans leur store existant.
