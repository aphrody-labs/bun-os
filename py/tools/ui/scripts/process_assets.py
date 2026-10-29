#!/usr/bin/env python3
"""
Process and catalog UI captures for Aphrody UI design system.
Analyzes screenshots from late-2026 agent desktop apps (Google Desktop, Codex, Claude, Antigravity),
standardizes filenames, crops key UI components, and builds manifest.json.
"""

import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

ASSETS_DIR = str(Path(__file__).resolve().parents[1] / "assets")
CROPS_DIR = os.path.join(ASSETS_DIR, "crops")
MANIFEST_PATH = os.path.join(ASSETS_DIR, "manifest.json")

os.makedirs(CROPS_DIR, exist_ok=True)

ITEMS = [
    {
        "original_filename": "Capture d'écran 2026-09-26 003305.png",
        "standardized_filename": "google-desktop-spotlight-bar.png",
        "app_name": "Google App Desktop",
        "screen_name": "Floating Assistant Spotlight Bar",
        "component": "Floating Spotlight Assistant Bar / Search Capsule (Alt + Space)",
        "category": "floating_assistant",
        "description": "Barre d'assistance et de recherche IA flottante minimaliste de style Google Desktop. Déclenchée globalement sous Windows via le raccourci Alt + Space. Présente une capsule centrale translucide aux angles arrondis (border-radius 32dp), le logo Google coloré, l'avatar utilisateur, un champ d'entrée multimodal ('Posez une question') avec pièces jointes (+), partage d'écran et intégration Google Lens.",
        "ux_ui_highlights": [
            "Capsule flottante frameless (borderless) avec élévation d'ombre douce sur le bureau",
            "Indicateur clair de raccourci global 'Alt + Space' sous forme de badge pill intégré au header",
            "Sous-capsule de saisie avec micro-interactions pour pièces jointes (+), capture de fenêtre/écran et Google Lens",
            "Disposition horizontale compacte (~1266x450px) optimisée pour ne jamais encombrer l'espace de travail principal",
            "Icônes d'action contextuelles discrètes réduisant la charge cognitive (zéro distraction, zéro slop)"
        ],
        "crops": [
            {
                "filename": "crop_composer_google_spotlight.png",
                "box": (0, 0, 1266, 450),
                "category": "composer",
                "label": "Barre flottante complète Google Spotlight avec logo, Alt+Space, saisie et boutons multimodaux"
            }
        ]
    },
    {
        "original_filename": "gemini-account-menu.png",
        "standardized_filename": "gemini-account-menu.png",
        "app_name": "Google Gemini in Chrome",
        "screen_name": "Chat with account menu open",
        "component": "Chat sidebar, greeting, composer and anchored account menu",
        "category": "workspace_chat",
        "description": "Operator-provided Gemini screenshot showing an account menu over the chat sidebar and empty conversation. Personal account details and conversation titles are incidental content, not UI instructions.",
        "ux_ui_highlights": [
            "Account menu is anchored to the sidebar footer",
            "Menu items have clear icons, labels and keyboard-reachable order",
            "The empty chat keeps a prominent greeting and composer"
        ],
        "crops": []
    },
    {
        "original_filename": "gemini-composer-more-uploads.png",
        "standardized_filename": "gemini-composer-more-uploads.png",
        "app_name": "Google Gemini in Chrome",
        "screen_name": "Composer add menu and nested submenu",
        "component": "Anchored composer tool menu with a secondary uploads submenu",
        "category": "composer_menu",
        "description": "Operator-provided Gemini screenshot showing the composer add menu and its More uploads submenu. The desktop screenshot notification is incidental.",
        "ux_ui_highlights": [
            "Add menu opens next to the composer trigger",
            "Related actions are grouped with a divider",
            "Submenu opens beside its parent item without covering the composer"
        ],
        "crops": []
    },
    {
        "original_filename": "gemini-personal-context-edit.png",
        "standardized_filename": "gemini-personal-context-edit.png",
        "app_name": "Google Gemini in Chrome",
        "screen_name": "Personal context edit dialog",
        "component": "Focused multiline context editor over a settings page",
        "category": "settings",
        "description": "Operator-provided Gemini screenshot of a personal-context edit dialog. Visible saved-memory text is incidental user data and does not define Aphrody behavior or instructions.",
        "ux_ui_highlights": [
            "Focused multiline input has a strong visible outline",
            "Submit is unavailable while the input is empty",
            "Editing controls are adjacent to the input"
        ],
        "crops": []
    },
    {
        "original_filename": "google-drive-my-drive-list.png",
        "standardized_filename": "google-drive-my-drive-list.png",
        "app_name": "Google Drive in Chrome",
        "screen_name": "My Drive list view",
        "component": "File list, navigation sidebar, search, filter chips, view toggle and row actions",
        "category": "file_explorer",
        "description": "Operator-provided screenshot of Google Drive's My Drive list view on Windows. It shows a left navigation sidebar, top search field, file-type and metadata filters, list/grid switch, sortable file table and per-row overflow actions.",
        "ux_ui_highlights": [
            "Clear separation between navigation sidebar and file content",
            "Search and filters stay above the file list",
            "Visible list/grid switch and sortable column headers",
            "Rows show file type, name, supported metadata and contextual actions"
        ],
        "crops": []
    },
    {
        "original_filename": "windows-explorer-image-grid.png",
        "standardized_filename": "windows-explorer-image-grid.png",
        "app_name": "Windows 11 File Explorer",
        "screen_name": "Images folder thumbnail grid",
        "component": "Folder navigation, breadcrumb and search, command bar, image thumbnails and selection",
        "category": "file_explorer",
        "description": "Operator-provided Windows File Explorer screenshot of an image folder. It shows a navigation tree, breadcrumb path and folder search, compact command bar, thumbnail grid with wrapped names, visible selection and item count.",
        "ux_ui_highlights": [
            "Breadcrumb path and folder-scoped search above the content",
            "Persistent navigation tree and nearby file commands",
            "Thumbnail grid preserves image recognition and readable filenames",
            "Selected item has a visible outline; item count remains available"
        ],
        "crops": []
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 184943.png",
        "standardized_filename": "codex-desktop-chat-main.png",
        "app_name": "OpenAI Codex Desktop",
        "screen_name": "Main Chat & Project Workspace",
        "component": "3-Column Workspace Layout, Left Navigation Rail, Sessions Sidebar, Chat Canvas, Full-Access Composer",
        "category": "workspace_chat",
        "description": "Espace de travail principal du client desktop OpenAI Codex en thème sombre. Structure en trois colonnes : rail de navigation persistant ultra-étroit à gauche (Home, Historique, Docs, Threads, Debug, Aide), barre latérale rétractable organisant les projets multi-racines ('aphrody-os', 'aphrody-ui') et les sessions récentes, grand canvas de discussion au centre avec bulles utilisateur et assistant, et barre de saisie flottante en bas avec badge d'avertissement 'Accès complet' et sélection du modèle GPT-6 Luna.",
        "ux_ui_highlights": [
            "Rail de navigation ultra-compact (~52px) réservant l'espace horizontal au contenu applicatif",
            "Arborescence hiérarchique Projets / Récents avec indicateurs d'état en direct (badge bleu non-lu sur 'Nettoyer le code mort')",
            "Bulle utilisateur compacte alignée à droite dans un conteneur arrondi anthracite foncé",
            "Réponses de l'agent avec actions rapides au survol : Copier, Thumbs Down, Bifurcation/Branch de thread",
            "Barre de saisie flottante avec badge d'avertissement de sécurité 'Accès complet' (exécution shell/terminal native)",
            "Sélecteur de modèle de frontière '⚡ GPT-6 Luna Minimal' avec accès rapide à la dictée vocale et waveform audio"
        ],
        "crops": [
            {
                "filename": "crop_header_topbar_codex.png",
                "box": (50, 0, 2560, 60),
                "category": "header",
                "label": "Barre de titre Codex avec menus natifs, navigation avant/arrière, titre de session et contrôles de fenêtre"
            },
            {
                "filename": "crop_nav_rail_codex.png",
                "box": (0, 0, 52, 1440),
                "category": "navigation_rail",
                "label": "Rail de navigation ultra-fin Codex avec icônes Accueil, Historique, Docs, Chat, Debug, Aide et Profil"
            },
            {
                "filename": "crop_sidebar_codex_projects_recents.png",
                "box": (50, 0, 420, 1440),
                "category": "sidebar",
                "label": "Barre latérale Projets et Sessions récentes Codex avec badge d'état non-lu"
            },
            {
                "filename": "crop_composer_codex_full_access.png",
                "box": (820, 1190, 2300, 1420),
                "category": "composer",
                "label": "Capsule de saisie Codex complète avec badge 'Accès complet', sélecteur GPT-6 Luna, micro et waveform"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185036.png",
        "standardized_filename": "claude-desktop-chat-user-menu.png",
        "app_name": "Anthropic Claude Desktop",
        "screen_name": "Claude Desktop Workspace & User Account Dropdown",
        "component": "Light Theme Workspace, Workspace Tree, Header with Workspace Pill, Floating Account Menu, Quota Warning Banner",
        "category": "workspace_chat",
        "description": "Vue principale de Claude Desktop en thème clair chaleureux (#FBFBF9). Affiche la barre latérale avec recherche, raccourcis (+ Nouveau, Projets, Artéfacts, Personnaliser) et l'arborescence des dépôts de code ('aphrody', 'aphrody-src', 'nie'). En bas à gauche, le menu profil utilisateur est déployé (Paramètres avec raccourci Ctrl+,, Utilisation, Langue, Réabonnement Max, Clés API). En bas de page, une bannière d'alerte sur le quota hebdomadaire s'affiche au-dessus du champ de prompt avec sélecteur de modèle Opus 5.5 Extra.",
        "ux_ui_highlights": [
            "Palette lumineuse douce et chaleureuse évitant la fatigue oculaire lors des longues sessions de revue de code",
            "Organisation des espaces de travail sous forme d'arborescence de dossiers multi-dépôts (aphrody, aphrody-src, nie) avec boutons '+' et filtre rapides",
            "Pill d'en-tête dynamique indiquant le workspace actif lié à la session en cours ('aphrody-src')",
            "Menu utilisateur flottant complet avec accès direct aux préférences, à la consommation de tokens et aux clés API",
            "Bannière d'alerte proactive d'épuisement de quota hebdomadaire avec CTA 'Mettre à niveau' et bouton de fermeture",
            "Contrôle 'Ignorer les permissions' pour l'exécution fluide et autonome des commandes par l'agent"
        ],
        "crops": [
            {
                "filename": "crop_header_topbar_claude.png",
                "box": (0, 0, 2560, 60),
                "category": "header",
                "label": "En-tête Claude Desktop avec menu session, badge de workspace 'aphrody-src' et actions d'export"
            },
            {
                "filename": "crop_sidebar_claude_workspaces.png",
                "box": (0, 0, 270, 1440),
                "category": "sidebar",
                "label": "Barre latérale Claude Desktop avec recherche, navigation et projets workspace multi-racines"
            },
            {
                "filename": "crop_user_menu_claude.png",
                "box": (5, 930, 260, 1435),
                "category": "menu",
                "label": "Menu volant profil utilisateur Claude avec raccourcis Paramètres (Ctrl+,) et Clés API"
            },
            {
                "filename": "crop_composer_claude_main.png",
                "box": (600, 1200, 2050, 1430),
                "category": "composer",
                "label": "Barre de saisie Claude avec alerte de quota hebdomadaire, 'Ignorer les permissions' et Opus 5.5 Extra"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185046.png",
        "standardized_filename": "claude-desktop-settings-modal.png",
        "app_name": "Anthropic Claude Desktop",
        "screen_name": "Desktop Preferences & Trust Settings Modal",
        "component": "Settings Modal Dialog, Master-Detail Preferences Navigator, Appearance / Trusted Folders / In-App Browser Controls",
        "category": "settings",
        "description": "Boîte de dialogue modale centrée des paramètres de Claude Desktop. Architecture master-detail avec barre de recherche interne et catégorisation exhaustive (Général, Compte, Confidentialité, Facturation, Utilisation, Capacités, Mémoire, Systèmes, Claude Code, Système, Extensions, Développeur, Compétences, Connecteurs, Plugins, Clés API). Volet principal affichant le réglage du thème visuel, la typographie ('Anthropic Sans'), l'atténuation des animations, les 'Dossiers de confiance' pour l'exécution non supervisée, l'isolation locale sur cet ordinateur et le choix du navigateur intégré.",
        "ux_ui_highlights": [
            "Fenêtre modale centrée avec estompage doux (backdrop-blur) de l'arrière-plan de l'application",
            "Navigation latérale scrollable avec recherche instantanée filtrant les options de configuration",
            "Sélecteur de thème à 3 segments iconographiques (Écran/Système, Soleil/Clair, Lune/Sombre)",
            "Bouton segmenté pour la réduction des animations système / fluides",
            "Section de sécurité 'Dossiers de confiance' essentielle pour l'agentic coding autonome (exécution d'outils sans confirmation manuelle répétitive)",
            "Bascule 'Uniquement sur cet ordinateur' pour garantir la souveraineté des données locales et arrêt automatique à la veille",
            "Option 'Navigateur préféré' basculant entre le navigateur web interne (webview) et le navigateur externe par défaut"
        ],
        "crops": [
            {
                "filename": "crop_settings_claude_modal_full.png",
                "box": (560, 150, 2000, 1290),
                "category": "settings_modal",
                "label": "Boîte de dialogue modale complète des paramètres Claude Desktop"
            },
            {
                "filename": "crop_settings_claude_appearance_trust.png",
                "box": (780, 150, 2000, 850),
                "category": "settings_content",
                "label": "Volet Thème, Animations, Dossiers de confiance et Navigateur intégré dans les paramètres Claude"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185056.png",
        "standardized_filename": "claude-desktop-connectors-menu.png",
        "app_name": "Anthropic Claude Desktop",
        "screen_name": "Connectors & Context Integration Menu",
        "component": "Cascading Context Popover Menu, Connector Toggles (Claude Docs, Context7, Claude in Chrome)",
        "category": "context_tools",
        "description": "Menu déroulant à deux niveaux ancré sur le bouton '+' du prompt composer dans Claude Desktop. Premier niveau offrant l'ajout de fichiers/photos (Ctrl+U), de répertoires entiers, les commandes slash, les connecteurs et les plugins. Le sous-menu Connecteurs affiche les options d'exploration et de gestion ainsi que trois commutateurs d'activation directe par session : 'Claude Docs' (activé), 'Context7' (activé) et 'Claude in Chrome' (activé).",
        "ux_ui_highlights": [
            "Affichage en cascade ultra-précis au-dessus du champ d'entrée sans masquer le fil de discussion",
            "Accès immédiat aux sources de documentation fraîches et à jour (Context7) et à la documentation interne",
            "Intégration d'un commutateur 'Claude in Chrome' permettant à l'agent d'inspecter et d'interagir avec les onglets du navigateur",
            "Raccourci clavier explicite (Ctrl+U) pour la saisie rapide de fichiers média",
            "Design net avec bordures subtiles et ombres d'élévation M3"
        ],
        "crops": [
            {
                "filename": "crop_composer_claude_connectors_menu.png",
                "box": (600, 1050, 2050, 1430),
                "category": "composer",
                "label": "Menu contextuel en cascade avec commutateurs Connecteurs (Claude Docs, Context7, Claude in Chrome) et barre de saisie"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185104.png",
        "standardized_filename": "codex-desktop-plugins-menu.png",
        "app_name": "OpenAI Codex Desktop",
        "screen_name": "Codex Actions & Tool Plugins Popover",
        "component": "Action Palette Popover, Mode Toggles (Goal, Plan), Native Tool & MCP Plugins Picker",
        "category": "context_tools",
        "description": "Palette d'actions et de plugins déployée au-dessus de la barre de saisie de Codex Desktop suite à un clic sur '+'. Divisée en deux grandes sections : 'Ajouter' (Fichiers et dossiers, Joindre WindowsTerminal, Objectif pour définir un but autonome à poursuivre, Mode plan pour générer un plan avant exécution, Dessiner pour faire un croquis d'architecture) et 'Plugins' (Data, Context7 pour récupérer la doc à jour, Navigateur pour piloter le browser intégré, Ordinateur pour le Computer Use sous Windows).",
        "ux_ui_highlights": [
            "Ségrégation claire entre les modes de guidage cognitif (Mode plan, Objectif) et les capacités d'outils (Plugins)",
            "Intégration directe de 'Joindre WindowsTerminal' pour rattacher une session de console interactive existante",
            "Chaque élément présente une icône dédiée, un titre en gras et un descriptif en une ligne facilitant le choix",
            "Affichage des plugins de pointe : Computer Use ('Ordinateur - Control Windows apps') et In-app browser ('Navigateur')",
            "Transition fluide ancrée au champ de saisie"
        ],
        "crops": [
            {
                "filename": "crop_composer_codex_plugins_popover.png",
                "box": (820, 580, 2300, 1420),
                "category": "composer",
                "label": "Palette d'actions et de plugins Codex (Mode plan, Objectif, Terminal, Computer Use, Docs) avec saisie"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185110.png",
        "standardized_filename": "codex-desktop-model-selector.png",
        "app_name": "OpenAI Codex Desktop",
        "screen_name": "Model Selection Dropdown Popover",
        "component": "Frontier AI Model Selection Menu (GPT-6 Astra/Sol/Luna, GPT-5.6 series)",
        "category": "model_selection",
        "description": "Menu déroulant vertical de sélection de modèle d'IA de frontière dans Codex Desktop, déployé au-dessus du pill de modèle de la barre de saisie. En-tête indiquant la politique de routage recommandée ('Par défaut : Ensemble de modèles recommandé'). Liste des modèles disponibles : GPT-6 Astra, GPT-6 Sol, GPT-6 Luna (coché par défaut), GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.5. Notification toast Windows Outil Capture d'écran visible dans le coin inférieur droit.",
        "ux_ui_highlights": [
            "Hiérarchie claire entre les familles de modèles (génération 6 vs 5.6 / 5.5)",
            "Sous-variantes de raisonnement spécialisées (Astra pour les tâches vastes, Sol pour la vitesse, Luna pour le code profond, Terra pour l'ancrage)",
            "Indicateur de sélection active sous forme de coche à droite du modèle sélectionné",
            "Densité ergonomique idéale pour un choix rapide sans quitter le fil de saisie",
            "Bordures et arrondis soignés s'intégrant harmonieusement au thème sombre"
        ],
        "crops": [
            {
                "filename": "crop_codex_model_selector_dropdown.png",
                "box": (1640, 700, 2260, 1400),
                "category": "model_selector",
                "label": "Menu déroulant des modèles de frontière Codex (GPT-6 Luna/Sol/Astra, GPT-5.6 Terra/Sol)"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185211.png",
        "standardized_filename": "codex-desktop-settings-theme.png",
        "app_name": "OpenAI Codex Desktop",
        "screen_name": "Codex Theme & Visual Token Customizer View",
        "component": "Theme Customization View, Visual Style Cards (Light/Split/Dark), Hex Color Token Overrides, Font Family Picker",
        "category": "settings",
        "description": "Vue de personnalisation du thème et du style visuel dans les paramètres de Codex Desktop. Affiche une barre latérale de réglages (Personnel : Général, Notifications, Importer, Profil, Thème, Contrôle parental, Mode vocal, Mini compagnons, Raccourcis ; Intégrations : Plugins, Ordinateur, Appshots). Le volet central présente trois vignettes graphiques d'illustration des modes d'affichage (Clair, Système scindé, Sombre sélectionné), un sélecteur de thème prédéfini ('ChatGPT'), des entrées directes de couleurs de tokens en code hexadécimal (Accentuation, Arrière-plan #181818, Avant-plan #FFFFFF) et le choix de la police système (Arial).",
        "ux_ui_highlights": [
            "Aperçus visuels illustrés miniatures de l'interface permettant de prévisualiser l'impact du mode avant sélection",
            "Contrôle granulaire des jetons de couleur de surface (surface-background #181818, on-surface #FFFFFF, accent)",
            "Possibilité d'exporter ou importer un fichier de thème personnalisé via les icônes d'import/export situées à côté du sélecteur",
            "Action 'Réinitialiser aux valeurs par défaut' garantissant la réversibilité instantanée des modifications",
            "Lien 'Avancé >' pour étendre les variables CSS / tokens M3 sous-jacents"
        ],
        "crops": [
            {
                "filename": "crop_settings_codex_theme_page.png",
                "box": (420, 50, 2300, 1250),
                "category": "settings_content",
                "label": "Panneau complet de personnalisation des thèmes Codex avec aperçus de styles et overrides hex"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185218.png",
        "standardized_filename": "codex-desktop-image-studio.png",
        "app_name": "OpenAI Codex Desktop",
        "screen_name": "Image Generation Studio & Visual Template Gallery",
        "component": "Creative Image Studio Canvas, Dedicated Prompt Bar, Filter Chips (Templates / Tendances), Suggestion Gallery Cards Grid",
        "category": "creative_studio",
        "description": "Studio dédié à la génération d'images et aux prompts créatifs dans Codex Desktop, accessible depuis l'icône galerie du rail de navigation gauche. En haut, une barre de prompt dédiée avec le placeholder 'Décrivez une image', bouton d'ajout (+), sélecteur de vitesse de rendu ('Instantané v'), saisie vocale et flèche d'envoi. Deux onglets filtres 'Templates' (actif) et 'Tendances'. Grille de cartes de suggestion visuelles grand format avec coins arrondis : 'Poster' (fleur de pavot Bloom au graphisme percutant), 'Interior design' (salon isométrique moderne en 3D), 'Logo' (emblème vectoriel circulaire de poisson), 'Illustration' (fillette enlacée avec un chat géant).",
        "ux_ui_highlights": [
            "Navigation rail dédiée pour basculer en un clic du mode Code/Chat au mode Studio Créatif Image",
            "Barre de saisie spécialisée avec options adaptées à la génération d'images (mode Instantané / Diffusion avancée)",
            "Cartes de suggestion grand format 'full bleed' avec coins arrondis (border-radius 24dp) et étiquette typographique soignée",
            "Filtre par puces (chips) 'Templates' vs 'Tendances' pour une découverte fluide d'idées de prompts",
            "Mise en page aérée et responsive mettant en valeur les visuels haute fidélité"
        ],
        "crops": [
            {
                "filename": "crop_cards_codex_image_templates_row.png",
                "box": (90, 550, 2480, 1350),
                "category": "suggestion_cards",
                "label": "Rangée complète des 4 cartes de suggestion visuelles (Poster, Interior design, Logo, Illustration)"
            },
            {
                "filename": "crop_card_bloom_poster.png",
                "box": (95, 565, 675, 1340),
                "category": "card_item",
                "label": "Carte de suggestion 'Poster' - Typographie Bloom et pavot rouge vintage"
            },
            {
                "filename": "crop_card_interior_design.png",
                "box": (705, 565, 1280, 1340),
                "category": "card_item",
                "label": "Carte de suggestion 'Interior design' - Pièce à vivre isométrique 3D pastel"
            },
            {
                "filename": "crop_card_logo.png",
                "box": (1315, 565, 1890, 1340),
                "category": "card_item",
                "label": "Carte de suggestion 'Logo' - Emblème circulaire vectoriel bleu marine poisson"
            },
            {
                "filename": "crop_card_illustration.png",
                "box": (1925, 565, 2495, 1340),
                "category": "card_item",
                "label": "Carte de suggestion 'Illustration' - Personnage et chat géant noir et blanc"
            },
            {
                "filename": "crop_composer_codex_image_studio.png",
                "box": (400, 160, 2160, 390),
                "category": "composer",
                "label": "Barre de saisie prompt image Codex avec sélecteur de mode Instantané"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185323.png",
        "standardized_filename": "antigravity-desktop-split-terminal.png",
        "app_name": "Google Antigravity Desktop IDE",
        "screen_name": "Dual-Pane Agent Reasoning & Embedded PowerShell Terminal",
        "component": "Split IDE Layout, Project Explorer, Execution State Loader, Embedded PowerShell Terminal Pane, Sub-Conversations Drawer",
        "category": "ide_workspace",
        "description": "Environnement de bureau Antigravity en mode scindé (dual-pane IDE). À gauche, barre latérale structurée avec '+ New Conversation', 'Conversation History', 'Scheduled Tasks', projets workspace ('aphrody-ui', 'CLI Project') et liste des conversations. La conversation active affiche un indicateur de chargement circulaire 'Working' pendant que l'agent réfléchit sur un problème complexe. À droite, un panneau terminal 'Terminals' est ouvert, hébergeant une session native Windows PowerShell (PS C:\\Users\\<user>>) avec sélecteur de projet, ajout d'onglet (+) et liste des processus/threads associés.",
        "ux_ui_highlights": [
            "Agencement scindé dual-pane combinant agent cognitif au centre et console terminal native à droite",
            "Panneau terminal intégré avec sélection du projet hôte ('Project v') et persistance des shells Windows PowerShell",
            "Indicateur de statut dynamique ('Working' avec spinner circulaire) informant précisément de l'état de réflexion de l'agent",
            "Bouton '▲ Open IDE' dans l'en-tête permettant de basculer instantanément vers l'éditeur de code complet",
            "Bouton d'arrêt d'urgence d'exécution (carré rouge) intégré dans le prompt composer pour stopper un raisonnement ou une commande",
            "Affichage du modèle utilisé en temps réel : 'Gemini 3.8 Flash Low' avec indication du niveau de raisonnement"
        ],
        "crops": [
            {
                "filename": "crop_header_antigravity.png",
                "box": (0, 0, 2560, 65),
                "category": "header",
                "label": "En-tête supérieur Antigravity avec logo chevron, titre de session, bouton Open IDE et contrôles de split"
            },
            {
                "filename": "crop_sidebar_antigravity.png",
                "box": (0, 0, 320, 1440),
                "category": "sidebar",
                "label": "Barre latérale Antigravity avec actions globales, projets et conversations avec spinner de statut"
            },
            {
                "filename": "crop_viewer_terminal_antigravity_pane.png",
                "box": (1710, 65, 2560, 1440),
                "category": "terminal_viewer",
                "label": "Panneau terminal PowerShell intégré avec onglets de projet et tiroir de sous-processus"
            },
            {
                "filename": "crop_composer_antigravity_main.png",
                "box": (380, 1200, 1750, 1430),
                "category": "composer",
                "label": "Barre de saisie Antigravity avec sélecteur Gemini 3.8 Flash Low, micro et bouton stop"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185356.png",
        "standardized_filename": "antigravity-desktop-math-context-menu.png",
        "app_name": "Google Antigravity Desktop IDE",
        "screen_name": "Rich LaTeX Mathematical Rendering & Add Context Menu",
        "component": "Full Canvas View, LaTeX Math Typesetting (Riemann Zeta), Floating Scroll-Down Button, 'Add Context' Popover",
        "category": "math_rendering_context",
        "description": "Vue élargie d'Antigravity après repli du panneau terminal, mettant en avant le rendu mathématique haute fidélité en KaTeX / LaTeX. L'agent répond à la résolution d'une équation complexe en affichant la fonction Zêta de Riemann, la série de Dirichlet $\\zeta(s) = \\sum_{n=1}^{\\infty} \\frac{1}{n^s}$, le produit eulérien sur les nombres premiers et l'équation fonctionnelle symétrique $\\xi(s) = \\xi(1-s)$. Un bouton circulaire flottant permet de scroller directement vers le bas. Au-dessus du bouton '+' du composer, le menu 'Add Context' est ouvert, proposant l'injection de Media, @ Mentions, Actions et Navigateur Browser.",
        "ux_ui_highlights": [
            "Rendu typographique mathématique impeccable de formules complexes (fractions, sommes infinies, lettres grecques, intégrales)",
            "Menu volant 'Add Context' épuré regroupant : Media (images/docs), @ Mentions (fichiers/agents), Actions (outils automatiques), Browser (page web)",
            "Bouton d'action flottant circulaire avec flèche vers le bas pour rattraper le flux de génération temps réel",
            "Titre de session généré automatiquement et mis à jour de manière sémantique : 'Complex Math Problem Solving'",
            "Disposition fluide plein écran offrant une lisibilité maximale pour les démonstrations techniques"
        ],
        "crops": [
            {
                "filename": "crop_viewer_math_latex_antigravity.png",
                "box": (450, 160, 2350, 1080),
                "category": "code_math_viewer",
                "label": "Rendu mathématique LaTeX d'Antigravity démontrant la fonction Zêta et l'équation fonctionnelle symétrique"
            },
            {
                "filename": "crop_composer_antigravity_add_context.png",
                "box": (550, 1000, 2000, 1430),
                "category": "composer",
                "label": "Barre de saisie Antigravity avec popover 'Add Context' (Media, Mentions, Actions, Browser) et saisie"
            }
        ]
    },
    {
        "original_filename": "Capture d'écran 2026-09-26 185431.png",
        "standardized_filename": "antigravity-desktop-settings-mcp.png",
        "app_name": "Google Antigravity Desktop IDE",
        "screen_name": "Antigravity Customizations & MCP Servers Manager",
        "component": "Settings Modal Dialog, Subagent Switches (Global Roles), MCP Server Runtime Health Indicators & Diagnostics",
        "category": "settings_mcp",
        "description": "Boîte de dialogue modale de configuration des personnalisations et des serveurs MCP dans Antigravity. La section supérieure liste les sous-agents globaux spécialisés ('web-verify-enforcer', 'web-x-grok-architect') avec descriptions et commutateurs violets activés. La section 'Installed MCP Servers' propose les boutons d'actualisation, 'Add MCP +' et 'Open MCP Config'. Chaque serveur MCP (aphrody, aphrody_aphrody, chrome-devtools, data-agent-kit, google-drive, microsoft-learn, notebooks, pwsh-microsoft-docs) est accompagné d'un voyant d'état (vert pour fonctionnel, rouge pour indisponible) et d'un message d'erreur de runtime détaillé (ex: binaire introuvable dans %PATH%).",
        "ux_ui_highlights": [
            "Surveillance en direct de l'état de santé (health check) des serveurs MCP avec code couleur intuitif (vert opérationnel, rouge en défaut)",
            "Messages d'erreur de diagnostic explicites (ex: binaire 'aphrody-kernel' ou 'bun' absent du PATH, absence de handler spec)",
            "Gestion des sous-agents autonomes globaux avec commutateurs indépendants et boutons de duplication/suppression",
            "Bouton d'accès direct au fichier de configuration JSON sous-jacent ('Open MCP Config')",
            "Architecture modulaire permettant d'activer, désactiver ou dépanner des outils sans redémarrer l'application"
        ],
        "crops": [
            {
                "filename": "crop_tools_mcp_servers_antigravity_modal.png",
                "box": (340, 90, 2220, 1350),
                "category": "tools_mcp",
                "label": "Panneau de gestion MCP Antigravity avec indicateurs de santé en direct et messages de diagnostic d'erreur"
            },
            {
                "filename": "crop_subagents_toggles_antigravity.png",
                "box": (700, 140, 2200, 430),
                "category": "subagents",
                "label": "Interrupteurs d'activation des sous-agents spécialisés (web-verify-enforcer, web-x-grok-architect)"
            }
        ]
    }
]

def main():
    print(f"Starting asset processing for {len(ITEMS)} items...")
    manifest_entries = []
    crops_summary = []

    for item in ITEMS:
        orig_name = item["original_filename"]
        std_name = item["standardized_filename"]
        orig_path = os.path.join(ASSETS_DIR, orig_name)
        std_path = os.path.join(ASSETS_DIR, std_name)

        if not os.path.exists(orig_path):
            print(f"Warning: source file {orig_path} does not exist!")
            continue

        # 1. Copy to standardized filename
        if os.path.abspath(orig_path) != os.path.abspath(std_path):
            shutil.copy2(orig_path, std_path)
            print(f"Copied: {orig_name} -> {std_name}")

        # 2. Inspect with PIL
        with Image.open(orig_path) as im:
            actual_w, actual_h = im.size
            im_mode = im.mode

            # Generate crops
            generated_crops = []
            for c in item["crops"]:
                c_name = c["filename"]
                box = c["box"]
                c_crop = im.crop(box)
                c_target = os.path.join(CROPS_DIR, c_name)
                c_crop.save(c_target, format="PNG")
                print(f"  Generated crop: {c_name} {c_crop.size} (box={box})")

                crop_entry = {
                    "filename": c_name,
                    "relative_path": f"crops/{c_name}",
                    "dimensions": {"width": c_crop.size[0], "height": c_crop.size[1]},
                    "box": {"x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3]},
                    "category": c["category"],
                    "label": c["label"]
                }
                generated_crops.append(crop_entry)
                crops_summary.append(crop_entry)

            manifest_entry = {
                "original_filename": orig_name,
                "standardized_filename": std_name,
                "relative_path": std_name,
                "app_name": item["app_name"],
                "screen_name": item["screen_name"],
                "component": item["component"],
                "category": item["category"],
                "dimensions": {"width": actual_w, "height": actual_h},
                "color_mode": im_mode,
                "description": item["description"],
                "ux_ui_highlights": item["ux_ui_highlights"],
                "crops": generated_crops
            }
            manifest_entries.append(manifest_entry)

    manifest_data = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Aphrody UI Asset Catalog & UI/UX Benchmark Manifest",
        "version": "1.0.0",
        "updated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "description": "Catalogue des captures d'écran et des découpes de composants UI des applications de référence (Windows File Explorer, Google Drive, Google Gemini, Google Desktop Spotlight, OpenAI Codex Desktop, Anthropic Claude Desktop, Google Antigravity IDE).",
        "total_source_captures": len(manifest_entries),
        "total_crops": len(crops_summary),
        "categories_covered": [
            "Header & navigation rail",
            "Sidebar & sessions list",
            "Prompt composer (barre de saisie)",
            "Cartes de suggestion",
            "Visualiseur de fichiers / code / LaTeX / terminal",
            "Tool execution cards & MCP servers",
            "File explorer list and grid views",
            "Account, composer and settings menus"
        ],
        "items": manifest_entries
    }

    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest_data, f, indent=2, ensure_ascii=False)

    print(f"Wrote manifest to: {MANIFEST_PATH}")
    print(f"Summary: {len(manifest_entries)} source captures processed, {len(crops_summary)} crops created.")

if __name__ == "__main__":
    main()
