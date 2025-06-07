// Code intelligence analysis utilities
import fs from "fs";
import { spawnSync } from "node:child_process";
import path from "path";

export interface CodeAnalysisResult {
  file: string;
  issues: Array<CodeIssue>;
  suggestions: Array<CodeSuggestion>;
  metrics: CodeMetrics;
  dependencies: Array<string>;
  exports: Array<string>;
  imports: Array<string>;
}

export interface CodeIssue {
  type: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
  rule?: string;
  severity: "low" | "medium" | "high";
  fixable: boolean;
}

export interface CodeSuggestion {
  type: "refactor" | "optimization" | "best-practice" | "security";
  title: string;
  description: string;
  confidence: number;
  impact: "low" | "medium" | "high";
  effort: "low" | "medium" | "high";
  code?: string;
}

export interface CodeMetrics {
  linesOfCode: number;
  complexity: number;
  maintainabilityIndex: number;
  testCoverage?: number;
  duplicateCodePercentage: number;
}

export interface ProjectInsights {
  architecture: Array<string>;
  patterns: Array<string>;
  antiPatterns: Array<string>;
  techDebt: Array<TechDebtItem>;
  qualityScore: number;
  recommendations: Array<string>;
}

export interface TechDebtItem {
  type: string;
  description: string;
  location: string;
  effort: "low" | "medium" | "high";
  priority: "low" | "medium" | "high";
}

export class CodeIntelligenceEngine {
  private projectRoot: string;
  private cache: Map<string, CodeAnalysisResult> = new Map();

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Analyze a specific file for issues, suggestions, and metrics
   */
  async analyzeFile(filePath: string): Promise<CodeAnalysisResult> {
    const absolutePath = path.resolve(this.projectRoot, filePath);

    // Check cache first
    const cacheKey = `${absolutePath}-${fs.statSync(absolutePath).mtime.getTime()}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const result: CodeAnalysisResult = {
      file: filePath,
      issues: await this.detectIssues(absolutePath),
      suggestions: await this.generateSuggestions(absolutePath),
      metrics: await this.calculateMetrics(absolutePath),
      dependencies: this.extractDependencies(absolutePath),
      exports: this.extractExports(absolutePath),
      imports: this.extractImports(absolutePath),
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Analyze the entire project for architectural insights
   */
  async analyzeProject(): Promise<ProjectInsights> {
    const insights: ProjectInsights = {
      architecture: await this.detectArchitecture(),
      patterns: await this.detectPatterns(),
      antiPatterns: await this.detectAntiPatterns(),
      techDebt: await this.analyzeTechDebt(),
      qualityScore: 0,
      recommendations: [],
    };

    insights.qualityScore = this.calculateQualityScore(insights);
    insights.recommendations = this.generateRecommendations(insights);

    return insights;
  }

  /**
   * Get intelligent suggestions based on current context
   */
  async getContextualSuggestions(
    filePath?: string,
    userQuery?: string,
    codeSelection?: string,
  ): Promise<Array<CodeSuggestion>> {
    const suggestions: Array<CodeSuggestion> = [];

    // File-specific suggestions
    if (filePath) {
      const analysis = await this.analyzeFile(filePath);
      suggestions.push(...analysis.suggestions);
    }

    // Query-based suggestions
    if (userQuery) {
      suggestions.push(...this.getQueryBasedSuggestions(userQuery));
    }

    // Code selection suggestions
    if (codeSelection) {
      suggestions.push(...this.analyzeCodeSnippet(codeSelection));
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  private async detectIssues(filePath: string): Promise<Array<CodeIssue>> {
    const issues: Array<CodeIssue> = [];
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath);

    // TypeScript/JavaScript specific checks
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      // Check for common issues
      if (content.includes("any")) {
        issues.push({
          type: "warning",
          message: "Usage of 'any' type reduces type safety",
          rule: "no-any",
          severity: "medium",
          fixable: true,
        });
      }

      if (content.includes("console.log")) {
        issues.push({
          type: "info",
          message: "Console statements should be removed in production",
          rule: "no-console",
          severity: "low",
          fixable: true,
        });
      }

      if (content.includes("// TODO") || content.includes("// FIXME")) {
        issues.push({
          type: "info",
          message: "TODO/FIXME comments indicate incomplete work",
          rule: "no-todo",
          severity: "low",
          fixable: false,
        });
      }

      // Check for unused imports (simplified)
      const importMatches =
        content.match(/import\s+.*\s+from\s+['"][^'"]+['"]/g) || [];
      for (const importLine of importMatches) {
        const imported = importLine.match(/import\s+(?:{[^}]+}|\w+)/)?.[0];
        if (
          imported &&
          !content.includes(imported.replace("import ", "").trim())
        ) {
          issues.push({
            type: "warning",
            message: "Potentially unused import",
            rule: "unused-import",
            severity: "low",
            fixable: true,
          });
        }
      }
    }

    // Run ESLint if available
    try {
      const eslintResult = spawnSync(
        "npx",
        ["eslint", "--format", "json", filePath],
        {
          stdio: "pipe",
          cwd: this.projectRoot,
        },
      );

      if (eslintResult.stdout) {
        const eslintOutput = JSON.parse(eslintResult.stdout.toString());
        if (eslintOutput[0]?.messages) {
          for (const message of eslintOutput[0].messages) {
            issues.push({
              type: message.severity === 2 ? "error" : "warning",
              message: message.message,
              line: message.line,
              column: message.column,
              rule: message.ruleId,
              severity: message.severity === 2 ? "high" : "medium",
              fixable: Boolean(message.fix),
            });
          }
        }
      }
    } catch (error) {
      // ESLint not available or failed
    }

    return issues;
  }

  private async generateSuggestions(
    filePath: string,
  ): Promise<Array<CodeSuggestion>> {
    const suggestions: Array<CodeSuggestion> = [];
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath);

    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      // Performance suggestions
      if (content.includes("useState") && content.includes("useEffect")) {
        suggestions.push({
          type: "optimization",
          title: "Consider using useMemo/useCallback",
          description: "Optimize React hooks for better performance",
          confidence: 0.7,
          impact: "medium",
          effort: "low",
        });
      }

      // Security suggestions
      if (content.includes("dangerouslySetInnerHTML")) {
        suggestions.push({
          type: "security",
          title: "Review XSS vulnerability",
          description: "dangerouslySetInnerHTML can lead to XSS attacks",
          confidence: 0.9,
          impact: "high",
          effort: "medium",
        });
      }

      // Best practice suggestions
      if (content.includes("function") && content.length > 1000) {
        suggestions.push({
          type: "refactor",
          title: "Consider breaking down large functions",
          description: "Large functions are harder to maintain and test",
          confidence: 0.8,
          impact: "medium",
          effort: "medium",
        });
      }

      // Modern JavaScript suggestions
      if (content.includes("var ")) {
        suggestions.push({
          type: "best-practice",
          title: "Use const/let instead of var",
          description: "Modern variable declarations provide better scoping",
          confidence: 0.95,
          impact: "low",
          effort: "low",
          code: content.replace(/var (\w+)/g, "const $1"),
        });
      }
    }

    return suggestions;
  }

  private async calculateMetrics(filePath: string): Promise<CodeMetrics> {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    return {
      linesOfCode: lines.filter(
        (line) => line.trim() && !line.trim().startsWith("//"),
      ).length,
      complexity: this.calculateComplexity(content),
      maintainabilityIndex: this.calculateMaintainabilityIndex(content),
      duplicateCodePercentage: 0, // Would need more sophisticated analysis
    };
  }

  private calculateComplexity(content: string): number {
    // Simplified cyclomatic complexity calculation
    const complexityKeywords = [
      "if",
      "else",
      "for",
      "while",
      "do",
      "switch",
      "case",
      "catch",
      "&&",
      "||",
      "?",
    ];

    let complexity = 1; // Base complexity
    for (const keyword of complexityKeywords) {
      const matches = content.match(new RegExp(`\\b${keyword}\\b`, "g"));
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private calculateMaintainabilityIndex(content: string): number {
    // Simplified maintainability index (0-100, higher is better)
    const linesOfCode = content.split("\n").length;
    const complexity = this.calculateComplexity(content);

    // Simple heuristic
    let index = 100;
    index -= Math.min(linesOfCode / 10, 30); // Penalize long files
    index -= Math.min(complexity * 2, 40); // Penalize complex code

    return Math.max(0, Math.round(index));
  }

  private extractDependencies(filePath: string): Array<string> {
    const content = fs.readFileSync(filePath, "utf-8");
    const dependencies: Array<string> = [];

    // Extract import statements
    const importMatches =
      content.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g) || [];
    for (const match of importMatches) {
      const dep = match.match(/from\s+['"]([^'"]+)['"]/)?.[1];
      if (dep) {
        dependencies.push(dep);
      }
    }

    // Extract require statements
    const requireMatches =
      content.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];
    for (const match of requireMatches) {
      const dep = match.match(/['"]([^'"]+)['"]/)?.[1];
      if (dep) {
        dependencies.push(dep);
      }
    }

    return Array.from(new Set(dependencies));
  }

  private extractExports(filePath: string): Array<string> {
    const content = fs.readFileSync(filePath, "utf-8");
    const exports: Array<string> = [];

    // Extract named exports
    const exportMatches =
      content.match(/export\s+(?:const|let|var|function|class)\s+(\w+)/g) || [];
    for (const match of exportMatches) {
      const exp = match.match(
        /export\s+(?:const|let|var|function|class)\s+(\w+)/,
      )?.[1];
      if (exp) {
        exports.push(exp);
      }
    }

    // Extract default exports
    if (content.includes("export default")) {
      exports.push("default");
    }

    return exports;
  }

  private extractImports(filePath: string): Array<string> {
    const content = fs.readFileSync(filePath, "utf-8");
    const imports: Array<string> = [];

    // Extract imported names
    const importMatches = content.match(/import\s+(?:{([^}]+)}|(\w+))/g) || [];
    for (const match of importMatches) {
      if (match.includes("{")) {
        const namedImports = match.match(/{([^}]+)}/)?.[1];
        if (namedImports) {
          imports.push(...namedImports.split(",").map((imp) => imp.trim()));
        }
      } else {
        const defaultImport = match.match(/import\s+(\w+)/)?.[1];
        if (defaultImport) {
          imports.push(defaultImport);
        }
      }
    }

    return imports;
  }

  private async detectArchitecture(): Promise<Array<string>> {
    const architecture: Array<string> = [];

    // Check for common architectural patterns
    if (fs.existsSync(path.join(this.projectRoot, "src/components"))) {
      architecture.push("Component-based");
    }

    if (
      fs.existsSync(path.join(this.projectRoot, "src/store")) ||
      fs.existsSync(path.join(this.projectRoot, "src/redux"))
    ) {
      architecture.push("State management");
    }

    if (fs.existsSync(path.join(this.projectRoot, "src/services"))) {
      architecture.push("Service layer");
    }

    if (fs.existsSync(path.join(this.projectRoot, "src/utils"))) {
      architecture.push("Utility-based");
    }

    return architecture;
  }

  private async detectPatterns(): Promise<Array<string>> {
    const patterns: Array<string> = [];

    // Scan for common design patterns
    const files = this.getAllSourceFiles();

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");

      if (content.includes("createContext") && content.includes("useContext")) {
        patterns.push("Context Pattern");
      }

      if (content.includes("interface") && content.includes("implements")) {
        patterns.push("Interface Pattern");
      }

      if (content.includes("class") && content.includes("extends")) {
        patterns.push("Inheritance Pattern");
      }
    }

    return Array.from(new Set(patterns));
  }

  private async detectAntiPatterns(): Promise<Array<string>> {
    const antiPatterns: Array<string> = [];

    const files = this.getAllSourceFiles();

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");

      if (content.includes("any") && content.length > 500) {
        antiPatterns.push("Excessive use of 'any' type");
      }

      if (content.split("\n").length > 500) {
        antiPatterns.push("Large files");
      }

      if ((content.match(/function/g) || []).length > 20) {
        antiPatterns.push("Too many functions in single file");
      }
    }

    return Array.from(new Set(antiPatterns));
  }

  private async analyzeTechDebt(): Promise<Array<TechDebtItem>> {
    const techDebt: Array<TechDebtItem> = [];

    const files = this.getAllSourceFiles();

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");

      // TODO comments
      const todoMatches = content.match(/\/\/\s*TODO:?.*/g) || [];
      for (const todo of todoMatches) {
        techDebt.push({
          type: "TODO",
          description: todo.trim(),
          location: file,
          effort: "low",
          priority: "medium",
        });
      }

      // FIXME comments
      const fixmeMatches = content.match(/\/\/\s*FIXME:?.*/g) || [];
      for (const fixme of fixmeMatches) {
        techDebt.push({
          type: "FIXME",
          description: fixme.trim(),
          location: file,
          effort: "medium",
          priority: "high",
        });
      }
    }

    return techDebt;
  }

  private calculateQualityScore(insights: ProjectInsights): number {
    let score = 100;

    // Deduct points for anti-patterns
    score -= insights.antiPatterns.length * 10;

    // Deduct points for tech debt
    score -= insights.techDebt.length * 5;

    // Add points for good patterns
    score += insights.patterns.length * 5;

    return Math.max(0, Math.min(100, score));
  }

  private generateRecommendations(insights: ProjectInsights): Array<string> {
    const recommendations: Array<string> = [];

    if (insights.techDebt.length > 10) {
      recommendations.push(
        "Address technical debt - consider dedicating time to resolve TODO/FIXME items",
      );
    }

    if (insights.antiPatterns.includes("Large files")) {
      recommendations.push(
        "Break down large files into smaller, more focused modules",
      );
    }

    if (insights.antiPatterns.includes("Excessive use of 'any' type")) {
      recommendations.push(
        "Improve type safety by replacing 'any' with specific types",
      );
    }

    if (insights.qualityScore < 70) {
      recommendations.push(
        "Consider code refactoring to improve overall quality",
      );
    }

    return recommendations;
  }

  private getAllSourceFiles(): Array<string> {
    const files: Array<string> = [];
    const extensions = [".ts", ".tsx", ".js", ".jsx"];

    const scan = (dir: string) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);

          if (
            stat.isDirectory() &&
            !item.startsWith(".") &&
            item !== "node_modules"
          ) {
            scan(fullPath);
          } else if (stat.isFile() && extensions.includes(path.extname(item))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore errors
      }
    };

    scan(this.projectRoot);
    return files;
  }

  private getQueryBasedSuggestions(query: string): Array<CodeSuggestion> {
    const suggestions: Array<CodeSuggestion> = [];
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes("performance") || lowerQuery.includes("optimize")) {
      suggestions.push({
        type: "optimization",
        title: "Performance Analysis",
        description: "Run performance profiling and optimization checks",
        confidence: 0.9,
        impact: "high",
        effort: "medium",
      });
    }

    if (lowerQuery.includes("refactor") || lowerQuery.includes("clean")) {
      suggestions.push({
        type: "refactor",
        title: "Code Refactoring",
        description:
          "Identify refactoring opportunities for better code quality",
        confidence: 0.85,
        impact: "high",
        effort: "high",
      });
    }

    return suggestions;
  }

  private analyzeCodeSnippet(code: string): Array<CodeSuggestion> {
    const suggestions: Array<CodeSuggestion> = [];

    if (code.includes("any")) {
      suggestions.push({
        type: "best-practice",
        title: "Replace any with specific types",
        description: "Improve type safety by using specific TypeScript types",
        confidence: 0.9,
        impact: "medium",
        effort: "low",
      });
    }

    if (code.includes("var ")) {
      suggestions.push({
        type: "best-practice",
        title: "Use const/let instead of var",
        description: "Modern variable declarations provide better scoping",
        confidence: 0.95,
        impact: "low",
        effort: "low",
      });
    }

    return suggestions;
  }
}
