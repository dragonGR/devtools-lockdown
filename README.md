# devtools-lockdown

> **Production-grade anti-DevTools detection and page protection for modern web applications.**  
> Instantly detects DevTools inspection across multi-layered traps, halts pending network calls, eradicates the DOM, and neutralizes runtime access.

---

## Why devtools-lockdown?

Client-side code running in production is constantly probed by automated scrapers, curious visitors, and unauthorized inspectors using browser developer tools. 

While client-side protection is **never a replacement for server-side security**, `devtools-lockdown` significantly raises the technical barrier:
* **Multi-Layer Detection** — If an attacker disables timers, geometry or bait traps catch them.
* **Instant Hardened Cutoff** — All network interfaces (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`) are permanently replaced with hardened stub classes.
* **DOM Eradication** — The DOM tree is wiped clean down to the root, page title is reset, and the session navigates to `about:blank`.
* **Zero False Positives** — Automatic bypass for Google Lighthouse, PageSpeed Insights, and headless audit bots, with intelligent mobile/touch detection.

---

## How It Works (Multi-Layer Architecture)

```
                               ┌─────────────────────────────┐
                               │     devtools-lockdown       │
                               └──────────────┬──────────────┘
                                              │
         ┌──────────────────┬─────────────────┼─────────────────┬──────────────────┐
         │                  │                 │                 │                  │
         ▼                  ▼                 ▼                 ▼                  ▼
┌─────────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌────────────────┐
│  Layer 1:       │ │  Layer 2:     │ │  Layer 3:     │ │  Layer 4:     │ │  Layer 5:      │
│  Debugger Trap  │ │  Window Delta │ │  Element Bait │ │  Console Kill │ │  Input Guard   │
│  (Interval+rAF) │ │  (Docked UI)  │ │  (Getter Trap)│ │  (20 Methods) │ │  (Keys/Clicks) │
└────────┬────────┘ └───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └────────┬───────┘
         │                  │                 │                 │                  │
         └──────────────────┴────────┬────────┴─────────────────┴──────────────────┘
                                     │
                             DevTools Detected
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
         ┌─────────────────────┐           ┌─────────────────────┐
         │ Kill Network        │           │ Wipe Page & DOM     │
         │ • fetch → reject    │           │ • document.wipe()   │
         │ • XHR / WS blocked  │           │ • title = ""        │
         │ • sendBeacon = noop │           │ • goto about:blank  │
         └─────────────────────┘           └─────────────────────┘
```

### 1. Dual-Channel Debugger Timing Trap
A `debugger` statement executes within a dual-loop channel (`setInterval` + `requestAnimationFrame`). During normal execution, it executes in $< 1\text{ms}$. When DevTools is open, the JavaScript runtime pauses, causing the delta to exceed the threshold ($> 100\text{ms}$) and triggering lockdown. Pausing or clearing one timer does not stop the independent rAF channel.

### 2. Window Geometry & Viewport Delta Detection
When a user docks DevTools to the side or bottom of the browser, the difference between outer and inner window dimensions (`window.outerWidth - window.innerWidth` or `window.outerHeight - window.innerHeight`) expands beyond normal window frame borders ($> 160\text{px}$). Monitored continuously via timer and window `resize` events.

### 3. Element Bait Probe (Getter Trap)
Creates a dummy DOM element with an instrumented `id` property getter trap and logs it periodically via `console.debug(bait)`. Modern browser engines only evaluate object properties when rendering them inside an active console panel. Opening the console triggers the getter trap.

### 4. Hardened Network Kill Switch
When triggered, network capability is severed immediately:
* `window.fetch` rejects all requests immediately.
* `window.XMLHttpRequest` is sealed with a safe mock class returning empty state (`status: 0`, `readyState: 4`).
* `window.WebSocket` is sealed with a non-functional mock class.
* `navigator.sendBeacon` is disabled.

### 5. DOM & Navigation Eradication
Every child node of `document.documentElement` is removed, the page title is blanked, and `window.location.replace('about:blank')` is executed to prevent back-button or cached history recovery.

### 6. Universal Console Neutralization
Replaces 20+ `console` methods (`log`, `warn`, `error`, `info`, `debug`, `trace`, `table`, `dir`, `group`, `time`, etc.) with no-ops to eliminate data leakage.

### 7. Input & Shortcut Interception
Blocks standard inspection keystrokes and browser actions:
* `F12`
* `Ctrl+Shift+I`, `Ctrl+Shift+J`, `Ctrl+Shift+C` (or `Cmd+Option+I/J/C` on macOS)
* `Ctrl+U` / `Cmd+U` (View Page Source)
* `Ctrl+S` / `Cmd+S` (Save Page)
* Right-click Context Menu (`contextmenu` preventDefault)
* Drag-to-save (`dragstart` preventDefault)

### 8. Audit Bot & Mobile Adaptation
Automatically bypasses active traps when running under audit engines:
* Google Lighthouse & PageSpeed Insights
* Headless Chrome / Headless Chromium
* Selenium / Puppeteer / Playwright (`navigator.webdriver`)
* Restricts aggressive debugger traps on mobile browsers to prevent false positives from soft-keyboard resizing.

---

## Installation

```bash
# npm
npm install devtools-lockdown

# pnpm
pnpm add devtools-lockdown

# yarn
yarn add devtools-lockdown

# bun
bun add devtools-lockdown
```

---

## Quick Start

Call `lockdown()` as early as possible in your client entry file:

```typescript
import { lockdown } from 'devtools-lockdown';

// Activate with zero-config defaults
lockdown();
```

---

## Framework Integration

### React (Vite)

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { lockdown } from 'devtools-lockdown';
import App from './App';

// Only run in production
if (import.meta.env.PROD) {
  lockdown({
    onDetected: () => {
      // Optional analytics beacon or logging
    },
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
```

### Next.js (App Router)

```tsx
// app/providers.tsx or client component mounted in app/layout.tsx
'use client';

import { useEffect } from 'react';
import { lockdown } from 'devtools-lockdown';

export function SecurityGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      lockdown();
    }
  }, []);

  return null;
}
```

```tsx
// app/layout.tsx
import { SecurityGuard } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SecurityGuard />
        {children}
      </body>
    </html>
  );
}
```

### Vue 3

```typescript
// src/main.ts
import { createApp } from 'vue';
import { lockdown } from 'devtools-lockdown';
import App from './App.vue';

if (import.meta.env.PROD) {
  lockdown();
}

createApp(App).mount('#app');
```

### Vanilla HTML / Script Tag

```html
<script type="module">
  import { lockdown } from './dist/index.js';
  lockdown();
</script>
```

---

## Configuration Options

Pass a `LockdownOptions` object to customize behavior:

```typescript
import { lockdown } from 'devtools-lockdown';

lockdown({
  // ── Detection Callbacks ──────────────────────────────
  onDetected: () => {
    // Send security alert before page wipe
  },

  // ── Trap Timings & Thresholds ────────────────────────
  threshold: 100,            // Debugger pause threshold (ms)
  trapInterval: 1000,        // Debugger check loop interval (ms)
  probeInterval: 3000,       // Element probe interval (ms)
  sizeInterval: 800,         // Window size check interval (ms)
  sizeThreshold: 160,        // Outer-inner delta threshold (px)

  // ── Layer Toggles ────────────────────────────────────
  detectDebugger: true,      // Enable debugger timing trap
  detectSize: true,          // Enable window size delta checks
  detectElement: true,       // Enable console bait element probe
  neutralizeConsole: true,   // Clear and no-op console.*
  blockShortcuts: true,      // Intercept F12, Ctrl+Shift+I, etc.
  blockContextMenu: true,    // Disable right-click
  blockDrag: true,           // Disable drag-and-drop saving

  // ── Detection Response ───────────────────────────────
  killNetwork: true,         // Kill fetch, XHR, WebSocket, Beacon
  killPage: true,            // Eradicate DOM and redirect
  redirectUrl: 'about:blank',// URL to redirect on wipe

  // ── Environmental Safeguards ─────────────────────────
  allowAuditBots: true,      // Skip for Lighthouse, PageSpeed, WebDriver
  desktopOnlyDetection: true,// Skip debugger traps on mobile devices
});
```

### Options Reference Table

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `onDetected` | `() => void` | `() => {}` | Hook called immediately upon detection before page wipe. |
| `threshold` | `number` | `100` | Debugger execution delay threshold in ms. |
| `trapInterval` | `number` | `1000` | Frequency of `setInterval` debugger trap in ms. |
| `probeInterval` | `number` | `3000` | Frequency of element probe `console.debug` checks in ms. |
| `sizeInterval` | `number` | `800` | Frequency of window geometry checks in ms. |
| `sizeThreshold` | `number` | `160` | Pixel delta between outer and inner window bounds. |
| `detectDebugger` | `boolean` | `true` | Enables dual-channel debugger traps. |
| `detectSize` | `boolean` | `true` | Enables viewport geometry checks for docked DevTools. |
| `detectElement` | `boolean` | `true` | Enables DOM getter probe for console inspect. |
| `killNetwork` | `boolean` | `true` | Neutralizes `fetch`, `XMLHttpRequest`, `WebSocket`, and `sendBeacon`. |
| `killPage` | `boolean` | `true` | Eradicates DOM and redirects browser. |
| `redirectUrl` | `string` | `'about:blank'` | Redirection destination when page is wiped. |
| `neutralizeConsole` | `boolean` | `true` | Replaces console methods with no-ops. |
| `blockShortcuts` | `boolean` | `true` | Intercepts inspection keyboard shortcuts. |
| `blockContextMenu` | `boolean` | `true` | Disables right-click context menu. |
| `blockDrag` | `boolean` | `true` | Disables dragstart event propagation. |
| `allowAuditBots` | `boolean` | `true` | Bypasses detection for Lighthouse/PageSpeed/WebDriver. |
| `desktopOnlyDetection` | `boolean` | `true` | Prevents false positives from mobile viewport resize/keyboards. |

---

## Detection-Only Mode (Telemetry Mode)

If you wish to log DevTools usage without destroying the page:

```typescript
import { lockdown, wasDetected } from 'devtools-lockdown';

lockdown({
  killPage: false,
  killNetwork: false,
  onDetected: () => {
    console.info('Security: DevTools opening recorded.');
  },
});
```

---

## Bundler Configuration Notice

### Vite / Rollup / Terser / esbuild

When minifying your production bundle, ensure your minifier does **not** strip `debugger` statements or blanket-remove `console` statements if you rely on the element bait probe:

#### Vite (`vite.config.ts`):
```typescript
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        // IMPORTANT: Must be false so the timing debugger trap remains active
        drop_debugger: false,
        // IMPORTANT: Must be false so console.debug(baitElement) can trigger the getter trap
        drop_console: false,
        pure_funcs: ['console.log', 'console.info'], // Optional: strip normal logs
      },
    },
  },
});
```

---

## Exported Utilities

In addition to `lockdown()`, modular standalone helpers are exported:

```typescript
import {
  lockdown,
  initDevtoolsGuard,    // Alias for lockdown()
  wasDetected,          // Returns boolean
  isInitialized,        // Returns boolean
  isAuditBot,           // Returns boolean
  isDesktop,            // Returns boolean
  killNetwork,          // Standalone network kill switch
  wipePage,             // Standalone DOM & page wipe
  neutralizeConsole,    // Standalone console sanitizer
  resetState,           // Reset state (useful in test suites)
} from 'devtools-lockdown';
```

---

## Security In Perspective

> **Client-side security is defense-in-depth, not an authentication boundary.**

* An attacker with local machine access can run a network proxy (mitmproxy, Charles, Wireshark).
* Scripts injected via malicious browser extensions can bypass client code.
* A user can disable JavaScript entirely to inspect static HTML markup.

`devtools-lockdown` is designed to deter casual tampering, inspection, and unauthorized reverse-engineering of client state. Combine with robust **server-side authentication, CORS, rate limiting, and Content Security Policy (CSP)**.

---

## License

MIT © [Alex Tsanis](https://github.com/dragonGR)
