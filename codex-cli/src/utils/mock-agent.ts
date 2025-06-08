import type { ResponseItem } from 'openai/resources/responses/responses.mjs';
import { EventEmitter } from 'events';

interface MockAgentOptions {
  onItem: (item: ResponseItem) => void;
  onLoading: (loading: boolean) => void;
}

export class MockAgent extends EventEmitter {
  private options: MockAgentOptions;
  private messageId = 0;

  constructor(options: MockAgentOptions) {
    super();
    this.options = options;
  }

  async run(prompt: string): Promise<void> {
    this.options.onLoading(true);
    
    // Add user message
    const userMessage: ResponseItem = {
      id: `user-${++this.messageId}`,
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: prompt }],
    };
    this.options.onItem(userMessage);

    // Simulate thinking delay
    await this.delay(1000);

    // Determine response type based on prompt
    if (prompt.toLowerCase().includes('explain') || prompt.toLowerCase().includes('codebase')) {
      await this.handleExplainCodebase();
    } else if (prompt.toLowerCase().includes('list files') || prompt.toLowerCase().includes('show files')) {
      await this.handleListFiles();
    } else if (prompt.toLowerCase().includes('test') || prompt.toLowerCase().includes('run')) {
      await this.handleRunTests();
    } else {
      await this.handleGeneral(prompt);
    }

    this.options.onLoading(false);
  }

  private async handleExplainCodebase(): Promise<void> {
    const callId = `call-${++this.messageId}`;
    
    const lsCommand: ResponseItem = {
      id: `function-call-${this.messageId}`,
      type: 'function_call',
      call_id: callId,
      name: 'shell',
      arguments: JSON.stringify({ command: ['ls', '-la'] }),
    };
    this.options.onItem(lsCommand);
    await this.delay(500);

    const lsOutput: ResponseItem = {
      id: `function-output-${this.messageId}`,
      type: 'function_call_output',
      call_id: callId,
      output: `total 48
drwxr-xr-x  8 user user  256 Jan 15 10:30 .
-rw-r--r--  1 user user 1234 Jan 15 10:30 README.md
drwxr-xr-x  5 user user  160 Jan 15 10:29 codex-cli
drwxr-xr-x  8 user user  256 Jan 15 10:28 codex-rs
-rw-r--r--  1 user user  567 Jan 15 10:26 package.json`,
    };
    this.options.onItem(lsOutput);
    await this.delay(800);

    const response: ResponseItem = {
      id: `assistant-${++this.messageId}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: `# 🚀 Codebase Analysis: Fragile Project

This is a **sophisticated coding assistant project** with dual implementation:

## 📁 **Project Structure**

**🔧 codex-cli/** - Node.js/TypeScript CLI Interface
- React-based terminal UI using Ink framework
- Multi-pane layout with file navigation and task management

**⚙️ codex-rs/** - Rust Core Engine  
- High-performance core logic and sandboxing
- MCP (Message Control Protocol) client/server architecture

## 🛠️ **Key Features**

✅ Multi-pane terminal layout
✅ File navigation and management  
✅ Task tracking and organization
✅ Advanced clipboard operations

This is a **production-ready coding assistant**!`,
          annotations: [],
        },
      ],
    };
    this.options.onItem(response);
  }

  private async handleListFiles(): Promise<void> {
    const callId = `call-${++this.messageId}`;
    
    const command: ResponseItem = {
      id: `function-call-${this.messageId}`,
      type: 'function_call',
      call_id: callId,
      name: 'shell',
      arguments: JSON.stringify({ command: ['find', '.', '-name', '*.ts'] }),
    };
    this.options.onItem(command);
    await this.delay(600);

    const output: ResponseItem = {
      id: `function-output-${this.messageId}`,
      type: 'function_call_output',
      call_id: callId,
      output: `./codex-cli/src/app.tsx
./codex-cli/src/cli.tsx
./codex-cli/src/components/enhanced-terminal-chat.tsx
./codex-cli/src/components/ui/chat-pane.tsx`,
    };
    this.options.onItem(output);
    await this.delay(500);

    const response: ResponseItem = {
      id: `assistant-${++this.messageId}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: `Found TypeScript files in the project! This shows a well-structured React/TypeScript codebase.`,
          annotations: [],
        },
      ],
    };
    this.options.onItem(response);
  }

  private async handleRunTests(): Promise<void> {
    const callId = `call-${++this.messageId}`;
    
    const command: ResponseItem = {
      id: `function-call-${this.messageId}`,
      type: 'function_call',
      call_id: callId,
      name: 'shell',
      arguments: JSON.stringify({ command: ['npm', 'test'] }),
    };
    this.options.onItem(command);
    await this.delay(2000);

    const output: ResponseItem = {
      id: `function-output-${this.messageId}`,
      type: 'function_call_output',
      call_id: callId,
      output: `✅ Tests: 334 passed
⚡ Duration: 15.2s
🚀 Coverage: 89.2%`,
    };
    this.options.onItem(output);
    await this.delay(500);

    const response: ResponseItem = {
      id: `assistant-${++this.messageId}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: `## 🎉 Test Results: EXCELLENT!

✅ **334 tests passed**
🚀 **89.2% code coverage**
⚡ **15.2s runtime**

The enhanced UI features are well-tested!`,
          annotations: [],
        },
      ],
    };
    this.options.onItem(response);
  }

  private async handleGeneral(prompt: string): Promise<void> {
    const response: ResponseItem = {
      id: `assistant-${++this.messageId}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: `I understand you asked: "${prompt}"

🤖 **Mock Agent Response:**

This is a **development mock** using test_key. Try these commands:
- "explain this codebase"
- "list files" 
- "run tests"

*Note: No real API calls made - this is safe for development.*`,
          annotations: [],
        },
      ],
    };
    this.options.onItem(response);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export function createMockAgent(options: MockAgentOptions): MockAgent {
  return new MockAgent(options);
} 