import type { ResponseItem, ResponseInputItem } from "openai/resources/responses/responses";
import type { ApprovalPolicy } from "../../approvals";
import type { AppConfig } from "../config";
import type { CommandConfirmation } from "./agent-loop";

import { AgentLoop } from "./agent-loop";
import { RolloutReplay, createRolloutReplay } from "../rollout-replay";
import { AutoApprovalMode } from "../auto-approval-mode";
import { ReviewDecision } from "./review";

export interface RolloutAgentLoopOptions {
  model: string;
  config: AppConfig;
  instructions: string;
  provider: string;
  approvalPolicy: ApprovalPolicy;
  additionalWritableRoots: ReadonlyArray<string>;
  disableResponseStorage: boolean;
  onItem: (item: ResponseItem) => void;
  onLoading: () => void;
  getCommandConfirmation: (command: Array<string>) => Promise<CommandConfirmation>;
  onLastResponseId: (responseId: string) => void;
  rolloutPath?: string;
}

/**
 * Agent loop that can use rollout replay mode when test keys are detected
 */
export class RolloutAgentLoop {
  private agentLoop: AgentLoop;
  private rolloutReplay: RolloutReplay | null = null;
  private isReplayMode = false;
  private options: RolloutAgentLoopOptions;

  constructor(options: RolloutAgentLoopOptions) {
    this.options = options;
    
    // Create the standard agent loop
    this.agentLoop = new AgentLoop({
      model: options.model,
      config: options.config,
      instructions: options.instructions,
      provider: options.provider,
      approvalPolicy: options.approvalPolicy,
      additionalWritableRoots: options.additionalWritableRoots,
      disableResponseStorage: options.disableResponseStorage,
      onItem: options.onItem,
      onLoading: options.onLoading,
      getCommandConfirmation: options.getCommandConfirmation,
      onLastResponseId: options.onLastResponseId,
    });
  }

  /**
   * Initialize replay mode if conditions are met
   */
  private initializeReplayMode(prompt: string): boolean {
    if (!RolloutReplay.shouldUseReplay()) {
      return false;
    }

    this.rolloutReplay = createRolloutReplay(prompt, {
      rolloutPath: this.options.rolloutPath,
      verbose: true,
      simulateDelay: true,
      delayMs: 300,
    });

    if (this.rolloutReplay) {
      this.isReplayMode = true;
      console.log('🎬 [RolloutAgentLoop] Replay mode activated');
      return true;
    }

    return false;
  }

  /**
   * Run the agent with potential rollout replay
   */
  public async run(inputItems: Array<ResponseInputItem>): Promise<void> {
    // Extract prompt from input items - simplified approach
    let prompt = '';
    for (const item of inputItems) {
      if (item.type === 'message' && item.role === 'user') {
        if (Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === 'input_text') {
              prompt += contentItem.text + ' ';
            }
          }
        }
      }
    }
    prompt = prompt.trim();

    // Try to initialize replay mode
    if (this.initializeReplayMode(prompt)) {
      await this.runReplayMode(inputItems);
    } else {
      // Fall back to standard agent loop
      await this.agentLoop.run(inputItems);
    }
  }

  /**
   * Run in replay mode
   */
  private async runReplayMode(inputItems: Array<ResponseInputItem>): Promise<void> {
    if (!this.rolloutReplay) {
      throw new Error('Replay mode not initialized');
    }

    console.log('🎬 [RolloutAgentLoop] Starting replay session...');
    
    const sessionInfo = this.rolloutReplay.getSessionInfo();
    if (sessionInfo) {
      console.log(`📅 Session: ${sessionInfo.id} (${sessionInfo.timestamp})`);
    }

    // Emit the user input message
    const userContent: Array<{ type: string; text: string }> = [];
    for (const item of inputItems) {
      if (item.type === 'message' && item.role === 'user' && Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (contentItem.type === 'input_text') {
            userContent.push({
              type: 'input_text',
              text: contentItem.text
            });
          }
        }
      }
    }
    
    this.options.onItem({
      type: 'message',
      role: 'user',
      content: userContent
    } as ResponseItem);

    // Process the rollout items
    let item = this.rolloutReplay.getNextItem();
    while (item) {
      await this.processReplayItem(item);
      item = this.rolloutReplay.getNextItem();
    }

    console.log('✅ [RolloutAgentLoop] Replay session completed');
  }

  /**
   * Process a single replay item
   */
  private async processReplayItem(item: any): Promise<void> {
    if (!this.rolloutReplay) return;

    await this.rolloutReplay.delay();

    switch (item.type) {
      case 'message':
        if (item.role === 'system') {
          // Skip system messages or handle them specially
          break;
        }
        
        // Emit the message
        this.options.onItem({
          type: 'message',
          role: item.role,
          content: item.content || []
        } as ResponseItem);
        break;

      case 'function_call':
        // Emit the function call
        this.options.onItem({
          type: 'function_call',
          id: item.id,
          status: item.status,
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments
        } as ResponseItem);

        // Handle command approval if it's a shell command
        if (item.name === 'shell' && item.arguments) {
          try {
            const args = JSON.parse(item.arguments);
            const command = args.command || [];
            
            // Get command confirmation (this will respect the approval policy)
            const confirmation = await this.options.getCommandConfirmation(command);
            
            if (confirmation.review === ReviewDecision.NO_CONTINUE) {
              console.log('⏭️  [RolloutAgentLoop] Command skipped by approval policy');
              break;
            }
          } catch (error) {
            console.warn('⚠️  [RolloutAgentLoop] Failed to parse function arguments:', error);
          }
        }
        break;

      case 'function_call_output':
        // Emit the function output
        this.options.onItem({
          type: 'function_call_output',
          call_id: item.call_id,
          output: item.output
        } as ResponseItem);
        break;

      default:
        console.warn('⚠️  [RolloutAgentLoop] Unknown item type:', item.type);
    }
  }

  /**
   * Get replay progress (if in replay mode)
   */
  public getReplayProgress(): { current: number; total: number; percentage: number } | null {
    if (!this.isReplayMode || !this.rolloutReplay) {
      return null;
    }
    
    return this.rolloutReplay.getProgress();
  }

  /**
   * Check if currently in replay mode
   */
  public isInReplayMode(): boolean {
    return this.isReplayMode;
  }

  /**
   * Get the session info from the rollout (if available)
   */
  public getReplaySessionInfo() {
    if (!this.rolloutReplay) {
      return null;
    }
    
    return this.rolloutReplay.getSessionInfo();
  }

  /**
   * Terminate the agent loop
   */
  public terminate(): void {
    this.agentLoop.terminate();
  }

  /**
   * Cancel the current operation
   */
  public cancel(): void {
    this.agentLoop.cancel();
  }

  /**
   * Get the model
   */
  public get model(): string {
    return this.options.model;
  }

  /**
   * Get the provider
   */
  public get provider(): string {
    return this.options.provider;
  }

  /**
   * Get the approval policy
   */
  public get approvalPolicy(): ApprovalPolicy {
    return this.options.approvalPolicy;
  }

  /**
   * Get the config
   */
  public get config(): AppConfig {
    return this.options.config;
  }
}

/**
 * Create a rollout-aware agent loop that automatically switches to replay mode when appropriate
 */
export function createRolloutAwareAgentLoop(options: RolloutAgentLoopOptions): RolloutAgentLoop {
  return new RolloutAgentLoop(options);
} 