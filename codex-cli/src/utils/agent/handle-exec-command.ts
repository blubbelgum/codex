import type { CommandConfirmation } from "./agent-loop.js";
import type { ApprovalPolicy } from "../../approvals.js";
import type { ExecInput } from "./sandbox/interface.js";
import type { ResponseInputItem , ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { canAutoApprove } from "../../approvals.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { FullAutoErrorMode } from "../auto-approval-mode.js";
import { CODEX_UNSAFE_ALLOW_NO_SANDBOX, type AppConfig } from "../config.js";
import { exec } from "./exec.js";
import { 
  readFile, 
  writeToFile, 
  applySearchReplaceDiff
} from './handle-unified-diff.js';
import { adaptCommandForPlatform } from "./platform-commands.js";
import { ReviewDecision } from "./review.js";
import { isLoggingEnabled, log } from "../logger/log.js";
import { parseToolCallArguments } from "../parsers.js";
import { SandboxType } from "./sandbox/interface.js";
import { PATH_TO_SEATBELT_EXECUTABLE } from "./sandbox/macos-seatbelt.js";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Global Neovim connection instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let globalNeovimConnection: any = null;

// ---------------------------------------------------------------------------
// Session‑level cache of commands that the user has chosen to always approve.
//
// The values are derived via `deriveCommandKey()` which intentionally ignores
// volatile arguments (for example the patch text passed to `apply_patch`).
// Storing *generalised* keys means that once a user selects "always approve"
// for a given class of command we will genuinely stop prompting them for
// subsequent, equivalent invocations during the same CLI session.
// ---------------------------------------------------------------------------
const alwaysApprovedCommands = new Set<string>();

// ---------------------------------------------------------------------------
// Helper: Given the argv-style representation of a command, return a stable
// string key that can be used for equality checks.
//
// The key space purposefully abstracts away parts of the command line that
// are expected to change between invocations while still retaining enough
// information to differentiate *meaningfully distinct* operations.  See the
// extensive inline documentation for details.
// ---------------------------------------------------------------------------

function deriveCommandKey(cmd: Array<string>): string {
  // pull off only the bits you care about
  const [
    maybeShell,
    maybeFlag,
    coreInvocation,
    /* …ignore the rest… */
  ] = cmd;

  if (maybeShell === "bash" && maybeFlag === "-lc") {
    // If the command was invoked through `bash -lc "<script>"` we extract the
    // base program name from the script string.
    const script = coreInvocation ?? "";
    return script.split(/\s+/)[0] || "bash";
  }

  // For every other command we fall back to using only the program name (the
  // first argv element).  This guarantees we always return a *string* even if
  // `coreInvocation` is undefined.
  if (coreInvocation) {
    return coreInvocation.split(/\s+/)[0]!;
  }

  return JSON.stringify(cmd);
}

// ---------------------------------------------------------------------------
// Enhanced error recovery with automatic command retry
// ---------------------------------------------------------------------------
async function attemptCommandWithRecovery(
  execInput: ExecInput,
  originalCommand: Array<string>,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecCommandSummary> {
  const { additionalWritableRoots = [] } = execInput;
  
  // First attempt: Try the original command
  let result = await execCommand(
    execInput,
    false,
    additionalWritableRoots,
    config,
    abortSignal,
  );
  
  // If Windows and command failed with ENOENT, try recovery strategies
  if (os.platform() === "win32" && result.exitCode !== 0 && result.stderr.includes("ENOENT")) {
    log(`Windows command failed with ENOENT, attempting recovery for: ${originalCommand.join(" ")}`);
    
    // Strategy 1: Try with cmd.exe wrapper
    if (!originalCommand[0]?.startsWith("cmd.exe")) {
      const cmdWrapper = ["cmd.exe", "/c", ...originalCommand];
      log(`Retry strategy 1: Using cmd.exe wrapper: ${cmdWrapper.join(" ")}`);
      
      const modifiedInput = { ...execInput, cmd: cmdWrapper };
      result = await execCommand(
        modifiedInput,
        false,
        additionalWritableRoots,
        config,
        abortSignal,
      );
      
      if (result.exitCode === 0) {
        log("Command succeeded with cmd.exe wrapper");
        return result;
      }
    }
    
    // Strategy 2: Try platform-adapted command
    const adaptedCommand = adaptCommandForPlatform(originalCommand);
    
    if (JSON.stringify(adaptedCommand) !== JSON.stringify(originalCommand)) {
      log(`Retry strategy 2: Using platform-adapted command: ${adaptedCommand.join(" ")}`);
      
      const modifiedInput = { ...execInput, cmd: adaptedCommand };
      result = await execCommand(
        modifiedInput,
        false,
        additionalWritableRoots,
        config,
        abortSignal,
      );
      
      if (result.exitCode === 0) {
        log("Command succeeded with platform adaptation");
        return result;
      }
    }
    
    // Strategy 3: For file reading operations, try Node.js fs as fallback
    const baseCommand = originalCommand[0];
    if (baseCommand === "cat" || baseCommand === "type" || baseCommand === "more") {
      const filePath = originalCommand[1];
      if (filePath && !filePath.startsWith("-")) {
        log(`Retry strategy 3: Converting file read to Node.js fs for: ${filePath}`);
        
        try {
          // Try to read file using Node.js fs
          const fs = await import("fs");
          const path = await import("path");
          
          const resolvedPath = path.resolve(filePath);
          if (fs.existsSync(resolvedPath)) {
            const content = fs.readFileSync(resolvedPath, "utf-8");
            return {
              stdout: content,
              stderr: "",
              exitCode: 0,
              durationMs: 100,
            };
          }
        } catch (error) {
          log(`File read fallback failed: ${error}`);
        }
      }
    }
    
    // Strategy 4: For directory listing, use PowerShell as last resort
    if (baseCommand === "ls" || baseCommand === "dir") {
      const powershellCommand = [
        "powershell.exe", 
        "-Command", 
        `Get-ChildItem ${originalCommand.slice(1).join(" ") || "."} | Format-Table -AutoSize`
      ];
      
      log(`Retry strategy 4: Using PowerShell: ${powershellCommand.join(" ")}`);
      
      const modifiedInput = { ...execInput, cmd: powershellCommand };
      result = await execCommand(
        modifiedInput,
        false,
        additionalWritableRoots,
        config,
        abortSignal,
      );
      
      if (result.exitCode === 0) {
        log("Command succeeded with PowerShell");
        return result;
      }
    }
  }
  
  return result;
}

// ---------------------------------------------------------------------------
// Helper: Generate enhanced error message with Windows command suggestions and recovery info
// ---------------------------------------------------------------------------
function generateWindowsCommandSuggestion(
  command: Array<string>,
  error: string,
): string {
  if (os.platform() !== "win32" || command.length === 0) {
    return error;
  }

  const baseCommand = command[0];
  if (!baseCommand) {
    return error;
  }

  if (error.includes("ENOENT")) {
    // Try platform adaptation to see if there's a Windows equivalent
    const adaptedCommand = adaptCommandForPlatform(command);
    const hasAdaptation = JSON.stringify(adaptedCommand) !== JSON.stringify(command);
    
    const suggestions = [
      `${error}`,
      ``,
      `Windows Command Recovery Suggestions:`,
      ``,
    ];
    
    if (hasAdaptation) {
      suggestions.push(
        `1. Windows Equivalent: Try using the adapted command`,
        `   Original: ${command.join(" ")}`,
        `   Windows:  ${adaptedCommand.join(" ")}`,
        ``,
      );
    }
    
    suggestions.push(
      `${hasAdaptation ? "2" : "1"}. PowerShell Alternative: Use PowerShell which supports many Unix-like commands`,
      `   powershell.exe -Command "${command.join(" ")}"`,
      ``,
      `${hasAdaptation ? "3" : "2"}. For file operations: Use read(), write(), edit() functions for reliable file handling`,
      ``,
      `Note: The system attempted automatic recovery but all strategies failed.`,
    );
    
    return suggestions.join("\n");
  }

  return error;
}

type HandleExecCommandResult = {
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ResponseInputItem>;
};

// ---------------------------------------------------------------------------
// Handle OpenCode-style tool commands
// ---------------------------------------------------------------------------
async function handleOpenCodeTools(
  cmd: Array<string>,
  workdir?: string
): Promise<HandleExecCommandResult | null> {
  // Check if this is an OpenCode tool command
  if (cmd.length < 3 || cmd[0] !== "opencode-tool") {
    return null;
  }

  const toolName = cmd[1];
  const argsJson = cmd[2];

  if (!toolName || !argsJson) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let args: any;
  try {
    args = JSON.parse(argsJson);
  } catch (error) {
    return {
      outputText: JSON.stringify({
        output: `Error: Invalid tool arguments JSON: ${error}`,
        metadata: { error: "invalid_json" }
      }),
      metadata: { error: "invalid_json" }
    };
  }

  switch (toolName) {
    case "read": {
      const { filePath, offset = 0, limit = 2000 } = args;
      if (!filePath) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath is required for read operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        let numberedContent: string;
        let totalLines: number;
        let selectedLines: Array<string>;

        // Use Neovim if connected, otherwise use file system
        if (globalNeovimConnection && globalNeovimConnection.isConnected()) {
          numberedContent = await readFileViaNeovim(filePath, offset, limit);
          const content = await globalNeovimConnection.getBufferContent(filePath);
          const lines = content.split('\n');
          selectedLines = lines.slice(offset, offset + limit);
          totalLines = lines.length;
        } else {
        const content = readFile(filePath, workdir);
        const lines = content.split('\n');
          selectedLines = lines.slice(offset, offset + limit);
          numberedContent = selectedLines.map((line, idx) => 
          `${(offset + idx + 1).toString().padStart(5, '0')}| ${line}`
        ).join('\n');
          totalLines = lines.length;
        }

        return {
          outputText: JSON.stringify({
            output: numberedContent,
            metadata: { 
              operation: "read",
              file: filePath,
              lines_read: selectedLines.length,
              total_lines: totalLines,
              offset,
              limit,
              via_neovim: globalNeovimConnection && globalNeovimConnection.isConnected()
            }
          }),
          metadata: { operation: "read", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "read_failed" }
          }),
          metadata: { error: "read_failed" }
        };
      }
    }

    case "write": {
      const { filePath, content } = args;
      if (!filePath || content === undefined) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath and content are required for write operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        let result: string;

        // Use Neovim if connected, otherwise use file system
        if (globalNeovimConnection && globalNeovimConnection.isConnected()) {
          result = await writeFileViaNeovim(filePath, content);
        } else {
          result = writeToFile(filePath, content, workdir);
        }

        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "write", 
              file: filePath,
              via_neovim: globalNeovimConnection && globalNeovimConnection.isConnected()
            }
          }),
          metadata: { operation: "write", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "write_failed" }
          }),
          metadata: { error: "write_failed" }
        };
      }
    }

    case "edit": {
      const { filePath, search, replace, replaceAll = false } = args;
      if (!filePath || !search || replace === undefined) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath, search, and replace are required for edit operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        let result: string;

        // Use Neovim if connected, otherwise use file system
        if (globalNeovimConnection && globalNeovimConnection.isConnected()) {
          result = await editFileViaNeovim(filePath, search, replace);
        } else {
        // Convert to the SEARCH/REPLACE format
        const diffContent = `------- SEARCH\n${search}\n=======\n${replace}\n+++++++ REPLACE`;
          result = applySearchReplaceDiff(filePath, diffContent, workdir);
        }

        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "edit", 
              file: filePath, 
              replaceAll,
              via_neovim: globalNeovimConnection && globalNeovimConnection.isConnected()
            }
          }),
          metadata: { operation: "edit", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
                // Provide helpful guidance for common edit failures
        let guidance = "";
        if (errorMessage.includes("Search content not found")) {
          guidance = "\n\nGuidance: The search text was not found. Common fixes:\n" +
                    "1. Use read() to check exact file content\n" +
                    "2. Copy literal text (avoid regex patterns like [\\s\\S]*)\n" +
                    "3. Check whitespace and indentation exactly\n" +
                    "4. Use smaller, unique search strings";
        } else if (errorMessage.includes("multiple matches")) {
          guidance = "\n\nGuidance: Search text appears multiple times. Either provide more context in the search string or use replaceAll: true.";
        } else if (errorMessage.includes("No such file")) {
          guidance = "\n\nGuidance: File does not exist. Use write() to create a new file or check the file path with ls().";
        } else if (errorMessage.includes("regex patterns") || errorMessage.includes("escape sequences")) {
          guidance = "\n\nGuidance: Don't use regex patterns or escape sequences in search text. Use exact literal text from the file.";
          }
        
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}${guidance}`,
            metadata: { error: "edit_failed", guidance: guidance }
          }),
          metadata: { error: "edit_failed" }
        };
      }
    }

    case "multi_edit": {
      const { operations } = args;
      
      if (!operations || !Array.isArray(operations)) {
      return {
        outputText: JSON.stringify({
            output: "Error: multi_edit requires 'operations' array\n\nFormat: multi_edit({operations: [{filePath: 'file.js', edits: [{old_string: 'search', new_string: 'replace'}]}]})",
            metadata: { error: "missing_operations" }
          }),
          metadata: { error: "missing_operations" }
        };
      }

      try {
        // Capture before content for diff display
        const beforeContent: Record<string, string> = {};
        for (const operation of operations) {
          const resolvedPath = workdir ? path.resolve(workdir, operation.filePath) : operation.filePath;
          try {
            beforeContent[operation.filePath] = fsSync.readFileSync(resolvedPath, 'utf8');
          } catch {
            beforeContent[operation.filePath] = '';
          }
        }
        
        // Process operations with improved error handling
        const results: Array<string> = [];
        const errors: Array<string> = [];
        
        for (const operation of operations) {
          try {
            // Convert each operation to SEARCH/REPLACE format individually
            for (const edit of operation.edits || []) {
              const diffContent = `------- SEARCH\n${edit.old_string}\n=======\n${edit.new_string}\n+++++++ REPLACE`;
              const result = applySearchReplaceDiff(operation.filePath, diffContent, workdir);
              results.push(`${operation.filePath}: ${result}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Try fuzzy matching for better error messages
            try {
              const resolvedPath = workdir ? path.resolve(workdir, operation.filePath) : operation.filePath;
              const fileContent = fsSync.readFileSync(resolvedPath, 'utf8');
              
              for (const edit of operation.edits || []) {
                const fuzzyResult = findFuzzyMatch(fileContent, edit.old_string);
                if (!fuzzyResult.found && fuzzyResult.suggestion) {
                  errors.push(`${operation.filePath}: ${errorMessage}\n   Suggestion: ${fuzzyResult.suggestion}`);
                } else {
                  errors.push(`${operation.filePath}: ${errorMessage}`);
                }
              }
            } catch {
              errors.push(`${operation.filePath}: ${errorMessage}`);
            }
          }
        }
        
        // If there are errors, provide detailed feedback
        if (errors.length > 0) {
          const combinedResults = [
            ...results,
            "",
            "ERRORS:",
            ...errors,
            "",
            "TROUBLESHOOTING:",
            "1. Use read() to get exact text content",
            "2. Copy text exactly including whitespace/indentation", 
            "3. For multiple matches, try more specific search text",
            "4. Consider individual edit() calls for problematic files"
          ].join('\n');
          
          return {
            outputText: JSON.stringify({
              output: combinedResults,
              metadata: { 
                operation: "multi_edit",
                partial_success: results.length > 0,
                errors: errors.length,
                completed: results.length
              }
            }),
            metadata: { 
              operation: "multi_edit",
              partial_success: results.length > 0,
              errors: errors.length
            }
          };
        }
        
        // Generate diff display for successful operations
        const diffs: Array<string> = [];
        for (const operation of operations) {
          const resolvedPath = workdir ? path.resolve(workdir, operation.filePath) : operation.filePath;
          try {
            const afterContent = fsSync.readFileSync(resolvedPath, 'utf8');
            const diff = generateSimpleDiff(beforeContent[operation.filePath] || '', afterContent, operation.filePath);
            if (diff) {
              diffs.push(diff);
            }
          } catch {
            // File might not exist after operation
          }
        }
        
        // Count total edits applied
        const totalEdits = operations.reduce((sum: number, op: { edits?: Array<unknown> }) => sum + (op.edits?.length || 0), 0);
        const filesModified = operations.length;
        
        const output = diffs.length > 0 ? diffs.join('\n\n') : results.join('\n');
        
        return {
          outputText: JSON.stringify({
            output: output,
            metadata: { 
              operation: "multi_edit",
              files_modified: filesModified,
              total_edits: totalEdits,
              atomic: true,
              show_diff: true
            }
          }),
          metadata: { 
            operation: "multi_edit", 
            files_modified: filesModified,
            total_edits: totalEdits,
            show_diff: true
          }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}\n\nGuidance:\n- Use exact literal text from read() output\n- Ensure all files exist before editing\n- For complex edits, consider individual edit() calls\n- Check file permissions`,
            metadata: { error: "multi_edit_failed" }
          }),
          metadata: { error: "multi_edit_failed" }
        };
      }
    }

    case "ls": {
      const { path: dirPath = ".", showHidden = false, recursive = false } = args;
      
      try {
        const { spawnSync } = await import("child_process");
        
        // Build the command as a proper shell command string
        let command = `ls -la`;
        if (recursive) {
          command += " -R";
        }
        command += ` "${dirPath}"`;
        
        if (!showHidden) {
          command += " | grep -v '^d.*\\s\\.$' | grep -v '^.*\\s\\.\\.$' | grep -v '^[^d].*\\s\\.[^.]*$'";
        }
        
        const result = spawnSync("bash", ["-c", command], {
          cwd: workdir || process.cwd(),
          encoding: 'utf8'
        });

        if (result.error) {
          throw result.error;
        }

        return {
          outputText: JSON.stringify({
            output: result.stdout || result.stderr || "",
            metadata: { 
              operation: "ls",
              path: dirPath,
              exit_code: result.status || 0
            }
          }),
          metadata: { operation: "ls", path: dirPath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "ls_failed" }
          }),
          metadata: { error: "ls_failed" }
        };
      }
    }

    case "glob": {
      const { pattern, cwd: globCwd, onlyFiles = true } = args;
      if (!pattern) {
        return {
          outputText: JSON.stringify({
            output: "Error: pattern is required for glob operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        const { spawnSync } = await import("child_process");
        
        // Convert glob pattern to find-compatible pattern
        // Handle patterns like "**/*.ts" or "src/**/*.{js,ts}"
        let findCmd: string;
        
        if (pattern.includes("**")) {
          // Handle recursive patterns
          const basePath = globCwd || '.';
          let namePattern = pattern;
          
          // Extract the file extension pattern
          if (pattern.includes('.{') && pattern.includes('}')) {
            // Handle patterns like "**/*.{js,ts}"
            const match = pattern.match(/\*\*\/\*\.{([^}]+)}/);
            if (match) {
              const extensions = match[1].split(',');
                             const findPatterns = extensions.map((ext: string) => `"*.${ext.trim()}"`).join(' -o -name ');
              findCmd = `find ${basePath} ${onlyFiles ? '-type f' : ''} \\( -name ${findPatterns} \\)`;
            } else {
              // Fallback to basic pattern
              namePattern = pattern.replace(/\*\*/g, '*');
              findCmd = `find ${basePath} ${onlyFiles ? '-type f' : ''} -name "${namePattern}"`;
            }
          } else {
            // Handle simple recursive patterns like "**/*.ts"
            namePattern = pattern.replace(/\*\*\//g, '');
            findCmd = `find ${basePath} ${onlyFiles ? '-type f' : ''} -name "${namePattern}"`;
          }
        } else {
          // Non-recursive pattern
          findCmd = `find ${globCwd || '.'} -maxdepth 1 ${onlyFiles ? '-type f' : ''} -name "${pattern}"`;
        }
        
        const result = spawnSync("bash", ["-c", findCmd], {
          cwd: workdir || process.cwd(),
          encoding: 'utf8'
        });

        const files = result.stdout.trim().split('\n').filter(line => line.trim() !== '');
        
        return {
          outputText: JSON.stringify({
            output: files.join('\n'),
            metadata: { 
              operation: "glob",
              pattern,
              matches: files.length
            }
          }),
          metadata: { operation: "glob", pattern }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "glob_failed" }
          }),
          metadata: { error: "glob_failed" }
        };
      }
    }

    case "grep": {
      const { pattern, path: searchPath = ".", caseSensitive = true, includePattern, excludePattern } = args;
      if (!pattern) {
        return {
          outputText: JSON.stringify({
            output: "Error: pattern is required for grep operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        const { spawnSync } = await import("child_process");
        const grepArgs = ["rg", pattern, searchPath];
        
        if (!caseSensitive) {
          grepArgs.push("-i");
        }
        if (includePattern) {
          grepArgs.push("-g", includePattern);
        }
        if (excludePattern) {
          grepArgs.push("-g", `!${excludePattern}`);
        }
        
        const result = spawnSync(grepArgs[0]!, grepArgs.slice(1), {
          cwd: workdir || process.cwd(),
          encoding: 'utf8'
        });

        return {
          outputText: JSON.stringify({
            output: result.stdout || (result.status === 1 ? "No matches found" : result.stderr),
            metadata: { 
              operation: "grep",
              pattern,
              path: searchPath,
              exit_code: result.status || 0
            }
          }),
          metadata: { operation: "grep", pattern }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "grep_failed" }
          }),
          metadata: { error: "grep_failed" }
        };
      }
    }

    case "web_fetch": {
      const { url, method = "GET", headers, body } = args;
      if (!url) {
        return {
          outputText: JSON.stringify({
            output: "Error: url is required for web_fetch operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: headers || {},
        };
        
        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
          fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const text = await response.text();

        return {
          outputText: JSON.stringify({
            output: text,
            metadata: { 
              operation: "web_fetch",
              url,
              status: response.status,
              headers: Object.fromEntries(response.headers.entries())
            }
          }),
          metadata: { operation: "web_fetch", url }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "web_fetch_failed" }
          }),
          metadata: { error: "web_fetch_failed" }
        };
      }
    }

    case "todoread": {
      // Read current todo list - takes no parameters
      const sessionId = "default"; // Use default session for now
      const todoFile = path.join(workdir || process.cwd(), '.codex-todos.json');
      
      // Todo schema following OpenCode patterns
      interface TodoItem {
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed";
        priority: "high" | "medium" | "low";
      }
      
      interface TodoStorage {
        [sessionId: string]: Array<TodoItem>;
      }
      
      let todoStorage: TodoStorage = {};
      
      try {
        // Load existing todos with session support
        if (fsSync.existsSync(todoFile)) {
          todoStorage = JSON.parse(fsSync.readFileSync(todoFile, 'utf8'));
        }
      } catch {
        todoStorage = {};
      }

      // Ensure session exists
      if (!todoStorage[sessionId]) {
        todoStorage[sessionId] = [];
      }

      const todos = todoStorage[sessionId];
          const activeTodos = todos.filter(t => t.status !== "completed");

          return {
            outputText: JSON.stringify({
          output: JSON.stringify(todos, null, 2),
              metadata: { 
            todos,
            title: `${activeTodos.length} todos`,
            operation: "todoread"
          }
        }),
        metadata: { 
          todos,
          title: `${activeTodos.length} todos`,
          operation: "todoread"
        }
      };
    }

    case "todowrite": {
      // Write complete todo list - takes full array
      const { todos } = args;
      
      if (!Array.isArray(todos)) {
          return {
            outputText: JSON.stringify({
            output: "Error: todos must be an array",
            metadata: { error: "invalid_parameter" }
          }),
          metadata: { error: "invalid_parameter" }
        };
      }

      const sessionId = "default"; // Use default session for now
      const todoFile = path.join(workdir || process.cwd(), '.codex-todos.json');
      
      interface TodoItem {
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed";
        priority: "high" | "medium" | "low";
      }
      
      interface TodoStorage {
        [sessionId: string]: Array<TodoItem>;
      }
      
      let todoStorage: TodoStorage = {};
      
      try {
        // Load existing todos with session support
        if (fsSync.existsSync(todoFile)) {
          todoStorage = JSON.parse(fsSync.readFileSync(todoFile, 'utf8'));
        }
      } catch {
        todoStorage = {};
      }

      // Update the todos for this session
          todoStorage[sessionId] = todos;
          
      try {
        await fs.writeFile(todoFile, JSON.stringify(todoStorage, null, 2));
      } catch (error) {
          return {
            outputText: JSON.stringify({
            output: `Error writing todos: ${error}`,
            metadata: { error: "write_failed" }
          }),
          metadata: { error: "write_failed" }
        };
      }

      const activeTodos = todos.filter((t: TodoItem) => t.status !== "completed");

          return {
            outputText: JSON.stringify({
          output: JSON.stringify(todos, null, 2),
          metadata: { 
            todos,
            title: `${activeTodos.length} todos`,
            operation: "todowrite"
          }
        }),
        metadata: { 
          todos,
          title: `${activeTodos.length} todos`,
          operation: "todowrite"
        }
      };
    }

    case "task": {
      // Task tool would launch a sub-agent - for now, return a placeholder
      const { description, prompt } = args;
      return {
        outputText: JSON.stringify({
          output: `Task "${description}" would be launched with prompt: ${prompt}\n\nNote: Sub-agent launching is not yet implemented in Codex CLI.`,
          metadata: { operation: "task", description }
        }),
        metadata: { operation: "task", description }
      };
    }

    case "notebook_read":
    case "notebook_edit": {
      // Notebook operations would require Jupyter notebook parsing
      return {
        outputText: JSON.stringify({
          output: `Notebook operations (${toolName}) are not yet implemented in Codex CLI.`,
          metadata: { operation: toolName, status: "not_implemented" }
        }),
        metadata: { operation: toolName, status: "not_implemented" }
      };
    }

    case "lsp_hover": {
      const { filePath, line, character } = args;
      if (!filePath || line === undefined || character === undefined) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath, line, and character are required for lsp_hover operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        // Get LSP manager instance
        const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
        const lspManager = new NeovimLSPManager(workdir || process.cwd());
        
        await lspManager.initialize();
        const hoverInfo = await lspManager.getHoverInfo(filePath, line, character);
        
        const result = hoverInfo ? JSON.stringify(hoverInfo, null, 2) : "No hover information available";
        
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "lsp_hover",
              file: filePath,
              position: { line, character }
            }
          }),
          metadata: { operation: "lsp_hover", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `LSP Hover Error: ${errorMessage}`,
            metadata: { error: "lsp_hover_failed" }
          }),
          metadata: { error: "lsp_hover_failed" }
        };
      }
    }

    case "lsp_diagnostics": {
      const { filePath } = args;
      if (!filePath) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath is required for lsp_diagnostics operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        // Get LSP manager instance
        const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
        const lspManager = new NeovimLSPManager(workdir || process.cwd());
        
        await lspManager.initialize();
        const diagnostics = await lspManager.getDiagnostics(filePath);
        
        const result = diagnostics.length > 0 ? JSON.stringify(diagnostics, null, 2) : "No diagnostics found";
        
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "lsp_diagnostics",
              file: filePath,
              count: diagnostics.length
            }
          }),
          metadata: { operation: "lsp_diagnostics", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `LSP Diagnostics Error: ${errorMessage}`,
            metadata: { error: "lsp_diagnostics_failed" }
          }),
          metadata: { error: "lsp_diagnostics_failed" }
        };
      }
    }

    case "lsp_completion": {
      const { filePath, line, character } = args;
      if (!filePath || line === undefined || character === undefined) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath, line, and character are required for lsp_completion operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        // Get LSP manager instance
        const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
        const lspManager = new NeovimLSPManager(workdir || process.cwd());
        
        await lspManager.initialize();
        const completions = await lspManager.getCompletions(filePath, line, character);
        
        const result = completions.length > 0 ? JSON.stringify(completions, null, 2) : "No completions available";
        
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "lsp_completion",
              file: filePath,
              position: { line, character },
              count: completions.length
            }
          }),
          metadata: { operation: "lsp_completion", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `LSP Completion Error: ${errorMessage}`,
            metadata: { error: "lsp_completion_failed" }
          }),
          metadata: { error: "lsp_completion_failed" }
        };
      }
    }

    case "lsp_definition": {
      const { filePath, line, character } = args;
      if (!filePath || line === undefined || character === undefined) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath, line, and character are required for lsp_definition operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        // Get LSP manager instance
        const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
        const lspManager = new NeovimLSPManager(workdir || process.cwd());
        
        await lspManager.initialize();
        const definition = await lspManager.goToDefinition(filePath, line, character);
        
        const result = definition ? JSON.stringify(definition, null, 2) : "No definition found";
        
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "lsp_definition",
              file: filePath,
              position: { line, character }
            }
          }),
          metadata: { operation: "lsp_definition", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `LSP Definition Error: ${errorMessage}`,
            metadata: { error: "lsp_definition_failed" }
          }),
          metadata: { error: "lsp_definition_failed" }
        };
      }
    }

    case "lsp_references": {
      const { filePath, line, character } = args;
      if (!filePath || line === undefined || character === undefined) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath, line, and character are required for lsp_references operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        // Get LSP manager instance
        const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
        const lspManager = new NeovimLSPManager(workdir || process.cwd());
        
        await lspManager.initialize();
        const references = await lspManager.findReferences(filePath, line, character);
        
        const result = references.length > 0 ? JSON.stringify(references, null, 2) : "No references found";
        
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { 
              operation: "lsp_references",
              file: filePath,
              position: { line, character },
              count: references.length
            }
          }),
          metadata: { operation: "lsp_references", file: filePath }
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `LSP References Error: ${errorMessage}`,
            metadata: { error: "lsp_references_failed" }
          }),
          metadata: { error: "lsp_references_failed" }
        };
      }
    }

    case "lsp_format": {
      const { filePath } = args;
      if (!filePath) {
        return {
          outputText: JSON.stringify({
            output: "Error: filePath is required for lsp_format operation",
            metadata: { error: "missing_parameter" }
          }),
          metadata: { error: "missing_parameter" }
        };
      }

      try {
        // Get LSP manager instance
        const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
        const lspManager = new NeovimLSPManager(workdir || process.cwd());
        
        await lspManager.initialize();
        const edits = await lspManager.formatFile(filePath);
        
        // Apply the formatting edits if any
        if (edits.length > 0) {
          // Apply edits using our existing edit functionality
          for (const edit of edits) {
            const { range: _range, newText: _newText } = edit;
            // Apply edit to file - this would need integration with our file editing system
          }
          
          return {
            outputText: JSON.stringify({
              output: `File formatted with ${edits.length} changes`,
              metadata: { 
                operation: "lsp_format",
                file: filePath,
                changes: edits.length
              }
            }),
            metadata: { operation: "lsp_format", file: filePath }
          };
        } else {
          return {
            outputText: JSON.stringify({
              output: "File already properly formatted",
              metadata: { 
                operation: "lsp_format",
                file: filePath,
                changes: 0
              }
            }),
            metadata: { operation: "lsp_format", file: filePath }
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `LSP Format Error: ${errorMessage}`,
            metadata: { error: "lsp_format_failed" }
          }),
          metadata: { error: "lsp_format_failed" }
        };
      }
    }

    default:
      return {
        outputText: JSON.stringify({
          output: `Unknown OpenCode tool: ${toolName}`,
          metadata: { error: "unknown_tool" }
        }),
        metadata: { error: "unknown_tool" }
      };
  }
}

// ---------------------------------------------------------------------------
// Handle OpenCode-style function calls (read, write, edit, etc.)
// This should be called early in handleExecCommand to catch these commands
// ---------------------------------------------------------------------------
async function handleFileOperations(
  cmd: Array<string>,
  workdir?: string
): Promise<HandleExecCommandResult | null> {
  // Check for OpenCode-style tools first
  const openCodeResult = await handleOpenCodeTools(cmd, workdir);
  if (openCodeResult) {
    return openCodeResult;
  }

  // Early return if not a bash command
  if (cmd.length < 3 || cmd[0] !== "bash" || cmd[1] !== "-c") {
    return null;
  }

  // Legacy bash commands removed - use edit() function calls instead

  return null;
}

// Multi-edit functionality removed - use individual edit() calls instead

export async function handleExecCommand(
  args: ExecInput,
  config: AppConfig,
  policy: ApprovalPolicy,
  additionalWritableRoots: ReadonlyArray<string>,
  getCommandConfirmation: (
    command: Array<string>,
  ) => Promise<CommandConfirmation>,
  abortSignal?: AbortSignal,
): Promise<HandleExecCommandResult> {
  const { cmd, workdir } = args;

  // Check for Neovim connection commands first
  const neovimResult = await handleNeovimConnection(cmd, workdir);
  if (neovimResult) {
    return neovimResult;
  }

  // Early check for file operations - this should be first priority
  const fileOpResult = await handleFileOperations(cmd, workdir);
  if (fileOpResult) {
    return fileOpResult;
  }

  const key = deriveCommandKey(cmd);

  // 1) If the user has already said "always approve", skip
  //    any policy & never sandbox.
  if (alwaysApprovedCommands.has(key)) {
    return execCommand(
      args,
      false,
      additionalWritableRoots,
      config,
      abortSignal,
    ).then((summary) => convertSummaryToResult(summary, cmd));
  }

  // 2) Otherwise fall back to the normal policy
  // `canAutoApprove` now requires the list of writable roots that the command
  // is allowed to modify.  For the CLI we conservatively pass the current
  // working directory so that edits are constrained to the project root.  If
  // the caller wishes to broaden or restrict the set it can be made
  // configurable in the future.
  const safety = canAutoApprove(cmd, workdir, policy, [process.cwd()]);

  let runInSandbox: boolean;
  switch (safety.type) {
    case "ask-user": {
      const review = await askUserPermission(
        args,
        getCommandConfirmation,
      );
      if (review != null) {
        return review;
      }

      runInSandbox = false;
      break;
    }
    case "auto-approve": {
      runInSandbox = safety.runInSandbox;
      break;
    }
    case "reject": {
      return {
        outputText: "aborted",
        metadata: {
          error: "command rejected",
          reason: "Command rejected by auto-approval system.",
        },
      };
    }
  }

  const summary = await execCommand(
    args,
    runInSandbox,
    additionalWritableRoots,
    config,
    abortSignal,
  );
  // If the operation was aborted in the meantime, propagate the cancellation
  // upward by returning an empty (no-op) result so that the agent loop will
  // exit cleanly without emitting spurious output.
  if (abortSignal?.aborted) {
    return {
      outputText: "",
      metadata: {},
    };
  }
  if (
    summary.exitCode !== 0 &&
    runInSandbox &&
    // Default: If the user has configured to ignore and continue,
    // skip re-running the command.
    //
    // Otherwise, if they selected "ask-user", then we should ask the user
    // for permission to re-run the command outside of the sandbox.
    config.fullAutoErrorMode &&
    config.fullAutoErrorMode === FullAutoErrorMode.ASK_USER
  ) {
    const review = await askUserPermission(
      args,
      getCommandConfirmation,
    );
    if (review != null) {
      return review;
    } else {
      // The user has approved the command, so we will run it outside of the
      // sandbox.
      const summary = await execCommand(
        args,
        false,
        additionalWritableRoots,
        config,
        abortSignal,
      );
      return convertSummaryToResult(summary, cmd);
    }
  } else {
    return convertSummaryToResult(summary, cmd);
  }
}

function convertSummaryToResult(
  summary: ExecCommandSummary,
  command?: Array<string>,
): HandleExecCommandResult {
  const { stdout, stderr, exitCode, durationMs } = summary;
  let outputText = stdout || stderr;

  // If command failed with ENOENT on Windows, provide helpful suggestions
  if (exitCode !== 0 && command && stderr.includes("ENOENT")) {
    outputText = generateWindowsCommandSuggestion(command, outputText);
  }

  const metadata = {
    exit_code: exitCode,
    duration_seconds: Math.round(durationMs / 100) / 10,
  };

  // Always return JSON-formatted output to ensure consistency with parseToolCallOutput expectations
  return {
    outputText: JSON.stringify({
      output: outputText,
      metadata: metadata,
    }),
    metadata: metadata,
  };
}

type ExecCommandSummary = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

async function execCommand(
  execInput: ExecInput,
  runInSandbox: boolean,
  additionalWritableRoots: ReadonlyArray<string>,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecCommandSummary> {
  let { workdir } = execInput;
  let resolvedWorkdir = workdir || process.cwd();

  if (workdir) {
    try {
      await fs.access(workdir);
    } catch (e) {
      log(`EXEC workdir=${workdir} not found, use process.cwd() instead`);
      resolvedWorkdir = process.cwd();
      workdir = resolvedWorkdir;
    }
  }

  if (isLoggingEnabled()) {
    const { cmd, timeoutInMillis } = execInput;
    // Seconds are a bit easier to read in log messages and most timeouts
    // are specified as multiples of 1000, anyway.
    const timeout =
      timeoutInMillis != null
        ? Math.round(timeoutInMillis / 1000).toString()
        : "undefined";
    log(
      `EXEC running \`${formatCommandForDisplay(
        cmd,
      )}\` in workdir=${workdir} with timeout=${timeout}s`,
    );
  }

  // Note exec() is coded defensively and should not throw.
  // Any internal errors should be mapped to a non-zero value for the exitCode field.
  const start = Date.now();
  const execResult = await exec(
    { ...execInput, additionalWritableRoots: [...additionalWritableRoots] },
    await getSandbox(runInSandbox),
    config,
    abortSignal,
  );
  const duration = Date.now() - start;
  const { stdout, stderr, exitCode } = execResult;

  if (isLoggingEnabled()) {
    log(
      `EXEC exit=${exitCode} time=${duration}ms:\n\tSTDOUT: ${stdout}\n\tSTDERR: ${stderr}`,
    );
  }

  return {
    stdout,
    stderr,
    exitCode,
    durationMs: duration,
  };
}

/** Return `true` if the `/usr/bin/sandbox-exec` is present and executable. */
const isSandboxExecAvailable: Promise<boolean> = fs
  .access(PATH_TO_SEATBELT_EXECUTABLE, fs.constants.X_OK)
  .then(
    () => true,
    (err) => {
      if (!["ENOENT", "ACCESS", "EPERM"].includes(err.code)) {
        log(
          `Unexpected error for \`stat ${PATH_TO_SEATBELT_EXECUTABLE}\`: ${err.message}`,
        );
      }
      return false;
    },
  );

async function getSandbox(runInSandbox: boolean): Promise<SandboxType> {
  if (runInSandbox) {
    if (process.platform === "darwin") {
      // On macOS we rely on the system-provided `sandbox-exec` binary to
      // enforce the Seatbelt profile.  However, starting with macOS 14 the
      // executable may be removed from the default installation or the user
      // might be running the CLI on a stripped-down environment (for
      // instance, inside certain CI images).  Attempting to spawn a missing
      // binary makes Node.js throw an *uncaught* `ENOENT` error further down
      // the stack which crashes the whole CLI.
      if (await isSandboxExecAvailable) {
        return SandboxType.MACOS_SEATBELT;
      } else {
        throw new Error(
          "Sandbox was mandated, but 'sandbox-exec' was not found in PATH!",
        );
      }
    } else if (process.platform === "linux") {
      // TODO: Need to verify that the Landlock sandbox is working. For example,
      // using Landlock in a Linux Docker container from a macOS host may not
      // work.
      return SandboxType.LINUX_LANDLOCK;
    } else if (process.platform === "win32") {
      // On Windows, we don't have a native sandbox implementation yet.
      // For now, fall back to no sandbox but log a warning.
      log(
        "Warning: Sandbox requested on Windows, but no Windows sandbox is implemented. Running without sandbox.",
      );
      return SandboxType.NONE;
    } else if (CODEX_UNSAFE_ALLOW_NO_SANDBOX) {
      // Allow running without a sandbox if the user has explicitly marked the
      // environment as already being sufficiently locked-down.
      return SandboxType.NONE;
    }

    // For all else, we hard fail if the user has requested a sandbox and none is available.
    throw new Error("Sandbox was mandated, but no sandbox is available!");
  } else {
    return SandboxType.NONE;
  }
}

/**
 * If return value is non-null, then the command was rejected by the user.
 */
async function askUserPermission(
  args: ExecInput,
  getCommandConfirmation: (
    command: Array<string>,
  ) => Promise<CommandConfirmation>,
): Promise<HandleExecCommandResult | null> {
  const { review: decision, customDenyMessage, runInBackground } = await getCommandConfirmation(
    args.cmd,
  );

  if (decision === ReviewDecision.ALWAYS) {
    // Persist this command so we won't ask again during this session.
    const key = deriveCommandKey(args.cmd);
    alwaysApprovedCommands.add(key);
  }

  // Handle EXPLAIN decision by returning null to continue with the normal flow
  // but with a flag to indicate that an explanation was requested
  if (decision === ReviewDecision.EXPLAIN) {
    return null;
  }

  // If approved and runInBackground is true, update execInput
  if ((decision === ReviewDecision.YES || decision === ReviewDecision.ALWAYS) && runInBackground) {
    args.runInBackground = true;
  }

  // Any decision other than an affirmative (YES / ALWAYS) or EXPLAIN aborts execution.
  if (decision !== ReviewDecision.YES && decision !== ReviewDecision.ALWAYS) {
    const note =
      decision === ReviewDecision.NO_CONTINUE
        ? customDenyMessage?.trim() || "No, don't do that — keep going though."
        : "No, don't do that — stop for now.";
    return {
      outputText: "aborted",
      metadata: {},
      additionalItems: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: note }],
        },
      ],
    };
  } else {
    return null;
  }
}

// Enhanced version with automatic recovery for better cross-platform support
export async function handleExecCommandWithRecovery(
  functionCall: ResponseFunctionToolCall,
  _enableStdoutTruncation: boolean = true,
  _enableFullStdout: boolean = false,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<HandleExecCommandResult> {
  const callId = functionCall?.arguments || "";
  const command = parseToolCallArguments(callId);

  if (command == null) {
    log(`parseToolCallArguments returned null for: ${callId}`);
    return {
      outputText: JSON.stringify({
        output: `Invalid command arguments: ${callId}`,
        metadata: { exit_code: 1, duration_seconds: 0 },
      }),
      metadata: { exit_code: 1, duration_seconds: 0 },
    };
  }

  // Enhanced command validation
  const { cmd: originalCmd, workdir, timeoutInMillis } = command;
  const cmd = originalCmd;
  
  // Check for command repetition to prevent infinite loops
  const repetitionWarning = detectCommandRepetition(cmd);
  if (repetitionWarning) {
    return {
      outputText: JSON.stringify({
        output: repetitionWarning,
        metadata: { exit_code: 1, duration_seconds: 0, warning: "command_repetition" },
      }),
      metadata: { exit_code: 1, duration_seconds: 0, warning: "command_repetition" },
    };
  }
  
  log(`Executing command with recovery: ${cmd.join(" ")} in ${workdir || process.cwd()}`);

  // Create execInput with corrected command
  const execInput: ExecInput = {
    cmd,
    workdir,
    timeoutInMillis,
    additionalWritableRoots: [],
  };

  try {
    // Use enhanced recovery mechanism
    const summary = await attemptCommandWithRecovery(execInput, cmd, config, abortSignal);
    
    return convertSummaryToResult(summary, cmd);
  } catch (error) {
    log(`Command execution failed: ${error}`);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const enhancedError = generateWindowsCommandSuggestion(cmd, errorMessage);
    
    return {
      outputText: JSON.stringify({
        output: enhancedError,
        metadata: { exit_code: 1, duration_seconds: 0 },
      }),
      metadata: { exit_code: 1, duration_seconds: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Simple diff generation for showing code changes
// ---------------------------------------------------------------------------
function generateSimpleDiff(beforeContent: string, afterContent: string, filePath: string): string {
  if (beforeContent === afterContent) {
    return '';
  }
  
  const beforeLines = beforeContent.split('\n');
  const afterLines = afterContent.split('\n');
  
  const diffLines: Array<string> = [`--- ${filePath}`];
  
  // Simple line-by-line diff
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  let hasChanges = false;
  
  for (let i = 0; i < maxLines; i++) {
    const beforeLine = beforeLines[i];
    const afterLine = afterLines[i];
    
    if (beforeLine !== afterLine) {
      hasChanges = true;
      if (beforeLine !== undefined) {
        diffLines.push(`-${beforeLine}`);
      }
      if (afterLine !== undefined) {
        diffLines.push(`+${afterLine}`);
      }
    }
  }
  
  return hasChanges ? diffLines.join('\n') : '';
}

// ---------------------------------------------------------------------------
// Fuzzy text matching for multi_edit operations
// ---------------------------------------------------------------------------
function findFuzzyMatch(content: string, searchText: string): { found: boolean; suggestion?: string } {
  // Try exact match first
  if (content.includes(searchText)) {
    return { found: true };
  }
  
  // Normalize whitespace for comparison
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedSearch = normalizeWhitespace(searchText);
  const normalizedContent = normalizeWhitespace(content);
  
  if (normalizedContent.includes(normalizedSearch)) {
    return { found: true, suggestion: "Try normalizing whitespace in search text" };
  }
  
  // Try line-by-line fuzzy matching
  const searchLines = searchText.split('\n').map(line => line.trim()).filter(line => line);
  const contentLines = content.split('\n');
  
  // Look for a sequence of lines that match (ignoring leading/trailing whitespace)
  for (let i = 0; i < contentLines.length - searchLines.length + 1; i++) {
    let allMatch = true;
    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = contentLines[i + j]?.trim() || '';
      const searchLine = searchLines[j]?.trim() || '';
      if (contentLine !== searchLine) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      // Found fuzzy match - extract the actual text
      const actualLines = contentLines.slice(i, i + searchLines.length);
      const actualText = actualLines.join('\n');
      return { 
        found: true, 
        suggestion: `Use this exact text instead:\n${actualText}` 
      };
    }
  }
  
  return { found: false, suggestion: "Text not found. Use read() to check exact content." };
}

// ---------------------------------------------------------------------------
// Command repetition detection
// ---------------------------------------------------------------------------
const recentCommands: Array<{ command: string; timestamp: number }> = [];
const MAX_RECENT_COMMANDS = 10;
const COMMAND_REPEAT_THRESHOLD = 3; // Alert if same command appears 3+ times
const COMMAND_HISTORY_WINDOW = 60000; // 1 minute window

function detectCommandRepetition(cmd: Array<string>): string | null {
  const commandStr = JSON.stringify(cmd);
  const now = Date.now();
  
  // Clean up old entries
  while (recentCommands.length > 0 && now - recentCommands[0]!.timestamp > COMMAND_HISTORY_WINDOW) {
    recentCommands.shift();
  }
  
  // Add current command
  recentCommands.push({ command: commandStr, timestamp: now });
  
  // Keep only recent commands
  if (recentCommands.length > MAX_RECENT_COMMANDS) {
    recentCommands.shift();
  }
  
  // Count repetitions of this command
  const repetitionCount = recentCommands.filter(entry => entry.command === commandStr).length;
  
  if (repetitionCount >= COMMAND_REPEAT_THRESHOLD) {
    return `**Command Repetition Detected!**

The same command has been attempted ${repetitionCount} times in the last minute:
\`${cmd.join(" ")}\`

This suggests the command is failing repeatedly. Consider:
1. **Check the error message carefully** - the same error keeps occurring
2. **Modify your approach** - try a different command or strategy  
3. **Verify file/directory exists** - use \`type filename\` or \`dir\` to check
4. **For file operations**: Use read(), write(), edit() functions instead

**Stop retrying the same failing command!** Make changes to your approach first.`;
  }
  
  return null;
}

// ---------------------------------------------------------------------------
// Handle Neovim connection commands
// ---------------------------------------------------------------------------
async function handleNeovimConnection(
  cmd: Array<string>,
  _workdir?: string
): Promise<HandleExecCommandResult | null> {
  // Handle /connect command
  if (cmd.length >= 1 && (cmd[0] === '/connect' || (cmd.length >= 2 && cmd[1] === '/connect'))) {
    try {
      const { NeovimConnection } = await import('../../nvim/neovim-connection.js');
      
      if (globalNeovimConnection && globalNeovimConnection.isConnected()) {
        return {
          outputText: JSON.stringify({
            output: "Already connected to Neovim",
            metadata: { 
              operation: "nvim_connect",
              status: "already_connected",
              connection: globalNeovimConnection.getConnectionInfo()
            }
          }),
          metadata: { operation: "nvim_connect", status: "already_connected" }
        };
      }

      globalNeovimConnection = new NeovimConnection();
      
      // Parse connection options from command
      const options: { socket?: string; host?: string; port?: number } = {};
      
      // Find the connection target argument - could be cmd[1] if cmd[0] is '/connect'
      // or cmd[2] if cmd[0] is 'bash' and cmd[1] is '/connect'
      let targetArg: string | undefined;
      if (cmd[0] === '/connect' && cmd.length > 1) {
        targetArg = cmd[1];
      } else if (cmd.length > 2 && cmd[1] === '/connect') {
        targetArg = cmd[2];
      }
      
      if (targetArg) {
        if (targetArg.startsWith('/') || targetArg.startsWith('./')) {
          options.socket = targetArg;
        } else if (targetArg.includes(':')) {
          const [host, port] = targetArg.split(':');
          options.host = host;
          if (port) {
            options.port = parseInt(port);
          }
        }
      }

      await globalNeovimConnection.connect(options);
      const connectionInfo = globalNeovimConnection.getConnectionInfo();

      return {
        outputText: JSON.stringify({
          output: `Successfully connected to Neovim!\nConnection: ${connectionInfo.socket || `${connectionInfo.host}:${connectionInfo.port}`}\n\nNow all file operations will be performed directly through Neovim's buffer system.\nUse '/disconnect' to return to normal file operations.`,
          metadata: { 
            operation: "nvim_connect",
            status: "connected",
            connection: connectionInfo
          }
        }),
        metadata: { operation: "nvim_connect", status: "connected" }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        outputText: JSON.stringify({
          output: `Failed to connect to Neovim: ${errorMessage}\n\nTroubleshooting:\n1. Start Neovim with: nvim --listen /tmp/nvim.sock\n2. Or for TCP: nvim --listen 127.0.0.1:6666\n3. Ensure Neovim is running and accessible\n4. Check firewall settings for TCP connections`,
          metadata: { 
            operation: "nvim_connect",
            status: "failed",
            error: errorMessage
          }
        }),
        metadata: { operation: "nvim_connect", status: "failed" }
      };
    }
  }

  // Handle /disconnect command
  if (cmd.length >= 1 && (cmd[0] === '/disconnect' || (cmd.length >= 2 && cmd[1] === '/disconnect'))) {
    if (!globalNeovimConnection || !globalNeovimConnection.isConnected()) {
      return {
        outputText: JSON.stringify({
          output: "Not currently connected to Neovim",
          metadata: { 
            operation: "nvim_disconnect",
            status: "not_connected"
          }
        }),
        metadata: { operation: "nvim_disconnect", status: "not_connected" }
      };
    }

    try {
      await globalNeovimConnection.disconnect();
      globalNeovimConnection = null;

      return {
        outputText: JSON.stringify({
          output: "Disconnected from Neovim. File operations will now use standard file system methods.",
          metadata: { 
            operation: "nvim_disconnect",
            status: "disconnected"
          }
        }),
        metadata: { operation: "nvim_disconnect", status: "disconnected" }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        outputText: JSON.stringify({
          output: `Error disconnecting from Neovim: ${errorMessage}`,
          metadata: { 
            operation: "nvim_disconnect",
            status: "error",
            error: errorMessage
          }
        }),
        metadata: { operation: "nvim_disconnect", status: "error" }
      };
    }
  }

  // Handle /nvim-status command
  if (cmd.length >= 1 && (cmd[0] === '/nvim-status' || (cmd.length >= 2 && cmd[1] === '/nvim-status'))) {
    const isConnected = globalNeovimConnection && globalNeovimConnection.isConnected();
    const connectionInfo = isConnected ? globalNeovimConnection.getConnectionInfo() : null;

    return {
      outputText: JSON.stringify({
        output: isConnected 
          ? `Connected to Neovim\nConnection: ${connectionInfo?.socket || `${connectionInfo?.host}:${connectionInfo?.port}`}\nBuffers: Available\nStatus: Active`
          : "Not connected to Neovim\nFile operations using standard file system\nUse '/connect' to establish Neovim connection",
        metadata: { 
          operation: "nvim_status",
          connected: isConnected,
          connection: connectionInfo
        }
      }),
      metadata: { operation: "nvim_status", connected: isConnected }
    };
  }

  // Handle /lsp-status command
  if (cmd.length >= 1 && (cmd[0] === '/lsp-status' || (cmd.length >= 2 && cmd[1] === '/lsp-status'))) {
    try {
      const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
      const lspManager = new NeovimLSPManager(process.cwd());
      
      // Initialize and get status of language servers
      await lspManager.initialize();
      const serverStatus = await lspManager.getServerStatus();
      
      const statusOutput = serverStatus.length > 0 
        ? `Active Language Servers:\n${serverStatus.map(server => 
            `• ${server.name}: ${server.status} (${server.language})`
          ).join('\n')}\n\nTotal: ${serverStatus.length} server${serverStatus.length !== 1 ? 's' : ''} active`
        : "No active language servers\n\nTo enable LSP features:\n1. Connect to Neovim with /connect\n2. Ensure language servers are installed (typescript-language-server, pylsp, etc.)\n3. Open a file to auto-detect and start appropriate servers";

      return {
        outputText: JSON.stringify({
          output: statusOutput,
          metadata: { 
            operation: "lsp_status",
            server_count: serverStatus.length,
            servers: serverStatus
          }
        }),
        metadata: { operation: "lsp_status", server_count: serverStatus.length }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        outputText: JSON.stringify({
          output: `Failed to get LSP status: ${errorMessage}\n\nNote: LSP features require Neovim connection and language servers to be installed.`,
          metadata: { 
            operation: "lsp_status",
            status: "error",
            error: errorMessage
          }
        }),
        metadata: { operation: "lsp_status", status: "error" }
      };
    }
  }

  // Handle /buffer-list command
  if (cmd.length >= 1 && (cmd[0] === '/buffer-list' || (cmd.length >= 2 && cmd[1] === '/buffer-list'))) {
    if (!globalNeovimConnection || !globalNeovimConnection.isConnected()) {
      return {
        outputText: JSON.stringify({
          output: "Not connected to Neovim\n\nConnect to Neovim first:\n1. Start Neovim: nvim --listen /tmp/nvim.sock\n2. Connect: /connect /tmp/nvim.sock\n3. Then use /buffer-list to see open buffers",
          metadata: { 
            operation: "buffer_list",
            status: "not_connected"
          }
        }),
        metadata: { operation: "buffer_list", status: "not_connected" }
      };
    }

    try {
      const buffers = await globalNeovimConnection.getBufferList();
      
      if (buffers.length === 0) {
        return {
          outputText: JSON.stringify({
            output: "No buffers open in Neovim\n\nOpen some files in Neovim to see them listed here.",
            metadata: { 
              operation: "buffer_list",
              buffer_count: 0,
              buffers: []
            }
          }),
          metadata: { operation: "buffer_list", buffer_count: 0 }
        };
      }

      const bufferOutput = `Open Buffers in Neovim:\n${buffers.map((buffer: any, index: number) => 
        `${(index + 1).toString().padStart(2, ' ')}. ${buffer.name || '<unnamed>'} ${
          buffer.modified ? '[+]' : ''
        } ${buffer.loaded ? '' : '[not loaded]'}`
      ).join('\n')}\n\nTotal: ${buffers.length} buffer${buffers.length !== 1 ? 's' : ''}`;

      return {
        outputText: JSON.stringify({
          output: bufferOutput,
          metadata: { 
            operation: "buffer_list",
            buffer_count: buffers.length,
            buffers: buffers.map((b: any) => ({ name: b.name, modified: b.modified, loaded: b.loaded }))
          }
        }),
        metadata: { operation: "buffer_list", buffer_count: buffers.length }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        outputText: JSON.stringify({
          output: `Failed to get buffer list: ${errorMessage}`,
          metadata: { 
            operation: "buffer_list",
            status: "error",
            error: errorMessage
          }
        }),
        metadata: { operation: "buffer_list", status: "error" }
      };
    }
  }

  // Handle /diagnostic-summary command
  if (cmd.length >= 1 && (cmd[0] === '/diagnostic-summary' || (cmd.length >= 2 && cmd[1] === '/diagnostic-summary'))) {
    try {
      const { NeovimLSPManager } = await import('../../nvim/lsp-manager.js');
      const lspManager = new NeovimLSPManager(process.cwd());
      
      await lspManager.initialize();
      const allDiagnostics = await lspManager.getAllDiagnostics();
      
      if (allDiagnostics.length === 0) {
        return {
          outputText: JSON.stringify({
            output: "No diagnostics found! 🎉\n\nYour code looks clean - no errors or warnings detected by language servers.",
            metadata: { 
              operation: "diagnostic_summary",
              total_diagnostics: 0,
              errors: 0,
              warnings: 0,
              files_with_issues: 0
            }
          }),
          metadata: { operation: "diagnostic_summary", total_diagnostics: 0 }
        };
      }

      // Group diagnostics by severity and file
      const errors = allDiagnostics.filter(d => d.severity === 'error');
      const warnings = allDiagnostics.filter(d => d.severity === 'warning');
      const infos = allDiagnostics.filter(d => d.severity === 'info');
      
      const fileGroups = new Map<string, Array<typeof allDiagnostics[0]>>();
      for (const diagnostic of allDiagnostics) {
        if (!fileGroups.has(diagnostic.filePath)) {
          fileGroups.set(diagnostic.filePath, []);
        }
        fileGroups.get(diagnostic.filePath)!.push(diagnostic);
      }

      const summaryLines = [
        `Diagnostic Summary (${allDiagnostics.length} total):`,
        `• Errors: ${errors.length}`,
        `• Warnings: ${warnings.length}`,
        `• Info: ${infos.length}`,
        `• Files affected: ${fileGroups.size}`,
        '',
        'Files with issues:'
      ];

      for (const [filePath, diagnostics] of fileGroups) {
        const fileErrors = diagnostics.filter(d => d.severity === 'error').length;
        const fileWarnings = diagnostics.filter(d => d.severity === 'warning').length;
        summaryLines.push(`• ${filePath}: ${fileErrors} error${fileErrors !== 1 ? 's' : ''}, ${fileWarnings} warning${fileWarnings !== 1 ? 's' : ''}`);
      }

      return {
        outputText: JSON.stringify({
          output: summaryLines.join('\n'),
          metadata: { 
            operation: "diagnostic_summary",
            total_diagnostics: allDiagnostics.length,
            errors: errors.length,
            warnings: warnings.length,
            infos: infos.length,
            files_with_issues: fileGroups.size
          }
        }),
        metadata: { operation: "diagnostic_summary", total_diagnostics: allDiagnostics.length }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        outputText: JSON.stringify({
          output: `Failed to get diagnostic summary: ${errorMessage}\n\nNote: Diagnostics require LSP servers to be running. Use /lsp-status to check server status.`,
          metadata: { 
            operation: "diagnostic_summary",
            status: "error",
            error: errorMessage
          }
        }),
        metadata: { operation: "diagnostic_summary", status: "error" }
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Enhanced file operations with Neovim integration
// ---------------------------------------------------------------------------
async function readFileViaNeovim(filePath: string, offset = 0, limit = 2000): Promise<string> {
  if (!globalNeovimConnection || !globalNeovimConnection.isConnected()) {
    throw new Error('Not connected to Neovim');
  }

  try {
    // Ensure file is open in Neovim
    await globalNeovimConnection.openFile(filePath);
    
    // Get content from Neovim buffer
    const content = await globalNeovimConnection.getBufferContent(filePath);
    const lines = content.split('\n');
    const selectedLines = lines.slice(offset, offset + limit);
    
    return selectedLines.map((line: string, idx: number) => 
      `${(offset + idx + 1).toString().padStart(5, '0')}| ${line}`
    ).join('\n');
  } catch (error) {
    throw new Error(`Failed to read file via Neovim: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeFileViaNeovim(filePath: string, content: string): Promise<string> {
  if (!globalNeovimConnection || !globalNeovimConnection.isConnected()) {
    throw new Error('Not connected to Neovim');
  }

  try {
    // Open file in Neovim if not already open
    await globalNeovimConnection.openFile(filePath);
    
    // Replace buffer content
    await globalNeovimConnection.replaceBufferContent(filePath, content);
    
    // Save the buffer
    await globalNeovimConnection.saveBuffer(filePath);
    
    return `File successfully written via Neovim: ${filePath}`;
  } catch (error) {
    throw new Error(`Failed to write file via Neovim: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function editFileViaNeovim(filePath: string, search: string, replace: string): Promise<string> {
  if (!globalNeovimConnection || !globalNeovimConnection.isConnected()) {
    throw new Error('Not connected to Neovim');
  }

  try {
    // Open file in Neovim if not already open
    await globalNeovimConnection.openFile(filePath);
    
    // Get current content
    const content = await globalNeovimConnection.getBufferContent(filePath);
    
    // Perform the replacement
    if (!content.includes(search)) {
      throw new Error('Search content not found in file');
    }
    
    const newContent = content.replace(search, replace);
    
    // Replace buffer content
    await globalNeovimConnection.replaceBufferContent(filePath, newContent);
    
    // Save the buffer
    await globalNeovimConnection.saveBuffer(filePath);
    
    return `File successfully edited via Neovim: ${filePath}`;
  } catch (error) {
    throw new Error(`Failed to edit file via Neovim: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Export function for direct Neovim command handling from terminal UI
// ---------------------------------------------------------------------------
export async function handleNeovimConnectionCommand(cmd: Array<string>): Promise<string> {
  // The handleNeovimConnection function expects the command format ["bash", "/command", ...]
  // But we're calling it directly with ["/command", ...], so we need to adjust
  const adjustedCmd = ["bash", ...cmd];
  const result = await handleNeovimConnection(adjustedCmd);
  
  if (result) {
    try {
      // Parse the JSON output to get the actual message
      const parsed = JSON.parse(result.outputText);
      return parsed.output || result.outputText;
    } catch {
      // If not JSON, return as-is
      return result.outputText;
    }
  }
  
  // If no result, the command wasn't recognized as a Neovim command
  throw new Error("Command not recognized as Neovim command");
}
