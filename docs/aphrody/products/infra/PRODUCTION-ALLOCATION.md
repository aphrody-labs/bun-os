# Allocation production

## Décision

La topologie déclarée est portée par [`tools/config/production-topology.json`](../../../../infra/config/production-topology.json), les unités par [`tools/config/service-catalog.json`](../../../../infra/config/service-catalog.json) et les routes par `yolo/tools/config/host/nginx/routes.json`. La pile Aphrody ne doit donc pas être décrite comme redéployée par le bundle sans nouvelle observation et activation vérifiables. Le point-in-time du 2026-10-02 se trouve dans le rapport VPS.

DBFR est déclaré nœud de données et sauvegardes secondaire : PostgreSQL, Redis,
CDN d’assets, sauvegardes et un slot de rollback. La politique lui interdit les
sites, bots, serveurs Next, crawlers et Nginx public. L’état runtime observé est
séparé de cette déclaration dans le rapport de topologie.

IECode quitte les VPS : le checkout, les assets lourds et les outils desktop
restent dans Windows et WSL. Le VPS ne reçoit que les artefacts explicitement
nécessaires au runtime.

## Ports et sous-domaines

La topologie déclare les ports publics VPS `80/443` et les ports applicatifs comme internes. Le service catalogue déclare PostgreSQL `5432` et Redis `6379` sur VPS comme actifs ; DBFR déclare aussi ses propres services internes. Les ports `3007`, `8083`, `8788`, `8789`, `8794`, `5010`, `8085` et `8790` correspondent à des entrées retirées, et `8801`, `8810`, `8812` à des services RG retirés/supplantés. Cela décrit le catalogue, pas des sockets observés en direct. Voir le [référentiel routes et ports](../../reference/infra/PORTS-AND-DOMAINS.md).

## Priorités

1. Nginx, API, sites et CDN.
2. PostgreSQL, Redis, backups et rollback.
3. Workers métier nécessaires (bots, cron).
4. IA (A2A, MCP, E5), indexations et tâches différées.
5. Crawlers, mirrors complets et jobs exploratoires : désactivés par défaut.

Les priorités de placement sont déclarées par hôte dans le catalogue ; leur
application effective dépend des unités installées et doit être observée sur
l’hôte. Les applications n’administrent pas l’instance Nginx publique.

## Timers unifiés

La politique `tools/config/scheduler-policy.json` déclare la stratégie des tâches
périodiques. Les unités/timers effectivement actifs doivent être lus dans le
catalogue puis vérifiés par une observation hôte datée ; la seule présence
d’un timer n’établit pas le succès de ses sauvegardes ni leur restauration.
