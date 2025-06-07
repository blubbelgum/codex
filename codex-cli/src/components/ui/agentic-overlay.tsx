import type { ToolSuggestion } from "../../utils/agent/tool-discovery.js";

import CommandComposer from "./command-composer.js";
import ToolPalette from "./tool-palette.js";
import { CodeIntelligenceEngine } from "../../utils/agent/code-intelligence.js";
import { AgenticToolDiscovery } from "../../utils/agent/tool-discovery.js";
import { Box, Text, useInput } from "ink";
import React, { useState, useEffect, useCallback, useMemo } from "react";

export interface AgenticOverlayProps {
  isVisible: boolean;
  userQuery?: string;
  onExecuteCommand?: (command: string) => void;
  onClose?: () => void;
  onSuggestionAccept?: (suggestion: ToolSuggestion) => void;
}

export default function AgenticOverlay({
  isVisible,
  userQuery = "",
  onExecuteCommand,
  onClose,
  onSuggestionAccept,
}: AgenticOverlayProps): React.ReactElement {
  const [mode, setMode] = useState<"tools" | "composer" | "analysis">("tools");
  const [suggestions, setSuggestions] = useState<Array<ToolSuggestion>>([]);
  const [contextAnalysis, setContextAnalysis] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const discovery = useMemo(() => new AgenticToolDiscovery(), []);
  const codeIntelligence = useMemo(() => new CodeIntelligenceEngine(), []);

  const generateContextSummary = useCallback(
    (analysisResults: unknown): string => {
      const summary = [
        `🔍 Project Analysis:`,
        `• Files analyzed: ${Array.isArray(analysisResults) ? analysisResults.length : "Unknown"}`,
        `• Framework detected: None`,
        `• Issues found: 0`,
        `• Suggestions available: ${suggestions.length}`,
      ];
      return summary.join("\n");
    },
    [suggestions.length],
  );

  const analyzeContext = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get tool suggestions
      const toolSuggestions = await discovery.getToolSuggestions(userQuery);
      setSuggestions(toolSuggestions);

      // Analyze current codebase
      const analysisResults = await codeIntelligence.analyzeProject();
      const contextSummary = generateContextSummary(analysisResults);
      setContextAnalysis(contextSummary);
    } catch (error) {
      // Log error silently for debugging
    } finally {
      setIsLoading(false);
    }
  }, [userQuery, discovery, codeIntelligence, generateContextSummary]);

  useEffect(() => {
    if (isVisible && userQuery) {
      analyzeContext();
    }
  }, [isVisible, userQuery, analyzeContext]);

  const handleToolSelect = (tool: ToolSuggestion) => {
    if (tool.command) {
      onExecuteCommand?.(tool.command);
    }
    onSuggestionAccept?.(tool);
  };

  const handleCommandComposerExecute = (steps: Array<{ command?: string }>) => {
    steps.forEach((step) => {
      if (step.command) {
        onExecuteCommand?.(step.command);
      }
    });
  };

  useInput((input, key) => {
    if (!isVisible) {
      return;
    }

    if (key.escape) {
      onClose?.();
      return;
    }

    // Mode switching
    if (input === "1") {
      setMode("tools");
    } else if (input === "2") {
      setMode("composer");
    } else if (input === "3") {
      setMode("analysis");
    }
  });

  if (!isVisible) {
    return <></>;
  }

  const renderHeader = () => (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      padding={1}
      marginBottom={1}
    >
      <Text bold color="cyan">
        🤖 Agentic Code Assistant
      </Text>
      {userQuery && (
        <Box>
          <Text color="yellow">Query: </Text>
          <Text>{userQuery}</Text>
        </Box>
      )}

      <Box flexDirection="row" gap={2} marginTop={1}>
        <Text
          color={mode === "tools" ? "cyan" : "gray"}
          bold={mode === "tools"}
        >
          [1] 🔧 Tool Palette
        </Text>
        <Text
          color={mode === "composer" ? "cyan" : "gray"}
          bold={mode === "composer"}
        >
          [2] 📝 Command Composer
        </Text>
        <Text
          color={mode === "analysis" ? "cyan" : "gray"}
          bold={mode === "analysis"}
        >
          [3] 📊 Code Analysis
        </Text>
      </Box>

      {isLoading && (
        <Box marginTop={1}>
          <Text color="yellow">🔄 Analyzing project context...</Text>
        </Box>
      )}
    </Box>
  );

  const renderContent = () => {
    switch (mode) {
      case "tools":
        return (
          <ToolPalette
            isVisible={true}
            userQuery={userQuery}
            onToolSelect={handleToolSelect}
            onClose={() => onClose?.()}
          />
        );

      case "composer":
        return (
          <CommandComposer
            isVisible={true}
            initialQuery={userQuery}
            suggestions={suggestions}
            onExecute={handleCommandComposerExecute}
            onCancel={() => onClose?.()}
          />
        );

      case "analysis":
        return (
          <Box
            flexDirection="column"
            padding={1}
            borderStyle="round"
            borderColor="magenta"
          >
            <Text bold color="magenta">
              📊 Project Intelligence
            </Text>

            {contextAnalysis && (
              <Box marginTop={1}>
                <Text>{contextAnalysis}</Text>
              </Box>
            )}

            {suggestions.length > 0 && (
              <Box marginTop={1} flexDirection="column">
                <Text bold color="cyan">
                  💡 Top Recommendations:
                </Text>
                {suggestions.slice(0, 3).map((suggestion) => (
                  <Box key={suggestion.id} marginTop={1}>
                    <Text color="green">• </Text>
                    <Text bold>{suggestion.name}</Text>
                    <Text color="gray">
                      {" "}
                      ({Math.round(suggestion.confidence * 100)}% confidence)
                    </Text>
                  </Box>
                ))}
              </Box>
            )}

            <Box marginTop={1}>
              <Text dimColor>
                Press [1] or [2] to access tools • ESC to close
              </Text>
            </Box>
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {renderHeader()}
      {renderContent()}

      <Box marginTop={1}>
        <Text dimColor>ESC: Close • 1-3: Switch modes</Text>
      </Box>
    </Box>
  );
}
