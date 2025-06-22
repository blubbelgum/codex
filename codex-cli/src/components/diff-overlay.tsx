import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

/**
 * Simple scrollable view for displaying a diff.
 * The component is intentionally lightweight and mirrors the UX of
 * HistoryOverlay: Up/Down or j/k to scroll, PgUp/PgDn for paging and Esc to
 * close. The caller is responsible for computing the diff text.
 */
export default function DiffOverlay({
  diffText,
  onExit,
}: {
  diffText: string;
  onExit: () => void;
}): JSX.Element {
  const lines = React.useMemo(() => 
    diffText.length > 0 ? diffText.split("\n") : ["(no changes)"], 
    [diffText]
  );

  const [cursor, setCursor] = useState(0);
  
  // Calculate diff statistics
  const stats = React.useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let filesChanged = 0;
    const fileNames = new Set<string>();
    
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      } else if (line.startsWith("diff --git")) {
        filesChanged++;
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match && match[2]) {
          fileNames.add(match[2]);
        }
      }
    }
    
    return { additions, deletions, filesChanged, fileNames: Array.from(fileNames) };
  }, [lines]);

  // Determine how many rows we can display – similar to HistoryOverlay.
  const rows = process.stdout.rows || 24;
  const headerRows = 2;
  const footerRows = 1;
  const maxVisible = Math.max(4, rows - headerRows - footerRows);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit();
      return;
    }

    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(lines.length - 1, c + 1));
    } else if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.pageDown) {
      setCursor((c) => Math.min(lines.length - 1, c + maxVisible));
    } else if (key.pageUp) {
      setCursor((c) => Math.max(0, c - maxVisible));
    } else if (input === "g") {
      setCursor(0);
    } else if (input === "G") {
      setCursor(lines.length - 1);
    }
  });

  const firstVisible = Math.min(
    Math.max(0, cursor - Math.floor(maxVisible / 2)),
    Math.max(0, lines.length - maxVisible),
  );
  const visible = lines.slice(firstVisible, firstVisible + maxVisible);

  // Enhanced diff line colorization with better syntax highlighting  
  function renderLine(line: string, idx: number): JSX.Element {
    let color: "green" | "red" | "cyan" | "yellow" | "black" | "white" | "gray" | undefined = undefined;
    let backgroundColor: "green" | "red" | "blue" | undefined = undefined;
    let bold = false;
    let prefix = "";
    let content = line;
    
    if (line.startsWith("+") && !line.startsWith("+++")) {
      color = "black";
      backgroundColor = "green";
      prefix = "+ ";
      content = line.slice(1);
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      color = "white"; 
      backgroundColor = "red";
      prefix = "- ";
      content = line.slice(1);
    } else if (line.startsWith("@@")) {
      color = "cyan";
      bold = true;
      // Parse line numbers from @@ -start,count +start,count @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        content = `Line ${match[2]}: ${line.split('@@')[2] || ''}`.trim();
      }
    } else if (line.startsWith("diff --git") || line.startsWith("index ")) {
      color = "yellow";
      bold = true;
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      color = "cyan";
      if (line.startsWith("+++")) {
        content = `New: ${line.slice(4)}`;
      } else {
        content = `Old: ${line.slice(4)}`;
      }
    } else if (line.startsWith(" ")) {
      color = "gray";
      prefix = "  ";
      content = line.slice(1);
    }
    
    // Highlight current line under cursor
    const isCurrentLine = firstVisible + idx === cursor;
    if (isCurrentLine && !backgroundColor) {
      backgroundColor = "blue";
      color = "white";
    }
    
    return (
      <Text key={idx} color={color} backgroundColor={backgroundColor} bold={bold} wrap="truncate-end">
        {prefix}{content === "" ? " " : content}
      </Text>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      width={Math.min(120, process.stdout.columns || 120)}
    >
      <Box paddingX={1}>
        <Text bold>
          Working tree diff ({lines.length} lines) - 
          <Text color="green"> +{stats.additions}</Text>
          <Text color="red"> -{stats.deletions}</Text>
          {stats.filesChanged > 0 && <Text> {stats.filesChanged} files</Text>}
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        {visible.map((line, idx) => {
          return renderLine(line, firstVisible + idx);
        })}
      </Box>

      <Box paddingX={1}>
        <Text dimColor>esc Close ↑↓ Scroll PgUp/PgDn g/G First/Last</Text>
      </Box>
    </Box>
  );
}
