import { log } from '../logger/log.js';
import * as fs from 'fs';
import { promises as fsAsync } from 'fs';
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
export function handleUnifiedDiffCommand(command: { 
  operations?: Array<{
    filePath: string;
    edits: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
  }>; 
  workdir?: string 
}): string {
  const { operations, workdir } = command;
  
  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    throw new Error('Multi-edit requires operations array');
  }
  
  const results: Array<string> = [];
  const appliedOperations: Array<{ filePath: string; originalContent: string }> = [];
  
  try {
    // Apply all operations atomically
    for (const operation of operations) {
      const { filePath, edits } = operation;
      const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
      
      // Read original content for rollback if needed
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File does not exist: ${resolvedPath}`);
      }
      
      const originalContent = fs.readFileSync(resolvedPath, 'utf8');
      appliedOperations.push({ filePath: resolvedPath, originalContent });
      
      // Apply all edits to this file
      let modifiedContent = originalContent;
      for (const edit of edits) {
        const editResult = applySingleEdit(modifiedContent, edit);
        if (!editResult.success) {
          throw new Error(`Edit failed for ${filePath}: ${editResult.error}`);
        }
        modifiedContent = editResult.content!;
      }
      
      // Write modified content
      fs.writeFileSync(resolvedPath, modifiedContent, 'utf8');
      results.push(`Applied ${edits.length} edits to ${filePath}`);
    }
    
    return results.join('\n');
    
  } catch (error) {
    // Rollback all applied operations
    for (const { filePath, originalContent } of appliedOperations) {
      try {
        fs.writeFileSync(filePath, originalContent, 'utf8');
      } catch (rollbackError) {
        log(`Failed to rollback ${filePath}: ${rollbackError}`);
      }
    }
    
    throw error;
  }
}

function applySingleEdit(content: string, edit: { old_string: string; new_string: string; replace_all?: boolean }): { success: boolean; content?: string; error?: string } {
  const { old_string, new_string, replace_all } = edit;
  
  // Handle replace_all explicitly
  if (replace_all) {
    const newContent = content.replace(new RegExp(escapeRegex(old_string), 'g'), new_string);
    if (newContent === content) {
      return { success: false, error: 'No matches found for replace_all operation' };
    }
    return { success: true, content: newContent };
  }
  
  // Single replacement with exact match validation
  const searchIndex = content.indexOf(old_string);
  if (searchIndex === -1) {
    return { success: false, error: `Search text not found: "${old_string}"` };
  }
  
  // Check for multiple occurrences
  const lastIndex = content.lastIndexOf(old_string);
  if (lastIndex !== searchIndex) {
    // Smart auto-replacement: if the old_string and new_string are very similar
    // (like adding headers), automatically use replace_all behavior
    if (shouldAutoReplaceAll(old_string, new_string)) {
      log(`Auto-applying replace_all for similar content: "${old_string}" -> "${new_string}"`);
      const newContent = content.replace(new RegExp(escapeRegex(old_string), 'g'), new_string);
      return { success: true, content: newContent };
    }
    
    return { success: false, error: 'Multiple occurrences found. Use replace_all: true or provide more specific context' };
  }
  
  const newContent = content.slice(0, searchIndex) + new_string + content.slice(searchIndex + old_string.length);
  return { success: true, content: newContent };
}

/**
 * Determine if we should automatically apply replace_all based on content similarity
 */
function shouldAutoReplaceAll(oldString: string, newString: string): boolean {
  // If the new string contains the old string (like adding headers), auto-replace all
  if (newString.includes(oldString)) {
    const addedContent = newString.replace(oldString, '').trim();
    
    // Common patterns that should auto-replace:
    // - Adding HTTP headers (Connection: close)
    // - Adding import statements
    // - Adding common prefixes/suffixes
    const headerPatterns = [
      /Connection:\s*close/i,
      /Content-Type:/i,
      /Cache-Control:/i,
      /Set-Cookie:/i,
      /Authorization:/i
    ];
    
    const commonPatterns = [
      /import\s+/i,
      /require\s*\(/i,
      /from\s+['"`]/i,
      /\r\n/,
      /\n/
    ];
    
         return headerPatterns.some(pattern => pattern.test(addedContent)) ||
            commonPatterns.some(pattern => pattern.test(addedContent));
   }
   
   // If strings are very similar (>80% similar), likely safe to replace all
   const similarity = calculateStringSimilarity(oldString, newString);
   return similarity > 0.8;
 }
 
 /**
  * Calculate string similarity using a simple ratio
  */
 function calculateStringSimilarity(str1: string, str2: string): number {
   const longer = str1.length > str2.length ? str1 : str2;
   const shorter = str1.length > str2.length ? str2 : str1;
   
   if (longer.length === 0) {
     return 1.0;
   }
   
   const editDistance = levenshteinDistance(longer, shorter);
   return (longer.length - editDistance) / longer.length;
 }
 
 /**
  * Calculate Levenshtein distance between two strings
  */
 function levenshteinDistance(str1: string, str2: string): number {
   const matrix: Array<Array<number>> = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));
  
  for (let i = 0; i <= str1.length; i++) {
    matrix[0]![i] = i;
  }
  for (let j = 0; j <= str2.length; j++) {
    matrix[j]![0] = j;
  }
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j]![i] = Math.min(
        matrix[j]![i - 1]! + 1,     // deletion
        matrix[j - 1]![i]! + 1,     // insertion
        matrix[j - 1]![i - 1]! + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length]![str1.length]!;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Advanced fuzzy matching for search content that handles various formatting differences
 */
function findFuzzyMatch(content: string, searchContent: string): number {
  // Strategy 1: Exact match (already tried, but for completeness)
  let index = content.indexOf(searchContent);
  if (index !== -1) {
    return index;
  }
  
  // Strategy 2: Normalize line endings
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedSearch = searchContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  index = normalizedContent.indexOf(normalizedSearch);
  if (index !== -1) {
    return index;
  }
  
  // Strategy 3: Clean up shell escaping artifacts
  const cleanSearch = normalizedSearch
    .replace(/\\\$/g, '$')      // \$ -> $
    .replace(/\\"/g, '"')       // \" -> "
    .replace(/\\\|/g, '|')      // \| -> |
    .replace(/\\\(/g, '(')      // \( -> (
    .replace(/\\\)/g, ')')      // \) -> )
    .replace(/\\\[/g, '[')      // \[ -> [
    .replace(/\\\]/g, ']');     // \] -> ]
  
  index = normalizedContent.indexOf(cleanSearch);
  if (index !== -1) {
    return index;
  }
  
  // Strategy 4: Normalize whitespace (flexible matching)
  const normalizeWS = (text: string) => text.replace(/\s+/g, ' ').trim();
  const wsNormalizedContent = normalizeWS(normalizedContent);
  const wsNormalizedSearch = normalizeWS(cleanSearch);
  
  const wsIndex = wsNormalizedContent.indexOf(wsNormalizedSearch);
  if (wsIndex !== -1) {
    // Map back to original position
    return mapNormalizedIndexToOriginal(normalizedContent, wsIndex, wsNormalizedSearch.length);
  }
  
  // Strategy 5: Line-by-line fuzzy matching (find key lines)
  const searchLines = cleanSearch.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const contentLines = normalizedContent.split('\n');
  
  if (searchLines.length > 0) {
    // Find the most unique line (longest line with special characters)
    const keyLine = searchLines.reduce((best, current) => 
      (current.length > best.length && /[{}()[\]"'$]/.test(current)) ? current : best
    , searchLines[0] || '');
    
    if (keyLine) {
      const lineIndex = contentLines.findIndex(line => line.trim() === keyLine);
      if (lineIndex !== -1) {
        // Try to find the start of the block by matching surrounding context
        const keyLineIndexInSearch = searchLines.indexOf(keyLine);
        const startLine = Math.max(0, lineIndex - keyLineIndexInSearch);
        const startPos = contentLines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
        return startPos;
      }
    }
  }
  
  return -1;
}

/**
 * Map a position in whitespace-normalized text back to the original text
 */
function mapNormalizedIndexToOriginal(originalText: string, normalizedIndex: number, _searchLength: number): number {
  let originalPos = 0;
  let normalizedPos = 0;
  let inWhitespace = false;
  
  for (let i = 0; i < originalText.length && normalizedPos < normalizedIndex; i++) {
    const char = originalText[i];
    if (/\s/.test(char || '')) {
      if (!inWhitespace) {
        normalizedPos++; // Count first whitespace character
        inWhitespace = true;
      }
      // Skip additional whitespace characters
    } else {
      normalizedPos++;
      inWhitespace = false;
    }
    originalPos = i;
  }
  
  return originalPos;
}

/**
 * Extract the actual matching content from the file starting at a given position
 */
function extractMatchFromPosition(content: string, startPos: number, searchWords: Array<string>): string | null {
  if (searchWords.length === 0) {
    return null;
  }
  
  let currentPos = startPos;
  let wordIndex = 0;
  const matchedSegments: Array<string> = [];
  
  while (currentPos < content.length && wordIndex < searchWords.length) {
    // Skip whitespace
    while (currentPos < content.length && /\s/.test(content[currentPos] || '')) {
      if (matchedSegments.length > 0 || wordIndex > 0) {
        const char = content[currentPos];
        if (char) {
          matchedSegments.push(char);
        }
      }
      currentPos++;
    }
    
    // Find next word
    const wordStart = currentPos;
    let wordEnd = currentPos;
    while (wordEnd < content.length && /\S/.test(content[wordEnd] || '')) {
      wordEnd++;
    }
    
    const word = content.slice(wordStart, wordEnd);
    const targetWord = searchWords[wordIndex];
    
    if (targetWord && (word === targetWord || word.includes(targetWord) || targetWord.includes(word))) {
      matchedSegments.push(word);
      wordIndex++;
      currentPos = wordEnd;
    } else {
      // If we don't find the expected word, include it anyway for context
      matchedSegments.push(word);
      currentPos = wordEnd;
    }
    
    // Safety: prevent infinite loops
    if (matchedSegments.join('').length > searchWords.join(' ').length * 3) {
      break;
    }
  }
  
  return wordIndex >= searchWords.length ? matchedSegments.join('') : null;
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
      
      // If still no match, try fuzzy matching with various normalizations
      if (searchIndex === -1) {
        // Check if the search content contains regex patterns that shouldn't be there
        if (searchContent.includes('[\\s\\S]*') || searchContent.includes('\\$') || searchContent.includes('\\n')) {
          log(`Warning: Search content contains regex patterns or escape sequences that likely don't match literal text`);
          
          // Try to clean up common regex patterns and escape sequences
          const cleanedSearch = searchContent
            .replace(/\[\\s\\S\]\*/g, '') // Remove [\s\S]* patterns
            .replace(/\\\$/g, '$')        // \$ -> $
            .replace(/\\n/g, '\n')        // \n -> actual newline
            .replace(/\\t/g, '\t')        // \t -> actual tab
            .replace(/\\\\/g, '\\')       // \\ -> \
            .replace(/\\"/g, '"')         // \" -> "
            .replace(/\\'/g, "'")         // \' -> '
            .trim();
          
          // Try exact match with cleaned search
          searchIndex = modifiedContent.indexOf(cleanedSearch);
          if (searchIndex !== -1) {
            searchContent = cleanedSearch;
            log(`Found match after cleaning regex patterns: "${searchContent.slice(0, 50)}..."`);
          }
        }
        
        if (searchIndex === -1) {
          searchIndex = findFuzzyMatch(modifiedContent, searchContent);
          if (searchIndex !== -1) {
            // Update searchContent to match what was actually found
            const searchWords = searchContent.split(/\s+/).filter(w => w.length > 0);
            const foundMatch = extractMatchFromPosition(modifiedContent, searchIndex, searchWords);
            if (foundMatch) {
              searchContent = foundMatch;
              log(`Found fuzzy match: "${searchContent.slice(0, 50)}..."`);
            }
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
        debugInfo += `1. Use read() to examine the exact file content first\n`;
        debugInfo += `2. Copy exact literal text from the file (no regex patterns like [\\s\\S]* or escape sequences)\n`;
        debugInfo += `3. Check for exact whitespace and indentation match\n`;
        debugInfo += `4. Use smaller, unique search strings that appear only once\n`;
        debugInfo += `5. Avoid complex multi-line searches - prefer single distinctive lines\n\n`;
        
        debugInfo += `COMMON MISTAKES TO AVOID:\n`;
        debugInfo += `❌ Using regex patterns: [\\s\\S]*, \\d+, etc.\n`;
        debugInfo += `❌ Using escape sequences: \\n, \\t, \\$, etc.\n`;
        debugInfo += `❌ Trying to match multiple paragraphs at once\n`;
        debugInfo += `✅ Use exact literal text from read() output\n`;
        debugInfo += `✅ Search for unique function names or comments\n`;
        debugInfo += `✅ Use line-by-line approach for complex changes\n\n`;
        
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
   - Use read() to examine the exact content
   - Copy the exact text including whitespace
   - For large files, search for unique identifiers first
   - Consider using smaller, more specific search blocks

4. **Alternative Approaches**:
   - Use write() to replace entire file if changes are extensive
   - Break large changes into multiple smaller edit() operations
   - Use shell commands with sed for simple text substitutions
`;
}



/**
 * Read file content asynchronously
 */
export async function readFileAsync(filePath: string, workdir?: string): Promise<string> {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  
  try {
    // Check if file exists asynchronously
    await fsAsync.access(resolvedPath);
    
    const content = await fsAsync.readFile(resolvedPath, 'utf8');
    return content;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${filePath}: ${errorMessage}`);
  }
}

// Removed unused async batch functions - use individual operations instead

/**
 * Write file content asynchronously
 */
export async function writeToFileAsync(filePath: string, content: string, workdir?: string): Promise<string> {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  const dir = path.dirname(resolvedPath);
  
  try {
    // Ensure directory exists
    if (dir !== '.') {
      await fsAsync.mkdir(dir, { recursive: true });
    }
    
    // Write the content
    await fsAsync.writeFile(resolvedPath, content, 'utf8');
    
    log(`Successfully wrote content to ${filePath}`);
    return `Successfully wrote ${content.length} characters to ${filePath}`;
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write to ${filePath}: ${errorMessage}`);
  }
}



 