# Local AI, voice and pet integration

Locally Uncensored (LU) owns the local model gateway; its Local API can expose
running models on loopback with a bearer token. OpenPets can use an
`openai-compatible-text` provider profile pointing to that gateway's `/v1`
base URL. Configure the token in OpenPets' own credential store, not in a URL,
log, or repository file. Select the intended running model explicitly. A
healthy profile requires both the gateway and that model; this setup does not
start either one.

Voicebox's OpenAI-compatible `POST /v1/audio/speech` accepts `tts-1` and a
Voicebox profile name or ID. In LU's External HTTP speech settings, enter the
local endpoint and either enter an existing profile name or enable **Use server
default voice (Voicebox)**. The latter omits `voice` so Voicebox resolves its
own selected default. Existing LU installations retain their previous `alloy`
default unless this option is explicitly enabled. OpenPets' separate
`openai-compatible-speech` profile can target the same server with a configured
Voicebox profile; it owns its own speech playback and voice settings.

Neither application launches Voicebox or downloads voice models implicitly.
Voicebox must be installed and started separately, with a usable model and
profile. OpenPets' private local IPC, lease and speech validation remain owned
by OpenPets; no chat, transcript or private file is forwarded to a pet by this
integration. Requests are local only when each selected endpoint is loopback;
remote endpoints transmit their inputs to that server.

This is source integration, not end-to-end qualification. Verify with a
user-selected test profile and a non-sensitive utterance, confirm both local
services are reachable, and test failure behavior before enabling automatic
read-aloud. The source contract inspected was Voicebox upstream commit
`8af7efe62fab8d33e2a5dfbedabaa45f68a5184f`:
[`backend/routes/openai_compat.py`](https://github.com/jamiepine/voicebox/blob/8af7efe62fab8d33e2a5dfbedabaa45f68a5184f/backend/routes/openai_compat.py).
Voicebox models and sample voices retain their own licenses.
