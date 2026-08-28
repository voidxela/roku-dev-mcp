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
  context.bsConsole.clearCrash();
  const { buffer: zipBuffer, sizeBytes } = await zipRokuProject(source_dir, exclude_patterns);
  const installResult = await context.installer.installOrReplace(zipBuffer, action);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return {
    success: installResult.success,
    message: installResult.message,
    install_time_ms: Date.now() - startTime,
    zip_size_bytes: sizeBytes,
    startup_log: context.bsConsole.getRecentLogs(50).map((l) => `[${l.timestamp}] ${l.text}`),
    crash_detected: context.bsConsole.hasCrash(),
  };
}
