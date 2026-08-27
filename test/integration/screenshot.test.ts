import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { loadConfig } from "../../src/config.js";
import { createRokuDevServer } from "../../src/server.js";
import { handleBuildAndDeploy } from "../../src/tools/build-and-deploy.js";
import { handleCaptureState } from "../../src/tools/capture-state.js";

const isIntegration = process.env.ROKU_INTEGRATION_TEST === "1";

describe.skipIf(!isIntegration)("Integration: Screenshot Capture", () => {
  let serverInstance: ReturnType<typeof createRokuDevServer>;
  const helloWorldDir = path.resolve(process.cwd(), "test/fixtures/hello-world");

  beforeAll(async () => {
    const config = await loadConfig();
    serverInstance = createRokuDevServer(config);
    serverInstance.adapters.bsConsole.start();

    // Deploy app to ensure dev channel is active
    await handleBuildAndDeploy(
      {
        source_dir: helloWorldDir,
        action: "Install",
      },
      {
        installer: serverInstance.adapters.installer,
        bsConsole: serverInstance.adapters.bsConsole,
      }
    );
    await new Promise((r) => setTimeout(r, 2000));
  });

  afterAll(async () => {
    try {
      await serverInstance.adapters.installer.deleteApp();
    } catch {
      // Ignore cleanup error
    }
    serverInstance.adapters.bsConsole.stop();
  });

  it("captures full device state including base64 screenshot", async () => {
    const state = await handleCaptureState(
      {
        log_lines: 20,
        include_screenshot: true,
        include_ui_tree: true,
      },
      serverInstance.adapters
    );

    expect(state.captured_at).toBeDefined();
    expect(state.active_app?.id).toBe("dev");
    expect(state.screenshot).not.toBeNull();
    expect(state.screenshot?.base64).toBeDefined();
    expect(state.screenshot!.base64.length).toBeGreaterThan(100);
    expect(state.ui_tree).not.toBeNull();
  });
});
