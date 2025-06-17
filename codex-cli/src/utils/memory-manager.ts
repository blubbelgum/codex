interface MemoryConfig {
  maxChatMessages: number;
  maxFileCache: number;
  maxDirectoryCache: number;
  cleanupInterval: number; // in milliseconds
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
}

interface FileCache {
  content: string;
  size: number;
  lines: number;
  isText: boolean;
}

export class MemoryManager {
  private config: MemoryConfig;
  private fileCache = new Map<string, CacheEntry<FileCache>>();
  private directoryCache = new Map<string, CacheEntry<Array<string>>>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = {
      maxChatMessages: 1000,
      maxFileCache: 50,
      maxDirectoryCache: 20,
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
      ...config
    };

    this.startCleanupTimer();
  }

  // Chat message management
  optimizeChatMessages<T extends { id: string; timestamp: Date }>(
    messages: Array<T>
  ): Array<T> {
    if (messages.length <= this.config.maxChatMessages) {
      return messages;
    }

    // Keep most recent messages and some older important ones
    const recentCount = Math.floor(this.config.maxChatMessages * 0.8);
    const keepOldCount = this.config.maxChatMessages - recentCount;

    const recent = messages.slice(-recentCount);
    const older = messages.slice(0, -recentCount);
    
    // Keep some older messages (every nth message to maintain context)
    const keepOld: Array<T> = [];
    const step = Math.max(1, Math.floor(older.length / keepOldCount));
    for (let i = 0; i < older.length; i += step) {
      if (keepOld.length < keepOldCount && i < older.length) {
        const message = older[i];
        if (message) {
          keepOld.push(message);
        }
      }
    }

    return [...keepOld, ...recent];
  }

  // File cache management
  cacheFile(filePath: string, fileData: FileCache): void {
    const now = Date.now();
    
    // If cache is full, remove least recently used item
    if (this.fileCache.size >= this.config.maxFileCache) {
      this.evictLeastRecentlyUsed(this.fileCache);
    }

    this.fileCache.set(filePath, {
      data: fileData,
      timestamp: now,
      accessCount: 1,
      lastAccess: now
    });
  }

  getCachedFile(filePath: string): FileCache | null {
    const entry = this.fileCache.get(filePath);
    if (!entry) {return null;}

    // Update access statistics
    entry.accessCount++;
    entry.lastAccess = Date.now();

    return entry.data;
  }

  // Directory cache management
  cacheDirectory(dirPath: string, entries: Array<string>): void {
    const now = Date.now();
    
    if (this.directoryCache.size >= this.config.maxDirectoryCache) {
      this.evictLeastRecentlyUsed(this.directoryCache);
    }

    this.directoryCache.set(dirPath, {
      data: entries,
      timestamp: now,
      accessCount: 1,
      lastAccess: now
    });
  }

  getCachedDirectory(dirPath: string): Array<string> | null {
    const entry = this.directoryCache.get(dirPath);
    if (!entry) {return null;}

    entry.accessCount++;
    entry.lastAccess = Date.now();

    return entry.data;
  }

  // Cache eviction
  private evictLeastRecentlyUsed<T>(cache: Map<string, CacheEntry<T>>): void {
    let lruKey: string | null = null;
    let lruTime = Date.now();

    for (const [key, entry] of cache.entries()) {
      if (entry.lastAccess < lruTime) {
        lruTime = entry.lastAccess;
        lruKey = key;
      }
    }

    if (lruKey) {
      cache.delete(lruKey);
    }
  }

  // Cleanup expired entries
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    // Clean file cache
    for (const [key, entry] of this.fileCache.entries()) {
      if (now - entry.lastAccess > maxAge) {
        this.fileCache.delete(key);
      }
    }

    // Clean directory cache
    for (const [key, entry] of this.directoryCache.entries()) {
      if (now - entry.lastAccess > maxAge) {
        this.directoryCache.delete(key);
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  // Get memory statistics
  getStats() {
    return {
      fileCache: {
        size: this.fileCache.size,
        maxSize: this.config.maxFileCache
      },
      directoryCache: {
        size: this.directoryCache.size,
        maxSize: this.config.maxDirectoryCache
      },
      config: this.config
    };
  }

  // Manual cleanup
  clearCaches(): void {
    this.fileCache.clear();
    this.directoryCache.clear();
  }

  // Invalidate specific cache
  invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  invalidateDirectory(dirPath: string): void {
    this.directoryCache.delete(dirPath);
  }

  // Destroy and cleanup
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clearCaches();
  }
}

// Singleton instance
export const memoryManager = new MemoryManager(); 