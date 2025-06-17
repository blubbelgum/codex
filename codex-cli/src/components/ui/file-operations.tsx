import { useClipboard } from '../../hooks/use-clipboard.js';
import TextInput from '../vendor/ink-text-input';
import fs from 'fs/promises';
import { Box, Text, useInput } from 'ink';
import path from 'path';
import React, { useState } from 'react';

interface FileOperationsProps {
  currentPath: string;
  selectedFile?: string;
  onRefresh?: () => void;
  isActive?: boolean;
}

export function FileOperations({ currentPath, selectedFile, onRefresh, isActive = false }: FileOperationsProps) {
  const [mode, setMode] = useState<'idle' | 'create' | 'copy' | 'delete' | 'rename'>('idle');
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const { copyToClipboard } = useClipboard();

  const showStatus = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(''), 3000);
  };

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(''), 5000);
  };

  const resetMode = () => {
    setMode('idle');
    setInput('');
    setError('');
  };

  // Handle keyboard shortcuts
  useInput((input, key) => {
    if (!isActive) {return;}

    if (mode === 'idle') {
      if (input === 'n') {
        setMode('create');
        setInput('');
      } else if (input === 'c' && selectedFile) {
        setMode('copy');
        setInput(path.basename(selectedFile));
      } else if (input === 'd' && selectedFile) {
        setMode('delete');
      } else if (input === 'r' && selectedFile) {
        setMode('rename');
        setInput(path.basename(selectedFile));
      } else if (input === 'y' && selectedFile) {
        // Copy path to clipboard
        copyToClipboard(selectedFile);
        showStatus(`Copied path: ${selectedFile}`);
      }
    } else if (key.escape) {
      resetMode();
    } else if (key.return && mode === 'delete') {
      handleDelete();
    }
  }, { isActive });

  const handleCreate = async () => {
    if (!input.trim()) {
      showError('Please enter a filename');
      return;
    }

    try {
      const filePath = path.join(currentPath, input.trim());
      
      // Check if path already exists
      try {
        await fs.access(filePath);
        showError('File or directory already exists');
        return;
      } catch {
        // Good, file doesn't exist
      }

      // Create directory if name ends with / or is explicitly a directory
      if (input.trim().endsWith('/') || input.trim().includes('/')) {
        await fs.mkdir(filePath, { recursive: true });
        showStatus(`Created directory: ${input.trim()}`);
      } else {
        // Create file
        await fs.writeFile(filePath, '');
        showStatus(`Created file: ${input.trim()}`);
      }

      resetMode();
      onRefresh?.();
    } catch (err) {
      showError(`Failed to create: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleCopy = async () => {
    if (!selectedFile || !input.trim()) {
      showError('Please enter a new filename');
      return;
    }

    try {
      const newPath = path.join(currentPath, input.trim());
      
      // Check if destination already exists
      try {
        await fs.access(newPath);
        showError('Destination already exists');
        return;
      } catch {
        // Good, destination doesn't exist
      }

      const stats = await fs.stat(selectedFile);
      if (stats.isDirectory()) {
        // Copy directory recursively
        await copyDirectory(selectedFile, newPath);
        showStatus(`Copied directory: ${input.trim()}`);
      } else {
        // Copy file
        await fs.copyFile(selectedFile, newPath);
        showStatus(`Copied file: ${input.trim()}`);
      }

      resetMode();
      onRefresh?.();
    } catch (err) {
      showError(`Failed to copy: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async () => {
    if (!selectedFile) {return;}

    try {
      const stats = await fs.stat(selectedFile);
      if (stats.isDirectory()) {
        await fs.rm(selectedFile, { recursive: true, force: true });
        showStatus(`Deleted directory: ${path.basename(selectedFile)}`);
      } else {
        await fs.unlink(selectedFile);
        showStatus(`Deleted file: ${path.basename(selectedFile)}`);
      }

      resetMode();
      onRefresh?.();
    } catch (err) {
      showError(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleRename = async () => {
    if (!selectedFile || !input.trim()) {
      showError('Please enter a new filename');
      return;
    }

    try {
      const newPath = path.join(path.dirname(selectedFile), input.trim());
      
      if (newPath === selectedFile) {
        resetMode();
        return;
      }

      // Check if destination already exists
      try {
        await fs.access(newPath);
        showError('Destination already exists');
        return;
      } catch {
        // Good, destination doesn't exist
      }

      await fs.rename(selectedFile, newPath);
      showStatus(`Renamed to: ${input.trim()}`);

      resetMode();
      onRefresh?.();
    } catch (err) {
      showError(`Failed to rename: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Recursive directory copy helper
  const copyDirectory = async (src: string, dest: string) => {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  };

  const onSubmit = () => {
    switch (mode) {
      case 'create':
        handleCreate();
        break;
      case 'copy':
        handleCopy();
        break;
      case 'rename':
        handleRename();
        break;
    }
  };

  const getPrompt = (): string => {
    switch (mode) {
      case 'create':
        return 'Create (end with / for directory):';
      case 'copy':
        return 'Copy to:';
      case 'rename':
        return 'Rename to:';
      case 'delete':
        return `Delete "${path.basename(selectedFile || '')}"? Press Enter to confirm:`;
      default:
        return '';
    }
  };

  const getAvailableOperations = (): string => {
    const ops = ['n: new'];
    if (selectedFile) {
      ops.push('c: copy', 'd: delete', 'r: rename', 'y: copy path');
    }
    return ops.join(' | ');
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* Current status */}
      {status && (
        <Box marginBottom={1}>
          <Text color="green">✓ {status}</Text>
        </Box>
      )}

      {error && (
        <Box marginBottom={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      {/* Active operation */}
      {mode !== 'idle' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{getPrompt()}</Text>
          {mode !== 'delete' && (
            <Box>
              <Text>{'>'}</Text>
              <Box marginLeft={1} flexGrow={1}>
                <TextInput
                  value={input}
                  onChange={setInput}
                  onSubmit={onSubmit}
                  focus={isActive}
                />
              </Box>
            </Box>
          )}
          <Text color="gray" dimColor>
            {mode === 'delete' ? 'Enter: confirm | Esc: cancel' : 'Enter: submit | Esc: cancel'}
          </Text>
        </Box>
      )}

      {/* Help text */}
      {mode === 'idle' && isActive && (
        <Box>
          <Text color="cyan" dimColor>
            {getAvailableOperations()}
          </Text>
        </Box>
      )}

      {/* Selected file info */}
      {selectedFile && mode === 'idle' && (
        <Box marginTop={1}>
          <Text color="yellow">Selected: {path.basename(selectedFile)}</Text>
        </Box>
      )}
    </Box>
  );
} 