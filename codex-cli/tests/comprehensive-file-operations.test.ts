import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleExecCommand } from '../src/utils/agent/handle-exec-command.js';

// Mock dependencies
vi.mock('../src/utils/agent/log.js', () => ({
  log: vi.fn(),
  isLoggingEnabled: () => false,
}));

vi.mock('../src/approvals.js', () => ({
  canAutoApprove: () => ({ type: 'auto-approve', runInSandbox: false }),
  alwaysApprovedCommands: new Set(),
}));

vi.mock('../src/format-command.js', () => ({
  formatCommandForDisplay: (cmd: Array<string>) => cmd.join(' '),
}));

describe('Comprehensive File Operations Tests', () => {
  let tempDir: string;
  let testFiles: Map<string, string>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-file-ops-test-'));
    testFiles = new Map();
    
    // Create test files with various content patterns
    const serverContent = `#!/usr/bin/env bash

# Simple Bash HTTP server
echo "Starting server..."

function handle_request() {
  local request="$1"
  echo "Cmd line: $request"
  
  if [[ "$request" == *"health"* ]]; then
    echo "HTTP/1.1 200 OK"
    echo "Content-Type: text/plain"
    echo ""
    echo "OK"
  fi
}

# Main server loop
while true; do
  read -r request
  handle_request "$request"
done`;
    
    const jsContent = `function hello() {
  console.log("hello world");
  return "hello";
}

class TestClass {
  constructor() {
    this.name = "test";
  }
  
  getName() {
    return this.name;
  }
}`;
    
    testFiles.set('server.sh', serverContent);
    testFiles.set('test.js', jsContent);
    
    // Write test files
    for (const [filename, content] of testFiles) {
      fs.writeFileSync(path.join(tempDir, filename), content, 'utf8');
    }
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('File operations now use OpenCode-style function calls', () => {
    const createMockConfig = () => ({
      model: 'test',
      instructions: '',
      notify: false,
    });

    const createMockPolicy = () => ({ mode: 'auto' } as any);

    it('should handle multi_edit operations efficiently', async () => {
      const command = ['opencode-tool', 'multi_edit', JSON.stringify({
        operations: [
          {
            filePath: "test.js",
            edits: [
              { old_string: "hello world", new_string: "Hello World" }
            ]
          }
        ]
      })];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      expect(result.metadata['operation']).toBe('multi_edit');
      if (!result.metadata['error']) {
        const updatedContent = fs.readFileSync(path.join(tempDir, 'test.js'), 'utf8');
        expect(updatedContent).toContain('Hello World');
      }
      
      const parsed = JSON.parse(result.outputText);
      expect(parsed.metadata.atomic).toBe(true);
    });

    it('should handle individual edit operations', async () => {
      const command = ['opencode-tool', 'edit', JSON.stringify({
        filePath: "test.js",
        search: "hello world",
        replace: "Hello World"
      })];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      if (!result.metadata['error']) {
        const updatedContent = fs.readFileSync(path.join(tempDir, 'test.js'), 'utf8');
        expect(updatedContent).toContain('Hello World');
      }
      
      expect(result.metadata['operation']).toBe('edit');
    });

    it('should handle write operations', async () => {
      const newContent = 'console.log("New file content");';
      const command = ['opencode-tool', 'write', JSON.stringify({
        filePath: "new-file.js",
        content: newContent
      })];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      if (!result.metadata['error']) {
        const fileContent = fs.readFileSync(path.join(tempDir, 'new-file.js'), 'utf8');
        expect(fileContent).toBe(newContent);
      }
      
      expect(result.metadata['operation']).toBe('write');
    });

    it('should handle read operations', async () => {
      const command = ['opencode-tool', 'read', JSON.stringify({
        filePath: "test.js"
      })];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      expect(result.metadata['operation']).toBe('read');
      const parsed = JSON.parse(result.outputText);
      expect(parsed.output).toContain('function hello()');
    });
  });

  describe('Error handling and validation', () => {
    const createMockConfig = () => ({
      model: 'test',
      instructions: '',
      notify: false,
    });

    const createMockPolicy = () => ({ mode: 'auto' } as any);

    it('should provide helpful error for invalid JSON in OpenCode tool args', async () => {
      const command = ['opencode-tool', 'edit', '{"filePath": "test.js" "search": "hello"}'];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      expect(result.metadata['error']).toBe('invalid_json');
      const parsed = JSON.parse(result.outputText);
      expect(parsed.output).toContain('Invalid tool arguments JSON');
    });

    it('should provide helpful error for missing file', async () => {
      const command = ['opencode-tool', 'edit', JSON.stringify({
        filePath: "nonexistent.js",
        search: "hello",
        replace: "hi"
      })];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      expect(result.metadata['error']).toBe('edit_failed');
      const parsed = JSON.parse(result.outputText);
      expect(parsed.output).toContain('File does not exist');
    });

    it('should provide helpful error for missing parameters', async () => {
      const command = ['opencode-tool', 'edit', JSON.stringify({
        filePath: "test.js"
        // Missing search and replace parameters
      })];

      const result = await handleExecCommand(
        { cmd: command, workdir: tempDir },
        createMockConfig(),
        createMockPolicy(),
        [tempDir],
        async () => ({ review: 'yes' }) as any
      );

      expect(result.metadata['error']).toBe('missing_parameter');
      const parsed = JSON.parse(result.outputText);
      expect(parsed.output).toContain('search, and replace are required');
    });
  });
}); 