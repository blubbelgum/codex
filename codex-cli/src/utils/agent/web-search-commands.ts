/**
 * Command handlers for web search functionality
 * 
 * Provides command-line interface for different types of web searches
 * that can be executed from the agentic tool palette.
 */

import { smartWebSearch, formatSearchResults, createWebSearchEngine } from "./web-search.js";

export interface SearchCommandResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Handle documentation search command
 * Usage: search-docs "Node.js async await"
 */
export async function handleSearchDocs(query: string): Promise<SearchCommandResult> {
  try {
    console.log(`🔍 Searching documentation for: ${query}`);
    
    const results = await smartWebSearch(query, {
      type: "documentation",
      timeframe: "all",
    });

    const output = [
      `📚 Documentation Search Results for: "${query}"`,
      "=" .repeat(50),
      formatSearchResults(results),
      "",
      "💡 Tip: Use specific technology names for better results",
    ].join("\n");

    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      output: "Failed to search documentation",
      error: String(error),
    };
  }
}

/**
 * Handle code examples search command
 * Usage: search-code "React useEffect cleanup function"
 */
export async function handleSearchCode(query: string, language?: string): Promise<SearchCommandResult> {
  try {
    console.log(`🔍 Searching code examples for: ${query}`);
    
    const searchEngine = createWebSearchEngine();
    const results = await searchEngine.searchCode(query, language);

    const output = [
      `💻 Code Examples Search Results for: "${query}"`,
      language ? `Language: ${language}` : "",
      "=" .repeat(50),
      formatSearchResults(results),
      "",
      "💡 Tip: Include programming language for better results",
    ].join("\n");

    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      output: "Failed to search code examples",
      error: String(error),
    };
  }
}

/**
 * Handle error/troubleshooting search command
 * Usage: search-error "ENOENT: no such file or directory"
 */
export async function handleSearchError(errorQuery: string, technology?: string): Promise<SearchCommandResult> {
  try {
    console.log(`🔍 Searching solutions for error: ${errorQuery}`);
    
    const searchEngine = createWebSearchEngine();
    const results = await searchEngine.searchTroubleshooting(errorQuery, technology);

    const output = [
      `🐛 Error Solutions Search Results for: "${errorQuery}"`,
      technology ? `Technology: ${technology}` : "",
      "=" .repeat(50),
      formatSearchResults(results),
      "",
      "💡 Tip: Include exact error messages for better solutions",
    ].join("\n");

    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      output: "Failed to search error solutions",
      error: String(error),
    };
  }
}

/**
 * Handle research search command
 * Usage: search-research "React Server Components 2024"
 */
export async function handleSearchResearch(query: string): Promise<SearchCommandResult> {
  try {
    console.log(`🔍 Researching: ${query}`);
    
    const results = await smartWebSearch(query, {
      type: "general",
      timeframe: "recent",
    });

    const output = [
      `📊 Research Results for: "${query}"`,
      "=" .repeat(50),
      formatSearchResults(results),
      "",
      "💡 Tip: Use specific terms and current year for latest information",
    ].join("\n");

    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      output: "Failed to search research",
      error: String(error),
    };
  }
}

/**
 * Handle news search command
 * Usage: search-news "TypeScript 5.4 release"
 */
export async function handleSearchNews(query: string, timeRange: "day" | "week" | "month" = "week"): Promise<SearchCommandResult> {
  try {
    console.log(`🔍 Searching news for: ${query}`);
    
    const searchEngine = createWebSearchEngine();
    const results = await searchEngine.searchNews(query, timeRange);

    const output = [
      `📰 News Search Results for: "${query}"`,
      `Time Range: Last ${timeRange}`,
      "=" .repeat(50),
      formatSearchResults(results),
      "",
      "💡 Tip: Search for specific technology names and version numbers",
    ].join("\n");

    return {
      success: true,
      output,
    };
  } catch (error) {
    return {
      success: false,
      output: "Failed to search news",
      error: String(error),
    };
  }
}

/**
 * Parse and execute web search commands
 */
export async function executeWebSearchCommand(command: string): Promise<SearchCommandResult> {
  const parts = command.trim().split(" ");
  const searchType = parts[0];
  const query = parts.slice(1).join(" ").replace(/^["']|["']$/g, ""); // Remove quotes

  switch (searchType) {
    case "search-docs":
      return await handleSearchDocs(query);
    
    case "search-code":
      return await handleSearchCode(query);
    
    case "search-error":
      return await handleSearchError(query);
    
    case "search-research":
      return await handleSearchResearch(query);
    
    case "search-news":
      return await handleSearchNews(query);
    
    default:
      return {
        success: false,
        output: `Unknown search command: ${searchType}`,
        error: `Supported commands: search-docs, search-code, search-error, search-research, search-news`,
      };
  }
}

/**
 * Get help information for web search commands
 */
export function getWebSearchCommandHelp(): string {
  return `
🔍 Web Search Commands:

📚 search-docs "query"      - Search official documentation
💻 search-code "query"      - Search code examples and tutorials  
🐛 search-error "error"     - Search solutions for specific errors
📊 search-research "topic"  - Research trends and analysis
📰 search-news "topic"      - Search recent news and updates

Examples:
  search-docs "React useEffect hooks"
  search-code "Python async await examples"
  search-error "TypeError: Cannot read property"
  search-research "Next.js 14 performance improvements"
  search-news "Node.js 20 LTS release"

💡 Tips:
- Use specific terms for better results
- Include technology names and versions
- Quote multi-word queries
- For errors, include exact error messages
`.trim();
} 