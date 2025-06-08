import { 
  TaskMaster, 
  parseTaskCommand, 
  formatTaskForChat, 
  type Task
} from "./task-master.js";

export interface TaskCommandResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: {
    exit_code: number;
    duration_seconds: number;
    task_count?: number;
    task_id?: number;
  };
}

/**
 * Handle task management commands - full implementation
 */
export async function handleTaskCommand(command: string): Promise<TaskCommandResult> {
  const startTime = Date.now();
  
  try {
    // Parse command: "/task action args..."
    const { action, args } = parseTaskCommand(command);
    const taskMaster = new TaskMaster();
    
    switch (action) {
      case "help":
        return {
          success: true,
          output: getTaskCommandHelp(),
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
          },
        };

      case "init": {
        const projectName = args.join(" ") || undefined;
        const project = await taskMaster.initializeProject(projectName);
        return {
          success: true,
          output: `✅ **Task project initialized!**

📁 **Project:** ${project.name}
📝 **Description:** ${project.description}
📅 **Created:** ${new Date(project.createdAt).toLocaleDateString()}

You can now start adding tasks with:
\`/task add "Task title" [description]\`

Use \`/task help\` to see all available commands.`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
          },
        };
      }

      case "list": {
        const options: any = {};
        
                 // Parse filtering options
         for (let i = 0; i < args.length; i += 2) {
           const key = args[i];
           const value = args[i + 1];
           if (key === "--status" && value) {
             options.status = value as Task["status"];
           } else if (key === "--priority" && value) {
             options.priority = value as Task["priority"];
           } else if (key === "--tag" && value) {
             options.tag = value;
           }
         }

        const response = await taskMaster.listTasks(options);
        
        if (response.total === 0) {
          return {
            success: true,
            output: `📋 **No tasks found**

Start by adding your first task:
\`/task add "My first task" [description]\``,
            metadata: {
              exit_code: 0,
              duration_seconds: (Date.now() - startTime) / 1000,
              task_count: 0,
            },
          };
        }

        const filterInfo = options.status || options.priority || options.tag 
          ? `\n🔍 **Filtered by:** ${Object.entries(options).map(([k, v]) => `${k}=${v}`).join(", ")}`
          : "";

        const tasksList = response.tasks.map(formatTaskForChat).join("\n\n");
        
        return {
          success: true,
          output: `📋 **Task List** (${response.tasks.length}/${response.total} tasks)${filterInfo}

📊 **Summary:** ${response.completed} completed • ${response.inProgress} in progress • ${response.pending} pending

${tasksList}

💡 **Next:** Use \`/task next\` to get task recommendations`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
            task_count: response.tasks.length,
          },
        };
      }

      case "add": {
        if (args.length === 0) {
          return {
            success: false,
            output: "❌ **Error:** Task title is required\n\n**Usage:** `/task add \"Task title\" [description]`",
            error: "Missing title",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        // Parse title and description from args
        const fullText = args.join(" ");
        let title: string;
        let description = "";
        
        // Check if title is quoted
        const quotedMatch = fullText.match(/^"([^"]+)"\s*(.*)/);
        if (quotedMatch && quotedMatch[1]) {
          title = quotedMatch[1];
          description = quotedMatch[2]?.trim() ?? "";
        } else {
          // Use first few words as title, rest as description
          const words = args;
          title = words.slice(0, Math.min(5, words.length)).join(" ");
          description = words.slice(5).join(" ");
        }

        const taskData = {
          title,
          description,
          status: "pending" as const,
          priority: "medium" as const,
          complexity: 5,
          dependencies: [],
          tags: [],
        };

        const task = await taskMaster.addTask(taskData);
        
        return {
          success: true,
          output: `✅ **Task added successfully!**

${formatTaskForChat(task)}

💡 **Tip:** Use \`/task complete ${task.id}\` when finished, or \`/task next\` to see what to work on next.`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
            task_id: task.id,
          },
        };
      }

      case "next": {
        const nextTask = await taskMaster.getNextTask();
        
        if (!nextTask) {
          const { pending } = await taskMaster.listTasks();
          const message = pending === 0 
            ? "🎉 **All tasks completed!** Add new tasks with `/task add`"
            : "🚫 **No available tasks** - all pending tasks have unmet dependencies";
            
          return {
            success: true,
            output: message,
            metadata: {
              exit_code: 0,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        return {
          success: true,
          output: `🎯 **Next recommended task:**

${formatTaskForChat(nextTask)}

💡 **Ready to start?** Use \`/task complete ${nextTask.id}\` when finished.`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
            task_id: nextTask.id,
          },
        };
      }

      case "complete": {
        const taskIdStr = args[0];
        if (!taskIdStr) {
          return {
            success: false,
            output: "❌ **Error:** Task ID is required\n\n**Usage:** `/task complete <task_id>`",
            error: "Missing task ID",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        const taskId = parseInt(taskIdStr, 10);
        if (isNaN(taskId)) {
          return {
            success: false,
            output: "❌ **Error:** Invalid task ID\n\n**Usage:** `/task complete <task_id>`",
            error: "Invalid task ID",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        const task = await taskMaster.completeTask(taskId);
        if (!task) {
          return {
            success: false,
            output: `❌ **Error:** Task ${taskId} not found`,
            error: "Task not found",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        return {
          success: true,
          output: `✅ **Task completed!**

${formatTaskForChat(task)}

🎉 Great work! Use \`/task next\` to see what to work on next.`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
            task_id: task.id,
          },
        };
      }

      case "analyze": {
        const analysis = await taskMaster.analyzeComplexity();
        
        const highComplexityList = analysis.highComplexityTasks.length > 0
          ? `\n🔴 **High Complexity Tasks:**\n${analysis.highComplexityTasks.map(t => `• Task ${t.id}: ${t.title} (${t.complexity}/10)`).join("\n")}`
          : "";

        const recommendationsList = analysis.recommendations.length > 0
          ? `\n💡 **Recommendations:**\n${analysis.recommendations.map(r => `• ${r}`).join("\n")}`
          : "\n✅ No specific recommendations - project looks well-structured!";

        return {
          success: true,
          output: `📊 **Project Complexity Analysis**

📈 **Average Complexity:** ${analysis.averageComplexity.toFixed(1)}/10${highComplexityList}${recommendationsList}

💡 **Tip:** Use \`/task next\` to get the optimal next task based on priority and complexity.`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
          },
        };
      }

      case "status": {
        const taskIdStr = args[0];
        if (!taskIdStr) {
          return {
            success: false,
            output: "❌ **Error:** Task ID is required\n\n**Usage:** `/task status <task_id> <new_status>`",
            error: "Missing task ID",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        const newStatus = args[1] as Task["status"];
        if (!["pending", "in_progress", "completed", "blocked"].includes(newStatus)) {
          return {
            success: false,
            output: "❌ **Error:** Invalid status\n\n**Valid statuses:** pending, in_progress, completed, blocked",
            error: "Invalid status",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        const taskId = parseInt(taskIdStr, 10);
        const task = await taskMaster.updateTaskStatus(taskId, newStatus);
        
        if (!task) {
          return {
            success: false,
            output: `❌ **Error:** Task ${taskId} not found`,
            error: "Task not found",
            metadata: {
              exit_code: 1,
              duration_seconds: (Date.now() - startTime) / 1000,
            },
          };
        }

        return {
          success: true,
          output: `✅ **Task status updated!**

${formatTaskForChat(task)}`,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
            task_id: task.id,
          },
        };
      }

      case "prd": {
        const prd = await taskMaster.generatePRDFromProject();
        
        return {
          success: true,
          output: prd,
          metadata: {
            exit_code: 0,
            duration_seconds: (Date.now() - startTime) / 1000,
          },
        };
      }
        
      default:
        return {
          success: false,
          output: `❌ **Unknown command:** \`/task ${action}\`

${getTaskCommandHelp()}`,
          error: `Unknown action: ${action}`,
          metadata: {
            exit_code: 1,
            duration_seconds: (Date.now() - startTime) / 1000,
          },
        };
    }
  } catch (error) {
    return {
      success: false,
      output: `❌ Task command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: String(error),
      metadata: {
        exit_code: 1,
        duration_seconds: (Date.now() - startTime) / 1000,
      },
    };
  }
}

/**
 * Get help information for task commands
 */
function getTaskCommandHelp(): string {
  return `🎯 **Task Management Commands**

**Project Management:**
• \`/task init [project_name]\` - Initialize a task project
• \`/task list [--status pending] [--priority high] [--tag feature]\` - List tasks with filters
• \`/task analyze\` - Analyze project complexity and get recommendations
• \`/task prd\` - Generate Product Requirements Document

**Task Operations:**
• \`/task add "title" [description]\` - Add a new task
• \`/task next\` - Get the next recommended task to work on
• \`/task complete <task_id>\` - Mark a task as completed
• \`/task status <task_id> <status>\` - Update task status (pending|in_progress|completed|blocked)

**Examples:**
\`/task init MyProject\`
\`/task add "Fix login bug" Found issue with authentication\`
\`/task list --status pending\`
\`/task complete 1\`

💡 **Features:**
🎯 AI-powered task recommendations based on dependencies and priority
📊 Smart complexity analysis and breakdown suggestions
⚡ Dependency tracking to suggest optimal task order
📋 Automatic PRD generation from task structure

**Integration:** Tasks are stored locally in \`.codex-tasks.json\` and can be used by the AI agent for project planning and execution.`;
} 