import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentLoop } from "../src/utils/agent/agent-loop.js";
import { AutoApprovalMode } from "../src/utils/auto-approval-mode.js";

// Mock web search module
vi.mock("../src/utils/agent/web-search.js", () => ({
  smartWebSearch: vi.fn().mockResolvedValue([
    {
      title: "Mock Search Result",
      url: "https://example.com",
      snippet: "This is a mock search result",
      relevanceScore: 0.9,
    },
  ]),
  formatSearchResults: vi.fn().mockReturnValue("1. Mock Search Result\n   🔗 https://example.com\n   📄 This is a mock search result\n   ⭐ Relevance: 90%"),
}));

// Mock OpenAI client with web search tool call
const createMockStream = (functionCall: any) => {
  return new (class {
    public controller = { abort: vi.fn() };

    async *[Symbol.asyncIterator]() {
      // Emit function call
      yield {
        type: "response.output_item.done",
        item: functionCall,
      };

      // Emit completion
      yield {
        type: "response.completed",
        response: {
          id: "mock-response-id",
          status: "completed",
          output: [functionCall],
        },
      };
    }
  })();
};

describe("AgentLoop Web Search Integration", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should handle web_search function call with basic query", async () => {
    const { smartWebSearch, formatSearchResults } = await import("../src/utils/agent/web-search.js");

    // Mock OpenAI client
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockResolvedValue(
            createMockStream({
              type: "function_call",
              id: "call_123",
              name: "web_search",
              arguments: JSON.stringify({
                query: "how to use React hooks",
                intent: "documentation",
                maxResults: 5,
              }),
            }),
          ),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const items: any[] = [];
    const agent = new AgentLoop({
      model: "gpt-4",
      config: { 
        apiKey: "test-key",
        model: "gpt-4",
        instructions: "Test instructions"
      },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: (item) => items.push(item),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Search for React hooks documentation" }],
      },
    ]);

    // Verify web search was called
    expect(smartWebSearch).toHaveBeenCalledWith("how to use React hooks", {
      type: "documentation",
      timeframe: "all",
    });

    // Verify format function was called
    expect(formatSearchResults).toHaveBeenCalled();

    // Find the function call output item
    const outputItem = items.find(item => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    
    const output = JSON.parse(outputItem.output);
    expect(output.output).toContain("Found 1 results:");
    expect(output.metadata.exit_code).toBe(0);
    expect(output.metadata.results_count).toBe(1);
  });

  it("should handle web_search function call with troubleshooting intent", async () => {
    const { smartWebSearch } = await import("../src/utils/agent/web-search.js");

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockResolvedValue(
            createMockStream({
              type: "function_call",
              id: "call_456",
              name: "web_search",
              arguments: JSON.stringify({
                query: "Cannot read property of undefined",
                intent: "troubleshooting",
                maxResults: 8,
              }),
            }),
          ),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const items: any[] = [];
    const agent = new AgentLoop({
      model: "gpt-4",
      config: { 
        apiKey: "test-key",
        model: "gpt-4",
        instructions: "Test instructions"
      },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: (item) => items.push(item),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Help me fix this error: Cannot read property of undefined" }],
      },
    ]);

    // Verify web search was called with error type
    expect(smartWebSearch).toHaveBeenCalledWith("Cannot read property of undefined", {
      type: "error",
      timeframe: "all",
    });
  });

  it("should handle web_search function call with news intent and recent timeframe", async () => {
    const { smartWebSearch } = await import("../src/utils/agent/web-search.js");

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockResolvedValue(
            createMockStream({
              type: "function_call",
              id: "call_789",
              name: "web_search",
              arguments: JSON.stringify({
                query: "AI technology updates",
                intent: "news",
                timeRange: "week",
                maxResults: 3,
              }),
            }),
          ),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const items: any[] = [];
    const agent = new AgentLoop({
      model: "gpt-4",
      config: { 
        apiKey: "test-key",
        model: "gpt-4",
        instructions: "Test instructions"
      },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: (item) => items.push(item),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Find recent AI technology news" }],
      },
    ]);

    // Verify web search was called with news type and recent timeframe
    expect(smartWebSearch).toHaveBeenCalledWith("AI technology updates", {
      type: "news",
      timeframe: "recent",
    });
  });

  it("should handle web_search function call with missing query parameter", async () => {
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockResolvedValue(
            createMockStream({
              type: "function_call",
              id: "call_error",
              name: "web_search",
              arguments: JSON.stringify({
                intent: "general",
                maxResults: 5,
              }),
            }),
          ),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const items: any[] = [];
    const agent = new AgentLoop({
      model: "gpt-4",
      config: { apiKey: "test-key" },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: (item) => items.push(item),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Search without query" }],
      },
    ]);

    // Find the function call output item
    const outputItem = items.find(item => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    
    const output = JSON.parse(outputItem.output);
    expect(output.output).toContain("Error: 'query' parameter is required");
    expect(output.metadata.exit_code).toBe(1);
  });

  it("should handle web_search function call with search failure", async () => {
    const { smartWebSearch } = await import("../src/utils/agent/web-search.js");
    
    // Mock search to throw an error
    (smartWebSearch as any).mockRejectedValueOnce(new Error("Network error"));

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockResolvedValue(
            createMockStream({
              type: "function_call",
              id: "call_fail",
              name: "web_search",
              arguments: JSON.stringify({
                query: "test query",
                intent: "general",
              }),
            }),
          ),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const items: any[] = [];
    const agent = new AgentLoop({
      model: "gpt-4",
      config: { apiKey: "test-key" },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: (item) => items.push(item),
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Search for something" }],
      },
    ]);

    // Find the function call output item
    const outputItem = items.find(item => item.type === "function_call_output");
    expect(outputItem).toBeDefined();
    
    const output = JSON.parse(outputItem.output);
    expect(output.output).toContain("Web search failed: Network error");
    expect(output.metadata.exit_code).toBe(1);
  });

  it("should include web_search tool in available tools for standard models", async () => {
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockImplementation((params) => {
            // Verify web_search tool is included
            expect(params.tools).toContainEqual(
              expect.objectContaining({
                type: "function",
                name: "web_search",
              })
            );
            
            return createMockStream({
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Hello" }],
            });
          }),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const agent = new AgentLoop({
      model: "gpt-4",
      config: { apiKey: "test-key" },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
    ]);
  });

  it("should include web_search tool in available tools for codex models", async () => {
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        responses = {
          create: vi.fn().mockImplementation((params) => {
            // Verify web_search tool is included even for codex models
            expect(params.tools).toContainEqual(
              expect.objectContaining({
                name: "web_search",
              })
            );
            
            return createMockStream({
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Hello" }],
            });
          }),
        };
      },
      APIConnectionTimeoutError: class extends Error {},
    }));

    const agent = new AgentLoop({
      model: "codex-mini-latest",
      config: { apiKey: "test-key" },
      approvalPolicy: AutoApprovalMode.FULL_AUTO,
      additionalWritableRoots: [],
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" as any }),
      onLastResponseId: () => {},
    });

    await agent.run([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
    ]);
  });

  it("should pass basic test", () => {
    expect(true).toBe(true);
  });
}); 