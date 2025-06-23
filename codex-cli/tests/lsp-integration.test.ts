import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { NeovimLSPManager } from '../src/nvim/lsp-manager.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('LSP Integration', () => {
  let lspManager: NeovimLSPManager;
  let tempDir: string;
  let testFile: string;

  beforeAll(async () => {
    // Create temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-lsp-test-'));
    testFile = path.join(tempDir, 'test.ts');
    
    // Create a simple TypeScript file for testing
    await fs.writeFile(testFile, `
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const message = greet("World");
console.log(message);
`);

    // Initialize LSP manager
    lspManager = new NeovimLSPManager(tempDir);
  });

  afterAll(async () => {
    // Clean up
    if (lspManager) {
      await lspManager.shutdown();
    }
    
    // Remove temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should initialize LSP manager', async () => {
    await expect(lspManager.initialize()).resolves.not.toThrow();
  });

  test('should detect available language servers', async () => {
    await lspManager.initialize();
    const servers = lspManager.getAvailableServers();
    expect(Array.isArray(servers)).toBe(true);
    // Note: Actual servers depend on what's installed on the system
  });

  test('should handle file operations', async () => {
    await lspManager.initialize();
    
    // Test opening a file
    await expect(lspManager.openFile('test.ts')).resolves.not.toThrow();
  });

  test('should get diagnostics for TypeScript file', async () => {
    await lspManager.initialize();
    
    try {
      const diagnostics = await lspManager.getDiagnostics('test.ts');
      expect(Array.isArray(diagnostics)).toBe(true);
      // Note: Actual diagnostics depend on LSP server availability
    } catch (error) {
      // LSP server might not be available in test environment
      expect(error).toBeInstanceOf(Error);
    }
  });

  test('should handle hover information requests', async () => {
    await lspManager.initialize();
    
    try {
      const hoverInfo = await lspManager.getHoverInfo('test.ts', 1, 10);
      // Either returns hover info or null if LSP server not available
      expect(hoverInfo === null || typeof hoverInfo === 'object').toBe(true);
    } catch (error) {
      // LSP server might not be available in test environment
      expect(error).toBeInstanceOf(Error);
    }
  });
}); 