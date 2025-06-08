import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";

// Mock the web search and file system
vi.mock("fs/promises");
vi.mock("../src/utils/agent/web-search.js", () => ({
  smartWebSearch: vi.fn(),
  formatSearchResults: vi.fn(),
}));

describe("Search Command Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("/search command parsing and execution", () => {
    it("should parse and execute search with file save", async () => {
      // Mock file operations
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const { parseSearchCommand, generateSearchPrompt } = await import("../src/utils/search-command-handler.js");
      
      // Test parsing
      const searchOptions = parseSearchCommand("/search latest AI developments save to ai-developments.md");
      expect(searchOptions).toBeTruthy();
      expect(searchOptions?.query).toBe("latest AI developments");
      expect(searchOptions?.saveToFile).toBe("ai-developments.md");

      // Test prompt generation
      const prompt = generateSearchPrompt(searchOptions!);
      expect(prompt).toContain("latest AI developments");
      expect(prompt).toContain("ai-developments.md");
      expect(prompt).toContain("web_search tool");
    });

    it("should handle search without file save", async () => {
      const { parseSearchCommand, generateSearchPrompt } = await import("../src/utils/search-command-handler.js");
      
      const searchOptions = parseSearchCommand("/search machine learning trends 2024");
      expect(searchOptions?.query).toBe("machine learning trends 2024");
      expect(searchOptions?.saveToFile).toBeUndefined();

      const prompt = generateSearchPrompt(searchOptions!);
      expect(prompt).toContain("machine learning trends 2024");
      expect(prompt).not.toContain("Save the results to a file");
    });

    it("should format markdown correctly", async () => {
      const { formatSearchResultsAsMarkdown } = await import("../src/utils/search-command-handler.js");
      
      const mockResults = [
        {
          title: "AI Revolution in 2024",
          snippet: "Artificial Intelligence continues to transform industries...",
          url: "https://ai-news.com/revolution-2024",
          publishedDate: "2024-01-20",
        },
        {
          title: "Machine Learning Breakthroughs",
          snippet: "New ML algorithms showing impressive results...",
          url: "https://ml-research.com/breakthroughs",
        },
      ];

      const markdown = formatSearchResultsAsMarkdown("AI news 2024", mockResults);
      
      expect(markdown).toContain("# Search Results: AI news 2024");
      expect(markdown).toContain("## 1. AI Revolution in 2024");
      expect(markdown).toContain("## 2. Machine Learning Breakthroughs");
      expect(markdown).toContain("Artificial Intelligence continues to transform");
      expect(markdown).toContain("**Source:** [https://ai-news.com/revolution-2024]");
      expect(markdown).toContain("**Published:** 2024-01-20");
      expect(markdown).toContain("---");
    });
  });

  describe("File saving functionality", () => {
    it("should save markdown file successfully", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const { saveToMarkdownFile } = await import("../src/utils/search-command-handler.js");
      
      const content = "# AI News Summary\n\nTest content here...";
      const result = await saveToMarkdownFile(content, "ai-summary.md");

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully saved");
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("ai-summary.md"),
        content,
        "utf-8"
      );
    });

    it("should handle file conflicts", async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists

      const { saveToMarkdownFile } = await import("../src/utils/search-command-handler.js");
      
      const content = "# Test Content";
      const result = await saveToMarkdownFile(content, "existing-file.md");

      expect(result.success).toBe(false);
      expect(result.message).toContain("already exists");
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("End-to-end scenarios", () => {
    it("should handle complex search query with markdown output", async () => {
      const { 
        parseSearchCommand, 
        generateSearchPrompt, 
        formatSearchResultsAsMarkdown,
        saveToMarkdownFile 
      } = await import("../src/utils/search-command-handler.js");

      // Mock successful file operations
      vi.mocked(fs.access).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // Complex query example
      const command = "/search summary all AI news today and save it into ai-news-today.md";
      
      // Parse the command
      const options = parseSearchCommand(command);
      expect(options?.query).toBe("summary all AI news today and");
      expect(options?.saveToFile).toBe("ai-news-today.md");

      // Generate search prompt
      const prompt = generateSearchPrompt(options!);
      expect(prompt).toContain("summary all AI news today");
      expect(prompt).toContain("ai-news-today.md");

      // Simulate search results
      const mockResults = [
        {
          title: "OpenAI Announces GPT-5",
          snippet: "OpenAI today unveiled GPT-5, their most advanced AI model...",
          url: "https://openai.com/gpt5-announcement",
          publishedDate: "2024-01-20",
        },
        {
          title: "Google's Gemini Update",
          snippet: "Google releases major update to Gemini AI system...",
          url: "https://google.com/gemini-update",
          publishedDate: "2024-01-20",
        },
      ];

      // Format as markdown
      const markdown = formatSearchResultsAsMarkdown(options!.query, mockResults);
      expect(markdown).toContain("# Search Results:");
      expect(markdown).toContain("OpenAI Announces GPT-5");
      expect(markdown).toContain("Google's Gemini Update");

      // Save to file
      const saveResult = await saveToMarkdownFile(markdown, options!.saveToFile!);
      expect(saveResult.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("ai-news-today.md"),
        markdown,
        "utf-8"
      );
    });
  });
}); 