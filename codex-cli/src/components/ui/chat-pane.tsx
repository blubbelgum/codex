import type { ApprovalPolicy } from '../../approvals.js';
import type { CommandConfirmation } from '../../utils/agent/agent-loop.js';
import type { AppConfig } from '../../utils/config.js';
import type { ResponseItem } from 'openai/resources/responses/responses.mjs';

import { SelectableText } from './selectable-text.js';
import { formatCommandForDisplay } from '../../format-command.js';
import { AgentLoop } from '../../utils/agent/agent-loop.js';
import { ReviewDecision } from '../../utils/agent/review.js';
import { createInputItem } from '../../utils/input-utils.js';
import { uniqueById } from '../../utils/model-utils.js';
import { Box, Text } from 'ink';
import React, { useState, useEffect, useRef } from 'react';

interface ChatPaneProps {
  config: AppConfig;
  prompt?: string;
  imagePaths?: Array<string>;
  approvalPolicy: ApprovalPolicy;
  additionalWritableRoots: ReadonlyArray<string>;
  fullStdout: boolean;
  isActive?: boolean;
  width?: number;
  height?: number;
}

export function ChatPane({
  config,
  prompt: initialPrompt,
  imagePaths: initialImagePaths,
  approvalPolicy,
  additionalWritableRoots,
  fullStdout: _fullStdout,
  isActive = true,
  width = 80,
  height = 20,
}: ChatPaneProps): React.ReactElement {
  const [items, setItems] = useState<Array<ResponseItem>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [_inputText, _setInputText] = useState<string>('');
  const [_lastResponseId, _setLastResponseId] = useState<string | null>(null);
  const agentRef = useRef<AgentLoop>();

  // Initialize agent
  useEffect(() => {
    const _sessionId = crypto.randomUUID();
    
    agentRef.current = new AgentLoop({
      model: config.model,
      provider: config.provider || 'openai',
      config,
      instructions: config.instructions,
      approvalPolicy,
      disableResponseStorage: config.disableResponseStorage,
      additionalWritableRoots,
      onLastResponseId: _setLastResponseId,
      onItem: (item) => {
        setItems((prev) => uniqueById([...prev, item as ResponseItem]));
      },
      onLoading: setLoading,
      getCommandConfirmation: async (
        _command: Array<string>,
      ): Promise<CommandConfirmation> => {
        // For now, auto-approve based on approval policy
        const review = approvalPolicy === 'full-auto' ? ReviewDecision.YES : ReviewDecision.NO_CONTINUE;
        return { review };
      },
    });

    return () => {
      agentRef.current?.terminate();
    };
  }, [config, approvalPolicy, additionalWritableRoots]);

  // Process initial prompt
  useEffect(() => {
    const processInitialPrompt = async () => {
      if (!initialPrompt || !agentRef.current) {return;}
      
      try {
        const inputItem = await createInputItem(initialPrompt, initialImagePaths || []);
        await agentRef.current.run([inputItem]);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to process initial prompt');
      }
    };

    processInitialPrompt();
  }, [initialPrompt, initialImagePaths]);

  // Format chat items for display
  const formatItemForDisplay = (item: ResponseItem): string => {
    switch (item.type) {
      case 'message': {
        const role = item.role === 'assistant' ? '🤖 Assistant' : '👤 You';
        const content = item.content
          .map((c) => {
            if (c.type === 'output_text' || c.type === 'input_text') {
              return c.text;
            }
            if (c.type === 'input_image') {
              return '[Image attached]';
            }
            if (c.type === 'input_file') {
              return `[File: ${c.filename}]`;
            }
            return '[Unknown content]';
          })
          .join('\n');
        return `${role}:\n${content}`;
      }

      case 'function_call': {
        const command = formatCommandForDisplay([item.name, ...(item.arguments ? [item.arguments] : [])]);
        return `💻 Running command:\n$ ${command}`;
      }
      case 'function_call_output': {
        const output = item.output.length > 200
          ? item.output.substring(0, 200) + '...\n[Output truncated]'
          : item.output;
        return `📤 Command output:\n${output}`;
      }
      
      default:
        return `[${item.type}]`;
    }
  };

  const chatContent = items.map(formatItemForDisplay).join('\n\n');
  const displayContent = chatContent || 'Welcome to Enhanced Codex CLI!\n\nType your message to get started...';

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Chat messages area */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingY={1}>
        <SelectableText isActive={isActive}>
          {displayContent}
        </SelectableText>
      </Box>

      {/* Error indicator */}
      {error && (
        <Box paddingX={1}>
          <Text color="red">❌ Error: {error}</Text>
        </Box>
      )}

      {/* Loading indicator */}
      {loading && (
        <Box paddingX={1}>
          <Text color="yellow">🤔 Thinking...</Text>
        </Box>
      )}

      {/* Status line */}
      <Box 
        borderTop 
        borderColor="gray" 
        paddingX={1}
        justifyContent="space-between"
      >
        <Text dimColor>
          {items.length} messages | {config.model}
        </Text>
        <Text dimColor>
          {loading ? 'Processing...' : 'Ready'}
        </Text>
      </Box>
    </Box>
  );
} 