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
      
      log(`Searching for content in ${filePath}: "${searchContent.slice(0, 100)}..."`);
      
      // Try exact match first
      let searchIndex = modifiedContent.indexOf(searchContent);
      
      // If exact match fails, try with normalized line endings
      if (searchIndex === -1) {
        const normalizedSearch = searchContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const normalizedContent = modifiedContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        searchIndex = normalizedContent.indexOf(normalizedSearch);
        if (searchIndex !== -1) {
          log(`Found match after line ending normalization at position ${searchIndex}`);
          // Update to use the normalized content for replacement
          modifiedContent = normalizedContent;
          searchContent = normalizedSearch;
        }
      }
      
      // If still no match, try normalized whitespace matching
      if (searchIndex === -1) {
        // Normalize whitespace in both search content and file content for matching
        const normalizeWhitespace = (text: string) => 
          text.replace(/\s+/g, ' ').trim();
        
        const normalizedSearch = normalizeWhitespace(searchContent);
        const normalizedContent = normalizeWhitespace(modifiedContent);
        
        const normalizedIndex = normalizedContent.indexOf(normalizedSearch);
        
        if (normalizedIndex !== -1) {
          log(`Found match after whitespace normalization`);
          // Find the actual position in the original content by mapping back
          // This is a simplified approach - count characters to find position
          let actualStart = 0;
          let actualEnd = 0;
          let normalizedCharCount = 0;
          
          // Find start position
          for (let i = 0; i < modifiedContent.length; i++) {
            const char = modifiedContent[i];
            if (char && !/\s/.test(char)) {
              if (normalizedCharCount === normalizedIndex) {
                actualStart = i;
                break;
              }
              normalizedCharCount++;
            }
          }
          
          // Find end position by looking for the search content with flexible whitespace
          const searchWords = searchContent.split(/\s+/).filter(word => word.length > 0);
          let currentWordIndex = 0;
          
          for (let i = actualStart; i < modifiedContent.length && currentWordIndex < searchWords.length; i++) {
            const char = modifiedContent[i];
            if (char && /\S/.test(char)) {
              // Find word boundaries
              let wordEnd = i;
              while (wordEnd < modifiedContent.length && /\S/.test(modifiedContent[wordEnd] || '')) {
                wordEnd++;
              }
              
              const word = modifiedContent.slice(i, wordEnd);
              
              if (word === searchWords[currentWordIndex]) {
                currentWordIndex++;
                if (currentWordIndex === searchWords.length) {
                  actualEnd = wordEnd;
                  break;
                }
                i = wordEnd - 1; // -1 because loop will increment
              }
            }
          }
          
          if (currentWordIndex === searchWords.length) {
            searchIndex = actualStart;
            searchContent = modifiedContent.slice(actualStart, actualEnd);
            log(`Mapped back to original content: "${searchContent.slice(0, 50)}..."`);
          }
        }
      }
      
      // If still no match, try substring search for partial content
      if (searchIndex === -1) {
        const searchLines = searchContent.split('\n');
        if (searchLines.length > 1) {
          // Try to find a unique line from the middle of the search content
          const middleLineIndex = Math.floor(searchLines.length / 2);
          const middleLine = searchLines[middleLineIndex]?.trim();
          
          if (middleLine && middleLine.length > 10) {
            const lineIndex = modifiedContent.indexOf(middleLine);
            if (lineIndex !== -1) {
              log(`Found partial match with middle line: "${middleLine}"`);
              // This is a partial match - we should warn but try to continue
              log(`Warning: Using partial match. This may lead to incorrect replacements.`);
            }
          }
        }
      }
      
      if (searchIndex === -1) {
        // Enhanced error with more debugging info
        const fileLines = modifiedContent.split('\n');
        const searchLines = searchContent.split('\n');
        
        let debugInfo = `Search content not found in file:\n`;
        debugInfo += `SEARCH (${searchLines.length} lines):\n${searchContent}\n\n`;
        debugInfo += `FILE CONTENT PREVIEW (first 20 lines):\n`;
        debugInfo += fileLines.slice(0, 20).map((line, i) => `${i + 1}: ${line}`).join('\n');
        debugInfo += `${fileLines.length > 20 ? '\n... (truncated)' : ''}\n\n`;
        
        debugInfo += `DEBUGGING HINTS:\n`;
        debugInfo += `1. Check for exact whitespace and indentation match\n`;
        debugInfo += `2. Look for special characters that might need escaping\n`;
        debugInfo += `3. Consider using smaller, more specific search blocks\n`;
        debugInfo += `4. Use read_file command to examine exact file content first\n`;
        debugInfo += `5. Try searching for a unique line first, then expand context\n\n`;
        
        // Try to suggest similar content
        if (searchLines.length > 0 && searchLines[0]) {
          const firstSearchLine = searchLines[0].trim();
          const similarLines = fileLines
            .map((line, index) => ({ line: line.trim(), index }))
            .filter(({ line }) => line.includes(firstSearchLine.slice(0, 20)) || firstSearchLine.includes(line.slice(0, 20)))
            .slice(0, 3);
          
          if (similarLines.length > 0) {
            debugInfo += `SIMILAR LINES FOUND:\n`;
            similarLines.forEach(({ line, index }) => {
              debugInfo += `Line ${index + 1}: ${line}\n`;
            });
          }
        }
        
        throw new Error(debugInfo);
      }
      
      // Replace the found content
      modifiedContent = 
        modifiedContent.slice(0, searchIndex) + 
        replaceContent + 
        modifiedContent.slice(searchIndex + searchContent.length);
        
      log(`Successfully replaced content at position ${searchIndex}`);
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