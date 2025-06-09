# 🎬 Rollout Replay System Guide

The Rollout Replay System allows you to replay previously recorded AI sessions without making real API calls. This is extremely useful for testing, development, and demonstration purposes.

## 🚀 Quick Start

### 1. Basic Usage with Test Key

Set your API key to `test_key` and run any command:

```powershell
# Windows PowerShell
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --model gemini-2.5-flash-preview-05-20 --full-auto "create a simple website"
```

```bash
# Linux/Mac
export GEMINI_API_KEY="test_key"
node dist/cli.js --provider gemini --model gemini-2.5-flash-preview-05-20 --full-auto "create a simple website"
```

### 2. Using with Existing Rollout Files

The system automatically detects rollout JSON files in:

- Current directory (`rollout-*.json`)
- Parent directories
- `codex-cli/` directory

Example rollout filename: `rollout-2025-06-09-850cc2e4-60fb-4468-b349-ed921ae4e17d.json`

## 🔧 How It Works

### Automatic Detection

The replay system activates when:

1. **Test API Key**: Any of these API keys are set to `test_key`:

   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `MISTRAL_API_KEY`
   - `DEEPSEEK_API_KEY`
   - `XAI_API_KEY`
   - `GROQ_API_KEY`

2. **Force Replay**: Set `CODEX_FORCE_REPLAY=1`

### Rollout File Structure

Rollout files contain:

```json
{
  "session": {
    "timestamp": "2025-06-09T07:23:30.620Z",
    "id": "session-id",
    "instructions": "Session instructions..."
  },
  "items": [
    {
      "id": "user-1",
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "create a simple website" }]
    },
    {
      "id": "function-call-2",
      "type": "function_call",
      "call_id": "call_1",
      "name": "shell",
      "arguments": "{\"command\":[\"mkdir\",\"web-project\"]}"
    },
    {
      "id": "function-output-3",
      "type": "function_call_output",
      "call_id": "call_1",
      "output": "{\"output\":\"\",\"metadata\":{\"exit_code\":0,\"duration_seconds\":0.1}}"
    }
  ]
}
```

## 🛠️ Advanced Usage

### 1. Creating Mock Rollouts

You can create mock rollout files for testing specific scenarios:

```javascript
// create-mock-rollout.js
const mockRollout = {
  session: {
    timestamp: new Date().toISOString(),
    id: `mock-session-${Date.now()}`,
    instructions: "Test environment for development",
  },
  items: [
    {
      id: "user-1",
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "create a todo app" }],
    },
    {
      id: "function-call-2",
      type: "function_call",
      call_id: "call_1",
      name: "apply_patch",
      arguments: JSON.stringify({
        patch:
          "*** Begin Patch\\n*** Add File: todo.html\\n+<html>...</html>\\n*** End Patch",
      }),
    },
    {
      id: "function-output-3",
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({
        output: "Done!",
        metadata: { exit_code: 0, duration_seconds: 0.1 },
      }),
    },
    {
      id: "assistant-4",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "I've created a todo app..." }],
    },
  ],
};

require("fs").writeFileSync(
  `rollout-mock-${Date.now()}.json`,
  JSON.stringify(mockRollout, null, 2),
);
```

### 2. Environment Variables

Control replay behavior with environment variables:

```powershell
# Force replay mode
$env:CODEX_FORCE_REPLAY = "1"

# Use test key (triggers replay)
$env:GEMINI_API_KEY = "test_key"

# Debug mode for verbose output
$env:DEBUG = "1"
```

### 3. Testing Different Scenarios

Test different approval modes:

```powershell
# Test suggest mode (default)
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini "create a web app"

# Test auto-edit mode
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --auto-edit "create a web app"

# Test full-auto mode
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --full-auto "create a web app"
```

## 📋 Testing Commands

### Web Development

```powershell
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --full-auto "Create a modern React TypeScript web application with Tailwind CSS"
```

### File Operations

```powershell
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --full-auto "Create a Python script that processes CSV files"
```

### Data Analysis

```powershell
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --full-auto "Analyze the data in data.csv and create visualizations"
```

## 🔍 Debugging

### Verbose Output

Enable verbose logging:

```powershell
$env:DEBUG = "1"
$env:GEMINI_API_KEY = "test_key"
node dist/cli.js --provider gemini --full-auto "your prompt here"
```

### Test Rollout System

Run the test script:

```powershell
npm run build
node test-rollout-replay.js
```

### Check Replay Status

The CLI will show when replay mode is active:

```
🎬 [Rollout Replay] Detected test environment - using rollout replay mode
🎬 [RolloutAgentLoop] Replay mode activated
📅 Session: f4d668a3-11ab-443a-929f-118db92c79a5 (2025-06-09T07:23:30.620Z)
```

## 🎯 Benefits

### For Testing

- **No API costs**: Test without consuming real API credits
- **Deterministic**: Same input always produces same output
- **Fast**: No network delays
- **Offline**: Works without internet connection

### For Development

- **Debugging**: Step through AI interactions
- **Demo**: Show functionality without real API calls
- **CI/CD**: Include in automated tests

### For Learning

- **Understanding**: See how AI responds to prompts
- **Experimentation**: Try different approval modes
- **Documentation**: Generate examples for documentation

## 📁 File Locations

The system searches for rollout files in this order:

1. Current working directory
2. Parent directory (`../`)
3. `codex-cli/` directory
4. `../codex-cli/`
5. `../../codex-cli/`

## 🚨 Troubleshooting

### Rollout File Not Found

```
[RolloutReplay] No rollout file found, falling back to mock responses
```

**Solution**: Ensure you have a `rollout-*.json` file in one of the search directories.

### API Key Not Recognized

```
Should use replay: ❌ NO
```

**Solution**: Make sure your API key is exactly `test_key` or set `CODEX_FORCE_REPLAY=1`.

### Type Errors

If you see TypeScript errors, make sure you build first:

```powershell
npm run build
```

### Function Mismatch

```
[RolloutReplay] Function mismatch: expected shell, got apply_patch
```

**Solution**: This is normal - the system will provide mock responses when functions don't match exactly.

## 🔄 Workflow Example

1. **Record a session** (with real API):

   ```powershell
   $env:GEMINI_API_KEY = "real_api_key"
   node dist/cli.js --provider gemini --full-auto "create a website"
   # This saves rollout-[timestamp]-[id].json
   ```

2. **Replay the session** (without API calls):

   ```powershell
   $env:GEMINI_API_KEY = "test_key"
   node dist/cli.js --provider gemini --full-auto "create a website"
   # Uses the rollout file for replay
   ```

3. **Share for testing**:
   ```powershell
   # Anyone can run this without API keys
   $env:GEMINI_API_KEY = "test_key"
   node dist/cli.js --provider gemini --full-auto "create a website"
   ```

## 🎉 Next Steps

- Integrate with CI/CD pipelines
- Create test suites with multiple rollout scenarios
- Build documentation with reproducible examples
- Develop training materials using replay mode

The Rollout Replay System makes Codex CLI testing and development much more efficient and cost-effective!
