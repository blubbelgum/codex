import type { ProgressStep } from "../../hooks/useProgressTracker.js";

import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

export interface ProgressIndicatorProps {
  steps: Array<ProgressStep>;
  showTimings?: boolean;
  compact?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function ProgressIndicator({
  steps,
  showTimings = true,
  compact = false,
}: ProgressIndicatorProps): React.ReactElement {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    const hasActiveSteps = steps.some((step) => step.status === "active");
    if (!hasActiveSteps) {
      return;
    }

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [steps]);

  const getStatusIcon = (step: ProgressStep): string => {
    switch (step.status) {
      case "pending":
        return "⏳";
      case "active":
        return SPINNER_FRAMES[spinnerFrame] || "⠋";
      case "completed":
        return "✅";
      case "error":
        return "❌";
    }
  };

  const getStatusColor = (step: ProgressStep): string => {
    switch (step.status) {
      case "pending":
        return "gray";
      case "active":
        return "blue";
      case "completed":
        return "green";
      case "error":
        return "red";
    }
  };

  const getDuration = (step: ProgressStep): string => {
    if (!step.startTime) {
      return "";
    }

    const endTime = step.endTime || new Date();
    const duration = endTime.getTime() - step.startTime.getTime();

    if (duration < 1000) {
      return `${duration}ms`;
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(duration / 60000);
      const seconds = ((duration % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  };

  const getOverallProgress = (): {
    completed: number;
    total: number;
    percentage: number;
  } => {
    const completed = steps.filter(
      (step) => step.status === "completed",
    ).length;
    const total = steps.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, total, percentage };
  };

  const progress = getOverallProgress();
  const hasErrors = steps.some((step) => step.status === "error");
  const isComplete =
    progress.completed === progress.total && progress.total > 0;

  if (compact) {
    const activeStep = steps.find((step) => step.status === "active");
    if (!activeStep && !hasErrors && !isComplete) {
      return <></>;
    }

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={hasErrors ? "red" : isComplete ? "green" : "blue"}>
          {hasErrors ? "❌" : isComplete ? "✅" : SPINNER_FRAMES[spinnerFrame]}
        </Text>
        <Text color={hasErrors ? "red" : isComplete ? "green" : "white"}>
          {activeStep
            ? activeStep.title
            : hasErrors
              ? "Error occurred"
              : "Complete"}
        </Text>
        {showTimings && activeStep && activeStep.startTime && (
          <Text dimColor>({getDuration(activeStep)})</Text>
        )}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={hasErrors ? "red" : isComplete ? "green" : "blue"}
      padding={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={hasErrors ? "red" : isComplete ? "green" : "blue"}>
          {hasErrors
            ? "❌ Error in Progress"
            : isComplete
              ? "✅ Complete"
              : "🔄 In Progress"}
        </Text>
        <Text dimColor>
          {progress.completed}/{progress.total} ({progress.percentage}%)
        </Text>
      </Box>

      {progress.total > 0 && (
        <Box marginTop={1}>
          <Text>
            {"█".repeat(Math.floor(progress.percentage / 5))}
            {"░".repeat(20 - Math.floor(progress.percentage / 5))}
          </Text>
          <Text dimColor> {progress.percentage}%</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {steps.map((step) => (
          <Box key={step.id} flexDirection="row" gap={1}>
            <Text color={getStatusColor(step)}>{getStatusIcon(step)}</Text>
            <Text color={getStatusColor(step)} bold={step.status === "active"}>
              {step.title}
            </Text>
            {showTimings && step.startTime && (
              <Text dimColor>({getDuration(step)})</Text>
            )}
          </Box>
        ))}
      </Box>

      {steps.some((step) => step.details) && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Details:</Text>
          {steps
            .filter((step) => step.details)
            .map((step) => (
              <Text key={`${step.id}-details`} dimColor>
                • {step.details}
              </Text>
            ))}
        </Box>
      )}
    </Box>
  );
}
