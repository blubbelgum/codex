import type { FileOperation } from './file-operations';

import { log } from '../logger/log';

const PATCH_PREFIX = '*** Begin Patch\n';
const PATCH_SUFFIX = '\n*** End Patch';
const ADD_FILE_PREFIX = '*** Add File: ';
const DELETE_FILE_PREFIX = '*** Delete File: ';
const UPDATE_FILE_PREFIX = '*** Update File: ';
const END_OF_FILE_PREFIX = '*** End of File';

interface PatchOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  update?: {
    oldContent: string;
    newContent: string;
  };
}

/**
 * Parses the old apply_patch format into a list of file operations
 */
function parseOldPatchFormat(patchText: string): Array<PatchOperation> {
  if (!patchText.startsWith(PATCH_PREFIX) || !patchText.endsWith(PATCH_SUFFIX)) {
    throw new Error('Invalid patch format: Missing begin/end markers');
  }

  const patchBody = patchText.slice(
    PATCH_PREFIX.length,
    patchText.length - PATCH_SUFFIX.length
  );

  const lines = patchBody.split('\n');
  const operations: Array<PatchOperation> = [];
  let currentOp: PatchOperation | null = null;
  let contextLines: Array<string> = [];

  for (const line of lines) {
    if (line.startsWith(END_OF_FILE_PREFIX)) {
      continue;
    }

    if (line.startsWith(ADD_FILE_PREFIX)) {
      currentOp = {
        type: 'create',
        path: line.slice(ADD_FILE_PREFIX.length).trim(),
        content: ''
      };
      operations.push(currentOp);
      continue;
    }

    if (line.startsWith(DELETE_FILE_PREFIX)) {
      currentOp = {
        type: 'delete',
        path: line.slice(DELETE_FILE_PREFIX.length).trim()
      };
      operations.push(currentOp);
      continue;
    }

    if (line.startsWith(UPDATE_FILE_PREFIX)) {
      currentOp = {
        type: 'update',
        path: line.slice(UPDATE_FILE_PREFIX.length).trim(),
        update: {
          oldContent: '',
          newContent: ''
        }
      };
      operations.push(currentOp);
      contextLines = [];
      continue;
    }

    if (!currentOp) {
      continue;
    }

    if (currentOp.type === 'create' && line.startsWith('+')) {
      currentOp.content = (currentOp.content || '') + line.slice(1) + '\n';
    } else if (currentOp.type === 'update') {
      if (line.startsWith('@@')) {
        // Context marker, store for reference
        contextLines.push(line);
      } else if (line.startsWith('-')) {
        currentOp.update!.oldContent += line.slice(1) + '\n';
      } else if (line.startsWith('+')) {
        currentOp.update!.newContent += line.slice(1) + '\n';
      } else if (line.trim()) {
        // Context line
        contextLines.push(line);
        currentOp.update!.oldContent += line + '\n';
        currentOp.update!.newContent += line + '\n';
      }
    }
  }

  return operations;
}

/**
 * Converts an old-style patch operation to the new FileOperation format
 */
function convertToFileOperation(op: PatchOperation): FileOperation {
  let oldLines: Array<string>;
  let newLines: Array<string>;
  let diff: string;

  switch (op.type) {
    case 'create':
      return {
        type: 'create',
        path: op.path,
        content: op.content?.trimEnd() || ''
      };

    case 'delete':
      return {
        type: 'delete',
        path: op.path
      };

    case 'update':
      if (!op.update) {
        throw new Error('Missing update content for update operation');
      }

      oldLines = op.update.oldContent.split('\n');
      newLines = op.update.newContent.split('\n');
      
      // Simple unified diff format
      diff = [
        `--- ${op.path}`,
        `+++ ${op.path}`,
        `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
        ...oldLines.map(line => `-${line}`),
        ...newLines.map(line => `+${line}`)
      ].join('\n');

      return {
        type: 'update',
        path: op.path,
        diff
      };
  }
}

/**
 * Converts an old apply_patch command to the new unified diff format
 */
export function convertOldPatchToUnifiedDiff(patchText: string): Array<FileOperation> {
  try {
    log('Converting old patch format to unified diff...');
    const oldOps = parseOldPatchFormat(patchText);
    return oldOps.map(convertToFileOperation);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to convert patch format: ${errorMessage}`);
  }
} 