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
      `💡 Windows Command Recovery Suggestions:`,
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
        const content = readFile(filePath, workdir);
        const lines = content.split('\n');
        const selectedLines = lines.slice(offset, offset + limit);
        const numberedContent = selectedLines.map((line, idx) => 
          `${(offset + idx + 1).toString().padStart(5, '0')}| ${line}`
        ).join('\n');

        return {
          outputText: JSON.stringify({
            output: numberedContent,
            metadata: { 
              operation: "read",
              file: filePath,
              lines_read: selectedLines.length,
              total_lines: lines.length,
              offset,
              limit
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
        const result = writeToFile(filePath, content, workdir);
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { operation: "write", file: filePath }
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
        // Convert to the SEARCH/REPLACE format
        const diffContent = `------- SEARCH\n${search}\n=======\n${replace}\n+++++++ REPLACE`;
        const result = applySearchReplaceDiff(filePath, diffContent, workdir);
        return {
          outputText: JSON.stringify({
            output: result,
            metadata: { operation: "edit", file: filePath, replaceAll }
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
      return {
        outputText: JSON.stringify({
          output: "Error: multi_edit is no longer supported. Use individual edit() calls instead.\n\nFor multiple file changes:\n1. Use edit() for each file separately\n2. Each edit is atomic and safer\n3. Better error handling per file",
          metadata: { error: "multi_edit_deprecated" }
        }),
        metadata: { error: "multi_edit_deprecated" }
      };
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

    case "todo": {
      const { operation, id, content, priority, status } = args;
      
      // Enhanced todo system following OpenCode patterns
      const sessionId = "default"; // Use default session for now
      const todoFile = path.join(workdir || process.cwd(), '.codex-todos.json');
      
      // Todo schema following OpenCode patterns
      interface TodoItem {
        id: string;
        content: string;
        status: "pending" | "in_progress" | "completed";
        priority: "high" | "medium" | "low";
        created: string;
        updated?: string;
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

      switch (operation) {
        case "list": {
          const activeTodos = todos.filter(t => t.status !== "completed");
          const completedTodos = todos.filter(t => t.status === "completed");
          
          let output = "";
          if (activeTodos.length > 0) {
            output += "📋 Active Todos:\n";
            activeTodos.forEach((todo, i) => {
              const priorityIcon = todo.priority === "high" ? "🔴" : 
                                 todo.priority === "medium" ? "🟡" : "🟢";
              const statusIcon = todo.status === "in_progress" ? "🔄" : "⏸️";
              output += `  ${i + 1}. ${priorityIcon} ${statusIcon} ${todo.content} (${todo.id})\n`;
            });
          }
          
          if (completedTodos.length > 0) {
            output += `\n✅ Completed (${completedTodos.length}):\n`;
            completedTodos.slice(-3).forEach((todo, i) => {
              output += `  ${i + 1}. ✅ ${todo.content}\n`;
            });
          }
          
          if (todos.length === 0) {
            output = "📝 No todos yet. Use todo({operation: 'add', content: 'Your task'}) to create one.";
          }

          return {
            outputText: JSON.stringify({
              output,
              metadata: { 
                operation: "todo_list", 
                total: todos.length,
                active: activeTodos.length,
                completed: completedTodos.length,
                title: `${activeTodos.length} active todos`
              }
            }),
            metadata: { operation: "todo", action: "list", count: todos.length }
          };
        }

        case "add": {
          if (!content) {
            return {
              outputText: JSON.stringify({
                output: "Error: content is required for adding a todo",
                metadata: { error: "missing_parameter" }
              }),
              metadata: { error: "missing_parameter" }
            };
          }

          const newTodo: TodoItem = {
            id: Date.now().toString(),
            content: content.trim(),
            priority: (priority as TodoItem["priority"]) || "medium",
            status: "pending",
            created: new Date().toISOString()
          };
          
          todos.push(newTodo);
          todoStorage[sessionId] = todos;
          await fs.writeFile(todoFile, JSON.stringify(todoStorage, null, 2));
          
          const priorityIcon = newTodo.priority === "high" ? "🔴" : 
                             newTodo.priority === "medium" ? "🟡" : "🟢";
          
          return {
            outputText: JSON.stringify({
              output: `✅ Added todo: ${priorityIcon} ${newTodo.content}\n   ID: ${newTodo.id}`,
              metadata: { 
                operation: "todo_add", 
                id: newTodo.id,
                title: "Todo added"
              }
            }),
            metadata: { operation: "todo", action: "add", id: newTodo.id }
          };
        }

        case "update":
        case "complete":
        case "remove": {
          if (!id) {
            return {
              outputText: JSON.stringify({
                output: `Error: id is required for ${operation} operation`,
                metadata: { error: "missing_parameter" }
              }),
              metadata: { error: "missing_parameter" }
            };
          }

          const todoIndex = todos.findIndex(t => t.id === id);
          if (todoIndex === -1) {
            return {
              outputText: JSON.stringify({
                output: `❌ Todo with id ${id} not found. Use todo({operation: 'list'}) to see available todos.`,
                metadata: { error: "todo_not_found" }
              }),
              metadata: { error: "todo_not_found" }
            };
          }

          const todo = todos[todoIndex];
          if (!todo) {
            return {
              outputText: JSON.stringify({
                output: `❌ Todo with id ${id} not found.`,
                metadata: { error: "todo_not_found" }
              }),
              metadata: { error: "todo_not_found" }
            };
          }
          
          let resultMessage = "";

          if (operation === "remove") {
            todos.splice(todoIndex, 1);
            resultMessage = `🗑️ Removed todo: "${todo.content}"`;
          } else if (operation === "complete") {
            todo.status = "completed";
            todo.updated = new Date().toISOString();
            resultMessage = `✅ Completed todo: "${todo.content}"`;
          } else { // update
            if (content !== undefined) {
              todo.content = content.trim();
            }
            if (priority !== undefined) {
              todo.priority = priority as TodoItem["priority"];
            }
            if (status !== undefined) {
              todo.status = status as TodoItem["status"];
            }
            todo.updated = new Date().toISOString();
            
            const priorityIcon = todo.priority === "high" ? "🔴" : 
                               todo.priority === "medium" ? "🟡" : "🟢";
            const statusIcon = todo.status === "in_progress" ? "🔄" : 
                             todo.status === "completed" ? "✅" : "⏸️";
            
            resultMessage = `📝 Updated todo: ${priorityIcon} ${statusIcon} ${todo.content}`;
          }

          todoStorage[sessionId] = todos;
          await fs.writeFile(todoFile, JSON.stringify(todoStorage, null, 2));
          
          return {
            outputText: JSON.stringify({
              output: resultMessage,
              metadata: { 
                operation: `todo_${operation}`, 
                id,
                title: `Todo ${operation}d`
              }
            }),
            metadata: { operation: "todo", action: operation, id }
          };
        }

        default:
          return {
            outputText: JSON.stringify({
              output: `❌ Unknown todo operation: ${operation}\n\nAvailable operations:\n- list: Show all todos\n- add: Create new todo\n- update: Modify existing todo\n- complete: Mark todo as done\n- remove: Delete todo`,
              metadata: { error: "invalid_operation" }
            }),
            metadata: { error: "invalid_operation" }
          };
      }
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
  const { review: decision, customDenyMessage } = await getCommandConfirmation(
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
    return `🔄 **Command Repetition Detected!**

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
