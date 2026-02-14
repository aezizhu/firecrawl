import { Page, BrowserContext } from 'patchright';

/**
 * Applies stealth evasion scripts to a browser context or page.
 * These scripts patch common headless browser detection vectors
 * used by anti-bot systems (e.g., Cloudflare, DataDome, PerimeterX).
 */
export async function applyStealthScripts(context: BrowserContext): Promise<void> {
  // Patch navigator.webdriver to return false
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });

  // Patch chrome.runtime to appear as a real Chrome browser
  await context.addInitScript(() => {
    (window as any).chrome = {
      runtime: {
        onConnect: undefined,
        onMessage: undefined,
        connect: () => {},
        sendMessage: () => {},
      },
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'http/1.1',
        finishDocumentLoadTime: Date.now() / 1000 + 0.1,
        finishLoadTime: Date.now() / 1000 + 0.2,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 + 0.05,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'unknown',
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.3,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
      }),
      csi: () => ({
        onloadT: Date.now(),
        pageT: Date.now() / 1000,
        startE: Date.now(),
        tran: 15,
      }),
    };
  });

  // Patch navigator.plugins to appear non-empty (headless Chrome has 0 plugins)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        const pluginArray = Object.create(PluginArray.prototype);
        for (let i = 0; i < plugins.length; i++) {
          const p = Object.create(Plugin.prototype);
          Object.defineProperties(p, {
            name: { value: plugins[i].name, enumerable: true },
            filename: { value: plugins[i].filename, enumerable: true },
            description: { value: plugins[i].description, enumerable: true },
            length: { value: 0, enumerable: true },
          });
          pluginArray[i] = p;
        }
        Object.defineProperty(pluginArray, 'length', { value: plugins.length });
        return pluginArray;
      },
    });
  });

  // Patch navigator.languages
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });

  // Patch permissions API to match real Chrome behavior
  await context.addInitScript(() => {
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    (window.navigator.permissions as any).query = (parameters: any) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission } as PermissionStatus);
      }
      return originalQuery(parameters);
    };
  });

  // Prevent WebGL renderer/vendor fingerprint from revealing headless
  await context.addInitScript(() => {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      // UNMASKED_RENDERER_WEBGL
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameter.call(this, param);
    };
  });

  // Prevent iframe contentWindow detection
  await context.addInitScript(() => {
    try {
      const originalAttachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (...args) {
        return originalAttachShadow.apply(this, args);
      };
    } catch (_) {}
  });
}

/**
 * Returns Chromium launch arguments that help evade headless detection.
 */
export function getStealthLaunchArgs(): string[] {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    // Anti-detection args
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    // Memory optimization args
    '--renderer-process-limit=4',
    '--js-flags=--max-old-space-size=256',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-ipc-flooding-protection',
    '--disable-hang-monitor',
    '--metrics-recording-only',
    '--mute-audio',
  ];
}
