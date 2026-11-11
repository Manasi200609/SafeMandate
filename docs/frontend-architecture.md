# Safe Mandate frontend architecture

## Current client structure

The React + Vite application lives in `client/`. The current implementation keeps the original working feature pages in `src/pages/`, shared visuals and controls in `src/components/`, static illustrative fixtures in `src/data/`, and browser/demo access in `src/services/`. Shared motion presets live in `src/motion/`; mobile PWA layout rules live in `src/styles/mobile-pwa.css`.

This is a domain preview, not a production client. The server remains the authority for mandate evaluation and transaction transitions. The client does not repeat those decisions.

## Routing and mobile navigation

`src/App.jsx` defines the route table and loads pages lazily. On `/app/*`, `MobileNavigation.jsx` supplies a fixed bottom tab bar for Home, Agent, Activity, Mandate, and Guardian. The existing top navigation remains available on wider screens. CSS uses viewport safe-area insets for the top header, bottom navigation, toast, and offline screen.

## PWA and offline behavior

`public/manifest.webmanifest` contains install metadata and `public/icons/safe-mandate.svg` is the app icon. `src/main.jsx` registers the service worker in production builds only.

`public/service-worker.js` caches exactly the generic `offline.html` document and app icon. Navigations are network-only and fall back to that generic offline screen. API, app-route, and guardian-route fetches are network-only. No page, guardian URL/token, API result, authorization, capture, void, or payment data is cached for offline use. If the open app loses connectivity, `App.jsx` replaces the routed interface with an offline gate. Neither offline view displays transaction states or offers approval/payment actions.

The demo guardian decision store is memory-only; no token is persisted in local storage. Local mandate editing remains a browser preview and is not an authenticated backend update.

## Motion and performance

Shared Framer Motion variants are in `src/motion/variants.js`; `MotionConfig` follows the user's reduced-motion preference. Page components are lazy-loaded so the chart-heavy dashboard does not need to load for every route. CSS uses local system font fallbacks rather than remote font downloads.

## Data access

`src/services/demoService.js` adapts local fixtures for the UI and labels them as illustrative. It is not a security or policy boundary. Payment-provider and authenticated API operations do not exist in this client yet. A later integration should replace the demo adapter with an authenticated API adapter while retaining one UI-facing contract; all policy decisions and state transitions must continue to come from the server.

## Adding a screen

Add a page under `src/pages/`, fetch its data through a service adapter, use the shared components and motion presets, and register it in `src/App.jsx`. For `/app/*` destinations, add a bottom-tab entry only if it is a primary mobile destination. Keep API and approval results out of the service worker cache and show an explicit pending/error state until the server returns an authoritative response.
