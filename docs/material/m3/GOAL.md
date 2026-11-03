<!-- SPDX-License-Identifier: Apache-2.0 -->
# Objectif — finaliser Aphrody M3

Demande propriétaire du 2026-10-04 : unifier et finaliser le framework Aphrody M3
en mode Yolo. Le périmètre confirmé est ce checkout, pas une refonte de tous les
moteurs Aphrody/Yolo.

- Donner un contrat cohérent aux packages, au CLI et aux adaptateurs existants.
- Vérifier les suites, les exports, les assets et les liens sur l'état courant.
- Aligner les points d'entrée, la documentation et les plans sur les manifests
  et les comportements vérifiés.
- Préserver les lots concurrents et livrer uniquement les changements achevés
  et possédés.
- Distinguer le framework web testé, les artefacts compilés, les hôtes installés
  et les capacités encore ouvertes.

[PLAN.md](PLAN.md) contient les gates et la queue bornée ; [MEMORY.md](MEMORY.md)
contient les preuves. Les contrats natifs restent définis par le
[plan Aphrody](../PLAN.md) et le plan Yolo.
