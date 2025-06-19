import { log } from '../logger/log.js';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface FileOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  diff?: string;
}

/**
 * Language-specific file handling configurations
 */
const LANGUAGE_CONFIGS = {
  // JavaScript/TypeScript
  '.js': { syntax: 'javascript', validator: 'node --check' },
  '.jsx': { syntax: 'javascript', validator: 'node --check' },
  '.ts': { syntax: 'typescript', validator: 'tsc --noEmit' },
  '.tsx': { syntax: 'typescript', validator: 'tsc --noEmit' },
  '.mjs': { syntax: 'javascript', validator: 'node --check' },
  '.cjs': { syntax: 'javascript', validator: 'node --check' },
  
  // Python
  '.py': { syntax: 'python', validator: 'python -m py_compile' },
  '.pyw': { syntax: 'python', validator: 'python -m py_compile' },
  '.pyi': { syntax: 'python', validator: 'python -m py_compile' },
  
  // Web Technologies
  '.html': { syntax: 'html', validator: null },
  '.htm': { syntax: 'html', validator: null },
  '.css': { syntax: 'css', validator: null },
  '.scss': { syntax: 'scss', validator: null },
  '.sass': { syntax: 'sass', validator: null },
  '.less': { syntax: 'less', validator: null },
  
  // System Languages
  '.c': { syntax: 'c', validator: 'gcc -fsyntax-only' },
  '.cpp': { syntax: 'cpp', validator: 'g++ -fsyntax-only' },
  '.cc': { syntax: 'cpp', validator: 'g++ -fsyntax-only' },
  '.cxx': { syntax: 'cpp', validator: 'g++ -fsyntax-only' },
  '.h': { syntax: 'c', validator: 'gcc -fsyntax-only' },
  '.hpp': { syntax: 'cpp', validator: 'g++ -fsyntax-only' },
  '.rs': { syntax: 'rust', validator: 'rustc --parse-only' },
  '.go': { syntax: 'go', validator: 'go fmt -e' },
  
  // JVM Languages
  '.java': { syntax: 'java', validator: 'javac -Xstdout' },
  '.kt': { syntax: 'kotlin', validator: null },
  '.scala': { syntax: 'scala', validator: null },
  '.clj': { syntax: 'clojure', validator: null },
  '.cljs': { syntax: 'clojure', validator: null },
  
  // .NET Languages
  '.cs': { syntax: 'csharp', validator: null },
  '.fs': { syntax: 'fsharp', validator: null },
  '.vb': { syntax: 'vbnet', validator: null },
  
  // Functional Languages
  '.hs': { syntax: 'haskell', validator: 'ghc -fno-code' },
  '.ml': { syntax: 'ocaml', validator: null },
  '.elm': { syntax: 'elm', validator: 'elm make --output=/dev/null' },
  '.ex': { syntax: 'elixir', validator: 'elixir -c' },
  '.exs': { syntax: 'elixir', validator: 'elixir -c' },
  
  // Shell Scripts
  '.sh': { syntax: 'bash', validator: 'bash -n' },
  '.bash': { syntax: 'bash', validator: 'bash -n' },
  '.zsh': { syntax: 'zsh', validator: 'zsh -n' },
  '.fish': { syntax: 'fish', validator: 'fish --parse-only' },
  '.ps1': { syntax: 'powershell', validator: null },
  '.bat': { syntax: 'batch', validator: null },
  '.cmd': { syntax: 'batch', validator: null },
  
  // Modern Languages
  '.swift': { syntax: 'swift', validator: 'swift -parse' },
  '.dart': { syntax: 'dart', validator: 'dart analyze --no-fatal-infos' },
  '.lua': { syntax: 'lua', validator: 'luac -p' },
  '.rb': { syntax: 'ruby', validator: 'ruby -c' },
  '.php': { syntax: 'php', validator: 'php -l' },
  '.pl': { syntax: 'perl', validator: 'perl -c' },
  '.r': { syntax: 'r', validator: null },
  '.jl': { syntax: 'julia', validator: null },
  
  // Configuration & Data
  '.json': { syntax: 'json', validator: 'node -e "JSON.parse(require(\'fs\').readFileSync(process.argv[1]))"' },
  '.jsonc': { syntax: 'jsonc', validator: null },
  '.yaml': { syntax: 'yaml', validator: null },
  '.yml': { syntax: 'yaml', validator: null },
  '.toml': { syntax: 'toml', validator: null },
  '.xml': { syntax: 'xml', validator: null },
  '.ini': { syntax: 'ini', validator: null },
  '.cfg': { syntax: 'ini', validator: null },
  '.conf': { syntax: 'conf', validator: null },
  
  // Documentation
  '.md': { syntax: 'markdown', validator: null },
  '.mdx': { syntax: 'mdx', validator: null },
  '.rst': { syntax: 'rst', validator: null },
  '.tex': { syntax: 'latex', validator: null },
  '.adoc': { syntax: 'asciidoc', validator: null },
  
  // Database
  '.sql': { syntax: 'sql', validator: null },
  '.graphql': { syntax: 'graphql', validator: null },
  '.gql': { syntax: 'graphql', validator: null },
  
  // Build & Config
  '.dockerfile': { syntax: 'dockerfile', validator: null },
  '.makefile': { syntax: 'makefile', validator: null },
  '.cmake': { syntax: 'cmake', validator: null },
  '.gradle': { syntax: 'gradle', validator: null },
  '.mvn': { syntax: 'maven', validator: null },
  '.nix': { syntax: 'nix', validator: null },
} as const;

/**
 * Gets the language configuration for a file extension
 */
function getLanguageConfig(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_CONFIGS[ext as keyof typeof LANGUAGE_CONFIGS];
}

/**
 * Validates file syntax using appropriate language-specific tools
 */
function _validateFileSyntax(filePath: string): { valid: boolean; errors?: string } {
  const config = getLanguageConfig(filePath);
  
  if (!config?.validator) {
    return { valid: true }; // No validator available
  }

  const [command, ...args] = config.validator.split(' ');
  if (!command) {
    return { valid: true }; // No valid command
  }
  
  const result = spawnSync(command, [...args, filePath], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status === 0) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: result.stderr || result.stdout || `Validation failed with exit code ${result.status}`
  };
}

/**
 * Applies a unified diff to a file using the standard patch command
 */
function applyUnifiedDiff(filePath: string, diff: string, workdir?: string): void {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  
  // Write diff to a temporary file
  const tempDiffPath = path.join(path.dirname(resolvedPath), `.${path.basename(resolvedPath)}.patch`);
  fs.writeFileSync(tempDiffPath, diff, 'utf8');

  try {
    // Apply the patch
    const result = spawnSync('patch', ['-p0', resolvedPath], {
      input: diff,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (result.status !== 0) {
      throw new Error(`Failed to apply patch: ${result.stderr}`);
    }
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempDiffPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Creates a new file with the given content
 */
function createFile(filePath: string, content: string, workdir?: string): void {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  const dir = path.dirname(resolvedPath);
  
  // Ensure directory exists
  if (dir !== '.') {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(resolvedPath, content, 'utf8');
}

/**
 * Deletes a file
 */
function deleteFile(filePath: string, workdir?: string): void {
  const resolvedPath = workdir ? path.resolve(workdir, filePath) : filePath;
  fs.unlinkSync(resolvedPath);
}

/**
 * Applies a set of file operations using standard tools
 */
export function applyFileOperations(operations: Array<FileOperation>, workdir?: string): void {
  for (const op of operations) {
    try {
      switch (op.type) {
        case 'create':
          if (!op.content) {
            throw new Error(`Missing content for create operation on ${op.path}`);
          }
          log(`Creating file: ${op.path}`);
          createFile(op.path, op.content, workdir);
          break;

        case 'update':
          if (!op.diff) {
            throw new Error(`Missing diff for update operation on ${op.path}`);
          }
          log(`Updating file: ${op.path}`);
          applyUnifiedDiff(op.path, op.diff, workdir);
          break;

        case 'delete':
          log(`Deleting file: ${op.path}`);
          deleteFile(op.path, workdir);
          break;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply operation on ${op.path}: ${errorMessage}`);
    }
  }
}

/**
 * File chunking strategy for extremely large files (>5000 lines)
 * Inspired by Cline's targeted editing and Avante's context-first approach
 */

interface FileChunk {
  startLine: number;
  endLine: number;
  content: string;
  context: string; // Surrounding context for understanding
  chunkId: string;
}

interface ChunkingStrategy {
  maxChunkSize: number;
  overlapLines: number;
  contextLines: number;
  useSemanticBoundaries: boolean;
}

/**
 * Default chunking strategies by file type
 */
const CHUNKING_STRATEGIES: Record<string, ChunkingStrategy> = {
  // Programming languages - respect function/class boundaries
  '.js': { maxChunkSize: 200, overlapLines: 10, contextLines: 5, useSemanticBoundaries: true },
  '.ts': { maxChunkSize: 200, overlapLines: 10, contextLines: 5, useSemanticBoundaries: true },
  '.py': { maxChunkSize: 150, overlapLines: 8, contextLines: 4, useSemanticBoundaries: true },
  '.java': { maxChunkSize: 250, overlapLines: 12, contextLines: 6, useSemanticBoundaries: true },
  '.cpp': { maxChunkSize: 300, overlapLines: 15, contextLines: 7, useSemanticBoundaries: true },
  '.go': { maxChunkSize: 200, overlapLines: 10, contextLines: 5, useSemanticBoundaries: true },
  '.rs': { maxChunkSize: 200, overlapLines: 10, contextLines: 5, useSemanticBoundaries: true },
  
  // Web files - respect component/selector boundaries
  '.html': { maxChunkSize: 300, overlapLines: 15, contextLines: 8, useSemanticBoundaries: true },
  '.css': { maxChunkSize: 100, overlapLines: 5, contextLines: 3, useSemanticBoundaries: true },
  '.scss': { maxChunkSize: 150, overlapLines: 8, contextLines: 4, useSemanticBoundaries: true },
  
  // Configuration files - respect logical groupings
  '.json': { maxChunkSize: 500, overlapLines: 0, contextLines: 2, useSemanticBoundaries: false },
  '.yaml': { maxChunkSize: 200, overlapLines: 5, contextLines: 3, useSemanticBoundaries: true },
  '.xml': { maxChunkSize: 300, overlapLines: 10, contextLines: 5, useSemanticBoundaries: true },
  
  // Documentation - respect section boundaries
  '.md': { maxChunkSize: 400, overlapLines: 20, contextLines: 10, useSemanticBoundaries: true },
  '.rst': { maxChunkSize: 300, overlapLines: 15, contextLines: 8, useSemanticBoundaries: true },
  
  // Default for unknown file types
  'default': { maxChunkSize: 200, overlapLines: 10, contextLines: 5, useSemanticBoundaries: false }
};

/**
 * Identifies semantic boundaries in code for better chunking
 */
function findSemanticBoundaries(lines: Array<string>, language: string): Array<number> {
  const boundaries: Array<number> = [0]; // Always start at line 0
  const config = getLanguageConfig(`.${language}`) || { syntax: 'unknown' };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    
    const trimmed = line.trim();
    
    // Language-specific semantic boundaries
    switch (config.syntax) {
      case 'javascript':
      case 'typescript':
        if (trimmed.startsWith('export ') || 
            trimmed.startsWith('function ') ||
            trimmed.startsWith('class ') ||
            trimmed.startsWith('interface ') ||
            trimmed.match(/^(const|let|var)\s+\w+\s*=\s*(async\s+)?function/) ||
            trimmed.match(/^(const|let|var)\s+\w+\s*=\s*\(/)) {
          boundaries.push(i);
        }
        break;
        
      case 'python':
        if (trimmed.startsWith('def ') || 
            trimmed.startsWith('class ') ||
            trimmed.startsWith('async def ') ||
            (trimmed.startsWith('if __name__') && trimmed.includes('__main__'))) {
          boundaries.push(i);
        }
        break;
        
      case 'java':
        if (trimmed.startsWith('public ') || 
            trimmed.startsWith('private ') ||
            trimmed.startsWith('protected ') ||
            trimmed.includes(' class ') ||
            trimmed.includes(' interface ') ||
            trimmed.includes(' enum ')) {
          boundaries.push(i);
        }
        break;
        
      case 'css':
      case 'scss':
        if (trimmed.includes('{') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
          boundaries.push(i);
        }
        break;
        
      case 'html':
        if (trimmed.startsWith('<') && !trimmed.startsWith('<!--') && 
            (trimmed.includes('div') || trimmed.includes('section') || 
             trimmed.includes('article') || trimmed.includes('header') || 
             trimmed.includes('footer') || trimmed.includes('main'))) {
          boundaries.push(i);
        }
        break;
        
      case 'markdown':
        if (trimmed.startsWith('#')) {
          boundaries.push(i);
        }
        break;
        
      // Add explicit defaults for other syntax types to satisfy exhaustiveness
      default:
        // No specific boundaries for other languages
        break;
    }
  }
  
  boundaries.push(lines.length); // Always end at last line
  return [...new Set(boundaries)].sort((a, b) => a - b);
}

/**
 * Chunks a large file for targeted editing
 */
export function chunkLargeFile(
  filePath: string, 
  content: string, 
  targetLine?: number
): Array<FileChunk> {
  const lines = content.split('\n');
  const totalLines = lines.length;
  
  // If file is small enough, return as single chunk
  if (totalLines <= 1000) {
    return [{
      startLine: 1,
      endLine: totalLines,
      content,
      context: `Full file: ${path.basename(filePath)} (${totalLines} lines)`,
      chunkId: 'full-file'
    }];
  }
  
  const ext = path.extname(filePath).toLowerCase();
  const strategy = CHUNKING_STRATEGIES[ext] || CHUNKING_STRATEGIES['default'];
  const languageConfig = getLanguageConfig(filePath);
  
  let boundaries: Array<number> = [];
  
  if (strategy?.useSemanticBoundaries && languageConfig) {
    // Use semantic boundaries for better chunking
    boundaries = findSemanticBoundaries(lines, languageConfig.syntax);
  } else {
    // Fall back to regular chunking
    const chunkSize = strategy?.maxChunkSize || 200;
    for (let i = 0; i < totalLines; i += chunkSize) {
      boundaries.push(i);
    }
    boundaries.push(totalLines);
  }
  
  const chunks: Array<FileChunk> = [];
  
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startLine = boundaries[i];
    let endLine = boundaries[i + 1];
    
    if (startLine === undefined || endLine === undefined) {
      continue;
    }
    
    // Apply max chunk size limit even with semantic boundaries
    const maxChunkSize = strategy?.maxChunkSize || 200;
    if (endLine - startLine > maxChunkSize * 2) {
      endLine = startLine + maxChunkSize;
    }
    
    // Add overlap for context continuity
    const overlapLines = strategy?.overlapLines || 10;
    const actualStart = Math.max(0, startLine - overlapLines);
    const actualEnd = Math.min(totalLines, endLine + overlapLines);
    
    const chunkLines = lines.slice(actualStart, actualEnd);
    const chunkContent = chunkLines.join('\n');
    
    // Generate context description
    let context = `Chunk ${i + 1}/${boundaries.length - 1} of ${path.basename(filePath)}`;
    context += ` (lines ${actualStart + 1}-${actualEnd})`;
    
    // Add semantic context if available
    if (strategy?.useSemanticBoundaries) {
      const firstNonEmpty = chunkLines.find(line => line.trim());
      if (firstNonEmpty) {
        const trimmed = firstNonEmpty.trim();
        if (trimmed.length > 0) {
          context += ` - Starting with: ${trimmed.slice(0, 50)}${trimmed.length > 50 ? '...' : ''}`;
        }
      }
    }
    
    chunks.push({
      startLine: actualStart + 1, // Convert to 1-indexed
      endLine: actualEnd,
      content: chunkContent,
      context,
      chunkId: `chunk-${i + 1}-${startLine + 1}-${actualEnd}`
    });
  }
  
  // If targeting a specific line, prioritize chunks containing that line
  if (targetLine !== undefined) {
    chunks.sort((a, b) => {
      const aContainsTarget = targetLine >= a.startLine && targetLine <= a.endLine;
      const bContainsTarget = targetLine >= b.startLine && targetLine <= b.endLine;
      
      if (aContainsTarget && !bContainsTarget) {
        return -1;
      }
      if (!aContainsTarget && bContainsTarget) {
        return 1;
      }
      
      // Sort by proximity to target line
      const aDistance = Math.min(
        Math.abs(targetLine - a.startLine),
        Math.abs(targetLine - a.endLine)
      );
      const bDistance = Math.min(
        Math.abs(targetLine - b.startLine),
        Math.abs(targetLine - b.endLine)
      );
      
      return aDistance - bDistance;
    });
  }
  
  return chunks;
}

/**
 * Finds the most relevant chunk for editing based on a search query
 */
export function findRelevantChunk(
  chunks: Array<FileChunk>, 
  searchQuery: string
): FileChunk | null {
  if (chunks.length === 0) {
    return null;
  }
  if (chunks.length === 1) {
    return chunks[0] || null;
  }
  
  const query = searchQuery.toLowerCase();
  const scores = chunks.map(chunk => {
    const content = chunk.content.toLowerCase();
    let score = 0;
    
    // Exact matches get highest score
    const exactMatches = (content.match(new RegExp(query, 'g')) || []).length;
    score += exactMatches * 10;
    
    // Word matches get medium score
    const words = query.split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        const wordMatches = (content.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
        score += wordMatches * 3;
      }
    }
    
    // Partial matches get low score
    for (const word of words) {
      if (word.length > 3 && content.includes(word)) {
        score += 1;
      }
    }
    
    return { chunk, score };
  });
  
  const bestMatch = scores.reduce((best, current) => 
    current.score > best.score ? current : best
  );
  
  return bestMatch.score > 0 ? (bestMatch.chunk || null) : (chunks[0] || null);
}

/**
 * Generates a strategic file reading plan for large files
 */
export function generateFileReadingPlan(filePath: string, totalLines: number): {
  strategy: 'full' | 'chunked' | 'targeted';
  recommendation: string;
  chunks?: Array<{ description: string; command: string }>;
} {
  if (totalLines <= 500) {
    return {
      strategy: 'full',
      recommendation: `File is small (${totalLines} lines) - read entire file`
    };
  }
  
  if (totalLines <= 2000) {
    return {
      strategy: 'targeted',
      recommendation: `Medium file (${totalLines} lines) - read specific sections as needed`,
      chunks: [
        {
          description: 'File header and imports',
          command: `head -50 ${filePath}`
        },
        {
          description: 'File structure overview',
          command: `grep -n "^(class|function|def|export|interface)" ${filePath} | head -20`
        },
        {
          description: 'File footer',
          command: `tail -30 ${filePath}`
        }
      ]
    };
  }
  
  const config = getLanguageConfig(filePath);
  
  return {
    strategy: 'chunked',
    recommendation: `Large file (${totalLines} lines) - use chunked approach with semantic boundaries`,
    chunks: [
      {
        description: 'File overview and structure',
        command: config?.syntax === 'python' 
          ? `grep -n "^(class|def|import|from)" ${filePath}`
          : `grep -n "^(export|function|class|interface|import)" ${filePath}`
      },
      {
        description: 'First chunk (header + early content)',
        command: `sed -n '1,200p' ${filePath}`
      },
      {
        description: 'Search for specific patterns when needed',
        command: `rg -n "pattern" ${filePath}`
      }
    ]
  };
}

/**
 * Checkpoint system for rollback capabilities
 * Inspired by Cline's version control approach
 */

interface FileCheckpoint {
  id: string;
  timestamp: Date;
  description: string;
  files: Map<string, string>; // filepath -> original content
  operations: Array<FileOperation>;
}

class CheckpointManager {
  private checkpoints: Map<string, FileCheckpoint> = new Map();
  private currentCheckpointId: string | null = null;
  
  /**
   * Creates a checkpoint before applying operations
   */
  createCheckpoint(description: string, files: Array<string>): string {
    const id = `checkpoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fileContents = new Map<string, string>();
    
    // Backup current file contents
    for (const filePath of files) {
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          fileContents.set(filePath, content);
        }
      } catch (error) {
        log(`Warning: Could not backup file ${filePath}: ${error}`);
      }
    }
    
    const checkpoint: FileCheckpoint = {
      id,
      timestamp: new Date(),
      description,
      files: fileContents,
      operations: []
    };
    
    this.checkpoints.set(id, checkpoint);
    this.currentCheckpointId = id;
    
    log(`Created checkpoint: ${id} - ${description}`);
    return id;
  }
  
  /**
   * Records an operation in the current checkpoint
   */
  recordOperation(operation: FileOperation): void {
    if (this.currentCheckpointId) {
      const checkpoint = this.checkpoints.get(this.currentCheckpointId);
      if (checkpoint) {
        checkpoint.operations.push(operation);
      }
    }
  }
  
  /**
   * Restores files to a checkpoint state
   */
  rollbackToCheckpoint(checkpointId: string): { success: boolean; error?: string } {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return { success: false, error: `Checkpoint ${checkpointId} not found` };
    }
    
    try {
      // Restore all files to their checkpoint state
      for (const [filePath, originalContent] of checkpoint.files) {
        fs.writeFileSync(filePath, originalContent, 'utf8');
        log(`Restored: ${filePath}`);
      }
      
      // Remove files that were created after the checkpoint
      for (const operation of checkpoint.operations) {
        if (operation.type === 'create' && fs.existsSync(operation.path)) {
          fs.unlinkSync(operation.path);
          log(`Removed created file: ${operation.path}`);
        }
      }
      
      log(`Successfully rolled back to checkpoint: ${checkpointId}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Rollback failed: ${errorMessage}` };
    }
  }
  
  /**
   * Lists all available checkpoints
   */
  listCheckpoints(): Array<{ id: string; timestamp: Date; description: string; fileCount: number }> {
    return Array.from(this.checkpoints.values()).map(cp => ({
      id: cp.id,
      timestamp: cp.timestamp,
      description: cp.description,
      fileCount: cp.files.size
    })).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  /**
   * Cleans up old checkpoints to prevent memory issues
   */
  cleanup(maxCheckpoints: number = 10): void {
    const checkpoints = this.listCheckpoints();
    const toDelete = checkpoints.slice(maxCheckpoints);
    
    for (const checkpoint of toDelete) {
      this.checkpoints.delete(checkpoint.id);
      log(`Cleaned up old checkpoint: ${checkpoint.id}`);
    }
  }
}

// Global checkpoint manager instance
const checkpointManager = new CheckpointManager();

/**
 * Creates a checkpoint before applying file operations
 */
export function createCheckpoint(description: string, filePaths: Array<string>): string {
  return checkpointManager.createCheckpoint(description, filePaths);
}

/**
 * Rolls back to a specific checkpoint
 */
export function rollbackToCheckpoint(checkpointId: string): { success: boolean; error?: string } {
  return checkpointManager.rollbackToCheckpoint(checkpointId);
}

/**
 * Lists available checkpoints
 */
export function listCheckpoints(): Array<{ id: string; timestamp: Date; description: string; fileCount: number }> {
  return checkpointManager.listCheckpoints();
}

/**
 * Enhanced file operations with automatic checkpointing
 */
export function applyFileOperationsWithCheckpoint(
  operations: Array<FileOperation>, 
  workdir?: string,
  checkpointDescription?: string
): { success: boolean; checkpointId?: string; error?: string } {
  // Extract file paths for checkpoint
  const filePaths = operations.map(op => 
    workdir ? path.resolve(workdir, op.path) : op.path
  );
  
  // Create checkpoint
  const checkpointId = checkpointManager.createCheckpoint(
    checkpointDescription || `File operations at ${new Date().toISOString()}`,
    filePaths
  );
  
  try {
    // Apply operations
    for (const op of operations) {
      checkpointManager.recordOperation(op);
      
      switch (op.type) {
        case 'create':
          if (!op.content) {
            throw new Error(`Missing content for create operation on ${op.path}`);
          }
          log(`Creating file: ${op.path}`);
          createFile(op.path, op.content, workdir);
          break;

        case 'update':
          if (!op.diff) {
            throw new Error(`Missing diff for update operation on ${op.path}`);
          }
          log(`Updating file: ${op.path}`);
          applyUnifiedDiff(op.path, op.diff, workdir);
          break;

        case 'delete':
          log(`Deleting file: ${op.path}`);
          deleteFile(op.path, workdir);
          break;
      }
    }
    
    // Cleanup old checkpoints periodically
    checkpointManager.cleanup();
    
    return { success: true, checkpointId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`File operations failed, checkpoint ${checkpointId} available for rollback`);
    return { success: false, checkpointId, error: errorMessage };
  }
}

/**
 * Pre-commit integration for automatic style checking
 * Based on Cline's validation approach
 */

interface PreCommitResult {
  success: boolean;
  output: string;
  errors?: string;
  fixedFiles?: Array<string>;
}

/**
 * Checks if pre-commit is available and configured
 */
function isPreCommitAvailable(): boolean {
  try {
    const result = spawnSync('pre-commit', ['--version'], { 
      stdio: 'pipe',
      timeout: 5000
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Runs pre-commit checks on specific files
 */
function runPreCommitChecks(filePaths: Array<string>): PreCommitResult {
  if (!isPreCommitAvailable()) {
    return {
      success: true,
      output: 'Pre-commit not available - skipping checks'
    };
  }

  const result = spawnSync('pre-commit', ['run', '--files', ...filePaths], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000 // 30 second timeout
  });

  return {
    success: result.status === 0,
    output: result.stdout || '',
    errors: result.stderr || undefined
  };
}

/**
 * Attempts to auto-fix common style issues
 */
function autoFixStyleIssues(filePath: string): { fixed: boolean; changes?: string } {
  const ext = path.extname(filePath).toLowerCase();
  const config = getLanguageConfig(filePath);
  
  if (!config) {
    return { fixed: false };
  }

  // Language-specific auto-fixes
  const fixers: Record<string, Array<string>> = {
    '.js': ['eslint', '--fix', filePath],
    '.ts': ['eslint', '--fix', filePath],
    '.jsx': ['eslint', '--fix', filePath], 
    '.tsx': ['eslint', '--fix', filePath],
    '.py': ['black', filePath],
    '.go': ['gofmt', '-w', filePath],
    '.rs': ['rustfmt', filePath],
    '.java': ['google-java-format', '-i', filePath],
    '.css': ['prettier', '--write', filePath],
    '.scss': ['prettier', '--write', filePath],
    '.html': ['prettier', '--write', filePath],
    '.json': ['prettier', '--write', filePath],
    '.yaml': ['prettier', '--write', filePath],
    '.yml': ['prettier', '--write', filePath],
    '.md': ['prettier', '--write', filePath]
  };

  const fixer = fixers[ext];
  if (!fixer || !fixer[0]) {
    return { fixed: false };
  }

  const [command, ...args] = fixer;
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });

  return {
    fixed: result.status === 0,
    changes: result.status === 0 ? `Auto-fixed with ${command}` : undefined
  };
}

/**
 * Enhanced file operations with pre-commit validation
 */
export function applyFileOperationsWithValidation(
  operations: Array<FileOperation>,
  workdir?: string,
  options: {
    runPreCommit?: boolean;
    autoFix?: boolean;
    checkpointDescription?: string;
  } = {}
): { 
  success: boolean; 
  checkpointId?: string; 
  error?: string;
  preCommitResult?: PreCommitResult;
  autoFixResults?: Array<{ file: string; fixed: boolean; changes?: string }>;
} {
  const { runPreCommit = true, autoFix = true, checkpointDescription } = options;
  
  // Extract file paths for checkpoint and validation
  const filePaths = operations.map(op => 
    workdir ? path.resolve(workdir, op.path) : op.path
  );
  
  // Apply operations with checkpoint
  const operationResult = applyFileOperationsWithCheckpoint(
    operations, 
    workdir, 
    checkpointDescription
  );
  
  if (!operationResult.success) {
    return operationResult;
  }
  
  // Auto-fix style issues if requested
  const autoFixResults: Array<{ file: string; fixed: boolean; changes?: string }> = [];
  if (autoFix) {
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const fixResult = autoFixStyleIssues(filePath);
        autoFixResults.push({
          file: path.basename(filePath),
          fixed: fixResult.fixed,
          changes: fixResult.changes
        });
      }
    }
  }
  
  // Run pre-commit checks if requested
  let preCommitResult: PreCommitResult | undefined;
  if (runPreCommit) {
    const existingFiles = filePaths.filter(fp => fs.existsSync(fp));
    if (existingFiles.length > 0) {
      preCommitResult = runPreCommitChecks(existingFiles);
      
      // If pre-commit fails, log warning but don't fail the operation
      if (!preCommitResult.success) {
        log(`Pre-commit checks failed for files: ${existingFiles.join(', ')}`);
        log(`Pre-commit output: ${preCommitResult.output}`);
        if (preCommitResult.errors) {
          log(`Pre-commit errors: ${preCommitResult.errors}`);
        }
      }
    }
  }
  
  return {
    success: true,
    checkpointId: operationResult.checkpointId,
    preCommitResult,
    autoFixResults: autoFixResults.length > 0 ? autoFixResults : undefined
  };
} 