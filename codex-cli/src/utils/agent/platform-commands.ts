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
  type: { cmd: "type", useShell: true },
  dir: { cmd: "dir", useShell: true },
  more: { cmd: "more", useShell: true },
  del: { cmd: "del", useShell: true },
  copy: { cmd: "copy", useShell: true },
  move: { cmd: "move", useShell: true },
  md: { cmd: "md", useShell: true },
  rd: { cmd: "rd", useShell: true },
  ren: { cmd: "ren", useShell: true },
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
    log("adaptCommandForPlatform: Empty command array, returning as-is");
    return command;
  }

  const cmd = command[0]?.trim();

  // If cmd is undefined, empty, or just shell prompts, return original command
  if (!cmd || cmd === "$" || cmd === ">" || cmd === "#") {
    log(`adaptCommandForPlatform: Invalid command '${cmd}', returning original`);
    return command;
  }

  // If the command doesn't need adaptation, return it as is
  const commandMapping = COMMAND_MAP[cmd];
  if (!commandMapping) {
    log(`adaptCommandForPlatform: No mapping found for '${cmd}', returning original command`);
    return command;
  }

  log(`adaptCommandForPlatform: Found mapping for '${cmd}' -> '${commandMapping.cmd}', useShell: ${commandMapping.useShell}`);

  // Create a new command array with the adapted command
  let adaptedCommand = [...command];
  adaptedCommand[0] = commandMapping.cmd;

  // Adapt options if needed
  const optionsForCmd = OPTION_MAP[cmd];
  if (optionsForCmd) {
    for (let i = 1; i < adaptedCommand.length; i++) {
      const option = adaptedCommand[i];
      if (option && optionsForCmd[option]) {
        log(`adaptCommandForPlatform: Adapting option '${option}' -> '${optionsForCmd[option]}'`);
        adaptedCommand[i] = optionsForCmd[option];
      }
    }
  }

  // If the command needs to be run in shell, wrap it with cmd.exe /c
  if (commandMapping.useShell) {
    adaptedCommand = ["cmd.exe", "/c", ...adaptedCommand];
    log(`adaptCommandForPlatform: Wrapped with cmd.exe /c: ${adaptedCommand.join(" ")}`);
  }

  log(`adaptCommandForPlatform: Final adapted command: ${adaptedCommand.join(" ")}`);

  return adaptedCommand;
}
