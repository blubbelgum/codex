import type {
  ExecInput,
  ExecOutputMetadata,
} from "./agent/sandbox/interface.js";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";

import { log } from "node:console";
import { formatCommandForDisplay } from "src/format-command.js";

// The console utility import is intentionally explicit to avoid bundlers from
// including the entire `console` module when only the `log` function is
// required.

export function parseToolCallOutput(toolCallOutput: string): {
  output: string;
  metadata: ExecOutputMetadata;
} {
  try {
    const { output, metadata } = JSON.parse(toolCallOutput);
    return {
      output,
      metadata,
    };
  } catch (err) {
    return {
      output: `Failed to parse JSON result`,
      metadata: {
        exit_code: 1,
        duration_seconds: 0,
      },
    };
  }
}

export type CommandReviewDetails = {
  cmd: Array<string>;
  cmdReadableText: string;
  workdir: string | undefined;
};

/**
 * Tries to parse a tool call and, if successful, returns an object that has
 * both:
 * - an array of strings to use with `ExecInput` and `canAutoApprove()`
 * - a human-readable string to display to the user
 */
export function parseToolCall(
  toolCall: ResponseFunctionToolCall,
): CommandReviewDetails | undefined {
  const toolCallArgs = parseToolCallArguments(toolCall.arguments);
  
  // Handle OpenCode-style tools that don't have cmd/command fields
  if (toolCallArgs == null) {
    // Check if this is an OpenCode tool by checking the tool name
    const openCodeTools = new Set([
      'read', 'write', 'edit', 'multi_edit', 'ls', 'glob', 'grep', 
      'web_fetch', 'todo', 'todoread', 'todowrite', 'task', 'notebook_read', 'notebook_edit'
    ]);
    
    if (openCodeTools.has(toolCall.name)) {
      try {
        const args = JSON.parse(toolCall.arguments);
        const readableText = formatOpenCodeToolForDisplay(toolCall.name, args);
        return {
          cmd: ["opencode-tool", toolCall.name, toolCall.arguments],
          cmdReadableText: readableText,
          workdir: undefined,
        };
      } catch {
        return {
          cmd: ["opencode-tool", toolCall.name],
          cmdReadableText: `${toolCall.name} (invalid arguments)`,
          workdir: undefined,
        };
      }
    }
    
    return undefined;
  }

  const { cmd, workdir } = toolCallArgs;
  const cmdReadableText = formatCommandForDisplay(cmd);

  return {
    cmd,
    cmdReadableText,
    workdir,
  };
}

/**
 * Format an OpenCode tool call for display
 */
function formatOpenCodeToolForDisplay(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'read':
      return `read ${args['filePath']}${args['offset'] ? ` (from line ${args['offset']})` : ''}`;
    case 'write':
      return `write ${args['filePath']}`;
    case 'edit':
      return `edit ${args['filePath']} (${args['replaceAll'] ? 'replace all' : 'replace first'})`;
    case 'multi_edit': {
      const operations = args['operations'] as Array<{ filePath: string; edits: Array<unknown> }> | undefined;
      if (operations) {
        const fileCount = operations.length;
        const totalEdits = operations.reduce((sum, op) => sum + (op.edits?.length || 0), 0);
        return `multi_edit (${fileCount} files, ${totalEdits} edits)`;
      }
      return 'multi_edit';
    }
    case 'ls':
      return `ls ${args['path'] || '.'}${args['recursive'] ? ' -R' : ''}`;
    case 'glob':
      return `glob "${args['pattern']}"`;
    case 'grep':
      return `grep "${args['pattern']}" ${args['path'] || '.'}`;
    case 'web_fetch':
      return `web_fetch ${args['url']}`;
    case 'todo':
      return `todo ${args['operation']}${args['content'] ? ` "${args['content']}"` : ''}`;
    case 'todoread':
      return `todoread`;
    case 'todowrite': {
      const todos = args['todos'] as Array<unknown> | undefined;
      return `todowrite (${todos?.length || 0} todos)`;
    }
    case 'task':
      return `task "${args['description']}"`;
    case 'notebook_read':
      return `notebook_read ${args['filePath']}`;
    case 'notebook_edit':
      return `notebook_edit ${args['filePath']}`;
    default:
      return `${toolName} (${Object.keys(args).join(', ')})`;
  }
}

/**
 * If toolCallArguments is a string of JSON that can be parsed into an object
 * with a "cmd" or "command" property that is an `Array<string>`, then returns
 * that array. Otherwise, returns undefined.
 */
export function parseToolCallArguments(
  toolCallArguments: string,
): ExecInput | undefined {
  let json: unknown;
  try {
    json = JSON.parse(toolCallArguments);
  } catch (err) {
    log(`Failed to parse toolCall.arguments: ${toolCallArguments}`);
    return undefined;
  }

  if (typeof json !== "object" || json == null) {
    return undefined;
  }

  const { cmd, command, patch } = json as Record<string, unknown>;

  // Auto-fix common mistake: using "patch" parameter instead of "cmd"
  if (patch && !cmd && !command) {
    log(
      `Legacy patch format no longer supported. Use edit() function instead. Arguments: ${toolCallArguments}`,
    );
    return undefined;
  }

  // The OpenAI model sometimes produces a single string instead of an array.
  // Accept both shapes:
  const commandArray =
    toStringArray(cmd) ??
    toStringArray(command) ??
    (typeof cmd === "string" ? [cmd] : undefined) ??
    (typeof command === "string" ? [command] : undefined);

  if (commandArray == null || commandArray.length === 0) {
    return undefined;
  }

  // Check for invalid commands like empty strings or just shell prompts
  const firstCommand = commandArray[0]?.trim();
  if (
    !firstCommand ||
    firstCommand === "$" ||
    firstCommand === ">" ||
    firstCommand === "#"
  ) {
    log(
      `Invalid command detected: ${JSON.stringify(commandArray)} from arguments: ${toolCallArguments}`,
    );
    return undefined;
  }

  // @ts-expect-error timeout and workdir may not exist on json.
  const { timeout, workdir } = json;
  return {
    cmd: commandArray,
    workdir: typeof workdir === "string" ? workdir : undefined,
    timeoutInMillis: typeof timeout === "number" ? timeout : undefined,
  };
}

function toStringArray(obj: unknown): Array<string> | undefined {
  if (Array.isArray(obj) && obj.every((item) => typeof item === "string")) {
    const arrayOfStrings: Array<string> = obj;
    return arrayOfStrings;
  } else {
    return undefined;
  }
}
