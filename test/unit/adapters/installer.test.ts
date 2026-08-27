import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { InstallerAdapter } from "../../../src/adapters/installer.js";
import { MockRokuDevice } from "../../mocks/mock-roku-device.js";
import { ErrorCode } from "../../../src/types/errors.js";

describe("InstallerAdapter", () => {
  let mockRoku: MockRokuDevice;
  let adapter: InstallerAdapter;

  beforeAll(async () => {
    mockRoku = new MockRokuDevice({
      installerPort: 0,
      ecpPort: 0,
      sgPort: 0,
      bsPort: 0,
      password: "testpassword",
    });
    await mockRoku.start();

    adapter = new InstallerAdapter({
      deviceIp: "127.0.0.1",
      port: mockRoku.installerPort,
      devPassword: "testpassword",
    });
  });

  afterAll(async () => {
    await mockRoku.stop();
  });

  it("successfully installs/replaces an application package", async () => {
    const dummyZip = Buffer.from("PK-dummy-zip-data");
    const result = await adapter.installOrReplace(dummyZip, "Install");
    expect(result.success).toBe(true);
    expect(result.message).toContain("installed");
  });

  it("handles install failures parsed from HTML", async () => {
    const failingZip = Buffer.from("fail_app_data");
    await expect(adapter.installOrReplace(failingZip, "Install")).rejects.toMatchObject({
      code: ErrorCode.INSTALL_FAILED,
      message: "Install Failure: Compilation error",
    });
  });

  it("successfully deletes the sideloaded application", async () => {
    const result = await adapter.deleteApp();
    expect(result.success).toBe(true);
    expect(result.message).toContain("deleted");
  });

  it("captures screenshot and returns base64 string", async () => {
    const screenshot = await adapter.captureScreenshot();
    expect(screenshot.format).toBe("jpeg");
    expect(screenshot.width).toBe(1920);
    expect(screenshot.height).toBe(1080);
    expect(typeof screenshot.base64).toBe("string");
    expect(screenshot.base64.length).toBeGreaterThan(0);
  });
});
