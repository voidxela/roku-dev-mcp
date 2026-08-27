import { InstallerAdapter } from "../adapters/installer.js";
import { BsConsoleAdapter } from "../adapters/bs-console.js";
import { zipRokuProject } from "../lib/zipper.js";
import { BuildAndDeployInput, BuildAndDeployResult } from "../types/tools.js";

export interface BuildAndDeployContext {
  installer: InstallerAdapter;
  bsConsole: BsConsoleAdapter;
}

export async function handleBuildAndDeploy(
  input: BuildAndDeployInput,
  context: BuildAndDeployContext
): Promise<BuildAndDeployResult> {
  const startTime = Date.now();
  const { source_dir, action = "Install", exclude_patterns = [] } = input;

  // Clear previous crash state before deploying
  context.bsConsole.clearCrash();

  // 1 & 2. Zip project directory
  const { buffer: zipBuffer, sizeBytes } = await zipRokuProject(
    source_dir,
    exclude_patterns
  );

  // 3. Sideload via Installer adapter
  const installResult = await context.installer.installOrReplace(
    zipBuffer,
    action
  );

  // 5. Wait 2 seconds for app initialization
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Snapshot startup logs (up to 50 lines)
  const logs = context.bsConsole.getRecentLogs(50);
  const startupLog = logs.map(
    (l) => `[${l.timestamp}] ${l.text}`
  );

  const crashDetected = context.bsConsole.hasCrash();

  return {
    success: installResult.success,
    message: installResult.message,
    install_time_ms: Date.now() - startTime,
    zip_size_bytes: sizeBytes,
    startup_log: startupLog,
    crash_detected: crashDetected,
  };
}
