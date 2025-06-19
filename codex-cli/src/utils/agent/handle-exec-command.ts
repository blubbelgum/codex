import type { CommandConfirmation } from "./agent-loop.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { ExecInput } from "./sandbox/interface.js";
import type { ResponseInputItem , ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { canAutoApprove } from "../../approvals.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { FullAutoErrorMode } from "../auto-approval-mode.js";
import { CODEX_UNSAFE_ALLOW_NO_SANDBOX, type AppConfig } from "../config.js";
import { exec } from "./exec.js";
import { applySearchReplaceDiff, writeToFile, readFile } from "./handle-unified-diff.js";
import { adaptCommandForPlatform } from "./platform-commands.js";
import { ReviewDecision } from "./review.js";
import { isLoggingEnabled, log } from "../logger/log.js";
import { parseToolCallArguments } from "../parsers.js";
import { SandboxType } from "./sandbox/interface.js";
import { PATH_TO_SEATBELT_EXECUTABLE } from "./sandbox/macos-seatbelt.js";
import fs from "fs/promises";
import os from "os";

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

  if (coreInvocation?.startsWith("apply_patch")) {
    return "apply_patch";
  }

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
    undefined, // applyPatchCommand
    false, // runInSandbox
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
        undefined,
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
        undefined,
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
        undefined,
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
      `${hasAdaptation ? "3" : "2"}. For file operations: Consider using apply_patch for more reliable file handling`,
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



export async function handleExecCommand(
  args: ExecInput,
  config: AppConfig,
  policy: ApprovalPolicy,
  additionalWritableRoots: ReadonlyArray<string>,
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>,
  abortSignal?: AbortSignal,
): Promise<HandleExecCommandResult> {
  const { cmd, workdir } = args;

  // Handle new unified diff commands
  if (cmd[0] === "bash" && (cmd[1] === "-c" || cmd[1] === "-lc") && cmd[2]) {
    const bashScript = cmd[2];
    
    // Check for write_to_file command
    if (bashScript.includes("write_to_file")) {
      try {
        const match = bashScript.match(/write_to_file\s+(\S+)\s+<<'EOF'\n(.*)\nEOF/s);
        if (match && match[1] && match[2] !== undefined) {
          const filePath = match[1];
          const content = match[2];
          const result = writeToFile(filePath, content, workdir);
          return {
            outputText: JSON.stringify({
              output: result,
              metadata: { operation: "write_to_file", file: filePath }
            }),
            metadata: { operation: "write_to_file", file: filePath }
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "write_to_file_failed" }
          }),
          metadata: { error: "write_to_file_failed" }
        };
      }
    }
    
    // Check for read_file command
    if (bashScript.includes("read_file")) {
      try {
        const match = bashScript.match(/read_file\s+(\S+)/);
        if (match && match[1]) {
          const filePath = match[1];
          const result = readFile(filePath, workdir);
          return {
            outputText: JSON.stringify({
              output: result,
              metadata: { operation: "read_file", file: filePath, size: result.length }
            }),
            metadata: { operation: "read_file", file: filePath, size: result.length }
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "read_file_failed" }
          }),
          metadata: { error: "read_file_failed" }
        };
      }
    }
    
    // Check for replace_in_file command
    if (bashScript.includes("replace_in_file")) {
      try {
        // Improved regex patterns to handle different quote styles and formatting
        const patterns = [
          /replace_in_file\s+(\S+)\s+<<'EOF'\s*\n([\s\S]*?)\nEOF\s*$/,
          /replace_in_file\s+(\S+)\s+<<"EOF"\s*\n([\s\S]*?)\nEOF\s*$/,
          /replace_in_file\s+(\S+)\s+<<EOF\s*\n([\s\S]*?)\nEOF\s*$/,
          /replace_in_file\s+(\S+)\s+<<'EOF'\s*([\s\S]*?)EOF\s*$/,
          /replace_in_file\s+([^\s]+)\s+<<'EOF'\s*([\s\S]*?)EOF\s*$/,
        ];
        
        let match = null;
        let diffContent = "";
        let filePath = "";
        
        for (let i = 0; i < patterns.length; i++) {
          const pattern = patterns[i];
          if (!pattern) {
            continue;
          }
          
          match = bashScript.match(pattern);
          if (match && match[1] && match[2] !== undefined) {
            filePath = match[1];
            diffContent = match[2];
            
            // More careful cleaning - only remove leading/trailing empty lines, not all whitespace
            diffContent = diffContent.replace(/^\n+/, '').replace(/\n+$/, '');
            
            log(`replace_in_file: Matched pattern ${i}, file: ${filePath}, content length: ${diffContent.length}`);
            break;
          }
        }
        
        if (match && filePath && diffContent) {
          log(`replace_in_file: About to apply diff to ${filePath}`);
          log(`replace_in_file: Diff content preview: ${diffContent.slice(0, 200)}...`);
          
          const result = applySearchReplaceDiff(filePath, diffContent, workdir);
          return {
            outputText: JSON.stringify({
              output: result,
              metadata: { operation: "replace_in_file", file: filePath }
            }),
            metadata: { operation: "replace_in_file", file: filePath }
          };
        } else {
          // Enhanced error message with debugging info
          log(`replace_in_file: Failed to parse command`);
          log(`replace_in_file: Bash script: ${bashScript}`);
          
          return {
            outputText: JSON.stringify({
              output: `Error: Could not parse replace_in_file command. 

Debug info:
- Script length: ${bashScript.length}
- Contains 'replace_in_file': ${bashScript.includes("replace_in_file")}
- Contains 'EOF': ${bashScript.includes("EOF")}

Script preview:
${bashScript.slice(0, 500)}${bashScript.length > 500 ? '...' : ''}

Expected format:
replace_in_file filename <<'EOF'
------- SEARCH
old content
=======
new content
+++++++ REPLACE
EOF`,
              metadata: { error: "replace_in_file_parse_failed" }
            }),
            metadata: { error: "replace_in_file_parse_failed" }
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`replace_in_file: Exception during processing: ${errorMessage}`);
        return {
          outputText: JSON.stringify({
            output: `Error: ${errorMessage}`,
            metadata: { error: "replace_in_file_failed" }
          }),
          metadata: { error: "replace_in_file_failed" }
        };
      }
    }
  }

  // Handle deprecated apply_patch command with clear error message
  if (cmd[0] === "apply_patch") {
    const errorMessage = `Error: The 'apply_patch' command is no longer supported.

Please use the new SEARCH/REPLACE format instead:

For file modifications:
replace_in_file path/to/file.ext <<'EOF'
------- SEARCH
exact_content_to_find
=======
new_content_to_replace_with
+++++++ REPLACE
EOF

For creating new files:
write_to_file path/to/new_file.ext <<'EOF'
complete_file_content
EOF

For reading files:
read_file path/to/file.ext

This new format is more reliable and provides better error handling.`;

    return {
      outputText: errorMessage,
      metadata: { error: "command_deprecated" },
    };
  }

  const key = deriveCommandKey(cmd);

  // 1) If the user has already said "always approve", skip
  //    any policy & never sandbox.
  if (alwaysApprovedCommands.has(key)) {
    return execCommand(
      args,
      /* applyPatch */ undefined,
      /* runInSandbox */ false,
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
        safety.applyPatch,
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

  const { applyPatch } = safety;
  const summary = await execCommand(
    args,
    applyPatch,
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
      safety.applyPatch,
      getCommandConfirmation,
    );
    if (review != null) {
      return review;
    } else {
      // The user has approved the command, so we will run it outside of the
      // sandbox.
      const summary = await execCommand(
        args,
        applyPatch,
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

  // Special handling for patch command permission errors
  if (exitCode !== 0 && command && command[0] === "patch" && 
      (stderr.includes("Permission denied") || stderr.includes("Can't create temporary file"))) {
    outputText = `Error: ${stderr}\n\n` +
      `The patch command failed due to permission issues in the sandboxed environment.\n\n` +
      `RECOMMENDED SOLUTION:\n` +
      `Use the new SEARCH/REPLACE format instead:\n\n` +
      `replace_in_file filename <<'EOF'\n` +
      `------- SEARCH\n` +
      `exact_content_to_find\n` +
      `=======\n` +
      `new_content_to_replace_with\n` +
      `+++++++ REPLACE\n` +
      `EOF\n\n` +
      `ALTERNATIVE APPROACHES:\n` +
      `1. Use write_to_file to overwrite the entire file:\n` +
      `   write_to_file ${command.length > 1 ? command[1] || '[filename]' : '[filename]'} <<'EOF'\n` +
      `   [new file content]\n` +
      `   EOF\n\n` +
      `2. Use sed for simple replacements:\n` +
      `   sed -i 's/old_text/new_text/g' ${command.length > 1 ? command[1] || '[filename]' : '[filename]'}\n`;
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
  applyPatchCommand: ApplyPatchCommand | undefined,
  runInSandbox: boolean,
  additionalWritableRoots: ReadonlyArray<string>,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecCommandSummary> {
  const { cmd } = execInput;
  let { workdir } = execInput;
  let resolvedWorkdir = workdir || process.cwd();

  // Handle deprecated apply_patch command with clear error message
  if (cmd[0] === "apply_patch") {
    const errorMessage = `Error: The 'apply_patch' command is no longer supported.

Please use the new SEARCH/REPLACE format instead:

For file modifications:
replace_in_file path/to/file.ext <<'EOF'
------- SEARCH
exact_content_to_find
=======
new_content_to_replace_with
+++++++ REPLACE
EOF

For creating new files:
write_to_file path/to/new_file.ext <<'EOF'
complete_file_content
EOF

For reading files:
read_file path/to/file.ext

This new format is more reliable and provides better error handling.`;

    return {
      stdout: "",
      stderr: errorMessage,
      exitCode: 1,
      durationMs: 0
    };
  }

  if (workdir) {
    try {
      await fs.access(workdir);
    } catch (e) {
      log(`EXEC workdir=${workdir} not found, use process.cwd() instead`);
      resolvedWorkdir = process.cwd();
      workdir = resolvedWorkdir;
    }
  }

  if (applyPatchCommand != null) {
    log("EXEC running apply_patch command");
  } else if (isLoggingEnabled()) {
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
  applyPatchCommand: ApplyPatchCommand | undefined,
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>,
): Promise<HandleExecCommandResult | null> {
  const { review: decision, customDenyMessage } = await getCommandConfirmation(
    args.cmd,
    applyPatchCommand,
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

  // Enhanced command validation and apply_patch format fixing
  const { cmd: originalCmd, workdir, timeoutInMillis } = command;
  let cmd = originalCmd;
  
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
  
  // Apply patch format validation and fixing
  cmd = validateAndFixApplyPatchFormat(cmd);
  
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
    
    // Special handling for apply_patch context failures
    if (cmd[0] === "apply_patch" && summary.exitCode !== 0 && summary.stderr) {
      const patchContent = cmd[1] || "";
      const enhancedError = generateApplyPatchContextError(summary.stderr, patchContent);
      
      return {
        outputText: JSON.stringify({
          output: enhancedError,
          metadata: { exit_code: summary.exitCode, duration_seconds: summary.durationMs / 1000 },
        }),
        metadata: { exit_code: summary.exitCode, duration_seconds: summary.durationMs / 1000 },
      };
    }
    
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
// Enhanced apply_patch format validation and fixing
// ---------------------------------------------------------------------------
function validateAndFixApplyPatchFormat(cmd: Array<string>): Array<string> {
  if (cmd[0] !== "apply_patch" || cmd.length < 2) {
    return cmd;
  }

  const patchContent = cmd[1];
  if (typeof patchContent !== "string") {
    return cmd;
  }

  // Check if patch content is properly formatted
  const issues: Array<string> = [];
  
  // Must start with "*** Begin Patch"
  if (!patchContent.startsWith("*** Begin Patch")) {
    issues.push("Missing '*** Begin Patch' header");
  }

  // Must end with "*** End Patch"  
  if (!patchContent.endsWith("*** End Patch")) {
    issues.push("Missing '*** End Patch' footer");
  }

  // Must have either "*** Add File:" or "*** Update File:"
  if (!patchContent.includes("*** Add File:") && !patchContent.includes("*** Update File:")) {
    issues.push("Missing file operation specification");
  }

  // If there are issues, try to auto-fix them
  if (issues.length > 0) {
    log(`apply_patch format issues detected: ${issues.join(", ")}`);
    
    let fixedContent = patchContent;
    
    // Auto-fix missing begin/end markers
    if (!fixedContent.startsWith("*** Begin Patch")) {
      fixedContent = "*** Begin Patch\n" + fixedContent;
    }
    if (!fixedContent.endsWith("*** End Patch")) {
      if (!fixedContent.endsWith("\n")) {
        fixedContent += "\n";
      }
      fixedContent += "*** End Patch";
    }
    
    log(`apply_patch auto-fixed format issues`);
    return ["apply_patch", fixedContent];
  }

  return cmd;
}

// ---------------------------------------------------------------------------
// Enhanced error message generation for apply_patch context failures
// ---------------------------------------------------------------------------
function generateApplyPatchContextError(
  error: string,
  patchContent: string,
): string {
  if (!error.includes("Invalid Context") && !error.includes("Failed to find context")) {
    return error;
  }

  // Extract file path from patch if possible
  let filePath = "unknown";
  const updateFileMatch = patchContent.match(/\*\*\* Update File:\s*(.+)/);
  if (updateFileMatch?.[1]) {
    filePath = updateFileMatch[1].trim();
  }

  // Extract the problematic context lines for better debugging
  let problematicContext = "";
  const contextMatch = error.match(/Invalid Context \d+:\s*([\s\S]*?)(?:\n|$)/);
  if (contextMatch?.[1]) {
    problematicContext = contextMatch[1].substring(0, 200); // Limit to first 200 chars
  }

  const errorHints = [
    `${error}`,
    ``,
    `🔧 APPLY_PATCH CONTEXT MISMATCH DETECTED`,
    ``,
    `The patch is trying to modify lines that don't exist in ${filePath}.`,
    ``,
    `📋 **IMMEDIATE ACTIONS TO FIX THIS:**`,
    ``,
    `1. **Check Current File Content:**`,
    `   Command: \`type ${filePath}\` or \`cat ${filePath}\``,
    `   ↳ Look at the actual file content to see what changed`,
    ``,
    `2. **Don't Repeat the Same Patch:**`,
    `   ↳ The same context lines will fail again!`,
    `   ↳ Find different context lines that actually exist in the file`,
    ``,
    `3. **Use Direct File Editing Instead:**`,
    `   ↳ Sometimes it's easier to rewrite the whole function/section`,
    `   ↳ Instead of patching, consider creating a new version`,
    ``,
    `4. **Find Better Context Lines:**`,
    `   ↳ Look for unique lines in the file that won't change`,
    `   ↳ Use lines with distinctive text, not generic code`,
    ``,
    `💡 **DEBUGGING TIP:** The file may already have been modified by previous`,
    `patches or the context you're looking for doesn't exist.`,
    ``,
    `⚠️  **STOP REPEATING:** If you've tried this patch 2+ times, the`,
    `context is definitely wrong. Check the file content first!`,
    ``,
    problematicContext ? `📄 **Failed Context Preview:**\n${problematicContext}...` : "",
  ].filter(line => line !== "");

  return errorHints.join("\n");
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
4. **For apply_patch**: Review the current file content and adjust context lines

**Stop retrying the same failing command!** Make changes to your approach first.`;
  }
  
  return null;
}
