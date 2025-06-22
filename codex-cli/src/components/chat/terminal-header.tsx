import type { AgentLoop } from "../../utils/agent/agent-loop.js";

import { Box, Text } from "ink";
import os from "node:os";
import path from "node:path";
import React from "react";

// Helper function to get user-friendly OS name
function getOSDisplayName(): string {
  const platform = os.platform();
  switch (platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    case "freebsd":
      return "FreeBSD";
    case "openbsd":
      return "OpenBSD";
    default:
      return platform;
  }
}

export interface TerminalHeaderProps {
  terminalRows: number;
  version: string;
  PWD: string;
  model: string;
  provider?: string;
  approvalPolicy: string;
  colorsByPolicy: Record<string, string | undefined>;
  agent?: AgentLoop;
  initialImagePaths?: Array<string>;
  flexModeEnabled?: boolean;
  showTabInfo?: boolean;
  backgroundProcesses?: Array<{ pid: string; command: string }>;
}

const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  terminalRows,
  version,
  PWD,
  model,
  provider = "openai",
  approvalPolicy,
  colorsByPolicy,
  agent,
  initialImagePaths,
  flexModeEnabled = false,
  showTabInfo = false,
  backgroundProcesses = [],
}) => {
  return (
    <Box justifyContent="center" width="100%">
      {terminalRows < 10 ? (
        // Compact header for small terminal windows - centered
        <Box justifyContent="center">
          <Text>
            ● Codex CLI v{version} - {getOSDisplayName()} - {PWD} - {model} (
            {provider}) -{" "}
            <Text color={colorsByPolicy[approvalPolicy]}>{approvalPolicy}</Text>
            {flexModeEnabled ? " - flex-mode" : ""}
            {showTabInfo ? " | [1] Chat [2] Files [3] Tasks" : ""}
          </Text>
        </Box>
      ) : (
        // Full header with centered bordered boxes
        <Box flexDirection="column" alignItems="center">
          <Box borderStyle="round" paddingX={1} width={64}>
            <Text>
              ● <Text bold>Codex CLI</Text>{" "}
              <Text dimColor>
                (powered by {provider}){" "}
                <Text color="blueBright">v{version}</Text>
              </Text>
            </Text>
          </Box>
          <Box
            borderStyle="round"
            borderColor="gray"
            paddingX={1}
            width={64}
            flexDirection="column"
          >
            <Text>
              localhost <Text dimColor>session:</Text>{" "}
              <Text color="magentaBright" dimColor>
                {agent?.sessionId ?? "<no-session>"}
              </Text>
            </Text>
            <Text dimColor>
              <Text color="blueBright">↳</Text> workdir: <Text bold>{PWD}</Text>
            </Text>
            <Text dimColor>
              <Text color="blueBright">↳</Text> os:{" "}
              <Text bold color="cyanBright">
                {getOSDisplayName()}
              </Text>
            </Text>
            <Text dimColor>
              <Text color="blueBright">↳</Text> model: <Text bold>{model}</Text>
            </Text>
            <Text dimColor>
              <Text color="blueBright">↳</Text> provider:{" "}
              <Text bold color="greenBright">
                {provider}
              </Text>
            </Text>
            <Text dimColor>
              <Text color="blueBright">↳</Text> approval:{" "}
              <Text bold color={colorsByPolicy[approvalPolicy]}>
                {approvalPolicy}
              </Text>
            </Text>
            {flexModeEnabled && (
              <Text dimColor>
                <Text color="blueBright">↳</Text> flex-mode:{" "}
                <Text bold>enabled</Text>
              </Text>
            )}
            {initialImagePaths?.map((img, idx) => (
              <Text key={img ?? idx} color="gray">
                <Text color="blueBright">↳</Text> image:{" "}
                <Text bold>{path.basename(img)}</Text>
              </Text>
            ))}

            {showTabInfo && (
              <Text dimColor>
                <Text color="blueBright">↳</Text> tabs:{" "}
                <Text bold color="cyan">[1] Chat</Text>{" "}
                <Text bold color="yellow">[2] Files</Text>{" "}
                <Text bold color="gray">[3] Reserved</Text>
              </Text>
            )}
            {backgroundProcesses.length > 0 && (
              <Text dimColor>
                <Text color="blueBright">↳</Text> background:{" "}
                <Text bold color="magenta">[●] {backgroundProcesses.length} process{backgroundProcesses.length > 1 ? 'es' : ''} running</Text>
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default TerminalHeader;
