# Recon map: Googlebook (marketing surface)

Date: 2026-10-29. Method: public sources only (the French marketing page and press coverage). No account, no login, no scraping, no
code or network inspection. Nothing of Google's is reused; this maps functionality and UX patterns for Bun OS (see `docs/GOAL.md`).

## 1. Scope (decided, no human in the loop)

- **App and platform:** Googlebook, a laptop platform announced 2026-05-12 (Acer, ASUS, Dell, HP, Lenovo; shipping "this fall").
  Internal OS name reported as Aluminium OS, an Android-based desktop (Android 17 per the page's footnote 3).
- **Slice:** the user-facing core loop shown on the page: the Gemini-centric shell (pointer, dictation, voice, file understanding),
  phone continuity, the app and game ecosystem, security and unlock. Out of the slice: retail, pricing, offers, accessories.
- **For whom:** the Bun OS project itself, an open implementation of the same experience (wasm line and Arch/Omarchy line).

## 2. Sources

| source | URL | gives |
| --- | --- | --- |
| Marketing page (fr_fr) | https://googlebook.google/intl/fr_fr/ | feature list, hardware claims, footnotes 2-11, app lineup |
| Press: Thurrott | https://www.thurrott.com/?p=335949 | partners, "later this year", Android flavour not explicit in Google's post |
| Press: heise | https://heise.de/-11291469 | Android-based notebooks with Gemini Intelligence |
| Press: The Next Web | https://thenextweb.com/news/google-killed-the-chromebook-its-replacement-turns-your-cursor-into-an-ai-agent | cursor as an AI agent, Chromebook succession |
| Press: Digital Trends | https://www.digitaltrends.com/computing/google-just-announced-a-new-kind-of-laptop-and-it-puts-gemini-everywhere/ | Gemini everywhere |

Press reports disagree on details (Android 16 vs 17, "replaces Chromebook" vs "new premium tier"). The marketing page is the
authority for what is claimed; press is context only. Google's own announcement blog post was not read.

## 3. Screen inventory (marketing page sections, as the product's surfaces)

| ID | surface | how you get there | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Hero and buy | page top | price from 1099 EUR, buy | CTA, price | default |
| S02 | Hardware | nav "Matériel" | 16 GB RAM, 256 GB, 14 h, under 1.29 kg, Intel Core Ultra or Snapdragon X Elite | spec counters, materials, glow bar, G key | default |
| S03 | Pointer shake | nav "Intelligence" | wiggle the pointer to invoke Gemini | cursor, Gemini panel | demo animation |
| S04 | Dictation | same | dictation key, filler words removed, text formatted | dictation key, text field | demo |
| S05 | Voice | same | "Hey Google" conversation, share screen, discuss a document | voice UI, screen share | demo |
| S06 | File descriptions | same | Gemini adds descriptions to downloads, search by content | file manager, search | demo |
| S07 | Phone sync | nav "Meilleurs ensemble" | phone apps on the laptop, handoff, phone files on the laptop | app mirror, handoff prompt, file browser | demo |
| S08 | App and game catalog | nav "Applis et jeux" | Google Play, Photoshop, Lightroom, Canva, CapCut, Notion, Spotify, Netflix, GeForce NOW and others | store, large-screen apps | list |
| S09 | Security | nav "Sécurité" | Titan C chip, fingerprint and face unlock | unlock UI | default |
| S10 | Bonus offer | page bottom | 12 months of Google AI Pro | offer card | default |

States not recorded (empty, error, permission denied, offline, mobile) are unknown: the page only shows the happy path.

## 4. User flows

- F01 Invoke the assistant by shaking the pointer: S03. Edge: a shake mistaken for normal movement; the assistant needs context
  (selection, window).
- F02 Dictate text: press the dictation key, speak, text appears cleaned and formatted: S04. Edge: language availability, 18+ (fn 8).
- F03 Voice conversation: "Hey Google", speak, optionally share the screen: S05. Edge: always-on microphone consent, internet
  required (fn 7).
- F04 Find a download by meaning: S06. Edge: a description can be wrong ("check answers", fn 9).
- F05 Continue a task from the phone: S07, handoff in one gesture. Edge: Android 17 or later required (fn 3).
- F06 Install and run an app or game: S08 (Play Store, GeForce NOW streaming for PC titles). Edge: large-screen optimization
  varies, subscriptions (fn 10).
- F07 Unlock with fingerprint or face: S09.

Happy-path click counts cannot be observed from the marketing page.

## 5. Components

Cursor (shake detection, Gemini mode), Gemini panel, dictation key and text field, voice overlay with screen share, file manager
with AI descriptions and search, phone continuity tray (apps, handoff, files), app store, game launcher with cloud streaming,
unlock sheet, "glow bar" status light (hardware), G key (hardware).

## 6. Inferred data model (low confidence, nothing observed)

- `AssistantSession`: id, trigger (pointer, voice, key), context (selection, window, screen share), model backend, transcript.
- `FileDescription`: file id, generated text, model, created at, source (download). Evidence: S06. Confidence: medium.
- `DeviceLink`: phone id, laptop id, permissions (apps, files, notifications). Evidence: S07. Confidence: medium.
- `AppEntry`: id, source (Play, web, streaming), large-screen support flag. Evidence: fn 10. Confidence: medium.

Everything else is a guess and must not be built from this map.

## 7. Hard parts

Always-on voice with a wake word; a context-aware pointer assistant (needs window and selection introspection across apps); an
on-device or hosted model backend; phone continuity (Android protocol); running Android apps on a desktop; secure element and
biometrics; cloud game streaming.

## 8. What cannot be cloned

Google Play and its catalog, Gemini and Google AI Pro, the Titan C chip, Google trademarks and the "G" key branding, the campaign
assets, partner OEM hardware, GeForce NOW account integration, third-party store listings. Bun OS uses open or user-supplied
equivalents: llama.cpp or a user-keyed hosted API, F-Droid and Flathub, Waydroid, KDE Connect, TPM 2.0 and passkeys.

## 9. Size

Screens 10, flows 7, entities 4 (inferred). Hard parts: pointer assistant, voice, phone sync, Android apps, security. Size: XL at
parity; M for the shell slice already started (pointer shake, backend client and overlay in `apps/webos/src/assistant`).
Next step: `/replica-architect`.
