import axios from "axios";
import { config } from "../../config";
import { SearchV2Response, WebSearchResult } from "../../lib/entities";
import { logger } from "../../lib/logger";

interface BraveSearchOptions {
  num_results: number;
  tbs?: string;
  lang?: string;
  country?: string;
}

export async function braveSearch(
  q: string,
  options: BraveSearchOptions,
): Promise<SearchV2Response> {
  const params: Record<string, string> = {
    q,
    count: String(Math.min(options.num_results, 20)),
  };

  if (options.country) {
    params.country = options.country.toUpperCase();
  }

  if (options.lang) {
    params.search_lang = options.lang;
  }

  if (options.tbs) {
    const freshnessMap: Record<string, string> = {
      d: "pd",
      w: "pw",
      m: "pm",
      y: "py",
    };
    if (freshnessMap[options.tbs]) {
      params.freshness = freshnessMap[options.tbs];
    }
  }

  try {
    const response = await axios.get(
      "https://api.search.brave.com/res/v1/web/search",
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": config.BRAVE_SEARCH_API_KEY!,
        },
        params,
        timeout: 10000,
      },
    );

    const data = response.data;
    const webResults: WebSearchResult[] = [];

    if (data.web?.results && Array.isArray(data.web.results)) {
      for (const r of data.web.results) {
        webResults.push({
          url: r.url,
          title: r.title,
          description: r.description || "",
        });
      }
    }

    return webResults.length > 0 ? { web: webResults } : {};
  } catch (error: any) {
    if (error.response?.status === 429) {
      logger.warn("Brave Search: rate limited", { query: q });
    } else {
      logger.error("Brave Search error", { error: error.message, query: q });
    }
    return {};
  }
}
