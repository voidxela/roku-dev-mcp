import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { loadConfig } from "../../src/config.js";
import { createRokuDevServer } from "../../src/server.js";
import { handleBuildAndDeploy } from "../../src/tools/build-and-deploy.js";
import { handleSendKeys } from "../../src/tools/send-keys.js";
import { handleGetUiTree } from "../../src/tools/get-ui-tree.js";

const isIntegration = process.env.ROKU_INTEGRATION_TEST === "1";

describe.skipIf(!isIntegration)("Integration: Keypress & SG Nodes", () => {
  let serverInstance: ReturnType<typeof createRokuDevServer>;
  const helloWorldDir = path.resolve(process.cwd(), "test/fixtures/hello-world");

  beforeAll(async () => {
    const config = await loadConfig();
    serverInstance = createRokuDevServer(config);
    serverInstance.adapters.bsConsole.start();

    // Deploy test app
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

  it("sends sequential navigation keypresses and reads UI tree", async () => {
    // Send remote keys
    const keyResult = await handleSendKeys(
      {
        keys: ["Down", "Right", "Select"],
        delay_ms: 150,
      },
      { ecp: serverInstance.adapters.ecp }
    );

    expect(keyResult.total_keys).toBe(3);
    expect(keyResult.errors).toHaveLength(0);

    // Inspect UI tree from SG debug port 8080
    const treeResult = await handleGetUiTree(
      {
        include_fields: true,
      },
      { sgDebug: serverInstance.adapters.sgDebug }
    );

    expect(treeResult.total_nodes).toBeGreaterThan(0);
    expect(treeResult.tree.length).toBeGreaterThan(0);
  });
});
