import express, { Request, Response } from 'express';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page } from 'patchright';
import dotenv from 'dotenv';
import { getError } from './helpers/get_error';
import { applyStealthScripts, getStealthLaunchArgs } from './stealth';

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(express.json());

const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const MAX_CONCURRENT_PAGES = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT_PAGES ?? '10', 10) || 10);
const CONTEXT_POOL_SIZE = Math.max(1, Number.parseInt(process.env.CONTEXT_POOL_SIZE ?? '4', 10) || 4);
const CONTEXT_RECYCLE_AFTER = Number.parseInt(process.env.CONTEXT_RECYCLE_AFTER ?? '50', 10) || 50;
const MEMORY_LIMIT_MB = Number.parseInt(process.env.MEMORY_LIMIT_MB ?? '1800', 10) || 1800;

const PROXY_SERVER = process.env.PROXY_SERVER;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;
const STEALTH_ENABLED = (process.env.STEALTH_ENABLED || 'True').toUpperCase() === 'TRUE';

class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        this.permits--;
        nextResolve();
      }
    }
  }

  getAvailablePermits(): number {
    return this.permits;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);

const AD_SERVING_DOMAINS = [
  'doubleclick.net',
  'adservice.google.com',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adsystem.com',
  'adservice.com',
  'adnxs.com',
  'ads-twitter.com',
  'facebook.net',
  'fbcdn.net',
  'amazon-adsystem.com',
  'hotjar.com',
  'clarity.ms',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'sentry.io',
  'newrelic.com',
  'optimizely.com',
  'crazyegg.com',
  'fullstory.com',
];

const BLOCKED_RESOURCE_TYPES = [
  'image',
  'media',
  'font',
];

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
}

// --- Context Pool ---
interface PooledContext {
  context: BrowserContext;
  useCount: number;
  createdAt: number;
}

let browser: Browser;
let contextPool: PooledContext[] = [];
let contextRoundRobin = 0;
let isShuttingDown = false;
let totalScrapes = 0;
let failedScrapes = 0;

const getMemoryUsageMB = (): number => {
  const usage = process.memoryUsage();
  return Math.round(usage.rss / 1024 / 1024);
};

const initializeBrowser = async () => {
  const args = STEALTH_ENABLED ? getStealthLaunchArgs() : [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
  ];

  browser = await chromium.launch({
    headless: true,
    args,
  });

  // Pre-create context pool
  await initContextPool();
  console.log(`Browser initialized with ${CONTEXT_POOL_SIZE} pooled contexts, max ${MAX_CONCURRENT_PAGES} concurrent pages`);
};

const initContextPool = async () => {
  contextPool = [];
  for (let i = 0; i < CONTEXT_POOL_SIZE; i++) {
    const ctx = await createPooledContext();
    contextPool.push(ctx);
  }
};

const createPooledContext = async (): Promise<PooledContext> => {
  const contextOptions: any = {
    ignoreHTTPSErrors: true,
  };

  if (PROXY_SERVER) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
      ...(PROXY_USERNAME && { username: PROXY_USERNAME }),
      ...(PROXY_PASSWORD && { password: PROXY_PASSWORD }),
    };
  }

  const context = await browser.newContext(contextOptions);

  if (STEALTH_ENABLED) {
    await applyStealthScripts(context);
  }

  // Block ads and trackers
  await context.route('**/*', (route: Route, request: PlaywrightRequest) => {
    const resourceType = request.resourceType();

    // Block heavy resource types (images, media, fonts)
    if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
      return route.abort();
    }

    // Block ad/tracking domains
    try {
      const requestUrl = new URL(request.url());
      const hostname = requestUrl.hostname;
      if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
        return route.abort();
      }
    } catch (_) {}

    return route.continue();
  });

  return {
    context,
    useCount: 0,
    createdAt: Date.now(),
  };
};

const getContext = async (): Promise<PooledContext> => {
  // Round-robin across pool
  const idx = contextRoundRobin % contextPool.length;
  contextRoundRobin++;

  let pooled = contextPool[idx];

  // Recycle if used too many times
  if (pooled.useCount >= CONTEXT_RECYCLE_AFTER) {
    try {
      await pooled.context.close();
    } catch (_) {}
    pooled = await createPooledContext();
    contextPool[idx] = pooled;
  }

  pooled.useCount++;
  return pooled;
};

const recycleBrowserIfNeeded = async () => {
  const memMB = getMemoryUsageMB();
  if (memMB > MEMORY_LIMIT_MB) {
    console.warn(`Memory usage ${memMB}MB exceeds limit ${MEMORY_LIMIT_MB}MB, recycling browser...`);
    try {
      for (const p of contextPool) {
        try { await p.context.close(); } catch (_) {}
      }
      contextPool = [];
      await browser.close();
    } catch (_) {}
    await initializeBrowser();
    console.log(`Browser recycled. Memory now: ${getMemoryUsageMB()}MB`);
  }
};

const shutdownBrowser = async () => {
  isShuttingDown = true;
  for (const p of contextPool) {
    try { await p.context.close(); } catch (_) {}
  }
  contextPool = [];
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
};

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

const scrapePage = async (page: Page, url: string, waitUntil: 'load' | 'networkidle', waitAfterLoad: number, timeout: number, checkSelector: string | undefined) => {
  console.log(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
  let response = await page.goto(url, { waitUntil, timeout });

  if (waitAfterLoad > 0) {
    await page.waitForTimeout(waitAfterLoad);
  }

  if (checkSelector) {
    try {
      await page.waitForSelector(checkSelector, { timeout });
    } catch (error) {
      throw new Error('Required selector not found');
    }
  }

  let headers = null, content = await page.content();
  let ct: string | undefined = undefined;
  if (response) {
    headers = await response.allHeaders();
    ct = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
    if (ct && (ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/plain"))) {
      content = (await response.body()).toString("utf8");
    }
  }

  return {
    content,
    status: response ? response.status() : null,
    headers,
    contentType: ct,
  };
};

app.get('/health', async (req: Request, res: Response) => {
  try {
    if (!browser) {
      await initializeBrowser();
    }

    const memMB = getMemoryUsageMB();

    res.status(200).json({
      status: 'healthy',
      maxConcurrentPages: MAX_CONCURRENT_PAGES,
      activePages: MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits(),
      queuedRequests: pageSemaphore.getQueueLength(),
      contextPoolSize: contextPool.length,
      memoryMB: memMB,
      memoryLimitMB: MEMORY_LIMIT_MB,
      totalScrapes,
      failedScrapes,
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

app.post('/scrape', async (req: Request, res: Response) => {
  if (isShuttingDown) {
    return res.status(503).json({ error: 'Service is shutting down' });
  }

  const { url, wait_after_load = 0, timeout = 15000, headers, check_selector, skip_tls_verification = false }: UrlModel = req.body;

  console.log(`================= Scrape Request =================`);
  console.log(`URL: ${url}`);
  console.log(`Wait After Load: ${wait_after_load}`);
  console.log(`Timeout: ${timeout}`);
  console.log(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
  console.log(`Check Selector: ${check_selector ? check_selector : 'None'}`);
  console.log(`Skip TLS Verification: ${skip_tls_verification}`);
  console.log(`Active: ${MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits()}/${MAX_CONCURRENT_PAGES} | Queue: ${pageSemaphore.getQueueLength()} | Mem: ${getMemoryUsageMB()}MB`);
  console.log(`==================================================`);

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!browser) {
    await initializeBrowser();
  }

  await pageSemaphore.acquire();
  totalScrapes++;

  let page: Page | null = null;

  try {
    const pooled = await getContext();
    page = await pooled.context.newPage();

    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    const result = await scrapePage(page, url, 'load', wait_after_load, timeout, check_selector);
    const pageError = result.status !== 200 ? getError(result.status) : undefined;

    if (!pageError) {
      console.log(`Scrape successful!`);
    } else {
      console.log(`Scrape failed with status code: ${result.status} ${pageError}`);
    }

    res.json({
      content: result.content,
      pageStatusCode: result.status,
      contentType: result.contentType,
      ...(pageError && { pageError })
    });
  } catch (error) {
    failedScrapes++;
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'An error occurred while fetching the page.' });
  } finally {
    if (page) {
      try { await page.close(); } catch (_) {}
    }
    pageSemaphore.release();

    // Check memory after every 10 scrapes
    if (totalScrapes % 10 === 0) {
      recycleBrowserIfNeeded().catch(err =>
        console.error('Error during browser recycle:', err)
      );
    }
  }
});

app.listen(port, () => {
  initializeBrowser().then(() => {
    console.log(`Server is running on port ${port}`);
    console.log(`Config: MAX_CONCURRENT_PAGES=${MAX_CONCURRENT_PAGES}, CONTEXT_POOL_SIZE=${CONTEXT_POOL_SIZE}, CONTEXT_RECYCLE_AFTER=${CONTEXT_RECYCLE_AFTER}, MEMORY_LIMIT_MB=${MEMORY_LIMIT_MB}`);
    console.log(`Memory: ${getMemoryUsageMB()}MB`);
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  isShuttingDown = true;

  // Wait for in-flight requests (up to 30 seconds)
  const start = Date.now();
  while (pageSemaphore.getAvailablePermits() < MAX_CONCURRENT_PAGES && Date.now() - start < 30000) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await shutdownBrowser();
  console.log('Browser closed, exiting.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
