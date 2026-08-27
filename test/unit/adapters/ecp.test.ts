import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EcpAdapter } from "../../../src/adapters/ecp.js";
import { MockRokuDevice } from "../../mocks/mock-roku-device.js";
import { ErrorCode } from "../../../src/types/errors.js";

describe("EcpAdapter", () => {
  let mockRoku: MockRokuDevice;
  let adapter: EcpAdapter;

  beforeAll(async () => {
    mockRoku = new MockRokuDevice({
      installerPort: 0,
      ecpPort: 0,
      sgPort: 0,
      bsPort: 0,
    });
    await mockRoku.start();

    adapter = new EcpAdapter({
      deviceIp: "127.0.0.1",
      port: mockRoku.ecpPort,
    });
  });

  afterAll(async () => {
    await mockRoku.stop();
  });

  it("sends single valid key", async () => {
    await adapter.sendKey("Home");
    expect(mockRoku.lastKeypress).toBe("Home");

    await adapter.sendKey("Lit_a");
    expect(mockRoku.lastKeypress).toBe("Lit_a");
  });

  it("rejects invalid key names", async () => {
    await expect(adapter.sendKey("InvalidKey123")).rejects.toMatchObject({
      code: ErrorCode.INVALID_KEY,
    });
  });

  it("sends sequential keys with delay", async () => {
    const result = await adapter.sendKeys(["Down", "Select"], 10);
    expect(result.keys_sent).toEqual(["Down", "Select"]);
    expect(result.total_keys).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockRoku.lastKeypress).toBe("Select");
  });

  it("launches app with deep link parameters", async () => {
    const result = await adapter.launch("dev", {
      contentId: "movie123",
      mediaType: "movie",
    });

    expect(result.launched).toBe(true);
    expect(result.app_id).toBe("dev");
    expect(result.content_id).toBe("movie123");
    expect(result.active_app_confirmed).toBe(true);
  });

  it("queries active app, device info, apps, and media player", async () => {
    const activeApp = await adapter.getActiveApp();
    expect(activeApp.id).toBe("dev");
    expect(activeApp.name).toBe("MockApp");

    const deviceInfo = await adapter.getDeviceInfo();
    expect(deviceInfo.model_name).toBe("Roku Ultra");

    const apps = await adapter.getInstalledApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe("dev");

    const media = await adapter.getMediaPlayer();
    expect(media.state).toBe("play");
    expect(media.position_ms).toBe(5000);
  });
});
