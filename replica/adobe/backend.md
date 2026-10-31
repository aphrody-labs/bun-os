# Aphrody Craft backend integration status

Status: **not implemented**. The supplied Adobe endpoint is not a documented Craft backend API. This file records the official integration boundary and the work required before a real Adobe capability can be built.

## Decision on the supplied MCP endpoint

The URL `https://adobe-creativity.adobe.io/mcp` belongs to Adobe's “Adobe for Creativity” MCP connector. Adobe's official getting-started page says users connect it in Claude (Claude web/Desktop or Cowork) and then optionally sign into Adobe for higher limits, Creative Cloud storage and cross-session continuity. The docs do not publish a third-party Craft OAuth registration flow, server contract or supported API for invoking this connector from Bun OS. Therefore:

- Do not call or proxy this endpoint from Craft backend code.
- Do not copy its MCP tool schemas or relay Claude/Adobe session tokens.
- Do not treat “about 50 tools” in the marketing page as an API contract.
- If the user wants a Claude workflow, the user should install the official connector in their own Claude account. That workflow stays outside Craft and its Drive authorization model.

Primary sources: [Adobe for Creativity](https://developer.adobe.com/adobe-for-creativity/), [official setup instructions](https://developer.adobe.com/adobe-for-creativity/getting-started/).

## Supported Adobe integration options

| option | use | auth and owner | status |
| --- | --- | --- | --- |
| Adobe Express Embed SDK v4 | Embed Adobe Express editing UI in a registered Aphrody host | User's own registered Adobe app; follow SDK authentication and Adobe production review requirements | Candidate only; requires product scope, Adobe app registration, and confirmation that embedding fits the Craft UI/legal terms |
| Adobe Express API | Supported Express operations such as document and asset workflows | OAuth 2.0; API requests require Bearer token and `X-API-KEY`. User-based OAuth is available; server-to-server is a different organization-scoped model | Candidate only; choose least-privilege scopes and user/org ownership before coding |
| Adobe Firefly Services | Explicit generative image/media actions owned by a Craft workflow | Adobe Developer Console API project; OAuth token plus client ID/API key, with client secret kept server-side. Product profile/access requirements apply | Candidate only; feature-specific access, terms, quota, cost and content handling need approval from the account owner |

Official references: [Express Embed SDK v4](https://developer.adobe.com/express/embed-sdk/docs/v4/), [Express API authentication](https://developer.adobe.com/firefly-services/docs/express-api/getting-started/), [Firefly Services authentication](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/), [Firefly credentials guide](https://developer.adobe.com/firefly-services/docs/guides/get-started).

Express Embed/Express API and Firefly Services do not provide an automatic drop-in replacement for the Adobe Creativity MCP's broad set of tools. Each feature needs a named, documented API and explicit UI/product behavior.

## Existing Aphrody backend ownership

- **Identity:** continue to authenticate the Aphrody user/org with Aphrody Identity. Never exchange Aphrody tokens for Adobe tokens.
- **Drive:** the user picks an input from Drive and grants a scoped file/revision reference. Save generated output through the existing Drive writer after authorization, size, content-type and revision checks.
- **Provider credentials:** only server-side provider adapters may see Adobe client secrets or server tokens. Browser Craft apps receive short-lived scoped references, never broad Adobe credentials.
- **Persistence:** no new SQL tables are justified yet. Preserve source assets and outputs as separate Drive objects unless Drive's existing revision/import contract specifies otherwise. Any future job metadata must use its existing job owner.
- **Async generation:** if a selected Adobe API is asynchronous, store its job ID and owner through the existing job/persistence owner, poll with bounded retries, support cancellation where available, and write completed results through Drive. Do not claim completion before the output is persisted.
- **Billing:** not implemented. Adobe API entitlement, quota and charges are separate from Aphrody; no subscription or paywall is inferred from the MCP product page.
- **Email/webhooks:** none required by the current candidate integration. Do not add providers or callbacks without a documented use case.

## API and data plan

No Aphrody HTTP routes, webhooks, migrations or background jobs are added in this checkpoint. Before implementation, add a per-capability interface to the architecture with:

| item | required definition |
| --- | --- |
| provider action | specific Express/Firefly public API operation and supported file formats |
| identity model | user OAuth or organization server-to-server; who owns the Adobe asset and can revoke access |
| scopes | minimum scopes from that operation's official docs; no broad MCP scope |
| input/output | validated MIME, maximum bytes, prompt/options, result URL expiry and Drive write behavior |
| async job | state machine, idempotency key, polling/backoff/cancel, timeout and dead-letter behavior if applicable |
| errors | provider denial, quota, rate-limit, safety rejection, timeout, lost auth and Drive revision conflict |
| privacy | data sent to Adobe, retention, region, content restrictions, disclosure and deletion path |
| release | Adobe app registration/review, credential rotation, usage limits and production approval |

## Credential template plan

No `.env.example` variables are added yet: no supported Adobe API operation or credential type has been selected, and the supplied MCP URL alone does not authorize a custom backend client. When an API is selected, add only the exact variable names it requires, with empty values and no secrets, and wire them only into the server-side owner. Never commit `.env.local`, tokens, client secrets, or user credentials.

## Security and delivery checklist

- [x] The supplied endpoint is treated as a Claude connector, not as an undocumented backend API.
- [x] Existing Identity and Drive owners remain authoritative; no duplicate auth/file model is proposed.
- [x] No Adobe keys, OAuth tokens, account access or private API calls were used.
- [x] No database tables, endpoints, dependencies, webhooks, billing or email providers were added.
- [ ] Choose the exact public Adobe feature (Express Embed, Express API, or Firefly Services) and obtain the account owner's approval for its data, terms and costs.
- [ ] Account owner registers the Adobe Developer Console app / product profile and supplies credentials through the protected deployment secret store, if the selected flow requires them.
- [ ] Implement server-side OAuth/token handling for the chosen public API and least-privilege authorization on every request.
- [ ] Validate every input/output MIME type, byte limit, user scope, job state and Drive revision; rate-limit and use bounded retries.
- [ ] Add integration tests using Adobe-approved development credentials/sandbox and verify a second Aphrody user cannot read or save another user's assets.
- [ ] Document Adobe as a data processor, usage/retention and deletion behavior before public release.
- [ ] Run dependency and source/license review before adding any Adobe SDK; prefer Bun-native `fetch` with documented REST APIs when that avoids an unnecessary runtime dependency.

The existing Creative Cloud catalog and the MCP connector's marketing tool count are not evidence that an Adobe API feature is implemented or entitled in Craft. The 13 Craft apps in the current build remain Aphrody-owned editors; Adobe services should appear as explicit optional integrations only after a supported endpoint and access policy are selected.
