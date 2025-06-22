import type { AppConfig } from "../config.js";
import type { ExecInput, ExecResult } from "./sandbox/interface.js";
import type { SpawnOptions } from "child_process";
import type { ParseEntry } from "shell-quote";

import { SandboxType } from "./sandbox/interface.js";
import { execWithLandlock } from "./sandbox/landlock.js";
import { execWithSeatbelt } from "./sandbox/macos-seatbelt.js";
import { rawExec } from "./sandbox/raw-exec.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { log } from "../logger/log.js";
import os from "os";
import { parse } from "shell-quote";

const DEFAULT_TIMEOUT_MS = 30000;

function requiresShell(cmd: Array<string>): boolean {
  // If the command is a single string that contains shell operators,
  // it needs to be run with shell: true
  if (cmd.length === 1 && cmd[0] !== undefined) {
    const tokens = parse(cmd[0]) as Array<ParseEntry>;
    return tokens.some((token) => typeof token === "object" && "op" in token);
  }

  // If the command is split into multiple arguments, we don't need shell: true
  // even if one of the arguments is a shell operator like '|'
  return false;
}

/**
 * Execute a command with the specified sandbox type.
 *
 * This function is coded defensively and should not throw. Any internal errors
 * should be mapped to a non-zero exit code and the error message should be in
 * stderr.
 */
export async function exec(
  execInput: ExecInput,
  sandboxType: SandboxType,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecResult> {
  const opts: SpawnOptions = {
    timeout: execInput.timeoutInMillis || DEFAULT_TIMEOUT_MS,
    ...(requiresShell(execInput.cmd) ? { shell: true } : {}),
    ...(execInput.workdir ? { cwd: execInput.workdir } : {}),
    ...(execInput.runInBackground ? { detached: true, stdio: 'ignore' } : {}),
  };

  // If running in background, start the process and return immediately
  if (execInput.runInBackground) {
    switch (sandboxType) {
      case SandboxType.NONE: {
        return rawExecBackground(execInput.cmd, opts, config);
      }
      case SandboxType.MACOS_SEATBELT:
      case SandboxType.LINUX_LANDLOCK: {
        // Background execution not supported with sandboxing
        return Promise.resolve({
          stdout: "Background execution is not supported with sandboxing enabled",
          stderr: "",
          exitCode: 1,
        });
      }
    }
  }

  switch (sandboxType) {
    case SandboxType.NONE: {
      // SandboxType.NONE uses the raw exec implementation.
      return rawExec(execInput.cmd, opts, config, abortSignal);
    }
    case SandboxType.MACOS_SEATBELT: {
      // SandboxType.MACOS_SEATBELT uses the macOS Seatbelt sandbox.
      const writableRoots = [
        process.cwd(),
        os.tmpdir(),
        ...(execInput.additionalWritableRoots || []),
      ] as const;
      return execWithSeatbelt(execInput.cmd, opts, writableRoots, config, abortSignal);
    }
    case SandboxType.LINUX_LANDLOCK: {
      return execWithLandlock(
        execInput.cmd,
        opts,
        execInput.additionalWritableRoots || [],
        config,
        abortSignal,
      );
    }
  }
}

async function rawExecBackground(
  cmd: Array<string>,
  opts: SpawnOptions,
  _config: AppConfig,
): Promise<ExecResult> {
  const { spawn } = await import("child_process");
  const adaptedCommand = await import("./platform-commands.js").then(m => m.adaptCommandForPlatform(cmd));
  
  const prog = adaptedCommand[0];
  if (typeof prog !== "string") {
    return {
      stdout: "",
      stderr: "command[0] is not a string",
      exitCode: 1,
    };
  }

  try {
    // Improved background process spawning
    const child = spawn(prog, adaptedCommand.slice(1), {
      ...opts,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'], // Explicitly ignore all stdio
      windowsHide: true, // Hide window on Windows
    });
    
    // Unref the child process to allow parent to exit without waiting
    child.unref();
    
    const pid = child.pid;
    
    // Handle process errors
    child.on('error', (error) => {
      log(`Background process ${pid} error: ${error}`);
    });
    
    // Optional: Log when process exits (for debugging)
    child.on('exit', (code) => {
      log(`Background process ${pid} exited with code: ${code}`);
    });
    
    return {
      stdout: `Started background process with PID: ${pid}\nCommand: ${cmd.join(" ")}`,
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: `Failed to start background process: ${error}`,
      exitCode: 1,
    };
  }
}

export function getBaseCmd(cmd: Array<string>): string {
  const formattedCommand = formatCommandForDisplay(cmd);
  return formattedCommand.split(" ")[0] || cmd[0] || "<unknown>";
}
