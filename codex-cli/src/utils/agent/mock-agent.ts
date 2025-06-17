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
        case 'apply_patch':
          output = this.mockApplyPatchCommand(args);
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

    const filePath = this.resolvePath(args[0]!);
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
    const dirPath = args[args.length - 1]!;
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

    const filePath = this.resolvePath(args[0]!);
    
    if (!this.fileExists(filePath)) {
      this.createFile(filePath, '');
    }

    return `File touched: ${args[0]}`;
  }

  private mockCdCommand(args: Array<string>): string {
    if (args.length === 0) {
      this.state.currentDir = '/project';
    } else {
      const targetDir = this.resolvePath(args[0]!);
      if (this.state.fileSystem.directories.has(targetDir)) {
        this.state.currentDir = targetDir;
      } else {
        throw new Error(`cd: ${args[0]}: No such file or directory`);
      }
    }
    return '';
  }

  private mockNpmCommand(args: Array<string>): string {
    const subcommand = args[0] || '';
    
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
        return `Running script: ${args[1] || ''}`;
      default:
        return `npm ${args.join(' ')} - Mock execution completed`;
    }
  }

  private mockNodeCommand(args: Array<string>): string {
    if (args.length === 0) {
      return 'Welcome to Node.js v18.0.0.';
    }

    const fileName = args[0]!;
    const filePath = this.resolvePath(fileName);
    
    if (!this.fileExists(filePath)) {
      throw new Error(`Error: Cannot find module '${fileName}'`);
    }

    return `Executing ${fileName}...\nScript completed successfully.`;
  }

  private mockGitCommand(args: Array<string>): string {
    const subcommand = args[0] || '';
    
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
        return `Cloning into '${args[1] || 'repository'}'...\nremote: Counting objects: 100, done.`;
      default:
        return `git ${args.join(' ')} - Mock execution completed`;
    }
  }

  private mockApplyPatchCommand(args: Array<string>): string {
    if (args.length < 2) {
      throw new Error('apply_patch: missing patch content');
    }

    const patchContent = args[1];
    if (!patchContent) {
      throw new Error('apply_patch: patch content is empty');
    }

    this.log('Applying patch', { patchContent });

    // Parse patch content and simulate file operations
    const lines = patchContent.split('\n');
    let currentFile = '';
    let created = 0;
    let modified = 0;

    for (const line of lines) {
      if (line.startsWith('*** Add File: ')) {
        currentFile = line.replace('*** Add File: ', '').trim();
        const filePath = this.resolvePath(currentFile);
        this.createFile(filePath, '');
        created++;
      } else if (line.startsWith('*** Update File: ')) {
        currentFile = line.replace('*** Update File: ', '').trim();
        modified++;
      } else if (line.startsWith('+') && currentFile) {
        const filePath = this.resolvePath(currentFile);
        const content = line.substring(1);
        const existing = this.readFile(filePath) || '';
        this.createFile(filePath, existing + content + '\n');
      }
    }

    return `Patch applied successfully.\nFiles created: ${created}\nFiles modified: ${modified}`;
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