import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppConfig } from '../src/utils/config.js';
import type { ApprovalPolicy } from '../src/approvals.js';
import TerminalChat from '../src/components/chat/terminal-chat.js';

// Mock the AgentLoop to simulate complex interactions
vi.mock('../src/utils/agent/agent-loop.js', () => {
  return {
    AgentLoop: vi.fn().mockImplementation((options) => {
      const mockAgent = {
        run: vi.fn().mockImplementation(async (inputs, lastResponseId) => {
          // Simulate different types of responses based on input
          const input = inputs[0]?.text || '';
          
          // Simulate reasoning phase
          options.onLoading(true);
          await new Promise(resolve => setTimeout(resolve, 100));
          
          if (input.includes('create a web app')) {
            return simulateWebAppCreation(options);
          } else if (input.includes('fix the bug')) {
            return simulateBugFixing(options);
          } else if (input.includes('read the file')) {
            return simulateFileReading(options);
          } else if (input.includes('apply patch')) {
            return simulateApplyPatch(options);
          } else if (input.includes('complex workflow')) {
            return simulateComplexWorkflow(options);
          } else {
            return simulateBasicResponse(options);
          }
        }),
        cancel: vi.fn(),
        terminate: vi.fn(),
      };
      
      // Store reference for test access
      (mockAgent as any).options = options;
      return mockAgent;
    }),
  };
});

// Simulate web app creation with multiple function calls
async function simulateWebAppCreation(options: any) {
  const items = [
    // Reasoning phase
    {
      id: 'reasoning-1',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: 'I\'ll help you create a modern web app. Let me start by reading the project structure and then create the necessary files.'
      }]
    },
    
    // Function call: read directory
    {
      id: 'func-call-1',
      type: 'function_call',
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({
          command: ['ls', '-la'],
          description: 'Check current directory structure'
        })
      }
    },
    
    // Function call output
    {
      id: 'func-output-1',
      type: 'function_call_output',
      output: JSON.stringify({
        stdout: 'total 8\ndrwxr-xr-x 3 user user 4096 Jan 1 12:00 .\ndrwxr-xr-x 3 user user 4096 Jan 1 12:00 ..\n-rw-r--r-- 1 user user 0 Jan 1 12:00 package.json',
        stderr: '',
        exit_code: 0
      })
    },
    
    // Function call: create React app structure
    {
      id: 'func-call-2',
      type: 'function_call',
      function: {
        name: 'create_file',
        arguments: JSON.stringify({
          path: 'src/App.tsx',
          content: `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Welcome to Your Web App</h1>
        <p>Built with React and modern best practices</p>
      </header>
    </div>
  );
}

export default App;`
        })
      }
    },
    
    // Function call output
    {
      id: 'func-output-2',
      type: 'function_call_output',
      output: JSON.stringify({
        success: true,
        message: 'File created successfully'
      })
    },
    
    // Final response
    {
      id: 'final-response',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '✅ Web app created successfully! I\'ve set up a modern React application with:\n\n- Clean component structure\n- TypeScript support\n- Modern CSS styling\n\nThe app is ready to run with `npm start`.'
      }]
    }
  ];
  
  // Simulate progressive responses
  for (const item of items) {
    options.onItem(item);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  options.onLoading(false);
}

// Simulate bug fixing with code analysis and patches
async function simulateBugFixing(options: any) {
  const items = [
    // Analysis phase
    {
      id: 'analysis-1',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: 'I\'ll analyze the codebase to identify and fix the bug. Let me start by examining the error logs and relevant files.'
      }]
    },
    
    // Read error logs
    {
      id: 'func-call-read-logs',
      type: 'function_call',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({
          path: 'error.log',
          description: 'Reading error logs to understand the issue'
        })
      }
    },
    
    {
      id: 'func-output-logs',
      type: 'function_call_output',
      output: JSON.stringify({
        content: 'TypeError: Cannot read property \'id\' of undefined\n  at UserService.getUserById (user.service.js:42:20)\n  at UserController.getUser (user.controller.js:15:30)',
        success: true
      })
    },
    
    // Read the problematic file
    {
      id: 'func-call-read-file',
      type: 'function_call',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({
          path: 'src/services/user.service.js',
          description: 'Examining the user service file'
        })
      }
    },
    
    {
      id: 'func-output-file',
      type: 'function_call_output',
      output: JSON.stringify({
        content: `class UserService {
  async getUserById(userId) {
    const user = await this.userRepository.findById(userId);
    return user.id; // Bug: user might be null
  }
}`,
        success: true
      })
    },
    
    // Apply fix using patch
    {
      id: 'func-call-patch',
      type: 'function_call',
      function: {
        name: 'apply_patch',
        arguments: JSON.stringify({
          path: 'src/services/user.service.js',
          patch: `--- a/src/services/user.service.js
+++ b/src/services/user.service.js
@@ -1,5 +1,8 @@
 class UserService {
   async getUserById(userId) {
     const user = await this.userRepository.findById(userId);
-    return user.id; // Bug: user might be null
+    if (!user) {
+      throw new Error(\`User with ID \${userId} not found\`);
+    }
+    return user.id;
   }
 }`,
          description: 'Adding null check to prevent TypeError'
        })
      }
    },
    
    {
      id: 'func-output-patch',
      type: 'function_call_output',
      output: JSON.stringify({
        success: true,
        message: 'Patch applied successfully',
        changes: {
          additions: 3,
          deletions: 1,
          files_changed: 1
        }
      })
    },
    
    // Run tests to verify fix
    {
      id: 'func-call-test',
      type: 'function_call',
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({
          command: ['npm', 'test'],
          description: 'Running tests to verify the fix'
        })
      }
    },
    
    {
      id: 'func-output-test',
      type: 'function_call_output',
      output: JSON.stringify({
        stdout: '✓ UserService.getUserById should handle valid user ID\n✓ UserService.getUserById should throw error for invalid ID\n\nTests: 2 passed, 2 total',
        stderr: '',
        exit_code: 0
      })
    },
    
    // Final summary
    {
      id: 'final-summary',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '🐛 Bug fixed successfully! \n\n**Issue**: TypeError when user ID doesn\'t exist\n**Solution**: Added null check with descriptive error\n**Verification**: All tests passing\n\nThe application is now more robust and handles edge cases properly.'
      }]
    }
  ];
  
  // Simulate progressive responses with realistic timing
  for (const item of items) {
    options.onItem(item);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Simulate user approval for patches
    if (item.type === 'function_call' && item.function?.name === 'apply_patch') {
      await new Promise(resolve => setTimeout(resolve, 1000)); // User review time
    }
  }
  options.onLoading(false);
}

// Simulate file reading with analysis
async function simulateFileReading(options: any) {
  const items = [
    {
      id: 'read-start',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: 'I\'ll read and analyze the requested files to understand the codebase structure.'
      }]
    },
    
    {
      id: 'func-call-read-main',
      type: 'function_call',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({
          path: 'src/main.ts',
          description: 'Reading main application entry point'
        })
      }
    },
    
    {
      id: 'func-output-main',
      type: 'function_call_output',
      output: JSON.stringify({
        content: `import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'

const app = createApp(App)
app.use(store)
app.use(router)
app.mount('#app')`,
        success: true
      })
    },
    
    {
      id: 'analysis-complete',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '📄 File analysis complete!\n\n**Technology Stack**: Vue.js 3 with TypeScript\n**Architecture**: Uses Vuex for state management and Vue Router\n**Entry Point**: Standard Vue app initialization\n\nThe codebase follows Vue.js best practices with a clean separation of concerns.'
      }]
    }
  ];
  
  for (const item of items) {
    options.onItem(item);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  
  options.onLoading(false);
}

// Simulate apply patch workflow
async function simulateApplyPatch(options: any) {
  const items = [
    {
      id: 'patch-start',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: 'I\'ll apply the requested patch to update the codebase. Let me analyze the changes first.'
      }]
    },
    
    {
      id: 'func-call-git-status',
      type: 'function_call',
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({
          command: ['git', 'status', '--porcelain'],
          description: 'Check current git status'
        })
      }
    },
    
    {
      id: 'func-output-git-status',
      type: 'function_call_output',
      output: JSON.stringify({
        stdout: ' M src/components/Header.tsx\n?? patch.diff',
        stderr: '',
        exit_code: 0
      })
    },
    
    {
      id: 'func-call-apply',
      type: 'function_call',
      function: {
        name: 'apply_patch',
        arguments: JSON.stringify({
          path: 'src/components/Header.tsx',
          patch: `--- a/src/components/Header.tsx
+++ b/src/components/Header.tsx
@@ -5,7 +5,10 @@ export function Header() {
   return (
     <header className="header">
       <h1>My App</h1>
-      <nav>Home | About</nav>
+      <nav>
+        <a href="/home">Home</a> | 
+        <a href="/about">About</a>
+      </nav>
     </header>
   );
 }`,
          description: 'Converting static nav to proper links'
        })
      }
    },
    
    {
      id: 'func-output-apply',
      type: 'function_call_output',
      output: JSON.stringify({
        success: true,
        message: 'Patch applied successfully',
        changes: {
          additions: 4,
          deletions: 1,
          files_changed: 1
        }
      })
    },
    
    {
      id: 'patch-complete',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '✅ Patch applied successfully!\n\n**Changes**:\n- Converted static navigation to proper links\n- Improved accessibility and navigation UX\n- Added semantic HTML structure\n\nThe header component now provides proper navigation functionality.'
      }]
    }
  ];
  
  for (const item of items) {
    options.onItem(item);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  
  options.onLoading(false);
}

// Simulate complex workflow with multiple phases
async function simulateComplexWorkflow(options: any) {
  const phases = [
    // Phase 1: Analysis
    {
      id: 'phase1-start',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '🔍 **Phase 1: Project Analysis**\n\nAnalyzing the codebase structure and dependencies...'
      }]
    },
    
    // Phase 2: Planning
    {
      id: 'phase2-start',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '📋 **Phase 2: Implementation Planning**\n\nCreating a step-by-step implementation plan...'
      }]
    },
    
    // Phase 3: Implementation
    {
      id: 'phase3-start',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '⚡ **Phase 3: Implementation**\n\nExecuting the planned changes...'
      }]
    },
    
    // Multiple function calls in sequence
    {
      id: 'func-mkdir',
      type: 'function_call',
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({
          command: ['mkdir', '-p', 'src/components/ui'],
          description: 'Creating UI components directory'
        })
      }
    },
    
    {
      id: 'func-mkdir-output',
      type: 'function_call_output',
      output: JSON.stringify({
        stdout: '',
        stderr: '',
        exit_code: 0
      })
    },
    
    // Phase 4: Testing
    {
      id: 'phase4-start',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '🧪 **Phase 4: Testing & Validation**\n\nRunning comprehensive tests...'
      }]
    },
    
    {
      id: 'func-test-all',
      type: 'function_call',
      function: {
        name: 'execute_command',
        arguments: JSON.stringify({
          command: ['npm', 'run', 'test:coverage'],
          description: 'Running full test suite with coverage'
        })
      }
    },
    
    {
      id: 'func-test-output',
      type: 'function_call_output',
      output: JSON.stringify({
        stdout: 'Test Suites: 15 passed, 15 total\nTests: 127 passed, 127 total\nCoverage: 89.2% statements, 85.1% branches',
        stderr: '',
        exit_code: 0
      })
    },
    
    // Final summary
    {
      id: 'workflow-complete',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: '🎉 **Complex Workflow Completed Successfully!**\n\n**Summary**:\n✅ Project analysis completed\n✅ Implementation plan executed\n✅ All components created\n✅ Tests passing (89.2% coverage)\n\nThe project is now ready for production deployment.'
      }]
    }
  ];
  
  for (const item of phases) {
    options.onItem(item);
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  
  options.onLoading(false);
}

// Simulate basic response for fallback
async function simulateBasicResponse(options: any) {
  const items = [
    {
      id: 'basic-response',
      type: 'message',
      role: 'assistant',
      content: [{ 
        type: 'output_text', 
        text: 'I understand your request. Let me help you with that!'
      }]
    }
  ];
  
  for (const item of items) {
    options.onItem(item);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  options.onLoading(false);
}

// Mock configuration
const mockConfig: AppConfig = {
  apiKey: 'test-key',
  model: 'gpt-4',
  provider: 'openai',
  instructions: 'You are a helpful coding assistant.',
  approvalMode: 'suggest' as ApprovalPolicy,
  flexMode: false,
  providers: { openai: { models: ['gpt-4', 'gpt-3.5-turbo'] } },
  disableResponseStorage: false,
  notify: false,
};

describe('Comprehensive CLI Simulation', () => {
  let mockAgent: any;
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    if (mockAgent) {
      mockAgent.terminate();
    }
  });

  it('should simulate web app creation workflow', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="create a web app"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Wait for simulation to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    expect(lastFrame()).toContain('Web app created successfully');
    expect(lastFrame()).toContain('React');
    expect(lastFrame()).toContain('TypeScript');
  });

  it('should simulate bug fixing with code analysis', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="fix the bug in user service"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Wait for simulation to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    expect(lastFrame()).toContain('Bug fixed successfully');
    expect(lastFrame()).toContain('null check');
    expect(lastFrame()).toContain('tests passing');
  });

  it('should simulate file reading and analysis', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="read the file main.ts and analyze it"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Wait for simulation to complete
    await new Promise(resolve => setTimeout(resolve, 1500));

    expect(lastFrame()).toContain('File analysis complete');
    expect(lastFrame()).toContain('Vue.js');
    expect(lastFrame()).toContain('Technology Stack');
  });

  it('should simulate apply patch workflow', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="apply patch to header component"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Wait for simulation to complete
    await new Promise(resolve => setTimeout(resolve, 1800));

    expect(lastFrame()).toContain('Patch applied successfully');
    expect(lastFrame()).toContain('navigation');
    expect(lastFrame()).toContain('accessibility');
  });

  it('should simulate complex multi-phase workflow', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="complex workflow with analysis, planning, implementation, and testing"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Wait for simulation to complete
    await new Promise(resolve => setTimeout(resolve, 4000));

    expect(lastFrame()).toContain('Complex Workflow Completed');
    expect(lastFrame()).toContain('Phase 1');
    expect(lastFrame()).toContain('coverage');
    expect(lastFrame()).toContain('production deployment');
  });

  it('should handle thinking and loading states', async () => {
    const { lastFrame, rerender } = render(
      <TerminalChat
        config={mockConfig}
        prompt="create a web app"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Check for loading state early
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Should show some kind of progress indicator
    const initialFrame = lastFrame();
    expect(initialFrame).toBeDefined();
    
    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Should show completed state
    const finalFrame = lastFrame();
    expect(finalFrame).toContain('Web app created successfully');
  });

  it('should simulate reasoning with progressive responses', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="fix the bug"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Check progressive updates
    await new Promise(resolve => setTimeout(resolve, 500));
    let currentFrame = lastFrame();
    expect(currentFrame).toContain('analyze');

    await new Promise(resolve => setTimeout(resolve, 1000));
    currentFrame = lastFrame();
    expect(currentFrame).toContain('error logs');

    await new Promise(resolve => setTimeout(resolve, 2000));
    currentFrame = lastFrame();
    expect(currentFrame).toContain('Bug fixed successfully');
  });

  it('should simulate function calls with realistic outputs', async () => {
    const { lastFrame } = render(
      <TerminalChat
        config={mockConfig}
        prompt="create a web app"
        approvalPolicy="suggest"
        additionalWritableRoots={[]}
        fullStdout={false}
      />
    );

    // Wait for function calls to execute
    await new Promise(resolve => setTimeout(resolve, 1500));

    const frame = lastFrame();
    
    // Should contain evidence of function calls
    expect(frame).toContain('App.tsx');
    expect(frame).toContain('successfully');
  });
}); 