<!-- SPDX-License-Identifier: Apache-2.0 -->
# Domaines, Routage & SEO Technique

Ce document récapitule la topologie des noms de domaine, le routage Nginx et les spécifications techniques de référencement (sitemaps, en-têtes HTTP et métadonnées).

---

## 1. Topologie des Domaines et Services

Tous les services écoutent localement sur `127.0.0.1`. Nginx termine le chiffrement TLS et route selon l'en-tête `Host`.

| FQDN | Port Interne | Hôte VPS | Service / Binaire | Rôle Technique |
|---|---:|---|---|---|
| **`aphrody.com`** | `8083`, `8788`, `8789` | `vps` (`51.77.147.152`) | `aphrody-site` et services IA | UI et Web/BXC/N2B sur OS ; A2A et RAG/modèles routés séparément par Nginx ; sitemap racine |
| **`nie.aphrody.com`** | `8085` / `8790` | `vps` (`51.77.147.152`) | `nie-site` / `nie-model-serve` | Service Niers séparé, conteneurs Nie VFS et assets 3D |
| **BXC** | interne | `vps` (`51.77.147.152`) | backend `aphrody-web/apps/bxc` | Scraping, CDP et indexation exposés par `/api/v1/web/*` et le MCP Web |
| **N2B** | in-process | `vps` (`51.77.147.152`) | `aphrody-site` | Schémas et opérations de migration exposés uniquement par `/api/v1/n2b/*` |

---

## 2. En-têtes HTTP & Sécurité Nginx

Les configurations de virtual hosts appliquent les en-têtes stricts suivants :

```nginx
# Sécurité du transport et protection contre le reniflage de type MIME
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Indication du sitemap dans l'en-tête de réponse
add_header Link "<https://aphrody.com/sitemap.xml>; rel=\"sitemap\"" always;
```

---

## 3. Spécification Sitemap XML & Robots.txt

### Sitemap XML (`https://aphrody.com/sitemap.xml`)
- Format : XML standard conforme au schéma sitemaps.org.
- Indexation des points d'entrée publics canoniques :
  - `https://aphrody.com/` (changefreq: `weekly`, priority: `1.0`)
  - `https://nie.aphrody.com/` (changefreq: `weekly`, priority: `0.9`)

Les anciens hôtes `bxc.aphrody.com` et `n2b.aphrody.com` ne portent aucune
vitrine indexable. Les capacités correspondantes sont des routes machine sous
`aphrody.com`; elles ne créent pas de pages produit ni de sitemap séparé.

### Robots.txt (`https://aphrody.com/robots.txt`)
```text
User-agent: *
Allow: /
Allow: /mcp
Allow: /llms.txt
Allow: /ai.json
Allow: /sitemap.xml
Disallow: /api/internal/

Sitemap: https://aphrody.com/sitemap.xml
```

---

## 4. Données Structurées JSON-LD (Schema.org)

Pour assurer la résolution claire des entités par les moteurs de recherche et les crawlers, `aphrody.com` injecte le graphe JSON-LD suivant :

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://aphrody.com/#website",
      "url": "https://aphrody.com/",
      "name": "Aphrody",
      "description": "Plateforme unifiée d'outils et de services logiciels",
      "publisher": {
        "@id": "https://aphrody.com/#organization"
      }
    },
    {
      "@type": "Organization",
      "@id": "https://aphrody.com/#organization",
      "name": "Aphrody Core Team",
      "url": "https://aphrody.com/",
      "logo": "https://aphrody.com/assets/aphrody.webp"
    }
  ]
}
```
