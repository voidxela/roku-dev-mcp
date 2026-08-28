import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { createRokuError, ErrorCode } from "../types/errors.js";
import { validateRokuPackage } from "../lib/roku-package.js";
import { BuildInput, BuildResult } from "../types/tools.js";

const execFileAsync = promisify(execFile);

export interface BuildContext {
  runBuild?: (projectDir: string, packageManager: "npm" | "pnpm" | "yarn") => Promise<void>;
}

function packageManagerFor(projectDir: string): "npm" | "pnpm" | "yarn" {
  if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  return "npm";
}

async function runProjectBuild(projectDir: string, packageManager: "npm" | "pnpm" | "yarn"): Promise<void> {
  try {
    await execFileAsync(packageManager, ["run", "build"], { cwd: projectDir, timeout: 120_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createRokuError(ErrorCode.INSTALL_FAILED, `Project build failed: ${detail}`);
  }
}

function findPackage(projectDir: string, explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(projectDir, explicitPath);
  }
  const candidates: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) candidates.push(fullPath);
    }
  };
  visit(projectDir);
  if (candidates.length === 1) return candidates[0];
  const found = candidates.map((candidate) => path.relative(projectDir, candidate)).join(", ") || "none";
  throw createRokuError(
    ErrorCode.INSTALL_FAILED,
    `Build did not produce exactly one Roku package. Found: ${found}. Set package_path explicitly.`
  );
}

export async function handleBuild(input: BuildInput, context: BuildContext = {}): Promise<BuildResult> {
  const projectDir = path.resolve(input.project_dir);
  const packageJson = path.join(projectDir, "package.json");
  if (!fs.existsSync(packageJson)) {
    throw createRokuError(ErrorCode.MANIFEST_NOT_FOUND, `No package.json at ${packageJson}`);
  }
  const packageManager = packageManagerFor(projectDir);
  const startedAt = Date.now();
  await (context.runBuild ?? runProjectBuild)(projectDir, packageManager);
  const packageInfo = validateRokuPackage(findPackage(projectDir, input.package_path));
  return {
    package_path: packageInfo.packagePath,
    package_size_bytes: packageInfo.sizeBytes,
    build_time_ms: Date.now() - startedAt,
    package_manager: packageManager,
  };
}
