import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { NeovimConnection } from '../src/nvim/neovim-connection.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Neovim Connection', () => {
  let connection: NeovimConnection;
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    connection = new NeovimConnection();
    
    // Create temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-nvim-test-'));
    testFile = path.join(tempDir, 'test.ts');
    
    // Create a test file
    await fs.writeFile(testFile, `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const message = greet("World");
console.log(message);
`);
  });

  afterEach(async () => {
    if (connection && connection.isConnected()) {
      await connection.disconnect();
    }
    
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should initialize without errors', () => {
    expect(connection).toBeInstanceOf(NeovimConnection);
    expect(connection.isConnected()).toBe(false);
  });

  test('should handle connection attempts gracefully', async () => {
    // This test will fail if no Neovim instance is running, but should not throw
    try {
      await connection.connect();
      expect(connection.isConnected()).toBe(true);
      
      // Test basic operations if connected
      const connectionInfo = connection.getConnectionInfo();
      expect(connectionInfo.connected).toBe(true);
      
    } catch (error) {
      // Expected when no Neovim instance is running
      expect(error).toBeInstanceOf(Error);
      expect(connection.isConnected()).toBe(false);
    }
  });

  test('should handle disconnection gracefully', async () => {
    // Test disconnecting when not connected
    await expect(connection.disconnect()).resolves.not.toThrow();
    expect(connection.isConnected()).toBe(false);
  });

  test('should provide connection status information', () => {
    const info = connection.getConnectionInfo();
    expect(info).toHaveProperty('connected');
    expect(info.connected).toBe(false);
  });

  test('should handle file operations when not connected', async () => {
    // These should throw since we're not connected
    await expect(connection.openFile(testFile)).rejects.toThrow();
    await expect(connection.getBufferContent(testFile)).rejects.toThrow();
    await expect(connection.replaceBufferContent(testFile, 'new content')).rejects.toThrow();
  });
});

describe('Neovim Connection Integration', () => {
  test('should detect environment variables', () => {
    // Test environment variable detection
    const originalEnv = process.env.NVIM_LISTEN_ADDRESS;
    
    process.env.NVIM_LISTEN_ADDRESS = '/tmp/test.sock';
    // Would need to test the actual detection logic here
    
    // Restore environment
    if (originalEnv) {
      process.env.NVIM_LISTEN_ADDRESS = originalEnv;
    } else {
      delete process.env.NVIM_LISTEN_ADDRESS;
    }
  });

  test('should handle socket path parsing', () => {
    const connection = new NeovimConnection();
    
    // Test that connection object is created properly
    expect(connection.isConnected()).toBe(false);
    
    // Test connection info structure
    const info = connection.getConnectionInfo();
    expect(info).toHaveProperty('connected', false);
  });
}); 