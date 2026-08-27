import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SgDebugAdapter } from "../../../src/adapters/sg-debug.js";
import { MockRokuDevice } from "../../mocks/mock-roku-device.js";

describe("SgDebugAdapter", () => {
  let mockRoku: MockRokuDevice;
  let adapter: SgDebugAdapter;

  beforeAll(async () => {
    mockRoku = new MockRokuDevice({
      installerPort: 0,
      ecpPort: 0,
      sgPort: 0,
      bsPort: 0,
    });
    await mockRoku.start();

    adapter = new SgDebugAdapter({
      deviceIp: "127.0.0.1",
      port: mockRoku.sgPort,
      connectTimeoutMs: 2000,
      commandTimeoutMs: 3000,
      idleTimeoutMs: 200,
    });
  });

  afterAll(async () => {
    await mockRoku.stop();
  });

  it("fetches and parses UI tree via TCP connection", async () => {
    const result = await adapter.getUiTree();
    expect(result.total_nodes).toBeGreaterThan(0);
    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].id).toBe("root");
    expect(result.tree[0].subtype).toBe("HomeScene");
    expect(result.tree[0].children[0].id).toBe("mainLayout");
  });

  it("filters UI tree by filterId", async () => {
    const result = await adapter.getUiTree({ filterId: "mainLayout" });
    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].id).toBe("mainLayout");
  });
});
