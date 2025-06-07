import type { ApprovalPolicy } from "../approvals.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

// Session logging utilities for debugging and history
import { parseToolCall } from "./parsers.js";
import fs from "fs/promises";
import os from "os";
import path from "path";

export interface SessionLogEntry {
  timestamp: string;
  sessionId: string;
  type:
    | "user_input"
    | "assistant_response"
    | "function_call"
    | "function_output"
    | "system_event"
    | "error";
  content: unknown;
  metadata?: Record<string, unknown>;
}

export interface SessionMetadata {
  sessionId: string;
  startTime: string;
  model: string;
  provider: string;
  approvalPolicy: ApprovalPolicy;
  workdir: string;
  version: string;
}

export class SessionLogger {
  private sessionId: string;
  private logPath: string;
  private metadata: SessionMetadata;
  private logQueue: Array<SessionLogEntry> = [];
  private isWriting = false;

  constructor(
    sessionId: string,
    model: string,
    provider: string,
    approvalPolicy: ApprovalPolicy,
    version: string,
  ) {
    this.sessionId = sessionId;
    this.metadata = {
      sessionId,
      startTime: new Date().toISOString(),
      model,
      provider,
      approvalPolicy,
      workdir: process.cwd(),
      version,
    };

    // Create log directory structure
    const homeDir = os.homedir();
    const codexDir = path.join(homeDir, ".codex");
    const logsDir = path.join(codexDir, "logs");

    // Create filename with timestamp for easy sorting
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `session-${timestamp}-${sessionId.slice(0, 8)}.jsonl`;
    this.logPath = path.join(logsDir, filename);

    // Initialize log file
    this.initializeLogFile();
  }

  private async initializeLogFile(): Promise<void> {
    try {
      const logDir = path.dirname(this.logPath);
      await fs.mkdir(logDir, { recursive: true });

      // Write session metadata as first entry
      await this.writeEntry({
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        type: "system_event",
        content: {
          event: "session_start",
          metadata: this.metadata,
        },
      });
    } catch (error) {
      // Silently handle session log initialization errors
    }
  }

  private async writeEntry(entry: SessionLogEntry): Promise<void> {
    try {
      const line = JSON.stringify(entry) + "\n";
      await fs.appendFile(this.logPath, line, "utf8");
    } catch (error) {
      // Silently handle session log write errors
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.isWriting || this.logQueue.length === 0) {
      return;
    }

    this.isWriting = true;
    const entries = [...this.logQueue];
    this.logQueue = [];

    try {
      const lines = entries
        .map((entry) => JSON.stringify(entry) + "\n")
        .join("");
      await fs.appendFile(this.logPath, lines, "utf8");
    } catch (error) {
      // Silently handle session log flush errors
      // Re-add entries to queue for retry
      this.logQueue.unshift(...entries);
    } finally {
      this.isWriting = false;
    }

    // Continue flushing if more entries were added
    if (this.logQueue.length > 0) {
      setImmediate(() => this.flushQueue());
    }
  }

  public logUserInput(input: string, imagePaths?: Array<string>): void {
    const entry: SessionLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: "user_input",
      content: {
        text: input,
        images: imagePaths,
      },
    };

    this.logQueue.push(entry);
    this.flushQueue();
  }

  public logResponseItem(item: ResponseItem): void {
    const entry: SessionLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: this.getEntryTypeFromResponseItem(item),
      content: this.formatResponseItemForLog(item),
      metadata: this.extractMetadataFromResponseItem(item),
    };

    this.logQueue.push(entry);
    this.flushQueue();
  }

  public logSystemEvent(event: string, data?: unknown): void {
    const entry: SessionLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: "system_event",
      content: {
        event,
        data,
      },
    };

    this.logQueue.push(entry);
    this.flushQueue();
  }

  public logError(error: string | Error, context?: unknown): void {
    const entry: SessionLogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: "error",
      content: {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        context,
      },
    };

    this.logQueue.push(entry);
    this.flushQueue();
  }

  private getEntryTypeFromResponseItem(
    item: ResponseItem,
  ): SessionLogEntry["type"] {
    switch (item.type) {
      case "message":
        return item.role === "assistant" ? "assistant_response" : "user_input";
      case "function_call":
        return "function_call";
      case "function_call_output":
        return "function_output";
      default:
        return "system_event";
    }
  }

  private formatResponseItemForLog(item: ResponseItem): unknown {
    switch (item.type) {
      case "message": {
        const text = item.content
          .map((c) => {
            if (c.type === "output_text" || c.type === "input_text") {
              return c.text;
            }
            if (c.type === "input_image") {
              return "<Image>";
            }
            if (c.type === "input_file") {
              return c.filename;
            }
            if (c.type === "refusal") {
              return c.refusal;
            }
            return "?";
          })
          .join(" ");

        return {
          role: item.role,
          text,
          originalContent: item.content,
        };
      }
      case "function_call": {
        const details = parseToolCall(item);
        return {
          name: item.name,
          command: details?.cmdReadableText ?? item.name,
          arguments: details?.cmd,
          originalItem: item,
        };
      }
      case "function_call_output": {
        // @ts-expect-error metadata unknown on ResponseFunctionToolCallOutputItem
        const meta = item.metadata as ExecOutputMetadata | undefined;
        return {
          output: item.output,
          exitCode: meta?.exit_code,
          duration: meta?.duration_seconds,
          callId: item.call_id,
        };
      }
      default: {
        return item;
      }
    }
  }

  private extractMetadataFromResponseItem(
    item: ResponseItem,
  ): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {
      id: item.id,
      type: item.type,
    };

    if (item.type === "function_call_output") {
      // @ts-expect-error metadata unknown on ResponseFunctionToolCallOutputItem
      const meta = item.metadata as ExecOutputMetadata | undefined;
      if (meta) {
        metadata["execution"] = {
          exitCode: meta.exit_code,
          duration: meta.duration_seconds,
        };
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  public async finalize(): Promise<void> {
    // Log session end
    await this.writeEntry({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type: "system_event",
      content: {
        event: "session_end",
        duration: Date.now() - new Date(this.metadata.startTime).getTime(),
      },
    });

    // Flush any remaining entries
    await this.flushQueue();
  }

  public getLogPath(): string {
    return this.logPath;
  }

  public getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }
}

// Helper type for metadata extraction
interface ExecOutputMetadata {
  exit_code?: number;
  duration_seconds?: number;
}
