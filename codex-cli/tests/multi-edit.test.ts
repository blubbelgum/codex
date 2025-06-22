import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleUnifiedDiffCommand } from '../src/utils/agent/handle-unified-diff.js';

describe('Multi-Edit Batch Processing', () => {
  let tempDir: string;
  let testFiles: Map<string, string>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-multi-edit-test-'));
    testFiles = new Map();
    
    // Create test files
    const file1Content = `function hello() {
  console.log("hello world");
  return "hello";
}`;
    
    const file2Content = `class TestClass {
  constructor() {
    this.name = "test";
  }
  
  getName() {
    return this.name;
  }
}`;
    
    const file3Content = `const config = {
  debug: false,
  timeout: 5000
};`;
    
    testFiles.set('file1.js', file1Content);
    testFiles.set('file2.js', file2Content);
    testFiles.set('file3.js', file3Content);
    
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

  it('should apply single edit to single file', () => {
    const operations = [{
      filePath: 'file1.js',
      edits: [{
        old_string: 'console.log("hello world");',
        new_string: 'console.log("Hello, World!");'
      }]
    }];

    const result = handleUnifiedDiffCommand({ operations, workdir: tempDir });
    
    expect(result).toContain('Applied 1 edits to file1.js');
    
    const updatedContent = fs.readFileSync(path.join(tempDir, 'file1.js'), 'utf8');
    expect(updatedContent).toContain('console.log("Hello, World!");');
    expect(updatedContent).not.toContain('console.log("hello world");');
  });

  it('should apply multiple edits to single file', () => {
    const operations = [{
      filePath: 'file1.js',
      edits: [
        {
          old_string: 'console.log("hello world");',
          new_string: 'console.log("Hello, World!");'
        },
        {
          old_string: 'return "hello";',
          new_string: 'return "Hello";'
        }
      ]
    }];

    const result = handleUnifiedDiffCommand({ operations, workdir: tempDir });
    
    expect(result).toContain('Applied 2 edits to file1.js');
    
    const updatedContent = fs.readFileSync(path.join(tempDir, 'file1.js'), 'utf8');
    expect(updatedContent).toContain('console.log("Hello, World!");');
    expect(updatedContent).toContain('return "Hello";');
  });

  it('should apply edits to multiple files atomically', () => {
    const operations = [
      {
        filePath: 'file1.js',
        edits: [{
          old_string: 'function hello()',
          new_string: 'function greet()'
        }]
      },
      {
        filePath: 'file2.js',
        edits: [{
          old_string: 'this.name = "test";',
          new_string: 'this.name = "TestName";'
        }]
      },
      {
        filePath: 'file3.js',
        edits: [{
          old_string: 'debug: false',
          new_string: 'debug: true'
        }]
      }
    ];

    const result = handleUnifiedDiffCommand({ operations, workdir: tempDir });
    
    expect(result).toContain('Applied 1 edits to file1.js');
    expect(result).toContain('Applied 1 edits to file2.js');
    expect(result).toContain('Applied 1 edits to file3.js');
    
    // Verify all files were updated
    const file1Content = fs.readFileSync(path.join(tempDir, 'file1.js'), 'utf8');
    const file2Content = fs.readFileSync(path.join(tempDir, 'file2.js'), 'utf8');
    const file3Content = fs.readFileSync(path.join(tempDir, 'file3.js'), 'utf8');
    
    expect(file1Content).toContain('function greet()');
    expect(file2Content).toContain('this.name = "TestName";');
    expect(file3Content).toContain('debug: true');
  });

  it('should rollback all changes if any edit fails', () => {
    // Store original content
    const originalFile1 = fs.readFileSync(path.join(tempDir, 'file1.js'), 'utf8');
    const originalFile2 = fs.readFileSync(path.join(tempDir, 'file2.js'), 'utf8');
    
    const operations = [
      {
        filePath: 'file1.js',
        edits: [{
          old_string: 'function hello()',
          new_string: 'function greet()'
        }]
      },
      {
        filePath: 'file2.js',
        edits: [{
          old_string: 'NON_EXISTENT_TEXT', // This will fail
          new_string: 'replacement'
        }]
      }
    ];

    expect(() => {
      handleUnifiedDiffCommand({ operations, workdir: tempDir });
    }).toThrow();
    
    // Verify rollback - files should be unchanged
    const file1Content = fs.readFileSync(path.join(tempDir, 'file1.js'), 'utf8');
    const file2Content = fs.readFileSync(path.join(tempDir, 'file2.js'), 'utf8');
    
    expect(file1Content).toBe(originalFile1);
    expect(file2Content).toBe(originalFile2);
  });

  it('should handle replace_all option correctly', () => {
    // Create file with multiple occurrences
    const content = `const a = "test";
const b = "test";
const c = "other";`;
    
    fs.writeFileSync(path.join(tempDir, 'test.js'), content, 'utf8');
    
    const operations = [{
      filePath: 'test.js',
      edits: [{
        old_string: '"test"',
        new_string: '"replaced"',
        replace_all: true
      }]
    }];

    const result = handleUnifiedDiffCommand({ operations, workdir: tempDir });
    
    expect(result).toContain('Applied 1 edits to test.js');
    
    const updatedContent = fs.readFileSync(path.join(tempDir, 'test.js'), 'utf8');
    expect(updatedContent).toContain('const a = "replaced";');
    expect(updatedContent).toContain('const b = "replaced";');
    expect(updatedContent).toContain('const c = "other";');
  });

  it('should fail when multiple occurrences found without replace_all', () => {
    // Create file with multiple occurrences
    const content = `const a = "test";
const b = "test";`;
    
    fs.writeFileSync(path.join(tempDir, 'test.js'), content, 'utf8');
    
    const operations = [{
      filePath: 'test.js',
      edits: [{
        old_string: '"test"',
        new_string: '"replaced"'
        // replace_all not set
      }]
    }];

    expect(() => {
      handleUnifiedDiffCommand({ operations, workdir: tempDir });
    }).toThrow('Multiple occurrences found');
  });

  it('should fail when file does not exist', () => {
    const operations = [{
      filePath: 'nonexistent.js',
      edits: [{
        old_string: 'anything',
        new_string: 'replacement'
      }]
    }];

    expect(() => {
      handleUnifiedDiffCommand({ operations, workdir: tempDir });
    }).toThrow('File does not exist');
  });

  it('should fail when search text not found', () => {
    const operations = [{
      filePath: 'file1.js',
      edits: [{
        old_string: 'NONEXISTENT_TEXT',
        new_string: 'replacement'
      }]
    }];

    expect(() => {
      handleUnifiedDiffCommand({ operations, workdir: tempDir });
    }).toThrow('Search text not found');
  });

  it('should handle empty operations array', () => {
    expect(() => {
      handleUnifiedDiffCommand({ operations: [] });
    }).toThrow('Multi-edit requires operations array');
  });

  it('should handle missing operations', () => {
    expect(() => {
      handleUnifiedDiffCommand({});
    }).toThrow('Multi-edit requires operations array');
  });
});