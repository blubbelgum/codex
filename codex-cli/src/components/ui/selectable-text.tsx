import { useClipboard } from '../../hooks/use-clipboard.js';
import { useTextSelection } from '../../hooks/use-text-selection.js';
import { Box, Text, useInput } from 'ink';
import React, { useEffect, useMemo, useState } from 'react';

interface SelectableTextProps {
  children: string;
  isActive?: boolean;
  highlightColor?: string;
  onCopy?: (text: string) => void;
  showCopyNotification?: boolean;
}

export function SelectableText({
  children,
  isActive = true,
  highlightColor = 'bgBlue',
  onCopy,
  showCopyNotification = true,
}: SelectableTextProps): React.ReactElement {
  const lines = useMemo(() => children.split('\n'), [children]);
  const { copyToClipboard, isSupported } = useClipboard();
  const [showNotification, setShowNotification] = useState(false);
  
  const { selection, cursorPosition } = useTextSelection({
    content: lines,
    isActive,
  });

  // Handle copy shortcut
  useInput((input, key) => {
    if (!isActive || !selection) {return;}

    // Ctrl+C or Cmd+C to copy
    if ((key.ctrl || key.meta) && input === 'c') {
      handleCopy();
    }
  }, { isActive });

  const handleCopy = async () => {
    if (!selection || !isSupported) {return;}

    await copyToClipboard(selection.text);
    onCopy?.(selection.text);
    
    if (showCopyNotification) {
      setShowNotification(true);
      setTimeout(() => setShowNotification(false), 2000);
    }
  };

  // Clear notification after timeout
  useEffect(() => {
    if (showNotification) {
      const timer = setTimeout(() => setShowNotification(false), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [showNotification]);

  const renderLine = (line: string, lineIndex: number) => {
    if (!selection || 
        lineIndex < selection.startLine || 
        lineIndex > selection.endLine) {
      return <Text key={lineIndex}>{line}</Text>;
    }

    // Line is part of selection
    const chars = line.split('');
    const elements: Array<React.ReactElement> = [];
    
    chars.forEach((char, charIndex) => {
      const isSelected = 
        (lineIndex === selection.startLine && lineIndex === selection.endLine && 
         charIndex >= selection.startColumn && charIndex < selection.endColumn) ||
        (lineIndex === selection.startLine && lineIndex !== selection.endLine && 
         charIndex >= selection.startColumn) ||
        (lineIndex === selection.endLine && lineIndex !== selection.startLine && 
         charIndex < selection.endColumn) ||
        (lineIndex > selection.startLine && lineIndex < selection.endLine);

      if (isSelected) {
        elements.push(
          <Text key={charIndex} backgroundColor={highlightColor}>
            {char}
          </Text>
        );
      } else {
        elements.push(<Text key={charIndex}>{char}</Text>);
      }
    });

    return <Text key={lineIndex}>{elements}</Text>;
  };

  const renderCursor = () => {
    const currentLine = lines[cursorPosition.line];
    if (!isActive || !currentLine) {return null;}

    const beforeCursor = currentLine.substring(0, cursorPosition.column);
    const atCursor = currentLine[cursorPosition.column] || ' ';
    
    return (
      <Box position="absolute" marginTop={cursorPosition.line}>
        <Text>
          {beforeCursor}
          <Text backgroundColor="yellow" color="black">{atCursor}</Text>
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" position="relative">
      {lines.map(renderLine)}
      {isActive && renderCursor()}
      
      {showNotification && (
        <Box position="absolute" marginTop={-1} marginLeft={2}>
          <Text color="green">✓ Copied to clipboard</Text>
        </Box>
      )}
      
      {isActive && selection && (
        <Box marginTop={1}>
          <Text dimColor>
            {isSupported ? 'Press Ctrl+C to copy selection' : 'Clipboard not supported'}
          </Text>
        </Box>
      )}
    </Box>
  );
} 