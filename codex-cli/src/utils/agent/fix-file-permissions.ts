import { log } from '../logger/log.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Ensures temporary directory is writable
 */
export async function ensureWritableTempDir(): Promise<string> {
  const tempDirs = [
    process.env['TMPDIR'],
    process.env['TEMP'],
    process.env['TMP'],
    '/tmp',
    path.join(os.homedir(), '.tmp'),
    path.join(process.cwd(), '.tmp')
  ].filter(Boolean);

  for (const dir of tempDirs) {
    if (!dir) {
      continue;
    }
    
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fs.constants.W_OK);
      log(`Found writable temp directory: ${dir}`);
      return dir;
    } catch (error) {
      log(`Temp directory ${dir} not writable: ${error}`);
    }
  }

  // Fallback: create temp dir in current working directory
  const fallbackDir = path.join(process.cwd(), '.codex-tmp');
  await fs.mkdir(fallbackDir, { recursive: true });
  log(`Created fallback temp directory: ${fallbackDir}`);
  return fallbackDir;
}

/**
 * Provides alternative file modification approach when patch fails
 */
export function getFileModificationAlternative(
  filePath: string,
  error: string
): string {
  const suggestions = [`File modification failed: ${error}\n`];
  
  if (error.includes('Permission denied') || error.includes('EACCES')) {
    suggestions.push('Alternative approaches:\n');
    suggestions.push('1. Use cat to overwrite the entire file:');
    suggestions.push(`   cat > ${filePath} << 'EOF'`);
    suggestions.push('   [new file content]');
    suggestions.push('   EOF\n');
    
    suggestions.push('2. Use sed for in-place editing:');
    suggestions.push(`   sed -i 's/old_text/new_text/g' ${filePath}\n`);
    
    suggestions.push('3. Create a new file and move it:');
    suggestions.push(`   cat > ${filePath}.new << 'EOF'`);
    suggestions.push('   [new file content]');
    suggestions.push('   EOF');
    suggestions.push(`   mv ${filePath}.new ${filePath}\n`);
  }
  
  return suggestions.join('\n');
}

/**
 * Wraps file operations with permission handling
 */
export async function withPermissionHandling<T>(
  operation: () => Promise<T>,
  filePath: string
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      // Try to make file writable
      try {
        await fs.chmod(filePath, 0o644);
        return await operation();
      } catch {
        throw new Error(getFileModificationAlternative(filePath, error.message));
      }
    }
    throw error;
  }
} 