import { useCallback, useState } from 'react';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

export interface ClipboardOptions {
  onCopy?: (text: string) => void;
  onPaste?: (text: string) => void;
  onError?: (error: Error) => void;
}

export function useClipboard(options: ClipboardOptions = {}) {
  const [isSupported, setIsSupported] = useState(true);
  const [lastCopied, setLastCopied] = useState<string>('');

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      const platform = os.platform();
      
      if (platform === 'darwin') {
        // macOS
        await execAsync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
      } else if (platform === 'linux') {
        // Linux - try xclip first, then xsel
        try {
          await execAsync(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard`);
        } catch {
          await execAsync(`echo "${text.replace(/"/g, '\\"')}" | xsel --clipboard --input`);
        }
      } else if (platform === 'win32') {
        // Windows
        await execAsync(`echo "${text.replace(/"/g, '\\"')}" | clip`);
      } else {
        throw new Error('Unsupported platform');
      }
      
      setLastCopied(text);
      options.onCopy?.(text);
    } catch (error) {
      setIsSupported(false);
      options.onError?.(error as Error);
    }
  }, [options]);

  const pasteFromClipboard = useCallback(async (): Promise<string> => {
    try {
      const platform = os.platform();
      let result: string;
      
      if (platform === 'darwin') {
        // macOS
        const { stdout } = await execAsync('pbpaste');
        result = stdout;
      } else if (platform === 'linux') {
        // Linux - try xclip first, then xsel
        try {
          const { stdout } = await execAsync('xclip -selection clipboard -o');
          result = stdout;
        } catch {
          const { stdout } = await execAsync('xsel --clipboard --output');
          result = stdout;
        }
      } else if (platform === 'win32') {
        // Windows PowerShell
        const { stdout } = await execAsync('powershell.exe Get-Clipboard');
        result = stdout;
      } else {
        throw new Error('Unsupported platform');
      }
      
      options.onPaste?.(result);
      return result;
    } catch (error) {
      setIsSupported(false);
      options.onError?.(error as Error);
      return '';
    }
  }, [options]);

  return {
    copyToClipboard,
    pasteFromClipboard,
    isSupported,
    lastCopied,
  };
} 