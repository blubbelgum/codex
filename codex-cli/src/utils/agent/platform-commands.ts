/**
 * Utility functions for handling platform-specific commands
 */

import { log } from "../logger/log.js";

/**
 * Map of Unix commands to their Windows equivalents
 * Some commands need to be wrapped with cmd.exe /c since they're built-in commands
 */
const COMMAND_MAP: Record<string, { cmd: string; useShell?: boolean }> = {
  ls: { cmd: "dir", useShell: true },
  grep: { cmd: "findstr", useShell: true },
  cat: { cmd: "type", useShell: true },
  rm: { cmd: "del", useShell: true },
  cp: { cmd: "copy", useShell: true },
  mv: { cmd: "move", useShell: true },
  touch: { cmd: "echo.", useShell: true },
  mkdir: { cmd: "md", useShell: true },
  pwd: { cmd: "cd", useShell: true },
  // Don't adapt echo automatically since it has complex quoting issues
  // Let PowerShell handle it natively
};

/**
 * Map of common Unix command options to their Windows equivalents
 */
const OPTION_MAP: Record<string, Record<string, string>> = {
  ls: {
    "-l": "/p",
    "-a": "/a",
    "-R": "/s",
  },
  grep: {
    "-i": "/i",
    "-r": "/s",
  },
};

/**
 * Adapts a command for the current platform.
 * On Windows, this will translate Unix commands to their Windows equivalents.
 * On Unix-like systems, this will return the original command.
 *
 * @param command The command array to adapt
 * @returns The adapted command array
 */
export function adaptCommandForPlatform(command: Array<string>): Array<string> {
  // If not on Windows, return the original command
  if (process.platform !== "win32") {
    return command;
  }

  // Nothing to adapt if the command is empty
  if (command.length === 0) {
    return command;
  }

  const cmd = command[0]?.trim();

  // If cmd is undefined, empty, or just shell prompts, return original command
  if (!cmd || cmd === "$" || cmd === ">" || cmd === "#") {
    return command;
  }

  // If the command doesn't need adaptation, return it as is
  const commandMapping = COMMAND_MAP[cmd];
  if (!commandMapping) {
    return command;
  }

  log(`Adapting command '${cmd}' for Windows platform`);

  // Create a new command array with the adapted command
  let adaptedCommand = [...command];
  adaptedCommand[0] = commandMapping.cmd;

  // Adapt options if needed
  const optionsForCmd = OPTION_MAP[cmd];
  if (optionsForCmd) {
    for (let i = 1; i < adaptedCommand.length; i++) {
      const option = adaptedCommand[i];
      if (option && optionsForCmd[option]) {
        adaptedCommand[i] = optionsForCmd[option];
      }
    }
  }

  // If the command needs to be run in shell, wrap it with cmd.exe /c
  if (commandMapping.useShell) {
    adaptedCommand = ["cmd.exe", "/c", ...adaptedCommand];
  }

  log(`Adapted command: ${adaptedCommand.join(" ")}`);

  return adaptedCommand;
}
