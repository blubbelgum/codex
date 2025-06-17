import { useClipboard } from '../../hooks/use-clipboard.js';
import fs from 'fs/promises';
import { Box, Text, useInput } from 'ink';
import path from 'path';
import React, { useState, useEffect, useMemo } from 'react';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isHidden: boolean;
  size?: number;
  mtime?: Date;
}

interface FileNavigatorProps {
  initialPath?: string;
  isActive?: boolean;
  height?: number;
  onFileSelect?: (filePath: string) => void;
  showHidden?: boolean;
}

export function FileNavigator({
  initialPath = process.cwd(),
  isActive = true,
  height = 20,
  onFileSelect,
  showHidden = false,
}: FileNavigatorProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<Array<FileItem>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHiddenFiles, setShowHiddenFiles] = useState(showHidden);
  // Search state: if true, filter files by searchQuery
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { copyToClipboard } = useClipboard();

  // Load directory contents
  const loadDirectory = async (dirPath: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const fileItems: Array<FileItem> = [];

      // Add parent directory entry if not at root
      if (dirPath !== '/') {
        fileItems.push({
          name: '..',
          path: path.dirname(dirPath),
          isDirectory: true,
          isHidden: false,
        });
      }

      // Process entries
      for (const entry of entries) {
        const itemPath = path.join(dirPath, entry.name);
        const isHidden = entry.name.startsWith('.');
        
        if (!showHiddenFiles && isHidden) {continue;}

        try {
          const stats = await fs.stat(itemPath);
          fileItems.push({
            name: entry.name,
            path: itemPath,
            isDirectory: entry.isDirectory(),
            isHidden,
            size: entry.isFile() ? stats.size : undefined,
            mtime: stats.mtime,
          });
        } catch (err) {
          // Skip files we can't stat (permission issues, etc.)
          continue;
        }
      }

      // Sort: directories first, then files, alphabetically
      fileItems.sort((a, b) => {
        if (a.name === '..') {return -1;}
        if (b.name === '..') {return 1;}
        if (a.isDirectory && !b.isDirectory) {return -1;}
        if (!a.isDirectory && b.isDirectory) {return 1;}
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      setFiles(fileItems);
      setSelectedIndex(0);
      setScrollOffset(0);
      setCurrentPath(dirPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  // Load initial directory
  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  // Handle keyboard input
  useInput((input, key) => {
    if (!isActive) {return;}
    // Handle search mode input
    if (isSearching) {
      if (key.return) {
        setIsSearching(false);
      } else if (key.escape) {
        setIsSearching(false);
        setSearchQuery('');
      } else if (key.backspace) {
        setSearchQuery(q => q.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setSearchQuery(q => q + input);
      }
      return;
    }

    const visibleHeight = height - 4; // Account for header, path, and footer

    if (key.upArrow) {
      setSelectedIndex(prev => {
        const newIndex = Math.max(0, prev - 1);
        // Adjust scroll if selection goes above visible area
        if (newIndex < scrollOffset) {
          setScrollOffset(newIndex);
        }
        return newIndex;
      });
    } else if (key.downArrow) {
      setSelectedIndex(prev => {
        const newIndex = Math.min(files.length - 1, prev + 1);
        // Adjust scroll if selection goes below visible area
        if (newIndex >= scrollOffset + visibleHeight) {
          setScrollOffset(newIndex - visibleHeight + 1);
        }
        return newIndex;
      });
    } else if (key.return) {
      const selectedFile = files[selectedIndex];
      if (selectedFile) {
        if (selectedFile.isDirectory) {
          loadDirectory(selectedFile.path);
        } else {
          onFileSelect?.(selectedFile.path);
        }
      }
    } else if (key.backspace || input === 'u') {
      // Go up one directory
      const parentPath = path.dirname(currentPath);
      if (parentPath !== currentPath) {
        loadDirectory(parentPath);
      }
    } else if (key.pageUp) {
      // Page up
      setSelectedIndex(prev => {
        const newIndex = Math.max(0, prev - visibleHeight);
        setScrollOffset(Math.max(0, newIndex - Math.floor(visibleHeight / 2)));
        return newIndex;
      });
    } else if (key.pageDown) {
      // Page down
      setSelectedIndex(prev => {
        const newIndex = Math.min(files.length - 1, prev + visibleHeight);
        const maxScroll = Math.max(0, files.length - visibleHeight);
        setScrollOffset(Math.min(maxScroll, newIndex - Math.floor(visibleHeight / 2)));
        return newIndex;
      });
    } else if (input === 'h') {
      // Toggle hidden files
      setShowHiddenFiles(!showHiddenFiles);
      loadDirectory(currentPath);
    } else if (input === 'r') {
      // Refresh current directory
      loadDirectory(currentPath);
    } else if (input === 'c' && files[selectedIndex]) {
      // Copy selected file path to clipboard
      copyToClipboard(files[selectedIndex].path);
          } else if (input === '~') {
        // Go to home directory
        const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '/';
        loadDirectory(homeDir);
    } else if (input === 's') {
      // Enter search mode
      setIsSearching(true);
      setSearchQuery('');
      return;
    } else if (input === '/') {
      // Go to root directory
      loadDirectory('/');
    }
  }, { isActive });

  // Ensure selected index is within bounds and adjust scroll
  useEffect(() => {
    if (selectedIndex >= files.length) {
      setSelectedIndex(Math.max(0, files.length - 1));
    }
    
    // Ensure scroll offset is valid
    const visibleHeight = height - 4;
    const maxScroll = Math.max(0, files.length - visibleHeight);
    if (scrollOffset > maxScroll) {
      setScrollOffset(maxScroll);
    }
  }, [files.length, selectedIndex, scrollOffset, height]);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) {return '';}
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)}${units[unitIndex]}`;
  };

  const formatDate = (date?: Date): string => {
    if (!date) {return '';}
    return date.toLocaleDateString();
  };

  const getFileIcon = (file: FileItem): string => {
    if (file.name === '..') {return '📁';}
    if (file.isDirectory) {return '📁';}
    
    const ext = path.extname(file.name).toLowerCase();
    switch (ext) {
      case '.js':
      case '.ts':
      case '.jsx':
      case '.tsx': return '📄';
      case '.json': return '📋';
      case '.md': return '📝';
      case '.txt': return '📄';
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.gif': return '🖼️';
      case '.pdf': return '📕';
      case '.zip':
      case '.tar':
      case '.gz': return '📦';
      default: return '📄';
    }
  };

  const getFileColor = (file: FileItem): string => {
    if (file.name === '..') {return 'blue';}
    if (file.isDirectory) {return 'blue';}
    if (file.isHidden) {return 'gray';}
    
    const ext = path.extname(file.name).toLowerCase();
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {return 'yellow';}
    if (['.json', '.yaml', '.yml'].includes(ext)) {return 'green';}
    if (['.md', '.txt'].includes(ext)) {return 'white';}
    
    return 'white';
  };

  const visibleFiles = useMemo(() => {
    return files.filter(file => showHiddenFiles || !file.isHidden || file.name === '..');
  }, [files, showHiddenFiles]);

  const visibleHeight = height - 4; // Account for header, path, and footer
  const displayFiles = visibleFiles.slice(scrollOffset, scrollOffset + visibleHeight);

  return (
    <Box flexDirection="column" height={height} borderStyle="round" borderColor="gray">
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color={isActive ? "cyan" : "gray"}>
          📂 {path.basename(currentPath) || currentPath} {!isActive && '(inactive)'}
        </Text>
        <Text dimColor>
          {visibleFiles.length} items
        </Text>
      </Box>

      {/* Current path */}
      <Box paddingX={1}>
        <Text dimColor>
          {currentPath.length > 50 ? '...' + currentPath.slice(-47) : currentPath}
        </Text>
      </Box>

      {/* File list */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {loading && (
          <Text color="yellow">Loading...</Text>
        )}
        
        {error && (
          <Text color="red">Error: {error}</Text>
        )}

        {!loading && !error && displayFiles.map((file, index) => {
          const actualIndex = scrollOffset + index;
          const isSelected = actualIndex === selectedIndex;
          const color = getFileColor(file);
          
          return (
            <Box key={file.path}>
              <Text 
                color={color} 
                backgroundColor={isSelected && isActive ? 'blue' : isSelected && !isActive ? 'gray' : undefined}
                dimColor={!isActive}
              >
                {getFileIcon(file)} {file.name}
              </Text>
              <Text dimColor>
                {file.isDirectory ? '' : ` ${formatFileSize(file.size)}`}
              </Text>
            </Box>
          );
        })}
        
        {!loading && !error && visibleFiles.length === 0 && (
          <Text dimColor>Directory is empty</Text>
        )}
      </Box>

      {/* Footer controls */}
      {isActive && (
        <Box paddingX={1} borderTop borderColor="gray">
          <Box flexDirection="row">
            <Text dimColor>
              ↑↓: navigate | PgUp/PgDn: page | Enter: open | u: up | h: hidden | r: refresh
            </Text>
            <Box flexGrow={1} />
            {visibleFiles.length > visibleHeight && (
              <Text dimColor>
                {scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, visibleFiles.length)}/{visibleFiles.length}
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
} 