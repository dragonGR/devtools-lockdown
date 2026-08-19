/**
 * devtools-lockdown
 *
 * Production-grade anti-DevTools detection and page protection for modern web apps.
 * Detects DevTools opening across multiple independent layers and immediately
 * wipes the DOM, neutralizes network APIs, and terminates the session.
 *
 * Multi-layer architecture:
 *   1. Continuous debugger timing traps (setInterval + rAF dual-channel)
 *   2. Window geometry / viewport delta detection (docked & floating DevTools)
 *   3. Element bait probe with getter trap (fires on console object evaluation)
 *   4. Hardened network kill switch (fetch, XHR, WebSocket, Beacon)
 *   5. DOM eradication & history navigation wipe
 *   6. Comprehensive console neutralization
 *   7. Keyboard shortcut & inspection blocking (F12, Ctrl/Cmd+Shift+I/J/C, Ctrl+U/S)
 *   8. Context menu & drag-to-save blocking
 *   9. Zero-false-positive audit bot (Lighthouse/PageSpeed/WebDriver) & mobile detection
 *
 */

// ── Types ───────────────────────────────────────────────────────────

export interface LockdownOptions {
  /**
   * Callback fired immediately when DevTools is detected, right before
   * the network is killed and the page is wiped. Use this for telemetry/analytics.
   */
  onDetected?: () => void;

  /**
   * Debugger trap check interval in milliseconds.
   * Lower = more aggressive, higher = lower CPU footprint.
   * @default 1000
   */
  trapInterval?: number;

  /**
   * Element bait probe interval in milliseconds.
   * @default 3000
   */
  probeInterval?: number;

  /**
   * Size delta check interval in milliseconds.
   * @default 800
   */
  sizeInterval?: number;

  /**
   * Debugger pause threshold in milliseconds. If execution of a `debugger` statement
   * takes longer than this value, DevTools is determined to be open.
   * @default 100
   */
  threshold?: number;

  /**
   * Window size difference threshold (outerWidth - innerWidth or outerHeight - innerHeight)
   * in pixels that indicates a docked DevTools panel.
   * @default 160
   */
  sizeThreshold?: number;

  /**
   * Enable size/geometry-based detection of docked DevTools.
   * @default true
   */
  detectSize?: boolean;

  /**
   * Enable DOM element bait getter probe detection.
   * @default true
   */
  detectElement?: boolean;

  /**
   * Enable debugger timing trap detection.
   * @default true
   */
  detectDebugger?: boolean;

  /**
   * Eradicate the DOM, clear page title, and redirect on detection.
   * @default true
   */
  killPage?: boolean;

  /**
   * Kill network interfaces (fetch, XMLHttpRequest, WebSocket, sendBeacon) on detection.
   * @default true
   */
  killNetwork?: boolean;

  /**
   * Target URL to redirect to when page is wiped.
   * @default 'about:blank'
   */
  redirectUrl?: string;

  /**
   * Intercept and cancel DevTools & source inspection shortcuts
   * (F12, Ctrl/Cmd+Shift+I/J/C, Ctrl/Cmd+U, Ctrl/Cmd+S).
   * @default true
   */
  blockShortcuts?: boolean;

  /**
   * Disable right-click context menu ("Inspect Element").
   * @default true
   */
  blockContextMenu?: boolean;

  /**
   * Replace all console methods with no-op functions to prevent data leakage.
   * @default true
   */
  neutralizeConsole?: boolean;

  /**
   * Block dragstart events to prevent drag-and-drop save-as workflows.
   * @default true
   */
  blockDrag?: boolean;

  /**
   * Automatically bypass detection for audit bots (Lighthouse, PageSpeed, Headless Chrome, WebDriver).
   * @default true
   */
  allowAuditBots?: boolean;

  /**
   * Restrict active debugger/size detection to desktop environments to prevent
   * false positives on mobile viewport resizing / soft keyboards.
   * @default true
   */
  desktopOnlyDetection?: boolean;
}

// ── Default Configuration ───────────────────────────────────────────

const DEFAULTS: Required<LockdownOptions> = {
  onDetected: () => {},
  trapInterval: 1000,
  probeInterval: 3000,
  sizeInterval: 800,
  threshold: 100,
  sizeThreshold: 160,
  detectSize: true,
  detectElement: true,
  detectDebugger: true,
  killPage: true,
  killNetwork: true,
  redirectUrl: 'about:blank',
  blockShortcuts: true,
  blockContextMenu: true,
  neutralizeConsole: true,
  blockDrag: true,
  allowAuditBots: true,
  desktopOnlyDetection: true,
};

// ── State ───────────────────────────────────────────────────────────

let detected = false;
let initialized = false;
let activeOptions: Required<LockdownOptions> = { ...DEFAULTS };

const activeIntervals: number[] = [];

// ── Helper: Audit Bot Detection ─────────────────────────────────────

export function isAuditBot(): boolean {
  if (typeof navigator === 'undefined') return false;
  try {
    const ua = navigator.userAgent || '';
    const isBotUA =
      /lighthouse|chrome-lighthouse|pagespeed|headlesschrome|headlesschromium/i.test(
        ua,
      );
    const isWebDriver = Boolean(navigator.webdriver);
    return isBotUA || isWebDriver;
  } catch {
    return false;
  }
}

// ── Helper: Device Detection ────────────────────────────────────────

export function isDesktop(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined')
    return false;
  const mobileUA =
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
  const touchSmall =
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 0 &&
    window.innerWidth < 1024;
  return !mobileUA && !touchSmall;
}

// ── Network Kill Switch ─────────────────────────────────────────────

export function killNetwork(): void {
  if (typeof window === 'undefined') return;

  // 1. Fetch override
  if (typeof window.fetch !== 'undefined') {
    window.fetch = () => Promise.reject(new Error('blocked'));
  }

  // 2. XMLHttpRequest class override
  try {
    Object.defineProperty(window, 'XMLHttpRequest', {
      configurable: true,
      writable: true,
      value: class BlockedXMLHttpRequest {
        readyState = 4;
        status = 0;
        response = null;
        responseText = '';
        responseType = '';
        responseXML = null;
        statusText = '';
        timeout = 0;
        withCredentials = false;
        upload = {};

        open = () => undefined;
        send = () => undefined;
        setRequestHeader = () => undefined;
        addEventListener = () => undefined;
        removeEventListener = () => undefined;
        dispatchEvent = () => false;
        abort = () => undefined;
        getAllResponseHeaders = () => '';
        getResponseHeader = () => null;
        overrideMimeType = () => undefined;
      },
    });
  } catch {
    /* ignore if sealed */
  }

  // 3. WebSocket class override
  try {
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: class BlockedWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;

        readonly CONNECTING = 0;
        readonly OPEN = 1;
        readonly CLOSING = 2;
        readonly CLOSED = 3;

        readyState = 3;
        bufferedAmount = 0;
        extensions = '';
        protocol = '';
        url = '';
        binaryType = 'blob';

        onopen = null;
        onclose = null;
        onerror = null;
        onmessage = null;

        send = () => undefined;
        close = () => undefined;
        addEventListener = () => undefined;
        removeEventListener = () => undefined;
        dispatchEvent = () => false;
      },
    });
  } catch {
    /* ignore if sealed */
  }

  // 4. Beacon API override
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon = () => false;
    } catch {
      /* ignore */
    }
  }
}

// ── DOM Eradication & Page Wipe ─────────────────────────────────────

export function wipePage(redirectUrl: string = 'about:blank'): void {
  if (typeof document === 'undefined') return;

  try {
    if (document.documentElement) {
      while (document.documentElement.firstChild) {
        document.documentElement.removeChild(document.documentElement.firstChild);
      }
    }
    document.title = '';
  } catch {
    /* ignore DOM manipulation errors */
  }

  if (typeof window !== 'undefined' && redirectUrl) {
    try {
      window.location.replace(redirectUrl);
    } catch {
      // Handles sandboxed iframes unable to navigate
    }
  }
}

// ── Trigger Detection Response ──────────────────────────────────────

function onDetect(): void {
  if (detected) return;
  detected = true;

  try {
    activeOptions.onDetected();
  } catch {
    /* isolate callback exceptions */
  }

  if (activeOptions.killNetwork) {
    killNetwork();
  }

  if (activeOptions.killPage) {
    wipePage(activeOptions.redirectUrl);
  }
}

// ── Detection Layer 1: Debugger Timing Trap ─────────────────────────

function runDebuggerTrap(): void {
  if (detected || typeof performance === 'undefined') return;
  const t0 = performance.now();
  // eslint-disable-next-line no-debugger
  debugger;
  if (performance.now() - t0 > activeOptions.threshold) {
    onDetect();
  }
}

function runRafTrap(): void {
  if (detected) return;
  runDebuggerTrap();
  if (!detected && typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(runRafTrap);
  }
}

// ── Detection Layer 2: Window Geometry / Size Delta ─────────────────

function checkWindowSize(): void {
  if (detected || typeof window === 'undefined') return;
  const widthDelta = window.outerWidth - window.innerWidth;
  const heightDelta = window.outerHeight - window.innerHeight;
  if (
    widthDelta > activeOptions.sizeThreshold ||
    heightDelta > activeOptions.sizeThreshold
  ) {
    onDetect();
  }
}

// ── Detection Layer 3: Element Bait Probe ───────────────────────────

function setupElementProbe(): void {
  if (typeof document === 'undefined') return;
  try {
    const bait = document.createElement('div');
    Object.defineProperty(bait, 'id', {
      get() {
        onDetect();
        return '';
      },
    });

    const intervalId = window.setInterval(() => {
      if (!detected && typeof console !== 'undefined' && console.debug) {
        // eslint-disable-next-line no-console
        console.debug(bait);
      }
    }, activeOptions.probeInterval);

    activeIntervals.push(intervalId);
  } catch {
    /* element probe setup skipped if unsupported */
  }
}

// ── Protection Layer: Console Neutralization ────────────────────────

export function neutralizeConsole(): void {
  if (typeof console === 'undefined') return;
  const noop = () => undefined;
  const methods = [
    'log',
    'warn',
    'error',
    'info',
    'debug',
    'trace',
    'table',
    'dir',
    'dirxml',
    'group',
    'groupEnd',
    'groupCollapsed',
    'clear',
    'count',
    'countReset',
    'assert',
    'time',
    'timeEnd',
    'timeLog',
    'timeStamp',
  ] as const;

  for (const m of methods) {
    try {
      (console as unknown as Record<string, unknown>)[m] = noop;
    } catch {
      /* ignore if console is frozen */
    }
  }
}

// ── Protection Layer: Keyboard Shortcut Blocking ────────────────────

function onKeydown(e: KeyboardEvent): void {
  // F12 key
  if (e.key === 'F12') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Ctrl/Cmd + Shift + I/J/C (DevTools inspect/console)
  if (
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    ['I', 'J', 'C'].includes((e.key || '').toUpperCase())
  ) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Ctrl/Cmd + U (View Page Source)
  if ((e.ctrlKey || e.metaKey) && (e.key || '').toUpperCase() === 'U') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Ctrl/Cmd + S (Save Page)
  if ((e.ctrlKey || e.metaKey) && (e.key || '').toUpperCase() === 'S') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialize DevTools lockdown and page protection.
 * Call this as early as possible in your application lifecycle (e.g. main.tsx or entry file).
 */
export function lockdown(options: LockdownOptions = {}): void {
  if (typeof window === 'undefined') return;

  activeOptions = { ...DEFAULTS, ...options };

  // Skip audit bots (Lighthouse, PageSpeed, Headless Chrome, WebDriver)
  if (activeOptions.allowAuditBots && isAuditBot()) {
    return;
  }

  const desktop = isDesktop();
  const shouldRunActiveDetection =
    !activeOptions.desktopOnlyDetection || desktop;

  // Active Detection Layers (Desktop or Unrestricted)
  if (shouldRunActiveDetection) {
    // Layer 1: Debugger Timing Traps
    if (activeOptions.detectDebugger) {
      runDebuggerTrap();
      const trapId = window.setInterval(
        runDebuggerTrap,
        activeOptions.trapInterval,
      );
      activeIntervals.push(trapId);
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(runRafTrap);
      }
    }

    // Layer 2: Geometry & Size Delta Checks
    if (activeOptions.detectSize) {
      checkWindowSize();
      const sizeId = window.setInterval(
        checkWindowSize,
        activeOptions.sizeInterval,
      );
      activeIntervals.push(sizeId);
      window.addEventListener('resize', checkWindowSize, true);
    }

    // Layer 3: Bait Element Getter Probe
    if (activeOptions.detectElement) {
      setupElementProbe();
    }
  }

  // Passive Protection Layers (Universal across all devices)
  if (activeOptions.neutralizeConsole) {
    neutralizeConsole();
  }

  if (activeOptions.blockShortcuts && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeydown, true);
  }

  if (activeOptions.blockContextMenu && typeof document !== 'undefined') {
    document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
  }

  if (activeOptions.blockDrag && typeof document !== 'undefined') {
    document.addEventListener('dragstart', (e) => e.preventDefault(), true);
  }

  initialized = true;
}

/**
 * Alias for lockdown() matching the websitev3.1 naming convention.
 */
export const initDevtoolsGuard = lockdown;

/**
 * Check whether DevTools has been detected during this session.
 */
export function wasDetected(): boolean {
  return detected;
}

/**
 * Check whether lockdown has been initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Reset internal state and active timers. Primarily intended for testing environments.
 */
export function resetState(): void {
  detected = false;
  initialized = false;
  while (activeIntervals.length > 0) {
    const id = activeIntervals.pop();
    if (typeof id === 'number') {
      window.clearInterval(id);
    }
  }
}
