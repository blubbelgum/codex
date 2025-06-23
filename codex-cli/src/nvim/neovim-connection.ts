import * as msgpack from '@msgpack/msgpack';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

export interface NeovimBuffer {
  id: number;
  name: string;
  loaded: boolean;
  modified: boolean;
  lines?: Array<string>;
}

export interface NeovimWindow {
  id: number;
  buffer: number;
  width: number;
  height: number;
}

export interface NeovimTabpage {
  id: number;
  windows: Array<number>;
}

export interface BufferEdit {
  filePath: string;
  startLine: number;
  endLine: number;
  newText: Array<string>;
}

export interface ConnectionInfo {
  socket?: string;
  host?: string;
  port?: number;
  connected: boolean;
  instance?: string;
}

/**
 * Manages direct connection to running Neovim instances
 * Allows real-time buffer manipulation and editing
 */
export class NeovimConnection extends EventEmitter {
  private connection?: net.Socket;
  private connectionInfo: ConnectionInfo = { connected: false };
  private requestId = 1;
  private pendingRequests = new Map<number, { 
    resolve: (value: unknown) => void; 
    reject: (reason?: unknown) => void; 
    timeout: NodeJS.Timeout 
  }>();
  private buffers = new Map<number, NeovimBuffer>();
  private isConnecting = false;
  // Using @msgpack/msgpack - no initialization needed
  private buffer = Buffer.alloc(0);

  constructor() {
    super();
  }

  /**
   * Connect to a running Neovim instance
   */
  async connect(options?: { socket?: string; host?: string; port?: number }): Promise<void> {
    if (this.isConnecting) {
      throw new Error('Already attempting to connect');
    }

    if (this.connectionInfo.connected) {
      throw new Error('Already connected to Neovim');
    }

    this.isConnecting = true;

    try {
      // Try to find a running Neovim instance
      const connectionTarget = options || await this.findNeovimInstance();
      
      if (connectionTarget.socket) {
        await this.connectViaSocket(connectionTarget.socket);
      } else if (connectionTarget.host && connectionTarget.port) {
        await this.connectViaTcp(connectionTarget.host, connectionTarget.port);
      } else {
        throw new Error('No Neovim instance found. Start Neovim with: nvim --listen /tmp/nvim.sock');
      }

      this.connectionInfo = { ...connectionTarget, connected: true };
      this.emit('connected', this.connectionInfo);

      // Initialize connection
      await this.initializeConnection();
      
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from Neovim
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      this.connection.end();
      this.connection = undefined;
    }
    
    this.connectionInfo.connected = false;
    
    // Clear all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    this.buffers.clear();
    this.buffer = Buffer.alloc(0);
    
    this.emit('disconnected');
  }

  /**
   * Check if connected to Neovim
   */
  isConnected(): boolean {
    return this.connectionInfo.connected && !!this.connection;
  }

  /**
   * Get connection information
   */
  getConnectionInfo(): ConnectionInfo {
    return { ...this.connectionInfo };
  }

  /**
   * Find available Neovim instances
   */
  private async findNeovimInstance(): Promise<{ socket?: string; host?: string; port?: number }> {
    // Check for common socket locations
    const socketPaths = [
      '/tmp/nvim.sock',
      path.join(os.tmpdir(), 'nvim.sock'),
      path.join(os.homedir(), '.cache/nvim/server.sock'),
      '/tmp/nvim-1000/0', // Common systemd location
    ];

    for (const socketPath of socketPaths) {
      try {
        await fs.access(socketPath);
        return { socket: socketPath };
      } catch {
        // Socket doesn't exist, try next
      }
    }

    // Try to detect via environment variables
    const nvimListen = process.env['NVIM_LISTEN_ADDRESS'];
    if (nvimListen) {
      if (nvimListen.startsWith('/') || nvimListen.startsWith('./')) {
        return { socket: nvimListen };
      } else if (nvimListen.includes(':')) {
        const parts = nvimListen.split(':');
        const host = parts[0];
        const portStr = parts[1];
        if (host && portStr) {
          return { host, port: parseInt(portStr) };
        }
      }
    }

    throw new Error('No running Neovim instance found');
  }

  /**
   * Connect via Unix socket
   */
  private async connectViaSocket(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = net.createConnection(socketPath);
      
      this.connection.on('connect', () => {
        this.setupConnection();
        resolve();
      });
      
      this.connection.on('error', (error) => {
        reject(new Error(`Failed to connect to Neovim socket: ${error.message}`));
      });
    });
  }

  /**
   * Connect via TCP
   */
  private async connectViaTcp(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = net.createConnection(port, host);
      
      this.connection.on('connect', () => {
        this.setupConnection();
        resolve();
      });
      
      this.connection.on('error', (error) => {
        reject(new Error(`Failed to connect to Neovim TCP: ${error.message}`));
      });
    });
  }

  /**
   * Setup connection event handlers
   */
  private setupConnection(): void {
    if (!this.connection) {return;}

    this.connection.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.processMessages();
    });

    this.connection.on('close', () => {
      this.connectionInfo.connected = false;
      this.emit('disconnected');
    });

    this.connection.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Process incoming MessagePack messages
   */
  private processMessages(): void {
    let offset = 0;
    const _originalLength = this.buffer.length;
    
    while (offset < this.buffer.length) {
      try {
        // Create a slice from the current offset
        const remainingBuffer = this.buffer.slice(offset);
        
        if (remainingBuffer.length === 0) {
          break;
        }
        
        let decoded: unknown;
        let bytesConsumed = 0;
        
        try {
          // Try to decode a message from the remaining buffer
          decoded = msgpack.decode(remainingBuffer);
          
          // Calculate bytes consumed by encoding the decoded message
          const encoded = msgpack.encode(decoded);
          bytesConsumed = encoded.length;
          
        } catch (error: unknown) {
          // Check if it's a "not enough data" error
          const errorMessage = error instanceof Error ? error.message : '';
          if (errorMessage.includes('not enough') || 
              errorMessage.includes('unexpected end') || 
              errorMessage.includes('Insufficient data')) {
            // Not enough data for a complete message, wait for more
            break;
          }
          
          // Other decoding error, skip one byte and try again
          offset += 1;
          continue;
        }
        
        if (bytesConsumed === 0) {
          // Avoid infinite loop if no bytes were consumed
          offset += 1;
          continue;
        }
        
        // Successfully decoded a message
        this.handleResponse(decoded);
        offset += bytesConsumed;
        
      } catch (error) {
        // Fallback: skip one byte and continue
        offset += 1;
      }
    }
    
    // Remove processed bytes from the buffer
    if (offset > 0) {
      this.buffer = this.buffer.slice(offset);
    }
  }

  /**
   * Handle responses from Neovim
   */
  private handleResponse(response: unknown): void {
    // MessagePack RPC format: [type, msgid, error, result] for responses
    // or [type, method, params] for notifications
    if (Array.isArray(response) && response.length >= 3) {
      const [type, msgid, error, result] = response;
      
      if (type === 1 && this.pendingRequests.has(msgid)) { // Response
        const request = this.pendingRequests.get(msgid)!;
        this.pendingRequests.delete(msgid);
        clearTimeout(request.timeout);
        
        if (error) {
          request.reject(new Error(error.toString()));
        } else {
          request.resolve(result);
        }
      } else if (type === 2) { // Notification
        // Handle notifications if needed
        this.emit('notification', { method: msgid, params: error });
      }
    }
  }

  /**
   * Send RPC request to Neovim
   */
  private async sendRequest(method: string, params: Array<any> = []): Promise<any> {
    if (!this.connection || !this.connectionInfo.connected) {
      throw new Error('Not connected to Neovim');
    }

    const id = this.requestId++;
    // MessagePack RPC format: [type, msgid, method, params]
    const request = [0, id, method, params];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 10000); // Increased timeout to 10 seconds

      this.pendingRequests.set(id, { resolve, reject, timeout });

      try {
        const encoded = msgpack.encode(request);
        // @msgpack/msgpack returns Uint8Array, convert to Buffer
        const buffer = Buffer.from(encoded);
        this.connection!.write(buffer);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new Error(`Failed to encode request: ${error}`));
      }
    });
  }

  /**
   * Initialize connection and gather basic info
   */
  private async initializeConnection(): Promise<void> {
    // Get Neovim API info
    const apiInfo = await this.sendRequest('nvim_get_api_info');
    this.emit('api-info', apiInfo);

    // Load current buffers
    await this.refreshBuffers();
  }

  /**
   * Refresh buffer list
   */
  async refreshBuffers(): Promise<Array<NeovimBuffer>> {
    const bufferIds = await this.sendRequest('nvim_list_bufs');
    const buffers: Array<NeovimBuffer> = [];

    // Collect all buffer data promises
    const bufferPromises = bufferIds.map(async (bufferId: number) => {
      try {
        const name = await this.sendRequest('nvim_buf_get_name', [bufferId]);
        const loaded = await this.sendRequest('nvim_buf_is_loaded', [bufferId]);
        const modified = await this.sendRequest('nvim_buf_get_option', [bufferId, 'modified']);

        const buffer: NeovimBuffer = {
          id: bufferId,
          name,
          loaded,
          modified
        };

        if (loaded) {
          buffer.lines = await this.sendRequest('nvim_buf_get_lines', [bufferId, 0, -1, false]);
        }

        return buffer;
      } catch (error) {
        // Skip invalid buffers
        return null;
      }
    });

    // Wait for all buffer data to be loaded
    const bufferResults = await Promise.all(bufferPromises);
    
    // Filter out null results and update the buffers map
    for (const buffer of bufferResults) {
      if (buffer) {
        buffers.push(buffer);
        this.buffers.set(buffer.id, buffer);
      }
    }

    return buffers;
  }

  /**
   * Get buffer list
   */
  async getBufferList(): Promise<Array<NeovimBuffer>> {
    await this.refreshBuffers();
    return Array.from(this.buffers.values());
  }

  /**
   * Get buffer by file path
   */
  async getBufferByPath(filePath: string): Promise<NeovimBuffer | null> {
    const absolutePath = path.resolve(filePath);
    
    for (const buffer of this.buffers.values()) {
      if (buffer.name === absolutePath) {
        return buffer;
      }
    }

    // Try to refresh buffers in case it's newly opened
    await this.refreshBuffers();
    
    for (const buffer of this.buffers.values()) {
      if (buffer.name === absolutePath) {
        return buffer;
      }
    }

    return null;
  }

  /**
   * Open a file in Neovim
   */
  async openFile(filePath: string): Promise<NeovimBuffer> {
    const absolutePath = path.resolve(filePath);
    
    // Check if already open
    const existingBuffer = await this.getBufferByPath(absolutePath);
    if (existingBuffer) {
      return existingBuffer;
    }

    // Open the file
    await this.sendRequest('nvim_command', [`edit ${absolutePath}`]);
    
    // Get the new buffer
    const buffer = await this.getBufferByPath(absolutePath);
    if (!buffer) {
      throw new Error(`Failed to open file: ${filePath}`);
    }

    return buffer;
  }

  /**
   * Edit buffer directly
   */
  async editBuffer(edit: BufferEdit): Promise<void> {
    const buffer = await this.getBufferByPath(edit.filePath);
    if (!buffer) {
      throw new Error(`Buffer not found for file: ${edit.filePath}`);
    }

    // Apply the edit
    await this.sendRequest('nvim_buf_set_lines', [
      buffer.id,
      edit.startLine,
      edit.endLine,
      false,
      edit.newText
    ]);

    // Update our buffer cache
    if (buffer.lines) {
      buffer.lines.splice(edit.startLine, edit.endLine - edit.startLine, ...edit.newText);
    }

    this.emit('buffer-edited', { buffer: buffer.id, edit });
  }

  /**
   * Replace entire buffer content
   */
  async replaceBufferContent(filePath: string, content: string): Promise<void> {
    const buffer = await this.getBufferByPath(filePath);
    if (!buffer) {
      throw new Error(`Buffer not found for file: ${filePath}`);
    }

    const lines = content.split('\n');
    
    // Replace all content
    await this.sendRequest('nvim_buf_set_lines', [
      buffer.id,
      0,
      -1,
      false,
      lines
    ]);

    // Update our buffer cache
    buffer.lines = lines;

    this.emit('buffer-replaced', { buffer: buffer.id, filePath });
  }

  /**
   * Get buffer content
   */
  async getBufferContent(filePath: string): Promise<string> {
    const buffer = await this.getBufferByPath(filePath);
    if (!buffer) {
      throw new Error(`Buffer not found for file: ${filePath}`);
    }

    const lines = await this.sendRequest('nvim_buf_get_lines', [buffer.id, 0, -1, false]);
    return lines.join('\n');
  }

  /**
   * Save buffer
   */
  async saveBuffer(filePath: string): Promise<void> {
    const buffer = await this.getBufferByPath(filePath);
    if (!buffer) {
      throw new Error(`Buffer not found for file: ${filePath}`);
    }

    // Use nvim_exec_lua to save the specific buffer with proper Lua syntax
    await this.sendRequest('nvim_exec_lua', [
      `
      local bufnr = ...
      vim.api.nvim_buf_call(bufnr, function()
        vim.cmd('write')
      end)
      `,
      [buffer.id]
    ]);
    this.emit('buffer-saved', { buffer: buffer.id, filePath });
  }

  /**
   * Get current cursor position
   */
  async getCursorPosition(): Promise<{ line: number; column: number }> {
    const position = await this.sendRequest('nvim_win_get_cursor', [0]);
    return { line: position[0] - 1, column: position[1] }; // Convert to 0-based
  }

  /**
   * Set cursor position
   */
  async setCursorPosition(line: number, column: number): Promise<void> {
    await this.sendRequest('nvim_win_set_cursor', [0, [line + 1, column]]); // Convert to 1-based
  }

  /**
   * Execute Neovim command
   */
  async executeCommand(command: string): Promise<unknown> {
    return this.sendRequest('nvim_command', [command]);
  }

  /**
   * Evaluate Neovim expression
   */
  async evaluate(expression: string): Promise<unknown> {
    return this.sendRequest('nvim_eval', [expression]);
  }
}

export default NeovimConnection; 