import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getFileSystemSuggestions } from "../src/utils/file-system-suggestions";

vi.mock("fs");
vi.mock("os");

describe("getFileSystemSuggestions", () => {
  const mockFs = fs as unknown as {
    readdirSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
  };

  const mockOs = os as unknown as {
    homedir: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty prefix", () => {
    expect(getFileSystemSuggestions("")).toEqual([]);
  });

  it("expands ~ to home directory", () => {
    const homeDir = path.resolve(path.join(path.sep, "home", "testuser"));
    mockOs.homedir = vi.fn(() => homeDir);
    mockFs.readdirSync = vi.fn(() => ["file1.txt", "docs"]);
    mockFs.statSync = vi.fn((p) => ({
      isDirectory: () => path.basename(p) === "docs",
    }));

    const result = getFileSystemSuggestions("~" + path.sep);

    expect(mockFs.readdirSync).toHaveBeenCalledWith(homeDir);
    expect(result).toEqual([
      {
        path: path.join(homeDir, "file1.txt"),
        isDirectory: false,
      },
      {
        path: path.join(homeDir, "docs") + path.sep,
        isDirectory: true,
      },
    ]);
  });

  it("filters by prefix if not a directory", () => {
    mockFs.readdirSync = vi.fn(() => ["abc.txt", "abd.txt", "xyz.txt"]);
    mockFs.statSync = vi.fn((p) => ({
      isDirectory: () => p.includes("abd"),
    }));

    const result = getFileSystemSuggestions("a");
    expect(result).toEqual([
      {
        path: "abc.txt",
        isDirectory: false,
      },
      {
        path: "abd.txt" + path.sep,
        isDirectory: true,
      },
    ]);
  });

  it("handles errors gracefully", () => {
    mockFs.readdirSync = vi.fn(() => {
      throw new Error("failed");
    });

    const result = getFileSystemSuggestions("some/path");
    expect(result).toEqual([]);
  });

  it("normalizes relative path", () => {
    mockFs.readdirSync = vi.fn(() => ["foo", "bar"]);
    mockFs.statSync = vi.fn((_p) => ({
      isDirectory: () => true,
    }));

    const result = getFileSystemSuggestions("./");
    const paths = result.map((item) => item.path);
    const allDirectories = result.every((item) => item.isDirectory === true);

    expect(paths).toContain("foo" + path.sep);
    expect(paths).toContain("bar" + path.sep);
    expect(allDirectories).toBe(true);
  });
});
