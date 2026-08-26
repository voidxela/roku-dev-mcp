import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createRokuError, ErrorCode } from "../types/errors.js";

const DEFAULT_EXCLUDES = [
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  ".env",
  "*.log",
  "out",
  "out/**",
  ".roku-deploy-staging",
  ".roku-deploy-staging/**",
  "*.zip",
  ".DS_Store",
  "Thumbs.db",
];

export interface ZipResult {
  buffer: Buffer;
  sizeBytes: number;
}

function matchGlobPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Direct match or exact file name match
  if (normalizedPath === normalizedPattern || path.basename(normalizedPath) === normalizedPattern) {
    return true;
  }

  // Directory prefix match (e.g. .git or node_modules)
  if (normalizedPath.startsWith(normalizedPattern.replace(/\/\*\*$/, "") + "/")) {
    return true;
  }

  // Wildcard match (e.g. *.log, *.zip)
  if (normalizedPattern.startsWith("*.")) {
    const ext = normalizedPattern.slice(1);
    if (normalizedPath.endsWith(ext)) {
      return true;
    }
  }

  return false;
}

export function shouldExclude(
  relativePath: string,
  excludePatterns: string[] = []
): boolean {
  const allPatterns = [...DEFAULT_EXCLUDES, ...excludePatterns];
  return allPatterns.some((pattern) => matchGlobPattern(relativePath, pattern));
}

export async function zipRokuProject(
  sourceDir: string,
  customExcludes: string[] = []
): Promise<ZipResult> {
  const absoluteSourceDir = path.resolve(sourceDir);

  if (!fs.existsSync(absoluteSourceDir)) {
    throw createRokuError(
      ErrorCode.MANIFEST_NOT_FOUND,
      `Source directory does not exist: ${absoluteSourceDir}`
    );
  }

  const stat = fs.statSync(absoluteSourceDir);
  if (!stat.isDirectory()) {
    throw createRokuError(
      ErrorCode.MANIFEST_NOT_FOUND,
      `Source path is not a directory: ${absoluteSourceDir}`
    );
  }

  const manifestPath = path.join(absoluteSourceDir, "manifest");
  if (!fs.existsSync(manifestPath)) {
    throw createRokuError(
      ErrorCode.MANIFEST_NOT_FOUND,
      `No manifest file at ${manifestPath}`
    );
  }

  return new Promise<ZipResult>((resolve, reject) => {
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve({
        buffer,
        sizeBytes: buffer.length,
      });
    });

    archive.on("error", (err: Error) => {
      reject(
        createRokuError(
          ErrorCode.INSTALL_FAILED,
          `Failed to create zip archive: ${err.message}`
        )
      );
    });

    function addDirectory(currentDir: string, relativeDir: string = "") {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

        if (shouldExclude(relPath, customExcludes)) {
          continue;
        }

        // Check symlinks to avoid directory traversal outside sourceDir
        if (entry.isSymbolicLink()) {
          const realPath = fs.realpathSync(fullPath);
          if (!realPath.startsWith(absoluteSourceDir)) {
            continue; // Skip symlinks pointing outside the project root
          }
          const targetStat = fs.statSync(realPath);
          if (targetStat.isDirectory()) {
            addDirectory(fullPath, relPath);
          } else if (targetStat.isFile()) {
            archive.file(fullPath, { name: relPath });
          }
        } else if (entry.isDirectory()) {
          addDirectory(fullPath, relPath);
        } else if (entry.isFile()) {
          archive.file(fullPath, { name: relPath });
        }
      }
    }

    try {
      addDirectory(absoluteSourceDir);
      archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}
