import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleDeploy } from "../../../src/tools/deploy.js";
import { zipRokuProject } from "../../../src/lib/zipper.js";

describe("roku_deploy", () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "roku-deploy-test-")); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it("installs the supplied Roku package without rebuilding it", async () => {
    fs.writeFileSync(path.join(directory, "manifest"), "title=Test");
    const zip = await zipRokuProject(directory);
    const packagePath = path.join(directory, "out.zip");
    fs.writeFileSync(packagePath, zip.buffer);
    const installOrReplace = vi.fn(async () => ({ success: true, message: "installed" }));
    const clearCrash = vi.fn();
    const getRecentLogs = vi.fn(() => []);

    const result = await handleDeploy(
      { package_path: packagePath, action: "Replace" },
      {
        installer: { installOrReplace } as never,
        bsConsole: { clearCrash, getRecentLogs, hasCrash: () => false } as never,
        waitForStartup: async () => undefined,
      }
    );

    expect(installOrReplace).toHaveBeenCalledWith(zip.buffer, "Replace");
    expect(clearCrash).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, package_path: packagePath, zip_size_bytes: zip.sizeBytes });
  });
});
