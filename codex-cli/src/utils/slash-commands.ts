// Defines the available slash commands and their descriptions.
// Used for autocompletion in the chat input.
export interface SlashCommand {
  command: string;
  description: string;
  handler?: (args?: Array<string>) => Promise<string> | string;
}

export const SLASH_COMMANDS: Array<SlashCommand> = [
  {
    command: "/clear",
    description: "Clear conversation history",
    handler: (): string => "Conversation history cleared"
  },
  {
    command: "/clearhistory",
    description: "Clear command history",
    handler: (): string => "Command history cleared"
  },
  {
    command: "/compact",
    description: "Reduce conversation context",
    handler: (): string => "Conversation context compacted"
  },
  { command: "/history", description: "Open command history" },
  { command: "/sessions", description: "Browse previous sessions" },
  {
    command: "/help",
    description: "Show available commands",
    handler: (): string => {
      const commands = SLASH_COMMANDS.map(cmd => `${cmd.command} - ${cmd.description}`).join('\n');
      return `Available commands:\n${commands}`;
    }
  },
  { command: "/model", description: "Open model selection panel" },
  { command: "/approval", description: "Open approval mode selection panel" },
  {
    command: "/bug",
    description: "Generate a prefilled GitHub issue URL with session log",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Generating GitHub issue URL...";
    }
  },
  {
    command: "/diff",
    description:
      "Show git diff of the working directory (or applied patches if not in git)",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Generating git diff...";
    }
  },
  {
    command: "/search",
    description: "Search the web for information and optionally save results to markdown file",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Searching the web...";
    }
  },
  {
    command: "/connect",
    description: "Connect to running Neovim instance for direct buffer editing",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Connecting to Neovim...";
    }
  },
  {
    command: "/disconnect",
    description: "Disconnect from Neovim and return to standard file operations",
    handler: (): string => "Disconnecting from Neovim..."
  },
  {
    command: "/nvim-status",
    description: "Show current Neovim connection status",
    handler: (): string => "Checking Neovim connection status..."
  },
  {
    command: "/lsp-status",
    description: "Show active language servers and their status",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Checking LSP server status...";
    }
  },
  {
    command: "/buffer-list",
    description: "Show all open buffers in connected Neovim instance",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Retrieving buffer list...";
    }
  },
  {
    command: "/diagnostic-summary",
    description: "Show summary of diagnostics (errors/warnings) across all files",
    handler: async (): Promise<string> => {
      // This will be handled by the main command processor
      return "Generating diagnostic summary...";
    }
  }
];
