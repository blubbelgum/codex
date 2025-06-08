import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import fs from 'fs/promises';
import path from 'path';
import { useClipboard } from '../../hooks/use-clipboard.js';

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
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHiddenFiles, setShowHiddenFiles] = useState(showHidden);
  const { copyToClipboard } = useClipboard();

  // Load directory contents
  const loadDirectory = async (dirPath: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const fileItems: FileItem[] = [];

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
        
        if (!showHiddenFiles && isHidden) continue;

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
        if (a.name === '..') return -1;
        if (b.name === '..') return 1;
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      setFiles(fileItems);
      setSelectedIndex(0);
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
    if (!isActive) return;

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(files.length - 1, prev + 1));
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
    } else if (input === '/') {
      // Go to root directory
      loadDirectory('/');
    }
  }, { isActive });

  // Ensure selected index is within bounds
  useEffect(() => {
    if (selectedIndex >= files.length) {
      setSelectedIndex(Math.max(0, files.length - 1));
    }
  }, [files.length, selectedIndex]);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
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
    if (!date) return '';
    return date.toLocaleDateString();
  };

  const getFileIcon = (file: FileItem): string => {
    if (file.name === '..') return '📁';
    if (file.isDirectory) return '📁';
    
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
    if (file.name === '..') return 'blue';
    if (file.isDirectory) return 'blue';
    if (file.isHidden) return 'gray';
    
    const ext = path.extname(file.name).toLowerCase();
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) return 'yellow';
    if (['.json', '.yaml', '.yml'].includes(ext)) return 'green';
    if (['.md', '.txt'].includes(ext)) return 'white';
    
    return 'white';
  };

  const visibleFiles = useMemo(() => {
    return files.filter(file => showHiddenFiles || !file.isHidden || file.name === '..');
  }, [files, showHiddenFiles]);

  const displayFiles = visibleFiles.slice(0, height - 4);

  return (
    <Box flexDirection="column" height={height} borderStyle="round" borderColor="gray">
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="cyan">
          📂 {path.basename(currentPath) || currentPath}
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
          const isSelected = index === selectedIndex;
          const color = getFileColor(file);
          
                     return (
             <Box key={file.path}>
               <Text color={color} backgroundColor={isSelected ? 'blue' : undefined}>
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
          <Text dimColor>
            ↑↓: navigate | Enter: open | u: up | h: hidden | r: refresh | c: copy path | ~: home
          </Text>
        </Box>
      )}
    </Box>
  );
} 