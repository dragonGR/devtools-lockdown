# devtools-lockdown

Kill the page the moment someone opens DevTools.

Built this after getting tired of people poking around production apps with the inspector. It's not bulletproof (nothing client-side ever is), but it raises the bar from "right-click inspect" to "actually know what you're doing."

## What it does

When DevTools opens, the page goes blank. Network requests stop. Console is dead. The user sees `about:blank`. There's nothing to recover — no back button, no cached DOM, no pending API calls.

## How it works

Four independent detection layers run in parallel. Disabling one doesn't help — the others catch it.

### Layer 1: Debugger timing trap

A `debugger` statement runs on a loop (both `setInterval` and `requestAnimationFrame`, so killing one timer doesn't stop the other). Normally it executes in under a millisecond. When DevTools is open, the browser pauses on it — even briefly — and the elapsed time jumps past the threshold. Game over.

```
Normal execution:    debugger → 0.02ms → carry on
DevTools open:       debugger → 150ms+ → detected → page wiped
```

The dual-channel approach (interval + rAF) exists because some people try to break out by pausing the interval. rAF keeps firing independently, and vice versa.

### Layer 2: Element probe (getter trap)

We create a dummy DOM element and define a getter on its `id` property. Then we `console.debug()` it every few seconds. Here's the trick: when DevTools is closed, the browser doesn't bother evaluating the logged object. But when the console panel is open (even in the background), the browser calls the getter to render the object in the console. That getter fires our detection callback.

This catches the case where someone opens DevTools *before* navigating to the page, which would dodge the timing trap if they're quick enough with breakpoints.

### Layer 3: Console neutralization

Every `console` method gets replaced with a no-op. `log`, `warn`, `error`, `debug`, `table`, `dir` — all of them. Even if someone manages to keep DevTools open for a split second, there's nothing useful in the console.

### Layer 4: Input blocking

- **Keyboard shortcuts** — F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U (view source), Ctrl+S (save page) are all intercepted and cancelled.
- **Context menu** — Right-click is disabled. No "Inspect Element."
- **Drag** — Drag events are killed, preventing save-as via drag-and-drop.

### What about mobile?

The active detection layers (debugger traps, element probes) only run on desktop. Mobile browsers don't have DevTools, and these techniques cause false positives on some mobile engines. The passive layers (console neutralization, shortcut blocking, context menu) still apply everywhere.

### Audit bot bypass

Lighthouse, PageSpeed Insights, and headless Chrome are automatically detected and skipped. Your performance scores won't be affected.

## Install

```bash
npm install devtools-lockdown
```

## Usage

Call it once, as early as possible. Before your framework mounts, before your router initializes — ideally right in your entry file.

```js
import { lockdown } from 'devtools-lockdown';

lockdown();
```

That's it. Zero config needed for the default behavior (detect, wipe, redirect to about:blank).

### With options

```js
import { lockdown } from 'devtools-lockdown';

lockdown({
  // Fire analytics before the page dies
  onDetected: () => {
    navigator.sendBeacon('/api/security-event', JSON.stringify({
      event: 'devtools_detected',
      url: location.href,
      timestamp: Date.now(),
    }));
  },

  // How often to run the debugger trap (ms)
  trapInterval: 1000,

  // How often to run the element probe (ms)
  probeInterval: 3000,

  // Debugger pause threshold (ms) — lower = more sensitive
  threshold: 100,

  // Set to false to just get the callback without killing the page
  killPage: true,

  // Toggle individual protection layers
  blockShortcuts: true,
  blockContextMenu: true,
  neutralizeConsole: true,
  blockDrag: true,
});
```

### Framework examples

**React (Vite)**
```tsx
// main.tsx
import { lockdown } from 'devtools-lockdown';

if (import.meta.env.PROD) {
  lockdown();
}

// ... rest of your app bootstrap
```

**Next.js**
```tsx
// app/layout.tsx or _app.tsx
'use client';
import { useEffect } from 'react';
import { lockdown } from 'devtools-lockdown';

export default function RootLayout({ children }) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      lockdown();
    }
  }, []);

  return <html><body>{children}</body></html>;
}
```

**Vue**
```ts
// main.ts
import { lockdown } from 'devtools-lockdown';

if (import.meta.env.PROD) {
  lockdown();
}

// ... createApp, mount, etc.
```

**Vanilla JS / script tag**
```html
<script type="module">
  import { lockdown } from './devtools-lockdown/dist/index.js';
  lockdown();
</script>
```

### Detection-only mode

If you want to know when DevTools opens but don't want to nuke the page:

```js
import { lockdown, wasDetected } from 'devtools-lockdown';

lockdown({
  killPage: false,
  onDetected: () => {
    // Log it, show a warning, watermark the page, do whatever you want
    document.body.textContent = 'Nice try.';
  },
});
```

## Options reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `onDetected` | `() => void` | no-op | Callback fired right before the page is wiped |
| `trapInterval` | `number` | `1000` | Debugger trap check interval (ms) |
| `probeInterval` | `number` | `3000` | Element probe check interval (ms) |
| `threshold` | `number` | `100` | Debugger pause detection threshold (ms) |
| `killPage` | `boolean` | `true` | Wipe the page and kill network on detection |
| `blockShortcuts` | `boolean` | `true` | Intercept F12, Ctrl+Shift+I, Ctrl+U, etc. |
| `blockContextMenu` | `boolean` | `true` | Disable right-click |
| `neutralizeConsole` | `boolean` | `true` | Replace all console methods with no-ops |
| `blockDrag` | `boolean` | `true` | Prevent drag-to-save |

## What happens on detection

This is the kill sequence, in order:

1. **`onDetected` callback** fires (if you provided one)
2. **Network killed** — `fetch`, `XMLHttpRequest`, `WebSocket`, and `sendBeacon` are all replaced with stubs that do nothing
3. **DOM wiped** — every child node of `<html>` is removed
4. **Page title cleared**
5. **Navigation to `about:blank`** — prevents back-button recovery

Steps 2-5 only happen if `killPage` is `true` (the default).

## Limitations

This is a **deterrent**, not a security boundary. Determined people can bypass client-side protections. A few realities:

- Someone can disable JavaScript entirely and view your HTML source.
- A proxy (Fiddler, Charles, mitmproxy) captures network traffic regardless.
- Browser extensions can inject scripts before your code runs.
- The truly motivated will just read the minified bundle.

**Real security happens server-side** — auth, rate limiting, input validation, access control. This library is about raising the effort required for casual inspection, not replacing actual security architecture.

That said, it does stop the vast majority of curious users who just hit F12 to see what's going on. And for many apps, that's exactly what you need.

## Why not just use CSP / obfuscation / etc.?

- **CSP** controls what scripts can run, not whether DevTools can open.
- **Obfuscation** makes code harder to read but doesn't prevent inspection.
- **This** actively detects and responds to DevTools being open.

They're complementary. Use all of them if you're serious about it.

## Browser support

Works on all modern browsers (Chrome, Firefox, Safari, Edge). The debugger timing trap is the most reliable detection method and works across all of them. The element probe is Chrome/Edge-specific (Firefox and Safari don't evaluate console-logged objects the same way), but the timing trap covers those browsers.

## License

MIT
