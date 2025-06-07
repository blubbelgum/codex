# Windows Distribution Guide

This guide explains how to create and distribute the Codex CLI on Windows systems.

## Quick Distribution

To create a shareable package for Windows users, use one of these methods:

### Method 1: Using pnpm (Recommended)

```cmd
pnpm stage-release
```

This will create a staging directory with a distributable package. The output will show you the location.

### Method 2: Using Node.js directly

```cmd
node scripts/stage_release.js
```

### Method 3: Using PowerShell

```powershell
.\scripts\stage_release.ps1
```

### Method 4: Using Batch file

```cmd
scripts\stage_release.bat
```

## Distribution Options

After running the staging command, you'll get a temporary directory with the packaged CLI. You can then:

### Option A: Create a tarball (recommended for sharing)

```cmd
cd "path\to\staging\directory"
npm pack
```

This creates a `.tgz` file you can share with others.

### Option B: Install globally for testing

```cmd
cd "path\to\staging\directory"
npm install -g .
```

### Option C: Share the entire staging directory

You can zip the entire staging directory and share it.

## For Recipients

If someone shares the Codex CLI with you:

### From a .tgz file:

```cmd
npm install -g openai-codex-VERSION.tgz
```

### From a staging directory:

```cmd
cd path\to\codex\directory
npm install -g .
```

### From source:

```cmd
git clone <repository>
cd codex-cli
pnpm install
pnpm build
npm install -g .
```

## Requirements

- Node.js 22 or higher
- npm or pnpm
- OpenAI API key (set as OPENAI_API_KEY environment variable)

## Testing the Installation

After installation, test the CLI:

```cmd
codex --help
```

## Troubleshooting

### PowerShell Execution Policy

If you get an execution policy error when running PowerShell scripts:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Path Issues

If `codex` command is not found after global installation, ensure your npm global bin directory is in your PATH:

```cmd
npm config get prefix
```

Add `%npm_prefix%` to your PATH environment variable.

### Permission Issues

If you encounter permission issues during global installation, try:

```cmd
npm install -g . --force
```

Or install without global flag and create a batch file to run it:

```cmd
npm install
echo @node "%cd%\bin\codex.js" %* > codex.bat
```

## Scripts Available

- `stage_release.js` - Cross-platform Node.js script (main)
- `stage_release.ps1` - PowerShell script for Windows
- `stage_release.bat` - Batch file for Windows Command Prompt
- `stage_release.sh` - Original bash script (requires WSL/Git Bash on Windows)
