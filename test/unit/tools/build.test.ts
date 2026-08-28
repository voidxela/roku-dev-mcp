import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBuild } from "../../../src/tools/build.js";
import { zipRokuProject } from "../../../src/lib/zipper.js";

describe("roku_build", () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "roku-build-test-")); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it("runs the project build and returns its sole validated ZIP", async () => {
    fs.writeFileSync(path.join(directory, "package.json"), '{"scripts":{"build":"unused"}}');
    fs.writeFileSync(path.join(directory, "manifest"), "title=Test");
    const zip = await zipRokuProject(directory);
    fs.mkdirSync(path.join(directory, "out"));
    const artifact = path.join(directory, "out", "app.zip");
    fs.writeFileSync(artifact, zip.buffer);
    const runBuild = vi.fn(async () => undefined);

    const result = await handleBuild({ project_dir: directory }, { runBuild });
    expect(runBuild).toHaveBeenCalledWith(directory, "npm");
    expect(result.package_path).toBe(artifact);
    expect(result.package_size_bytes).toBe(zip.sizeBytes);
  });

  it("uses an explicit package path when builds emit multiple ZIPs", async () => {
    fs.writeFileSync(path.join(directory, "package.json"), '{}');
    fs.writeFileSync(path.join(directory, "manifest"), "title=Test");
    const zip = await zipRokuProject(directory);
    fs.mkdirSync(path.join(directory, "out"));
    fs.writeFileSync(path.join(directory, "out", "one.zip"), zip.buffer);
    const selected = path.join(directory, "out", "two.zip");
    fs.writeFileSync(selected, zip.buffer);

    const result = await handleBuild({ project_dir: directory, package_path: "out/two.zip" }, { runBuild: async () => undefined });
    expect(result.package_path).toBe(selected);
  });
});
