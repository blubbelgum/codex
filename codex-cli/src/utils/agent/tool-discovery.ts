import { log } from "../logger/log.js";
import fs from "fs";
import { spawnSync } from "node:child_process";
import path from "path";
import { smartWebSearch, formatSearchResults } from "./web-search.js";

export interface ToolSuggestion {
  id: string;
  name: string;
  description: string;
  category:
    | "development"
    | "testing"
    | "deployment"
    | "analysis"
    | "optimization";
  confidence: number; // 0-1
  reason: string;
  command?: string;
  files?: Array<string>;
  dependencies?: Array<string>;
}

export interface ProjectContext {
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  hasDockerfile: boolean;
  hasTests: boolean;
  hasGit: boolean;
  frameworks: Array<string>;
  languages: Array<string>;
  buildTools: Array<string>;
  outdatedDeps: Array<string>;
  securityIssues: Array<string>;
  performanceIssues: Array<string>;
}

const toolCategories = {
  development: {
    "web-search-docs": {
      name: "Search Documentation Online",
      description: "Find official documentation and guides for technologies",
      reason: "Get up-to-date documentation that might not be in the AI's training data",
      confidence: 0.85,
      command: "search-docs",
      category: "development" as const,
    },
    "web-search-code": {
      name: "Search Code Examples",
      description: "Find code examples and tutorials from GitHub, Stack Overflow",
      reason: "Discover real-world implementations and solutions",
      confidence: 0.82,
      command: "search-code",
      category: "development" as const,
    },
    "web-search-troubleshoot": {
      name: "Search Error Solutions",
      description: "Find solutions for specific errors and issues",
      reason: "Get community solutions for debugging problems",
      confidence: 0.88,
      command: "search-error",
      category: "development" as const,
    },
  },
  analysis: {
    "web-search-research": {
      name: "Research Technology Trends",
      description: "Find recent articles, research, and industry trends",
      reason: "Stay current with latest developments and best practices",
      confidence: 0.75,
      command: "search-research",
      category: "analysis" as const,
    },
    "web-search-news": {
      name: "Technology News Search",
      description: "Find recent news, updates, and releases",
      reason: "Get the latest information about technologies and tools",
      confidence: 0.78,
      command: "search-news",
      category: "analysis" as const,
    },
  },
};

export class AgenticToolDiscovery {
  private projectRoot: string;
  private context: ProjectContext | null = null;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Analyze the current project and discover available tools
   */
  async analyzeProject(): Promise<ProjectContext> {
    const context: ProjectContext = {
      hasPackageJson: fs.existsSync(
        path.join(this.projectRoot, "package.json"),
      ),
      hasTsConfig: fs.existsSync(path.join(this.projectRoot, "tsconfig.json")),
      hasDockerfile: fs.existsSync(path.join(this.projectRoot, "Dockerfile")),
      hasTests: this.detectTests(),
      hasGit: fs.existsSync(path.join(this.projectRoot, ".git")),
      frameworks: await this.detectFrameworks(),
      languages: this.detectLanguages(),
      buildTools: this.detectBuildTools(),
      outdatedDeps: await this.checkOutdatedDependencies(),
      securityIssues: await this.checkSecurityIssues(),
      performanceIssues: await this.analyzePerformance(),
    };

    this.context = context;
    return context;
  }

  /**
   * Get intelligent tool suggestions based on project context
   */
  async getToolSuggestions(userQuery?: string): Promise<Array<ToolSuggestion>> {
    if (!this.context) {
      await this.analyzeProject();
    }

    const suggestions: Array<ToolSuggestion> = [];
    const context = this.context!;

    // Development suggestions
    if (context.hasPackageJson) {
      suggestions.push({
        id: "npm-audit",
        name: "Security Audit",
        description: "Check for security vulnerabilities in dependencies",
        category: "analysis",
        confidence: 0.9,
        reason: "Package.json detected - security checks recommended",
        command: "npm audit",
      });
    }

    if (context.hasTsConfig) {
      suggestions.push({
        id: "tsc-check",
        name: "TypeScript Compilation Check",
        description: "Verify TypeScript compilation without emitting files",
        category: "development",
        confidence: 0.95,
        reason: "TypeScript project detected",
        command: "npx tsc --noEmit",
      });
    }

    // Testing suggestions
    if (context.hasTests) {
      suggestions.push({
        id: "test-coverage",
        name: "Test Coverage Analysis",
        description: "Generate comprehensive test coverage report",
        category: "testing",
        confidence: 0.8,
        reason: "Test files detected",
        command: "npm run test:coverage",
      });
    } else if (context.hasPackageJson) {
      suggestions.push({
        id: "setup-testing",
        name: "Setup Testing Framework",
        description: "Initialize a modern testing setup with Vitest or Jest",
        category: "development",
        confidence: 0.7,
        reason: "No tests detected - consider adding test coverage",
        command: "npm install --save-dev vitest @vitest/ui",
      });
    }

    // Framework-specific suggestions
    if (context.frameworks.includes("react")) {
      suggestions.push({
        id: "react-devtools",
        name: "React Component Analysis",
        description:
          "Analyze React components for best practices and performance",
        category: "analysis",
        confidence: 0.85,
        reason: "React framework detected",
      });
    }

    if (context.frameworks.includes("next")) {
      suggestions.push({
        id: "next-bundle-analyzer",
        name: "Next.js Bundle Analysis",
        description: "Analyze bundle size and optimize performance",
        category: "optimization",
        confidence: 0.9,
        reason: "Next.js framework detected",
        command: "npx @next/bundle-analyzer",
      });
    }

    // Git suggestions
    if (context.hasGit) {
      suggestions.push({
        id: "git-health",
        name: "Git Repository Health Check",
        description:
          "Analyze commit history, branch status, and repository health",
        category: "analysis",
        confidence: 0.75,
        reason: "Git repository detected",
      });
    }

    // Context-aware suggestions based on user query
    if (userQuery) {
      const queryBasedSuggestions = this.getQueryBasedSuggestions(
        userQuery,
        context,
      );
      suggestions.push(...queryBasedSuggestions);
    }

    // Performance suggestions
    if (context.performanceIssues.length > 0) {
      suggestions.push({
        id: "performance-optimization",
        name: "Performance Optimization",
        description: `Address ${context.performanceIssues.length} performance issues detected`,
        category: "optimization",
        confidence: 0.8,
        reason: "Performance issues detected in project analysis",
      });
    }

    // Add web search suggestions
    const webSearchSuggestions = this.getWebSearchSuggestions(userQuery || "");
    suggestions.push(...webSearchSuggestions);

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  private detectTests(): boolean {
    const testPatterns = [
      "**/*.test.{js,ts,jsx,tsx}",
      "**/*.spec.{js,ts,jsx,tsx}",
      "tests/**/*",
      "__tests__/**/*",
    ];

    for (const pattern of testPatterns) {
      const result = spawnSync(
        "find",
        [this.projectRoot, "-name", pattern.replace("**/", "")],
        {
          stdio: "pipe",
        },
      );
      if (result.stdout?.toString().trim()) {
        return true;
      }
    }
    return false;
  }

  private async detectFrameworks(): Promise<Array<string>> {
    const frameworks: Array<string> = [];

    try {
      if (fs.existsSync(path.join(this.projectRoot, "package.json"))) {
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(this.projectRoot, "package.json"), "utf-8"),
        );

        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        if (deps.react) {
          frameworks.push("react");
        }
        if (deps.vue) {
          frameworks.push("vue");
        }
        if (deps.angular) {
          frameworks.push("angular");
        }
        if (deps.next) {
          frameworks.push("next");
        }
        if (deps.nuxt) {
          frameworks.push("nuxt");
        }
        if (deps.svelte) {
          frameworks.push("svelte");
        }
        if (deps.express) {
          frameworks.push("express");
        }
        if (deps.fastify) {
          frameworks.push("fastify");
        }
      }
    } catch (error) {
      log(`Error detecting frameworks: ${error}`);
    }

    return frameworks;
  }

  private detectLanguages(): Array<string> {
    const languages: Array<string> = [];

    if (fs.existsSync(path.join(this.projectRoot, "tsconfig.json"))) {
      languages.push("typescript");
    }

    const result = spawnSync("find", [this.projectRoot, "-name", "*.js"], {
      stdio: "pipe",
    });
    if (result.stdout?.toString().trim()) {
      languages.push("javascript");
    }

    if (fs.existsSync(path.join(this.projectRoot, "Cargo.toml"))) {
      languages.push("rust");
    }

    if (fs.existsSync(path.join(this.projectRoot, "go.mod"))) {
      languages.push("go");
    }

    return languages;
  }

  private detectBuildTools(): Array<string> {
    const buildTools: Array<string> = [];

    if (fs.existsSync(path.join(this.projectRoot, "webpack.config.js"))) {
      buildTools.push("webpack");
    }

    if (fs.existsSync(path.join(this.projectRoot, "vite.config.js"))) {
      buildTools.push("vite");
    }

    if (fs.existsSync(path.join(this.projectRoot, "rollup.config.js"))) {
      buildTools.push("rollup");
    }

    return buildTools;
  }

  private async checkOutdatedDependencies(): Promise<Array<string>> {
    try {
      const result = spawnSync("npm", ["outdated", "--json"], {
        stdio: "pipe",
        cwd: this.projectRoot,
      });

      if (result.stdout) {
        const outdated = JSON.parse(result.stdout.toString());
        return Object.keys(outdated);
      }
    } catch (error) {
      log(`Error checking outdated dependencies: ${error}`);
    }

    return [];
  }

  private async checkSecurityIssues(): Promise<Array<string>> {
    try {
      const result = spawnSync("npm", ["audit", "--json"], {
        stdio: "pipe",
        cwd: this.projectRoot,
      });

      if (result.stdout) {
        const audit = JSON.parse(result.stdout.toString());
        return audit.vulnerabilities ? Object.keys(audit.vulnerabilities) : [];
      }
    } catch (error) {
      log(`Error checking security issues: ${error}`);
    }

    return [];
  }

  private async analyzePerformance(): Promise<Array<string>> {
    const issues: Array<string> = [];

    // Check for large node_modules
    try {
      const result = spawnSync(
        "du",
        ["-sh", path.join(this.projectRoot, "node_modules")],
        {
          stdio: "pipe",
        },
      );

      if (result.stdout) {
        const size = result.stdout.toString().split("\t")[0];
        if (
          size &&
          (size.includes("G") || (size.includes("M") && parseInt(size) > 500))
        ) {
          issues.push("large-node-modules");
        }
      }
    } catch (error) {
      // Ignore errors for performance analysis
    }

    return issues;
  }

  private getQueryBasedSuggestions(
    query: string,
    _context: ProjectContext,
  ): Array<ToolSuggestion> {
    const suggestions: Array<ToolSuggestion> = [];
    const lowerQuery = query.toLowerCase();

    // Test-related queries
    if (lowerQuery.includes("test") || lowerQuery.includes("spec")) {
      suggestions.push({
        id: "test-runner",
        name: "Run Tests",
        description: "Execute the test suite with detailed output",
        category: "testing",
        confidence: 0.95,
        reason: "User query mentions testing",
        command: "npm test",
      });
    }

    // Build-related queries
    if (lowerQuery.includes("build") || lowerQuery.includes("compile")) {
      suggestions.push({
        id: "build-project",
        name: "Build Project",
        description: "Build the project for production",
        category: "development",
        confidence: 0.9,
        reason: "User query mentions building",
        command: "npm run build",
      });
    }

    // Security-related queries
    if (
      lowerQuery.includes("security") ||
      lowerQuery.includes("vulnerability")
    ) {
      suggestions.push({
        id: "security-scan",
        name: "Comprehensive Security Scan",
        description: "Run multiple security checks including audit and SAST",
        category: "analysis",
        confidence: 0.95,
        reason: "User query mentions security",
      });
    }

    return suggestions;
  }

  private getWebSearchSuggestions(query: string): Array<ToolSuggestion> {
    const suggestions: Array<ToolSuggestion> = [];
    const lowerQuery = query.toLowerCase();

    // Documentation search triggers
    if (this.matchesPatterns(lowerQuery, [
      /how to use/,
      /documentation for/,
      /guide for/,
      /api reference/,
      /docs for/,
      /manual for/,
    ])) {
      suggestions.push({
        id: "web-search-docs",
        ...toolCategories.development["web-search-docs"],
        command: `search-docs "${query}"`,
        confidence: 0.88,
      });
    }

    // Code examples search triggers
    if (this.matchesPatterns(lowerQuery, [
      /example/,
      /sample code/,
      /tutorial/,
      /how to implement/,
      /show me code/,
      /code for/,
    ])) {
      suggestions.push({
        id: "web-search-code",
        ...toolCategories.development["web-search-code"],
        command: `search-code "${query}"`,
        confidence: 0.85,
      });
    }

    // Error/troubleshooting search triggers
    if (this.matchesPatterns(lowerQuery, [
      /error/,
      /fix/,
      /broken/,
      /not working/,
      /issue with/,
      /problem/,
      /debug/,
      /troubleshoot/,
    ])) {
      suggestions.push({
        id: "web-search-troubleshoot",
        ...toolCategories.development["web-search-troubleshoot"],
        command: `search-error "${query}"`,
        confidence: 0.90,
      });
    }

    // Research search triggers
    if (this.matchesPatterns(lowerQuery, [
      /latest/,
      /new features/,
      /comparison/,
      /best practices/,
      /trends/,
      /analysis/,
      /research/,
    ])) {
      suggestions.push({
        id: "web-search-research",
        ...toolCategories.analysis["web-search-research"],
        command: `search-research "${query}"`,
        confidence: 0.75,
      });
    }

    // News search triggers
    if (this.matchesPatterns(lowerQuery, [
      /news/,
      /updates/,
      /release/,
      /announcement/,
      /what's new/,
      /recent changes/,
    ])) {
      suggestions.push({
        id: "web-search-news",
        ...toolCategories.analysis["web-search-news"],
        command: `search-news "${query}"`,
        confidence: 0.80,
      });
    }

    return suggestions;
  }

  private matchesPatterns(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
  }
}
