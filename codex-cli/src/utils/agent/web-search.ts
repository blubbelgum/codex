/**
 * Web Search Tool for Agentic AI
 * 
 * Provides web search capabilities for finding real-time information,
 * documentation, solutions, and current knowledge that may not be
 * available in the AI model's training data.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  relevanceScore: number;
}

export interface WebSearchOptions {
  maxResults?: number;
  timeRange?: "day" | "week" | "month" | "year" | "all";
  searchType?: "general" | "news" | "academic" | "code" | "documentation";
  language?: string;
  region?: string;
}

export interface WebSearchQuery {
  query: string;
  context?: string;
  intent: "research" | "troubleshooting" | "documentation" | "examples" | "news" | "general";
  options?: WebSearchOptions;
}

export class WebSearchEngine {
  private apiKey?: string;
  private searchEngine: string;

  constructor(apiKey?: string, searchEngine: "google" | "bing" | "duckduckgo" = "duckduckgo") {
    this.apiKey = apiKey;
    this.searchEngine = searchEngine;
  }

  /**
   * Perform a web search with query processing
   */
  async search(searchQuery: WebSearchQuery): Promise<Array<WebSearchResult>> {
    const enhancedQuery = this.enhanceQuery(searchQuery);
    const options = {
      maxResults: 10,
      timeRange: "all" as const,
      searchType: "general" as const,
      ...searchQuery.options,
    };

    try {
      switch (this.searchEngine) {
        case "google":
          return await this.searchGoogle(enhancedQuery, options);
        case "bing":
          return await this.searchBing(enhancedQuery, options);
        case "duckduckgo":
        default:
          return await this.searchDuckDuckGo(enhancedQuery, options);
      }
    } catch (error) {
      console.error(`Web search failed: ${error}`);
      return [];
    }
  }

  /**
   * Search for programming-related content with enhanced filtering
   */
  async searchCode(query: string, language?: string, context?: string): Promise<Array<WebSearchResult>> {
    const searchQuery: WebSearchQuery = {
      query: this.buildCodeQuery(query, language),
      context,
      intent: "examples",
      options: {
        searchType: "code",
        maxResults: 8,
      },
    };

    return await this.search(searchQuery);
  }

  /**
   * Search for documentation with site-specific filtering
   */
  async searchDocumentation(query: string, sites?: Array<string>): Promise<Array<WebSearchResult>> {
    const enhancedQuery = this.buildDocumentationQuery(query, sites);
    
    const searchQuery: WebSearchQuery = {
      query: enhancedQuery,
      intent: "documentation",
      options: {
        searchType: "documentation",
        maxResults: 6,
      },
    };

    return await this.search(searchQuery);
  }

  /**
   * Search for troubleshooting and error solutions
   */
  async searchTroubleshooting(error: string, technology?: string): Promise<Array<WebSearchResult>> {
    const searchQuery: WebSearchQuery = {
      query: this.buildTroubleshootingQuery(error, technology),
      intent: "troubleshooting",
      options: {
        searchType: "general",
        maxResults: 8,
        timeRange: "year", // Recent solutions are usually better
      },
    };

    return await this.search(searchQuery);
  }

  /**
   * Get recent news and updates about technologies
   */
  async searchNews(topic: string, timeRange: "day" | "week" | "month" = "week"): Promise<Array<WebSearchResult>> {
    const searchQuery: WebSearchQuery = {
      query: `${topic} news updates releases`,
      intent: "news",
      options: {
        searchType: "news",
        maxResults: 5,
        timeRange,
      },
    };

    return await this.search(searchQuery);
  }

  private enhanceQuery(searchQuery: WebSearchQuery): string {
    let query = searchQuery.query;

    // Add intent-specific keywords
    switch (searchQuery.intent) {
      case "troubleshooting":
        query = `${query} error solution fix how to`;
        break;
      case "documentation":
        query = `${query} documentation docs guide api reference`;
        break;
      case "examples":
        query = `${query} example code sample tutorial`;
        break;
      case "research":
        query = `${query} research analysis study report`;
        break;
      case "news":
        query = `${query} news update release announcement`;
        break;
    }

    // Add context if provided
    if (searchQuery.context) {
      query = `${query} ${searchQuery.context}`;
    }

    return query.trim();
  }

  private buildCodeQuery(query: string, language?: string): string {
    let codeQuery = query;

    if (language) {
      codeQuery = `${language} ${codeQuery}`;
    }

    // Add code-specific sites
    const codeSites = [
      "site:stackoverflow.com",
      "site:github.com",
      "site:dev.to",
      "site:medium.com",
      "site:reddit.com/r/programming",
    ];

    return `${codeQuery} (${codeSites.join(" OR ")})`;
  }

  private buildDocumentationQuery(query: string, sites?: Array<string>): string {
    const defaultDocSites = [
      "site:developer.mozilla.org",
      "site:docs.microsoft.com",
      "site:nodejs.org",
      "site:reactjs.org",
      "site:typescriptlang.org",
      "site:python.org",
      "site:rust-lang.org",
      "site:golang.org",
    ];

    const targetSites = sites ? sites.map(site => `site:${site}`) : defaultDocSites;
    return `${query} (${targetSites.join(" OR ")})`;
  }

  private buildTroubleshootingQuery(error: string, technology?: string): string {
    let query = `"${error}"`;
    
    if (technology) {
      query = `${technology} ${query}`;
    }

    // Add troubleshooting sites
    const troubleshootingSites = [
      "site:stackoverflow.com",
      "site:github.com",
      "site:superuser.com",
      "site:serverfault.com",
      "site:askubuntu.com",
    ];

    return `${query} (${troubleshootingSites.join(" OR ")})`;
  }

  // Search engine implementations
  private async searchGoogle(query: string, options: WebSearchOptions): Promise<Array<WebSearchResult>> {
    if (!this.apiKey) {
      throw new Error("Google Custom Search API key required");
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      q: query,
      num: options.maxResults?.toString() || "10",
    });

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
    const data = await response.json();

    if (!data.items) {
      return [];
    }

    return data.items.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      date: item.pagemap?.metatags?.[0]?.["article:published_time"],
      relevanceScore: 0.8, // Google results are generally high quality
    }));
  }

  private async searchBing(query: string, options: WebSearchOptions): Promise<Array<WebSearchResult>> {
    if (!this.apiKey) {
      throw new Error("Bing Search API key required");
    }

    const params = new URLSearchParams({
      q: query,
      count: options.maxResults?.toString() || "10",
    });

    const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
      headers: {
        "Ocp-Apim-Subscription-Key": this.apiKey,
      },
    });

    const data = await response.json();

    if (!data.webPages?.value) {
      return [];
    }

    return data.webPages.value.map((item: any) => ({
      title: item.name,
      url: item.url,
      snippet: item.snippet,
      date: item.dateLastCrawled,
      relevanceScore: 0.8,
    }));
  }

  private async searchDuckDuckGo(query: string, _options: WebSearchOptions): Promise<Array<WebSearchResult>> {
    // Note: DuckDuckGo doesn't have an official API, so this is a simplified implementation
    // In a real implementation, you might use a proxy service or scraping approach
    
    // For now, return mock results to demonstrate the interface
    const mockResults: Array<WebSearchResult> = [
      {
        title: `Search results for: ${query}`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: "DuckDuckGo search results would appear here. This is a mock implementation.",
        relevanceScore: 0.6,
      },
    ];

    // Add a note about API limitations
    if (process.env["NODE_ENV"] !== "production") {
      console.log("Note: DuckDuckGo search is using mock data. Configure Google or Bing API for real results.");
    }

    return mockResults;
  }
}

/**
 * Factory function to create a web search engine based on available configuration
 */
export function createWebSearchEngine(): WebSearchEngine {
  // Check for API keys in environment variables
  const googleApiKey = process.env["GOOGLE_SEARCH_API_KEY"];
  const bingApiKey = process.env["BING_SEARCH_API_KEY"];

  if (googleApiKey) {
    return new WebSearchEngine(googleApiKey, "google");
  } else if (bingApiKey) {
    return new WebSearchEngine(bingApiKey, "bing");
  } else {
    // Fall back to DuckDuckGo (mock implementation)
    return new WebSearchEngine(undefined, "duckduckgo");
  }
}

/**
 * Smart web search that uses provider-native capabilities when available
 */
export async function smartWebSearch(
  query: string,
  options: {
    type?: "general" | "code" | "documentation" | "error" | "news";
    timeframe?: "recent" | "all";
    maxResults?: number;
    provider?: string; // Add provider parameter
  } = {}
): Promise<Array<WebSearchResult>> {
  const { provider = "openai", ...searchOptions } = options;
  
  // Use Gemini's native search capabilities when using Gemini provider
  if (provider.toLowerCase() === "gemini") {
    return await performGeminiNativeSearch(query, searchOptions);
  }
  
  // Fall back to custom search engines for other providers
  return await performCustomSearch(query, searchOptions);
}

/**
 * Use Gemini's native Google Search grounding capabilities via direct API call
 * This function calls the Gemini API directly to leverage native Google Search grounding
 * as documented at https://ai.google.dev/gemini-api/docs/grounding?lang=rest
 */
async function performGeminiNativeSearch(
  query: string,
  options: {
    type?: "general" | "code" | "documentation" | "error" | "news";
    timeframe?: "recent" | "all";
    maxResults?: number;
  }
): Promise<Array<WebSearchResult>> {

  
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    console.warn("GEMINI_API_KEY not found, falling back to custom search");
    return performCustomSearch(query, options);
  }

  try {
    // Call Gemini API directly with native Google Search grounding
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Search for information about: ${query}. ${
                    options.type === "news" ? "Focus on recent news and updates." :
                    options.type === "code" ? "Look for code examples and technical documentation." :
                    options.type === "error" ? "Find troubleshooting guides and error solutions." :
                    "Provide comprehensive and accurate information."
                  }`
                }
              ]
            }
          ],
          tools: [
            {
              google_search: {}
            }
          ]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Extract grounding metadata and convert to WebSearchResult format
    const results: Array<WebSearchResult> = [];
    
    if (data.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      const chunks = data.candidates[0].groundingMetadata.groundingChunks;
      const content = data.candidates[0].content?.parts?.[0]?.text || '';
      
      chunks.forEach((chunk: any, index: number) => {
        if (chunk.web) {
                     results.push({
             title: chunk.web.title || `Search Result ${index + 1}`,
             url: chunk.web.uri || '',
             snippet: content.substring(0, 500) + '...', // Extract relevant portion
             date: new Date().toISOString().split('T')[0], // Use current date as fallback
             relevanceScore: 0.9 // High relevance since it's from Gemini's grounding
           });
        }
      });
    }

    // If we got search results but no grounding chunks, create a general result
    if (results.length === 0 && data.candidates?.[0]?.content?.parts?.[0]?.text) {
      const content = data.candidates[0].content.parts[0].text;
             results.push({
         title: `Gemini Search: ${query}`,
         url: '',
         snippet: content,
         date: new Date().toISOString().split('T')[0],
         relevanceScore: 0.8 // Good relevance for general result
       });
    }

    console.log(`✅ Gemini native search returned ${results.length} results`);
    return results.slice(0, options.maxResults || 10);

  } catch (error) {
    console.error('❌ Gemini native search failed:', error);
    console.log("Falling back to custom search");
    return performCustomSearch(query, options);
  }
}

/**
 * Custom search implementation for non-Gemini providers
 */
async function performCustomSearch(
  query: string,
  options: {
    type?: "general" | "code" | "documentation" | "error" | "news";
    timeframe?: "recent" | "all";
    maxResults?: number;
  }
): Promise<Array<WebSearchResult>> {
  const engine = createWebSearchEngine();
    const searchQuery: WebSearchQuery = {
      query,
    intent: mapTypeToIntent(options.type),
      options: {
      maxResults: options.maxResults || 10,
      timeRange: options.timeframe === "recent" ? "week" : "all",
      searchType: mapTypeToSearchType(options.type),
      },
    };

  return await engine.search(searchQuery);
}

function mapTypeToIntent(type?: string): "general" | "research" | "troubleshooting" | "documentation" | "examples" | "news" {
  switch (type) {
    case "error": return "troubleshooting";
    case "code": return "examples";
    case "documentation": return "documentation";
    case "news": return "news";
    default: return "general";
  }
}

function mapTypeToSearchType(type?: string): "general" | "news" | "academic" | "code" | "documentation" {
  switch (type) {
    case "error": return "general"; // Error searches are general type
    case "code": return "code";
    case "documentation": return "documentation";
    case "news": return "news";
    default: return "general";
  }
}

/**
 * Format search results for display in the terminal
 */
export function formatSearchResults(results: Array<WebSearchResult>): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  const formatted = results.map((result, index) => {
    const title = `${index + 1}. ${result.title}`;
    const url = `   🔗 ${result.url}`;
    const snippet = `   📄 ${result.snippet}`;
    const score = `   ⭐ Relevance: ${Math.round(result.relevanceScore * 100)}%`;

    return [title, url, snippet, score].join("\n");
  });

  return formatted.join("\n\n");
} 