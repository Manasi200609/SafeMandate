# Phase 1 backend foundation

Phase 1 adds durable MongoDB persistence and server-verified buyer/seller identities to the existing deterministic mandate and transaction domain. Transaction transitions and audit chain semantics are unchanged. Client-supplied AI scores/evidence are excluded from persisted transaction proposals. In the advisory evaluator, a high score can only add guardian review; it cannot bypass deterministic mandate conditions.

## Persistence schema

| Model (collection) | Key fields | Purpose |
| --- | --- | --- |
| `User` (`users`) | `userId` (unique), `email` (unique, lowercase), `displayName`, `role` (`buyer`\|`seller`\|`guardian`), `accountStatus` (`ACTIVE`\|`SUSPENDED`), `passwordHash` (select: false) | Authenticated application accounts; public registration permits buyer/seller only |
| `GuardianRelationship` (`guardianrelationships`) | `relationshipId` (unique), `buyerId`, `guardianId`, `guardianEmail`, `status`, `createdAt`, `respondedAt` | Buyer-invited relationship with explicit authenticated acceptance |
| `Session` (`sessions`) | `tokenHash` (unique, SHA-256 of random 256-bit token), `userId`, `role`, `expiresAt` (TTL index), `revokedAt` | Server-side bearer session records; plaintext tokens are never stored |
| `Mandate` (`mandates`) | `mandateId` (unique), `buyerId`, `currency`, `expiresAt`, `payload` | Append-only mandate history; newest record per buyer is the current mandate |
| `Transaction` (`transactions`) | `transactionId` (unique), `mandateId`, `buyerId`, `sellerId`, `state`, `version`, `proposal`, `proposalVersion`, `proposalFingerprint`, `policyEvidence`, `guardianApproval`, `handoffConfirmations`, `provider`, `createdAt`, `updatedAt`, embedded `auditLog`, `eventDigests` | Authoritative aggregate; `version` is the compare-and-set token |
| `TransactionAuditEvent` (`transactionauditevents`) | `eventId` (unique), `transactionId`, `version`, `previousState`, `newState`, `eventType`, `actor`, `timestamp`, `reason`, `metadata` | Append-only queryable projection, idempotent by `eventId` |
| `HandoffConfirmation` (`handoffconfirmations`) | unique `{transactionId, party}`, `actorId`, `confirmationId`, `confirmedAt` | Persisted handoff projection |
| `CheckInEvent` (`checkinevents`) | `checkInId` (unique), `transactionId`, `buyerId`, `type`, `stateAtCheckIn`, `note`, `createdAt` | Append-only buyer check-in evidence; does not transition state |
| `PaypalProviderReference` (`paypalproviderreferences`) | `transactionId` (unique), `environment`, `orderId`, `authorizationId`, `captureId`, `voidId`, `lastEventType`, `transactionState`, `updatedAt` | Provider references reported by the domain; no payment mutation occurs in Phase 1 |

The embedded audit log and aggregate state live in one document so a state change and its audit record commit atomically. Audit events are additionally mirrored into `TransactionAuditEvent` for querying; the embedded chain remains authoritative and is re-validated on every load.

## Domain integration

`serializeTransaction(snapshot)` produces a plain storage record and `hydrateTransaction(record)` rebuilds a factory-issued, deeply frozen snapshot. Hydration validates:

- mandate validity through the existing validator,
- proposal fingerprint equality,
- buyer/seller distinctness and the proposal `sellerId` binding,
- a contiguous audit chain whose every transition is in `ALLOWED_TRANSITIONS`,
- `auditLog.length === version`, terminal state equality, and a complete event-digest set.

Anything inconsistent is rejected (`INVALID_PERSISTED_TRANSACTION`) rather than repaired. State changes still go exclusively through `transitionTransaction`; persistence adds a MongoDB `findOneAndUpdate({ transactionId, version: expectedVersion })` compare-and-set, so two writers cannot commit from the same version.

## Authentication and authorization

- Registration accepts only `buyer` or `seller`; there is no guardian, agent, or admin self-registration.
- Passwords are hashed with Node's built-in scrypt (N=16384, r=8, p=1), a random 16-byte salt per password, and constant-time comparison. Minimum length is 12 characters.
- Login returns an opaque 32-byte random bearer token. Only its SHA-256 digest is stored; `Authorization: Bearer <token>` is required for protected routes. Production requires an explicitly configured MongoDB URI. There is no `SESSION_SECRET`; the token's 256 bits of randomness protect its unkeyed digest.
- Sessions expire (default 480 minutes, `SESSION_TTL_MINUTES`) and can be revoked by logout.
- Login and registration are rate-limited by socket IP in each server process. Express proxy trust is disabled; changing `X-Forwarded-For` does not change the client key. Use a shared store before horizontal scaling; this is not distributed rate limiting.
- Suspended accounts cannot log in or use existing sessions. Email ownership is not verified in Phase 1, so accounts are authenticated application identities, not proof of a person's legal identity.
- The server resolves `userId` and `role` from the session and loads the user record on every request. Client-supplied actor IDs, roles, party values, proposal IDs, seller bindings, and confinement of transaction creation to authenticated buyers are all server-enforced.
- Transaction reads and writes are restricted to the buyer or seller recorded on the transaction. Non-participants receive `404` so transaction existence is not disclosed.
- Handoff `party` is derived from the authenticated role; a request body cannot select the other party.
- The domain still verifies actor role and ID against stored buyer, seller, and guardian bindings.

Not implemented: PayPal order/authorization/capture/void endpoints, webhook verification, email verification, or AI-provider integration. Guardian acceptance is an in-app account designation, not independently verified identity or legal guardianship. Auth uses bearer headers rather than cookies, so cookie-based CSRF protection is not applicable. A future browser client should avoid persistent script-readable token storage and consider HTTP-only cookies plus CSRF protection if the session transport changes.

## Endpoints

Public (unchanged): `GET /api/health`, `POST /api/mandates/validate`, `POST /api/policy/evaluate`.

Authentication:

| Method and path | Access | Description |
| --- | --- | --- |
| `POST /api/auth/register` | public | Create a buyer or seller account and receive a session token |
| `POST /api/auth/login` | public | Exchange email and password for a session token |
| `POST /api/auth/logout` | any session | Revoke the current session |
| `GET /api/auth/session` | any session | Return the server-resolved identity |

Mandates and transactions:

| Method and path | Access | Description |
| --- | --- | --- |
| `PUT /api/mandates/current` | buyer | Validate and store a new mandate; the server assigns `mandateId` |
| `GET /api/mandates/current` | buyer | Read the newest stored mandate |
| `POST /api/guardian-relationships` | buyer | Invite an existing account; JSON `{ "guardianEmail": "person@example.test" }` |
| `GET /api/guardian-relationships` | buyer | List the buyer's invitations and acceptance status |
| `POST /api/guardian-relationships/:relationshipId/accept` | invited account | Accept the invitation; identity is matched to the invited account's server-resolved email |
| `POST /api/transactions` | buyer | Create a `PROPOSED` transaction from the stored mandate and a seller account |
| `GET /api/transactions` | participant | List the caller's transactions |
| `GET /api/transactions/:transactionId` | participant | Read aggregate state, proposal, evidence, and audit log |
| `GET /api/transactions/:transactionId/audit` | participant | Read the authoritative audit chain |
| `POST /api/transactions/:transactionId/evaluate` | buyer | Run deterministic policy evaluation once |
| `POST /api/transactions/:transactionId/guardian-approval` | accepted, designated guardian | JSON `{ "expectedVersion": 1, "decision": "approve", "reason": "..." }`; persisted approval/audit, with transaction and proposal binding |
| `POST /api/transactions/:transactionId/handoff-confirmations` | participant | Confirm the caller's own handoff |
| `POST /api/transactions/:transactionId/check-ins` | buyer | Record a buyer check-in during `AUTHORIZED` or `MEETUP_ACTIVE` |
| `GET /api/transactions/:transactionId/check-ins` | participant | List recorded check-ins |
| `GET /api/transactions/:transactionId/payment-reference` | participant | Read provider references (order/authorization/capture/void IDs) |

All authenticated responses set `Cache-Control: no-store`.

### Example requests

Register and log in:

```bash
curl -s -X POST http://127.0.0.1:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"buyer@example.test\",\"password\":\"correct-horse-battery\",\"role\":\"buyer\",\"displayName\":\"Demo Buyer\"}"
```

```json
{
  "user": { "userId": "user_...", "email": "buyer@example.test", "role": "buyer", "displayName": "Demo Buyer" },
  "token": "<opaque session token>",
  "expiresAt": "2026-11-12T06:00:00.000Z"
}
```

Store a mandate (buyer session required):

```bash
curl -s -X PUT http://127.0.0.1:3001/api/mandates/current \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"mandate\":{\"maxAmountMinor\":1500000,\"currency\":\"INR\",\"allowedCategories\":[\"electronics\"],\"meetupRules\":{\"requirePublicPlace\":true,\"daytimeStart\":\"09:00\",\"daytimeEnd\":\"18:00\",\"timeZone\":\"Asia/Kolkata\"},\"expiresAt\":\"2099-12-31T23:59:59Z\",\"guardianId\":\"guardian-demo-1\",\"riskThreshold\":40}}"
```

Create and evaluate a transaction:

```bash
curl -s -X POST http://127.0.0.1:3001/api/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"sellerId\":\"user_seller_id\",\"proposal\":{\"itemName\":\"Used phone\",\"description\":\"Demo phone\",\"category\":\"electronics\",\"amountMinor\":1000000,\"currency\":\"INR\",\"meetupLocation\":\"Public cafe\",\"locationIsPublic\":true,\"proposedLocalMeetupTime\":\"12:30\",\"timeZone\":\"Asia/Kolkata\",\"aiRiskScore\":10,\"riskSignals\":[],\"supportingEvidence\":[]}}"
```

```bash
curl -s -X POST http://127.0.0.1:3001/api/transactions/$TRANSACTION_ID/evaluate \
  -H "Authorization: Bearer $TOKEN"
```

Seller handoff confirmation (seller session required; the party is taken from the session):

```bash
curl -s -X POST http://127.0.0.1:3001/api/transactions/$TRANSACTION_ID/handoff-confirmations \
  -H "Authorization: Bearer $SELLER_TOKEN"
```

Error shape is `{ "error": { "code": "...", "message": "..." } }` with `400`, `401`, `403`, `404`, `409`, `422`, or `500`.

## PayPal Sandbox lifecycle

The backend-only Sandbox transport is wired to authenticated buyer routes. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_RETURN_URL`, and `PAYPAL_CANCEL_URL` in the server environment. `PAYPAL_MERCHANT_ID` identifies the configured single platform Sandbox merchant. The current User model has no seller PayPal recipient field, so this configuration does not implement seller-specific payout; the order is bound to this merchant ID and the service verifies that recipient. Missing configuration fails closed per operation and does not block server startup. Live endpoints are rejected by the transport.

All mutation bodies except reconciliation must contain only `{ "expectedVersion": <transaction version> }`. Amount, currency, payee, intent, and provider identifiers are loaded from persisted transaction/configuration data. The principal must be the authenticated transaction buyer.

| Method and route | Purpose and response |
| --- | --- |
| `POST /api/transactions/:id/paypal/order` | Creates one AUTHORIZE order from the stored proposal; responds `201` with safe operation metadata and `approvalUrl`. |
| `POST /api/transactions/:id/paypal/authorize` | GET-verifies PayPal approval for the stored order before authorizing it; responds with authorization operation metadata. Browser redirects alone do not authorize. |
| `POST /api/transactions/:id/meetup/start` | Buyer starts a meetup after authorization using `{ expectedVersion }`; advances the existing domain event. |
| `POST /api/transactions/:id/check-ins` | Existing buyer check-in operation. |
| `POST /api/transactions/:id/handoff-confirmations` | Existing buyer or seller self-confirmation; party identity is session-derived. |
| `POST /api/transactions/:id/paypal/capture` | Requires active persisted meetup, current mandate/policy, provider-confirmed authorization, post-authorization buyer check-in, both independently authenticated unexpired handoffs, and valid guardian evidence when required. Captures only the stored authorization. |
| `POST /api/transactions/:id/paypal/void` | Voids only a provider-confirmed uncaptured authorization with no capture operation. |
| `POST /api/transactions/:id/paypal/reconcile` | Read-only provider GETs reconcile a persisted unresolved operation; it never retries a mutation. |
| `GET /api/transactions/:id/payment-status` | Returns transaction-bound safe operation summaries and provider references to the buyer. |

Mutation operations are persisted before calls with unique per-transaction operation kinds and stable `PayPal-Request-Id` values. Replays return the prior operation. Timeout, 5xx, or locally uncommitted provider outcomes remain `UNKNOWN`/pending and require reconciliation; no mutation is automatically retried. Provider statuses and amounts are validated before domain transitions. API errors are redacted and raw PayPal payloads/tokens are not returned. No webhook endpoint is enabled because no verified webhook ID/signature flow is configured.

Every payment mutation returns `{ "operation": { "operationId", "kind", "status", "providerResourceId", "providerStatus", "providerTimestamp", "approvalUrl", "amountMinor", "currency", "createdAt", "updatedAt" }, "replayed": <boolean> }`. The approval URL is only populated for order creation. Reconciliation returns `{ transactionId, state, operations, reconciled, providerStatus }`; unresolved outcomes return `unresolved: true` and do not alter the domain state. Operation statuses are `PENDING`, `UNKNOWN`, `COMPLETED`, or `FAILED`. The API uses `400` for invalid payment request fields, `403` for wrong role, `404` for non-owned transactions, `409` for stale/ineligible/domain conflicts, `202` for unresolved provider outcomes, `502` for provider failures, and `503` when Sandbox configuration is missing. `PAYMENT_RECONCILED` is appended to the transaction audit chain only after a provider GET confirms the result.

The state sequence is `READY_FOR_PAYMENT → PAYMENT_PENDING → AUTHORIZED → MEETUP_ACTIVE → CAPTURE_PENDING → CAPTURED`, or `AUTHORIZED/MEETUP_ACTIVE → VOID_PENDING → VOIDED`. Order creation and authorization each validate the currently stored deterministic policy evidence and active mandate. The buyer-started meetup event uses the existing domain transition and requires the current transaction version. No payment operation trusts a callback order ID, amount, currency, state, confirmation flag, or authorization ID from the browser.

Automated lifecycle verification uses an injected fake adapter only; it does not call PayPal. The UI remains demo-backed and must later call the order endpoint, open the returned approval URL, then invoke authorize after the user returns; the return page itself is not evidence of approval. A real Sandbox demonstration still requires configured credentials and merchant ID, buyer/seller Sandbox accounts, and a controlled manual test.

## Verification (Windows PowerShell)

```powershell
Set-Location .\server
npm test
```

The persistence integration test skips unless given a unique dedicated loopback database URI. It rejects Atlas and the configured application database before cleanup. Example:

```powershell
$runId = [guid]::NewGuid().ToString('N')
$env:MONGODB_URI_TEST = "mongodb://127.0.0.1:27017/safe_mandate_phase1_test_$runId"
npm test
```

The integration test requires an explicit unique local test URI and rejects Atlas, non-loopback hosts, and any database that does not match the dedicated test-name pattern. It drops only that disposable test database and never connects using the application's `MONGODB_URI`. If the application URI is present in the test process, it also rejects a matching host and database name.

For an isolated Atlas persistence check, `npm run verify:atlas` loads `server/.env` through Node's `--env-file-if-exists` option. It generates a unique verification database name, refuses non-Atlas hosts, verifies it differs from the configured application database, and cleans only records carrying IDs generated by that run. It never drops a database. The script reports only sanitized status and error categories.

Start the API against the configured `MONGODB_URI` (default `mongodb://127.0.0.1:27017/safe_mandate`):

```powershell
Set-Location .\server
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/safe_mandate'
npm run dev
```

Check persistence across a restart:

```powershell
# Register, save a mandate, create and evaluate a transaction, then restart the API
# and GET /api/transactions/<id> with the same bearer token.
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/health
```

Frontend regression checks remain unchanged:

```powershell
Set-Location .\client
npm test
npm run build
```

## Remaining issues and PayPal dependencies

1. Guardian approval is exposed over HTTP after buyer invitation and invited account acceptance; no email, legal-identity, or guardianship verification is performed.
2. Agent and payment-provider events are internal-only. `POLICY_EVALUATED` is server-triggered by the buyer; PayPal operations are now transaction-bound and server-verified.
3. PayPal webhook signature verification is not implemented or enabled.
4. Seller-specific PayPal recipients/payout are not implemented; the current configuration supports one expected platform Sandbox merchant.
5. Sessions are bearer tokens without refresh rotation or device management. Auth rate limits are process-local and need a shared store before horizontal scaling.
6. Mongo replica-set transactions are not used; a single-document compare-and-set keeps the aggregate atomic. If audit mirroring into `TransactionAuditEvent` fails, the authoritative embedded chain is intact and the projection can be replayed.

## AI Purchase Copilot

`POST /api/ai/assessments` is authenticated and buyer-only. A standalone request accepts `listingText`, optional `conversationText`, and a structured `purchase` (`itemName`, `amountMinor`, `category`, `meetupLocation`, `locationIsPublic`, `proposedLocalMeetupTime`). A saved-transaction request accepts only `transactionId` and optional `conversationText`; listing and payment data are loaded from the owned persisted transaction. Input text is limited to 8,000 characters.

The service evaluates the actual persisted buyer mandate through `evaluateProposal`, separately from the model call. Its output marks policy evaluation as evaluation-only and authorization false. The model receives no account/transaction identifiers or mandate internals; email addresses and phone numbers are redacted before submission. It has no tools and cannot reach payment services. Output is strict-schema validated; every risk finding must quote an exact excerpt present in the original listing or conversation. Invalid evidence or response returns an error rather than an assessment.

The configured adapter uses an OpenAI-compatible `POST {AI_BASE_URL}/chat/completions` request (default base `https://api.openai.com/v1`) with JSON response mode. Configure `AI_API_KEY`, `AI_MODEL`, optional `AI_BASE_URL`, and optional bounded `AI_TIMEOUT_MS` on the server only. The current model is exactly the configured `AI_MODEL`; there is no hardcoded fallback. Tests inject a fake provider and make no external model calls.

`AiAssessmentAudit` stores provider/model, prompt version, assessment outcome, the deterministic policy result, transaction reference when applicable, timestamp, and a SHA-256 input digest. It deliberately does not store raw listing or conversation content. The isolated Atlas verifier inserts, reads back, reconnects, rereads, and cleans only its generated AI audit record ID. Atlas verification remains unconfirmed until that script completes successfully.

The current Agent page provides sign-in, standalone listing analysis, optional saved-transaction analysis, evidence-backed risks, missing information, seller questions, negotiation questions, a buyer-reviewed/copyable draft, and an optional counteroffer. It does not automatically send a seller message or initiate a payment. Session bearer token is held only in component memory. The app has not been verified against a real configured AI model; configure the four environment values and run a manual assessment to verify provider compatibility and model behavior.
