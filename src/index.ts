import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createRokuDevServer } from "./server.js";

async function main() {
  try {
    const config = await loadConfig();

    const { server, adapters } = createRokuDevServer(config);

    // Startup health check via ECP on Port 8060
    try {
      const deviceInfo = await adapters.ecp.getDeviceInfo();
      console.error(
        `[INFO] Connected to Roku device: ${deviceInfo.model_name || "Unknown"} (${deviceInfo.model_number || "N/A"}), OS: ${deviceInfo.software_version || "N/A"}, Serial: ${deviceInfo.serial_number || "N/A"}`
      );
    } catch (err) {
      console.error(
        `[WARN] Could not reach Roku ECP on startup: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Start background BrightScript console log capture on Port 8085
    adapters.bsConsole.start();
    console.error("[INFO] BrightScript console logger initialized.");

    // Connect to MCP stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[INFO] Roku Development MCP Server running on stdio transport.");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.error("[INFO] Shutting down Roku Development MCP Server...");
      adapters.bsConsole.stop();
      await server.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error(`[FATAL] Server initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
