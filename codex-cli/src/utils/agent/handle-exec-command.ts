import type { CommandConfirmation } from "./agent-loop.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { ExecInput } from "./sandbox/interface.js";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { canAutoApprove } from "../../approvals.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { FullAutoErrorMode } from "../auto-approval-mode.js";
import { CODEX_UNSAFE_ALLOW_NO_SANDBOX, type AppConfig } from "../config.js";
import { exec, execApplyPatch } from "./exec.js";
import { ReviewDecision } from "./review.js";
import { isLoggingEnabled, log } from "../logger/log.js";
import { SandboxType } from "./sandbox/interface.js";
import { PATH_TO_SEATBELT_EXECUTABLE } from "./sandbox/macos-seatbelt.js";
import { parseToolCallArguments } from "../parsers.js";
import { adaptCommandForPlatform } from "./platform-commands.js";
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
  const { additionalWritableRoots = [] } = execInput as any;
  
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
  const { cmd: command, workdir } = args;

  const key = deriveCommandKey(command);

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
    ).then((summary) => convertSummaryToResult(summary, command));
  }

  // 2) Otherwise fall back to the normal policy
  // `canAutoApprove` now requires the list of writable roots that the command
  // is allowed to modify.  For the CLI we conservatively pass the current
  // working directory so that edits are constrained to the project root.  If
  // the caller wishes to broaden or restrict the set it can be made
  // configurable in the future.
  const safety = canAutoApprove(command, workdir, policy, [process.cwd()]);

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
      return convertSummaryToResult(summary, command);
    }
  } else {
    return convertSummaryToResult(summary, command);
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
  applyPatchCommand: ApplyPatchCommand | undefined,
  runInSandbox: boolean,
  additionalWritableRoots: ReadonlyArray<string>,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecCommandSummary> {
  let { workdir } = execInput;
  if (workdir) {
    try {
      await fs.access(workdir);
    } catch (e) {
      log(`EXEC workdir=${workdir} not found, use process.cwd() instead`);
      workdir = process.cwd();
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

  // Note execApplyPatch() and exec() are coded defensively and should not
  // throw. Any internal errors should be mapped to a non-zero value for the
  // exitCode field.
  const start = Date.now();
  const execResult =
    applyPatchCommand != null
      ? execApplyPatch(applyPatchCommand.patch, workdir)
      : await exec(
          { ...execInput, additionalWritableRoots },
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
  enableStdoutTruncation: boolean = true,
  enableFullStdout: boolean = false,
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
  let { cmd, workdir, timeoutInMillis } = command;
  
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
  const execInput = {
    cmd,
    workdir,
    timeoutInMillis,
    additionalWritableRoots: [] as string[],
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
  const issues: string[] = [];
  
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
// Simple command repetition detection to prevent infinite loops
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
