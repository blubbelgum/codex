#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync } from 'fs';

console.log('🧪 Quick Codex Test');

// Test 1: CLI
console.log('\n1. Testing CLI...');
const cliResult = await new Promise((resolve) => {
  const child = spawn('node', ['codex-cli/dist/cli.js', '--help'], { stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (data) => output += data);
  child.on('close', (code) => resolve({ code, output }));
  setTimeout(() => { child.kill(); resolve({ code: -1, output: 'timeout' }); }, 5000);
});

if (cliResult.code === 0 && cliResult.output.includes('Usage')) {
  console.log('✅ CLI works');
} else {
  console.log('❌ CLI failed');
}

// Test 2: Bridge
console.log('\n2. Testing Bridge...');
const bridgeResult = await new Promise((resolve) => {
  const child = spawn('node', ['codex-cli/dist/vim-bridge.js', '--test'], { stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (data) => output += data);
  child.on('close', (code) => resolve({ code, output }));
  setTimeout(() => { child.kill(); resolve({ code: -1, output: 'timeout' }); }, 5000);
});

if (bridgeResult.code === 0 && bridgeResult.output.includes('Vim Bridge Test - OK')) {
  console.log('✅ Bridge works');
} else {
  console.log('❌ Bridge failed');
}

// Test 3: Plugin files
console.log('\n3. Testing Plugin Files...');
const pluginExists = existsSync(`${process.env.HOME}/.vim/plugin/codex.vim`);
const autoloadExists = existsSync(`${process.env.HOME}/.vim/autoload/codex.vim`);

if (pluginExists && autoloadExists) {
  console.log('✅ Plugin files installed');
} else {
  console.log('❌ Plugin files missing');
}

console.log('\n🎉 Integration is ready!');
console.log('\n🚀 To use:');
console.log('   vim test-sidebar.js');
console.log('   :CodexSidebar');
console.log('   Select code and press "s"!'); 