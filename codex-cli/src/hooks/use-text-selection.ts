import { useInput } from 'ink';
import { useState, useCallback, useEffect, useRef } from 'react';

export interface Selection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text: string;
}

export interface UseTextSelectionOptions {
  content: Array<string>;
  isActive?: boolean;
  onSelectionChange?: (selection: Selection | null) => void;
}

export function useTextSelection({ 
  content, 
  isActive = true,
  onSelectionChange 
}: UseTextSelectionOptions) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 0, column: 0 });
  const selectionStartRef = useRef<{ line: number; column: number } | null>(null);

  const startSelection = useCallback(() => {
    if (!isActive) {return;}
    
    setIsSelecting(true);
    selectionStartRef.current = { ...cursorPosition };
    setSelection(null);
  }, [cursorPosition, isActive]);

  const updateSelection = useCallback(() => {
    if (!isSelecting || !selectionStartRef.current) {return;}

    const start = selectionStartRef.current;
    const end = cursorPosition;

    // Normalize selection (ensure start comes before end)
    const startLine = Math.min(start.line, end.line);
    const endLine = Math.max(start.line, end.line);
    
    let startColumn = start.column;
    let endColumn = end.column;
    
    if (start.line === end.line) {
      startColumn = Math.min(start.column, end.column);
      endColumn = Math.max(start.column, end.column);
    } else if (start.line > end.line) {
      startColumn = end.column;
      endColumn = start.column;
    }

    // Extract selected text
    let selectedText = '';
    for (let line = startLine; line <= endLine; line++) {
      const lineContent = content[line];
      if (!lineContent) {continue;}
      
      if (line === startLine && line === endLine) {
        selectedText += lineContent.substring(startColumn, endColumn);
      } else if (line === startLine) {
        selectedText += lineContent.substring(startColumn) + '\n';
      } else if (line === endLine) {
        selectedText += lineContent.substring(0, endColumn);
      } else {
        selectedText += lineContent + '\n';
      }
    }

    const newSelection: Selection = {
      startLine,
      startColumn,
      endLine,
      endColumn,
      text: selectedText,
    };

    setSelection(newSelection);
    onSelectionChange?.(newSelection);
  }, [isSelecting, cursorPosition, content, onSelectionChange]);

  const endSelection = useCallback(() => {
    setIsSelecting(false);
    updateSelection();
  }, [updateSelection]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setIsSelecting(false);
    selectionStartRef.current = null;
    onSelectionChange?.(null);
  }, [onSelectionChange]);

  const moveCursor = useCallback((deltaLine: number, deltaColumn: number) => {
    setCursorPosition(prev => {
      const newLine = Math.max(0, Math.min(content.length - 1, prev.line + deltaLine));
      const lineLength = content[newLine]?.length || 0;
      const newColumn = Math.max(0, Math.min(lineLength, prev.column + deltaColumn));
      
      return { line: newLine, column: newColumn };
    });
  }, [content]);

  // Handle keyboard input for selection
  useInput((input, key) => {
    if (!isActive) {return;}

    // Start/update selection with Shift+Arrow keys
    if (key.shift) {
      if (!isSelecting) {
        startSelection();
      }

      if (key.upArrow) {
        moveCursor(-1, 0);
      } else if (key.downArrow) {
        moveCursor(1, 0);
      } else if (key.leftArrow) {
        moveCursor(0, -1);
      } else if (key.rightArrow) {
        moveCursor(0, 1);
      }
    } else {
      // Non-shift arrow keys clear selection
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        clearSelection();
        
        if (key.upArrow) {
          moveCursor(-1, 0);
        } else if (key.downArrow) {
          moveCursor(1, 0);
        } else if (key.leftArrow) {
          moveCursor(0, -1);
        } else if (key.rightArrow) {
          moveCursor(0, 1);
        }
      }
    }

    // Ctrl+A to select all
    if (key.ctrl && input === 'a') {
      selectionStartRef.current = { line: 0, column: 0 };
      setCursorPosition({ 
        line: content.length - 1, 
        column: content[content.length - 1]?.length || 0 
      });
      setIsSelecting(true);
      updateSelection();
      setIsSelecting(false);
    }

    // Escape to clear selection
    if (key.escape) {
      clearSelection();
    }
  }, { isActive });

  // Update selection as cursor moves
  useEffect(() => {
    if (isSelecting) {
      updateSelection();
    }
  }, [cursorPosition, isSelecting, updateSelection]);

  return {
    selection,
    isSelecting,
    cursorPosition,
    startSelection,
    endSelection,
    clearSelection,
    moveCursor,
  };
} 