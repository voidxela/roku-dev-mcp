import fs from "fs";
import { BsConsoleAdapter } from "../adapters/bs-console.js";
import { InstallerAdapter } from "../adapters/installer.js";
import { validateRokuPackage } from "../lib/roku-package.js";
import { DeployInput, DeployResult } from "../types/tools.js";

export interface DeployContext {
  installer: InstallerAdapter;
  bsConsole: BsConsoleAdapter;
  waitForStartup?: () => Promise<void>;
}

export async function handleDeploy(input: DeployInput, context: DeployContext): Promise<DeployResult> {
  const startedAt = Date.now();
  const packageInfo = validateRokuPackage(input.package_path);
  context.bsConsole.clearCrash();
  const installation = await context.installer.installOrReplace(
    fs.readFileSync(packageInfo.packagePath), input.action ?? "Install"
  );
  await (context.waitForStartup ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 2000))))();
  const startup_log = context.bsConsole.getRecentLogs(50).map((entry) => `[${entry.timestamp}] ${entry.text}`);
  return {
    success: installation.success,
    message: installation.message,
    install_time_ms: Date.now() - startedAt,
    zip_size_bytes: packageInfo.sizeBytes,
    package_path: packageInfo.packagePath,
    startup_log,
    crash_detected: context.bsConsole.hasCrash(),
  };
}
