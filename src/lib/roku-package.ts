import fs from "fs";
import path from "path";
import { createRokuError, ErrorCode } from "../types/errors.js";

/**
 * Lists ZIP entries from its central directory. We only need names here, so a
 * small reader avoids adding an extraction dependency or writing untrusted
 * archive content to disk.
 */
export function listZipEntries(zipPath: string): string[] {
  const buffer = fs.readFileSync(zipPath);
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  if (endOffset < 0 || buffer.readUInt32LE(endOffset) !== endSignature) {
    throw createRokuError(ErrorCode.INSTALL_FAILED, `Invalid ZIP archive: ${zipPath}`);
  }

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries: string[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralSignature) {
      throw createRokuError(ErrorCode.INSTALL_FAILED, `Invalid ZIP central directory: ${zipPath}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) {
      throw createRokuError(ErrorCode.INSTALL_FAILED, `Invalid ZIP entry name: ${zipPath}`);
    }
    entries.push(buffer.subarray(nameStart, nameEnd).toString("utf8"));
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

export function validateRokuPackage(packagePath: string): { packagePath: string; sizeBytes: number } {
  const absolutePath = path.resolve(packagePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    throw createRokuError(ErrorCode.MANIFEST_NOT_FOUND, `Package does not exist: ${absolutePath}`);
  }
  if (!stat.isFile() || path.extname(absolutePath).toLowerCase() !== ".zip") {
    throw createRokuError(ErrorCode.INSTALL_FAILED, `Roku package must be a .zip file: ${absolutePath}`);
  }
  if (!listZipEntries(absolutePath).includes("manifest")) {
    throw createRokuError(
      ErrorCode.MANIFEST_NOT_FOUND,
      `Roku package must contain a manifest file at its root: ${absolutePath}`
    );
  }
  return { packagePath: absolutePath, sizeBytes: stat.size };
}
