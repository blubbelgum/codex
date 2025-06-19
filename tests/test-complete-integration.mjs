#!/usr/bin/env node

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

console.log('🧪 Codex Vim Integration - Complete Test Suite');
console.log('=' .repeat(50));

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options 
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => stdout += data.toString());
    child.stderr.on('data', (data) => stderr += data.toString());
    
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    
    child.on('error', reject);
    
    // Timeout after 30 seconds for bridge calls, 5 seconds for others
    const timeout = args[0] && args[0].includes('vim-bridge.js') ? 30000 : 5000;
    setTimeout(() => {
      child.kill();
      reject(new Error('Command timeout'));
    }, timeout);
  });
}

// Test 1: CLI exists and works
test('CLI exists and responds', async () => {
  const result = await runCommand('node', ['codex-cli/dist/cli.js', '--help']);
  assert(result.code === 0, 'CLI should exit with code 0');
  assert(result.stdout.includes('Usage'), 'CLI should show usage information');
});

// Test 2: Vim bridge exists and works
test('Vim bridge exists and responds', async () => {
  const result = await runCommand('node', ['codex-cli/dist/vim-bridge.js', '--test']);
  assert(result.code === 0, 'Bridge should exit with code 0');
  assert(result.stdout.includes('Vim Bridge Test - OK'), 'Bridge should confirm it works');
});

// Test 3: Bridge handles suggestion requests
test('Bridge handles suggestion requests', async () => {
  const request = JSON.stringify({
    action: 'suggest',
    prompt: 'modernize this code',
    filePath: 'test.js',
    content: 'var x = 1;\nvar y = 2;',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 10 }
    }
  });
  
  const result = await runCommand('node', ['codex-cli/dist/vim-bridge.js', request]);
  assert(result.code === 0, 'Bridge should handle suggestion request');
  
  const response = JSON.parse(result.stdout);
  assert(response.success === true, 'Response should be successful');
  assert(response.suggestion, 'Response should contain suggestion');
  assert(response.suggestion.newText, 'Suggestion should have newText');
});

// Test 4: Bridge handles refactor requests
test('Bridge handles refactor requests', async () => {
  const request = JSON.stringify({
    action: 'refactor',
    prompt: 'use const instead of var',
    filePath: 'test.js',
    content: 'var userName = "John";',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 18 }
    }
  });
  
  const result = await runCommand('node', ['codex-cli/dist/vim-bridge.js', request]);
  assert(result.code === 0, 'Bridge should handle refactor request');
  
  const response = JSON.parse(result.stdout);
  assert(response.success === true, 'Response should be successful');
  assert(response.suggestion, 'Response should contain suggestion');
});

// Test 5: Bridge handles explanation requests
test('Bridge handles explanation requests', async () => {
  const request = JSON.stringify({
    action: 'explain',
    prompt: 'what does this do',
    filePath: 'test.js',
    content: 'function add(a, b) { return a + b; }',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 33 }
    }
  });
  
  const result = await runCommand('node', ['codex-cli/dist/vim-bridge.js', request]);
  assert(result.code === 0, 'Bridge should handle explanation request');
  
  const response = JSON.parse(result.stdout);
  assert(response.success === true, 'Response should be successful');
  assert(response.explanation, 'Response should contain explanation');
});

// Test 6: Vim plugin files exist
test('Vim plugin files exist', async () => {
  const pluginFile = join(process.env.HOME, '.vim/plugin/codex.vim');
  const autoloadFile = join(process.env.HOME, '.vim/autoload/codex.vim');
  
  assert(existsSync(pluginFile), 'Plugin file should exist');
  assert(existsSync(autoloadFile), 'Autoload file should exist');
  
  const pluginContent = readFileSync(pluginFile, 'utf8');
  const autoloadContent = readFileSync(autoloadFile, 'utf8');
  
  assert(pluginContent.includes('CodexSidebar'), 'Plugin should include sidebar commands');
  assert(autoloadContent.includes('codex#toggle_sidebar'), 'Autoload should include sidebar functions');
});

// Test 7: Test file transformations
test('Built-in transformations work', async () => {
  // Test var to const transformation
  const varRequest = JSON.stringify({
    action: 'suggest',
    prompt: 'use const',
    filePath: 'test.js',
    content: 'var userName = "John";',
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 18 }
    }
  });
  
  const result = await runCommand('node', ['codex-cli/dist/vim-bridge.js', varRequest]);
  const response = JSON.parse(result.stdout);
  
  assert(response.success === true, 'Transformation should succeed');
  assert(response.suggestion.newText.includes('const'), 'Should convert var to const');
});

// Test 8: Error handling
test('Bridge handles invalid requests gracefully', async () => {
  const invalidRequest = '{"invalid": "json"}';
  
  const result = await runCommand('node', ['codex-cli/dist/vim-bridge.js', invalidRequest]);
  // Bridge should return error response but exit with code 0
  assert(result.code === 0, 'Should exit with code 0 but return error response');
  
  const response = JSON.parse(result.stdout);
  assert(response.success === false, 'Response should indicate failure');
  assert(response.error, 'Response should contain error message');
});

// Run all tests
async function runTests() {
  console.log(`\n🏃 Running ${tests.length} tests...\n`);
  
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! The integration is working perfectly.');
    console.log('\n🚀 Ready to use:');
    console.log('   vim test-sidebar.js');
    console.log('   :CodexSidebar');
    console.log('   Select some code and press "s" for suggestions!');
  } else {
    console.log('⚠️  Some tests failed. Please check the issues above.');
    process.exit(1);
  }
}

runTests().catch(console.error); 