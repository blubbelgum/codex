import { CodeIntelligenceEngine } from '../utils/agent/code-intelligence.js';
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

export interface LSPServerConfig {
  name: string;
  cmd: Array<string>;
  filetypes: Array<string>;
  rootPatterns: Array<string>;
  initializationOptions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPTextEdit {
  range: LSPRange;
  newText: string;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity: number;
  message: string;
  source?: string;
  code?: string | number;
}

export interface LSPCompletionItem {
  label: string;
  kind: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  textEdit?: LSPTextEdit;
}

export interface LSPHover {
  contents: string | Array<{ language: string; value: string }>;
  range?: LSPRange;
}

// Define the LSP server instance type
type LSPServerInstance = LanguageServer;

export class NeovimLSPManager extends EventEmitter {
  private workingDirectory: string;
  private configPath: string;
  private servers: Map<string, LSPServerInstance> = new Map();
  private codeIntelligence: CodeIntelligenceEngine;
  private activeConnections: Map<string, unknown> = new Map();
  private nvimProcess?: ChildProcess;
  
  constructor(workingDirectory: string) {
    super();
    this.workingDirectory = workingDirectory;
    this.configPath = path.join(workingDirectory, 'nvim_lsp_config.lua');
    this.codeIntelligence = new CodeIntelligenceEngine(workingDirectory);
  }

  /**
   * Initialize LSP integration with Neovim
   */
  async initialize(): Promise<void> {
    // Start Neovim in headless mode with LSP configuration
    await this.startNeovim();
    
    // Auto-detect and configure language servers
    await this.detectAndConfigureLanguageServers();
    
    // Set up communication bridge
    await this.setupCommunicationBridge();
    
    this.emit('initialized');
  }

  /**
   * Start Neovim in headless mode
   */
  private async startNeovim(): Promise<void> {
    const nvimConfig = await this.generateNeovimConfig();
    
    // Write temporary config
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, nvimConfig);
    
    // Start Neovim with our config
    this.nvimProcess = spawn('nvim', [
      '--headless',
      '--listen', '127.0.0.1:0', // Let Neovim choose the port
      '-u', this.configPath,
      '+set noswapfile',
      '+set nobackup'
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.workingDirectory
    });

    this.nvimProcess.on('error', (error) => {
      this.emit('error', `Neovim process error: ${error.message}`);
    });

    this.nvimProcess.on('exit', (code) => {
      this.emit('nvim-exit', code);
    });

    // Wait for Neovim to be ready
    await this.waitForNeovimReady();
  }

  /**
   * Generate Neovim configuration for LSP
   */
  private async generateNeovimConfig(): Promise<string> {
    return `
-- Codex CLI Neovim LSP Configuration
vim.opt.compatible = false

-- Enable LSP
vim.lsp.set_log_level("info")

-- Auto-configure language servers
local servers = {
  typescript = {
    cmd = { 'typescript-language-server', '--stdio' },
    filetypes = { 'javascript', 'typescript', 'javascriptreact', 'typescriptreact' },
    root_markers = { 'package.json', 'tsconfig.json', 'jsconfig.json' }
  },
  python = {
    cmd = { 'pylsp' },
    filetypes = { 'python' },
    root_markers = { 'pyproject.toml', 'setup.py', 'requirements.txt' }
  },
  rust = {
    cmd = { 'rust-analyzer' },
    filetypes = { 'rust' },
    root_markers = { 'Cargo.toml' }
  },
  go = {
    cmd = { 'gopls' },
    filetypes = { 'go', 'gomod', 'gowork', 'gotmpl' },
    root_markers = { 'go.mod', 'go.work' }
  },
  lua = {
    cmd = { 'lua-language-server' },
    filetypes = { 'lua' },
    root_markers = { '.luarc.json', '.luarc.jsonc' }
  }
}

-- Configure each server
for name, config in pairs(servers) do
  vim.lsp.config[name] = {
    cmd = config.cmd,
    filetypes = config.filetypes,
    root_markers = config.root_markers,
    capabilities = vim.lsp.protocol.make_client_capabilities(),
    on_attach = function(client, bufnr)
      -- Enhanced capabilities
      vim.bo[bufnr].omnifunc = 'v:lua.vim.lsp.omnifunc'
      
      -- Enable completion
      if client:supports_method('textDocument/completion') then
        vim.lsp.completion.enable(true, client.id, bufnr, { autotrigger = false })
      end
      
      -- Enable semantic tokens
      if client:supports_method('textDocument/semanticTokens') then
        vim.lsp.semantic_tokens.start(bufnr, client.id)
      end
    end
  }
  
  vim.lsp.enable(name)
end

-- Set up autocommands for file type detection
vim.api.nvim_create_autocmd('FileType', {
  callback = function(args)
    -- Auto-attach appropriate LSP servers
    local ft = vim.bo[args.buf].filetype
    for name, config in pairs(servers) do
      for _, filetype in ipairs(config.filetypes) do
        if ft == filetype then
          -- Server will auto-attach via vim.lsp.enable
          break
        end
      end
    end
  end
})

-- Enable diagnostic display
vim.diagnostic.config({
  virtual_text = true,
  signs = true,
  underline = true,
  update_in_insert = false,
  severity_sort = true,
})

-- Global LSP handlers for Codex integration
vim.lsp.handlers['textDocument/hover'] = function(err, result, ctx, config)
  if err then return end
  if not result or not result.contents then return end
  
  -- Send hover info back to Codex
  vim.rpcnotify(0, 'codex_lsp_hover', {
    bufnr = ctx.bufnr,
    contents = result.contents,
    range = result.range
  })
  
  return vim.lsp.handlers.hover(err, result, ctx, config)
end

vim.lsp.handlers['textDocument/publishDiagnostics'] = function(err, result, ctx, config)
  if err then return end
  
  -- Send diagnostics to Codex
  vim.rpcnotify(0, 'codex_lsp_diagnostics', {
    uri = result.uri,
    diagnostics = result.diagnostics
  })
  
  return vim.lsp.handlers['textDocument/publishDiagnostics'](err, result, ctx, config)
end

-- Ready signal
vim.rpcnotify(0, 'codex_nvim_ready')
`;
  }

  /**
   * Detect available language servers and configure them
   */
  private async detectAndConfigureLanguageServers(): Promise<void> {
    const languageConfigs: Array<LSPServerConfig> = [
      {
        name: 'typescript',
        cmd: ['typescript-language-server', '--stdio'],
        filetypes: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
        rootPatterns: ['package.json', 'tsconfig.json', 'jsconfig.json']
      },
      {
        name: 'python',
        cmd: ['pylsp'],
        filetypes: ['python'],
        rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt']
      },
      {
        name: 'rust',
        cmd: ['rust-analyzer'],
        filetypes: ['rust'],
        rootPatterns: ['Cargo.toml']
      },
      {
        name: 'go',
        cmd: ['gopls'],
        filetypes: ['go', 'gomod', 'gowork', 'gotmpl'],
        rootPatterns: ['go.mod', 'go.work']
      },
      {
        name: 'lua',
        cmd: ['lua-language-server'],
        filetypes: ['lua'],
        rootPatterns: ['.luarc.json', '.luarc.jsonc']
      }
    ];

    // Check which language servers are available
    for (const config of languageConfigs) {
      const isAvailable = await this.checkLanguageServerAvailability(config.cmd[0]);
      if (isAvailable) {
        const server = new LanguageServer(config, this.workingDirectory);
        this.servers.set(config.name, server);
        console.log(`✅ Configured LSP: ${config.name}`);
      } else {
        console.log(`⚠️  LSP not available: ${config.name} (${config.cmd[0]} not found)`);
      }
    }
  }

  /**
   * Check if a language server is available
   */
  private async checkLanguageServerAvailability(command: string): Promise<boolean> {
    try {
      const { spawn } = await import('child_process');
      const process = spawn(command, ['--version'], { stdio: 'pipe' });
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          process.kill();
          resolve(false);
        }, 3000);
        
        process.on('exit', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });
        
        process.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * Wait for Neovim to be ready
   */
  private async waitForNeovimReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for Neovim to be ready'));
      }, 10000);

      const handleStdout = (data: Buffer) => {
        const output = data.toString();
        if (output.includes('codex_nvim_ready')) {
          clearTimeout(timeout);
          this.nvimProcess?.stdout?.off('data', handleStdout);
          resolve();
        }
      };

      this.nvimProcess?.stdout?.on('data', handleStdout);
    });
  }

  /**
   * Set up communication bridge with Neovim
   */
  private async setupCommunicationBridge(): Promise<void> {
    // Set up RPC communication
    this.nvimProcess?.stdout?.on('data', (data) => {
      this.handleNeovimMessage(data.toString());
    });
  }

  /**
   * Handle messages from Neovim
   */
  private handleNeovimMessage(message: string): void {
    try {
      // Parse RPC messages from Neovim
      const lines = message.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.includes('codex_lsp_')) {
          const event = JSON.parse(line);
          this.emit('lsp-event', event);
        }
      }
    } catch (error) {
      // Ignore parsing errors for non-JSON output
    }
  }

  /**
   * Open a file in Neovim and get LSP capabilities
   */
  async openFile(filePath: string): Promise<void> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    const absolutePath = path.resolve(this.workingDirectory, filePath);
    
    // Send command to Neovim to open the file
    const command = `vim.cmd('edit ${absolutePath}')\\n`;
    this.nvimProcess.stdin.write(command);
    
    this.emit('file-opened', filePath);
  }

  /**
   * Get hover information at a specific position
   */
  async getHoverInfo(filePath: string, line: number, character: number): Promise<LSPHover | null> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      
      const handleHover = (event: any) => {
        if (event.type === 'codex_lsp_hover') {
          clearTimeout(timeout);
          this.off('lsp-event', handleHover);
          resolve(event.data);
        }
      };
      
      this.on('lsp-event', handleHover);
      
      // Move cursor and request hover info
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `vim.api.nvim_win_set_cursor(0, {${line + 1}, ${character}})`,
        `vim.lsp.buf.hover()`,
        `vim.rpcnotify(0, 'codex_lsp_hover', { data = vim.lsp.buf.hover() })`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Get completions at a specific position
   */
  async getCompletions(filePath: string, line: number, character: number): Promise<Array<LSPCompletionItem>> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 5000);
      
      const handleCompletion = (event: any) => {
        if (event.type === 'codex_lsp_completion') {
          clearTimeout(timeout);
          this.off('lsp-event', handleCompletion);
          resolve(event.data.items || []);
        }
      };
      
      this.on('lsp-event', handleCompletion);
      
      // Move cursor to position and request completion
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `vim.api.nvim_win_set_cursor(0, {${line + 1}, ${character}})`,
        `vim.lsp.completion.get()`,
        `vim.rpcnotify(0, 'codex_lsp_completion', { items = vim.lsp.completion.get() })`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Get diagnostics for a file
   */
  async getDiagnostics(filePath: string): Promise<Array<LSPDiagnostic>> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 5000);
      
      const handleDiagnostics = (event: any) => {
        if (event.type === 'codex_lsp_diagnostics' && event.data.uri.includes(filePath)) {
          clearTimeout(timeout);
          this.off('lsp-event', handleDiagnostics);
          resolve(event.data.diagnostics || []);
        }
      };
      
      this.on('lsp-event', handleDiagnostics);
      
      // Open file and get diagnostics
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `local diagnostics = vim.diagnostic.get(0)`,
        `vim.rpcnotify(0, 'codex_lsp_diagnostics', { uri = '${filePath}', diagnostics = diagnostics })`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Format a file using LSP
   */
  async formatFile(filePath: string): Promise<Array<LSPTextEdit>> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 10000);
      
      const handleFormat = (event: any) => {
        if (event.type === 'codex_lsp_format') {
          clearTimeout(timeout);
          this.off('lsp-event', handleFormat);
          resolve(event.data.edits || []);
        }
      };
      
      this.on('lsp-event', handleFormat);
      
      // Open file and format
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `vim.lsp.buf.format({ async = false })`,
        `vim.rpcnotify(0, 'codex_lsp_format', { edits = {} })`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Go to definition
   */
  async goToDefinition(filePath: string, line: number, character: number): Promise<any> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      
      const handleDefinition = (event: any) => {
        if (event.type === 'codex_lsp_definition') {
          clearTimeout(timeout);
          this.off('lsp-event', handleDefinition);
          resolve(event.data);
        }
      };
      
      this.on('lsp-event', handleDefinition);
      
      // Move cursor and get definition
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `vim.api.nvim_win_set_cursor(0, {${line + 1}, ${character}})`,
        `local result = vim.lsp.buf_request_sync(0, 'textDocument/definition', vim.lsp.util.make_position_params(), 5000)`,
        `vim.rpcnotify(0, 'codex_lsp_definition', result)`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Find references
   */
  async findReferences(filePath: string, line: number, character: number): Promise<Array<any>> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 5000);
      
      const handleReferences = (event: any) => {
        if (event.type === 'codex_lsp_references') {
          clearTimeout(timeout);
          this.off('lsp-event', handleReferences);
          resolve(event.data || []);
        }
      };
      
      this.on('lsp-event', handleReferences);
      
      // Move cursor and find references
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `vim.api.nvim_win_set_cursor(0, {${line + 1}, ${character}})`,
        `local params = vim.lsp.util.make_position_params()`,
        `params.context = { includeDeclaration = true }`,
        `local result = vim.lsp.buf_request_sync(0, 'textDocument/references', params, 5000)`,
        `vim.rpcnotify(0, 'codex_lsp_references', result)`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Rename symbol
   */
  async renameSymbol(filePath: string, line: number, character: number, newName: string): Promise<Array<LSPTextEdit>> {
    if (!this.nvimProcess || !this.nvimProcess.stdin) {
      throw new Error('Neovim not initialized or stdin not available');
    }

    if (!this.workingDirectory) {
      throw new Error('Workspace root not set');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 10000);
      
      const handleRename = (event: any) => {
        if (event.type === 'codex_lsp_rename') {
          clearTimeout(timeout);
          this.off('lsp-event', handleRename);
          resolve(event.data.edits || []);
        }
      };
      
      this.on('lsp-event', handleRename);
      
      // Move cursor and rename
      const commands = [
        `vim.cmd('edit ${path.resolve(this.workingDirectory, filePath)}')`,
        `vim.api.nvim_win_set_cursor(0, {${line + 1}, ${character}})`,
        `local params = vim.lsp.util.make_position_params()`,
        `params.newName = '${newName}'`,
        `local result = vim.lsp.buf_request_sync(0, 'textDocument/rename', params, 10000)`,
        `vim.rpcnotify(0, 'codex_lsp_rename', { edits = result })`
      ];
      
      for (const command of commands) {
        this.nvimProcess!.stdin!.write(`${command}\n`);
      }
    });
  }

  /**
   * Get status of all language servers
   */
  async getServerStatus(): Promise<Array<{ name: string; status: string; language: string }>> {
    const serverStatus: Array<{ name: string; status: string; language: string }> = [];
    
    for (const [name, server] of this.servers) {
      const config = this.getLanguageServerConfigs().find(c => c.name === name);
      serverStatus.push({
        name,
        status: server.isInitialized ? 'active' : 'inactive',
        language: config?.filetypes.join(', ') || 'unknown'
      });
    }
    
    return serverStatus;
  }

  /**
   * Get all diagnostics across all files
   */
  async getAllDiagnostics(): Promise<Array<{ filePath: string; severity: string; message: string; line: number; character: number }>> {
    const allDiagnostics: Array<{ filePath: string; severity: string; message: string; line: number; character: number }> = [];
    
    // Get all TypeScript files in the working directory
    const { glob } = await import('glob');
    const files = await glob('**/*.{ts,tsx,js,jsx,py,rs,go,lua}', { 
      cwd: this.workingDirectory,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
    });
    
    // Get diagnostics for each file
    for (const file of files) {
      try {
        const diagnostics = await this.getDiagnostics(file);
        for (const diagnostic of diagnostics) {
          allDiagnostics.push({
            filePath: file,
            severity: this.mapSeverityToString(diagnostic.severity),
            message: diagnostic.message,
            line: diagnostic.range.start.line,
            character: diagnostic.range.start.character
          });
        }
      } catch (error) {
        // Skip files that can't be processed
        continue;
      }
    }
    
    return allDiagnostics;
  }

  /**
   * Map LSP severity numbers to strings
   */
  private mapSeverityToString(severity: number): string {
    switch (severity) {
      case 1: return 'error';
      case 2: return 'warning';
      case 3: return 'info';
      case 4: return 'hint';
      default: return 'unknown';
    }
  }

  /**
   * Shutdown LSP manager
   */
  async shutdown(): Promise<void> {
    // Close all language servers
    for (const [name, server] of this.servers) {
      await server.shutdown();
    }
    
    // Terminate Neovim process
    if (this.nvimProcess) {
      this.nvimProcess.kill();
      this.nvimProcess = undefined;
    }
    
    this.emit('shutdown');
  }

  /**
   * Get available servers
   */
  getAvailableServers(): Array<string> {
    return Array.from(this.servers.keys());
  }

  /**
   * Get language server configurations
   */
  private getLanguageServerConfigs(): Array<LSPServerConfig> {
    return [
      {
        name: 'typescript',
        cmd: ['typescript-language-server', '--stdio'],
        filetypes: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
        rootPatterns: ['package.json', 'tsconfig.json']
      },
      {
        name: 'python',
        cmd: ['pylsp'],
        filetypes: ['python'],
        rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt']
      },
      {
        name: 'rust',
        cmd: ['rust-analyzer'],
        filetypes: ['rust'],
        rootPatterns: ['Cargo.toml']
      },
      {
        name: 'go',
        cmd: ['gopls'],
        filetypes: ['go'],
        rootPatterns: ['go.mod', 'go.sum']
      },
      {
        name: 'lua',
        cmd: ['lua-language-server'],
        filetypes: ['lua'],
        rootPatterns: ['.luarc.json', '.luarc.jsonc']
      }
    ];
  }
}

/**
 * Individual language server wrapper
 */
class LanguageServer {
  private config: LSPServerConfig;
  private process?: ChildProcess;
  private workingDirectory: string;
  public isInitialized = false;

  constructor(config: LSPServerConfig, workingDirectory: string) {
    this.config = config;
    this.workingDirectory = workingDirectory;
  }

  async start(): Promise<void> {
    if (!this.config.cmd[0]) {
      throw new Error('Invalid LSP server configuration: missing command');
    }
    
    this.process = spawn(this.config.cmd[0], this.config.cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.workingDirectory
    });

    if (!this.process) {
      throw new Error('Failed to start LSP server process');
    }

    this.process.on('error', (error) => {
      console.error(`LSP server error: ${error.message}`);
    });

    // Initialize the language server
    await this.initialize();
  }

  private async initialize(): Promise<void> {
    // Send LSP initialize request
    const initializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri: `file://${this.workingDirectory}`,
        capabilities: {
          textDocument: {
            hover: { dynamicRegistration: true },
            completion: { dynamicRegistration: true },
            definition: { dynamicRegistration: true },
            references: { dynamicRegistration: true },
            formatting: { dynamicRegistration: true },
            diagnostics: { dynamicRegistration: true }
          }
        },
        initializationOptions: this.config.initializationOptions
      }
    };

    this.sendRequest(initializeRequest);
    this.isInitialized = true;
  }

  private sendRequest(request: any): void {
    if (!this.process?.stdin) {return;}
    
    const message = JSON.stringify(request);
    const header = `Content-Length: ${Buffer.byteLength(message)}\\r\\n\\r\\n`;
    this.process.stdin.write(header + message);
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.isInitialized = false;
  }
}

export default NeovimLSPManager; 