<!-- SPDX-License-Identifier: Apache-2.0 -->
# Qualifier un consommateur du runtime Yolo

Ce parcours applique les contrats et critères du [plan directeur](../../PLAN.md). Yolo produit le runtime et `@aphrody/runtime-sdk` ; Aphrody possède
le raccordement permanent et les contrats produit. Les détails d’archive et
d’installation viennent de `../yolo/docs/CONSUMERS.md` et `../yolo/docs/DISTRIBUTION.md` chez
le producteur, accessibles depuis le plan racine. Vérifier leur version pour
le lot sélectionné avant d’écrire une commande d’installation.

## 1. Choisir un lot et son propriétaire

Lire les règles et mémoires actives, vérifier branche, HEAD et claims, puis
réserver les fichiers du consommateur. Consulter les
[inventaires existants](../../ecosystem/ECOSYSTEM.md) et la
[CLI propriétaire](../../reference/workspace/CLI.md). Workspace/Infra orchestre
le lot ; le SDK ne remplace pas les workflows produit par une nouvelle CLI.

Le premier consommateur désigné par le plan est `agent-browser`. L’état d’un
patch producteur et celui du raccordement Aphrody doivent être consignés
séparément. Ne pas déduire le statut courant d’un exemple ou d’un reçu ancien.

## 2. Épingler et vérifier le livrable

Identifier révision, version SDK, archive, cible, ABI, capacités et hashes.
Conserver provenance, licences et rollback. Une archive issue d’un arbre dirty
reste identifiée comme telle, même si ses tests passent. Une release observée
sur une cible ne qualifie pas toutes les plateformes annoncées.

Installer selon la procédure producteur et vérifier le refus des incompatibilités
avant l’appel natif. Préserver manifests et lockfiles ; ne pas retirer les
moteurs du consommateur avant qualification du remplacement. Le
[bootstrap développeur](bootstrap.md) installe des outils et dépendances :
il ne remplace pas cette vérification du runtime précompilé.

## 3. Raccorder sans déplacer le produit

Remplacer le mécanisme sélectionné derrière le contrat existant : types,
erreurs, événements, annulation et arrêt. Garder les données métier, intégrations
et décisions applicatives dans Aphrody. Qualifier les capacités disponibles ;
une supervision native ne remplace pas à elle seule le navigateur Obscura.

Respecter les permissions par contexte et session. Le SDK léger doit être
vérifié dans le graphe effectif du consommateur : une façade qui réintroduit
les moteurs lourds ne suffit pas à qualifier R7.

## 4. Exécuter les gates du lot

L’intégrateur choisit les gates du package propriétaire : format/lint,
TypeScript, tests de comportement, arrêt réel des processus et consommateurs
aval concernés. Les opérations Cargo passent exclusivement par sa fabrique
sérialisée. Un worker documentaire n’exécute aucun build moteur.

Conserver les contrats et preuves avant/après, y compris les erreurs et refus.
La [grille de qualification](../../architecture/runtime-native/qualification.md)
précise les preuves pour chaque état. Une réussite du producteur n’est pas
une réussite de déploiement d’un consommateur.

## 5. Livrer et conserver le retour arrière

Fournir un reçu JSON et Markdown avec chemins possédés, commandes et résultats,
limites, provenance et rollback. Vérifier la version réellement chargée avant
de déclarer une activation. Le retour arrière associe le SDK, l’artefact et le
patch consommateur compatibles, sans écraser les modifications concurrentes.

Ne publier aucun paquet ni activer un produit à partir d’une seule validation
documentaire. Une réduction du coût de build ou de la latence exige une mesure
reproductible ; ce guide ne revendique aucun gain.
