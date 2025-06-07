import type { ToolSuggestion } from "../../utils/agent/tool-discovery.js";

import { Box, Text, useInput } from "ink";
import React, { useState, useEffect, useCallback } from "react";

interface CommandStep {
  id: string;
  type: "command" | "condition" | "loop" | "parallel";
  description: string;
  command?: string;
  dependencies?: Array<string>;
  reasoning: string;
  confidence: number;
  timeEstimate?: string;
}

interface CommandComposerProps {
  onExecute: (steps: Array<CommandStep>) => void;
  onCancel: () => void;
  initialQuery?: string;
  suggestions?: Array<ToolSuggestion>;
  isVisible: boolean;
}

export default function CommandComposer({
  onExecute,
  onCancel,
  initialQuery = "",
  suggestions = [],
  isVisible,
}: CommandComposerProps): React.ReactElement | null {
  const [query, setQuery] = useState(initialQuery);
  const [steps, setSteps] = useState<Array<CommandStep>>([]);
  const [selectedStepIndex, setSelectedStepIndex] = useState(0);
  const [mode, setMode] = useState<"compose" | "review" | "reasoning">(
    "compose",
  );
  const [reasoning, setReasoning] = useState<string>("");

  const generateStepsFromQuery = useCallback(
    async (userQuery: string): Promise<void> => {
      setMode("reasoning");
      setReasoning(
        "🧠 Analyzing your request and breaking it down into optimal steps...",
      );

      // Simulate AI reasoning process
      setTimeout(() => {
        const generatedSteps = analyzeAndBreakdown(userQuery, suggestions);
        setSteps(generatedSteps);
        setMode("review");
      }, 1500);
    },
    [suggestions],
  );

  useEffect(() => {
    if (isVisible && query) {
      generateStepsFromQuery(query);
    }
  }, [isVisible, query, generateStepsFromQuery]);

  const analyzeAndBreakdown = (
    userQuery: string,
    _availableTools: Array<ToolSuggestion>,
  ): Array<CommandStep> => {
    const steps: Array<CommandStep> = [];
    const lowerQuery = userQuery.toLowerCase();

    // Analyze query for different intents
    if (lowerQuery.includes("test") || lowerQuery.includes("testing")) {
      steps.push({
        id: "1",
        type: "command",
        description: "Run linting checks first",
        command: "npm run lint",
        reasoning:
          "Linting should be run before tests to catch style issues early",
        confidence: 0.9,
        timeEstimate: "~30s",
      });

      steps.push({
        id: "2",
        type: "command",
        description: "Execute test suite",
        command: "npm test",
        dependencies: ["1"],
        reasoning: "Run tests after linting passes to ensure code quality",
        confidence: 0.95,
        timeEstimate: "~2-5m",
      });

      if (lowerQuery.includes("coverage")) {
        steps.push({
          id: "3",
          type: "command",
          description: "Generate coverage report",
          command: "npm run test:coverage",
          dependencies: ["2"],
          reasoning:
            "Coverage analysis provides insights into test completeness",
          confidence: 0.85,
          timeEstimate: "~1m",
        });
      }
    }

    if (lowerQuery.includes("build") || lowerQuery.includes("deploy")) {
      steps.push({
        id: "build-1",
        type: "command",
        description: "Install dependencies",
        command: "npm ci",
        reasoning: "Ensure all dependencies are installed with exact versions",
        confidence: 0.95,
        timeEstimate: "~1-3m",
      });

      steps.push({
        id: "build-2",
        type: "command",
        description: "Run type checking",
        command: "npx tsc --noEmit",
        dependencies: ["build-1"],
        reasoning: "TypeScript compilation check prevents runtime type errors",
        confidence: 0.9,
        timeEstimate: "~30s",
      });

      steps.push({
        id: "build-3",
        type: "command",
        description: "Build production bundle",
        command: "npm run build",
        dependencies: ["build-2"],
        reasoning: "Create optimized production build after validation",
        confidence: 0.95,
        timeEstimate: "~2-5m",
      });
    }

    if (lowerQuery.includes("security") || lowerQuery.includes("audit")) {
      steps.push({
        id: "sec-1",
        type: "command",
        description: "Check for vulnerabilities",
        command: "npm audit",
        reasoning: "Identify known security vulnerabilities in dependencies",
        confidence: 0.9,
        timeEstimate: "~15s",
      });

      steps.push({
        id: "sec-2",
        type: "condition",
        description: "Fix vulnerabilities if found",
        command: "npm audit fix",
        dependencies: ["sec-1"],
        reasoning: "Automatically fix vulnerabilities where possible",
        confidence: 0.8,
        timeEstimate: "~30s",
      });
    }

    if (lowerQuery.includes("optimize") || lowerQuery.includes("performance")) {
      steps.push({
        id: "opt-1",
        type: "command",
        description: "Analyze bundle size",
        command: "npx webpack-bundle-analyzer dist/static/js/*.js",
        reasoning:
          "Understanding bundle composition helps identify optimization opportunities",
        confidence: 0.8,
        timeEstimate: "~30s",
      });

      steps.push({
        id: "opt-2",
        type: "command",
        description: "Check for duplicate dependencies",
        command: "npx npm-check-duplicates",
        reasoning: "Duplicate dependencies increase bundle size unnecessarily",
        confidence: 0.75,
        timeEstimate: "~15s",
      });
    }

    // If no specific steps generated, create a generic analysis step
    if (steps.length === 0) {
      steps.push({
        id: "generic-1",
        type: "command",
        description: "Analyze project structure",
        command: "find . -type f -name '*.{js,ts,jsx,tsx}' | wc -l",
        reasoning: "Understanding project scope helps determine next steps",
        confidence: 0.6,
        timeEstimate: "~5s",
      });
    }

    return steps;
  };

  const estimateTotalTime = (): string => {
    const totalMinutes = steps.reduce((acc, step) => {
      if (step.timeEstimate) {
        const match = step.timeEstimate.match(/(\d+)([ms])/);
        if (match && match[1] && match[2]) {
          const value = parseInt(match[1]);
          const unit = match[2];
          return acc + (unit === "m" ? value : value / 60);
        }
      }
      return acc + 1; // Default 1 minute if no estimate
    }, 0);

    return totalMinutes < 1 ? "<1m" : `~${Math.round(totalMinutes)}m`;
  };

  useInput((input, key) => {
    if (!isVisible) {
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (mode === "compose") {
      if (key.return) {
        if (query.trim()) {
          generateStepsFromQuery(query);
        }
        return;
      }

      if (key.backspace) {
        setQuery((prev) => prev.slice(0, -1));
        return;
      }

      if (input && input.length === 1) {
        setQuery((prev) => prev + input);
        return;
      }
    }

    if (mode === "review") {
      if (key.return) {
        onExecute(steps);
        return;
      }

      if (key.upArrow) {
        setSelectedStepIndex(Math.max(0, selectedStepIndex - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedStepIndex(Math.min(steps.length - 1, selectedStepIndex + 1));
        return;
      }

      if (input === "e") {
        setMode("compose");
        return;
      }

      if (input === "r") {
        setMode("reasoning");
        setReasoning("🔄 Re-analyzing your request with updated context...");
        setTimeout(() => {
          const newSteps = analyzeAndBreakdown(query, suggestions);
          setSteps(newSteps);
          setMode("review");
        }, 1000);
        return;
      }
    }
  });

  if (!isVisible) {
    return null;
  }

  const renderComposeMode = () => (
    <Box flexDirection="column">
      <Text bold color="cyan">
        🤖 AI Command Composer
      </Text>
      <Text dimColor>
        Describe what you want to accomplish, and I'll break it down into
        optimal steps
      </Text>

      <Box marginTop={1}>
        <Text>Query: </Text>
        <Text color="yellow">{query}</Text>
        <Text color="gray">█</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Press Enter to analyze • ESC to cancel</Text>
      </Box>

      {suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">💡 Available tools that might be relevant:</Text>
          {suggestions.slice(0, 3).map((tool) => (
            <Box key={tool.id}>
              <Text color="gray">• </Text>
              <Text>{tool.name}</Text>
              <Text color="gray"> - {tool.description}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );

  const renderReasoningMode = () => (
    <Box flexDirection="column">
      <Text bold color="cyan">
        🧠 AI Reasoning Process
      </Text>

      <Box marginTop={1}>
        <Text color="yellow">{reasoning}</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Analyzing query: "{query}"</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Please wait while I generate the optimal execution plan...
        </Text>
      </Box>
    </Box>
  );

  const renderReviewMode = () => (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">
          📋 Execution Plan Review
        </Text>
        <Text color="gray"> (Total time: {estimateTotalTime()})</Text>
      </Box>

      <Box marginTop={1}>
        <Text color="yellow">Query: </Text>
        <Text>{query}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {steps.map((step, index) => (
          <Box key={step.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text
                color={index === selectedStepIndex ? "black" : "white"}
                backgroundColor={
                  index === selectedStepIndex ? "cyan" : undefined
                }
                bold={index === selectedStepIndex}
              >
                {index === selectedStepIndex ? "▶ " : "  "}
                Step {index + 1}: {step.description}
              </Text>

              <Text color="gray"> {step.timeEstimate}</Text>

              <Box marginLeft={1}>
                {Array.from({ length: Math.round(step.confidence * 5) }).map(
                  (_, i) => (
                    <Text key={i} color="green">
                      ★
                    </Text>
                  ),
                )}
                {Array.from({
                  length: 5 - Math.round(step.confidence * 5),
                }).map((_, i) => (
                  <Text key={i} color="gray">
                    ☆
                  </Text>
                ))}
              </Box>
            </Box>

            {step.command && (
              <Box paddingLeft={2}>
                <Text color="green">$ </Text>
                <Text color="white">{step.command}</Text>
              </Box>
            )}

            <Box paddingLeft={2}>
              <Text color="yellow">💡 </Text>
              <Text color="gray">{step.reasoning}</Text>
            </Box>

            {step.dependencies && step.dependencies.length > 0 && (
              <Box paddingLeft={2}>
                <Text color="cyan">🔗 Depends on: </Text>
                <Text color="gray">{step.dependencies.join(", ")}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ⏎ Execute Plan • ↑↓ Navigate • E: Edit Query • R: Re-analyze • ESC:
          Cancel
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="cyan"
    >
      {mode === "compose" && renderComposeMode()}
      {mode === "reasoning" && renderReasoningMode()}
      {mode === "review" && renderReviewMode()}
    </Box>
  );
}
