import { memoryManager } from '../../utils/memory-manager.js';
import fs from 'fs/promises';
import { Box, Text, useInput } from 'ink';
import path from 'path';
import React, { useState, useEffect } from 'react';

interface FilePreviewProps {
  filePath: string | null;
  isActive?: boolean;
  height?: number;
  width?: number;
  fullPreview?: boolean;
  onToggleFullPreview?: () => void;
}

interface FileInfo {
  name: string;
  size: number;
  extension: string;
  modified: Date;
  content: string;
  isText: boolean;
  lines: number;
  gitStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | null;
}

interface SearchState {
  query: string;
  results: Array<number>;
  currentIndex: number;
  isActive: boolean;
}

export function FilePreview({ 
  filePath, 
  isActive = false, 
  height = 20, 
  width = 80, 
  fullPreview = false,
  onToggleFullPreview 
}: FilePreviewProps) {
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [cacheStats, setCacheStats] = useState<{ hit: boolean; totalFiles: number }>({ hit: false, totalFiles: 0 });
  const [zoomLevel, setZoomLevel] = useState(0); // -2 to +2
  const [wordWrap, setWordWrap] = useState(false);
  const [search, setSearch] = useState<SearchState>({
    query: '',
    results: [],
    currentIndex: -1,
    isActive: false
  });
  const [gotoLineMode, setGotoLineMode] = useState(false);
  const [gotoLineInput, setGotoLineInput] = useState('');

  // Load file content with caching
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
      // Check cache first
      const cached = memoryManager.getCachedFile(filepath);
      const stats = memoryManager.getStats();
      
      if (cached) {
        const name = path.basename(filepath);
        const extension = path.extname(filepath).toLowerCase();
        const gitStatus = await getGitStatus(filepath);
        
        setFileInfo({
          name,
          size: cached.size,
          extension,
          modified: new Date(), // We don't cache modification time
          content: cached.content,
          isText: cached.isText,
          lines: cached.lines,
          gitStatus,
        });
        
        setCacheStats({ hit: true, totalFiles: stats.fileCache.size });
        setLoading(false);
        return;
      }

      // Load from disk if not cached
      const statInfo = await fs.stat(filepath);
      const name = path.basename(filepath);
      const extension = path.extname(filepath).toLowerCase();
      const gitStatus = await getGitStatus(filepath);
      
      // Check if file is likely to be text
      const textExtensions = [
        '.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.xml', '.html', 
        '.css', '.scss', '.less', '.py', '.rb', '.go', '.rs', '.java', '.cpp', 
        '.c', '.h', '.hpp', '.cs', '.php', '.sh', '.bash', '.zsh', '.yaml', '.yml',
        '.toml', '.ini', '.conf', '.config', '.env', '.gitignore', '.dockerfile',
        '.sql', '.graphql', '.svelte', '.vue', '.asm', '.s'
      ];
      
      const isText = textExtensions.includes(extension) || !extension;
      
      if (!isText || statInfo.size > 500000) { // 500KB limit for safety
        const fileData = {
          name,
          size: statInfo.size,
          extension,
          modified: statInfo.mtime,
          content: '',
          isText: false,
          lines: 0,
          gitStatus,
        };
        
        // Cache binary file info
        memoryManager.cacheFile(filepath, {
          content: '',
          size: statInfo.size,
          lines: 0,
          isText: false
        });
        
        setFileInfo(fileData);
        setCacheStats({ hit: false, totalFiles: stats.fileCache.size + 1 });
        return;
      }

      let content = await fs.readFile(filepath, 'utf-8');
      
      // Limit content length and truncate very long lines for performance
      const lines = content.split('\n');
      const processedLines = lines.slice(0, 2000).map(line => {
        // Don't truncate lines in full preview mode for better code viewing
        if (!fullPreview && line.length > 120) {
          return line.slice(0, 117) + '...';
        }
        return line;
      });
      
      if (lines.length > 2000) {
        processedLines.push('... (file truncated, showing first 2000 lines)');
      }
      
      content = processedLines.join('\n');

      const fileData = {
        name,
        size: statInfo.size,
        extension,
        modified: statInfo.mtime,
        content,
        isText: true,
        lines: processedLines.length,
        gitStatus,
      };

      // Cache the file data
      memoryManager.cacheFile(filepath, {
        content,
        size: statInfo.size,
        lines: processedLines.length,
        isText: true
      });

      setFileInfo(fileData);
      setCacheStats({ hit: false, totalFiles: memoryManager.getStats().fileCache.size + 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setCacheStats({ hit: false, totalFiles: memoryManager.getStats().fileCache.size });
    } finally {
      setLoading(false);
    }
  };

  // Get git status for file
  const getGitStatus = async (_filepath: string): Promise<'modified' | 'added' | 'deleted' | 'untracked' | null> => {
    try {
      // This is a simplified git status check - in a real implementation you'd use a git library
      // For now, we'll just return null to avoid shell dependencies
      return null;
    } catch {
      return null;
    }
  };

  // Search functionality
  const performSearch = (query: string) => {
    if (!fileInfo || !query) {
      setSearch(prev => ({ ...prev, results: [], currentIndex: -1 }));
      return;
    }

    const lines = fileInfo.content.split('\n');
    const results: Array<number> = [];
    
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        results.push(index);
      }
    });

    setSearch(prev => ({
      ...prev,
      results,
      currentIndex: results.length > 0 ? 0 : -1
    }));

    // Jump to first result
    if (results.length > 0 && results[0] !== undefined) {
      setScrollOffset(Math.max(0, results[0] - Math.floor(height / 2)));
    }
  };

  // Navigate search results
  const nextSearchResult = () => {
    if (search.results.length === 0) {return;}
    const nextIndex = (search.currentIndex + 1) % search.results.length;
    setSearch(prev => ({ ...prev, currentIndex: nextIndex }));
    const targetLine = search.results[nextIndex];
    if (targetLine !== undefined) {
      setScrollOffset(Math.max(0, targetLine - Math.floor(height / 2)));
    }
  };

  const prevSearchResult = () => {
    if (search.results.length === 0) {return;}
    const prevIndex = search.currentIndex === 0 ? search.results.length - 1 : search.currentIndex - 1;
    setSearch(prev => ({ ...prev, currentIndex: prevIndex }));
    const targetLine = search.results[prevIndex];
    if (targetLine !== undefined) {
      setScrollOffset(Math.max(0, targetLine - Math.floor(height / 2)));
    }
  };

  // Go to line functionality
  const goToLine = (lineNumber: number) => {
    if (!fileInfo) {return;}
    const targetLine = Math.max(1, Math.min(lineNumber, fileInfo.lines)) - 1;
    setScrollOffset(Math.max(0, targetLine - Math.floor(height / 2)));
    setGotoLineMode(false);
    setGotoLineInput('');
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (!isActive || !fileInfo) {return;}

    // Handle goto line mode
    if (gotoLineMode) {
      if (key.return) {
        const lineNum = parseInt(gotoLineInput);
        if (!isNaN(lineNum)) {
          goToLine(lineNum);
        } else {
          setGotoLineMode(false);
          setGotoLineInput('');
        }
      } else if (key.escape) {
        setGotoLineMode(false);
        setGotoLineInput('');
      } else if (key.backspace) {
        setGotoLineInput(prev => prev.slice(0, -1));
      } else if (input && /[0-9]/.test(input)) {
        setGotoLineInput(prev => prev + input);
      }
      return;
    }

    // Handle search mode
    if (search.isActive) {
      if (key.return) {
        performSearch(search.query);
        setSearch(prev => ({ ...prev, isActive: false }));
      } else if (key.escape) {
        setSearch({ query: '', results: [], currentIndex: -1, isActive: false });
      } else if (key.backspace) {
        const newQuery = search.query.slice(0, -1);
        setSearch(prev => ({ ...prev, query: newQuery }));
        if (newQuery) {performSearch(newQuery);}
      } else if (input && input.length === 1) {
        const newQuery = search.query + input;
        setSearch(prev => ({ ...prev, query: newQuery }));
        performSearch(newQuery);
      }
      return;
    }

    // Regular navigation and commands
    if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      const maxScroll = Math.max(0, fileInfo.lines - (height - 6));
      setScrollOffset(prev => Math.min(maxScroll, prev + 1));
    } else if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - 10));
    } else if (key.pageDown) {
      const maxScroll = Math.max(0, fileInfo.lines - (height - 6));
      setScrollOffset(prev => Math.min(maxScroll, prev + 10));
    } else if (key.ctrl && input === 'f') {
      // Start search
      setSearch(prev => ({ ...prev, isActive: true, query: '' }));
    } else if (input === 'n' && search.results.length > 0) {
      // Next search result
      nextSearchResult();
    } else if (input === 'N' && search.results.length > 0) {
      // Previous search result
      prevSearchResult();
    } else if (input === 'g') {
      // Go to line
      setGotoLineMode(true);
      setGotoLineInput('');
    } else if (input === 'l') {
      setShowLineNumbers(!showLineNumbers);
    } else if (input === 'w') {
      setWordWrap(!wordWrap);
    } else if (input === '+' || input === '=') {
      setZoomLevel(prev => Math.min(2, prev + 1));
    } else if (input === '-') {
      setZoomLevel(prev => Math.max(-2, prev - 1));
    } else if (input === '0') {
      setZoomLevel(0);
    } else if (input === 'f' && onToggleFullPreview) {
      // Toggle full preview mode
      onToggleFullPreview();
    } else if (input === 'r') {
      // Force reload (bypass cache)
      if (filePath) {
        memoryManager.invalidateFile(filePath);
        loadFile(filePath);
      }
    } else if (input === 'c') {
      // Clear all caches
      memoryManager.clearCaches();
      setCacheStats({ hit: false, totalFiles: 0 });
    }
  }, { isActive });

  // Apply syntax highlighting
  const applySyntaxHighlighting = (line: string, extension: string): React.ReactNode => {
    // Basic syntax highlighting for common file types
    if (!extension) {return line;}

    switch (extension) {
      case '.js':
      case '.ts':
      case '.jsx':
      case '.tsx':
        return highlightJavaScript(line);
      case '.json':
        return highlightJSON(line);
      case '.md':
        return highlightMarkdown(line);
      case '.css':
      case '.scss':
        return highlightCSS(line);
      default:
        return line;
    }
  };

  // Basic JavaScript/TypeScript highlighting
  const highlightJavaScript = (line: string): React.ReactNode => {
    const keywords = ['const', 'let', 'var', 'function', 'class', 'if', 'else', 'for', 'while', 'return', 'import', 'export', 'from', 'async', 'await'];
    const parts = line.split(/(\s+)/);
    
    return parts.map((part, index) => {
      if (keywords.includes(part)) {
        return <Text key={index} color="blue">{part}</Text>;
      } else if (part.startsWith('//')) {
        return <Text key={index} color="gray">{part}</Text>;
      } else if (part.match(/^["'`]/)) {
        return <Text key={index} color="green">{part}</Text>;
      } else if (part.match(/^\d+$/)) {
        return <Text key={index} color="yellow">{part}</Text>;
      }
      return <Text key={index}>{part}</Text>;
    });
  };

  // Basic JSON highlighting
  const highlightJSON = (line: string): React.ReactNode => {
    if (line.trim().startsWith('"') && line.includes(':')) {
      const [key, ...rest] = line.split(':');
      return (
        <>
          <Text color="cyan">{key}:</Text>
          <Text>{rest.join(':')}</Text>
        </>
      );
    }
    return line;
  };

  // Improved Markdown highlighting with error handling
  const highlightMarkdown = (line: string): React.ReactNode => {
    try {
      // Handle headers
      if (line.startsWith('#')) {
        const _level = line.match(/^#+/)?.[0].length || 1;
        const headerText = line.replace(/^#+\s*/, '');
        return <Text color="blue" bold>{headerText}</Text>;
      }
      
      // Handle code blocks
      if (line.startsWith('```')) {
        return <Text color="gray">{line}</Text>;
      }
      
      // Handle inline code
      if (line.includes('`') && line.match(/`[^`]+`/)) {
        const parts = line.split(/(`[^`]+`)/);
        return parts.map((part, index) => 
          part.startsWith('`') && part.endsWith('`') ? 
            <Text key={index} color="cyan" backgroundColor="gray">{part}</Text> : 
            <Text key={index}>{part}</Text>
        );
      }
      
      // Handle bold text more safely
      if (line.includes('**')) {
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        return parts.map((part, index) => 
          part.startsWith('**') && part.endsWith('**') ? 
            <Text key={index} bold>{part.slice(2, -2)}</Text> : 
            <Text key={index}>{part}</Text>
        );
      }
      
      // Handle links
      if (line.includes('](')) {
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const parts = line.split(linkRegex);
        const result = [];
        for (let i = 0; i < parts.length; i += 3) {
          if (parts[i]) {result.push(<Text key={i}>{parts[i]}</Text>);}
          if (parts[i + 1]) {result.push(<Text key={i + 1} color="magenta">{parts[i + 1]}</Text>);}
        }
        return result.length > 0 ? result : line;
      }
      
      return line;
    } catch (error) {
      // Fallback to plain text if highlighting fails
      return line;
    }
  };

  // Basic CSS highlighting
  const highlightCSS = (line: string): React.ReactNode => {
    if (line.includes('{') || line.includes('}')) {
      return <Text color="yellow">{line}</Text>;
    } else if (line.includes(':') && !line.startsWith('/*')) {
      const [property, ...rest] = line.split(':');
      return (
        <>
          <Text color="cyan">{property}:</Text>
          <Text>{rest.join(':')}</Text>
        </>
      );
    }
    return line;
  };

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

  const getGitStatusColor = (status: string | null): string => {
    switch (status) {
      case 'modified': return 'yellow';
      case 'added': return 'green';
      case 'deleted': return 'red';
      case 'untracked': return 'gray';
      default: return 'white';
    }
  };

  // Calculate effective font size based on zoom
  const _getEffectiveFontSize = (): string => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl'];
    const baseIndex = 2; // 'md'
    const effectiveIndex = Math.max(0, Math.min(sizes.length - 1, baseIndex + zoomLevel));
    return sizes[effectiveIndex] || 'md';
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
      <Box flexDirection="column" height={height} width={width} borderStyle="round" borderColor="gray">
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
  const visibleHeight = height - (fullPreview ? 4 : 3); // More space in full preview
  const visibleLines = lines.slice(scrollOffset, scrollOffset + visibleHeight);
  const maxLineNumberWidth = Math.max(3, String(fileInfo.lines).length);

  return (
    <Box flexDirection="column" height={height} width={width} borderStyle="round" borderColor="gray">
      {/* Enhanced Header with breadcrumbs and git status */}
      <Box paddingX={1} flexDirection="row" width={width}>
        <Box flexShrink={1}>
          {fullPreview && filePath && (
            <Text color="gray" dimColor>
              {path.dirname(filePath).split(path.sep).slice(-2).join(path.sep)}/
            </Text>
          )}
          <Text bold color={getFileTypeColor(fileInfo.extension || '')}>
            {fileInfo.name.length > width - 30 ? fileInfo.name.slice(0, width - 33) + '...' : fileInfo.name}
          </Text>
          {fileInfo.gitStatus && (
            <Text color={getGitStatusColor(fileInfo.gitStatus)} dimColor> [{fileInfo.gitStatus}]</Text>
          )}
        </Box>
        <Box flexGrow={1} />
        <Text color={cacheStats.hit ? 'green' : 'gray'} dimColor>
          {cacheStats.hit ? '●' : '○'} {formatFileSize(fileInfo.size)}
        </Text>
        {zoomLevel !== 0 && (
          <Text color="yellow" dimColor> {zoomLevel > 0 ? '+' : ''}{zoomLevel}</Text>
        )}
      </Box>

      {/* Search bar */}
      {search.isActive && (
        <Box paddingX={1}>
          <Text color="yellow">Search: {search.query}</Text>
          {search.results.length > 0 && (
            <Text color="gray" dimColor> ({search.currentIndex + 1}/{search.results.length})</Text>
          )}
        </Box>
      )}

      {/* Goto line bar */}
      {gotoLineMode && (
        <Box paddingX={1}>
          <Text color="cyan">Go to line: {gotoLineInput}</Text>
        </Box>
      )}

      {/* Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleLines.map((line, index) => {
          const lineNumber = scrollOffset + index + 1;
          const lineNumberText = showLineNumbers ? String(lineNumber).padStart(maxLineNumberWidth, ' ') : '';
          const lineNumberWidth = showLineNumbers ? maxLineNumberWidth + 1 : 0;
          const availableWidth = Math.max(10, width - 4 - lineNumberWidth);
          
          // Handle word wrap or truncation
          let displayLine = line;
          if (!wordWrap && line.length > availableWidth) {
            displayLine = line.slice(0, availableWidth - 3) + '...';
          }
          
          // Check if this line is a search result
          const isSearchResult = search.results.includes(scrollOffset + index);
          const isCurrentSearchResult = search.currentIndex >= 0 && search.results[search.currentIndex] === scrollOffset + index;
          
          return (
            <Box key={lineNumber} flexDirection="row" width={width - 2}>
              {showLineNumbers && (
                <Text color="gray" dimColor>
                  {lineNumberText}
                </Text>
              )}
              {showLineNumbers && <Text color="gray" dimColor> </Text>}
              <Box flexShrink={1} width={availableWidth}>
                <Text backgroundColor={isCurrentSearchResult ? 'yellow' : isSearchResult ? 'blue' : undefined}>
                  {fileInfo.extension && !wordWrap ? 
                    applySyntaxHighlighting(displayLine, fileInfo.extension) : 
                    displayLine || ' '
                  }
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Enhanced Help text with more features */}
      {isActive && (
        <Box paddingX={1} flexDirection="row" width={width}>
          <Box flexShrink={1}>
            <Text color="gray" dimColor>
              {fullPreview ? 
                'Ctrl+F: search | g: goto | f: exit full | +/-: zoom | w: wrap' :
                '↑↓: scroll | f: full | Ctrl+F: search | g: goto | +/-: zoom'
              }
            </Text>
          </Box>
          <Box flexGrow={1} />
          {fileInfo.lines > visibleHeight && (
            <Text color="gray" dimColor>
              {scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, fileInfo.lines)}/{fileInfo.lines}
              {search.results.length > 0 && ` | ${search.results.length} matches`}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
} 