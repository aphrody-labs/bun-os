# Architecture et Gestion Sécurisée des Secrets & Identifiants — Aphrody Infra

Ce document synthétise l'état de l'art, analyse comparativement les solutions existantes pour la gestion des identifiants (clés API, jetons, variables d'environnement, secrets de production) et formalise l'architecture souveraine mise en œuvre dans `aphrody-infra`.

---

## 1. Analyse Comparative des Solutions de Gestion des Secrets

| Solution | Architecture | Chiffrement au repos | Résilience souveraine (hors-ligne) | Observabilité GitOps (Diffs de clés) | Complexité opérationnelle | Empreinte ressources |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fichiers `.env` bruts + `.gitignore`** | Fichier texte local | ❌ Aucun (texte brut sur disque) | ⚠️ Vulnérable (fuite git, logs, backup) | ❌ Non versionné | Très faible | Nulle |
| **HashiCorp Vault / OpenBao** | Serveur centralisé client-serveur | ✅ Chiffrement unsealing (Shamir / KMS) | ⚠️ Nécessite un cluster/daemon actif permanent | ❌ Les secrets sont hors-dépôt | Très élevée (unseal, tokens, raft HA) | 200–500 Mo RAM |
| **Doppler / Infisical / 1Password** | SaaS Cloud / API propriétaire | ✅ Chiffrement géré par le fournisseur | ❌ Dépendance réseau externe et coût récurrent | ❌ Hors git ou via sync CLI | Faible à moyenne | Faible (agent CLI) |
| **Mozilla SOPS + Age** | Décentralisé / Fichiers chiffrés GitOps | ✅ AES-256-GCM / ChaCha20-Poly1305 + Age/SSH | ✅ Totalement autonome, zéro daemon | ✅ **Idéale** : valeurs chiffrées, clés lisibles en clair pour git diff | Faible (outil CLI / lib Rust & Bun) | Négligeable (< 5 Mo) |
| **systemd Credentials (`systemd-creds`)** | PID 1 natif Linux | ✅ Chiffrement TPM2 ou clé hôte (`/var`) | ✅ Natif OS Linux / systemd | ⚠️ Déploiement par unité systemd | Moyenne (CLI `systemd-creds`) | Nulle (intégré à systemd) |

---

## 2. Menaces et Surfaces d'Exposition

1. **Surface 1 : Le Dépôt Git & Historique**
   - *Risque* : Commit accidentel de fichiers `.env`, clés de service, jetons bot ou tokens dans git.
   - *Parade* :
     - Chiffrement GitOps obligatoire avant tout commit (`*.enc.json`).
     - Scanner de fuites pré-commit et CI (`aphrody-infra secrets audit`) détectant les motifs de clés (OVH, Discord, GitHub, AWS, clés privées SSH/RSA, JWT).
     - Règle stricte dans `.gitignore`.

2. **Surface 2 : Le Disque Hôte (VPS de Production)**
   - *Risque* : Fichiers `.env` lisibles par d'autres utilisateurs locaux ou processus non privilégiés.
   - *Parade* :
     - Permissions octales strictes `0400` / `0600` restreintes à l'utilisateur de service (`ubuntu:ubuntu` ou `root:root`).
     - Support des directives systemd `LoadCredential=` et `EnvironmentFile=` protégées par `ProtectSystem=strict` et `ProtectHome=read-only`.

3. **Surface 3 : La Mémoire du Processus (In-Memory)**
   - *Risque* : Fuite des secrets dans les logs, traces d'erreurs, panic dumps ou dumps mémoire.
   - *Parade* :
     - Wrapper `SecretString` avec effacement mémoire sécurisé (`zeroize`) à la désallocation.
     - Implémentation de `Debug` et `Display` masquant systématiquement la valeur (`***REDACTED***`).

4. **Surface 4 : L'Exécution & Invariants (Contrat Typé)**
   - *Risque* : Démarrage d'un service en production avec une variable manquante provoquant des pannes silencieuses.
   - *Parade* :
     - Contrat de schéma déclaratif (`tools/config/secrets-contract.json`).
     - Commande `aphrody-infra secrets check` validant la présence et le format des variables requises **sans jamais afficher ni enregistrer les valeurs**.

---

## 3. Architecture Retenue pour Aphrody

Aphrody adopte une approche souveraine en 4 piliers intégrés directement dans `aphrody-infra` (en Rust et en Bun) :

```
┌─────────────────────────────────────────────────────────────┐
│                 Contrat : secrets-contract.json             │
│        (Déclaration typée des variables par service)        │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│  Chiffrement GitOps au repos│ │    Scanner Anti-Fuites      │
│   (SOPS/Age envelope JSON)  │ │   (Entropy & Pattern Audit) │
│ - Clés lisibles (git diff)  │ │ - Détection clés API        │
│ - Valeurs chiffrées AEAD    │ │ - Contrôle .gitignore       │
└──────────────┬──────────────┘ └─────────────────────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Moteur In-Process      │
│   (crates/infra/infra)     │
│ - SecretString (Zeroize)    │
│ - Rendu sécurisé (chmod 400)│
│ - systemd LoadCredential    │
└─────────────────────────────┘
```

### Format d'Enveloppe Chiffrée (`.enc.json`)
L'enveloppe chiffrée préserve la structure hiérarchique JSON :
```json
{
  "version": 1,
  "service": "example-api",
  "encrypted_at": "2026-09-25T00:00:00Z",
  "crypto": {
    "algorithm": "AES-256-GCM",
    "kdf": "PBKDF2-HMAC-SHA256",
    "iterations": 100000,
    "salt": "<base64_salt>"
  },
  "data": {
    "DATABASE_URL": "ENC[AES256_GCM,data:...,iv:...,tag:...]",
    "JWT_SECRET": "ENC[AES256_GCM,data:...,iv:...,tag:...]",
    "DISCORD_CLIENT_SECRET": "ENC[AES256_GCM,data:...,iv:...,tag:...]"
  }
}
```
Ce format permet à Git de générer des diffs lisibles sur les clés ajoutées, modifiées ou supprimées, tout en rendant impossible la lecture des données chiffrées sans la clé d'autorité.

---

## 4. Commandes CLI

```bash
# Vérification de l'intégrité et scan anti-fuites
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- secrets audit

# Validation de présence des secrets déclarés dans le contrat
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- secrets check --service example-api

# Chiffrement d'un fichier de configuration
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- secrets encrypt --in .env.production --out config/secrets/api.enc.json

# Déchiffrement contrôlé
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- secrets decrypt --in config/secrets/api.enc.json

# Rendu sécurisé pour systemd avec permissions 0400
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- secrets render --service example-api --out /etc/aphrody/example-api.env --apply
```
