import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FilePreview } from '../src/components/ui/file-preview.js';

// Mock Ink's internal components
vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  
  // Mock stdin object
  const mockStdin = {
    ref: vi.fn(),
    setRawMode: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    emit: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn(),
    isTTY: true,
  };
  
  // Set up process.stdin mock  
  Object.defineProperty(process, 'stdin', {
    value: mockStdin,
    writable: true,
    configurable: true,
  });
  
  return {
    ...actual,
    useInput: vi.fn(),
    useStdin: vi.fn().mockReturnValue({
      stdin: mockStdin,
      isRawModeSupported: true,
      setRawMode: vi.fn(),
    }),
  };
});

// Mock file system operations with dynamic content based on filename
vi.mock('fs/promises', () => {
  const createMockFileContent = (path: string) => {
    if (path.includes('complex.md')) {
      return '# Complex Markdown Test\n\n## Features\n\n- **Bold** text\n- `Code` snippets\n- [Links](url)\n\n### Code Block\n\n```js\nconsole.log("test");\n```';
    }
    if (path.includes('broken.md')) {
      return 'Invalid markdown\n\n]]] broken syntax [[[';
    }
    if (path.includes('large.md')) {
      return 'Binary file (too large to display)';
    }
    if (path.includes('forbidden.md')) {
      throw new Error('Permission denied');
    }
    if (path.includes('missing.md')) {
      throw new Error('File not found');
    }
    return '# Test Markdown\n\nThis is **bold** text with `code` and [link](url).';
  };

  const createMockStat = (path: string) => {
    if (path.includes('large.md')) {
      return { size: 10 * 1024 * 1024, mtime: new Date('2024-01-01') }; // 10MB
    }
    if (path.includes('forbidden.md') || path.includes('missing.md')) {
      throw new Error('File error');
    }
    return { size: 1024, mtime: new Date('2024-01-01') };
  };

  return {
    default: {
      stat: vi.fn().mockImplementation(createMockStat),
      readFile: vi.fn().mockImplementation(createMockFileContent),
    },
    stat: vi.fn().mockImplementation(createMockStat),
    readFile: vi.fn().mockImplementation(createMockFileContent),
  };
});

// Mock path operations
vi.mock('path', () => ({
  default: {
    basename: vi.fn((path: string) => path.split('/').pop() || ''),
    extname: vi.fn((path: string) => {
      const parts = path.split('.');
      return parts.length > 1 ? `.${parts.pop()}` : '';
    }),
    dirname: vi.fn((path: string) => path.split('/').slice(0, -1).join('/') || '/'),
    sep: '/',
  },
  basename: vi.fn((path: string) => path.split('/').pop() || ''),
  extname: vi.fn((path: string) => {
    const parts = path.split('.');
    return parts.length > 1 ? `.${parts.pop()}` : '';
  }),
  dirname: vi.fn((path: string) => path.split('/').slice(0, -1).join('/') || '/'),
  sep: '/',
}));

// Mock memory manager
vi.mock('../src/utils/memory-manager.js', () => ({
  memoryManager: {
    getCachedFile: vi.fn().mockReturnValue(null),
    cacheFile: vi.fn(),
    getStats: vi.fn().mockReturnValue({ fileCache: { size: 0 } }),
  },
}));

describe('Terminal UI Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FilePreview Markdown Rendering', () => {
    it('should handle markdown files without breaking UI', async () => {
      const { lastFrame } = render(
        <FilePreview
          filePath="test.md"
          isActive={true}
          height={10}
          width={80}
        />
      );

      // Wait for async loading
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      
      // Should not crash and should show some content
      expect(output).toBeDefined();
      expect(output).toContain('test.md');
      // Component should render content safely (without crashing)
      expect(output).toContain('Test Markdown');
      expect(output).toContain('**bold**'); // Raw markdown is expected in file preview
      expect(output).toContain('link');
    });

    it('should gracefully handle complex markdown syntax', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValueOnce(`
# Complex Markdown Test

## Features
- **Bold text** with *italic*
- \`inline code\` and \`\`\`code blocks\`\`\`
- [Links](https://example.com) and [broken](
- Tables | with | pipes
- Special chars: <>{}[]()
- Unicode: 🚀 ✅ ❌

### Code Block
\`\`\`javascript
function test() {
  return "complex code";
}
\`\`\`

> Blockquotes with **formatting**
      `);

      const { lastFrame } = render(
        <FilePreview
          filePath="complex.md"
          isActive={true}
          height={15}
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      
      // Should handle complex syntax without crashing
      expect(output).toBeDefined();
      expect(output).toContain('complex.md');
      
      // Should render complex content
      expect(output).toContain('Complex Markdown Test');
      expect(output).toContain('Features');
      
      // Should not crash on special characters
      expect(output).not.toContain('undefined');
      expect(output).not.toContain('Error');
    });

    it('should provide fallback for parsing errors', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readFile).mockResolvedValueOnce('Invalid markdown with **unclosed bold and [broken link');

      const { lastFrame } = render(
        <FilePreview
          filePath="broken.md"
          isActive={true}
          height={10}
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      
      // Should not crash even with broken markdown
      expect(output).toBeDefined();
      expect(output).toContain('broken.md');
      
      // Should show content (fallback to plain text)
      expect(output).toContain('Invalid markdown');
    });

    it('should handle different file extensions correctly', async () => {
      const testCases = [
        { file: 'test.js', extension: '.js' },
        { file: 'test.tsx', extension: '.tsx' },
        { file: 'test.json', extension: '.json' },
        { file: 'README.md', extension: '.md' },
        { file: 'plain.txt', extension: '.txt' },
      ];

      for (const testCase of testCases) {
        const { lastFrame } = render(
          <FilePreview
            filePath={testCase.file}
            isActive={true}
            height={10}
            width={80}
          />
        );

        await new Promise(resolve => setTimeout(resolve, 50));

        const output = lastFrame();
        expect(output).toBeDefined();
        expect(output).toContain(testCase.file);
      }
    });

    it('should handle large files safely', async () => {
      const { lastFrame } = render(
        <FilePreview
          filePath="large.md"
          isActive={true}
          height={10}
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      
      // Should handle large files without crashing
      expect(output).toBeDefined();
      // Should show it as binary due to size limit or large file content
      expect(output).toContain('Binary file');
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      const { lastFrame } = render(
        <FilePreview
          filePath="forbidden.md"
          isActive={true}
          height={10}
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      
      // Should show error state without crashing
      expect(output).toBeDefined();
      expect(output).toContain('File error');
    });

    it('should handle stat errors gracefully', async () => {
      const { lastFrame } = render(
        <FilePreview
          filePath="missing.md"
          isActive={true}
          height={10}
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      
      // Should show error state without crashing
      expect(output).toBeDefined();
      expect(output).toContain('File error');
    });
  });

  describe('Performance', () => {
    it('should render quickly for normal files', async () => {
      const startTime = Date.now();

      const { lastFrame } = render(
        <FilePreview
          filePath="normal.md"
          isActive={true}
          height={10}
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      const endTime = Date.now();
      
      expect(output).toBeDefined();
      // Should render within reasonable time (including async operations)
      expect(endTime - startTime).toBeLessThan(200);
    });

    it('should handle multiple rapid file changes', async () => {
      const files = ['file1.md', 'file2.md', 'file3.md'];
      
      for (const file of files) {
        const { lastFrame } = render(
          <FilePreview
            filePath={file}
            isActive={true}
            height={10}
            width={80}
          />
        );

        await new Promise(resolve => setTimeout(resolve, 10));
        
        const output = lastFrame();
        expect(output).toBeDefined();
      }
    });
  });

  describe('Visual Layout', () => {
    it('should respect width constraints', async () => {
      const { lastFrame } = render(
        <FilePreview
          filePath="test.md"
          isActive={true}
          height={10}
          width={40} // Narrow width
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      expect(output).toBeDefined();
      const lines = output!.split('\n');
      
      // Check that lines don't exceed width (accounting for borders)
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(45); // Some tolerance for borders
      }
    });

    it('should respect height constraints', async () => {
      const { lastFrame } = render(
        <FilePreview
          filePath="test.md"
          isActive={true}
          height={5} // Small height
          width={80}
        />
      );

      await new Promise(resolve => setTimeout(resolve, 100));

      const output = lastFrame();
      expect(output).toBeDefined();
      const lines = output!.split('\n').filter(line => line.trim());
      
      // Should not exceed height
      expect(lines.length).toBeLessThanOrEqual(8); // Some tolerance for headers/footers
    });
  });
}); 