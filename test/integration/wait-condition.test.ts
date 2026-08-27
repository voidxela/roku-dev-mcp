import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { loadConfig } from "../../src/config.js";
import { createRokuDevServer } from "../../src/server.js";
import { handleBuildAndDeploy } from "../../src/tools/build-and-deploy.js";
import { handleWaitForCondition } from "../../src/tools/wait-for-condition.js";

const isIntegration = process.env.ROKU_INTEGRATION_TEST === "1";

describe.skipIf(!isIntegration)("Integration: Wait For Condition", () => {
  let serverInstance: ReturnType<typeof createRokuDevServer>;
  const helloWorldDir = path.resolve(process.cwd(), "test/fixtures/hello-world");

  beforeAll(async () => {
    const config = await loadConfig();
    serverInstance = createRokuDevServer(config);
    serverInstance.adapters.bsConsole.start();

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

  it("waits for app_active: dev condition", async () => {
    const res = await handleWaitForCondition(
      {
        condition: "app_active: dev",
        timeout_seconds: 15,
        poll_interval_ms: 500,
      },
      serverInstance.adapters
    );

    expect(res.satisfied).toBe(true);
    expect(res.timeout).toBe(false);
  });

  it("waits for node_exists: mainLayout condition", async () => {
    const res = await handleWaitForCondition(
      {
        condition: "node_exists: mainLayout",
        timeout_seconds: 15,
        poll_interval_ms: 500,
      },
      serverInstance.adapters
    );

    expect(res.satisfied).toBe(true);
    expect(res.timeout).toBe(false);
  });

  it("waits for log_contains pattern in real logs", async () => {
    const res = await handleWaitForCondition(
      {
        condition: "log_contains: Hello World",
        timeout_seconds: 10,
        poll_interval_ms: 500,
      },
      serverInstance.adapters
    );

    expect(res.satisfied).toBe(true);
    expect(res.timeout).toBe(false);
  });
});
