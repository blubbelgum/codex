// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "../vendor/ink-select/select";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { AutoApprovalMode } from "src/utils/auto-approval-mode";

interface OnboardingStep {
  title: string;
  content: React.ReactNode;
}

export function OnboardingApprovalMode(): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedApprovalMode, setSelectedApprovalMode] = useState<AutoApprovalMode | null>(null);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Handle keyboard navigation - must be before any conditional returns
  useInput((_input, key) => {
    if (key.return) {
      handleNext();
    } else if (key.leftArrow && currentStep > 0) {
      handlePrevious();
    } else if (key.rightArrow && currentStep < steps.length - 1) {
      handleNext();
    }
  });

  const steps: Array<OnboardingStep> = [
    {
      title: "Welcome to Codex CLI",
      content: (
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text color="cyan" bold>Codex CLI</Text> is a powerful AI-powered coding assistant that helps you:
          </Text>
          <Text>• Read and edit files with atomic multi-edit operations</Text>
          <Text>• Execute terminal commands with intelligent error handling</Text>
          <Text>• Search the web and save results for reference</Text>
          <Text>• Track token usage and manage context efficiently</Text>
          <Text>• Work with file system suggestions and auto-completion</Text>
          <Text></Text>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      ),
    },
    {
      title: "Key Features Overview",
      content: (
        <Box flexDirection="column" gap={1}>
          <Text color="green" bold>Batch Processing & Multi-Edit:</Text>
          <Text>• Atomic operations across multiple files</Text>
          <Text>• Automatic rollback on failures</Text>
          <Text>• Replace-all functionality for global changes</Text>
          <Text></Text>
          <Text color="blue" bold>Smart File Operations:</Text>
          <Text>• Intelligent file system suggestions</Text>
          <Text>• Auto-completion for paths and commands</Text>
          <Text>• Real-time diff visualization with statistics</Text>
          <Text></Text>
          <Text color="yellow" bold>Context Management:</Text>
          <Text>• Token usage tracking and optimization</Text>
          <Text>• Automatic context compaction when needed</Text>
          <Text>• Session management and history</Text>
          <Text></Text>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      ),
    },
    {
      title: "Essential Commands",
      content: (
        <Box flexDirection="column" gap={1}>
          <Text color="cyan" bold>Quick Start Commands:</Text>
          <Text>• <Text color="green">/help</Text> - Show all available commands</Text>
          <Text>• <Text color="green">/model</Text> - Switch AI models</Text>
          <Text>• <Text color="green">/diff</Text> - View changes with enhanced statistics</Text>
          <Text>• <Text color="green">/search</Text> - Search web and save to markdown</Text>
          <Text>• <Text color="green">/compact</Text> - Optimize context when running low</Text>
          <Text></Text>
          <Text color="magenta" bold>Pro Tips:</Text>
          <Text>• Use @filename to reference files in your messages</Text>
          <Text>• Press Tab for file path auto-completion</Text>
          <Text>• Context percentage shows in the status bar</Text>
          <Text>• Multi-edit operations are atomic - all succeed or all rollback</Text>
          <Text></Text>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      ),
    },
    {
      title: "Approval Mode Setup",
      content: (
        <Box flexDirection="column" gap={1}>
          <Text>Choose your preferred approval level for AI operations:</Text>
          <Text></Text>
          <Select
            onChange={(value: AutoApprovalMode) => setSelectedApprovalMode(value)}
            options={[
              {
                label: "Suggest Mode - Ask for edits and commands (Recommended for beginners)",
                value: AutoApprovalMode.SUGGEST,
              },
              {
                label: "Auto-Edit Mode - Auto-approve edits, ask for commands (Balanced)",
                value: AutoApprovalMode.AUTO_EDIT,
              },
              {
                label: "Full-Auto Mode - Auto-approve most operations (Advanced users)",
                value: AutoApprovalMode.FULL_AUTO,
              },
            ]}
          />
          <Text></Text>
          <Text dimColor>You can change this anytime with <Text color="cyan">/approval</Text></Text>
          {selectedApprovalMode && (
            <Text color="green">
              Selected: {selectedApprovalMode === AutoApprovalMode.SUGGEST ? 'Suggest Mode' : 
                        selectedApprovalMode === AutoApprovalMode.AUTO_EDIT ? 'Auto-Edit Mode' : 'Full-Auto Mode'}
            </Text>
          )}
        </Box>
      ),
    },
  ];

  const currentStepData = steps[currentStep];
  if (!currentStepData) {
    return <Text color="red">Error: Invalid step</Text>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {/* Progress indicator */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text>
          <Text color="cyan" bold>Setup</Text> - Step {currentStep + 1} of {steps.length}
        </Text>
        <Text> </Text>
        <Text dimColor>
          [{"=".repeat(currentStep + 1)}{"·".repeat(steps.length - currentStep - 1)}]
        </Text>
      </Box>

      {/* Main content */}
      <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} minHeight={12}>
        <Box flexDirection="column" width="100%">
          <Text color="yellow" bold>{currentStepData.title}</Text>
          <Text></Text>
          {currentStepData.content}
        </Box>
      </Box>

      {/* Navigation */}
      <Box borderStyle="round" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text dimColor>
          {currentStep > 0 ? "← Previous (Left Arrow)" : ""}
        </Text>
        <Text dimColor>
          {currentStep < steps.length - 1 ? "Enter/Right Arrow: Next →" : "Enter: Complete Setup"}
        </Text>
      </Box>
    </Box>
  );
}
