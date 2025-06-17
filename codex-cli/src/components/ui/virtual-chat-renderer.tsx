import { SelectableText } from './selectable-text.js';
import { Box, Text } from 'ink';
import React, { useMemo } from 'react';

interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'function_call' | 'function_output';
  content: string;
  timestamp: Date;
}

interface VirtualChatRendererProps {
  messages: Array<ChatMessage>;
  scrollOffset: number;
  maxVisibleHeight: number;
  isActive: boolean;
  maxLines?: number;
}

export function VirtualChatRenderer({ 
  messages, 
  scrollOffset, 
  maxVisibleHeight, 
  isActive,
  maxLines = 12 
}: VirtualChatRendererProps) {
  
  // Calculate message heights efficiently
  const messageHeights = useMemo(() => {
    return messages.map(message => {
      const lines = message.content.split('\n').length;
      const headerHeight = 1;
      const paddingHeight = 1;
      return Math.min(lines + headerHeight + paddingHeight, maxLines + 2);
    });
  }, [messages, maxLines]);

  // Calculate visible messages using virtual scrolling
  const visibleData = useMemo(() => {
    if (messages.length === 0) {return { messages: [], startIndex: 0, endIndex: 0 };}

    let currentHeight = 0;
    let startIndex = 0;
    let endIndex = messages.length;

    // Find start index based on scroll offset
    let accumulatedHeight = 0;
    for (let i = 0; i < messages.length; i++) {
      if (accumulatedHeight >= scrollOffset) {
        startIndex = i;
        break;
      }
      const height = messageHeights[i];
      if (height !== undefined) {
        accumulatedHeight += height;
      }
    }

    // Find end index based on visible height
    currentHeight = 0;
    for (let i = startIndex; i < messages.length; i++) {
      const height = messageHeights[i];
      if (height !== undefined && currentHeight + height > maxVisibleHeight) {
        endIndex = i;
        break;
      }
      if (height !== undefined) {
        currentHeight += height;
      }
    }

    return {
      messages: messages.slice(startIndex, endIndex),
      startIndex,
      endIndex
    };
  }, [messages, messageHeights, scrollOffset, maxVisibleHeight]);

  // Truncate content for performance
  const truncateContent = (content: string): string => {
    const lines = content.split('\n');
    if (lines.length <= maxLines) {return content;}
    return lines.slice(0, maxLines).join('\n') + '\n... (content truncated, scroll to see more)';
  };

  // Get message type color
  const getMessageColor = (type: ChatMessage['type']): string => {
    switch (type) {
      case 'user': return 'blue';
      case 'function_call': return 'yellow';
      case 'function_output': return 'green';
      case 'assistant': return 'white';
      default: return 'white';
    }
  };

  // Get message type label
  const getMessageLabel = (type: ChatMessage['type']): string => {
    switch (type) {
      case 'user': return 'You';
      case 'function_call': return 'Shell';
      case 'function_output': return 'Output';
      case 'assistant': return 'Assistant';
      default: return 'Unknown';
    }
  };

  if (visibleData.messages.length === 0) {
    return (
      <Box justifyContent="center" alignItems="center" flexGrow={1}>
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan" bold>Mock AI Ready!</Text>
          <Text color="gray" dimColor>test_key mode</Text>
          <Text color="yellow">Try: "explain this codebase"</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visibleData.messages.map((message, index) => {
        const displayContent = truncateContent(message.content);
        const actualIndex = visibleData.startIndex + index;
        
        return (
          <Box key={`${message.id}-${actualIndex}`} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={getMessageColor(message.type)}>
                {getMessageLabel(message.type)}
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
      })}
    </Box>
  );
} 