import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import fs from 'fs/promises';
import path from 'path';

interface FilePreviewProps {
  filePath: string | null;
  isActive?: boolean;
  height?: number;
  width?: number;
}

interface FileInfo {
  name: string;
  size: number;
  extension: string;
  modified: Date;
  content: string;
  isText: boolean;
  lines: number;
}

export function FilePreview({ filePath, isActive = false, height = 20, width = 80 }: FilePreviewProps) {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  // Load file content
  useEffect(() => {
    if (!filePath) {
      setFileInfo(null);
      setError(null);
      return;
    }

    loadFile(filePath);
  }, [filePath]);

  const loadFile = async (filepath: string) => {
    setLoading(true);
    setError(null);
    setScrollOffset(0);

    try {
      const stats = await fs.stat(filepath);
      const name = path.basename(filepath);
      const extension = path.extname(filepath).toLowerCase();
      
      // Check if file is likely to be text
      const textExtensions = [
        '.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.xml', '.html', 
        '.css', '.scss', '.less', '.py', '.rb', '.go', '.rs', '.java', '.cpp', 
        '.c', '.h', '.hpp', '.cs', '.php', '.sh', '.bash', '.zsh', '.yaml', '.yml',
        '.toml', '.ini', '.conf', '.config', '.env', '.gitignore', '.dockerfile',
        '.sql', '.graphql', '.svelte', '.vue', '.asm', '.s'
      ];
      
      const isText = textExtensions.includes(extension) || !extension;
      
      if (!isText || stats.size > 500000) { // 500KB limit for safety
        setFileInfo({
          name,
          size: stats.size,
          extension,
          modified: stats.mtime,
          content: '',
          isText: false,
          lines: 0,
        });
        return;
      }

      let content = await fs.readFile(filepath, 'utf-8');
      
      // Limit content length and truncate very long lines for performance
      const lines = content.split('\n');
      const processedLines = lines.slice(0, 1000).map(line => {
        // Truncate very long lines to prevent layout issues
        if (line.length > 120) {
          return line.slice(0, 117) + '...';
        }
        return line;
      });
      
      if (lines.length > 1000) {
        processedLines.push('... (file truncated, showing first 1000 lines)');
      }
      
      content = processedLines.join('\n');

      setFileInfo({
        name,
        size: stats.size,
        extension,
        modified: stats.mtime,
        content,
        isText: true,
        lines: processedLines.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  // Handle keyboard input for scrolling
  useInput((input, key) => {
    if (!isActive || !fileInfo) return;

    if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      const maxScroll = Math.max(0, fileInfo.lines - (height - 6));
      setScrollOffset(prev => Math.min(maxScroll, prev + 1));
    } else if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - 5));
    } else if (key.pageDown) {
      const maxScroll = Math.max(0, fileInfo.lines - (height - 6));
      setScrollOffset(prev => Math.min(maxScroll, prev + 5));
    } else if (input === 'l') {
      setShowLineNumbers(!showLineNumbers);
    } else if (input === 'r') {
      if (filePath) loadFile(filePath);
    }
  }, { isActive });

  const formatFileSize = (bytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)}${units[unitIndex]}`;
  };

  const getFileTypeColor = (extension: string): string => {
    switch (extension) {
      case '.js':
      case '.ts':
      case '.jsx':
      case '.tsx':
        return 'yellow';
      case '.json':
        return 'green';
      case '.md':
        return 'blue';
      case '.py':
        return 'magenta';
      case '.css':
      case '.scss':
        return 'cyan';
      default:
        return 'white';
    }
  };

  if (!filePath) {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color="gray" dimColor>Select a file to preview</Text>
        </Box>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color="yellow">Loading...</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color="red">Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  if (!fileInfo) {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color="gray" dimColor>No file info</Text>
        </Box>
      </Box>
    );
  }

  if (!fileInfo.isText) {
    return (
      <Box flexDirection="column" height={height} width={width}>
        <Box padding={1}>
          <Text bold>{fileInfo.name}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
          <Text color="yellow">Binary file</Text>
          <Text color="gray">{formatFileSize(fileInfo.size)}</Text>
          <Text color="gray">{fileInfo.extension || 'no extension'}</Text>
        </Box>
      </Box>
    );
  }

  const lines = fileInfo.content.split('\n');
  const visibleHeight = height - 3; // Account for header and help
  const visibleLines = lines.slice(scrollOffset, scrollOffset + visibleHeight);
  const maxLineNumberWidth = Math.max(3, String(fileInfo.lines).length);

  return (
    <Box flexDirection="column" height={height} width={width}>
      {/* Header */}
      <Box paddingX={1}>
        <Text bold color={getFileTypeColor(fileInfo.extension)}>
          {fileInfo.name}
        </Text>
        <Box flexGrow={1} />
        <Text color="gray" dimColor>
          {formatFileSize(fileInfo.size)}
        </Text>
      </Box>

      {/* Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleLines.map((line, index) => {
          const lineNumber = scrollOffset + index + 1;
          
          return (
            <Box key={lineNumber} width={width - 2}>
              {showLineNumbers && (
                <Text color="gray" dimColor>
                  {String(lineNumber).padStart(maxLineNumberWidth, ' ')}
                </Text>
              )}
              <Box marginLeft={showLineNumbers ? 1 : 0}>
                <Text>
                  {line || ' '}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Help text */}
      {isActive && (
        <Box paddingX={1}>
          <Text color="gray" dimColor>
            ↑↓: scroll | l: line nums | r: reload
          </Text>
          <Box flexGrow={1} />
          {fileInfo.lines > visibleHeight && (
            <Text color="gray" dimColor>
              {scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, fileInfo.lines)}/{fileInfo.lines}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
} 