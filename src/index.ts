/**
 * devtools-lockdown
 *
 * Drop-in anti-DevTools protection for production web apps.
 * Detects open DevTools and nukes the page before anything useful leaks.
 *
 * MIT License — https://github.com/dragonGR/devtools-lockdown
 */

// ── Types ───────────────────────────────────────────────────────────

export interface LockdownOptions {
  /**
   * Called right before the page is wiped. Use this to fire analytics,
   * log the event, or do any last-second cleanup.
   */
  onDetected?: () => void;

  /**
   * Trap interval in ms. Lower = more aggressive, higher = less CPU.
   * Default: 1000
   */
  trapInterval?: number;

  /**
   * Element probe interval in ms.
   * Default: 3000
   */
  probeInterval?: number;

  /**
   * Debugger pause threshold in ms. If a `debugger` statement takes
   * longer than this, we assume DevTools is open.
   * Default: 100
   */
  threshold?: number;

  /**
   * Kill the page on detection. Set to false if you just want the
   * callback without the nuclear option.
   * Default: true
   */
  killPage?: boolean;

  /**
   * Block keyboard shortcuts (F12, Ctrl+Shift+I, etc).
   * Default: true
   */
  blockShortcuts?: boolean;

  /**
   * Block right-click context menu.
   * Default: true
   */
  blockContextMenu?: boolean;

  /**
   * Neutralize all console methods.
   * Default: true
   */
  neutralizeConsole?: boolean;

  /**
   * Block drag events (prevents save-as via drag).
   * Default: true
   */
  blockDrag?: boolean;
}

// ── State ───────────────────────────────────────────────────────────

let detected = false;
let opts: Required<LockdownOptions>;

const DEFAULTS: Required<LockdownOptions> = {
  onDetected: () => {},
  trapInterval: 1000,
  probeInterval: 3000,
  threshold: 100,
  killPage: true,
  blockShortcuts: true,
  blockContextMenu: true,
  neutralizeConsole: true,
  blockDrag: true,
};

// ── Internals ───────────────────────────────────────────────────────

function isAuditBot(): boolean {
  try {
    return (
      /lighthouse|chrome-lighthouse|pagespeed|headlesschrome|headlesschromium/i.test(
        navigator.userAgent,
      ) || navigator.webdriver
    );
  } catch {
    return false;
  }
}

function isDesktop(): boolean {
  const mobile =
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  const touchSmall = navigator.maxTouchPoints > 0 && window.innerWidth < 1024;
  return !mobile && !touchSmall;
}

function killNetwork(): void {
  window.fetch = () => Promise.reject(new Error('blocked'));

  (window as any).XMLHttpRequest = function () {
    return {
      open() {},
      send() {},
      setRequestHeader() {},
      addEventListener() {},
      abort() {},
      readyState: 4,
      status: 0,
      response: null,
      responseText: '',
    };
  };

  (window as any).WebSocket = function () {
    return { send() {}, close() {}, addEventListener() {} };
  };

  if (navigator.sendBeacon) {
    navigator.sendBeacon = () => false;
  }
}

function wipePage(): void {
  while (document.documentElement.firstChild) {
    document.documentElement.removeChild(document.documentElement.firstChild);
  }
  document.title = '';
  try {
    window.location.replace('about:blank');
  } catch {
    // sandboxed iframe — can't navigate, but page is already wiped
  }
}

function onDetect(): void {
  if (detected) return;
  detected = true;

  opts.onDetected();

  if (opts.killPage) {
    killNetwork();
    wipePage();
  }
}

// ── Detection: Debugger Trap ────────────────────────────────────────
//
// How it works: we drop a `debugger` statement and measure how long
// it takes. Normally it's < 1ms. If DevTools is open, the browser
// pauses on it and the timer jumps past the threshold.
//
// Two channels run in parallel (setInterval + requestAnimationFrame)
// so pausing one doesn't disable the other.

function trap(): void {
  const t0 = performance.now();
  // eslint-disable-next-line no-debugger
  debugger;
  if (performance.now() - t0 > opts.threshold) {
    onDetect();
  }
}

function rafTrap(): void {
  trap();
  if (!detected) requestAnimationFrame(rafTrap);
}

// ── Detection: Element Probe ────────────────────────────────────────
//
// How it works: we create a bait DOM element with a getter on its `id`
// property. When DevTools is open, the console periodically evaluates
// logged objects — which triggers the getter. If DevTools is closed,
// the getter never fires.

function setupProbe(): void {
  const bait = document.createElement('div');
  Object.defineProperty(bait, 'id', {
    get() {
      onDetect();
      return '';
    },
  });
  setInterval(() => {
    if (!detected) {
      // eslint-disable-next-line no-console
      console.debug(bait);
    }
  }, opts.probeInterval);
}

// ── Protection: Console Neutralization ──────────────────────────────

function neutralize(): void {
  const noop = () => undefined;
  const methods = [
    'log', 'warn', 'error', 'info', 'debug', 'trace',
    'table', 'dir', 'dirxml', 'group', 'groupEnd', 'groupCollapsed',
    'clear', 'count', 'countReset', 'assert',
    'time', 'timeEnd', 'timeLog', 'timeStamp',
  ];
  for (const m of methods) {
    try {
      (console as any)[m] = noop;
    } catch {
      // some environments freeze console
    }
  }
}

// ── Protection: Keyboard Shortcuts ──────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  // F12
  if (e.key === 'F12') {
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd + Shift + I/J/C (DevTools panels)
  if (
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    ['I', 'J', 'C'].includes(e.key.toUpperCase())
  ) {
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd + U (View Source)
  if ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'U')
    e.preventDefault();

  // Ctrl/Cmd + S (Save Page)
  if ((e.ctrlKey || e.metaKey) && e.key.toUpperCase() === 'S')
    e.preventDefault();
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialize the devtools lockdown. Call this once, early in your app
 * bootstrap (before React/Vue/whatever mounts).
 *
 * Automatically skipped for:
 * - Lighthouse / PageSpeed / headless Chrome (audit bots)
 * - Mobile / tablet (detection layers cause false positives)
 *   Universal protection layers (shortcuts, context menu) still apply.
 */
export function lockdown(options: LockdownOptions = {}): void {
  opts = { ...DEFAULTS, ...options };

  // Don't interfere with audit tools
  if (isAuditBot()) return;

  const desktop = isDesktop();

  // Desktop-only: active detection layers
  // Skipped on mobile because debugger traps and element probes
  // behave unpredictably on mobile browsers
  if (desktop) {
    trap();
    setInterval(trap, opts.trapInterval);
    requestAnimationFrame(rafTrap);
    setupProbe();
  }

  // Universal: passive protection layers (all devices)
  if (opts.neutralizeConsole) neutralize();

  if (opts.blockShortcuts) {
    document.addEventListener('keydown', onKeydown, true);
  }

  if (opts.blockContextMenu) {
    document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
  }

  if (opts.blockDrag) {
    document.addEventListener('dragstart', (e) => e.preventDefault(), true);
  }
}

/**
 * Check whether devtools has been detected in this session.
 */
export function wasDetected(): boolean {
  return detected;
}
