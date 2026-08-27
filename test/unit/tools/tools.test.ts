import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createRokuDevServer } from "../../../src/server.js";
import { MockRokuDevice } from "../../mocks/mock-roku-device.js";
import { handleBuildAndDeploy } from "../../../src/tools/build-and-deploy.js";
import { handleCaptureState } from "../../../src/tools/capture-state.js";
import { handleAssertPlayback } from "../../../src/tools/assert-playback.js";
import { handleLaunch } from "../../../src/tools/launch.js";
import { handleSendKeys } from "../../../src/tools/send-keys.js";

describe("MCP Tools", () => {
  let mockRoku: MockRokuDevice;
  let tempAppDir: string;
  let serverInstance: ReturnType<typeof createRokuDevServer>;

  beforeAll(async () => {
    mockRoku = new MockRokuDevice({
      installerPort: 0,
      ecpPort: 0,
      sgPort: 0,
      bsPort: 0,
      password: "testpassword",
    });
    await mockRoku.start();

    tempAppDir = fs.mkdtempSync(path.join(os.tmpdir(), "roku-tool-test-"));
    fs.writeFileSync(
      path.join(tempAppDir, "manifest"),
      "title=ToolTestApp\nversion=1.0.0"
    );
    fs.mkdirSync(path.join(tempAppDir, "source"));
    fs.writeFileSync(
      path.join(tempAppDir, "source", "main.brs"),
      "sub main()\nend sub"
    );

    serverInstance = createRokuDevServer({
      deviceIp: "127.0.0.1",
      installerPort: mockRoku.installerPort,
      ecpPort: mockRoku.ecpPort,
      sgPort: mockRoku.sgPort,
      bsPort: mockRoku.bsPort,
      devPassword: "testpassword",
      logBufferSize: 100,
      keypressDelayMs: 10,
      connectTimeoutMs: 2000,
      commandTimeoutMs: 3000,
    });

    serverInstance.adapters.bsConsole.start();
    await new Promise((r) => setTimeout(r, 150));
  });

  afterAll(async () => {
    serverInstance.adapters.bsConsole.stop();
    await mockRoku.stop();
    fs.rmSync(tempAppDir, { recursive: true, force: true });
  });

  it("handles roku_build_and_deploy", async () => {
    const res = await handleBuildAndDeploy(
      {
        source_dir: tempAppDir,
        action: "Install",
      },
      {
        installer: serverInstance.adapters.installer,
        bsConsole: serverInstance.adapters.bsConsole,
      }
    );

    expect(res.success).toBe(true);
    expect(res.zip_size_bytes).toBeGreaterThan(0);
    expect(res.crash_detected).toBe(false);
  });

  it("handles roku_capture_state", async () => {
    const res = await handleCaptureState(
      {
        log_lines: 10,
        include_screenshot: true,
        include_ui_tree: true,
      },
      serverInstance.adapters
    );

    expect(res.captured_at).toBeDefined();
    expect(res.active_app?.id).toBe("dev");
    expect(res.screenshot).not.toBeNull();
    expect(res.screenshot?.format).toBe("jpeg");
    expect(res.ui_tree).not.toBeNull();
    expect(res.crash_detected).toBe(false);
  });

  it("handles roku_assert_playback", async () => {
    const res = await handleAssertPlayback({
      ecp: serverInstance.adapters.ecp,
    });

    expect(res.state).toBe("play");
    expect(res.is_playing).toBe(true);
    expect(res.position_ms).toBe(5000);
  });

  it("handles roku_launch", async () => {
    const res = await handleLaunch(
      {
        content_id: "test1234",
        media_type: "movie",
      },
      { ecp: serverInstance.adapters.ecp }
    );

    expect(res.launched).toBe(true);
    expect(res.app_id).toBe("dev");
    expect(res.content_id).toBe("test1234");
  });

  it("handles roku_send_keys", async () => {
    const res = await handleSendKeys(
      {
        keys: ["Down", "Select"],
        delay_ms: 10,
      },
      { ecp: serverInstance.adapters.ecp }
    );

    expect(res.total_keys).toBe(2);
    expect(res.keys_sent).toEqual(["Down", "Select"]);
    expect(res.errors).toHaveLength(0);
  });
});
