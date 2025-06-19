#!/usr/bin/env node

/**
 * Test script to simulate Vim integration with buffer-first approach
 */

import fs from 'fs/promises';
import path from 'path';

// Simple mock of what Vim would send
async function testVimIntegration() {
  console.log('🧪 Testing Vim Integration with Buffer-First Approach\n');
  
  const testFile = path.resolve('test-vim-integration.js');
  
  try {
    // Read the test file content (simulating what Vim would send)
    const content = await fs.readFile(testFile, 'utf-8');
    
    console.log('📁 Original file content:');
    console.log('┌─────────────────────────────────────────┐');
    content.split('\n').forEach((line, i) => {
      const lineNum = (i + 1).toString().padStart(2, ' ');
      console.log(`│ ${lineNum} │ ${line}`);
    });
    console.log('└─────────────────────────────────────────┘');
    
    // Simulate Vim request for refactoring
    const vimRequest = {
      action: 'refactor',
      file: testFile,
      prompt: 'convert to modern ES6 syntax',
      range: {
        start: { line: 1, character: 0 },  // function line
        end: { line: 4, character: 1 }     // end of function
      },
      content: content,
      language: 'javascript'
    };
    
    console.log('\n🔄 Simulating Vim refactor request...');
    console.log(`📝 Prompt: "${vimRequest.prompt}"`);
    console.log(`📍 Range: lines ${vimRequest.range.start.line + 1}-${vimRequest.range.end.line + 1}`);
    
    // Simulate the refactoring
    const lines = content.split('\n');
    const originalCode = lines.slice(vimRequest.range.start.line, vimRequest.range.end.line + 1).join('\n');
    
    console.log('\n📖 Code to refactor:');
    console.log('```javascript');
    console.log(originalCode);
    console.log('```');
    
    // Apply simple refactoring rules
    let refactoredCode = originalCode;
    
    // Convert function declaration to arrow function
    refactoredCode = refactoredCode.replace(
      /function\s+(\w+)\s*\((.*?)\)\s*{/g,
      'const $1 = ($2) => {'
    );
    
    // Convert var to const
    refactoredCode = refactoredCode.replace(/var /g, 'const ');
    
    // Convert string concatenation to template literal
    refactoredCode = refactoredCode.replace(
      /"([^"]*)" \+ (\w+)/g,
      '`$1${$2}`'
    );
    
    console.log('\n✨ Refactored code:');
    console.log('```javascript');
    console.log(refactoredCode);
    console.log('```');
    
    // Simulate applying the change (what Vim would do)
    const newLines = [...lines];
    const refactoredLines = refactoredCode.split('\n');
    
    // Replace the range with refactored code
    newLines.splice(
      vimRequest.range.start.line,
      vimRequest.range.end.line - vimRequest.range.start.line + 1,
      ...refactoredLines
    );
    
    const newContent = newLines.join('\n');
    
    console.log('\n📖 Final result:');
    console.log('┌─────────────────────────────────────────┐');
    newContent.split('\n').forEach((line, i) => {
      const lineNum = (i + 1).toString().padStart(2, ' ');
      const isChanged = i >= vimRequest.range.start.line && 
                       i < vimRequest.range.start.line + refactoredLines.length;
      if (isChanged) {
        console.log(`│ ${lineNum} │ ✨ ${line}`);
      } else {
        console.log(`│ ${lineNum} │ ${line}`);
      }
    });
    console.log('└─────────────────────────────────────────┘');
    
    console.log('\n🎯 Vim Integration Benefits:');
    console.log('  • ✅ Direct buffer operations (no patches)');
    console.log('  • ✅ Real-time preview in Vim');
    console.log('  • ✅ Native undo/redo support');
    console.log('  • ✅ Visual mode selection support');
    console.log('  • ✅ Atomic operations');
    
    console.log('\n📋 How to use in Vim:');
    console.log('  1. Select code in visual mode');
    console.log('  2. :CodexRefactor convert to modern ES6 syntax');
    console.log('  3. Preview appears in split window');
    console.log('  4. Press <Enter> to apply or <Esc> to reject');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testVimIntegration().catch(console.error); 