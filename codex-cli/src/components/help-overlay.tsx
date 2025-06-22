import { Box, Text, useInput } from "ink";
import React from "react";

/**
 * An enhanced help overlay that provides comprehensive information about
 * Codex CLI's features, commands, and capabilities. This showcases the
 * improved functionality and utilities available in the application.
 */
export default function HelpOverlay({
  onExit,
}: {
  onExit: () => void;
}): JSX.Element {
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      width={85}
      paddingX={1}
      paddingY={1}
    >
      <Box justifyContent="center" paddingBottom={1}>
        <Text bold color="cyan">Codex CLI - Comprehensive Help Guide</Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        {/* Slash Commands Section */}
        <Box flexDirection="column">
          <Text bold color="green">Slash Commands</Text>
          <Box flexDirection="column" paddingLeft={2}>
            <Text>
              <Text color="cyan">/help</Text> - Show this comprehensive help guide
            </Text>
            <Text>
              <Text color="cyan">/model</Text> - Switch AI model (GPT-4, Claude, etc.)
            </Text>
            <Text>
              <Text color="cyan">/approval</Text> - Configure auto-approval settings
            </Text>
            <Text>
              <Text color="cyan">/diff</Text> - View git diff with enhanced statistics
            </Text>
            <Text>
              <Text color="cyan">/search</Text> - Web search with markdown export
            </Text>
            <Text>
              <Text color="cyan">/compact</Text> - Optimize context when running low
            </Text>
            <Text>
              <Text color="cyan">/history</Text> - Browse command history
            </Text>
            <Text>
              <Text color="cyan">/sessions</Text> - Manage conversation sessions
            </Text>
            <Text>
              <Text color="cyan">/clear</Text> - Clear conversation context
            </Text>
            <Text>
              <Text color="cyan">/bug</Text> - Generate GitHub issue with session log
            </Text>
          </Box>
        </Box>

        {/* Key Features Section */}
        <Box flexDirection="column">
          <Text bold color="yellow">Key Features</Text>
          <Box flexDirection="column" paddingLeft={2}>
            <Text>
              <Text color="green">Multi-Edit Operations:</Text> Atomic batch edits across files
            </Text>
            <Text>
              <Text color="green">Rollback Protection:</Text> All edits succeed or all rollback
            </Text>
            <Text>
              <Text color="green">File Suggestions:</Text> Smart auto-completion for paths
            </Text>
            <Text>
              <Text color="green">Context Tracking:</Text> Real-time token usage monitoring
            </Text>
            <Text>
              <Text color="green">Error Recovery:</Text> Intelligent error suggestions
            </Text>
            <Text>
              <Text color="green">Session Management:</Text> Persistent conversation history
            </Text>
          </Box>
        </Box>

        {/* File Operations Section */}
        <Box flexDirection="column">
          <Text bold color="blue">File Operations</Text>
          <Box flexDirection="column" paddingLeft={2}>
            <Text>
              <Text color="cyan">@filename</Text> - Reference files in messages
            </Text>
            <Text>
              <Text color="cyan">Tab</Text> - Auto-complete file paths
            </Text>
            <Text>
              <Text color="cyan">multi_edit</Text> - Batch edit multiple files atomically
            </Text>
            <Text>
              <Text color="cyan">replace_all</Text> - Global text replacement
            </Text>
            <Text>Image support: PNG, JPEG, GIF, BMP, WebP, SVG</Text>
          </Box>
        </Box>

        {/* Keyboard Shortcuts Section */}
        <Box flexDirection="column">
          <Text bold color="magenta">Keyboard Shortcuts</Text>
          <Box flexDirection="column" paddingLeft={2}>
            <Text>
              <Text color="yellow">Enter</Text> - Send message / Execute command
            </Text>
            <Text>
              <Text color="yellow">Ctrl+J</Text> - Insert newline in message
            </Text>
            <Text>
              <Text color="yellow">Up/Down</Text> - Navigate command history
            </Text>
            <Text>
              <Text color="yellow">Tab</Text> - Auto-complete commands/files
            </Text>
            <Text>
              <Text color="yellow">Esc</Text> - Toggle input focus / Cancel operations
            </Text>
            <Text>
              <Text color="yellow">Esc (×2)</Text> - Interrupt current AI operation
            </Text>
            <Text>
              <Text color="yellow">Ctrl+C</Text> - Exit Codex CLI
            </Text>
            <Text>
              <Text color="yellow">1/2/3</Text> - Switch between Chat/Files/Tasks modes
            </Text>
          </Box>
        </Box>

        {/* Status Indicators Section */}
        <Box flexDirection="column">
          <Text bold color="red">Status Indicators</Text>
          <Box flexDirection="column" paddingLeft={2}>
            <Text>
              <Text color="green">Context %</Text> - Remaining conversation context
            </Text>
            <Text>
              <Text color="blue">Token Usage</Text> - Current token count and percentage
            </Text>
            <Text>
              <Text color="yellow">Processing</Text> - AI is currently thinking
            </Text>
            <Text>
              <Text color="magenta">Session ID</Text> - Current conversation session
            </Text>
            <Text>
              <Text color="cyan">Focused/Unfocused</Text> - Input state indicator
            </Text>
          </Box>
        </Box>

        {/* Pro Tips Section */}
        <Box flexDirection="column">
          <Text bold color="cyan">Pro Tips</Text>
          <Box flexDirection="column" paddingLeft={2}>
            <Text>• Use descriptive commit messages for better context</Text>
            <Text>• Reference multiple files with @file1 @file2 syntax</Text>
            <Text>• Use /compact when context gets low (below 25%)</Text>
            <Text>• Multi-edit operations are safer than individual edits</Text>
            <Text>• Press Esc to unfocus input and use number keys for tabs</Text>
            <Text>• File suggestions appear as you type paths</Text>
            <Text>• Error messages include actionable suggestions</Text>
          </Box>
        </Box>
      </Box>

      <Box borderTop={true} paddingTop={1} justifyContent="center">
        <Text dimColor>Press <Text color="yellow">Esc</Text> or <Text color="yellow">q</Text> to close</Text>
      </Box>
    </Box>
  );
}
