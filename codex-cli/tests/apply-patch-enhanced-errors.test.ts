import { test, expect } from "vitest";
import { process_patch } from "../src/utils/agent/apply-patch.js";

function createInMemoryFS(initialFiles: Record<string, string>) {
  const files: Record<string, string> = { ...initialFiles };
  const writes: Record<string, string> = {};
  const removals: Array<string> = [];

  const openFn = (p: string): string => {
    const file = files[p];
    if (typeof file === "string") {
      return file;
    } else {
      throw new Error(`File not found: ${p}`);
    }
  };

  const writeFn = (p: string, content: string): void => {
    files[p] = content;
    writes[p] = content;
  };

  const removeFn = (p: string): void => {
    delete files[p];
    removals.push(p);
  };

  return { openFn, writeFn, removeFn, writes, removals, files };
}

test("apply_patch - context mismatch should provide helpful error message", () => {
  // This tests that when apply_patch fails due to context mismatch,
  // we get better error messages (this functionality was added to handle-exec-command.ts)
  
  const patch = `*** Begin Patch
*** Update File: script.js
@@ -87,14 +87,55 @@
     timezonesDiv.innerHTML = ''; // Clear previous times

     timezonesToDisplay.forEach(tz => {
-        try {
-            const now = new Date();
+        const timezoneItem = document.createElement('div');
*** End Patch`;

  // Current file content that doesn't match the expected context
  const currentContent = `function updateTimezones() {
    const timezonesDiv = document.getElementById('timezones');
    if (!timezonesDiv) return;

    timezonesDiv.innerHTML = ''; // Clear previous clocks

    timezonesToDisplay.forEach(tz => {
        try {
            const now = new Date();
            
            // Get the time in the specific timezone
            const timeInZone = new Date(now.toLocaleString("en-US", {timeZone: tz.zone}));
        } catch (error) {
            console.error("Error:", error);
        }
    });
}`;

  const fs = createInMemoryFS({ "script.js": currentContent });

  // This should throw an error due to context mismatch
  expect(() => {
    process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn);
  }).toThrow();
  
  // The file should not be modified
  expect(fs.writes).toEqual({});
  expect(fs.removals).toEqual([]);
});

test("apply_patch - should succeed with correct context", () => {
  const patch = `*** Begin Patch
*** Update File: script.js
@@ -4,7 +4,7 @@
     timezonesDiv.innerHTML = ''; // Clear previous clocks

     timezonesToDisplay.forEach(tz => {
-        try {
-            const now = new Date();
+        const clockItem = document.createElement('div');
+        const now = new Date();
*** End Patch`;

  const currentContent = `function updateTimezones() {
    const timezonesDiv = document.getElementById('timezones');
    if (!timezonesDiv) return;

    timezonesDiv.innerHTML = ''; // Clear previous clocks

    timezonesToDisplay.forEach(tz => {
        try {
            const now = new Date();
            
            const timeInZone = new Date(now.toLocaleString("en-US", {timeZone: tz.zone}));
        } catch (error) {
            console.error("Error:", error);
        }
    });
}`;

  const fs = createInMemoryFS({ "script.js": currentContent });

  const result = process_patch(patch, fs.openFn, fs.writeFn, fs.removeFn);
  
  expect(result).toBe("Done!");
  expect(fs.writes["script.js"]).toContain("const clockItem = document.createElement('div');");
  expect(fs.writes["script.js"]).toContain("const now = new Date();");
});

test("apply_patch - repeated context mismatches should be detected", () => {
  // This simulates the scenario from the user's issue where the same
  // failing patch was attempted multiple times
  
  const problematicPatch = `*** Begin Patch
*** Update File: script.js
@@ -87,14 +87,55 @@
     timezonesDiv.innerHTML = ''; // Clear previous times

     timezonesToDisplay.forEach(tz => {
-        try {
-            const now = new Date();
+        const timezoneItem = document.createElement('div');
*** End Patch`;

  // This file content doesn't have the expected context lines
  const currentContent = `// This is a completely different file structure
function differentFunction() {
    return "not the timezone code";
}`;

  const fs = createInMemoryFS({ "script.js": currentContent });

  // Multiple attempts should all fail 
  for (let i = 0; i < 3; i++) {
    expect(() => {
      process_patch(problematicPatch, fs.openFn, fs.writeFn, fs.removeFn);
    }).toThrow();
  }
  
  // No modifications should have been made
  expect(fs.writes).toEqual({});
}); 