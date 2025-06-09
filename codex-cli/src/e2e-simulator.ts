#!/usr/bin/env node

import { MockAgent, MockAgentOptions } from './utils/agent/mock-agent.js';

interface SimulationResult {
  success: boolean;
  duration: number;
  functionsExecuted: number;
  filesCreated: number;
  output: string;
  error?: string;
}

interface E2ETestScenario {
  name: string;
  prompt: string;
  expectedFiles?: string[];
  expectedCommands?: string[];
  timeout?: number;
}

/**
 * End-to-End CLI Simulator that mimics the full agent workflow without real API calls
 */
export class E2ESimulator {
  private mockAgent: MockAgent;
  private verbose: boolean;

  constructor(options: MockAgentOptions & { verbose?: boolean } = {}) {
    this.verbose = options.verbose || false;
    this.mockAgent = new MockAgent({
      ...options,
      verbose: this.verbose,
    });
  }

  /**
   * Simulate a complete CLI conversation with function calls and file operations
   */
  public async simulateConversation(prompt: string): Promise<SimulationResult> {
    const startTime = Date.now();
    
    try {
      this.log(`Starting simulation for: "${prompt}"`);
      
      // Simulate the conversation
      const result = await this.mockAgent.simulateConversation(prompt);
      
      const duration = Date.now() - startTime;
      const projectFiles = this.mockAgent.getProjectFiles();
      const state = this.mockAgent.getState();
      
      // Generate output summary
      let output = this.generateOutputSummary(result, projectFiles, state);
      
      this.log(`Simulation completed in ${duration}ms`);
      
      return {
        success: true,
        duration,
        functionsExecuted: result.functionCalls.length,
        filesCreated: result.fileOperations.length,
        output,
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.log(`Simulation failed: ${errorMessage}`);
      
      return {
        success: false,
        duration,
        functionsExecuted: 0,
        filesCreated: 0,
        output: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Run a predefined test scenario
   */
  public async runScenario(scenario: E2ETestScenario): Promise<SimulationResult & { scenarioName: string }> {
    this.log(`Running scenario: ${scenario.name}`);
    
    const result = await this.simulateConversation(scenario.prompt);
    
    // Validate expected files if specified
    if (scenario.expectedFiles) {
      const projectFiles = this.mockAgent.getProjectFiles();
      const missingFiles = scenario.expectedFiles.filter(file => !projectFiles.has(file));
      
      if (missingFiles.length > 0) {
        result.success = false;
        result.error = `Missing expected files: ${missingFiles.join(', ')}`;
      }
    }
    
    // Validate expected commands if specified
    if (scenario.expectedCommands) {
      const state = this.mockAgent.getState();
      const executedCommands = state.commandHistory.map(h => h.command.join(' '));
      const missingCommands = scenario.expectedCommands.filter(cmd => 
        !executedCommands.some(exec => exec.includes(cmd))
      );
      
      if (missingCommands.length > 0) {
        result.success = false;
        result.error = `Missing expected commands: ${missingCommands.join(', ')}`;
      }
    }
    
    return {
      ...result,
      scenarioName: scenario.name,
    };
  }

  /**
   * Run multiple scenarios in sequence
   */
  public async runTestSuite(scenarios: E2ETestScenario[]): Promise<{
    passed: number;
    failed: number;
    results: Array<SimulationResult & { scenarioName: string }>;
  }> {
    const results: Array<SimulationResult & { scenarioName: string }> = [];
    let passed = 0;
    let failed = 0;
    
    for (const scenario of scenarios) {
      // Reset mock agent for each scenario
      this.mockAgent.reset();
      
      const result = await this.runScenario(scenario);
      results.push(result);
      
      if (result.success) {
        passed++;
        this.log(`✅ ${scenario.name} - PASSED`);
      } else {
        failed++;
        this.log(`❌ ${scenario.name} - FAILED: ${result.error}`);
      }
    }
    
    return { passed, failed, results };
  }

  /**
   * Generate a comprehensive output summary
   */
  private generateOutputSummary(
    result: any,
    projectFiles: Map<string, string>,
    state: any
  ): string {
    const lines: string[] = [];
    
    lines.push("=".repeat(60));
    lines.push("🚀 E2E SIMULATION RESULTS");
    lines.push("=".repeat(60));
    lines.push("");
    
    // Messages summary
    lines.push("📋 Conversation Flow:");
    result.messages.forEach((msg: any, i: number) => {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
      const content = msg.content[0]?.text || msg.content[0]?.type || 'No content';
      const preview = content.length > 80 ? content.substring(0, 77) + '...' : content;
      lines.push(`  ${i + 1}. ${role}: ${preview}`);
    });
    lines.push("");
    
    // Function calls summary
    lines.push("⚙️ Function Calls Executed:");
    if (result.functionCalls.length === 0) {
      lines.push("  No function calls executed");
    } else {
      result.functionCalls.forEach((call: any, i: number) => {
        lines.push(`  ${i + 1}. ${call.name}(${JSON.stringify(call.args).substring(0, 50)}...)`);
        if (call.result?.output) {
          const output = call.result.output.split('\n')[0];
          lines.push(`     Output: ${output.substring(0, 60)}${output.length > 60 ? '...' : ''}`);
        }
      });
    }
    lines.push("");
    
    // File operations summary
    lines.push("📁 File Operations:");
    if (result.fileOperations.length === 0) {
      lines.push("  No file operations performed");
    } else {
      result.fileOperations.forEach((op: any, i: number) => {
        lines.push(`  ${i + 1}. ${op.type.toUpperCase()}: ${op.path}`);
        if (op.content && op.content.length > 0) {
          const firstLine = op.content.split('\n')[0];
          lines.push(`     Content: ${firstLine.substring(0, 50)}${firstLine.length > 50 ? '...' : ''}`);
        }
      });
    }
    lines.push("");
    
    // Project structure
    lines.push("🗂️ Final Project Structure:");
    const sortedFiles = Array.from(projectFiles.keys()).sort();
    if (sortedFiles.length === 0) {
      lines.push("  No files created");
    } else {
      sortedFiles.forEach(filePath => {
        const relativePath = filePath.replace('/project/', '');
        const size = projectFiles.get(filePath)?.length || 0;
        lines.push(`  📄 ${relativePath} (${size} bytes)`);
      });
    }
    lines.push("");
    
    // Command history
    lines.push("💻 Command History:");
    if (state.commandHistory.length === 0) {
      lines.push("  No commands executed");
    } else {
      state.commandHistory.forEach((cmd: any, i: number) => {
        const command = cmd.command.join(' ');
        const status = cmd.result.exitCode === 0 ? '✅' : '❌';
        lines.push(`  ${i + 1}. ${status} ${command}`);
      });
    }
    lines.push("");
    
    // Statistics
    lines.push("📊 Statistics:");
    lines.push(`  • Messages: ${result.messages.length}`);
    lines.push(`  • Function calls: ${result.functionCalls.length}`);
    lines.push(`  • File operations: ${result.fileOperations.length}`);
    lines.push(`  • Files created: ${projectFiles.size}`);
    lines.push(`  • Commands executed: ${state.commandHistory.length}`);
    lines.push("");
    
    lines.push("=".repeat(60));
    
    return lines.join('\n');
  }

  private log(message: string) {
    if (this.verbose) {
      console.log(`[E2ESimulator] ${message}`);
    }
  }

  /**
   * Get the current mock agent state for inspection
   */
  public getState() {
    return this.mockAgent.getState();
  }

  /**
   * Get all created project files
   */
  public getProjectFiles() {
    return this.mockAgent.getProjectFiles();
  }

  /**
   * Reset the simulator state
   */
  public reset() {
    this.mockAgent.reset();
  }
}

// Predefined test scenarios
export const DEFAULT_TEST_SCENARIOS: E2ETestScenario[] = [
  {
    name: "Simple Web Application",
    prompt: "Create a simple React web application with a landing page and basic styling",
    expectedFiles: ["/project/package.json", "/project/src/App.tsx"],
    expectedCommands: ["mkdir", "npm"],
  },
  {
    name: "Full Stack Application", 
    prompt: "Build a complete full-stack application with React frontend, Node.js backend, database setup, authentication, and deployment configuration",
    expectedFiles: ["/project/package.json"],
    expectedCommands: ["mkdir", "npm"],
  },
  {
    name: "API Development",
    prompt: "Create a RESTful API with Node.js, Express, JWT authentication, input validation, error handling, and comprehensive test suite",
    expectedFiles: ["/project/package.json"],
    expectedCommands: ["npm", "mkdir"],
  },
  {
    name: "DevOps Setup",
    prompt: "Set up a complete DevOps pipeline with Docker, CI/CD, monitoring, logging, and deployment automation",
    expectedCommands: ["git", "mkdir"],
  },
  {
    name: "Basic File Operations",
    prompt: "Create a simple Node.js script that reads and processes CSV data",
    expectedCommands: ["touch", "npm"],
  },
];

// CLI interface for running simulations
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'test-scenarios') {
    console.log("🧪 Running E2E Test Scenarios...\n");
    
    const simulator = new E2ESimulator({ verbose: true });
    const results = await simulator.runTestSuite(DEFAULT_TEST_SCENARIOS);
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 TEST SUITE RESULTS");
    console.log("=".repeat(60));
    console.log(`✅ Passed: ${results.passed}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    
    if (results.failed > 0) {
      console.log("\n❌ Failed Tests:");
      results.results.filter(r => !r.success).forEach(result => {
        console.log(`  • ${result.scenarioName}: ${result.error}`);
      });
    }
    
  } else if (command === 'simulate' && args[1]) {
    const prompt = args.slice(1).join(' ');
    console.log(`🚀 Simulating: "${prompt}"\n`);
    
    const simulator = new E2ESimulator({ verbose: true });
    const result = await simulator.simulateConversation(prompt);
    
    if (result.success) {
      console.log(result.output);
    } else {
      console.error(`❌ Simulation failed: ${result.error}`);
      process.exit(1);
    }
    
  } else {
    console.log("🎯 E2E CLI Simulator");
    console.log("====================");
    console.log("");
    console.log("Usage:");
    console.log("  npm run e2e test-scenarios          # Run all predefined scenarios");
    console.log("  npm run e2e simulate \"<prompt>\"     # Simulate a custom prompt");
    console.log("");
    console.log("Examples:");
    console.log('  npm run e2e simulate "Create a React app with TypeScript"');
    console.log('  npm run e2e simulate "Build a REST API with authentication"');
    console.log("");
  }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 