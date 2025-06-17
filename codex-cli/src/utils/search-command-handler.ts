import { smartWebSearch } from "./agent/web-search.js";
import fs from "fs/promises";
import path from "path";

export interface SearchCommandOptions {
  query: string;
  saveToFile?: string;
  format?: "markdown" | "json" | "text";
  includeLinks?: boolean;
  maxResults?: number;
}

/**
 * Execute a hybrid search: direct Gemini API call for search, then AI for processing
 */
export async function executeHybridSearch(
  options: SearchCommandOptions,
  provider: string = "gemini"
): Promise<{
  searchResults: Array<{
    title: string;
    snippet: string;
    url?: string;
    date?: string;
    relevanceScore: number;
  }>;
  searchSummary?: string;
  errorMessage?: string;
}> {
  try {
    // Call Gemini API directly for search using native grounding
    const searchResults = await smartWebSearch(options.query, {
      type: "general",
      timeframe: "all", 
      maxResults: options.maxResults || 10,
      provider: provider, // This will trigger Gemini native search if provider is "gemini"
    });
    
    return {
      searchResults: searchResults.map(result => ({
        title: result.title,
        snippet: result.snippet,
        url: result.url,
        date: result.date,
        relevanceScore: result.relevanceScore,
      })),
    };
    
  } catch (error) {
    return {
      searchResults: [],
      errorMessage: error instanceof Error ? error.message : "Unknown search error",
    };
  }
}

/**
 * Generate a prompt for the AI to summarize and process search results
 */
export function generateSummarizationPrompt(
  originalQuery: string,
  searchResults: Array<{
    title: string;
    snippet: string;
    url?: string;
    date?: string;
  }>,
  saveToFile?: string
): string {
  let prompt = `I searched for "${originalQuery}" and found ${searchResults.length} results. Please summarize and organize these findings:\n\n`;
  
  searchResults.forEach((result, index) => {
    prompt += `${index + 1}. **${result.title}**\n`;
    prompt += `   ${result.snippet}\n`;
    if (result.url) {
      prompt += `   Source: ${result.url}\n`;
    }
    if (result.date) {
      prompt += `   Date: ${result.date}\n`;
    }
    prompt += `\n`;
  });
  
  prompt += `\nPlease provide a comprehensive summary that:\n`;
  prompt += `- Synthesizes the key information from all sources\n`;
  prompt += `- Organizes findings into logical sections\n`;
  prompt += `- Includes relevant quotes and citations\n`;
  prompt += `- Highlights the most important insights\n`;
  
  if (saveToFile) {
    prompt += `\nAfter creating the summary, please save it to "${saveToFile}" using the shell tool with this format:\n`;
    prompt += `{"command": ["bash", "-c", "cat > ${saveToFile} << 'EOF'\\n<your_markdown_content>\\nEOF"]}\n`;
    prompt += `Make sure to format the content as clean markdown with proper headers and links.`;
  }
  
  return prompt;
}

/**
 * Parse /search command to extract query and options
 */
export function parseSearchCommand(input: string): SearchCommandOptions | null {
  // Remove /search prefix
  const searchContent = input.replace(/^\/search\s+/, "").trim();
  
  if (!searchContent) {
    return null;
  }

  // Simple parsing for now - look for common patterns
  const options: SearchCommandOptions = {
    query: searchContent,
    format: "markdown",
    includeLinks: true,
    maxResults: 10,
  };

  // Check for "save to" or "save into" patterns
  const saveToPattern = /(?:save|write)(?:\s+(?:it\s+)?(?:to|into|in))?\s+([^\s]+\.md)/i;
  const saveMatch = searchContent.match(saveToPattern);
  
  if (saveMatch && saveMatch[1]) {
    options.saveToFile = saveMatch[1];
    // Remove the save instruction from the query
    const fullSavePattern = new RegExp(`\\s*(?:save|write)(?:\\s+(?:it\\s+)?(?:to|into|in))?\\s+${saveMatch[1].replace('.', '\\.')}`, 'i');
    options.query = searchContent.replace(fullSavePattern, "").trim();
  }

  return options;
}

/**
 * Format search results as markdown
 */
export function formatSearchResultsAsMarkdown(
  query: string,
  results: Array<{
    title: string;
    snippet: string;
    url?: string;
    publishedDate?: string;
  }>,
  includeMetadata: boolean = true
): string {
  const timestamp = new Date().toLocaleString();
  
  let markdown = `# Search Results: ${query}\n\n`;
  
  if (includeMetadata) {
    markdown += `*Generated on: ${timestamp}*\n\n`;
    markdown += `*Found ${results.length} results*\n\n`;
  }
  
  results.forEach((result, index) => {
    markdown += `## ${index + 1}. ${result.title}\n\n`;
    markdown += `${result.snippet}\n\n`;
    
    if (result.url) {
      markdown += `**Source:** [${result.url}](${result.url})\n\n`;
    }
    
    if (result.publishedDate) {
      markdown += `**Published:** ${result.publishedDate}\n\n`;
    }
    
    markdown += "---\n\n";
  });
  
  return markdown;
}

/**
 * Save content to a markdown file
 */
export async function saveToMarkdownFile(
  content: string,
  filename: string,
  overwrite: boolean = false
): Promise<{ success: boolean; message: string; filePath: string }> {
  try {
    // Ensure filename has .md extension
    if (!filename.endsWith(".md")) {
      filename += ".md";
    }
    
    // Resolve to current working directory
    const filePath = path.resolve(process.cwd(), filename);
    
    // Check if file exists and handle accordingly
    if (!overwrite) {
      try {
        await fs.access(filePath);
        return {
          success: false,
          message: `File ${filename} already exists. Use overwrite option to replace it.`,
          filePath,
        };
      } catch {
        // File doesn't exist, which is good for new file creation
      }
    }
    
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write the file
    await fs.writeFile(filePath, content, "utf-8");
    
    return {
      success: true,
      message: `Successfully saved search results to ${filename}`,
      filePath,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to save file: ${error instanceof Error ? error.message : String(error)}`,
      filePath: filename,
    };
  }
}

/**
 * Generate enhanced search prompt for the AI model
 */
export function generateSearchPrompt(options: SearchCommandOptions): string {
  let prompt = `Please search for: "${options.query}"`;
  
  if (options.saveToFile) {
    prompt += `\n\nAfter gathering the search results, please:
1. Summarize and organize the findings in markdown format
2. Include relevant links and sources
3. Save the results to a file named "${options.saveToFile}"
4. Use the shell tool to create the file with the formatted content

IMPORTANT: When using the shell tool, use this exact format:
{"command": ["bash", "-c", "cat > ${options.saveToFile} << 'EOF'\\n<your_markdown_content>\\nEOF"]}

This will safely write multiline markdown content to the file.`;
  }
  
  if (options.maxResults && options.maxResults !== 10) {
    prompt += `\n\nLimit results to ${options.maxResults} most relevant items.`;
  }
  
  prompt += `\n\nUse the web_search tool to find current information, then format and present the results clearly.`;
  
  return prompt;
} 