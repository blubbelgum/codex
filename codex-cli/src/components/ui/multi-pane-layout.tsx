import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTerminalSize } from '../../hooks/use-terminal-size.js';

export interface Pane {
  id: string;
  title: string;
  component: React.ReactElement;
  minWidth?: number;
  minHeight?: number;
  flexible?: boolean;
}

export interface PaneLayout {
  type: 'horizontal' | 'vertical';
  panes: Array<Pane | PaneLayout>;
  sizes?: number[]; // Proportional sizes (sum should equal 1)
}

interface MultiPaneLayoutProps {
  layout: PaneLayout;
  isActive?: boolean;
  showBorders?: boolean;
  activePaneId?: string;
  onPaneChange?: (paneId: string) => void;
}

export function MultiPaneLayout({
  layout,
  isActive = true,
  showBorders = true,
  activePaneId,
  onPaneChange,
}: MultiPaneLayoutProps) {
  const { columns, rows } = useTerminalSize();
  const [focusedPaneIndex, setFocusedPaneIndex] = useState(0);
  const [paneSizes, setPaneSizes] = useState<number[]>(
    layout.sizes || Array(layout.panes.length).fill(1 / layout.panes.length)
  );

  // Get all pane IDs for navigation
  const getAllPaneIds = (paneLayout: PaneLayout): string[] => {
    const ids: string[] = [];
    
    paneLayout.panes.forEach(pane => {
      if ('id' in pane) {
        ids.push(pane.id);
      } else {
        ids.push(...getAllPaneIds(pane));
      }
    });
    
    return ids;
  };

  const allPaneIds = useMemo(() => getAllPaneIds(layout), [layout]);

  // Handle pane navigation
  useInput((input, key) => {
    if (!isActive) return;

    if (key.tab && !key.shift) {
      // Next pane
      const nextIndex = (focusedPaneIndex + 1) % layout.panes.length;
      setFocusedPaneIndex(nextIndex);
      
      // Find the actual pane ID for complex layouts
      const flatPanes = allPaneIds;
      if (flatPanes[nextIndex]) {
        onPaneChange?.(flatPanes[nextIndex]);
      }
    } else if (key.tab && key.shift) {
      // Previous pane
      const prevIndex = (focusedPaneIndex - 1 + layout.panes.length) % layout.panes.length;
      setFocusedPaneIndex(prevIndex);
      
      const flatPanes = allPaneIds;
      if (flatPanes[prevIndex]) {
        onPaneChange?.(flatPanes[prevIndex]);
      }
    } else if (key.ctrl && input === 'r') {
      // Reset pane sizes
      setPaneSizes(Array(layout.panes.length).fill(1 / layout.panes.length));
    } else if (key.ctrl && (key.leftArrow || key.rightArrow) && layout.type === 'horizontal') {
      // Resize horizontal panes
      setPaneSizes(prev => {
        const newSizes = [...prev];
        const increment = 0.05;
        
        if (key.leftArrow && focusedPaneIndex > 0) {
          newSizes[focusedPaneIndex - 1] += increment;
          newSizes[focusedPaneIndex] -= increment;
        } else if (key.rightArrow && focusedPaneIndex < newSizes.length - 1) {
          newSizes[focusedPaneIndex] += increment;
          newSizes[focusedPaneIndex + 1] -= increment;
        }
        
        // Ensure sizes stay positive and sum to 1
        const sum = newSizes.reduce((a, b) => a + b, 0);
        return newSizes.map(size => Math.max(0.1, size / sum));
      });
    } else if (key.ctrl && (key.upArrow || key.downArrow) && layout.type === 'vertical') {
      // Resize vertical panes
      setPaneSizes(prev => {
        const newSizes = [...prev];
        const increment = 0.05;
        
        if (key.upArrow && focusedPaneIndex > 0) {
          newSizes[focusedPaneIndex - 1] += increment;
          newSizes[focusedPaneIndex] -= increment;
        } else if (key.downArrow && focusedPaneIndex < newSizes.length - 1) {
          newSizes[focusedPaneIndex] += increment;
          newSizes[focusedPaneIndex + 1] -= increment;
        }
        
        // Ensure sizes stay positive and sum to 1
        const sum = newSizes.reduce((a, b) => a + b, 0);
        return newSizes.map(size => Math.max(0.1, size / sum));
      });
    }
  }, { isActive });

  const renderPane = (
    pane: Pane | PaneLayout,
    index: number,
    availableWidth: number,
    availableHeight: number
  ): React.ReactElement => {
    const isFocused = index === focusedPaneIndex;
    const size = paneSizes[index];

    if ('id' in pane) {
      // It's a pane
      const paneWidth = layout.type === 'horizontal' 
        ? Math.floor(availableWidth * size)
        : availableWidth;
      const paneHeight = layout.type === 'vertical'
        ? Math.floor(availableHeight * size)
        : availableHeight;

      return (
        <Box
          key={pane.id}
          flexDirection="column"
          width={paneWidth}
          height={paneHeight}
          borderStyle={showBorders ? 'round' : undefined}
          borderColor={isFocused ? 'blue' : 'gray'}
        >
          {/* Pane header */}
          <Box justifyContent="space-between" paddingX={1}>
            <Text bold color={isFocused ? 'blue' : 'white'}>
              {pane.title}
            </Text>
            {isFocused && (
              <Text color="blue">●</Text>
            )}
          </Box>
          
          {/* Pane content */}
          <Box flexGrow={1}>
            {React.cloneElement(pane.component, {
              isActive: activePaneId ? activePaneId === pane.id : isFocused,
              width: paneWidth - (showBorders ? 2 : 0),
              height: paneHeight - (showBorders ? 3 : 1),
            })}
          </Box>
        </Box>
      );
    } else {
      // It's a nested layout
      const nestedWidth = layout.type === 'horizontal'
        ? Math.floor(availableWidth * size)
        : availableWidth;
      const nestedHeight = layout.type === 'vertical'
        ? Math.floor(availableHeight * size)
        : availableHeight;

      return (
        <Box key={`layout-${index}`} width={nestedWidth} height={nestedHeight}>
          <MultiPaneLayout
            layout={pane}
            isActive={isFocused}
            showBorders={showBorders}
            activePaneId={activePaneId}
            onPaneChange={onPaneChange}
          />
        </Box>
      );
    }
  };

  return (
    <Box
      flexDirection={layout.type === 'horizontal' ? 'row' : 'column'}
      width={columns}
      height={rows - 2} // Account for status bar
    >
      {layout.panes.map((pane, index) => 
        renderPane(pane, index, columns, rows - 2)
      )}
      
      {/* Status bar */}
      {isActive && (
        <Box
          position="absolute"
          bottom={0}
          width={columns}
          justifyContent="space-between"
          paddingX={1}
          backgroundColor="gray"
        >
          <Text>
            Pane {focusedPaneIndex + 1}/{layout.panes.length}
          </Text>
          <Text>
            Tab: switch | Ctrl+R: reset sizes | Ctrl+arrows: resize
          </Text>
        </Box>
      )}
    </Box>
  );
}

// Utility functions for creating layouts
export const createHorizontalLayout = (panes: Pane[]): PaneLayout => ({
  type: 'horizontal',
  panes,
});

export const createVerticalLayout = (panes: Pane[]): PaneLayout => ({
  type: 'vertical',
  panes,
});

export const createPane = (
  id: string,
  title: string,
  component: React.ReactElement,
  options?: Partial<Pane>
): Pane => ({
  id,
  title,
  component,
  ...options,
}); 