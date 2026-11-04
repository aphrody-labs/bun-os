// SPDX-License-Identifier: Apache-2.0
/**
 * Bilingual Internationalization (English & French) dictionary for Bun OS authentication,
 * passkey prompts, multi-account presence, and UI labels.
 */

import type { AuthLanguage } from "./types.ts";

export const AUTH_TRANSLATIONS = {
  en: {
    // Roles & Presence
    roleOwner: "Sovereign Owner",
    roleAdmin: "Administrator",
    roleDeveloper: "Developer",
    roleGuest: "Guest Session",
    multiAccountTitle: "Active Accounts",
    switchAccount: "Switch Account",
    addAccount: "Add Account",
    signOut: "Sign Out",
    signedInAs: "Signed in as",
    ownerVerified: "Owner Identity Verified",
    ownerUnverified: "Unverified Identity",
    localSession: "Sovereign Local Session",

    // Passkeys & WebAuthn
    passkey: "Passkey",
    passkeys: "Passkeys",
    signInWithPasskey: "Sign in with Passkey",
    registerPasskey: "Register New Passkey",
    passkeyPrompt: "Touch your security key or use biometric verification (Windows Hello / Touch ID)",
    passkeySuccess: "Passkey authenticated successfully",
    passkeyRegistered: "Passkey registered securely on device",
    passkeyNoneRegistered: "No passkeys registered for this account",
    passkeyError: "Passkey verification failed or cancelled",
    passkeyNotSupported: "WebAuthn / Passkeys not supported in this environment",

    // Search & Spotlight
    searchPlaceholder: "Search local files, apps, or type a query...",
    filterAll: "All",
    filterFiles: "Files",
    filterApps: "Apps",
    filterCalc: "Calc",
    noResults: "No results found for query",
    indexActive: "Local FTS5 index active",
    indexing: "Indexing filesystem...",

    // Actions & Tools
    open: "Open",
    navigate: "Navigate",
    dismiss: "Dismiss",
    inspectRegion: "Inspect Screen Region",
    askAi: "Ask AI",
    copyPixels: "Copy Pixels",
    cancel: "Cancel",
    settings: "Settings & Storage",
    copilotKey: "Hardware Copilot Key Provider",
    copilotKeyDesc: "Intercept the Windows 11 Copilot key to open Spotcraft",
    localFts: "Local Files SQLite FTS5 Indexing",
    localFtsDesc: "Index user folders in real-time with zero cloud uploads",
    indexedDirs: "Indexed Directories",
    managePaths: "Manage Paths",

    // Aria annotations
    ariaSearchInput: "Spotlight search input",
    ariaResultsList: "Search results list",
    ariaAccountMenu: "User account and session presence menu",
    ariaLangToggle: "Switch language between English and French",
    ariaPasskeyButton: "Authenticate with biometric or hardware passkey",
    ariaFilterChip: "Filter results by category",
  },
  fr: {
    // Roles & Presence
    roleOwner: "Propriétaire Souverain",
    roleAdmin: "Administrateur",
    roleDeveloper: "Développeur",
    roleGuest: "Session Invité",
    multiAccountTitle: "Comptes Actifs",
    switchAccount: "Changer de compte",
    addAccount: "Ajouter un compte",
    signOut: "Se déconnecter",
    signedInAs: "Connecté en tant que",
    ownerVerified: "Identité Propriétaire Vérifiée",
    ownerUnverified: "Identité non vérifiée",
    localSession: "Session Locale Souveraine",

    // Passkeys & WebAuthn
    passkey: "Clé d'accès (Passkey)",
    passkeys: "Clés d'accès",
    signInWithPasskey: "Connexion avec Clé d'accès (Passkey)",
    registerPasskey: "Enregistrer une nouvelle clé d'accès",
    passkeyPrompt: "Touchez votre clé de sécurité ou utilisez la biométrie (Windows Hello / Touch ID)",
    passkeySuccess: "Authentification par clé d'accès réussie",
    passkeyRegistered: "Clé d'accès enregistrée sur cet appareil",
    passkeyNoneRegistered: "Aucune clé d'accès enregistrée pour ce compte",
    passkeyError: "Échec ou annulation de l'authentification passkey",
    passkeyNotSupported: "WebAuthn / Passkeys non pris en charge dans cet environnement",

    // Search & Spotlight
    searchPlaceholder: "Rechercher fichiers locaux, applications, calculs...",
    filterAll: "Tous",
    filterFiles: "Fichiers",
    filterApps: "Applications",
    filterCalc: "Calcul",
    noResults: "Aucun résultat trouvé pour cette requête",
    indexActive: "Index local SQLite FTS5 actif",
    indexing: "Indexation du système de fichiers...",

    // Actions & Tools
    open: "Ouvrir",
    navigate: "Naviguer",
    dismiss: "Fermer",
    inspectRegion: "Capturer une région d'écran",
    askAi: "Demander à l'IA",
    copyPixels: "Copier les pixels",
    cancel: "Annuler",
    settings: "Configuration & Stockage",
    copilotKey: "Intercepteur Touche Copilot Matériel",
    copilotKeyDesc: "Intercepte la touche Windows 11 Copilot pour ouvrir Spotcraft",
    localFts: "Indexation Locale SQLite FTS5",
    localFtsDesc: "Indexe les dossiers utilisateur en temps réel sans transfert distant",
    indexedDirs: "Dossiers Indexés",
    managePaths: "Gérer les chemins",

    // Aria annotations
    ariaSearchInput: "Champ de recherche Spotlight souverain",
    ariaResultsList: "Liste des résultats de recherche",
    ariaAccountMenu: "Menu du compte utilisateur et présence de session",
    ariaLangToggle: "Basculer la langue entre Français et Anglais",
    ariaPasskeyButton: "S'authentifier avec une clé de sécurité biométrique ou matérielle",
    ariaFilterChip: "Filtrer les résultats par catégorie",
  },
} as const;

export type TranslationKey = keyof (typeof AUTH_TRANSLATIONS)["en"];

export function getTranslation(key: TranslationKey, lang: AuthLanguage = "en"): string {
  const dict = AUTH_TRANSLATIONS[lang] || AUTH_TRANSLATIONS.en;
  return dict[key] || AUTH_TRANSLATIONS.en[key] || key;
}

export const t = getTranslation;
