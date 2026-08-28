import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BsConsoleAdapter } from "../../../src/adapters/bs-console.js";
import { MockRokuDevice } from "../../mocks/mock-roku-device.js";

describe("BsConsoleAdapter", () => {
  let mockRoku: MockRokuDevice;
  let adapter: BsConsoleAdapter;

  beforeAll(async () => {
    mockRoku = new MockRokuDevice({
      installerPort: 0,
      ecpPort: 0,
      sgPort: 0,
      bsPort: 0,
    });
    await mockRoku.start();

    adapter = new BsConsoleAdapter({
      deviceIp: "127.0.0.1",
      port: mockRoku.bsPort,
      bufferSize: 100,
    });
    adapter.start();

    // Wait for connection to establish
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    adapter.stop();
    await mockRoku.stop();
  });

  it("receives initial logs in buffer", () => {
    const logs = adapter.getAllLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.text.includes("Running dev 'MyApp'"))).toBe(true);
  });

  it("captures crash events in real time", async () => {
    expect(adapter.hasCrash()).toBe(false);

    mockRoku.emitCrash("Null reference in oncontentloaded");

    // Wait for data to be received and processed
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(adapter.hasCrash()).toBe(true);
    const crash = adapter.getLastCrash();
    expect(crash).not.toBeNull();
    expect(crash?.trigger_line).toContain("BRIGHTSCRIPT: ERROR:");
    expect(crash?.backtrace).toHaveLength(2);
    expect(crash?.backtrace[0].function).toContain("oncontentloaded");

    adapter.clearCrash();
    expect(adapter.hasCrash()).toBe(false);
  });

  it("sends debugger commands and returns output", async () => {
    const output = await adapter.sendCommand("bt", 500);
    expect(output).toContain("Function main()");
  });

  it("shares one Roku console connection across local adapter instances", async () => {
    const follower = new BsConsoleAdapter({
      deviceIp: "127.0.0.1",
      port: mockRoku.bsPort,
      bufferSize: 100,
    });
    const connectionsBefore = mockRoku.bsConnectionCount;
    follower.start();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(mockRoku.bsConnectionCount).toBe(connectionsBefore);
    mockRoku.emitBsLog("shared console log");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(follower.getAllLogs().some((entry) => entry.text === "shared console log")).toBe(true);
    await expect(follower.sendCommand("bt", 500)).resolves.toContain("Function main()");
    follower.stop();
  });
});
