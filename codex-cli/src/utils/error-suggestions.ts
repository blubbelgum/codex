import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { parseToolCall } from "./parsers.js";

export interface ErrorSuggestion {
  type: "warning" | "error" | "tip";
  title: string;
  description: string;
  fix?: string;
  learnMoreUrl?: string;
}

export interface CommandAnalysis {
  command: Array<string>;
  suggestions: Array<ErrorSuggestion>;
  riskLevel: "low" | "medium" | "high";
  isWindowsSpecific?: boolean;
  estimatedDuration?: string;
}

export class ErrorSuggestionEngine {
  private static readonly DANGEROUS_COMMANDS = new Set([
    "rm",
    "del",
    "rmdir",
    "rd",
    "format",
    "fdisk",
    "mkfs",
    "dd",
    "sudo",
    "runas",
    "powershell",
    "cmd",
    "regedit",
    "reg",
  ]);

  private static readonly DESTRUCTIVE_FLAGS = new Set([
    "-rf",
    "-r",
    "-f",
    "--force",
    "--recursive",
    "/f",
    "/s",
  ]);

  private static readonly COMMON_WINDOWS_ISSUES = [
    {
      pattern: /^ls/,
      suggestion: {
        type: "tip" as const,
        title: "Windows Command Translation",
        description:
          "Use 'dir' instead of 'ls' on Windows, or let the system auto-translate",
        fix: "The command will be automatically translated to 'dir'",
      },
    },
    {
      pattern: /^cat\s/,
      suggestion: {
        type: "tip" as const,
        title: "Windows Command Translation",
        description:
          "Use 'type' instead of 'cat' on Windows, or let the system auto-translate",
        fix: "The command will be automatically translated to 'type'",
      },
    },
    {
      pattern: /^grep\s/,
      suggestion: {
        type: "tip" as const,
        title: "Windows Command Translation",
        description:
          "Use 'findstr' instead of 'grep' on Windows, or let the system auto-translate",
        fix: "The command will be automatically translated to 'findstr'",
      },
    },
  ];

  public static analyzeCommand(
    functionCall: ResponseFunctionToolCall,
  ): CommandAnalysis {
    const details = parseToolCall(functionCall);
    const command = details?.cmd || [];
    const commandText = details?.cmdReadableText || functionCall.name;

    const suggestions: Array<ErrorSuggestion> = [];
    let riskLevel: "low" | "medium" | "high" = "low";
    let isWindowsSpecific = false;

    // Analyze for dangerous commands
    if (command.length > 0) {
      const mainCommand = command[0]?.toLowerCase() || "";
      const hasDestructiveFlags = command.some((arg) =>
        this.DESTRUCTIVE_FLAGS.has(arg?.toLowerCase() || ""),
      );

      if (this.DANGEROUS_COMMANDS.has(mainCommand)) {
        riskLevel = hasDestructiveFlags ? "high" : "medium";
        suggestions.push({
          type: "warning",
          title: "Potentially Dangerous Command",
          description: `The command '${mainCommand}' can make irreversible changes to your system`,
          fix: hasDestructiveFlags
            ? "Remove destructive flags like -rf or --force if possible"
            : "Proceed with caution and verify the command is correct",
        });
      }

      // Check for Windows-specific issues
      if (process.platform === "win32") {
        isWindowsSpecific = true;
        for (const issue of this.COMMON_WINDOWS_ISSUES) {
          if (issue.pattern.test(commandText)) {
            suggestions.push(issue.suggestion);
          }
        }
      }
    }

    return {
      command,
      suggestions,
      riskLevel,
      isWindowsSpecific,
      estimatedDuration: this.estimateCommandDuration(command),
    };
  }

  private static estimateCommandDuration(command: Array<string>): string {
    if (command.length === 0) {
      return "< 1s";
    }

    const mainCommand = command[0]?.toLowerCase() || "";

    // Fast commands
    if (
      ["ls", "dir", "pwd", "cd", "echo", "type", "cat"].includes(mainCommand)
    ) {
      return "< 1s";
    }

    // Medium speed commands
    if (
      ["cp", "copy", "mv", "move", "mkdir", "md", "rm", "del"].includes(
        mainCommand,
      )
    ) {
      return "1-5s";
    }

    // Potentially slow commands
    if (["npm", "yarn", "pip", "git", "node", "python"].includes(mainCommand)) {
      if (command.includes("install") || command.includes("update")) {
        return "30s-5m";
      }
      return "5-30s";
    }

    return "Unknown";
  }

  public static formatSuggestionsForDisplay(analysis: CommandAnalysis): string {
    if (analysis.suggestions.length === 0) {
      return "✅ No issues detected";
    }

    const lines: Array<string> = [];
    const grouped = analysis.suggestions.reduce(
      (acc, suggestion) => {
        if (!acc[suggestion.type]) {
          acc[suggestion.type] = [];
        }
        acc[suggestion.type]!.push(suggestion);
        return acc;
      },
      {} as Record<string, Array<ErrorSuggestion>>,
    );

    if (grouped["error"]) {
      lines.push("❌ Errors:");
      grouped["error"].forEach((s) =>
        lines.push(`  • ${s.title}: ${s.description}`),
      );
    }

    if (grouped["warning"]) {
      lines.push("⚠️  Warnings:");
      grouped["warning"].forEach((s) =>
        lines.push(`  • ${s.title}: ${s.description}`),
      );
    }

    if (grouped["tip"]) {
      lines.push("💡 Tips:");
      grouped["tip"].forEach((s) =>
        lines.push(`  • ${s.title}: ${s.description}`),
      );
    }

    return lines.join("\n");
  }
}
