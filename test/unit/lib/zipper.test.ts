import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { zipRokuProject, shouldExclude } from "../../../src/lib/zipper.js";
import { ErrorCode } from "../../../src/types/errors.js";

describe("zipper", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roku-zip-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("identifies excluded files and directories correctly", () => {
    expect(shouldExclude(".git/config")).toBe(true);
    expect(shouldExclude("node_modules/package/index.js")).toBe(true);
    expect(shouldExclude(".env")).toBe(true);
    expect(shouldExclude("app.log")).toBe(true);
    expect(shouldExclude("source/main.brs")).toBe(false);
    expect(shouldExclude("manifest")).toBe(false);
    expect(shouldExclude("components/MyComponent.xml")).toBe(false);
    expect(shouldExclude("custom/secret.txt", ["custom/**"])).toBe(true);
  });

  it("throws MANIFEST_NOT_FOUND when manifest is missing", async () => {
    await expect(zipRokuProject(tempDir)).rejects.toMatchObject({
      code: ErrorCode.MANIFEST_NOT_FOUND,
    });
  });

  it("creates a valid zip archive with project contents", async () => {
    // Create manifest and files
    fs.writeFileSync(path.join(tempDir, "manifest"), "title=TestApp\nversion=1.0.0");
    fs.mkdirSync(path.join(tempDir, "source"));
    fs.writeFileSync(path.join(tempDir, "source", "main.brs"), "sub main()\nend sub");
    fs.mkdirSync(path.join(tempDir, ".git"));
    fs.writeFileSync(path.join(tempDir, ".git", "config"), "git config");

    const result = await zipRokuProject(tempDir);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });
});
