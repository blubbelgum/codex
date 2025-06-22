import type { CommandConfirmation } from "../../utils/agent/agent-loop.js";
import type { CommandAnalysis } from "../../utils/error-suggestions.js";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { ReviewDecision } from "../../utils/agent/review.js";
import { ErrorSuggestionEngine } from "../../utils/error-suggestions.js";
import { Box, Text, useInput } from "ink";
import React, { useState, useEffect } from "react";

export interface ApprovalDialogProps {
  command: Array<string>;
  mockFunctionCall: ResponseFunctionToolCall;
  explanation?: string;
  applyPatch?: boolean;
  onDecision: (confirmation: CommandConfirmation) => void;
  autoApprove?: boolean;
  message?: string;
  errorMessage?: string;
  commandAnalysis?: CommandAnalysis;
  showSuggestions?: boolean;
}

export default function ApprovalDialog({
  command: _command,
  mockFunctionCall,
  explanation: _explanation,
  applyPatch: _applyPatch,
  onDecision,
  autoApprove = false,
  message = "Do you approve this operation?",
  errorMessage,
  commandAnalysis,
  showSuggestions = true,
}: ApprovalDialogProps): React.ReactElement {
  const [showDetails, setShowDetails] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);

  // Analyze the command for potential issues
  const analysis = React.useMemo(() => {
    return ErrorSuggestionEngine.analyzeCommand(mockFunctionCall);
  }, [mockFunctionCall]);

  const isHighRisk = analysis.riskLevel === "high";

  // Format suggestions for display
  const formattedSuggestions = React.useMemo(() => {
    if (!commandAnalysis || !showSuggestions || commandAnalysis.suggestions.length === 0) {
      return null;
    }
    
    return ErrorSuggestionEngine.formatSuggestionsForDisplay(commandAnalysis);
  }, [commandAnalysis, showSuggestions]);

  const hasCommandIssues = commandAnalysis && commandAnalysis.suggestions.length > 0;

  useEffect(() => {
    if (autoApprove && analysis.riskLevel === "low") {
      onDecision({ review: ReviewDecision.YES });
    }
  }, [autoApprove, analysis.riskLevel, onDecision]);

  // Handle keyboard input for approval dialog
  useInput(
    (input, key) => {
      if (editingMessage) {
        if (key.escape) {
          setEditingMessage(false);
          setCustomMessage("");
        } else if (key.return) {
          setEditingMessage(false);
        }
        return;
      }

      if (key.escape) {
        onDecision({ review: ReviewDecision.NO_EXIT });
      } else if (input.toLowerCase() === "y") {
        onDecision({ review: ReviewDecision.YES, customDenyMessage: customMessage });
      } else if (input.toLowerCase() === "n") {
        onDecision({
          review: ReviewDecision.NO_EXIT,
          customDenyMessage: customMessage || "User denied the operation",
        });
      } else if (input.toLowerCase() === "s") {
        onDecision({ review: ReviewDecision.NO_CONTINUE });
      } else if (input.toLowerCase() === "d") {
        setShowDetails(!showDetails);
      } else if (input.toLowerCase() === "e") {
        setEditingMessage(true);
      }
    },
    { isActive: !editingMessage },
  );

  return (
    <Box flexDirection="column" gap={1}>
      {/* Main message */}
      <Box
        borderStyle="round"
        borderColor={errorMessage ? "red" : isHighRisk ? "red" : hasCommandIssues ? "yellow" : "blue"}
        paddingX={1}
        paddingY={1}
      >
        <Box flexDirection="column" width="100%">
          <Text color={errorMessage ? "red" : isHighRisk ? "red" : hasCommandIssues ? "yellow" : "blue"} bold>
            {errorMessage ? "Operation Failed" : 
             isHighRisk ? "High Risk Operation" :
             hasCommandIssues ? "Review Required" : "Approval Required"}
          </Text>
          <Text>{message}</Text>
          
          {/* Error message display */}
          {errorMessage && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="red" bold>Error Details:</Text>
              <Text color="red">{errorMessage}</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Command analysis suggestions */}
      {formattedSuggestions && (
        <Box
          borderStyle="round"
          borderColor="blue"
          paddingX={1}
          paddingY={1}
        >
          <Box flexDirection="column" width="100%">
            <Text color="blue" bold>Command Analysis:</Text>
            <Text>{formattedSuggestions}</Text>
            <Box marginTop={1}>
              <Text dimColor>
                Risk Level: {commandAnalysis?.riskLevel || "unknown"}
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {/* Action buttons */}
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text>
          <Text color="green" bold>y</Text> - Approve
        </Text>
        <Text>
          <Text color="red" bold>n</Text> - Deny
        </Text>
        {hasCommandIssues && (
          <Text>
            <Text color="blue" bold>d</Text> - Show details
          </Text>
        )}
      </Box>

      {/* Additional context for errors */}
      {(errorMessage || hasCommandIssues) && (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Box flexDirection="column" width="100%">
            <Text color="yellow" bold>Next Steps:</Text>
            <Text dimColor>
              • Review the {errorMessage ? "error details" : "analysis"} above
            </Text>
            <Text dimColor>
              • Consider using <Text color="cyan">/help</Text> for more guidance
            </Text>
            <Text dimColor>
              • Use <Text color="cyan">/bug</Text> to report persistent issues
            </Text>
            {errorMessage && !hasCommandIssues && (
              <Text dimColor>
                • This error doesn't have specific automated suggestions
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
