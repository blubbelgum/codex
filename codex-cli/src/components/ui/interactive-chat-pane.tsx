import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from '../vendor/ink-text-input';
import Spinner from '../vendor/ink-spinner';
import type { ResponseItem } from 'openai/resources/responses/responses.mjs';
import { SelectableText } from './selectable-text.js';
import { createMockAgent } from '../../utils/mock-agent.js';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'function_call' | 'function_output';
  content: string;
  timestamp: Date;
}

interface InteractiveChatPaneProps {
  isActive: boolean;
  height: number;
  width: number;
}

export function InteractiveChatPane({ isActive, height, width }: InteractiveChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showInput, setShowInput] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const mockAgent = useRef(createMockAgent({
    onItem: handleAgentItem,
    onLoading: setIsLoading,
  }));

  function handleAgentItem(item: ResponseItem) {
    const newMessage: ChatMessage = {
      id: item.id,
      type: item.type === 'message' 
        ? (item.role === 'user' ? 'user' : 'assistant')
        : item.type === 'function_call' 
        ? 'function_call'
        : 'function_output',
      content: formatResponseItem(item),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
  }

  function formatResponseItem(item: ResponseItem): string {
    switch (item.type) {
      case 'message':
        if (item.role === 'user') {
          return item.content[0]?.type === 'input_text' ? item.content[0].text : '';
        } else {
          return item.content
            .filter(c => c.type === 'output_text')
            .map(c => c.type === 'output_text' ? c.text : '')
            .join('\n');
        }
      case 'function_call':
        const args = JSON.parse(item.arguments || '{}');
        const command = args.command?.join(' ') || item.arguments;
        return `$ ${command}`;
      case 'function_call_output':
        return item.output || '';
      default:
        return '';
    }
  }

  // Calculate message heights for virtual scrolling
  const getMessageHeight = (message: ChatMessage): number => {
    const lines = message.content.split('\n').length;
    const headerHeight = 1;
    const paddingHeight = 1;
    return Math.min(lines + headerHeight + paddingHeight, 15); // Max 15 lines per message
  };

  // Calculate which messages should be visible
  const calculateVisibleMessages = () => {
    const maxVisibleHeight = height - 6; // Account for header, input, help
    let currentHeight = 0;
    let startIndex = 0;
    let endIndex = messages.length;

    // If auto-scroll is enabled, start from the bottom
    if (autoScroll) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message) continue;
        const msgHeight = getMessageHeight(message);
        if (currentHeight + msgHeight > maxVisibleHeight) {
          startIndex = i + 1;
          break;
        }
        currentHeight += msgHeight;
      }
    } else {
      // Use scroll offset for manual scrolling
      let skippedHeight = 0;
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (!message) continue;
        const msgHeight = getMessageHeight(message);
        if (skippedHeight >= scrollOffset) {
          startIndex = i;
          break;
        }
        skippedHeight += msgHeight;
      }

      currentHeight = 0;
      for (let i = startIndex; i < messages.length; i++) {
        const message = messages[i];
        if (!message) continue;
        const msgHeight = getMessageHeight(message);
        if (currentHeight + msgHeight > maxVisibleHeight) {
          endIndex = i;
          break;
        }
        currentHeight += msgHeight;
      }
    }

    return messages.slice(startIndex, endIndex);
  };

  const visibleMessages = calculateVisibleMessages();

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    
    const userInput = input.trim();
    setInput('');
    setShowInput(false);
    setAutoScroll(true); // Re-enable auto-scroll when sending new message
    
    try {
      await mockAgent.current.run(userInput);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        type: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setShowInput(true);
    }
  }, [input, isLoading]);

  // Handle keyboard input for active pane
  useInput((input, key) => {
    if (!isActive) return;

    if (key.return && showInput) {
      handleSubmit();
    } else if (key.upArrow) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.max(0, prev - 2));
    } else if (key.downArrow) {
      const totalHeight = messages.reduce((sum, msg) => sum + getMessageHeight(msg), 0);
      const maxOffset = Math.max(0, totalHeight - (height - 6));
      const newOffset = Math.min(maxOffset, scrollOffset + 2);
      setScrollOffset(newOffset);
      // Re-enable auto-scroll if we're at the bottom
      if (newOffset >= maxOffset - 2) {
        setAutoScroll(true);
      }
    } else if (key.pageUp) {
      setAutoScroll(false);
      setScrollOffset(prev => Math.max(0, prev - 10));
    } else if (key.pageDown) {
      const totalHeight = messages.reduce((sum, msg) => sum + getMessageHeight(msg), 0);
      const maxOffset = Math.max(0, totalHeight - (height - 6));
      const newOffset = Math.min(maxOffset, scrollOffset + 10);
      setScrollOffset(newOffset);
      if (newOffset >= maxOffset - 2) {
        setAutoScroll(true);
      }
    } else if (key.ctrl && input === 'end') {
      // Ctrl+End to jump to bottom
      setAutoScroll(true);
      setScrollOffset(0);
    }
  });

  // Auto-scroll when new messages arrive (only if auto-scroll is enabled)
  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(0);
    }
  }, [messages.length, autoScroll]);

  // Truncate long content for display
  const truncateContent = (content: string, maxLines: number = 12): string => {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + '\n... (content truncated, scroll to see more)';
  };

  return (
    <Box flexDirection="column" height={height} width={width}>
      {/* Header */}
      <Box borderStyle="single" borderBottom={false} paddingX={1} height={2} flexShrink={0}>
        <Text color={isActive ? 'cyan' : 'gray'}>
          Chat {isActive ? '(Active)' : ''} {isLoading && <Spinner type="dots" />}
        </Text>
        <Box flexGrow={1} />
        <Text color="gray" dimColor>
          {messages.length > 0 && `${messages.length} msgs`}
          {!autoScroll && ' | Manual'}
        </Text>
      </Box>

      {/* Messages area */}
      <Box 
        flexDirection="column" 
        flexGrow={1} 
        borderStyle="single" 
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        overflowY="hidden"
      >
        {visibleMessages.length === 0 ? (
          <Box justifyContent="center" alignItems="center" flexGrow={1}>
            <Box flexDirection="column" alignItems="center">
              <Text color="cyan" bold>Mock AI Ready!</Text>
              <Text color="gray" dimColor>test_key mode</Text>
              <Text color="yellow">Try: "explain this codebase"</Text>
            </Box>
          </Box>
        ) : (
          visibleMessages.map((message) => {
            const displayContent = truncateContent(message.content);
            return (
              <Box key={message.id} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text color={
                    message.type === 'user' ? 'blue' :
                    message.type === 'function_call' ? 'yellow' :
                    message.type === 'function_output' ? 'green' :
                    'white'
                  }>
                    {message.type === 'user' ? 'You' :
                     message.type === 'function_call' ? 'Shell' :
                     message.type === 'function_output' ? 'Output' :
                     'Assistant'}
                  </Text>
                  <Box flexGrow={1} />
                  <Text color="gray" dimColor>
                    {message.timestamp.toLocaleTimeString()}
                  </Text>
                </Box>
                <SelectableText isActive={isActive}>
                  {displayContent}
                </SelectableText>
              </Box>
            );
          })
        )}
      </Box>

      {/* Input area */}
      <Box 
        borderStyle="single" 
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        height={2}
        flexShrink={0}
      >
        {showInput ? (
          <Box width="100%" alignItems="center">
            <Text color={isActive ? 'cyan' : 'gray'}>
              {isActive ? '>' : 'o'}
            </Text>
            <Box flexGrow={1} marginLeft={1}>
              <TextInput
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                placeholder={isActive ? "Type here..." : ""}
                focus={isActive}
              />
            </Box>
            {isActive && (
              <Text color="green">*</Text>
            )}
          </Box>
        ) : (
          <Box width="100%" alignItems="center" justifyContent="center">
            <Spinner type="dots" />
            <Box marginLeft={1}>
              <Text color="yellow">Processing...</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Help text */}
      {isActive && (
        <Box paddingX={1} justifyContent="center" height={1} flexShrink={0}>
          <Text color="gray" dimColor>
            Arrows: Scroll | PgUp/Dn: Fast | Ctrl+End: Bottom | Enter: Send
          </Text>
        </Box>
      )}
    </Box>
  );
} 