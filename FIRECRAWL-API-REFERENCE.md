# Firecrawl Self-Hosted API Reference

Use this document to teach AI agents how to interact with a self-hosted Firecrawl v2 API instance.

---

## Quick Start

**Base URL:** `http://<your-host>:3002/v2`

**Authentication:** All endpoints require a `Bearer` token in the `Authorization` header.
- Self-hosted (no auth): Use the value of the `TEST_API_KEY` environment variable
- Hosted: Use your Firecrawl API key

```
Authorization: Bearer fc-YOUR_API_KEY
```

---

## Core Endpoints

### 1. Scrape a Single URL

Scrape a single webpage and return its content in the requested formats.

```
POST /v2/scrape
```

**Request Body:**

```json
{
  "url": "https://example.com",
  "formats": ["markdown"],
  "onlyMainContent": true,
  "waitFor": 0,
  "timeout": 30000,
  "mobile": false,
  "blockAds": true,
  "removeBase64Images": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | URL to scrape |
| `formats` | string[] or object[] | `["markdown"]` | Output formats (see Format Options below) |
| `onlyMainContent` | boolean | `true` | Extract only main content (no nav, footer, etc.) |
| `waitFor` | integer | `0` | Wait milliseconds after page load (max 60000) |
| `timeout` | integer | `30000` | Request timeout in ms (min 1000) |
| `mobile` | boolean | `false` | Emulate mobile device |
| `headers` | object | - | Custom HTTP headers |
| `includeTags` | string[] | - | CSS selectors to include |
| `excludeTags` | string[] | - | CSS selectors to exclude |
| `actions` | object[] | - | Browser actions to perform before scraping |
| `location.country` | string | `"us-generic"` | ISO 3166-1 alpha-2 country code |
| `location.languages` | string[] | - | Preferred languages |
| `skipTlsVerification` | boolean | - | Skip TLS certificate verification |
| `removeBase64Images` | boolean | `true` | Remove base64 images from output |
| `blockAds` | boolean | `true` | Block ads |
| `proxy` | string | `"auto"` | Proxy mode: `"basic"`, `"stealth"`, `"enhanced"`, `"auto"` |
| `maxAge` | integer | - | Max cache age in ms (serve cached if newer) |
| `fastMode` | boolean | `false` | Use fast mode (less accurate but faster) |

**Format Options:**

Formats can be simple strings or objects with options:

| Format | Description |
|--------|-------------|
| `"markdown"` | Clean markdown content |
| `"html"` | Processed HTML |
| `"rawHtml"` | Raw unprocessed HTML |
| `"links"` | List of URLs found on page |
| `"images"` | List of images found on page |
| `"summary"` | AI-generated summary |
| `{"type": "json", "schema": {...}, "prompt": "..."}` | Structured JSON extraction using schema + prompt |
| `{"type": "screenshot", "fullPage": false}` | Page screenshot |
| `{"type": "changeTracking", "modes": ["json", "git-diff"]}` | Track changes (requires `"markdown"` format too) |
| `{"type": "attributes", "selectors": [{"selector": "...", "attribute": "..."}]}` | Extract specific HTML attributes |

**Response:**

```json
{
  "success": true,
  "data": {
    "markdown": "# Page Title\n\nContent here...",
    "metadata": {
      "title": "Page Title",
      "description": "Page description",
      "statusCode": 200,
      "url": "https://example.com",
      "sourceURL": "https://example.com"
    }
  }
}
```

**Example — scrape to markdown:**

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H "Authorization: Bearer fc-YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

**Example — extract structured JSON:**

```bash
curl -X POST http://localhost:3002/v2/scrape \
  -H "Authorization: Bearer fc-YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/products",
    "formats": [{"type": "json", "schema": {"type": "object", "properties": {"products": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "price": {"type": "number"}}}}}}, "prompt": "Extract all products with names and prices"}]
  }'
```

---

### 2. Crawl a Website

Start an async crawl job that discovers and scrapes pages from a starting URL.

```
POST /v2/crawl
```

**Request Body:**

```json
{
  "url": "https://example.com",
  "limit": 100,
  "scrapeOptions": {
    "formats": ["markdown"]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | Starting URL |
| `limit` | integer | `10000` | Max pages to crawl |
| `scrapeOptions` | object | `{formats: ["markdown"]}` | Options applied to each scraped page (same as scrape endpoint) |
| `includePaths` | string[] | `[]` | URL path patterns to include |
| `excludePaths` | string[] | `[]` | URL path patterns to exclude |
| `maxDiscoveryDepth` | integer | - | Max link depth from start URL |
| `allowExternalLinks` | boolean | `false` | Follow links to other domains |
| `allowSubdomains` | boolean | `false` | Follow links to subdomains |
| `ignoreRobotsTxt` | boolean | `false` | Ignore robots.txt |
| `sitemap` | string | `"include"` | `"include"`, `"skip"`, or `"only"` |
| `deduplicateSimilarURLs` | boolean | `true` | Deduplicate similar URLs |
| `webhook` | object | - | Webhook URL for status updates |
| `maxConcurrency` | integer | - | Max concurrent scrapes |
| `prompt` | string | - | LLM prompt applied to each page |

**Response:**

```json
{
  "success": true,
  "id": "019477e0-...",
  "url": "https://example.com"
}
```

Use the `id` to check crawl status.

---

### 3. Check Crawl Status

```
GET /v2/crawl/:jobId
```

**Response:**

```json
{
  "success": true,
  "status": "scraping",
  "completed": 42,
  "total": 100,
  "creditsUsed": 42,
  "expiresAt": "2026-02-14T...",
  "data": [
    {
      "markdown": "...",
      "metadata": { "title": "...", "url": "...", "statusCode": 200 }
    }
  ],
  "next": "/v2/crawl/019477e0-...?skip=10"
}
```

| Status | Meaning |
|--------|---------|
| `"scraping"` | Crawl is in progress |
| `"completed"` | All pages scraped |
| `"failed"` | Crawl failed |
| `"cancelled"` | Crawl was cancelled |

Use the `next` URL to paginate through results.

---

### 4. Cancel a Crawl

```
DELETE /v2/crawl/:jobId
```

---

### 5. Crawl Status via WebSocket

```
WS /v2/crawl/:jobId
```

Streams real-time crawl updates.

---

### 6. Batch Scrape

Scrape multiple URLs in a single request (async).

```
POST /v2/batch/scrape
```

**Request Body:**

```json
{
  "urls": ["https://example.com/page1", "https://example.com/page2"],
  "formats": ["markdown"],
  "onlyMainContent": true
}
```

All scrape options from the single scrape endpoint apply here too. Additional fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | string[] | **required** | URLs to scrape (min 1) |
| `webhook` | object | - | Webhook for status updates |
| `ignoreInvalidURLs` | boolean | `true` | Skip invalid URLs instead of failing |
| `maxConcurrency` | integer | - | Max concurrent scrapes |

**Response:** Same as crawl — returns a `jobId` to check status with `GET /v2/batch/scrape/:jobId`.

---

### 7. Map a Website

Discover all URLs on a website without scraping content.

```
POST /v2/map
```

**Request Body:**

```json
{
  "url": "https://example.com",
  "limit": 5000,
  "search": "optional search term"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | **required** | Starting URL |
| `limit` | integer | `5000` | Max URLs to return (max 100000) |
| `search` | string | - | Filter URLs by search term |
| `includePaths` | string[] | `[]` | Path patterns to include |
| `excludePaths` | string[] | `[]` | Path patterns to exclude |
| `includeSubdomains` | boolean | `true` | Include subdomain URLs |
| `sitemap` | string | `"include"` | `"include"`, `"skip"`, or `"only"` |

**Response:**

```json
{
  "success": true,
  "links": [
    {"url": "https://example.com/page1", "title": "Page 1", "description": "..."},
    {"url": "https://example.com/page2", "title": "Page 2"}
  ]
}
```

---

### 8. Search the Web

Search the web and optionally scrape the results.

```
POST /v2/search
```

**Request Body:**

```json
{
  "query": "firecrawl web scraping",
  "limit": 5,
  "scrapeOptions": {
    "formats": ["markdown"]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | **required** | Search query |
| `limit` | integer | `10` | Max results (max 100) |
| `lang` | string | `"en"` | Language code |
| `country` | string | `"us"` | Country code |
| `location` | string | - | Location string |
| `sources` | string[] or object[] | `["web"]` | Sources: `"web"`, `"images"`, `"news"` |
| `categories` | string[] | - | Categories: `"github"`, `"research"`, `"pdf"` |
| `tbs` | string | - | Time-based search (e.g., `"qdr:d"` for past day) |
| `scrapeOptions` | object | - | Scrape options applied to results. If formats is empty/absent, results are not scraped. |
| `asyncScraping` | boolean | `false` | Return job IDs instead of waiting for scrapes |
| `timeout` | integer | `60000` | Timeout in ms |

**Response (without scraping):**

```json
{
  "success": true,
  "data": {
    "web": [
      {"url": "https://...", "title": "...", "description": "..."}
    ]
  },
  "creditsUsed": 5,
  "id": "019477e0-..."
}
```

**Response (with scraping):** Same structure but each result includes `markdown`, `html`, etc. based on `scrapeOptions.formats`.

---

### 9. Extract Structured Data

Extract structured data from one or more URLs using AI.

```
POST /v2/extract
```

**Request Body:**

```json
{
  "urls": ["https://example.com"],
  "prompt": "Extract the company name, founding year, and number of employees",
  "schema": {
    "type": "object",
    "properties": {
      "company": {"type": "string"},
      "founded": {"type": "integer"},
      "employees": {"type": "integer"}
    },
    "required": ["company"]
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | string[] | - | URLs to extract from (max 10). Either `urls` or `prompt` required. |
| `prompt` | string | - | Extraction prompt. Either `urls` or `prompt` required. |
| `schema` | object | - | JSON Schema for structured output |
| `systemPrompt` | string | - | System prompt for the LLM |
| `limit` | integer | - | Max pages to process |
| `scrapeOptions` | object | - | Scrape options for each URL |
| `enableWebSearch` | boolean | `false` | Allow web search to find relevant pages |
| `allowExternalLinks` | boolean | `false` | Follow external links |
| `includeSubdomains` | boolean | `true` | Include subdomains |
| `ignoreSitemap` | boolean | `false` | Skip sitemap |
| `showSources` | boolean | `false` | Include source URLs in response |
| `webhook` | object | - | Webhook for async completion |

**Response:**

```json
{
  "success": true,
  "data": {
    "company": "Firecrawl",
    "founded": 2024,
    "employees": 15
  },
  "id": "019477e0-..."
}
```

For async extraction, poll status with `GET /v2/extract/:jobId`.

---

### 10. Agent

Run an autonomous AI agent that browses the web to answer a question.

```
POST /v2/agent
```

**Request Body:**

```json
{
  "urls": ["https://example.com"],
  "prompt": "Find the pricing for the enterprise plan",
  "model": "spark-1-pro"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `urls` | string[] | - | Starting URLs |
| `prompt` | string | **required** | Agent task/question (max 10000 chars) |
| `schema` | object | - | JSON Schema for structured output |
| `model` | string | `"spark-1-pro"` | `"spark-1-pro"` or `"spark-1-mini"` |
| `maxCredits` | number | - | Max credits to spend |
| `webhook` | object | - | Webhook for status updates |

**Response:**

```json
{
  "success": true,
  "id": "019477e0-..."
}
```

Check status with `GET /v2/agent/:jobId`. Cancel with `DELETE /v2/agent/:jobId`.

**Agent Status Response:**

```json
{
  "success": true,
  "status": "completed",
  "data": { ... },
  "model": "spark-1-pro",
  "expiresAt": "2026-02-14T...",
  "creditsUsed": 50
}
```

---

### 11. Browser Actions

Create and control browser instances for complex interactions.

```
POST /v2/browser          — Create a new browser session
GET  /v2/browser          — List active browser sessions
POST /v2/browser/execute  — Execute actions in a browser session
DELETE /v2/browser        — Close a browser session
```

---

### 12. Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v2/scrape/:jobId` | GET | Check async scrape status |
| `/v2/crawl/ongoing` | GET | List ongoing crawls |
| `/v2/crawl/active` | GET | List active crawls (alias) |
| `/v2/crawl/:jobId/errors` | GET | Get crawl errors |
| `/v2/batch/scrape/:jobId` | GET | Check batch scrape status |
| `/v2/batch/scrape/:jobId` | DELETE | Cancel batch scrape |
| `/v2/batch/scrape/:jobId/errors` | GET | Get batch scrape errors |
| `/v2/team/credit-usage` | GET | Current credit usage |
| `/v2/team/credit-usage/historical` | GET | Historical credit usage |
| `/v2/team/token-usage` | GET | Current token usage |
| `/v2/team/token-usage/historical` | GET | Historical token usage |
| `/v2/concurrency-check` | GET | Check concurrency limits |
| `/v2/team/queue-status` | GET | Queue status |

---

## Browser Actions Reference

Actions can be chained (max 50 per request). Total wait time across all actions must not exceed 60 seconds.

| Action | Fields | Description |
|--------|--------|-------------|
| `{"type": "wait", "milliseconds": 2000}` | `milliseconds` OR `selector` | Wait for time or element |
| `{"type": "click", "selector": "#btn"}` | `selector`, `all` (boolean) | Click element(s) |
| `{"type": "write", "text": "hello"}` | `text` | Type text |
| `{"type": "press", "key": "Enter"}` | `key` | Press keyboard key |
| `{"type": "scroll", "direction": "down"}` | `direction` (`"up"` or `"down"`), `selector` | Scroll page or element |
| `{"type": "screenshot"}` | `fullPage`, `quality`, `viewport` | Take screenshot |
| `{"type": "scrape"}` | - | Capture current page content |
| `{"type": "executeJavascript", "script": "..."}` | `script` | Execute JavaScript |
| `{"type": "pdf"}` | `landscape`, `scale`, `format` | Generate PDF |

---

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (missing/invalid API key) |
| 402 | Payment required (insufficient credits) |
| 408 | Request timeout |
| 429 | Rate limited |
| 500 | Internal server error |

---

## SDK Usage (JavaScript)

```javascript
import FirecrawlApp from "@mendable/firecrawl-js";

const firecrawl = new FirecrawlApp({
  apiKey: "fc-YOUR_API_KEY",
  apiUrl: "http://localhost:3002"  // your self-hosted instance
});

// Scrape
const scrapeResult = await firecrawl.scrapeUrl("https://example.com", {
  formats: ["markdown"],
});

// Crawl
const crawlResult = await firecrawl.crawlUrl("https://example.com", {
  limit: 100,
  scrapeOptions: { formats: ["markdown"] },
});

// Map
const mapResult = await firecrawl.mapUrl("https://example.com");

// Search
const searchResult = await firecrawl.search("web scraping tools", {
  limit: 5,
});

// Extract
const extractResult = await firecrawl.extract(["https://example.com"], {
  prompt: "Extract the company name",
  schema: { type: "object", properties: { company: { type: "string" } } },
});
```

---

## SDK Usage (Python)

```python
from firecrawl import FirecrawlApp

firecrawl = FirecrawlApp(
    api_key="fc-YOUR_API_KEY",
    api_url="http://localhost:3002"  # your self-hosted instance
)

# Scrape
result = firecrawl.scrape_url("https://example.com", params={"formats": ["markdown"]})

# Crawl
crawl = firecrawl.crawl_url("https://example.com", params={"limit": 100})

# Map
map_result = firecrawl.map_url("https://example.com")

# Search
search_result = firecrawl.search("web scraping tools", params={"limit": 5})

# Extract
extract_result = firecrawl.extract(
    ["https://example.com"],
    params={
        "prompt": "Extract the company name",
        "schema": {"type": "object", "properties": {"company": {"type": "string"}}}
    }
)
```

---

## Common Patterns for AI Agents

### Pattern 1: Research a topic
```
1. POST /v2/search  with query, scrapeOptions.formats=["markdown"]
2. Read the markdown content from results
3. Process with your LLM
```

### Pattern 2: Extract structured data from a known page
```
1. POST /v2/scrape  with url, formats=[{"type": "json", "schema": {...}, "prompt": "..."}]
2. Read data.json from response
```

### Pattern 3: Crawl and analyze a full site
```
1. POST /v2/map  to discover all URLs
2. POST /v2/batch/scrape  with the URLs you want
3. GET /v2/batch/scrape/:jobId  to poll for results
4. Process the scraped content
```

### Pattern 4: Extract data from multiple pages
```
1. POST /v2/extract  with urls, prompt, and schema
2. GET /v2/extract/:jobId  to poll for results (if async)
3. Read structured data from response
```

### Pattern 5: Interact with dynamic pages
```
1. POST /v2/scrape  with url and actions array
   actions: [
     {"type": "click", "selector": "#load-more"},
     {"type": "wait", "milliseconds": 2000},
     {"type": "scrape"}
   ]
2. Read the scraped content from the actions result
```
