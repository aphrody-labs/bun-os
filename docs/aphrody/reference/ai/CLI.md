<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody CLI & RustOS 2026 Reference Manual

> **Binaire Principal :** `aphrody.exe` (Rust Native Core 2026)  
> **Chemins d'Accès :** `~/.cargo/bin/aphrody.exe`, `~/.local/bin/aphrody.exe`, `~/bin/aphrody.exe`  
> **Cible :** Windows 11 / 10 26H1 (x86_64), Linux x86_64/aarch64, macOS, WebAssembly.

---

## 1. Vue d'Ensemble & Commandes Aphrody

Le binaire `aphrody` est le point d'entrée unique de l'écosystème Aphrody. Il intègre le moteur d'inférence local, les passerelles multi-agents (A2A, Antigravity, YOLO), le contrôle d'infrastructure VPS, l'ingénierie inverse et la manipulation de structures VFS (Niers).

```bash
# Diagnostic complet de la machine et de l'environnement
aphrody doctor

# Vérification des accélérateurs matériels et profil VRAM
aphrody model accel

# Recommandation automatique de modèles selon le matériel détecté
aphrody model recommend --task ocr
aphrody model recommend --task speech-to-text
aphrody model recommend --task visual-transcription
```

---

## 2. Référentiel des Sous-Commandes Aphrody

### 2.1. `aphrody model` — Cycle de Vie des Modèles IA Embarqués
Gère le catalogue, le téléchargement vérifié par SHA-256 et la résidence VRAM dans `~/.aphrody/models`.

| Commande | Argument / Option | Description & Effet |
|---|---|---|
| `aphrody model accel` | `--json` | Détecte les GPU (RTX 4070), toolkit CUDA (13.3), compute capability et VRAM libre. |
| `aphrody model catalog` | `--task <T>` | Affiche le catalogue immuable avec SHA-256, backend et taille. |
| `aphrody model recommend`| `--task <T>` | Classe les modèles du catalogue selon le profil matériel détecté. |
| `aphrody model pull` | `<model-id>` | Télécharge un modèle avec support de reprise et validation SHA-256. |
| `aphrody model list` | `--json` | Liste tous les modèles et artefacts installés sur le disque. |
| `aphrody model info` | `<path/id>` | Inspecte les en-têtes réels (GGUF, GGML, ONNX, Safetensors). |
| `aphrody model verify` | `<model-id>` | Recalcule le SHA-256 des fichiers installés pour certifier leur intégrité. |
| `aphrody model gc` | `--budget <B>` | Éviction LRU automatique des modèles non utilisés en cas de pression disque. |
| `aphrody model doctor` | — | Détecte les dérives entre le registre `registry.json` et les fichiers sur disque. |

### 2.2. `aphrody agy` — Passerelle Antigravity CLI & Gemini
Forwarde vers le binaire natif `agy.exe` après provisionnement idempotent de `~/.gemini/config/` (MCP, skills YOLO, persona) :
```bash
# Exécution directe via agy
aphrody agy chat "Analyse cette fonction Rust"
# Lancement avec routage SOCKS5 US automatique (contournement géo)
aphrody agy --us-proxy
```

### 2.3. `aphrody vpn` & `aphrody ssh` — Tunnels & Proxy Réseau
Gère la passerelle SOCKS5 Mullvad (`127.0.0.1:1080`) et les tunnels SSH vers les VPS distants :
```bash
# Démarrage / statut / arrêt du tunnel proxy daemon local (127.0.0.1:1080)
aphrody ssh proxy -d
aphrody ssh proxy --status
aphrody ssh proxy --stop

# Basculement de relais géographique (ex: Atlanta, GA, USA)
aphrody ssh proxy --switch us

# Tunnels SSH directs vers les deux VPS
aphrody ssh vps    # Serveur Inazuma & Niers VFS (51.77.147.152)
aphrody ssh dbfr   # Serveur de production (51.255.162.6)
```

### 2.4. `aphrody translate` — Traduction Multilingue Haute Fidélité
Combine le moteur BXC Google Translate et un pont de terminologie (JP -> FR) avec masquage des termes clés :
```bash
aphrody translate "亜風炉照美のヘブンズタイム" --from ja --to fr
```

### 2.5. Autres Passerelles de l'Écosystème
- **`aphrody nie`** : Forward vers le moteur de fichiers virtuels Niers VFS (`nie.exe` / `.g4md`, `.g4mg`, `.g4pkm`).
- **`aphrody bxc`** (aussi `bxc`, `bxc-mcp`) : nom de compatibilité du binaire unique pour l'ancienne application Bun x Chrome ; chaque sous-commande exécute la commande unifiée (`aphrody web ...`, `x`, `google`, `aphrody-mcp`) ou indique son remplaçant (parité).
- **`aphrody n2b`** (aussi `n2b`) : Node 2 Bun, outil d'audit et migration automatique Node.js vers Bun, en processus.
- **`aphrody re`** : Triage et reverse engineering binaire (PE32/PE64/ELF).
- **`aphrody a2a`** : Serveur et client de coordination multi-agents (A2A JSONL/IPC).
- **`aphrody session`** : Serveur applicatif JSON-RPC compatible Codex sur stdin/stdout.

---

## 3. Matrice de la Station de Travail RustOS 2026

Intégration transparente dans les shells **Nushell** (`config.nu`) et **PowerShell** (`$PROFILE`).

| Commande | Remplacement | Outil Rust 2026 | Usage Clé & Exemple |
|---|---|---|---|
| `nu` | `powershell` / `cmd` | **Nushell v0.115.1** | Shell structuré : `ls \| where size > 10MB \| sort-by modified` |
| Prompt | Prompt Windows | **Starship v1.26.0** | Prompt contextuel avec indication git, bun, rustc. |
| `y`, `fm` | Explorer / Ranger | **Yazi v26.5.6** | `y` : explorateur TUI asynchrone ; change de dossier au `q`. |
| `ls`, `l`, `ll`| `dir` / GNU `ls` | **Eza v0.23.5** | `ll` : liste détaillée avec icônes, statuts git, format relatif. |
| `cat`, `type` | `type` / GNU `cat` | **Bat v0.26.1** | `cat main.rs` : coloration syntaxique Material Theme et git diff. |
| `grep`, `rg` | `findstr` / `grep` | **Ripgrep v15.2.0** | `rg "fn parse" crates/` : recherche sur tout le monorepo. |
| `find`, `fd` | GNU `find` | **Fd v10.5.0** | `fd -e rs model` : recherche de fichiers `.rs` contenant `model`. |
| `z` | `cd` | **Zoxide v0.10.0** | `z aph` : saut vers `%USERPROFILE%\aphrody`. |
| `sk` | `fzf` | **Skim v0.16.0** | `sk` : filtre interactif flou sur stdin/stdout. |
| `top`, `btm` | Task Manager / `htop` | **Bottom v0.14.9** | `top` / `btm` : moniteur CPU, GPU RTX 4070, RAM et processus. |
| `ps` | `tasklist` | **Procs v0.14.12** | `ps aphrody` : inspection moderne de processus avec ports d'écoute. |
| `du` | GNU `du` | **Dust v1.2.5** | `du` : graphique de distribution de l'espace disque. |
| `dua` | `ncdu` | **dua-cli v2.44.0** | `dua i` : navigation et nettoyage interactif de dossiers volumineux. |
| Coreutils | GNU coreutils | **uutils v0.11.0** | 70+ utilitaires Linux natifs : `uname -a`, `wc -l`, `sha256sum`. |
| `sg` | `sed` / AST | **Ast-grep v0.45.3** | `sg scan -p 'async fn $F($$$)'` : recherche structurelle AST. |
| `sd` | `sed` regex | **sd v1.0.0** | `sd 'foo' 'bar' file.txt` : substitution de chaîne directe. |
| `d` | `git diff` | **Delta v0.19.2** | `git diff` piped vers Delta : coloration syntaxique côte à côte. |
| `gui` | `lazygit` / `tig` | **GitUI v0.28.1** | `gui` : interface Git interactive rapide au clavier. |
| `jj` | `git` / `hg` | **Jujutsu v0.28.0** | `jj status` : VCS nouvelle génération compatible Git. |
| `hx` | `vim` / `neovim` | **Helix v25.07.1** | `hx src/lib.rs` : éditeur modal moderne avec LSP intégré. |
| `hex` | `hexdump` | **Hexyl v0.17.0** | `hex binary.bin` : visualiseur hexadécimal coloré par type. |
| `tldrp` | `man` pages | **Tealdeer v1.9.0** | `tldrp tar` : exemples de commandes depuis le cache. |
| `bench` | `time` | **Hyperfine v1.20.0** | `bench 'bun test' 'cargo check'` : benchmark statistique comparatif. |
| `ping` | `ping` | **Gping v1.21.0** | `ping 1.1.1.1` : graphique de latence dynamique en terminal. |
| `trip` | `traceroute` | **Trippy v0.12.0** | `trip 8.8.8.8` : diagnostic réseau interactif traceroute/ping. |
| `xh` | `curl` / `httpie` | **xh v0.26.2** | `xh get https://aphrody.com/healthz` : requêtes HTTP ergonomiques. |
| `qsv` | `csvkit` | **qsv v0.135.0** | `qsv stats data.csv` : manipulation de tables CSV. |
| `br` | `tree` | **Broot v1.60.1** | `br` : explorateur d'arborescence interactif. |
| `zellij` | `tmux` | **Zellij v0.45.1** | `zellij` : sessions terminal multi-volets avec WASM. |
| `mise` | `asdf` / `nvm` | **Mise v2026.9.5** | `mise use rust@latest` : gestionnaire d'environnements polyglottes. |
| `watch` | `nodemon` / `entr` | **Watchexec v2.7.2** | `watch -e rs cargo check` : relance automatique sur modification. |
| `numbat` | `bc` / `calc` | **Numbat v1.14.0** | `numbat` : calculs physiques typés (`500 W * 2 hours -> kWh`). |
| `mdcat` | `cat` markdown | **mdcat v2.16.1** | `mdcat README.md` : affichage Markdown riche dans le terminal. |
| `rerun` | — | **Rerun v0.37.2** | `rerun` : visualiseur egui 3D/2D de tenseurs et maillages. |
| `typst` | `pdflatex` | **Typst v0.15.1** | `typst compile doc.typ` : compilation de documents. |
