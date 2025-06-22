import type { ResponseItem, ResponseInputItem } from "@openai/openai/resources/responses";

import { EventEmitter } from "events";

export interface MockFileSystem {
  files: Record<string, string>;
  directories: Set<string>;
}

export interface MockAgentOptions {
  mockFileSystem?: MockFileSystem;
  simulateDelay?: boolean;
  delayMs?: number;
  verbose?: boolean;
}

export interface MockExecResult {
  output: string;
  exitCode: number;
  duration: number;
}

export interface MockAgentState {
  currentDir: string;
  fileSystem: MockFileSystem;
  commandHistory: Array<{ command: Array<string>; result: MockExecResult }>;
  webSearchResults: Array<{ query: string; results: Array<any> }>;
  tasks: Array<{ id: number; title: string; status: string }>;
}

/**
 * Comprehensive mock agent that simulates all function calls without using real APIs or file system
 */
export class MockAgent extends EventEmitter {
  private state: MockAgentState;
  private options: MockAgentOptions;
  private projectFiles: Map<string, string> = new Map();

  constructor(options: MockAgentOptions = {}) {
    super();
    this.options = {
      simulateDelay: true,
      delayMs: 100,
      verbose: false,
      ...options,
    };

    this.state = {
      currentDir: "/project",
      fileSystem: options.mockFileSystem || {
        files: {},
        directories: new Set(["/project"]),
      },
      commandHistory: [],
      webSearchResults: [],
      tasks: [],
    };

    this.initializeMockFileSystem();
  }

  private initializeMockFileSystem() {
    // Initialize with common project structure
    this.createFile("/project/package.json", JSON.stringify({
      name: "mock-project",
      version: "1.0.0",
      scripts: {
        dev: "npm start",
        build: "npm run build",
        test: "npm test"
      },
      dependencies: {}
    }, null, 2));

    this.createFile("/project/README.md", "# Mock Project\n\nThis is a simulated project for testing.");
    this.createDirectory("/project/src");
    this.createDirectory("/project/public");
    this.createDirectory("/project/tests");
  }

  private async delay() {
    if (this.options.simulateDelay) {
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
    }
  }

  private log(message: string, data?: any) {
    if (this.options.verbose) {
      console.log(`[MockAgent] ${message}`, data || '');
    }
  }

  private createFile(path: string, content: string) {
    this.state.fileSystem.files[path] = content;
    this.projectFiles.set(path, content);
    
    // Ensure parent directory exists
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      this.state.fileSystem.directories.add(dir);
    }
  }

  private createDirectory(path: string) {
    this.state.fileSystem.directories.add(path);
  }

  private readFile(path: string): string | null {
    return this.state.fileSystem.files[path] || null;
  }

  private fileExists(path: string): boolean {
    return path in this.state.fileSystem.files || this.state.fileSystem.directories.has(path);
  }

  /**
   * Mock shell/exec function calls
   */
  public async mockShellCall(command: Array<string>, workdir?: string): Promise<MockExecResult> {
    await this.delay();
    
    const startTime = Date.now();
    const cmd = command[0];
    const args = command.slice(1);

    this.log(`Executing shell command: ${command.join(' ')}`, { workdir });

    let output = "";
    let exitCode = 0;

    try {
      switch (cmd) {
        case 'ls':
          output = this.mockLsCommand(args, workdir);
          break;
        case 'cat':
          output = this.mockCatCommand(args);
          break;
        case 'mkdir':
          output = this.mockMkdirCommand(args);
          break;
        case 'touch':
          output = this.mockTouchCommand(args);
          break;
        case 'echo':
          output = args.join(' ');
          break;
        case 'pwd':
          output = this.state.currentDir;
          break;
        case 'cd':
          output = this.mockCdCommand(args);
          break;
        case 'npm':
          output = this.mockNpmCommand(args);
          break;
        case 'node':
          output = this.mockNodeCommand(args);
          break;
        case 'git':
          output = this.mockGitCommand(args);
          break;

        default:
          output = `Mock execution of: ${command.join(' ')}\nCommand simulated successfully.`;
      }
    } catch (error) {
      output = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      exitCode = 1;
    }

    const duration = Date.now() - startTime;
    const result: MockExecResult = { output, exitCode, duration };
    
    this.state.commandHistory.push({ command, result });
    this.emit('command_executed', { command, result });

    return result;
  }

  private mockLsCommand(args: Array<string>, workdir?: string): string {
    const targetDir = workdir || this.state.currentDir;
    const entries: Array<string> = [];

    // List files in directory
    Object.keys(this.state.fileSystem.files).forEach(path => {
      if (path.startsWith(targetDir + '/') && !path.substring(targetDir.length + 1).includes('/')) {
        entries.push(path.substring(targetDir.length + 1));
      }
    });

    // List subdirectories
    this.state.fileSystem.directories.forEach(dir => {
      if (dir.startsWith(targetDir + '/') && !dir.substring(targetDir.length + 1).includes('/')) {
        entries.push(dir.substring(targetDir.length + 1) + '/');
      }
    });

    return entries.sort().join('\n');
  }

  private mockCatCommand(args: Array<string>): string {
    if (args.length === 0) {
      throw new Error('cat: missing file operand');
    }

    const filePath = this.resolvePath(args[0]);
    const content = this.readFile(filePath);
    
    if (content === null) {
      throw new Error(`cat: ${args[0]}: No such file or directory`);
    }

    return content;
  }

  private mockMkdirCommand(args: Array<string>): string {
    if (args.length === 0) {
      throw new Error('mkdir: missing operand');
    }

    const recursive = args.includes('-p') || args.includes('--parents');
    const dirPath = args[args.length - 1];
    const fullPath = this.resolvePath(dirPath);

    if (recursive) {
      // Create all parent directories
      let current = '';
      fullPath.split('/').forEach(part => {
        if (part) {
          current += '/' + part;
          this.state.fileSystem.directories.add(current);
        }
      });
    } else {
      this.state.fileSystem.directories.add(fullPath);
    }

    return `Created directory: ${dirPath}`;
  }

  private mockTouchCommand(args: Array<string>): string {
    if (args.length === 0) {
      throw new Error('touch: missing file operand');
    }

    const filePath = this.resolvePath(args[0]);
    
    if (!this.fileExists(filePath)) {
      this.createFile(filePath, '');
    }

    return `File touched: ${args[0]}`;
  }

  private mockCdCommand(args: Array<string>): string {
    if (args.length === 0) {
      this.state.currentDir = '/project';
    } else {
      const targetDir = this.resolvePath(args[0]);
      if (this.state.fileSystem.directories.has(targetDir)) {
        this.state.currentDir = targetDir;
      } else {
        throw new Error(`cd: ${args[0]}: No such file or directory`);
      }
    }
    return '';
  }

  private mockNpmCommand(args: Array<string>): string {
    const subcommand = args[0];
    
    switch (subcommand) {
      case 'init':
        return 'Wrote to package.json\n\nnpm notice created a lockfile as package-lock.json.';
      case 'install':
        return 'added 42 packages in 2.1s';
      case 'start':
        return 'Starting development server...\nServer running on http://localhost:3000';
      case 'build':
        return 'Building for production...\nBuild completed successfully!';
      case 'test':
        return 'Running tests...\n✓ All tests passed (5/5)';
      case 'run':
        return `Running script: ${args[1]}`;
      default:
        return `npm ${args.join(' ')} - Mock execution completed`;
    }
  }

  private mockNodeCommand(args: Array<string>): string {
    if (args.length === 0) {
      return 'Welcome to Node.js v18.0.0.';
    }

    const fileName = args[0];
    const filePath = this.resolvePath(fileName);
    
    if (!this.fileExists(filePath)) {
      throw new Error(`Error: Cannot find module '${fileName}'`);
    }

    return `Executing ${fileName}...\nScript completed successfully.`;
  }

  private mockGitCommand(args: Array<string>): string {
    const subcommand = args[0];
    
    switch (subcommand) {
      case 'init':
        return 'Initialized empty Git repository in /project/.git/';
      case 'add':
        return '';
      case 'commit':
        return '[main abcd123] Initial commit\n 1 file changed, 1 insertion(+)';
      case 'status':
        return 'On branch main\nnothing to commit, working tree clean';
      case 'clone':
        return `Cloning into '${args[1]}'...\nremote: Counting objects: 100, done.`;
      default:
        return `git ${args.join(' ')} - Mock execution completed`;
    }
  }



  /**
   * Mock web search function calls
   */
  public async mockWebSearch(query: string, options: any = {}): Promise<any> {
    await this.delay();
    
    this.log(`Web search: ${query}`, options);

    const mockResults = [
      {
        title: `Mock Result 1 for: ${query}`,
        url: 'https://example.com/result1',
        snippet: `This is a mock search result for your query: ${query}. It contains relevant information and examples.`,
      },
      {
        title: `Mock Result 2 for: ${query}`,
        url: 'https://example.com/result2', 
        snippet: `Another mock result that provides additional context about ${query} with code examples.`,
      },
      {
        title: `Documentation: ${query}`,
        url: 'https://docs.example.com',
        snippet: `Official documentation and API reference for ${query}.`,
      }
    ];

    const result = {
      query,
      results: mockResults.slice(0, options.maxResults || 3),
      totalResults: mockResults.length,
      searchTime: Math.random() * 0.5 + 0.1,
    };

    this.state.webSearchResults.push(result);
    this.emit('web_search', result);

    return result;
  }

  /**
   * Mock task management function calls
   */
  public async mockTaskManagement(action: string, params: any = {}): Promise<any> {
    await this.delay();
    
    this.log(`Task management: ${action}`, params);

    let result = '';

    switch (action) {
      case 'init':
        result = `Initialized task management for project: ${params.projectName || 'mock-project'}`;
        break;
      case 'add':
        const newTask = {
          id: this.state.tasks.length + 1,
          title: params.title || 'Mock Task',
          status: 'pending',
          priority: params.priority || 'medium',
        };
        this.state.tasks.push(newTask);
        result = `Added task #${newTask.id}: ${newTask.title}`;
        break;
      case 'list':
        const tasks = this.state.tasks
          .filter(t => !params.filterStatus || t.status === params.filterStatus)
          .map(t => `#${t.id}: ${t.title} (${t.status})`)
          .join('\n');
        result = tasks || 'No tasks found';
        break;
      case 'complete':
        const task = this.state.tasks.find(t => t.id === params.taskId);
        if (task) {
          task.status = 'completed';
          result = `Completed task #${task.id}: ${task.title}`;
        } else {
          result = `Task #${params.taskId} not found`;
        }
        break;
      default:
        result = `Task management action '${action}' completed`;
    }

    this.emit('task_management', { action, params, result });

    return { output: result, success: true };
  }

  /**
   * Simulate a complete conversation turn with function calls
   */
  public async simulateConversation(prompt: string): Promise<{
    messages: Array<ResponseItem>;
    functionCalls: Array<{ name: string; args: any; result: any }>;
    fileOperations: Array<{ type: string; path: string; content?: string }>;
  }> {
    await this.delay();
    
    this.log(`Starting conversation simulation for: ${prompt}`);

    const messages: Array<ResponseItem> = [];
    const functionCalls: Array<{ name: string; args: any; result: any }> = [];
    const fileOperations: Array<{ type: string; path: string; content?: string }> = [];

    // User message
    messages.push({
      id: `msg-${Date.now()}`,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: prompt }],
    });

    // Simulate AI thinking and function calls based on prompt
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt.includes('create') || lowerPrompt.includes('build') || lowerPrompt.includes('web')) {
      // Simulate creating a web application
      await this.simulateWebAppCreation(messages, functionCalls, fileOperations);
    } else if (lowerPrompt.includes('search') || lowerPrompt.includes('find')) {
      // Simulate web search
      await this.simulateWebSearch(prompt, messages, functionCalls);
    } else if (lowerPrompt.includes('task') || lowerPrompt.includes('todo')) {
      // Simulate task management
      await this.simulateTaskManagement(messages, functionCalls);
    } else {
      // Default simulation - simple file operations
      await this.simulateBasicOperations(messages, functionCalls, fileOperations);
    }

    // Final AI response
    messages.push({
      id: `msg-${Date.now()}-final`,
      type: "message", 
      role: "assistant",
      content: [{ 
        type: "input_text", 
        text: "Task completed successfully! I've simulated all the necessary operations and created the requested project structure." 
      }],
    });

    this.emit('conversation_complete', { messages, functionCalls, fileOperations });

    return { messages, functionCalls, fileOperations };
  }

  private async simulateWebAppCreation(
    messages: Array<ResponseItem>,
    functionCalls: Array<{ name: string; args: any; result: any }>,
    fileOperations: Array<{ type: string; path: string; content?: string }>
  ) {
    // Simulate creating project structure
    const shellResult = await this.mockShellCall(['mkdir', '-p', 'src/components', 'src/utils', 'public']);
    functionCalls.push({
      name: 'shell',
      args: { command: ['mkdir', '-p', 'src/components', 'src/utils', 'public'] },
      result: shellResult
    });

    // Create package.json
    const packageJson = {
      name: "mock-web-app",
      version: "1.0.0",
      scripts: {
        start: "react-scripts start",
        build: "react-scripts build",
        test: "react-scripts test"
      },
      dependencies: {
        "react": "^18.0.0",
        "react-dom": "^18.0.0",
        "typescript": "^4.9.0"
      }
    };

    this.createFile('/project/package.json', JSON.stringify(packageJson, null, 2));
    fileOperations.push({
      type: 'create',
      path: '/project/package.json',
      content: JSON.stringify(packageJson, null, 2)
    });

    // Create React component
    const appComponent = `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Mock Web Application</h1>
        <p>This is a simulated React application created by the mock agent.</p>
      </header>
    </div>
  );
}

export default App;`;

    this.createFile('/project/src/App.tsx', appComponent);
    fileOperations.push({
      type: 'create',
      path: '/project/src/App.tsx',
      content: appComponent
    });

    messages.push({
      id: `msg-${Date.now()}-progress`,
      type: "message",
      role: "assistant", 
      content: [{ 
        type: "input_text", 
        text: "I'm creating a modern React web application with TypeScript. Setting up the project structure and creating essential files..." 
      }],
    });
  }

  private async simulateWebSearch(
    query: string,
    messages: Array<ResponseItem>,
    functionCalls: Array<{ name: string; args: any; result: any }>
  ) {
    const searchResult = await this.mockWebSearch(query, { maxResults: 5 });
    functionCalls.push({
      name: 'web_search',
      args: { query, maxResults: 5 },
      result: searchResult
    });

    messages.push({
      id: `msg-${Date.now()}-search`,
      type: "message",
      role: "assistant",
      content: [{ 
        type: "input_text", 
        text: `I found ${searchResult.results.length} relevant results for your search. Here are the key findings...` 
      }],
    });
  }

  private async simulateTaskManagement(
    messages: Array<ResponseItem>,
    functionCalls: Array<{ name: string; args: any; result: any }>
  ) {
    // Initialize task management
    let taskResult = await this.mockTaskManagement('init', { projectName: 'mock-project' });
    functionCalls.push({
      name: 'task_management',
      args: { action: 'init', projectName: 'mock-project' },
      result: taskResult
    });

    // Add some tasks
    taskResult = await this.mockTaskManagement('add', { 
      title: 'Set up project structure',
      priority: 'high' 
    });
    functionCalls.push({
      name: 'task_management',
      args: { action: 'add', title: 'Set up project structure', priority: 'high' },
      result: taskResult
    });

    messages.push({
      id: `msg-${Date.now()}-tasks`,
      type: "message",
      role: "assistant",
      content: [{ 
        type: "input_text", 
        text: "I've initialized task management and created initial tasks for your project." 
      }],
    });
  }

  private async simulateBasicOperations(
    messages: Array<ResponseItem>,
    functionCalls: Array<{ name: string; args: any; result: any }>,
    fileOperations: Array<{ type: string; path: string; content?: string }>
  ) {
    // Simple file listing
    const lsResult = await this.mockShellCall(['ls', '-la']);
    functionCalls.push({
      name: 'shell',
      args: { command: ['ls', '-la'] },
      result: lsResult
    });

    // Create a simple file
    const content = "# Hello World\n\nThis is a mock file created by the simulation.";
    this.createFile('/project/hello.md', content);
    fileOperations.push({
      type: 'create',
      path: '/project/hello.md',
      content
    });

    messages.push({
      id: `msg-${Date.now()}-basic`,
      type: "message",
      role: "assistant",
      content: [{ 
        type: "input_text", 
        text: "I've performed basic file operations and created a sample file for you." 
      }],
    });
  }

  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    return `${this.state.currentDir}/${path}`.replace(/\/+/g, '/');
  }

  /**
   * Get current state for inspection
   */
  public getState(): MockAgentState {
    return { ...this.state };
  }

  /**
   * Get all created files
   */
  public getProjectFiles(): Map<string, string> {
    return new Map(this.projectFiles);
  }

  /**
   * Reset mock agent state
   */
  public reset() {
    this.state = {
      currentDir: "/project",
      fileSystem: {
        files: {},
        directories: new Set(["/project"]),
      },
      commandHistory: [],
      webSearchResults: [],
      tasks: [],
    };
    this.projectFiles.clear();
    this.initializeMockFileSystem();
  }
} 