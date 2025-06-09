import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from '../vendor/ink-text-input';
import Spinner from '../vendor/ink-spinner';
import type { ResponseItem } from 'openai/resources/responses/responses.mjs';
import { VirtualChatRenderer } from './virtual-chat-renderer.js';
import { createMockAgent } from '../../utils/mock-agent.js';
import { memoryManager } from '../../utils/memory-manager.js';

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
  const [performanceMode, setPerformanceMode] = useState(false);
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

    setMessages(prev => {
      const updated = [...prev, newMessage];
      // Apply memory management for large message histories
      return memoryManager.optimizeChatMessages(updated);
    });
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
      setMessages(prev => memoryManager.optimizeChatMessages([...prev, errorMessage]));
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
    } else if (input === 'p') {
      // Toggle performance mode
      setPerformanceMode(!performanceMode);
    } else if (input === 'm') {
      // Show memory stats
      const stats = memoryManager.getStats();
      const memoryMessage: ChatMessage = {
        id: `memory-${Date.now()}`,
        type: 'assistant',
        content: `Memory Stats:\n- Chat messages: ${messages.length}\n- File cache: ${stats.fileCache.size}/${stats.fileCache.maxSize}\n- Directory cache: ${stats.directoryCache.size}/${stats.directoryCache.maxSize}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, memoryMessage]);
    }
  }, { isActive });

  // Auto-scroll when new messages arrive (only if auto-scroll is enabled)
  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(0);
    }
  }, [messages.length, autoScroll]);

  // Enable performance mode for large message histories
  useEffect(() => {
    if (messages.length > 100 && !performanceMode) {
      setPerformanceMode(true);
    }
  }, [messages.length, performanceMode]);

  const maxVisibleHeight = height - 6; // Account for header, input, help

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
          {performanceMode && ' | Perf'}
          {!autoScroll && ' | Manual'}
        </Text>
      </Box>

      {/* Messages area with virtual rendering */}
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
        <VirtualChatRenderer
          messages={messages}
          scrollOffset={scrollOffset}
          maxVisibleHeight={maxVisibleHeight}
          isActive={isActive}
          maxLines={performanceMode ? 8 : 12}
        />
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
            Arrows: Scroll | PgUp/Dn: Fast | p: Perf mode | m: Memory | Enter: Send
          </Text>
        </Box>
      )}
    </Box>
  );
} 