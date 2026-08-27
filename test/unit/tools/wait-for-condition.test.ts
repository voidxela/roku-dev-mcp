import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  parseConditionExpression,
  handleWaitForCondition,
} from "../../../src/tools/wait-for-condition.js";
import { MockRokuDevice } from "../../mocks/mock-roku-device.js";
import { EcpAdapter } from "../../../src/adapters/ecp.js";
import { SgDebugAdapter } from "../../../src/adapters/sg-debug.js";
import { BsConsoleAdapter } from "../../../src/adapters/bs-console.js";
import { ErrorCode } from "../../../src/types/errors.js";

describe("wait-for-condition", () => {
  it("parses valid condition expressions", () => {
    expect(parseConditionExpression("node_exists: VideoPlayer")).toEqual({
      type: "node_exists",
      nodeId: "VideoPlayer",
    });

    expect(
      parseConditionExpression("node_field: homeRowList.numRows=5")
    ).toEqual({
      type: "node_field",
      nodeId: "homeRowList",
      field: "numRows",
      value: "5",
    });

    expect(parseConditionExpression("playback_state: play")).toEqual({
      type: "playback_state",
      expectedState: "play",
    });

    expect(parseConditionExpression("app_active: dev")).toEqual({
      type: "app_active",
      appId: "dev",
    });

    expect(parseConditionExpression("log_contains: Initializing")).toEqual({
      type: "log_contains",
      pattern: "Initializing",
    });

    expect(parseConditionExpression("crash_detected")).toEqual({
      type: "crash_detected",
    });
  });

  it("throws INVALID_CONDITION on malformed condition strings", () => {
    expect(() => parseConditionExpression("invalid_condition_syntax")).toThrow();
  });

  describe("evaluating conditions against mock device", () => {
    let mockRoku: MockRokuDevice;
    let ecp: EcpAdapter;
    let sgDebug: SgDebugAdapter;
    let bsConsole: BsConsoleAdapter;

    beforeAll(async () => {
      mockRoku = new MockRokuDevice({
        installerPort: 0,
        ecpPort: 0,
        sgPort: 0,
        bsPort: 0,
      });
      await mockRoku.start();

      ecp = new EcpAdapter({
        deviceIp: "127.0.0.1",
        port: mockRoku.ecpPort,
      });

      sgDebug = new SgDebugAdapter({
        deviceIp: "127.0.0.1",
        port: mockRoku.sgPort,
        idleTimeoutMs: 150,
      });

      bsConsole = new BsConsoleAdapter({
        deviceIp: "127.0.0.1",
        port: mockRoku.bsPort,
      });
      bsConsole.start();

      await new Promise((r) => setTimeout(r, 150));
    });

    afterAll(async () => {
      bsConsole.stop();
      await mockRoku.stop();
    });

    it("evaluates node_exists condition", async () => {
      const res = await handleWaitForCondition(
        {
          condition: "node_exists: homeRowList",
          timeout_seconds: 2,
          poll_interval_ms: 100,
        },
        { ecp, sgDebug, bsConsole }
      );

      expect(res.satisfied).toBe(true);
      expect(res.timeout).toBe(false);
    });

    it("evaluates playback_state condition", async () => {
      const res = await handleWaitForCondition(
        {
          condition: "playback_state: play",
          timeout_seconds: 2,
          poll_interval_ms: 100,
        },
        { ecp, sgDebug, bsConsole }
      );

      expect(res.satisfied).toBe(true);
      expect(res.timeout).toBe(false);
    });

    it("evaluates app_active condition", async () => {
      const res = await handleWaitForCondition(
        {
          condition: "app_active: dev",
          timeout_seconds: 2,
          poll_interval_ms: 100,
        },
        { ecp, sgDebug, bsConsole }
      );

      expect(res.satisfied).toBe(true);
      expect(res.timeout).toBe(false);
    });

    it("evaluates log_contains condition", async () => {
      mockRoku.emitBsLog("Custom log line for testing");
      await new Promise((r) => setTimeout(r, 100));

      const res = await handleWaitForCondition(
        {
          condition: "log_contains: Custom log line",
          timeout_seconds: 2,
          poll_interval_ms: 100,
        },
        { ecp, sgDebug, bsConsole }
      );

      expect(res.satisfied).toBe(true);
      expect(res.timeout).toBe(false);
    });

    it("returns timeout when condition is not met", async () => {
      const res = await handleWaitForCondition(
        {
          condition: "node_exists: NonExistentNode",
          timeout_seconds: 1,
          poll_interval_ms: 100,
        },
        { ecp, sgDebug, bsConsole }
      );

      expect(res.satisfied).toBe(false);
      expect(res.timeout).toBe(true);
      expect(res.snapshot).toBeNull();
    });
  });
});
