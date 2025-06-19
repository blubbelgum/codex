import { log } from '../logger/log';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cline-style SEARCH/REPLACE diff handler
 * 
 * Supports the format:
 * ------- SEARCH
 * old content
 * =======
 * new content
 * +++++++ REPLACE
 */

/**
 * Main function to handle diff commands - simplified interface
 */
export function handleUnifiedDiffCommand(_command: { operations?: unknown; workdir?: string }): string {
  throw new Error('Legacy handleUnifiedDiffCommand called - this should not happen');
}

/**
 * Parse and apply SEARCH/REPLACE format to a file
 */
export function applySearchReplaceDiff(filePath: string, diffContent: string, workdir?: string): string {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  
  try {
    // Read current file content
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File does not exist: ${resolvedPath}`);
    }
    
    const originalContent = fs.readFileSync(resolvedPath, 'utf8');
    
    // Parse the diff
    const blocks = parseSearchReplaceBlocks(diffContent);
    
    if (blocks.length === 0) {
      throw new Error('No SEARCH/REPLACE blocks found in diff content');
    }
    
    // Apply the search/replace operations
    let modifiedContent = originalContent;
    
    for (const block of blocks) {
      let { searchContent } = block;
      const { replaceContent } = block;
      
      // Try exact match first
      let searchIndex = modifiedContent.indexOf(searchContent);
      
      // If exact match fails, try normalized whitespace matching
      if (searchIndex === -1) {
        // Normalize whitespace in both search content and file content for matching
        const normalizeWhitespace = (text: string) => 
          text.replace(/\s+/g, ' ').trim();
        
        const normalizedSearch = normalizeWhitespace(searchContent);
        const normalizedContent = normalizeWhitespace(modifiedContent);
        
        const normalizedIndex = normalizedContent.indexOf(normalizedSearch);
        
        if (normalizedIndex !== -1) {
          // Find the actual position in the original content by mapping back
          // This is a simplified approach - count words/tokens to find position
          const wordsBeforeMatch = normalizedContent.slice(0, normalizedIndex).split(' ').length - 1;
          
          // Reconstruct position in original content
          let actualStart = 0;
          let wordCount = 0;
          
          for (let i = 0; i < modifiedContent.length && wordCount < wordsBeforeMatch; i++) {
            if (/\S/.test(modifiedContent[i] || '')) {
              if (i === 0 || /\s/.test(modifiedContent[i - 1] || '')) {
                wordCount++;
                if (wordCount === wordsBeforeMatch + 1) {
                  actualStart = i;
                  break;
                }
              }
            }
          }
          
          // Find the end position by looking for the search content with flexible whitespace
          const searchWords = searchContent.split(/\s+/).filter(word => word.length > 0);
          let actualEnd = actualStart;
          let currentWordIndex = 0;
          
          for (let i = actualStart; i < modifiedContent.length && currentWordIndex < searchWords.length; i++) {
            if (/\S/.test(modifiedContent[i] || '')) {
              if (i === actualStart || /\s/.test(modifiedContent[i - 1] || '')) {
                // Start of a word
                const wordEnd = modifiedContent.slice(i).search(/\s|$/);
                const word = modifiedContent.slice(i, wordEnd === -1 ? undefined : i + wordEnd);
                
                if (word === searchWords[currentWordIndex]) {
                  currentWordIndex++;
                  if (currentWordIndex === searchWords.length) {
                    actualEnd = wordEnd === -1 ? modifiedContent.length : i + wordEnd;
                    break;
                  }
                  i += Math.max(0, wordEnd - 1);
                }
              }
            }
          }
          
          if (currentWordIndex === searchWords.length) {
            searchIndex = actualStart;
            searchContent = modifiedContent.slice(actualStart, actualEnd);
          }
        }
      }
      
      if (searchIndex === -1) {
        throw new Error(
          `Search content not found in file:\n` +
          `SEARCH:\n${searchContent}\n\n` +
          `FILE CONTENT PREVIEW:\n${modifiedContent.slice(0, 800)}${modifiedContent.length > 800 ? '...' : ''}\n\n` +
          `DEBUGGING HINTS:\n` +
          `1. Check for exact whitespace and indentation match\n` +
          `2. Look for special characters that might need escaping\n` +
          `3. Consider using smaller, more specific search blocks\n` +
          `4. Use cat command to examine exact file content first`
        );
      }
      
      // Replace the found content
      modifiedContent = 
        modifiedContent.slice(0, searchIndex) + 
        replaceContent + 
        modifiedContent.slice(searchIndex + searchContent.length);
    }
    
    // Write the modified content back
    fs.writeFileSync(resolvedPath, modifiedContent, 'utf8');
    
    log(`Successfully applied ${blocks.length} search/replace operation(s) to ${filePath}`);
    return `Successfully applied ${blocks.length} search/replace operation(s) to ${filePath}`;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to apply search/replace to ${filePath}: ${errorMessage}`);
  }
}

/**
 * Write complete content to a file
 */
export function writeToFile(filePath: string, content: string, workdir?: string): string {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  const dir = path.dirname(resolvedPath);
  
  try {
    // Ensure directory exists
    if (dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write the content
    fs.writeFileSync(resolvedPath, content, 'utf8');
    
    log(`Successfully wrote content to ${filePath}`);
    return `Successfully wrote ${content.length} characters to ${filePath}`;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write to ${filePath}: ${errorMessage}`);
  }
}

/**
 * Read file content
 */
export function readFile(filePath: string, workdir?: string): string {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  
  try {
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return content;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${filePath}: ${errorMessage}`);
  }
}

/**
 * Parse SEARCH/REPLACE blocks from diff content
 */
function parseSearchReplaceBlocks(diffContent: string): Array<{ searchContent: string; replaceContent: string }> {
  const lines = diffContent.split('\n');
  const blocks: Array<{ searchContent: string; replaceContent: string }> = [];
  
  let currentBlock: Partial<{ searchContent: string; replaceContent: string }> = {};
  let state: 'none' | 'search' | 'replace' = 'none';
  let contentLines: Array<string> = [];
  
  const isSearchStart = (line: string) => /^[-]{3,} SEARCH$/.test(line) || /^[<]{3,} SEARCH$/.test(line);
  const isSearchEnd = (line: string) => /^[=]{3,}$/.test(line);
  const isReplaceEnd = (line: string) => /^[+]{3,} REPLACE$/.test(line) || /^[>]{3,} REPLACE$/.test(line);
  
  for (const line of lines) {
    if (isSearchStart(line)) {
      if (state !== 'none') {
        throw new Error('Unexpected SEARCH block start - previous block not completed');
      }
      state = 'search';
      contentLines = [];
      continue;
    }
    
    if (isSearchEnd(line)) {
      if (state !== 'search') {
        throw new Error('Unexpected ======= without preceding SEARCH block');
      }
      currentBlock.searchContent = contentLines.join('\n');
      state = 'replace';
      contentLines = [];
      continue;
    }
    
    if (isReplaceEnd(line)) {
      if (state !== 'replace') {
        throw new Error('Unexpected REPLACE block end without preceding content');
      }
      currentBlock.replaceContent = contentLines.join('\n');
      
      if (currentBlock.searchContent !== undefined && currentBlock.replaceContent !== undefined) {
        blocks.push({
          searchContent: currentBlock.searchContent,
          replaceContent: currentBlock.replaceContent
        });
      }
      
      currentBlock = {};
      state = 'none';
      contentLines = [];
      continue;
    }
    
    if (state === 'search' || state === 'replace') {
      contentLines.push(line);
    }
  }
  
  if (state !== 'none') {
    throw new Error('Incomplete SEARCH/REPLACE block - missing closing marker');
  }
  
  return blocks;
}

/**
 * Enhanced error handling with context suggestions
 */
export function generateDiffError(filePath: string, originalContent?: string): string {
  const preview = originalContent 
    ? originalContent.slice(0, 500) + (originalContent.length > 500 ? '...' : '')
    : 'Unable to read file content';
    
  return `
SEARCH/REPLACE Error for ${filePath}

The SEARCH block content was not found in the file. This usually means:

1. **Exact Match Required**: The SEARCH block must match the file content exactly, including:
   - Whitespace and indentation
   - Line endings
   - Special characters

2. **File Content Preview**:
${preview}

3. **Debugging Steps**:
   - Use read_file to examine the exact content
   - Copy the exact text including whitespace
   - For large files, search for unique identifiers first
   - Consider using smaller, more specific search blocks

4. **Alternative Approaches**:
   - Use write_to_file to replace entire file if changes are extensive
   - Break large changes into multiple smaller search/replace operations
   - Use execute_command with sed for simple text substitutions
`;
}

/**
 * Parses raw diff command arguments into structured operations
 */
export function parseDiffCommand(args: Array<string>): { type: string; filePath: string; content?: string } | null {
  if (args.length < 2) {
    return null;
  }
  
  const command = args[0];
  
  if (command === 'replace_in_file') {
    const filePath = args[1];
    if (!filePath) {
      return null;
    }
    const diffContent = args.slice(2).join(' ');
    
    return {
      type: 'replace_in_file',
      filePath,
      content: diffContent
    };
  }
  
  if (command === 'write_to_file') {
    const filePath = args[1];
    if (!filePath) {
      return null;
    }
    const content = args.slice(2).join(' ');
    
    return {
      type: 'write_to_file',
      filePath,
      content
    };
  }
  
  return null;
} 