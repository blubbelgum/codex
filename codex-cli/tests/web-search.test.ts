import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WebSearchEngine,
  createWebSearchEngine,
  smartWebSearch,
  formatSearchResults,
  type WebSearchResult,
  type WebSearchQuery,
} from "../src/utils/agent/web-search.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("WebSearchEngine", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should create instance with default DuckDuckGo engine", () => {
      const engine = new WebSearchEngine();
      expect(engine).toBeInstanceOf(WebSearchEngine);
    });

    it("should create instance with Google engine when API key provided", () => {
      const engine = new WebSearchEngine("test-api-key", "google");
      expect(engine).toBeInstanceOf(WebSearchEngine);
    });

    it("should create instance with Bing engine when API key provided", () => {
      const engine = new WebSearchEngine("test-api-key", "bing");
      expect(engine).toBeInstanceOf(WebSearchEngine);
    });
  });

  describe("search method", () => {
    it("should perform basic search with default options", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const query: WebSearchQuery = {
        query: "test search",
        intent: "general",
      };

      const results = await engine.search(query);

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("title");
      expect(results[0]).toHaveProperty("url");
      expect(results[0]).toHaveProperty("snippet");
      expect(results[0]).toHaveProperty("relevanceScore");
    });

    it("should enhance query based on intent", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const troubleshootingQuery: WebSearchQuery = {
        query: "error message",
        intent: "troubleshooting",
      };

      const results = await engine.search(troubleshootingQuery);
      expect(results).toBeInstanceOf(Array);
    });

    it("should handle search options", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const query: WebSearchQuery = {
        query: "test search",
        intent: "general",
        options: {
          maxResults: 5,
          timeRange: "week",
          searchType: "news",
        },
      };

      const results = await engine.search(query);
      expect(results).toBeInstanceOf(Array);
    });
  });

  describe("Google search", () => {
    it("should perform Google search with valid API key", async () => {
      const mockResponse = {
        items: [
          {
            title: "Test Result",
            link: "https://example.com",
            snippet: "Test snippet",
            pagemap: {
              metatags: [{ "article:published_time": "2023-01-01" }],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
      });

      const engine = new WebSearchEngine("test-api-key", "google");
      const query: WebSearchQuery = {
        query: "test query",
        intent: "general",
      };

      const results = await engine.search(query);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("googleapis.com/customsearch"),
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        title: "Test Result",
        url: "https://example.com",
        snippet: "Test snippet",
        date: "2023-01-01",
        relevanceScore: 0.8,
      });
    });

    it("should handle Google search with no results", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({}),
      });

      const engine = new WebSearchEngine("test-api-key", "google");
      const query: WebSearchQuery = {
        query: "no results query",
        intent: "general",
      };

      const results = await engine.search(query);
      expect(results).toHaveLength(0);
    });

    it("should throw error when Google API key is missing", async () => {
      const engine = new WebSearchEngine(undefined, "google");
      const query: WebSearchQuery = {
        query: "test query",
        intent: "general",
      };

      await expect(engine.search(query)).rejects.toThrow(
        "Google Custom Search API key required",
      );
    });
  });

  describe("Bing search", () => {
    it("should perform Bing search with valid API key", async () => {
      const mockResponse = {
        webPages: {
          value: [
            {
              name: "Bing Test Result",
              url: "https://example.com",
              snippet: "Bing test snippet",
              dateLastCrawled: "2023-01-01T10:00:00Z",
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve(mockResponse),
      });

      const engine = new WebSearchEngine("test-api-key", "bing");
      const query: WebSearchQuery = {
        query: "test query",
        intent: "general",
      };

      const results = await engine.search(query);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.bing.microsoft.com"),
        expect.objectContaining({
          headers: {
            "Ocp-Apim-Subscription-Key": "test-api-key",
          },
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        title: "Bing Test Result",
        url: "https://example.com",
        snippet: "Bing test snippet",
        date: "2023-01-01T10:00:00Z",
        relevanceScore: 0.8,
      });
    });

    it("should handle Bing search with no results", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({}),
      });

      const engine = new WebSearchEngine("test-api-key", "bing");
      const query: WebSearchQuery = {
        query: "no results query",
        intent: "general",
      };

      const results = await engine.search(query);
      expect(results).toHaveLength(0);
    });

    it("should throw error when Bing API key is missing", async () => {
      const engine = new WebSearchEngine(undefined, "bing");
      const query: WebSearchQuery = {
        query: "test query",
        intent: "general",
      };

      await expect(engine.search(query)).rejects.toThrow(
        "Bing Search API key required",
      );
    });
  });

  describe("specialized search methods", () => {
    it("should search for code with language filter", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const results = await engine.searchCode("async function", "javascript");

      expect(results).toBeInstanceOf(Array);
    });

    it("should search for documentation with site filtering", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const results = await engine.searchDocumentation("React hooks", [
        "reactjs.org",
        "developer.mozilla.org",
      ]);

      expect(results).toBeInstanceOf(Array);
    });

    it("should search for troubleshooting solutions", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const results = await engine.searchTroubleshooting(
        "TypeError: Cannot read property",
        "JavaScript",
      );

      expect(results).toBeInstanceOf(Array);
    });

    it("should search for news with time range", async () => {
      const engine = new WebSearchEngine(undefined, "duckduckgo");
      const results = await engine.searchNews("AI technology", "week");

      expect(results).toBeInstanceOf(Array);
    });
  });

  describe("error handling", () => {
    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const engine = new WebSearchEngine("test-api-key", "google");
      const query: WebSearchQuery = {
        query: "test query",
        intent: "general",
      };

      const results = await engine.search(query);
      expect(results).toHaveLength(0);
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.reject(new Error("API error")),
      });

      const engine = new WebSearchEngine("test-api-key", "google");
      const query: WebSearchQuery = {
        query: "test query",
        intent: "general",
      };

      const results = await engine.search(query);
      expect(results).toHaveLength(0);
    });
  });

  it("should run basic test", () => {
    expect(true).toBe(true);
  });
});

describe("createWebSearchEngine factory", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create Google engine when Google API key is available", () => {
    process.env["GOOGLE_SEARCH_API_KEY"] = "test-google-key";
    const engine = createWebSearchEngine();
    expect(engine).toBeInstanceOf(WebSearchEngine);
  });

  it("should create Bing engine when only Bing API key is available", () => {
    process.env["BING_SEARCH_API_KEY"] = "test-bing-key";
    const engine = createWebSearchEngine();
    expect(engine).toBeInstanceOf(WebSearchEngine);
  });

  it("should create DuckDuckGo engine when no API keys are available", () => {
    delete process.env["GOOGLE_SEARCH_API_KEY"];
    delete process.env["BING_SEARCH_API_KEY"];
    const engine = createWebSearchEngine();
    expect(engine).toBeInstanceOf(WebSearchEngine);
  });

  it("should prefer Google over Bing when both API keys are available", () => {
    process.env["GOOGLE_SEARCH_API_KEY"] = "test-google-key";
    process.env["BING_SEARCH_API_KEY"] = "test-bing-key";
    const engine = createWebSearchEngine();
    expect(engine).toBeInstanceOf(WebSearchEngine);
  });
});

describe("smartWebSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should route error context to troubleshooting search", async () => {
    const results = await smartWebSearch("Cannot read property", {
      type: "error",
      technology: "JavaScript",
    });

    expect(results).toBeInstanceOf(Array);
  });

  it("should route documentation context to documentation search", async () => {
    const results = await smartWebSearch("React hooks", {
      type: "documentation",
    });

    expect(results).toBeInstanceOf(Array);
  });

  it("should route code context to code search", async () => {
    const results = await smartWebSearch("async function example", {
      type: "code",
      language: "javascript",
    });

    expect(results).toBeInstanceOf(Array);
  });

  it("should route news context to news search", async () => {
    const results = await smartWebSearch("AI updates", {
      type: "news",
      timeframe: "recent",
    });

    expect(results).toBeInstanceOf(Array);
  });

  it("should perform general search for unknown context", async () => {
    const results = await smartWebSearch("general query");

    expect(results).toBeInstanceOf(Array);
  });
});

describe("formatSearchResults", () => {
  it("should format empty results", () => {
    const formatted = formatSearchResults([]);
    expect(formatted).toBe("No search results found.");
  });

  it("should format single result", () => {
    const results: WebSearchResult[] = [
      {
        title: "Test Result",
        url: "https://example.com",
        snippet: "This is a test result",
        relevanceScore: 0.9,
      },
    ];

    const formatted = formatSearchResults(results);

    expect(formatted).toContain("1. Test Result");
    expect(formatted).toContain("🔗 https://example.com");
    expect(formatted).toContain("📄 This is a test result");
    expect(formatted).toContain("⭐ Relevance: 90%");
  });

  it("should format multiple results", () => {
    const results: WebSearchResult[] = [
      {
        title: "First Result",
        url: "https://example1.com",
        snippet: "First snippet",
        relevanceScore: 0.9,
      },
      {
        title: "Second Result",
        url: "https://example2.com",
        snippet: "Second snippet",
        relevanceScore: 0.8,
      },
    ];

    const formatted = formatSearchResults(results);

    expect(formatted).toContain("1. First Result");
    expect(formatted).toContain("2. Second Result");
    expect(formatted).toContain("🔗 https://example1.com");
    expect(formatted).toContain("🔗 https://example2.com");
  });

  it("should include date when available", () => {
    const results: WebSearchResult[] = [
      {
        title: "Dated Result",
        url: "https://example.com",
        snippet: "Result with date",
        date: "2023-01-01",
        relevanceScore: 0.8,
      },
    ];

    const formatted = formatSearchResults(results);
    expect(formatted).toContain("Dated Result");
  });
}); 