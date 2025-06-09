export interface RolloutSession {
  timestamp: string;
  id: string;
  instructions: string;
}

export interface RolloutItem {
  id: string;
  type: "message" | "function_call" | "function_call_output";
  role?: string;
  status?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
  content?: Array<{ type: string; text: string }>;
}

export interface RolloutData {
  session: RolloutSession;
  items: RolloutItem[];
}

export interface RolloutReplayOptions {
  rolloutPath?: string;
  verbose?: boolean;
  simulateDelay?: boolean;
  delayMs?: number;
}

/**
 * Rollout Replay System - Replays previously recorded AI sessions without using real APIs
 */
export class RolloutReplay {
  private rolloutData: RolloutData | null = null;
  private currentIndex = 0;
  private options: Required<RolloutReplayOptions>;

  constructor(options: RolloutReplayOptions = {}) {
    this.options = {
      rolloutPath: options.rolloutPath || '',
      verbose: options.verbose || false,
      simulateDelay: options.simulateDelay || true,
      delayMs: options.delayMs || 500,
    };
  }

  /**
   * Load rollout data from a JSON file
   */
  public loadRollout(rolloutPath: string): void {
    try {
      const fs = require('fs');
      const data = fs.readFileSync(rolloutPath, 'utf8');
      this.rolloutData = JSON.parse(data) as RolloutData;
      this.currentIndex = 0;
      
      if (this.options.verbose) {
        console.log(`[RolloutReplay] Loaded rollout with ${this.rolloutData.items.length} items`);
        console.log(`[RolloutReplay] Session ID: ${this.rolloutData.session.id}`);
        console.log(`[RolloutReplay] Session Timestamp: ${this.rolloutData.session.timestamp}`);
      }
    } catch (error) {
      throw new Error(`Failed to load rollout from ${rolloutPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if the current environment should trigger rollout replay mode
   */
  public static shouldUseReplay(): boolean {
    // Trigger replay mode when using test_key or specific environment variable
    const apiKeys = [
      process.env['OPENAI_API_KEY'],
      process.env['GEMINI_API_KEY'],
      process.env['ANTHROPIC_API_KEY'],
      process.env['MISTRAL_API_KEY'],
      process.env['DEEPSEEK_API_KEY'],
      process.env['XAI_API_KEY'],
      process.env['GROQ_API_KEY'],
    ];

    const hasTestKey = apiKeys.some(key => key === 'test_key' || key === 'test_key_replay');
    const forceReplay = process.env['CODEX_FORCE_REPLAY'] === '1';
    
    return hasTestKey || forceReplay;
  }

  /**
   * Find the default rollout file based on the prompt
   */
  public static findDefaultRollout(prompt: string): string | null {
    const fs = require('fs');
    const path = require('path');
    
    // Look for rollout files in current directory and parent directories
    const searchPaths = [
      '.', 
      '..', 
      'codex-cli',
      '../codex-cli',
      '../../codex-cli'
    ];
    
    for (const searchPath of searchPaths) {
      try {
        const files = fs.readdirSync(searchPath);
        const rolloutFiles = files.filter((file: string) => 
          file.startsWith('rollout-') && file.endsWith('.json')
        );
        
        if (rolloutFiles.length > 0) {
          // Use the most recent rollout file
          const fullPath = path.join(searchPath, rolloutFiles[rolloutFiles.length - 1]);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }
      } catch (error) {
        // Ignore errors and continue searching
      }
    }
    
    return null;
  }

  /**
   * Get the next item from the rollout
   */
  public getNextItem(): RolloutItem | null {
    if (!this.rolloutData || this.currentIndex >= this.rolloutData.items.length) {
      return null;
    }
    
    const item = this.rolloutData.items[this.currentIndex];
    if (!item) {
      return null;
    }
    
    this.currentIndex++;
    
    if (this.options.verbose) {
      console.log(`[RolloutReplay] Item ${this.currentIndex}/${this.rolloutData.items.length}: ${item.type}`);
      if (item.type === 'function_call') {
        console.log(`[RolloutReplay] Function: ${item.name}`);
      }
    }
    
    return item;
  }

  /**
   * Skip to a specific item type (e.g., skip to next function_call)
   */
  public skipToType(type: string): RolloutItem | null {
    if (!this.rolloutData) return null;
    
    while (this.currentIndex < this.rolloutData.items.length) {
      const item = this.rolloutData.items[this.currentIndex];
      if (item && item.type === type) {
        return this.getNextItem();
      }
      this.currentIndex++;
    }
    
    return null;
  }

  /**
   * Find the corresponding function_call_output for a function_call
   */
  public findFunctionOutput(callId: string): RolloutItem | null {
    if (!this.rolloutData) return null;
    
    for (let i = this.currentIndex; i < this.rolloutData.items.length; i++) {
      const item = this.rolloutData.items[i];
      if (item && item.type === 'function_call_output' && item.call_id === callId) {
        return item;
      }
    }
    
    return null;
  }

  /**
   * Simulate a delay (if enabled)
   */
  public async delay(): Promise<void> {
    if (this.options.simulateDelay) {
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
    }
  }

  /**
   * Replay a function call and return its output
   */
  public async replayFunctionCall(functionName: string, args: any): Promise<{ output: string; metadata?: any }> {
    await this.delay();
    
    // Find the next function call in the rollout
    const functionCall = this.skipToType('function_call');
    if (!functionCall || functionCall.name !== functionName) {
      // If function doesn't match, provide a generic response
      if (this.options.verbose) {
        console.log(`[RolloutReplay] Function mismatch: expected ${functionName}, got ${functionCall?.name || 'null'}`);
      }
      
      return {
        output: `Mock execution of: ${functionName}\nArguments: ${JSON.stringify(args, null, 2)}\nCommand simulated successfully.`,
        metadata: { exit_code: 0, duration_seconds: 0.1 }
      };
    }
    
    // Find the corresponding output
    const output = this.findFunctionOutput(functionCall.call_id || '');
    if (!output) {
      return {
        output: `Mock execution of: ${functionName}\nNo recorded output found.`,
        metadata: { exit_code: 0, duration_seconds: 0.1 }
      };
    }
    
    try {
      const outputData = JSON.parse(output.output || '{}');
      return {
        output: outputData.output || '',
        metadata: outputData.metadata || { exit_code: 0, duration_seconds: 0.1 }
      };
    } catch (error) {
      return {
        output: output.output || '',
        metadata: { exit_code: 0, duration_seconds: 0.1 }
      };
    }
  }

  /**
   * Get all assistant messages from the rollout
   */
  public getAssistantMessages(): string[] {
    if (!this.rolloutData) return [];
    
    return this.rolloutData.items
      .filter(item => item.type === 'message' && item.role === 'assistant')
      .map(item => {
        if (item.content && item.content.length > 0) {
          return item.content
            .filter(c => c.type === 'output_text')
            .map(c => c.text)
            .join('\n');
        }
        return '';
      })
      .filter(text => text.length > 0);
  }

  /**
   * Get the session information
   */
  public getSessionInfo(): RolloutSession | null {
    return this.rolloutData?.session || null;
  }

  /**
   * Reset the replay to the beginning
   */
  public reset(): void {
    this.currentIndex = 0;
  }

  /**
   * Check if replay is complete
   */
  public isComplete(): boolean {
    return !this.rolloutData || this.currentIndex >= this.rolloutData.items.length;
  }

  /**
   * Get progress information
   */
  public getProgress(): { current: number; total: number; percentage: number } {
    const total = this.rolloutData?.items.length || 0;
    const current = this.currentIndex;
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    
    return { current, total, percentage };
  }
}

/**
 * Create a rollout replay instance with auto-detection
 */
export function createRolloutReplay(prompt: string, options: RolloutReplayOptions = {}): RolloutReplay | null {
  if (!RolloutReplay.shouldUseReplay()) {
    return null;
  }
  
  const replay = new RolloutReplay(options);
  
  // Try to load a specific rollout file or find default
  let rolloutPath = options.rolloutPath;
  if (!rolloutPath) {
    rolloutPath = RolloutReplay.findDefaultRollout(prompt) || undefined;
  }
  
  if (!rolloutPath) {
    console.log('[RolloutReplay] No rollout file found, falling back to mock responses');
    return null;
  }
  
  try {
    replay.loadRollout(rolloutPath);
    console.log(`[RolloutReplay] Using rollout replay mode with: ${rolloutPath}`);
    return replay;
  } catch (error) {
    console.error(`[RolloutReplay] Failed to load rollout: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
} 