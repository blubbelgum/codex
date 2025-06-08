import { test, expect, beforeEach, afterEach } from "vitest";
import { handleTaskCommand } from "../src/utils/task-command-handler.js";
import fs from "fs/promises";
import path from "path";

// Test directory for isolated task files
const TEST_DIR = path.join(process.cwd(), "test-tasks");
const TEST_TASK_FILE = path.join(TEST_DIR, ".codex-tasks.json");

beforeEach(async () => {
  // Create test directory
  await fs.mkdir(TEST_DIR, { recursive: true });
  // Change to test directory
  process.chdir(TEST_DIR);
});

afterEach(async () => {
  // Clean up test files
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
  // Change back to original directory
  process.chdir(path.dirname(TEST_DIR));
});

test("task help command returns help information", async () => {
  const result = await handleTaskCommand("/task help");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task Management Commands");
  expect(result.output).toContain("/task init");
  expect(result.output).toContain("/task add");
  expect(result.output).toContain("/task list");
  expect(result.output).toContain("/task next");
  expect(result.output).toContain("/task complete");
  expect(result.metadata?.exit_code).toBe(0);
});

test("task init creates a new project", async () => {
  const result = await handleTaskCommand("/task init TestProject");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task project initialized");
  expect(result.output).toContain("TestProject");
  expect(result.metadata?.exit_code).toBe(0);
  
  // Verify file was created
  const exists = await fs.access(TEST_TASK_FILE).then(() => true).catch(() => false);
  expect(exists).toBe(true);
});

test("task init without project name uses directory name", async () => {
  const result = await handleTaskCommand("/task init");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task project initialized");
  expect(result.metadata?.exit_code).toBe(0);
});

test("task list shows empty project initially", async () => {
  await handleTaskCommand("/task init TestProject");
  const result = await handleTaskCommand("/task list");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("No tasks found");
  expect(result.output).toContain("/task add");
  expect(result.metadata?.task_count).toBe(0);
});

test("task add creates a new task", async () => {
  await handleTaskCommand("/task init TestProject");
  const result = await handleTaskCommand('/task add "Fix login bug" Found issue with authentication');
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task added successfully");
  expect(result.output).toContain("Fix login bug");
  expect(result.output).toContain("Task 1:");
  expect(result.metadata?.task_id).toBe(1);
});

test("task add requires title", async () => {
  await handleTaskCommand("/task init TestProject");
  const result = await handleTaskCommand("/task add");
  
  expect(result.success).toBe(false);
  expect(result.output).toContain("Task title is required");
  expect(result.metadata?.exit_code).toBe(1);
});

test("task list shows added tasks", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Task 1" Description 1');
  await handleTaskCommand('/task add "Task 2" Description 2');
  
  const result = await handleTaskCommand("/task list");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task List");
  expect(result.output).toContain("Task 1: Task 1");
  expect(result.output).toContain("Task 2: Task 2");
  expect(result.metadata?.task_count).toBe(2);
});

test("task next returns first available task", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "First task" Description');
  await handleTaskCommand('/task add "Second task" Description');
  
  const result = await handleTaskCommand("/task next");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Next recommended task");
  expect(result.output).toContain("First task");
  expect(result.metadata?.task_id).toBe(1);
});

test("task next handles no available tasks", async () => {
  await handleTaskCommand("/task init TestProject");
  const result = await handleTaskCommand("/task next");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("All tasks completed");
});

test("task complete marks task as completed", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Complete me" Description');
  
  const result = await handleTaskCommand("/task complete 1");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task completed");
  expect(result.output).toContain("✅");
  expect(result.metadata?.task_id).toBe(1);
});

test("task complete requires task ID", async () => {
  await handleTaskCommand("/task init TestProject");
  const result = await handleTaskCommand("/task complete");
  
  expect(result.success).toBe(false);
  expect(result.output).toContain("Task ID is required");
  expect(result.metadata?.exit_code).toBe(1);
});

test("task complete handles invalid task ID", async () => {
  await handleTaskCommand("/task init TestProject");
  const result = await handleTaskCommand("/task complete 999");
  
  expect(result.success).toBe(false);
  expect(result.output).toContain("Task 999 not found");
  expect(result.metadata?.exit_code).toBe(1);
});

test("task status updates task status", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Test task" Description');
  
  const result = await handleTaskCommand("/task status 1 in_progress");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task status updated");
  expect(result.output).toContain("🔄");
  expect(result.metadata?.task_id).toBe(1);
});

test("task status requires valid status", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Test task" Description');
  
  const result = await handleTaskCommand("/task status 1 invalid_status");
  
  expect(result.success).toBe(false);
  expect(result.output).toContain("Invalid status");
  expect(result.metadata?.exit_code).toBe(1);
});

test("task analyze provides complexity analysis", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Simple task" Description');
  await handleTaskCommand('/task add "Complex task" Description');
  
  const result = await handleTaskCommand("/task analyze");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Project Complexity Analysis");
  expect(result.output).toContain("Average Complexity:");
  expect(result.metadata?.exit_code).toBe(0);
});

test("task prd generates project requirements document", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Feature A" Build the main feature');
  await handleTaskCommand('/task add "Feature B" Build secondary feature');
  
  const result = await handleTaskCommand("/task prd");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Product Requirements Document");
  expect(result.output).toContain("TestProject");
  expect(result.output).toContain("Feature A");
  expect(result.output).toContain("Feature B");
  expect(result.metadata?.exit_code).toBe(0);
});

test("task list with status filter", async () => {
  await handleTaskCommand("/task init TestProject");
  await handleTaskCommand('/task add "Task 1" Description');
  await handleTaskCommand('/task add "Task 2" Description');
  await handleTaskCommand("/task complete 1");
  
  const result = await handleTaskCommand("/task list --status completed");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Filtered by");
  expect(result.output).toContain("Task 1");
  expect(result.output).not.toContain("Task 2");
});

test("unknown task command returns error", async () => {
  const result = await handleTaskCommand("/task unknown");
  
  expect(result.success).toBe(false);
  expect(result.output).toContain("Unknown command");
  expect(result.output).toContain("/task unknown");
  expect(result.metadata?.exit_code).toBe(1);
});

test("task commands work without existing project file", async () => {
  // This should auto-create a project
  const result = await handleTaskCommand('/task add "Auto-created task" Description');
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Task added successfully");
  expect(result.metadata?.task_id).toBe(1);
});

test("task next with dependencies", async () => {
  await handleTaskCommand("/task init TestProject");
  
  // Add tasks through the file system to test dependency logic
  const taskData = {
    name: "TestProject",
    description: "Task management for TestProject", 
    tasks: [
      {
        id: 1,
        title: "Blocked task",
        description: "This task depends on task 2",
        status: "pending",
        priority: "high",
        complexity: 5,
        dependencies: [2],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        title: "Prerequisite task", 
        description: "Must be completed first",
        status: "pending",
        priority: "medium",
        complexity: 3,
        dependencies: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: "1.0.0"
  };
  
  await fs.writeFile(TEST_TASK_FILE, JSON.stringify(taskData, null, 2));
  
  const result = await handleTaskCommand("/task next");
  
  expect(result.success).toBe(true);
  expect(result.output).toContain("Prerequisite task");
  expect(result.metadata?.task_id).toBe(2);
}); 