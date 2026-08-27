import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
      defaultKeyDelayMs: 10,
      keypressTimeoutMs: 1000,
      maxRetries: 2,
      retryDelayMs: 20,
    });
  });

  afterAll(async () => {
    await mockRoku.stop();
  });

  beforeEach(() => {
    mockRoku.keypressHistory = [];
    mockRoku.lastKeypress = undefined;
    mockRoku.lastKeyDown = undefined;
    mockRoku.lastKeyUp = undefined;
    mockRoku.ecpFailuresRemaining = 0;
  });

  it("sends single valid key", async () => {
    await adapter.sendKey("Home");
    expect(mockRoku.lastKeypress).toBe("Home");

    await adapter.sendKey("Lit_a");
    expect(mockRoku.lastKeypress).toBe("Lit_a");
  });

  it("normalizes case-insensitive key names", async () => {
    await adapter.sendKey("home");
    expect(mockRoku.lastKeypress).toBe("Home");

    await adapter.sendKey("down");
    expect(mockRoku.lastKeypress).toBe("Down");

    await adapter.sendKey("select");
    expect(mockRoku.lastKeypress).toBe("Select");

    await adapter.sendKey("play");
    expect(mockRoku.lastKeypress).toBe("Play");
  });

  it("maps aliases to canonical ECP key names", async () => {
    await adapter.sendKey("ok");
    expect(mockRoku.lastKeypress).toBe("Select");

    await adapter.sendKey("rewind");
    expect(mockRoku.lastKeypress).toBe("Rev");

    await adapter.sendKey("fastforward");
    expect(mockRoku.lastKeypress).toBe("Fwd");

    await adapter.sendKey("volup");
    expect(mockRoku.lastKeypress).toBe("VolumeUp");

    await adapter.sendKey("mute");
    expect(mockRoku.lastKeypress).toBe("VolumeMute");

    await adapter.sendKey("power");
    expect(mockRoku.lastKeypress).toBe("Power");

    await adapter.sendKey("replay");
    expect(mockRoku.lastKeypress).toBe("InstantReplay");

    await adapter.sendKey("star");
    expect(mockRoku.lastKeypress).toBe("Info");
  });

  it("handles literal keys without double encoding", async () => {
    // Encoded format: Lit_%40 for '@' -> should send Lit_%40, decode to Lit_@
    await adapter.sendKey("Lit_%40");
    expect(mockRoku.lastKeypress).toBe("Lit_@");

    // Unencoded format: Lit_@ -> should send Lit_%40, decode to Lit_@
    await adapter.sendKey("Lit_@");
    expect(mockRoku.lastKeypress).toBe("Lit_@");

    // Space encoded: Lit_%20 -> decode to Lit_ 
    await adapter.sendKey("Lit_%20");
    expect(mockRoku.lastKeypress).toBe("Lit_ ");

    // Space unencoded: Lit_ 
    await adapter.sendKey("Lit_ ");
    expect(mockRoku.lastKeypress).toBe("Lit_ ");

    // Special characters: +, /, ?
    await adapter.sendKey("Lit_+");
    expect(mockRoku.lastKeypress).toBe("Lit_+");

    await adapter.sendKey("Lit_?");
    expect(mockRoku.lastKeypress).toBe("Lit_?");
  });

  it("expands multi-character literal strings with delay", async () => {
    const result = await adapter.sendKeys(["Lit_cat"], 10);
    expect(result.keys_sent).toEqual(["Lit_c", "Lit_a", "Lit_t"]);
    expect(result.total_keys).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(mockRoku.keypressHistory).toEqual(["Lit_c", "Lit_a", "Lit_t"]);
  });

  it("rejects invalid key names", async () => {
    await expect(adapter.sendKey("InvalidKey123")).rejects.toMatchObject({
      code: ErrorCode.INVALID_KEY,
    });
  });

  it("sends sequential keys with delay", async () => {
    const result = await adapter.sendKeys(["down", "ok", "home"], 10);
    expect(result.keys_sent).toEqual(["Down", "Select", "Home"]);
    expect(result.total_keys).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(mockRoku.keypressHistory).toEqual(["Down", "Select", "Home"]);
  });

  it("handles partial failure on invalid key in sequence", async () => {
    const result = await adapter.sendKeys(["Down", "UnknownKeyXYZ", "Select"], 10);
    expect(result.keys_sent).toEqual(["Down"]);
    expect(result.total_keys).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("UnknownKeyXYZ");
  });

  it("retries on transient failure and recovers", async () => {
    mockRoku.ecpFailuresRemaining = 1; // 1 failure, then success on 1st retry
    const result = await adapter.sendKeys(["Down", "Select"], 10);
    expect(result.keys_sent).toEqual(["Down", "Select"]);
    expect(result.total_keys).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockRoku.lastKeypress).toBe("Select");
  });

  it("fails after exceeding max retries", async () => {
    mockRoku.ecpFailuresRemaining = 5; // exceeds maxRetries (2)
    const result = await adapter.sendKeys(["Down"], 10);
    expect(result.keys_sent).toEqual([]);
    expect(result.total_keys).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it("supports keyDown and keyUp", async () => {
    await adapter.keyDown("Select");
    expect(mockRoku.lastKeyDown).toBe("Select");

    await adapter.keyUp("Select");
    expect(mockRoku.lastKeyUp).toBe("Select");
  });

  it("supports sendText helper", async () => {
    const result = await adapter.sendText("Roku TV", 5);
    expect(result.total_keys).toBe(7);
    expect(result.errors).toHaveLength(0);
    expect(mockRoku.keypressHistory).toEqual([
      "Lit_R",
      "Lit_o",
      "Lit_k",
      "Lit_u",
      "Lit_ ",
      "Lit_T",
      "Lit_V",
    ]);
  });

  it("serializes concurrent sendKey / sendKeys operations using mutex", async () => {
    // Launch two sequences concurrently
    const p1 = adapter.sendKeys(["Up", "Up"], 15);
    const p2 = adapter.sendKeys(["Down", "Down"], 15);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.total_keys).toBe(2);
    expect(r2.total_keys).toBe(2);

    // Sequence must not be interleaved (either Up, Up, Down, Down or Down, Down, Up, Up)
    const history = mockRoku.keypressHistory;
    expect(history).toHaveLength(4);
    const isUpFirst = history[0] === "Up" && history[1] === "Up" && history[2] === "Down" && history[3] === "Down";
    const isDownFirst = history[0] === "Down" && history[1] === "Down" && history[2] === "Up" && history[3] === "Up";
    expect(isUpFirst || isDownFirst).toBe(true);
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

