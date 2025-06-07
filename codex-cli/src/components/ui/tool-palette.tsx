import type { ToolSuggestion } from "../../utils/agent/tool-discovery.js";

import { AgenticToolDiscovery } from "../../utils/agent/tool-discovery.js";
import { Box, Text, useInput, Spacer } from "ink";
import React, { useState, useEffect, useMemo, useCallback } from "react";

interface ToolPaletteProps {
  onToolSelect: (tool: ToolSuggestion) => void;
  onClose: () => void;
  userQuery?: string;
  isVisible: boolean;
}

interface CategoryGroup {
  category: string;
  tools: Array<ToolSuggestion>;
  color: string;
  icon: string;
}

export default function ToolPalette({
  onToolSelect,
  onClose,
  userQuery,
  isVisible,
}: ToolPaletteProps): React.ReactElement | null {
  const [tools, setTools] = useState<Array<ToolSuggestion>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const discovery = useMemo(() => new AgenticToolDiscovery(), []);

  const loadTools = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const suggestions = await discovery.getToolSuggestions(userQuery);
      setTools(suggestions);
      setSelectedIndex(0);
    } catch (error) {
      // Log error silently for debugging
    } finally {
      setLoading(false);
    }
  }, [discovery, userQuery]);

  useEffect(() => {
    if (isVisible) {
      loadTools();
    }
  }, [isVisible, loadTools]);

  const categories: Array<CategoryGroup> = useMemo(() => {
    const categoryMap = new Map<string, Array<ToolSuggestion>>();

    tools.forEach((tool) => {
      if (!categoryMap.has(tool.category)) {
        categoryMap.set(tool.category, []);
      }
      categoryMap.get(tool.category)!.push(tool);
    });

    const categoryColors: Record<string, { color: string; icon: string }> = {
      development: { color: "blue", icon: "🔧" },
      testing: { color: "green", icon: "🧪" },
      deployment: { color: "yellow", icon: "🚀" },
      analysis: { color: "magenta", icon: "📊" },
      optimization: { color: "cyan", icon: "⚡" },
    };

    return Array.from(categoryMap.entries()).map(
      ([category, categoryTools]) => ({
        category,
        tools: categoryTools,
        color: categoryColors[category]?.color || "white",
        icon: categoryColors[category]?.icon || "🔧",
      }),
    );
  }, [tools]);

  const filteredTools = useMemo(() => {
    let filtered = tools;

    if (selectedCategory !== "all") {
      filtered = filtered.filter((tool) => tool.category === selectedCategory);
    }

    if (searchQuery) {
      filtered = filtered.filter(
        (tool) =>
          tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          tool.description.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    return filtered;
  }, [tools, selectedCategory, searchQuery]);

  useInput((input, key) => {
    if (!isVisible) {
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      if (selectedIndex >= 0 && selectedIndex < filteredTools.length) {
        onToolSelect(filteredTools[selectedIndex]!);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(Math.min(filteredTools.length - 1, selectedIndex + 1));
      return;
    }

    if (key.tab) {
      const currentCategoryIndex = categories.findIndex(
        (cat) => cat.category === selectedCategory,
      );
      const nextIndex = (currentCategoryIndex + 1) % (categories.length + 1);
      setSelectedCategory(
        nextIndex === categories.length
          ? "all"
          : categories[nextIndex]?.category || "all",
      );
      setSelectedIndex(0);
      return;
    }

    // Handle search input
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setSearchQuery((prev) => prev + input);
      setSelectedIndex(0);
    }

    if (key.backspace) {
      setSearchQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
    }
  });

  if (!isVisible) {
    return null;
  }

  const getConfidenceBar = (confidence: number) => {
    const barLength = 10;
    const filled = Math.round(confidence * barLength);
    const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

    let color = "red";
    if (confidence > 0.7) {
      color = "green";
    } else if (confidence > 0.4) {
      color = "yellow";
    }

    return <Text color={color}>{bar}</Text>;
  };

  const renderHeader = () => (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          🔧 Agentic Tool Palette
        </Text>
        <Spacer />
        <Text dimColor>
          ESC: Close • TAB: Switch Category • ↑↓: Navigate • ⏎: Select
        </Text>
      </Box>

      {userQuery && (
        <Box>
          <Text color="yellow">Context: </Text>
          <Text>{userQuery}</Text>
        </Box>
      )}

      <Box>
        <Text>Search: </Text>
        <Text color="cyan">{searchQuery}</Text>
        <Text dimColor>│</Text>
        <Spacer />
        <Text>Category: </Text>
        <Text color="magenta" bold>
          {selectedCategory}
        </Text>
      </Box>
    </Box>
  );

  const renderCategoryTabs = () => (
    <Box marginBottom={1}>
      <Box key="all" marginRight={1}>
        <Text
          color={selectedCategory === "all" ? "cyan" : "gray"}
          bold={selectedCategory === "all"}
        >
          📋 All ({tools.length})
        </Text>
      </Box>
      {categories.map(({ category, tools: categoryTools, icon }) => (
        <Box key={category} marginRight={1}>
          <Text
            color={selectedCategory === category ? "cyan" : "gray"}
            bold={selectedCategory === category}
          >
            {icon} {category} ({categoryTools.length})
          </Text>
        </Box>
      ))}
    </Box>
  );

  const renderToolList = () => {
    if (loading) {
      return (
        <Box>
          <Text color="yellow">
            🔄 Analyzing project and discovering tools...
          </Text>
        </Box>
      );
    }

    if (filteredTools.length === 0) {
      return (
        <Box>
          <Text color="red">No tools found for the current filters.</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        {filteredTools.slice(0, 8).map((tool, index) => (
          <Box key={tool.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text
                color={index === selectedIndex ? "black" : "white"}
                backgroundColor={index === selectedIndex ? "cyan" : undefined}
                bold={index === selectedIndex}
              >
                {index === selectedIndex ? "▶ " : "  "}
                {tool.name}
              </Text>
              <Spacer />
              {getConfidenceBar(tool.confidence)}
              <Text color="gray"> {Math.round(tool.confidence * 100)}%</Text>
            </Box>

            <Box paddingLeft={2}>
              <Text color="gray">{tool.description}</Text>
            </Box>

            <Box paddingLeft={2}>
              <Text color="yellow">Reason: </Text>
              <Text color="gray">{tool.reason}</Text>
            </Box>

            {tool.command && (
              <Box paddingLeft={2}>
                <Text color="green">Command: </Text>
                <Text color="white">{tool.command}</Text>
              </Box>
            )}
          </Box>
        ))}

        {filteredTools.length > 8 && (
          <Box>
            <Text color="gray">
              ... and {filteredTools.length - 8} more tools
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="cyan"
    >
      {renderHeader()}
      {renderCategoryTabs()}
      {renderToolList()}
    </Box>
  );
}
