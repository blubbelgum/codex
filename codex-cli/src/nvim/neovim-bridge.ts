import { NeovimLSPManager } from './lsp-manager.js';
import { CodeIntelligenceEngine } from '../utils/agent/code-intelligence.js';
import { EventEmitter } from 'events';

export interface NeovimCapabilities {
  lsp: boolean;
  completion: boolean;
  diagnostics: boolean;
  formatting: boolean;
  refactoring: boolean;
  navigation: boolean;
}

export interface EditContext {
  file: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  cursor?: { line: number; character: number };
  selection?: string;
  language?: string;
}

export interface SmartEditRequest {
  type: 'completion' | 'refactor' | 'format' | 'fix' | 'enhance';
  context: EditContext;
  instruction?: string;
  options?: any;
}

export interface SmartEditResult {
  success: boolean;
  changes?: Array<{
    file: string;
    edits: Array<{
      range: any;
      newText: string;
    }>;
  }>;
  diagnostics?: Array<any>;
  suggestions?: Array<any>;
  error?: string;
}

/**
 * Bridge between Codex CLI and Neovim with LSP capabilities
 */
export class NeovimBridge extends EventEmitter {
  private lspManager: NeovimLSPManager;
  private codeIntelligence: CodeIntelligenceEngine;
  private capabilities: NeovimCapabilities;
  private isInitialized = false;
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.lspManager = new NeovimLSPManager(workspaceRoot);
    this.codeIntelligence = new CodeIntelligenceEngine(workspaceRoot);
    
    this.capabilities = {
      lsp: false,
      completion: false,
      diagnostics: false,
      formatting: false,
      refactoring: false,
      navigation: false,
    };
  }

  /**
   * Initialize the Neovim bridge
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing Neovim LSP Bridge...');
    
    try {
      // Initialize LSP manager
      await this.lspManager.initialize();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Detect capabilities
      await this.detectCapabilities();
      
      this.isInitialized = true;
      console.log('✅ Neovim LSP Bridge initialized successfully');
      this.emit('initialized', this.capabilities);
      
    } catch (error) {
      console.error('❌ Failed to initialize Neovim bridge:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.lspManager.on('lsp-event', (event) => {
      this.handleLSPEvent(event);
    });

    this.lspManager.on('error', (error) => {
      this.emit('error', error);
    });

    this.lspManager.on('file-opened', (filePath) => {
      this.emit('file-opened', filePath);
    });
  }

  /**
   * Handle LSP events from Neovim
   */
  private handleLSPEvent(event: any): void {
    switch (event.type) {
      case 'codex_lsp_hover':
        this.emit('hover', event.data);
        break;
      case 'codex_lsp_diagnostics':
        this.emit('diagnostics', event.data);
        break;
      case 'codex_lsp_completion':
        this.emit('completion', event.data);
        break;
      default:
        this.emit('lsp-event', event);
    }
  }

  /**
   * Detect available capabilities
   */
  private async detectCapabilities(): Promise<void> {
    // Check if LSP servers are available
    this.capabilities.lsp = this.lspManager.getAvailableServers().length > 0;
    this.capabilities.completion = this.capabilities.lsp;
    this.capabilities.diagnostics = this.capabilities.lsp;
    this.capabilities.formatting = this.capabilities.lsp;
    this.capabilities.refactoring = this.capabilities.lsp;
    this.capabilities.navigation = this.capabilities.lsp;
  }

  /**
   * Enhanced read operation with LSP context
   */
  async enhancedRead(filePath: string, options?: {
    includeContext?: boolean;
    includeSymbols?: boolean;
    includeDiagnostics?: boolean;
  }): Promise<{
    content: string;
    context?: any;
    symbols?: Array<any>;
    diagnostics?: Array<any>;
    metadata: any;
  }> {
    // Open file in Neovim to activate LSP
    await this.lspManager.openFile(filePath);
    
    // Read file content (using existing read functionality)
    const fs = await import('fs');
    const content = await fs.promises.readFile(filePath, 'utf-8');
    
    const result: any = {
      content,
      metadata: {
        language: this.detectLanguage(filePath),
        lines: content.split('\n').length,
        size: content.length
      }
    };

    if (options?.includeContext && this.capabilities.lsp) {
      // Get additional context from LSP
      result.context = await this.getLSPContext(filePath);
    }

    if (options?.includeSymbols && this.capabilities.lsp) {
      // Get symbols from LSP
      result.symbols = await this.getDocumentSymbols(filePath);
    }

    if (options?.includeDiagnostics && this.capabilities.diagnostics) {
      // Get diagnostics from LSP
      result.diagnostics = await this.lspManager.getDiagnostics(filePath);
    }

    return result;
  }

  /**
   * Smart edit operation leveraging LSP and AI
   */
  async smartEdit(request: SmartEditRequest): Promise<SmartEditResult> {
    if (!this.isInitialized) {
      throw new Error('Neovim bridge not initialized');
    }

    try {
      const { type, context, instruction, options } = request;
      
      // Open file to activate LSP
      await this.lspManager.openFile(context.file);

      switch (type) {
        case 'completion':
          return await this.handleCompletion(context, options);
        case 'refactor':
          return await this.handleRefactor(context, instruction, options);
        case 'format':
          return await this.handleFormat(context);
        case 'fix':
          return await this.handleFix(context, instruction);
        case 'enhance':
          return await this.handleEnhance(context, instruction);
        default:
          throw new Error(`Unknown edit type: ${type}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle completion requests
   */
  private async handleCompletion(context: EditContext, options?: any): Promise<SmartEditResult> {
    if (!context.cursor) {
      throw new Error('Cursor position required for completion');
    }

    const completions = await this.lspManager.getCompletions(
      context.file,
      context.cursor.line,
      context.cursor.character
    );

    return {
      success: true,
      suggestions: completions
    };
  }

  /**
   * Handle refactoring requests
   */
  private async handleRefactor(context: EditContext, instruction?: string, options?: any): Promise<SmartEditResult> {
    // Use AI + LSP for intelligent refactoring
    const analysis = await this.codeIntelligence.analyzeFile(context.file);
    
    // Get LSP context for better understanding
    const lspContext = await this.getLSPContext(context.file);
    
    // AI-driven refactoring plan (this would integrate with your AI system)
    const refactorPlan = await this.generateRefactorPlan(context, instruction, analysis, lspContext);
    
    // Apply refactoring using LSP capabilities
    const edits = await this.applyRefactoring(refactorPlan);

    return {
      success: true,
      changes: edits
    };
  }

  /**
   * Handle formatting requests
   */
  private async handleFormat(context: EditContext): Promise<SmartEditResult> {
    const edits = await this.lspManager.formatFile(context.file);
    
    return {
      success: true,
      changes: [{
        file: context.file,
        edits: edits
      }]
    };
  }

  /**
   * Handle fix requests (e.g., fix diagnostics)
   */
  private async handleFix(context: EditContext, instruction?: string): Promise<SmartEditResult> {
    // Get diagnostics
    const diagnostics = await this.lspManager.getDiagnostics(context.file);
    
    // Filter diagnostics that can be auto-fixed
    const fixableDiagnostics = diagnostics.filter(d => d.code && this.isFixable(d));
    
    if (fixableDiagnostics.length === 0) {
      return {
        success: false,
        error: 'No fixable diagnostics found'
      };
    }

    // Apply fixes (this would use LSP code actions)
    const fixes = await this.applyDiagnosticFixes(fixableDiagnostics);

    return {
      success: true,
      changes: fixes
    };
  }

  /**
   * Handle enhancement requests
   */
  private async handleEnhance(context: EditContext, instruction?: string): Promise<SmartEditResult> {
    // Use code intelligence to generate enhancements
    const suggestions = await this.codeIntelligence.getContextualSuggestions(
      context.file,
      instruction,
      context.selection
    );

    // Apply AI-suggested improvements
    const enhancements = await this.applyEnhancements(context, suggestions);

    return {
      success: true,
      changes: enhancements,
      suggestions: suggestions
    };
  }

  /**
   * Get LSP context for a file
   */
  private async getLSPContext(filePath: string): Promise<any> {
    // This would gather comprehensive LSP information
    return {
      symbols: await this.getDocumentSymbols(filePath),
      diagnostics: await this.lspManager.getDiagnostics(filePath),
      // Add more LSP context as needed
    };
  }

  /**
   * Get document symbols from LSP
   */
  private async getDocumentSymbols(filePath: string): Promise<Array<any>> {
    // Implementation would call LSP textDocument/documentSymbol
    return [];
  }

  /**
   * Generate refactoring plan using AI + LSP
   */
  private async generateRefactorPlan(context: EditContext, instruction?: string, analysis?: any, lspContext?: any): Promise<any> {
    // This would integrate with your AI system to generate a refactoring plan
    // based on the instruction, code analysis, and LSP context
    return {
      type: 'refactor',
      instruction,
      context,
      analysis,
      lspContext,
      steps: []
    };
  }

  /**
   * Apply refactoring plan
   */
  private async applyRefactoring(plan: any): Promise<Array<any>> {
    // Implementation for applying refactoring using LSP
    return [];
  }

  /**
   * Check if diagnostic is fixable
   */
  private isFixable(diagnostic: any): boolean {
    // Logic to determine if a diagnostic can be auto-fixed
    return diagnostic.code && ['unused-import', 'missing-semicolon'].includes(diagnostic.code);
  }

  /**
   * Apply diagnostic fixes
   */
  private async applyDiagnosticFixes(diagnostics: Array<any>): Promise<Array<any>> {
    // Implementation for applying diagnostic fixes
    return [];
  }

  /**
   * Apply enhancements based on suggestions
   */
  private async applyEnhancements(context: EditContext, suggestions: Array<any>): Promise<Array<any>> {
    // Implementation for applying AI-suggested enhancements
    return [];
  }

  /**
   * Detect language for a file
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascriptreact',
      'ts': 'typescript',
      'tsx': 'typescriptreact',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'lua': 'lua',
      'md': 'markdown',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml'
    };
    return languageMap[ext || ''] || 'text';
  }

  /**
   * Get available capabilities
   */
  getCapabilities(): NeovimCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Shutdown the bridge
   */
  async shutdown(): Promise<void> {
    if (this.isInitialized) {
      await this.lspManager.shutdown();
      this.isInitialized = false;
      this.emit('shutdown');
    }
  }
}

export default NeovimBridge; 