import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTerminalSize } from '../hooks/use-terminal-size.js';
import { MultiPaneLayout, createHorizontalLayout, createPane } from './ui/multi-pane-layout.js';
import { FileNavigator } from './ui/file-navigator.js';
import { TaskPanel } from './ui/task-panel.js';
import { InteractiveChatPane } from './ui/interactive-chat-pane.js';
import { FilePreview } from './ui/file-preview.js';
import { TaskManager, TaskStatus, TaskPriority, taskManager } from '../utils/task-manager.js';
import type { AppConfig } from "../utils/config.js";
import type { ApprovalPolicy } from "../approvals.js";

interface EnhancedTerminalChatProps {
  config: AppConfig;
  prompt: string;
  imagePaths?: string[];
  approvalPolicy: ApprovalPolicy;
  additionalWritableRoots?: string[];
  fullStdout?: boolean;
}

export function EnhancedTerminalChat({ initialPrompt }: { initialPrompt?: string }) {
  const [activePane, setActivePane] = useState('chat');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { columns: width, rows: height } = useTerminalSize();

  // Initialize demo tasks
  useEffect(() => {
    const existingTasks = taskManager.getAllTasks();
    if (existingTasks.length === 0) {
      taskManager.createTask({
        title: 'Test enhanced UI',
        description: 'Testing the new interactive chat with mock agent and file preview',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        tags: ['test', 'ui'],
        dependencies: [],
        progress: 75,
      });

      taskManager.createTask({
        title: 'File preview integration',
        description: 'Add file preview pane with syntax highlighting',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        tags: ['feature', 'preview'],
        dependencies: [],
      });

      taskManager.createTask({
        title: 'Enhanced scrolling',
        description: 'Implement proper scrolling for long chat messages and file content',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.MEDIUM,
        tags: ['feature', 'scroll'],
        dependencies: [],
      });

      taskManager.createTask({
        title: 'File operations',
        description: 'Add basic file operations like create, copy, delete',
        status: TaskStatus.PENDING,
        priority: TaskPriority.LOW,
        tags: ['feature', 'files'],
        dependencies: [],
      });
    }
  }, []);

  // Handle global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'r') {
      // Reset to default state
      setActivePane('chat');
      setSelectedFile(null);
    } else if (key.escape) {
      process.exit(0);
    } else if (key.ctrl && input === 'p') {
      // Quick toggle to file preview
      setActivePane('preview');
    } else if (key.ctrl && input === 'f') {
      // Quick toggle to file navigator
      setActivePane('files');
    } else if (key.ctrl && input === 't') {
      // Quick toggle to tasks
      setActivePane('tasks');
    }
  });

  // Create layout with 4 panes
  const layout = createHorizontalLayout([
    createPane('files', 'Files', 
      <FileNavigator 
        onFileSelect={setSelectedFile}
        isActive={activePane === 'files'}
        height={height - 4}
      />, 
      { minWidth: 15 }
    ),
    createPane('preview', 'Preview', 
      <FilePreview
        filePath={selectedFile}
        isActive={activePane === 'preview'}
        height={height - 4}
        width={Math.floor(width * 0.3)}
      />, 
      { minWidth: 20 }
    ),
    createPane('chat', 'Chat', 
      <InteractiveChatPane
        isActive={activePane === 'chat'}
        height={height - 4}
        width={Math.floor(width * 0.4)}
      />, 
      { minWidth: 30 }
    ),
    createPane('tasks', 'Tasks', 
      <TaskPanel
        onTaskSelect={(task) => setSelectedTask(task?.id || null)}
        isActive={activePane === 'tasks'}
        height={height - 4}
      />, 
      { minWidth: 15 }
    ),
  ]);

  const getFileBaseName = (filePath: string | null): string => {
    if (!filePath) return 'No file';
    return filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
  };

  return (
    <Box flexDirection="column" height={height} width={width}>
      {/* Global header */}
      <Box borderStyle="single" paddingX={2}>
        <Text color="cyan" bold>Enhanced Terminal UI - Phase 1</Text>
        <Box flexGrow={1} />
        <Text color="gray" dimColor>
          Tab: Switch | Ctrl+F: Files | Ctrl+P: Preview | Ctrl+T: Tasks | Esc: Exit
        </Text>
      </Box>

      {/* Main content */}
      <Box flexGrow={1}>
        <MultiPaneLayout
          layout={layout}
          isActive={true}
          activePaneId={activePane}
          onPaneChange={setActivePane}
        />
      </Box>

      {/* Status bar */}
      <Box borderStyle="single" paddingX={2}>
        <Text>
          {taskManager.getReadyTasks().length} ready tasks | 
          File: {getFileBaseName(selectedFile)} | 
          Active: {activePane}
        </Text>
        <Box flexGrow={1} />
        <Text color="green" dimColor>
          Mock AI + File Preview Ready
        </Text>
      </Box>
    </Box>
  );
} 