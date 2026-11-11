# Frontend integration notes

## Current status

The client currently runs from illustrative fixtures and browser-local mandate preview data. It has no Express API connection, authentication, guardian approval endpoint, or PayPal integration. Demo labels are not evidence of real identity verification or backend acceptance.

## Required backend integration

The client will need authenticated operations for:

- Loading the current buyer mandate and dashboard data.
- Saving a mandate using validated integer minor units.
- Listing and retrieving transaction aggregates and immutable audit history.
- Submitting structured proposals for server-side policy evaluation.
- Loading a guardian request from a short-lived, proposal-specific token.
- Submitting a guardian decision with server-side identity and token verification.
- Submitting authenticated buyer and seller handoff confirmations.
- Creating a payment order only after server-side eligibility checks.
- Reading provider status and requesting capture/void through trusted server services.

Exact endpoint paths and response shapes must be agreed with the API implementation; this document does not prescribe unimplemented endpoints.

## Guardian trust boundary

The browser must not verify or mint guardian tokens. The backend must authenticate the guardian or verify a signed, short-lived, single-use, proposal-specific approval token, bind the decision to transaction, proposal, mandate, and version, and return the authoritative decision. The current demo preview action is in-memory only and must not be treated as a real approval.

## Payment-state trust boundary

The browser must never infer authorization, capture, or void from a request being sent. The PayPal adapter must verify webhook signatures and retrieve authoritative provider status; the application API returns the server's current transaction state. The frontend should render `PAYMENT_PENDING`, `AUTHORIZED`, `CAPTURE_PENDING`, `CAPTURED`, `VOID_PENDING`, and `VOIDED` only from authenticated backend data.

## Offline and caching requirements

The current service worker caches only `offline.html` and the app icon. It does not cache routes or API responses. Keep sensitive API responses `Cache-Control: no-store`, use fetch `cache: 'no-store'` for sensitive calls, never put tokens in URLs that are recorded or persisted, and do not add authenticated data to precache/runtime cache lists. The app's offline gate must continue to hide transaction and guardian content and state that no operation can be confirmed offline.

Production persistence must also retain the Phase 1.1 aggregate version and event replay protections; browser-side state is not authoritative.
