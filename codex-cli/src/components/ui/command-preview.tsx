import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

// Command preview component for displaying command analysis
import { parseToolCall } from "../../utils/parsers.js";
import { Box, Text } from "ink";
import React from "react";

export interface CommandPreviewProps {
  command: ResponseFunctionToolCall;
  onApprove?: () => void;
  onDeny?: () => void;
  showActions?: boolean;
}

export default function CommandPreview({
  command,
  onApprove,
  onDeny,
  showActions = false,
}: CommandPreviewProps): React.ReactElement {
  const details = parseToolCall(command);
  const commandText = details?.cmdReadableText ?? command.name;
  const isShellCommand = command.name === "shell" || details?.cmd?.[0] !== undefined;

  const getCommandDescription = (): string => {
    if (isShellCommand && details?.cmd) {
      const cmd = details.cmd;
      const command = cmd[0];

      switch (command) {
        case "ls":
        case "dir":
          return "List directory contents";
        case "cat":
        case "type":
          return `Read file: ${cmd[1] || ""}`;
        case "cd":
          return `Change directory to: ${cmd[1] || ""}`;
        case "mkdir":
        case "md":
          return `Create directory: ${cmd[1] || ""}`;
        case "rm":
        case "del":
          return `Delete: ${cmd[1] || ""}`;
        case "cp":
        case "copy":
          return `Copy: ${cmd[1] || ""} → ${cmd[2] || ""}`;
        case "mv":
        case "move":
          return `Move: ${cmd[1] || ""} → ${cmd[2] || ""}`;
        case "node":
          return `Run Node.js: ${cmd[1] || ""}`;
        case "python":
        case "python3":
          return `Run Python: ${cmd[1] || ""}`;
        case "npm":
          return `NPM: ${cmd.slice(1).join(" ")}`;
        case "git":
          return `Git: ${cmd.slice(1).join(" ")}`;
        default:
          return `Execute: ${command}`;
      }
    }

    return "Execute command";
  };

  const getCommandIcon = (): string => {
    if (isShellCommand && details?.cmd) {
      const command = details.cmd[0];

      switch (command) {
        case "ls":
        case "dir":
          return "📂";
        case "cat":
        case "type":
          return "📄";
        case "cd":
          return "📁";
        case "mkdir":
        case "md":
          return "📁";
        case "rm":
        case "del":
          return "🗑️";
        case "cp":
        case "copy":
        case "mv":
        case "move":
          return "📋";
        case "node":
          return "🟢";
        case "python":
        case "python3":
          return "🐍";
        case "npm":
          return "📦";
        case "git":
          return "🔧";
        default:
          return "⚙️";
      }
    }

    return "⚙️";
  };

  const getRiskLevel = (): "low" | "medium" | "high" => {
    if (isShellCommand && details?.cmd) {
      const command = details.cmd[0];
      const hasDestructiveFlags = details.cmd.some(
        (arg) =>
          arg.includes("-rf") || arg.includes("--force") || arg.includes("-f"),
      );

      switch (command) {
        case "rm":
        case "del":
          return hasDestructiveFlags ? "high" : "medium";
        case "mv":
        case "move":
          return "medium";
        case "ls":
        case "dir":
        case "cat":
        case "type":
        case "cd":
          return "low";
        default:
          return "medium";
      }
    }

    return "medium";
  };

  const riskLevel = getRiskLevel();
  const riskColors = {
    low: "green",
    medium: "yellow",
    high: "red",
  } as const;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={riskColors[riskLevel]}
      padding={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text>{getCommandIcon()}</Text>
        <Text bold color={riskColors[riskLevel]}>
          {getCommandDescription()}
        </Text>
        <Text dimColor>({riskLevel} risk)</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Command:</Text>
        <Text> {commandText}</Text>
      </Box>

      {details?.cmd && Array.isArray(details.cmd) && details.cmd.length > 1 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Details:</Text>
          {details.cmd.slice(1).map((arg, index) => (
            <Text key={index} dimColor>
              •{" "}
              {typeof arg === "string" && arg.length > 100
                ? arg.slice(0, 100) + "..."
                : String(arg)}
            </Text>
          ))}
        </Box>
      )}

      {showActions && (onApprove || onDeny) && (
        <Box marginTop={1} gap={2}>
          {onApprove && (
            <Text color="green" bold>
              [y] Approve
            </Text>
          )}
          {onDeny && (
            <Text color="red" bold>
              [n] Deny
            </Text>
          )}
        </Box>
      )}

      {riskLevel === "high" && (
        <Box marginTop={1}>
          <Text color="red" bold>
            ⚠️ Warning: This command may make destructive changes!
          </Text>
        </Box>
      )}
    </Box>
  );
}
