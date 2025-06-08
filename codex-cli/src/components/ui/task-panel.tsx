import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { 
  TaskManager, 
  Task, 
  TaskStatus, 
  TaskPriority, 
  TaskFilter,
  taskManager 
} from '../../utils/task-manager.js';

interface TaskPanelProps {
  isActive?: boolean;
  height?: number;
  onTaskSelect?: (task: Task | null) => void;
}

export function TaskPanel({ isActive = true, height = 20, onTaskSelect }: TaskPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState<TaskFilter>({});
  const [showCompleted, setShowCompleted] = useState(false);
  const [sortBy, setSortBy] = useState<'created' | 'priority' | 'dueDate'>('created');

  // Subscribe to task updates
  useEffect(() => {
    const unsubscribe = taskManager.subscribe(setTasks);
    setTasks(taskManager.getAllTasks());
    return unsubscribe;
  }, []);

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let filtered = taskManager.filterTasks({
      ...filter,
      status: showCompleted ? undefined : [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
    });

    // Sort tasks
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        case 'dueDate':
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.getTime() - b.dueDate.getTime();
        case 'created':
        default:
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });

    return filtered;
  }, [tasks, filter, showCompleted, sortBy]);

  // Handle keyboard input
  useInput((input, key) => {
    if (!isActive) return;

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filteredTasks.length - 1, prev + 1));
    } else if (key.return) {
      const selectedTask = filteredTasks[selectedIndex];
      if (selectedTask) {
        onTaskSelect?.(selectedTask);
      }
    } else if (input === 'c') {
      setShowCompleted(!showCompleted);
    } else if (input === 's') {
              const sortOptions: Array<'created' | 'priority' | 'dueDate'> = ['created', 'priority', 'dueDate'];
        const currentIndex = sortOptions.indexOf(sortBy);
        const nextSort = sortOptions[(currentIndex + 1) % sortOptions.length];
        setSortBy(nextSort);
    } else if (input === 'n') {
      // Create new task (implement in parent component)
      onTaskSelect?.(null);
    } else if (key.delete && filteredTasks[selectedIndex]) {
      taskManager.deleteTask(filteredTasks[selectedIndex].id);
    } else if (input === ' ' && filteredTasks[selectedIndex]) {
      // Toggle task status
      const task = filteredTasks[selectedIndex];
      const newStatus = task.status === TaskStatus.COMPLETED 
        ? TaskStatus.PENDING 
        : TaskStatus.COMPLETED;
      taskManager.updateTask(task.id, { status: newStatus });
    }
  }, { isActive });

  // Ensure selected index is within bounds
  useEffect(() => {
    if (selectedIndex >= filteredTasks.length) {
      setSelectedIndex(Math.max(0, filteredTasks.length - 1));
    }
  }, [filteredTasks.length, selectedIndex]);

  const getTaskColor = (task: Task): string => {
    if (task.status === TaskStatus.COMPLETED) return 'green';
    if (task.status === TaskStatus.FAILED) return 'red';
    if (task.status === TaskStatus.CANCELLED) return 'gray';
    if (task.dueDate && task.dueDate < new Date()) return 'yellow';
    
    switch (task.priority) {
      case TaskPriority.URGENT: return 'magenta';
      case TaskPriority.HIGH: return 'red';
      case TaskPriority.MEDIUM: return 'yellow';
      case TaskPriority.LOW: return 'dim';
      default: return 'white';
    }
  };

  const getStatusIcon = (status: TaskStatus): string => {
    switch (status) {
      case TaskStatus.PENDING: return '○';
      case TaskStatus.IN_PROGRESS: return '◐';
      case TaskStatus.COMPLETED: return '●';
      case TaskStatus.FAILED: return '✗';
      case TaskStatus.CANCELLED: return '⊘';
      default: return '○';
    }
  };

  const getPriorityIcon = (priority: TaskPriority): string => {
    switch (priority) {
      case TaskPriority.URGENT: return '🔴';
      case TaskPriority.HIGH: return '🟡';
      case TaskPriority.MEDIUM: return '🔵';
      case TaskPriority.LOW: return '⚪';
      default: return '';
    }
  };

  const formatDueDate = (dueDate?: Date): string => {
    if (!dueDate) return '';
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return 'due today';
    if (diffDays === 1) return 'due tomorrow';
    return `due in ${diffDays}d`;
  };

  const stats = taskManager.getStats();

  return (
    <Box flexDirection="column" height={height} borderStyle="round" borderColor="gray">
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="cyan">
          📋 Tasks ({filteredTasks.length}/{stats.total})
        </Text>
        <Text dimColor>
          {Math.round(stats.completionRate)}% complete
        </Text>
      </Box>

      {/* Filter info */}
      <Box paddingX={1}>
        <Text dimColor>
          Sort: {sortBy} | {showCompleted ? 'All' : 'Active'} | Ready: {taskManager.getReadyTasks().length}
        </Text>
      </Box>

      {/* Task list */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {filteredTasks.slice(0, height - 4).map((task, index) => {
          const isSelected = index === selectedIndex;
          const color = getTaskColor(task);
          
          return (
            <Box key={task.id}>
              <Text color={color} backgroundColor={isSelected ? 'blue' : undefined}>
                {getStatusIcon(task.status)} {getPriorityIcon(task.priority)} 
                {task.title.slice(0, 40)}
                {task.title.length > 40 ? '...' : ''}
              </Text>
              {task.dueDate && (
                <Text dimColor> ({formatDueDate(task.dueDate)})</Text>
              )}
            </Box>
          );
        })}
        
        {filteredTasks.length === 0 && (
          <Text dimColor>No tasks found. Press 'n' to create a new task.</Text>
        )}
      </Box>

      {/* Footer controls */}
      {isActive && (
        <Box paddingX={1} borderTop borderColor="gray">
          <Text dimColor>
            ↑↓: navigate | Enter: select | Space: toggle | n: new | Del: delete | c: show completed | s: sort
          </Text>
        </Box>
      )}
    </Box>
  );
} 