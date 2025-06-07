#!/usr/bin/env node

// This script runs typecheck on the entire project, ignoring any file arguments
// passed by lint-staged. This ensures TypeScript can use the full project context.

import { execSync } from 'child_process';

try {
  execSync('pnpm --filter @openai/codex run typecheck', { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
} 