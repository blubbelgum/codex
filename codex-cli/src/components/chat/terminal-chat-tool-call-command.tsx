import chalk from "chalk";
import { Text } from "ink";
import React from "react";

export function TerminalChatToolCallCommand({
  commandForDisplay,
  explanation,
}: {
  commandForDisplay: string;
  explanation?: string;
}): React.ReactElement {
  // -------------------------------------------------------------------------
  // Colorize diff output inside the command preview: we detect individual
  // lines that begin with '+' or '-' (excluding the typical diff headers like
  // '+++', '---', '++', '--') and apply green/red coloring.  This mirrors
  // how Git shows diffs and makes the patch easier to review.
  // -------------------------------------------------------------------------

  const colorizedCommand = commandForDisplay
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("++")) {
        return chalk.green(line);
      }
      if (line.startsWith("-") && !line.startsWith("--")) {
        return chalk.red(line);
      }
      return line;
    })
    .join("\n");

  return (
    <>
      <Text bold color="green">
        Shell Command
      </Text>
      <Text>
        <Text dimColor>$</Text> {colorizedCommand}
      </Text>
      {explanation && (
        <>
          <Text bold color="yellow">
            Explanation
          </Text>
          {explanation.split("\n").map((line, i) => {
            // Apply different styling to headings (numbered items)
            if (line.match(/^\d+\.\s+/)) {
              return (
                <Text key={i} bold color="cyan">
                  {line}
                </Text>
              );
            } else if (line.match(/^\s*\*\s+/)) {
              // Style bullet points
              return (
                <Text key={i} color="magenta">
                  {line}
                </Text>
              );
            } else if (line.match(/^(WARNING|CAUTION|NOTE):/i)) {
              // Style warnings
              return (
                <Text key={i} bold color="red">
                  {line}
                </Text>
              );
            } else {
              return <Text key={i}>{line}</Text>;
            }
          })}
        </>
      )}
    </>
  );
}
