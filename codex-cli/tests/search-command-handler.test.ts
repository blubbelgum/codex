import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import { 
  parseSearchCommand, 
  formatSearchResultsAsMarkdown, 
  saveToMarkdownFile, 
  generateSearchPrompt 
} from "../src/utils/search-command-handler.js";

// Mock fs module
vi.mock("fs/promises");

describe("Search Command Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseSearchCommand", () => {
    it("should parse basic search command", () => {
      const result = parseSearchCommand("/search AI news today");
      expect(result).toEqual({
        query: "AI news today",
        format: "markdown",
        includeLinks: true,
        maxResults: 10,
      });
    });

    it("should parse search command with save file", () => {
      const result = parseSearchCommand("/search AI trends save to ai-trends.md");
      expect(result).toEqual({
        query: "AI trends",
        saveToFile: "ai-trends.md",
        format: "markdown",
        includeLinks: true,
        maxResults: 10,
      });
    });

    it("should parse search command with 'save into' syntax", () => {
      const result = parseSearchCommand("/search latest crypto news save into crypto.md");
      expect(result).toEqual({
        query: "latest crypto news",
        saveToFile: "crypto.md",
        format: "markdown",
        includeLinks: true,
        maxResults: 10,
      });
    });

    it("should parse search command with 'write to' syntax", () => {
      const result = parseSearchCommand("/search machine learning write to ml-research.md");
      expect(result).toEqual({
        query: "machine learning",
        saveToFile: "ml-research.md",
        format: "markdown",
        includeLinks: true,
        maxResults: 10,
      });
    });

    it("should handle complex queries with punctuation", () => {
      const result = parseSearchCommand("/search \"best AI tools 2024\" review and comparison save results.md");
      expect(result?.query).toBe('"best AI tools 2024" review and comparison');
      expect(result?.saveToFile).toBe("results.md");
    });

    it("should return null for empty search", () => {
      const result = parseSearchCommand("/search ");
      expect(result).toBeNull();
    });

    it("should handle search without /search prefix (edge case)", () => {
      const result = parseSearchCommand("AI news today");
      expect(result?.query).toBe("AI news today");
    });
  });

  describe("formatSearchResultsAsMarkdown", () => {
    const mockResults = [
      {
        title: "AI Breakthrough 2024",
        snippet: "Revolutionary AI development announced today...",
        url: "https://example.com/ai-news",
        publishedDate: "2024-01-15",
      },
      {
        title: "Machine Learning Advances",
        snippet: "New ML techniques show promising results...",
        url: "https://example.com/ml-news",
      },
    ];

    it("should format search results as markdown with metadata", () => {
      const result = formatSearchResultsAsMarkdown("AI news", mockResults, true);
      
      expect(result).toContain("# Search Results: AI news");
      expect(result).toContain("*Generated on:");
      expect(result).toContain("*Found 2 results*");
      expect(result).toContain("## 1. AI Breakthrough 2024");
      expect(result).toContain("Revolutionary AI development announced today...");
      expect(result).toContain("**Source:** [https://example.com/ai-news](https://example.com/ai-news)");
      expect(result).toContain("**Published:** 2024-01-15");
      expect(result).toContain("## 2. Machine Learning Advances");
      expect(result).toContain("---");
    });

    it("should format search results without metadata", () => {
      const result = formatSearchResultsAsMarkdown("AI news", mockResults, false);
      
      expect(result).toContain("# Search Results: AI news");
      expect(result).not.toContain("*Generated on:");
      expect(result).not.toContain("*Found 2 results*");
      expect(result).toContain("## 1. AI Breakthrough 2024");
    });

    it("should handle results without URLs or dates", () => {
      const minimalResults = [
        {
          title: "Simple Result",
          snippet: "Basic content without links",
        },
      ];
      
      const result = formatSearchResultsAsMarkdown("test", minimalResults);
      expect(result).toContain("## 1. Simple Result");
      expect(result).toContain("Basic content without links");
      expect(result).not.toContain("**Source:**");
      expect(result).not.toContain("**Published:**");
    });

    it("should handle empty results", () => {
      const result = formatSearchResultsAsMarkdown("empty query", []);
      expect(result).toContain("# Search Results: empty query");
      expect(result).toContain("*Found 0 results*");
    });
  });

  describe("saveToMarkdownFile", () => {
    const mockContent = "# Test Content\n\nSample markdown content.";

    beforeEach(() => {
      // Reset mocks
      vi.mocked(fs.access).mockReset();
      vi.mocked(fs.mkdir).mockReset();
      vi.mocked(fs.writeFile).mockReset();
    });

    it("should save content to markdown file successfully", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await saveToMarkdownFile(mockContent, "test.md");

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully saved");
      expect(result.filePath).toContain("test.md");
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("test.md"),
        mockContent,
        "utf-8"
      );
    });

    it("should add .md extension if missing", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveToMarkdownFile(mockContent, "test");

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("test.md"),
        mockContent,
        "utf-8"
      );
    });

    it("should prevent overwriting existing files by default", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists

      const result = await saveToMarkdownFile(mockContent, "existing.md");

      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it("should allow overwriting when specified", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await saveToMarkdownFile(mockContent, "existing.md", true);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should create directory if it doesn't exist", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveToMarkdownFile(mockContent, "nested/path/test.md");

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/nested[\\/]path/),
        { recursive: true }
      );
    });

    it("should handle file write errors", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockRejectedValue(new Error("Permission denied"));

      const result = await saveToMarkdownFile(mockContent, "test.md");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to save file");
      expect(result.message).toContain("Permission denied");
    });
  });

  describe("generateSearchPrompt", () => {
    it("should generate basic search prompt", () => {
      const options = {
        query: "AI trends 2024",
        format: "markdown" as const,
        includeLinks: true,
        maxResults: 10,
      };

      const prompt = generateSearchPrompt(options);

      expect(prompt).toContain('Please search for: "AI trends 2024"');
      expect(prompt).toContain("Use the web_search tool");
    });

    it("should include file saving instructions", () => {
      const options = {
        query: "latest tech news",
        saveToFile: "tech-news.md",
        format: "markdown" as const,
        includeLinks: true,
        maxResults: 10,
      };

      const prompt = generateSearchPrompt(options);

      expect(prompt).toContain('Please search for: "latest tech news"');
      expect(prompt).toContain("After gathering the search results");
      expect(prompt).toContain("tech-news.md");
      expect(prompt).toContain("Summarize and organize");
      expect(prompt).toContain("bash");
    });

    it("should include custom result limits", () => {
      const options = {
        query: "cryptocurrency news",
        format: "markdown" as const,
        includeLinks: true,
        maxResults: 5,
      };

      const prompt = generateSearchPrompt(options);

      expect(prompt).toContain("Limit results to 5 most relevant items");
    });

    it("should not include limit instruction for default value", () => {
      const options = {
        query: "test query",
        format: "markdown" as const,
        includeLinks: true,
        maxResults: 10,
      };

      const prompt = generateSearchPrompt(options);

      expect(prompt).not.toContain("Limit results to");
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete search workflow", () => {
      // Parse command
      const searchOptions = parseSearchCommand("/search latest AI developments save to ai-report.md");
      expect(searchOptions).not.toBeNull();
      
      // Generate prompt
      const prompt = generateSearchPrompt(searchOptions!);
      expect(prompt).toContain("latest AI developments");
      expect(prompt).toContain("ai-report.md");
      
      // Format results
      const mockResults = [
        {
          title: "AI Breakthrough",
          snippet: "New AI model released...",
          url: "https://ai-news.com/breakthrough",
        },
      ];
      
      const markdown = formatSearchResultsAsMarkdown(searchOptions!.query, mockResults);
      expect(markdown).toContain("# Search Results: latest AI developments");
      expect(markdown).toContain("AI Breakthrough");
    });

    it("should handle search without file saving", () => {
      const searchOptions = parseSearchCommand("/search quantum computing advances");
      expect(searchOptions?.saveToFile).toBeUndefined();
      
      const prompt = generateSearchPrompt(searchOptions!);
      expect(prompt).not.toContain("Save the results to a file");
      expect(prompt).toContain("quantum computing advances");
    });
  });
}); 