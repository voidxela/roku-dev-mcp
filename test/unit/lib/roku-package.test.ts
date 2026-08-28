import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRokuPackage } from "../../../src/lib/roku-package.js";
import { zipRokuProject } from "../../../src/lib/zipper.js";
import { ErrorCode } from "../../../src/types/errors.js";

describe("Roku package validation", () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "roku-package-test-")); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it("accepts a ZIP with manifest at its root", async () => {
    fs.writeFileSync(path.join(directory, "manifest"), "title=Test");
    const zip = await zipRokuProject(directory);
    const packagePath = path.join(directory, "app.zip");
    fs.writeFileSync(packagePath, zip.buffer);
    expect(validateRokuPackage(packagePath)).toMatchObject({ packagePath, sizeBytes: zip.sizeBytes });
  });

  it("rejects a ZIP without a root manifest", () => {
    const packagePath = path.join(directory, "invalid.zip");
    fs.writeFileSync(packagePath, Buffer.from("not a zip"));
    try {
      validateRokuPackage(packagePath);
      throw new Error("expected package validation to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.INSTALL_FAILED });
    }
  });
});
