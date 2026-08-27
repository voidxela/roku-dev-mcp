import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { loadConfig } from "../../src/config.js";
import { createRokuDevServer } from "../../src/server.js";
import { handleBuildAndDeploy } from "../../src/tools/build-and-deploy.js";

const isIntegration = process.env.ROKU_INTEGRATION_TEST === "1";

describe.skipIf(!isIntegration)("Integration: Deploy", () => {
  let serverInstance: ReturnType<typeof createRokuDevServer>;
  const helloWorldDir = path.resolve(process.cwd(), "test/fixtures/hello-world");

  beforeAll(async () => {
    const config = await loadConfig();
    serverInstance = createRokuDevServer(config);
    serverInstance.adapters.bsConsole.start();
    // Allow initial connection time
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

  it("sideloads hello-world app, captures startup logs, and verifies deployment", async () => {
    const result = await handleBuildAndDeploy(
      {
        source_dir: helloWorldDir,
        action: "Install",
      },
      {
        installer: serverInstance.adapters.installer,
        bsConsole: serverInstance.adapters.bsConsole,
      }
    );

    expect(result.success).toBe(true);
    expect(result.zip_size_bytes).toBeGreaterThan(0);
    expect(result.install_time_ms).toBeGreaterThan(0);
    expect(result.crash_detected).toBe(false);

    // Verify active app via ECP
    const activeApp = await serverInstance.adapters.ecp.getActiveApp();
    expect(activeApp.id).toBe("dev");
  });
});
