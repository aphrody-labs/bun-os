<!-- SPDX-License-Identifier: Apache-2.0 -->

# Intégration Discord

Aphrody fournit un socle Discord partagé dans le paquet Bun @aphrody/discord-kit. Il regroupe les commandes, gardes, cycle de vie, REST, applications et transport de messages.

## Propriétaire unique

| Surface | Propriétaire | Rôle |
| --- | --- | --- |
| Runtime de bot | packages/discord/kit | Cycle de vie, intents, cache, interactions, gardes et clients Discord |
| Messagerie | @aphrody/discord-kit/messaging | Contrats de canal, messages, fichiers, salons et flux annulables |
| Compilateur | CLI Aphrody et capacités Bun natives | Compilation et vérification des consommateurs selon leurs dépôts |

L’ancien paquet @aphrody/messaging a été absorbé dans @aphrody/discord-kit. Il n’existe plus de source ni de pipeline indépendant pour ce paquet. L’ancienne documentation de compatibilité est conservée dans ce dossier et renvoie au point d’entrée maintenu.

## Vérification

Depuis la racine Aphrody :

    bun run --filter @aphrody/discord-kit typecheck
    bun run --filter @aphrody/discord-kit test

La compilation de bots consommateurs et leur déploiement restent sous l’autorité de leurs dépôts et runbooks respectifs.
