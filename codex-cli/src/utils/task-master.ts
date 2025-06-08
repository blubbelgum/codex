import { log } from "./logger/log.js";
import fs from "fs/promises";
import path from "path";

export interface Task {
  id: number;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "critical";
  complexity: number; // 1-10 scale
  dependencies: number[]; // array of task IDs this task depends on
  tags: string[];
  createdAt: string;
  updatedAt: string;
  estimatedHours?: number;
  actualHours?: number;
  assignee?: string;
}

export interface TaskProject {
  name: string;
  description: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  pending: number;
  completed: number;
  inProgress: number;
}

const TASK_FILE_NAME = ".codex-tasks.json";
const TASK_VERSION = "1.0.0";

/**
 * Task Master integration for Codex CLI
 * Provides basic project task management functionality
 */
export class TaskMaster {
  private projectRoot: string;
  private taskFilePath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.taskFilePath = path.join(projectRoot, TASK_FILE_NAME);
  }

  /**
   * Initialize a new task project in the current directory
   */
  async initializeProject(projectName?: string): Promise<TaskProject> {
    const name = projectName || path.basename(this.projectRoot);
    const now = new Date().toISOString();
    
    const project: TaskProject = {
      name,
      description: `Task management for ${name}`,
      tasks: [],
      createdAt: now,
      updatedAt: now,
      version: TASK_VERSION,
    };

    await this.saveProject(project);
    log(`Task project initialized: ${name}`);
    return project;
  }

  /**
   * Load the current task project
   */
  async loadProject(): Promise<TaskProject | null> {
    try {
      const data = await fs.readFile(this.taskFilePath, "utf-8");
      return JSON.parse(data) as TaskProject;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null; // File doesn't exist
      }
      throw error;
    }
  }

  /**
   * Save the current task project
   */
  private async saveProject(project: TaskProject): Promise<void> {
    project.updatedAt = new Date().toISOString();
    await fs.writeFile(this.taskFilePath, JSON.stringify(project, null, 2));
  }

  /**
   * Get or create a project
   */
  async getOrCreateProject(): Promise<TaskProject> {
    let project = await this.loadProject();
    if (!project) {
      project = await this.initializeProject();
    }
    return project;
  }

  /**
   * List all tasks with filtering options
   */
  async listTasks(options?: {
    status?: Task["status"];
    priority?: Task["priority"];
    tag?: string;
  }): Promise<TaskListResponse> {
    const project = await this.loadProject();
    if (!project) {
      return { tasks: [], total: 0, pending: 0, completed: 0, inProgress: 0 };
    }

    let tasks = project.tasks;

    // Apply filters
    if (options?.status) {
      tasks = tasks.filter(task => task.status === options.status);
    }
    if (options?.priority) {
      tasks = tasks.filter(task => task.priority === options.priority);
    }
    if (options?.tag) {
      tasks = tasks.filter(task => task.tags.includes(options.tag!));
    }

    // Calculate statistics
    const total = project.tasks.length;
    const pending = project.tasks.filter(t => t.status === "pending").length;
    const completed = project.tasks.filter(t => t.status === "completed").length;
    const inProgress = project.tasks.filter(t => t.status === "in_progress").length;

    return { tasks, total, pending, completed, inProgress };
  }

  /**
   * Get the next task to work on based on dependencies and priority
   */
  async getNextTask(): Promise<Task | null> {
    const project = await this.loadProject();
    if (!project) {
      return null;
    }

    // Get all pending tasks
    const pendingTasks = project.tasks.filter(task => task.status === "pending");
    
    // Filter out tasks that have unmet dependencies
    const availableTasks = pendingTasks.filter(task => {
      return task.dependencies.every(depId => {
        const depTask = project.tasks.find(t => t.id === depId);
        return depTask?.status === "completed";
      });
    });

    if (availableTasks.length === 0) {
      return null;
    }

    // Sort by priority and complexity (high priority, low complexity first)
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    availableTasks.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.complexity - b.complexity; // Lower complexity first
    });

    return availableTasks[0] ?? null;
  }

  /**
   * Add a new task
   */
  async addTask(taskData: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task> {
    const project = await this.getOrCreateProject();
    const now = new Date().toISOString();
    
    const newId = Math.max(0, ...project.tasks.map(t => t.id)) + 1;
    const task: Task = {
      ...taskData,
      id: newId,
      createdAt: now,
      updatedAt: now,
    };

    project.tasks.push(task);
    await this.saveProject(project);
    
    log(`Task added: ${task.title} (ID: ${task.id})`);
    return task;
  }

  /**
   * Update a task's status
   */
  async updateTaskStatus(taskId: number, status: Task["status"]): Promise<Task | null> {
    const project = await this.loadProject();
    if (!project) {
      return null;
    }

    const task = project.tasks.find(t => t.id === taskId);
    if (!task) {
      return null;
    }

    task.status = status;
    task.updatedAt = new Date().toISOString();
    
    await this.saveProject(project);
    log(`Task ${taskId} status updated to: ${status}`);
    return task;
  }

  /**
   * Mark a task as completed
   */
  async completeTask(taskId: number): Promise<Task | null> {
    return this.updateTaskStatus(taskId, "completed");
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: number): Promise<Task | null> {
    const project = await this.loadProject();
    if (!project) {
      return null;
    }

    return project.tasks.find(t => t.id === taskId) ?? null;
  }

  /**
   * Analyze the complexity of all tasks and provide insights
   */
  async analyzeComplexity(): Promise<{
    averageComplexity: number;
    highComplexityTasks: Task[];
    recommendations: string[];
  }> {
    const project = await this.loadProject();
    if (!project) {
      return { averageComplexity: 0, highComplexityTasks: [], recommendations: [] };
    }

    const tasks = project.tasks.filter(t => t.status !== "completed");
    if (tasks.length === 0) {
      return { averageComplexity: 0, highComplexityTasks: [], recommendations: [] };
    }

    const averageComplexity = tasks.reduce((sum, task) => sum + task.complexity, 0) / tasks.length;
    const highComplexityTasks = tasks.filter(task => task.complexity >= 8);
    
    const recommendations: string[] = [];
    
    if (averageComplexity > 7) {
      recommendations.push("Consider breaking down complex tasks into smaller, manageable pieces");
    }
    
    if (highComplexityTasks.length > 0) {
      recommendations.push(`${highComplexityTasks.length} tasks have high complexity (8+) - consider expanding these first`);
    }

    const blockedTasks = tasks.filter(task => 
      task.dependencies.some(depId => 
        project.tasks.find(t => t.id === depId)?.status !== "completed"
      )
    );
    
    if (blockedTasks.length > 0) {
      recommendations.push(`${blockedTasks.length} tasks are blocked by dependencies`);
    }

    return { averageComplexity, highComplexityTasks, recommendations };
  }

  /**
   * Generate a text-based PRD by analyzing the current project structure
   */
  async generatePRDFromProject(): Promise<string> {
    const project = await this.loadProject();
    if (!project) {
      return "No task project found. Use `/task init` to create one.";
    }

    const { tasks, total, pending, completed, inProgress } = await this.listTasks();
    
    const prd = `# ${project.name} - Product Requirements Document

Generated: ${new Date().toLocaleDateString()}

## Project Overview
${project.description}

## Task Summary
- Total Tasks: ${total}
- Completed: ${completed}
- In Progress: ${inProgress}
- Pending: ${pending}

## Task Breakdown

${tasks.map(task => `
### Task ${task.id}: ${task.title}
**Status:** ${task.status}
**Priority:** ${task.priority}
**Complexity:** ${task.complexity}/10
**Tags:** ${task.tags.join(", ") || "None"}
${task.dependencies.length > 0 ? `**Dependencies:** ${task.dependencies.join(", ")}` : ""}

${task.description}

---
`).join("")}

## Next Steps
${pending > 0 ? `Focus on completing the ${pending} pending tasks.` : "All tasks completed! 🎉"}
`;

    return prd;
  }
}

/**
 * Format task information for display in chat
 */
export function formatTaskForChat(task: Task): string {
  const statusEmoji = {
    pending: "⏳",
    in_progress: "🔄", 
    completed: "✅",
    blocked: "🚫"
  };

  const priorityEmoji = {
    low: "🔵",
    medium: "🟡", 
    high: "🟠",
    critical: "🔴"
  };

  return `${statusEmoji[task.status]} **Task ${task.id}**: ${task.title}
${priorityEmoji[task.priority]} Priority: ${task.priority} | Complexity: ${task.complexity}/10
${task.description}
${task.tags.length > 0 ? `Tags: ${task.tags.join(", ")}` : ""}
${task.dependencies.length > 0 ? `Dependencies: ${task.dependencies.join(", ")}` : ""}`;
}

/**
 * Parse basic task command arguments
 */
export function parseTaskCommand(input: string): { action: string; args: string[] } {
  const parts = input.trim().split(/\s+/);
  parts.shift(); // Remove "/task"
  
  const action = parts.shift() || "help";
  const args = parts;
  
  return { action, args };
} 