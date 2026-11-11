# Safe Mandate

**Autonomous purchasing. Human-controlled money.**

Safe Mandate enforces buyer-defined rules over purchase proposals. The agent proposes; the deterministic policy engine evaluates; a nominated guardian approves valid exceptions; the payment provider handles authorization, capture, and void after a later integration. No PayPal integration or simulated payment result exists in this phase.

## Roles and mandate

- **Buyer** owns the purchasing mandate and transaction.
- **Agent** submits structured proposals for deterministic evaluation.
- **Guardian** reviews a valid policy exception tied to one transaction and proposal version.

Mandates include an ID, integer maximum amount in currency minor units, currency, categories, meetup requirements, expiration, guardian ID, and risk threshold. The supported currency allowlist and each minor-unit exponent are in `server/src/domain/mandate/currencies.js`; INR uses 2, JPY 0, and KWD 3. No conversion to or from decimal amounts occurs in the domain.

The policy engine returns `READY_FOR_PAYMENT`, `NEEDS_GUARDIAN`, `BLOCKED`, or `EXPIRED`. Malformed proposals, invalid financial values, unsupported currencies, and currency mismatches fail closed. A direct payment path requires stored `READY_FOR_PAYMENT` evidence from the engine for the exact mandate and proposal. The exception path requires `NEEDS_GUARDIAN` evidence, guardian approval, `GUARDIAN_APPROVED`, and then `READY_FOR_PAYMENT`.

Meetup time remains a local `HH:mm` value with a matching IANA timezone. The model does not yet contain a complete meetup date and local datetime, so the domain cannot apply date-specific daylight-saving conversion or prove that a meetup is in the future. Its window comparison is a deterministic local wall-clock comparison.

## Transaction aggregate and events

Transactions are created only by `createTransaction`. It returns a deeply frozen snapshot backed by private in-process aggregate state. `transitionTransaction` accepts only factory-issued current snapshots, checks the internal version and transition history, and returns a new frozen snapshot. Callers cannot choose an initial state or modify proposal, mandate, approval, state, or audit data. Transactions also bind explicit buyer identity and the proposal's seller identity; the identities must differ.

Every event requires a unique event ID and expected transaction version. Duplicate IDs, altered reuse of an ID, stale snapshots, and competing events from one version are rejected. A successful event increments the version and appends one audit event. Provider state advances only after a trusted adapter reports a provider result. In-memory version checks serialize transitions within one Node.js process only. Phase 2 persistence must use atomic database compare-and-set/version checks and provider-event idempotency across server instances.

## Guardian approval and trust boundaries

Approval records bind transaction ID, proposal ID, mandate ID, proposal version, canonical proposal fingerprint, guardian ID, decision, and timestamp. The proposal and approval records are immutable within the process; a new proposal requires a new transaction and evaluation. An unkeyed fingerprint is an identifier for the proposal contents, not authentication or tamper protection against a caller controlling the process.

The domain checks actor role and identity against stored buyer, seller, and nominated guardian IDs, but a role string is not proof of identity. Before any real integration:

- The **application layer authenticates users** and only trusted application services submit authenticated domain events.
- The **guardian approval endpoint verifies a signed, proposal-specific approval token** and authenticates the nominated guardian.
- The **PayPal adapter verifies webhook signatures and retrieves authoritative payment status** before submitting provider events.

These application, token-signing, and provider-verification protections are not implemented here. The domain does not pretend to authenticate external identities or PayPal messages.

## Audit limitations

Returned audit events and collections are deeply immutable in memory. Each records event ID, transaction ID, previous and next states, event type, actor identity and role, timestamp, reason, and metadata. Rejected transitions do not append successful-transition events. This is not durable, cryptographically secured, tamper-resistant audit storage; persistence and integrity controls remain future work.

## Frontend and localization preview

The `client/` directory contains the mobile-first React + Vite installable PWA preview. Its centralized i18next configuration loads separate English, Hindi, and Marathi JSON catalogs from `client/src/locales/`. The language selector is available in the onboarding header and application navigation/profile settings; the selection persists in browser local storage. New languages can be added by providing a catalog and registering its locale in the centralized configuration.

Interface copy, statuses, notifications, charts, and demo summaries use translation keys with English fallback. Currency, number, and date presentation uses `Intl.NumberFormat` and `Intl.DateTimeFormat`. Manrope and Noto Sans Devanagari are bundled for Latin and Devanagari text. Product names, seller names, IDs, currency codes, and canonical backend state values remain unchanged. Language switching only affects presentation; it does not translate or mutate transaction data. The sample agent text is localized demo content; no AI model is connected.

The PWA offline worker caches only its offline document and static icons. It does not cache authentication, guardian approval, or payment data; live transaction and guardian actions require a verified online backend response. The current frontend is a local illustrative preview and does not authorize, capture, or void payments.

## Technology and status

The backend uses Node.js, plain JavaScript ES modules, Express 5, and Node's built-in test runner. The frontend uses React, Vite, i18next, and react-i18next. The Express API currently provides health, mandate-validation, and deterministic policy-evaluation endpoints. It has no authentication, persistent storage, AI agent, scraping, notifications, or PayPal integration. This is a new project started after October 1, 2026; project start date: **November 9, 2026**.

## Backend development server

From `server/`, run `npm run dev` to start the API on `http://127.0.0.1:3001` by default. Set `PORT` or `HOST` to change the bind settings, and set comma-separated `FRONTEND_ORIGINS` to customize development CORS. The default Vite origins are `http://127.0.0.1:5173` and `http://localhost:5173`. Vite proxies `/api` to `SAFE_MANDATE_API_ORIGIN`, which defaults to `http://127.0.0.1:3001`; the frontend API helper supports an optional `VITE_API_ORIGIN` override.

Available endpoints are `GET /api/health`, `POST /api/mandates/validate`, and `POST /api/policy/evaluate`. Policy evaluation accepts a caller-supplied proposal and mandate and returns the existing deterministic result marked `evaluationOnly: true` and `authorizationGranted: false`; the result is advisory and does not create a transaction or payment order. These inputs are not authenticated or loaded from authoritative user records. Transaction transitions are deliberately not exposed over HTTP because authenticated event submission and trusted service boundaries are not implemented.

## Remaining requirements before PayPal integration

Implement authenticated application boundaries, signed guardian approval verification, verified PayPal webhook/API results, durable audit persistence, atomic database version checks, and cross-instance idempotency. Then complete integration-specific security review and sandbox tests. The Express foundation is in place; PayPal integration has not started.

## Run tests

```powershell
Set-Location .\server
npm test
```

Frontend localization tests and production build:

```powershell
Set-Location .\client
npm test
npm run build
```
