# @aphrody/google

The Bun OS Google layer on upstream Bun canary: Google Cloud and Gemini (Vertex), Drive and Docs
sync, the Antigravity Gemini services, the edge and fonts proxies, public search and index, and the
`bun:google` builtin of the aphrody-labs/bun fork.

The `@aphrody/google` Bun OS plugin (`./bun-plugin`, preloaded by `@aphrody/bun-os-plugins`)
serves `bun:google` from `src/bun-google.ts`, with the fork's surface: `googleRuntime`,
`createClient` (hardened relative-path REST client), `chromium` and `obscura` (from
`@aphrody/chromium`) and `dns`, plus `adcCredentialProvider` for Application Default Credentials.

```ts
import google from "bun:google"; // with the Bun OS preload; or from "@aphrody/google"

const client = google.createClient({
  baseURL: "https://cloudresourcemanager.googleapis.com/",
  credentialProvider: google.adcCredentialProvider(),
});
const project = await (await client.request("v1/projects/aphrody")).json();
```

| Bin                       | Source                                                                 | Fork origin                                   |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| `bun-google`              | `src/bun-google-cli.ts` (config, authstatus, models, generate, stream) | `packages/bun-google/src/cli.ts`              |
| `bun-google-index-public` | `src/public-index-cli.ts`                                              | `packages/bun-google/src/public-index-cli.ts` |

The Drive and Gemini workspace CLI stays `src/cli.ts`. Types for the specifier are in
`types/google.d.ts`.

## Provenance

`bun:google` comes from aphrody-labs/bun `src/js/bun/google.ts` and
`packages/bun-types/google.d.ts`; `packages/bun-google` (also published as
aphrody-labs/bun-google) is fully merged here (services, credentials, Antigravity, edge proxy,
mirror, OAuth, password store, public index and search), at fork commit
`7c57ac563e12c35be817697c4b5488b0fd64cc09`. Bun's original source is MIT; the bun-google files
are Apache-2.0, like this package.
