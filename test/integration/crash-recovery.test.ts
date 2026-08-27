import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { loadConfig } from "../../src/config.js";
import { createRokuDevServer } from "../../src/server.js";
import { handleBuildAndDeploy } from "../../src/tools/build-and-deploy.js";
import { handleCaptureState } from "../../src/tools/capture-state.js";

const isIntegration = process.env.ROKU_INTEGRATION_TEST === "1";

describe.skipIf(!isIntegration)("Integration: Crash Recovery", () => {
  let serverInstance: ReturnType<typeof createRokuDevServer>;
  const crashingAppDir = path.resolve(
    process.cwd(),
    "test/fixtures/crashing-app"
  );
  const helloWorldDir = path.resolve(
    process.cwd(),
    "test/fixtures/hello-world"
  );

  beforeAll(async () => {
    const config = await loadConfig();
    serverInstance = createRokuDevServer(config);
    serverInstance.adapters.bsConsole.start();
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

  it("deploys crashing app, detects crash with backtrace, then redeploys working app", async () => {
    // 1. Deploy crashing app
    const crashDeploy = await handleBuildAndDeploy(
      {
        source_dir: crashingAppDir,
        action: "Install",
      },
      {
        installer: serverInstance.adapters.installer,
        bsConsole: serverInstance.adapters.bsConsole,
      }
    );

    expect(crashDeploy.success).toBe(true);
    expect(crashDeploy.crash_detected).toBe(true);

    // 2. Capture state and examine crash details
    const state = await handleCaptureState(
      {
        log_lines: 50,
        include_screenshot: false,
        include_ui_tree: false,
      },
      serverInstance.adapters
    );

    expect(state.crash_detected).toBe(true);
    expect(state.crash_details).not.toBeNull();
    expect(state.crash_details?.trigger_line).toContain("BRIGHTSCRIPT: ERROR:");

    // 3. Redeploy working Hello World app to recover
    const recoverDeploy = await handleBuildAndDeploy(
      {
        source_dir: helloWorldDir,
        action: "Install",
      },
      {
        installer: serverInstance.adapters.installer,
        bsConsole: serverInstance.adapters.bsConsole,
      }
    );

    expect(recoverDeploy.success).toBe(true);
    expect(recoverDeploy.crash_detected).toBe(false);
  });
});
