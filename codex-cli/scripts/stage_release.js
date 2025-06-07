#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { cp } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function usage(exitCode = 0) {
  console.log(`
Usage: node stage_release.js [--tmp DIR] [--native]

Options
  --tmp DIR   Use DIR to stage the release (defaults to a fresh temp dir)
  --native    Bundle Rust binaries for Linux (fat package)
  -h, --help  Show this help
`);
  process.exit(exitCode);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let tmpDir = '';
  let includeNative = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--tmp') {
      if (i + 1 >= args.length) {
        console.error('--tmp requires an argument');
        usage(1);
      }
      tmpDir = args[++i];
    } else if (arg.startsWith('--tmp=')) {
      tmpDir = arg.substring('--tmp='.length);
    } else if (arg === '--native') {
      includeNative = true;
    } else if (arg === '-h' || arg === '--help') {
      usage(0);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`);
      usage(1);
    } else {
      console.error(`Unexpected extra argument: ${arg}`);
      usage(1);
    }
  }

  return { tmpDir, includeNative };
}

function runCommand(command, cwd = process.cwd()) {
  console.log(`Running: ${command}`);
  try {
    execSync(command, { 
      cwd, 
      stdio: 'inherit',
      shell: true
    });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    throw error;
  }
}

function copyRecursive(src, dest) {
  return cp(src, dest, { recursive: true });
}

async function main() {
  const { tmpDir: userTmpDir, includeNative } = parseArgs();
  
  // Determine staging directory
  let stagingDir;
  if (userTmpDir) {
    stagingDir = resolve(userTmpDir);
  } else {
    // Create a unique temporary directory
    const timestamp = Date.now();
    stagingDir = join(tmpdir(), `codex-staging-${timestamp}`);
  }

  // Ensure staging directory exists
  mkdirSync(stagingDir, { recursive: true });
  console.log(`Staging release in ${stagingDir}`);

  // Navigate to codex-cli root (parent of scripts directory)
  const codexCliRoot = resolve(__dirname, '..');
  console.log(`Working from: ${codexCliRoot}`);
  
  process.chdir(codexCliRoot);

  try {
    // 1. Build the JS artifacts
    console.log('Installing dependencies...');
    runCommand('pnpm install');
    
    console.log('Building project...');
    runCommand('pnpm build');

    // 2. Create staging directory structure
    const stagingBinDir = join(stagingDir, 'bin');
    const stagingDistDir = join(stagingDir, 'dist');
    const stagingSrcDir = join(stagingDir, 'src');

    mkdirSync(stagingBinDir, { recursive: true });
    mkdirSync(stagingDistDir, { recursive: true });
    mkdirSync(stagingSrcDir, { recursive: true });

    // 3. Copy essential files
    console.log('Copying files...');
    
    // Copy bin directory
    copyFileSync(join('bin', 'codex.js'), join(stagingBinDir, 'codex.js'));
    
    // Copy dist directory
    await copyRecursive('dist', stagingDistDir);
    
    // Copy src directory (for TypeScript sourcemaps)
    await copyRecursive('src', stagingSrcDir);
    
    // Copy package.json
    copyFileSync('package.json', join(stagingDir, 'package.json'));
    
    // Copy README.md from parent directory if it exists
    const readmePath = join('..', 'README.md');
    if (existsSync(readmePath)) {
      copyFileSync(readmePath, join(stagingDir, 'README.md'));
    }

    // 4. Update package.json with timestamp-based version
    const packageJsonPath = join(stagingDir, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    // Create timestamp-based version
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const version = `0.1.${year}${month}${day}${hour}${minute}`;
    
    packageJson.version = version;
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // 5. Handle native dependencies (if requested)
    if (includeNative) {
      console.log('Installing native dependencies...');
      // For now, we'll skip the native binary installation on Windows
      // This would require additional setup for Linux binaries
      console.log('Native binary installation skipped on Windows');
    }

    console.log(`\nStaged version ${version} for release in ${stagingDir}`);
    console.log('\nTo test the package:');
    console.log(`    cd "${stagingDir}"`);
    console.log(`    npm install`);
    console.log(`    node bin/codex.js --help`);
    console.log('\nTo install globally:');
    console.log(`    cd "${stagingDir}"`);
    console.log(`    npm install -g .`);
    console.log('\nTo create a distributable package:');
    console.log(`    cd "${stagingDir}"`);
    console.log(`    npm pack`);

  } catch (error) {
    console.error('Staging failed:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 