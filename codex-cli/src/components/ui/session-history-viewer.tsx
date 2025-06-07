import fs from "fs/promises";
import { Box, Text, useInput } from "ink";
import os from "os";
import path from "path";
import React, { useState, useEffect } from "react";

export interface SessionEntry {
  sessionId: string;
  startTime: string;
  endTime?: string;
  model: string;
  provider: string;
  totalCommands: number;
  status: "completed" | "terminated" | "error";
  summary?: string;
}

export interface SessionHistoryViewerProps {
  onSelectSession?: (sessionId: string) => void;
  onExit?: () => void;
}

export default function SessionHistoryViewer({
  onSelectSession,
  onExit,
}: SessionHistoryViewerProps): React.ReactElement {
  const [sessions, setSessions] = useState<Array<SessionEntry>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSessionHistory();
  }, []);

  const loadSessionHistory = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const home = os.homedir();
      const sessionDir = path.join(home, ".codex", "sessions");

      // Check if sessions directory exists
      try {
        await fs.access(sessionDir);
      } catch {
        setSessions([]);
        setIsLoading(false);
        return;
      }

      const files = await fs.readdir(sessionDir);
      const sessionFiles = files.filter((f) => f.endsWith(".json"));

      const sessionEntries: Array<SessionEntry> = [];

      await Promise.all(
        sessionFiles.map(async (file) => {
          try {
            const filePath = path.join(sessionDir, file);
            const content = await fs.readFile(filePath, "utf-8");
            const sessionData = JSON.parse(content);

            if (sessionData.metadata) {
              sessionEntries.push({
                sessionId: sessionData.metadata.sessionId,
                startTime: sessionData.metadata.startTime,
                endTime: sessionData.metadata.endTime,
                model: sessionData.metadata.model,
                provider: sessionData.metadata.provider,
                totalCommands:
                  sessionData.entries?.filter(
                    (e: { type: string }) => e.type === "function_call",
                  ).length || 0,
                status: sessionData.metadata.endTime
                  ? "completed"
                  : "terminated",
                summary: sessionData.metadata.summary,
              });
            }
          } catch {
            // Skip invalid session files
          }
        }),
      );

      // Sort by start time (newest first)
      sessionEntries.sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      );

      setSessions(sessionEntries);
    } catch (err) {
      setError(`Failed to load session history: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (startTime: string, endTime?: string): string => {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const duration = end.getTime() - start.getTime();

    if (duration < 60000) {
      return `${Math.round(duration / 1000)}s`;
    } else if (duration < 3600000) {
      return `${Math.round(duration / 60000)}m`;
    } else {
      const hours = Math.floor(duration / 3600000);
      const minutes = Math.round((duration % 3600000) / 60000);
      return `${hours}h ${minutes}m`;
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) {
      return `Today ${date.toLocaleTimeString()}`;
    } else if (diffDays === 1) {
      return `Yesterday ${date.toLocaleTimeString()}`;
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit?.();
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(sessions.length - 1, prev + 1));
    } else if (key.return || input === " ") {
      if (sessions[selectedIndex]) {
        onSelectSession?.(sessions[selectedIndex].sessionId);
      }
    } else if (input === "r") {
      loadSessionHistory();
    }
  });

  if (isLoading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>🔄 Loading session history...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">❌ {error}</Text>
        <Text dimColor>Press [r] to retry, [q] to exit</Text>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>📭 No session history found</Text>
        <Text dimColor>
          Sessions will appear here after you use the Codex CLI
        </Text>
        <Text dimColor>Press [q] to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="blue"
        padding={1}
      >
        <Text bold color="blue">
          📚 Session History ({sessions.length} sessions)
        </Text>
        <Text dimColor>
          Use ↑/↓ or j/k to navigate, Enter/Space to select, r to refresh, q to
          exit
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {sessions.map((session, index) => {
          const isSelected = index === selectedIndex;
          const statusColor =
            session.status === "completed"
              ? "green"
              : session.status === "error"
                ? "red"
                : "yellow";

          return (
            <Box
              key={session.sessionId}
              flexDirection="column"
              borderStyle={isSelected ? "double" : "round"}
              borderColor={isSelected ? "blue" : "gray"}
              padding={1}
              marginBottom={1}
            >
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold color={isSelected ? "blue" : "white"}>
                  {session.sessionId.slice(-8)}{" "}
                  {/* Show last 8 chars of session ID */}
                </Text>
                <Text color={statusColor}>
                  {session.status === "completed"
                    ? "✅"
                    : session.status === "error"
                      ? "❌"
                      : "⏸️"}
                </Text>
              </Box>

              <Box flexDirection="row" gap={2}>
                <Text dimColor>{formatDate(session.startTime)}</Text>
                <Text dimColor>•</Text>
                <Text dimColor>{session.model}</Text>
                <Text dimColor>•</Text>
                <Text dimColor>{session.provider}</Text>
              </Box>

              <Box flexDirection="row" gap={2}>
                <Text dimColor>
                  Duration: {formatDuration(session.startTime, session.endTime)}
                </Text>
                <Text dimColor>•</Text>
                <Text dimColor>Commands: {session.totalCommands}</Text>
              </Box>

              {session.summary && (
                <Box marginTop={1}>
                  <Text dimColor>📝 {session.summary}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray" padding={1}>
        <Text dimColor>
          {selectedIndex + 1}/{sessions.length} sessions • Press [Enter] to view
          selected session • [r] refresh • [q] exit
        </Text>
      </Box>
    </Box>
  );
}
