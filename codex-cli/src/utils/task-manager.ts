import { EventEmitter } from 'events';

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  dueDate?: Date;
  tags: string[];
  progress?: number; // 0-100
  estimatedDuration?: number; // in minutes
  actualDuration?: number; // in minutes
  dependencies: string[]; // Task IDs that must complete first
  assignee?: string;
  metadata?: Record<string, any>;
}

export interface TaskFilter {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  tags?: string[];
  assignee?: string;
  dueBefore?: Date;
  dueAfter?: Date;
  searchText?: string;
}

export interface TaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  cancelled: number;
  overdue: number;
  completionRate: number;
  avgCompletionTime: number;
}

export class TaskManager extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private subscribers: Set<(tasks: Task[]) => void> = new Set();

  constructor() {
    super();
  }

  // Task CRUD operations
  createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const task: Task = {
      ...taskData,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tasks.set(task.id, task);
    this.emit('taskCreated', task);
    this.notifySubscribers();
    return task;
  }

  updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Task | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updatedTask: Task = {
      ...task,
      ...updates,
      updatedAt: new Date(),
    };

    // Set completion time if status changed to completed
    if (updates.status === TaskStatus.COMPLETED && task.status !== TaskStatus.COMPLETED) {
      updatedTask.completedAt = new Date();
      updatedTask.progress = 100;
    }

    this.tasks.set(id, updatedTask);
    this.emit('taskUpdated', updatedTask, task);
    this.notifySubscribers();
    return updatedTask;
  }

  deleteTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.delete(id);
    this.emit('taskDeleted', task);
    this.notifySubscribers();
    return true;
  }

  getTask(id: string): Task | null {
    return this.tasks.get(id) || null;
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  // Task filtering and searching
  filterTasks(filter: TaskFilter): Task[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (filter.status && !filter.status.includes(task.status)) return false;
      if (filter.priority && !filter.priority.includes(task.priority)) return false;
      if (filter.assignee && task.assignee !== filter.assignee) return false;
      if (filter.tags && !filter.tags.some(tag => task.tags.includes(tag))) return false;
      
      if (filter.dueBefore && task.dueDate && task.dueDate > filter.dueBefore) return false;
      if (filter.dueAfter && task.dueDate && task.dueDate < filter.dueAfter) return false;
      
      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase();
        const matches = 
          task.title.toLowerCase().includes(searchLower) ||
          task.description?.toLowerCase().includes(searchLower) ||
          task.tags.some(tag => tag.toLowerCase().includes(searchLower));
        if (!matches) return false;
      }

      return true;
    });
  }

  // Task statistics
  getStats(): TaskStats {
    const tasks = this.getAllTasks();
    const total = tasks.length;
    const now = new Date();

    const statusCounts = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let overdue = 0;
    let totalCompletionTime = 0;
    let completedCount = 0;

    tasks.forEach(task => {
      if (task.status === TaskStatus.PENDING) statusCounts.pending++;
      else if (task.status === TaskStatus.IN_PROGRESS) statusCounts.inProgress++;
      else if (task.status === TaskStatus.COMPLETED) statusCounts.completed++;
      else if (task.status === TaskStatus.FAILED) statusCounts.failed++;
      else if (task.status === TaskStatus.CANCELLED) statusCounts.cancelled++;

      if (task.dueDate && task.dueDate < now && task.status !== TaskStatus.COMPLETED) {
        overdue++;
      }

      if (task.status === TaskStatus.COMPLETED && task.actualDuration) {
        totalCompletionTime += task.actualDuration;
        completedCount++;
      }
    });

    return {
      total,
      ...statusCounts,
      overdue,
      completionRate: total > 0 ? (statusCounts.completed / total) * 100 : 0,
      avgCompletionTime: completedCount > 0 ? totalCompletionTime / completedCount : 0,
    };
  }

  // Task dependencies
  canStartTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    return task.dependencies.every(depId => {
      const depTask = this.getTask(depId);
      return depTask?.status === TaskStatus.COMPLETED;
    });
  }

  getBlockedTasks(): Task[] {
    return this.getAllTasks().filter(task => 
      task.status === TaskStatus.PENDING && !this.canStartTask(task.id)
    );
  }

  getReadyTasks(): Task[] {
    return this.getAllTasks().filter(task => 
      task.status === TaskStatus.PENDING && this.canStartTask(task.id)
    );
  }

  // Subscription management
  subscribe(callback: (tasks: Task[]) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notifySubscribers(): void {
    const tasks = this.getAllTasks();
    this.subscribers.forEach(callback => callback(tasks));
  }

  // Bulk operations
  markMultipleCompleted(ids: string[]): Task[] {
    return ids.map(id => this.updateTask(id, { status: TaskStatus.COMPLETED })).filter(Boolean) as Task[];
  }

  deleteMultiple(ids: string[]): number {
    let deleted = 0;
    ids.forEach(id => {
      if (this.deleteTask(id)) deleted++;
    });
    return deleted;
  }

  // Export/Import
  exportTasks(): string {
    return JSON.stringify(Array.from(this.tasks.values()), null, 2);
  }

  importTasks(data: string): number {
    try {
      const tasks: Task[] = JSON.parse(data);
      let imported = 0;
      
      tasks.forEach(task => {
        // Ensure dates are properly parsed
        task.createdAt = new Date(task.createdAt);
        task.updatedAt = new Date(task.updatedAt);
        if (task.completedAt) task.completedAt = new Date(task.completedAt);
        if (task.dueDate) task.dueDate = new Date(task.dueDate);
        
        this.tasks.set(task.id, task);
        imported++;
      });
      
      this.notifySubscribers();
      return imported;
    } catch (error) {
      throw new Error(`Failed to import tasks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Global task manager instance
export const taskManager = new TaskManager(); 