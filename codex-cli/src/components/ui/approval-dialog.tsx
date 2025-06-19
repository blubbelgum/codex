import type { ApplyPatchCommand } from "../../approvals.js";
import type { CommandConfirmation } from "../../utils/agent/agent-loop.js";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import CommandPreview from "./command-preview.js";
import { ReviewDecision } from "../../utils/agent/review.js";
import { ErrorSuggestionEngine } from "../../utils/error-suggestions.js";
import { Box, Text, useInput } from "ink";
import React, { useState, useEffect } from "react";

export interface ApprovalDialogProps {
  command: Array<string>;
  applyPatch?: ApplyPatchCommand;
  onDecision: (confirmation: CommandConfirmation) => void;
  autoApprove?: boolean;
}

export default function ApprovalDialog({
  command,
  applyPatch,
  onDecision,
  autoApprove = false,
}: ApprovalDialogProps): React.ReactElement {
  const [showDetails, setShowDetails] = useState(false);
  const [explanation, setExplanation] = useState("");

  // Create a mock function call for analysis
  const mockFunctionCall: ResponseFunctionToolCall = {
    id: "mock",
    call_id: "mock",
    type: "function_call",
    name: command[0] || "unknown",
    arguments: JSON.stringify({ cmd: command }),
  };

  const analysis = ErrorSuggestionEngine.analyzeCommand(mockFunctionCall);
  const hasIssues = analysis.suggestions.length > 0;
  const isHighRisk = analysis.riskLevel === "high";

  useEffect(() => {
    if (autoApprove && !isHighRisk) {
      // Auto-approve low and medium risk commands
      setTimeout(() => {
        onDecision({
          review: ReviewDecision.YES,
          applyPatch,
          explanation: "Auto-approved (low/medium risk)",
        });
      }, 100);
    }
  }, [autoApprove, isHighRisk, onDecision, applyPatch]);

  useInput((input, key) => {
    if (key.escape) {
      onDecision({
        review: ReviewDecision.NO_CONTINUE,
        explanation: "Cancelled by user (ESC)",
      });
      return;
    }

    switch (input.toLowerCase()) {
      case "y":
        onDecision({
          review: ReviewDecision.YES,
          applyPatch,
          explanation: explanation || "Approved by user",
        });
        break;
      case "n":
        onDecision({
          review: ReviewDecision.NO_CONTINUE,
          explanation: explanation || "Denied by user",
        });
        break;
      case "s":
        onDecision({
          review: ReviewDecision.NO_CONTINUE,
          explanation: explanation || "Skipped by user",
        });
        break;
      case "d":
        setShowDetails(!showDetails);
        break;
      case "e":
        // In a real implementation, this would open an input field
        setExplanation("Custom explanation from user");
        break;
      default:
        // Handle unknown input
        break;
    }
  });

  // Auto-approve display for low-risk commands
  if (autoApprove && !isHighRisk) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green">🤖 Auto-approving command...</Text>
        <CommandPreview command={mockFunctionCall} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isHighRisk ? "red" : hasIssues ? "yellow" : "green"}
        padding={1}
      >
        <Text bold color={isHighRisk ? "red" : hasIssues ? "yellow" : "green"}>
          {isHighRisk
            ? "⚠️  HIGH RISK COMMAND"
            : hasIssues
              ? "⚠️  COMMAND NEEDS REVIEW"
              : "✅ COMMAND READY"}
        </Text>

        <Box marginTop={1}>
          <CommandPreview command={mockFunctionCall} />
        </Box>

        {hasIssues && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>🔍 Analysis Results:</Text>
            <Text>
              {ErrorSuggestionEngine.formatSuggestionsForDisplay(analysis)}
            </Text>
          </Box>
        )}

        {analysis.estimatedDuration && (
          <Box marginTop={1}>
            <Text dimColor>
              ⏱️ Estimated duration: {analysis.estimatedDuration}
            </Text>
          </Box>
        )}

        {showDetails && (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            padding={1}
          >
            <Text bold>📋 Command Details:</Text>
            <Text dimColor>Full command: {command.join(" ")}</Text>
            <Text dimColor>Risk level: {analysis.riskLevel}</Text>
            <Text dimColor>Platform: {process.platform}</Text>
            {analysis.isWindowsSpecific && (
              <Text dimColor>Windows-specific command detected</Text>
            )}
            {applyPatch && (
              <Box marginTop={1}>
                <Text dimColor>Apply patch operation:</Text>
                <Text dimColor>• Patch content available</Text>
              </Box>
            )}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>Choose an action:</Text>
          <Box flexDirection="row" gap={2}>
            <Text color="green">[y] Approve</Text>
            <Text color="red">[n] Deny</Text>
            <Text color="yellow">[s] Skip & Continue</Text>
          </Box>
          <Box flexDirection="row" gap={2} marginTop={1}>
            <Text dimColor>[d] {showDetails ? "Hide" : "Show"} Details</Text>
            <Text dimColor>[e] Add Explanation</Text>
            <Text dimColor>[ESC] Cancel</Text>
          </Box>
        </Box>

        {explanation && (
          <Box marginTop={1}>
            <Text>💬 Note: {explanation}</Text>
          </Box>
        )}

        {isHighRisk && (
          <Box marginTop={1} borderStyle="double" borderColor="red" padding={1}>
            <Text bold color="red">
              ⚠️ WARNING: HIGH RISK OPERATION
            </Text>
            <Text color="red">
              This command may make irreversible changes to your system.
            </Text>
            <Text color="red">Please review carefully before approving.</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
