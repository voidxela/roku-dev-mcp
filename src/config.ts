import dotenv from "dotenv";
import { discoverFirstRokuDevice } from "./lib/ssdp-discovery.js";
import { createRokuError, ErrorCode } from "./types/errors.js";

// Load .env if present
dotenv.config();

export interface RokuServerConfig {
  devPassword?: string;
  deviceIp: string;
  logBufferSize: number;
  keypressDelayMs: number;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  installerPort?: number;
  ecpPort?: number;
  sgPort?: number;
  bsPort?: number;
}

export interface LoadConfigOptions {
  requirePassword?: boolean;
  discoverIp?: boolean;
}

export async function loadConfig(
  options: LoadConfigOptions = { requirePassword: true, discoverIp: true }
): Promise<RokuServerConfig> {
  const devPassword = process.env.ROKU_DEV_PASSWORD?.trim();

  if (options.requirePassword && !devPassword) {
    console.error("FATAL: ROKU_DEV_PASSWORD environment variable is required.");
    console.error(
      "Set it to the developer password configured on your Roku device."
    );
    throw createRokuError(
      ErrorCode.AUTH_FAILED,
      "ROKU_DEV_PASSWORD environment variable is required."
    );
  }

  let deviceIp = process.env.ROKU_DEVICE_IP?.trim();

  if (!deviceIp && options.discoverIp) {
    console.log("[INFO] ROKU_DEVICE_IP not set. Initiating SSDP discovery...");
    deviceIp = await discoverFirstRokuDevice(5000);
    console.log(`[INFO] Discovered Roku device at IP: ${deviceIp}`);
  }

  const logBufferSize = parseInt(
    process.env.ROKU_LOG_BUFFER_SIZE || "500",
    10
  );
  const keypressDelayMs = parseInt(
    process.env.ROKU_KEYPRESS_DELAY_MS || "100",
    10
  );
  const connectTimeoutMs = parseInt(
    process.env.ROKU_CONNECT_TIMEOUT_MS || "5000",
    10
  );
  const commandTimeoutMs = parseInt(
    process.env.ROKU_COMMAND_TIMEOUT_MS || "10000",
    10
  );

  return {
    devPassword,
    deviceIp: deviceIp || "127.0.0.1",
    logBufferSize: isNaN(logBufferSize) ? 500 : logBufferSize,
    keypressDelayMs: isNaN(keypressDelayMs) ? 100 : keypressDelayMs,
    connectTimeoutMs: isNaN(connectTimeoutMs) ? 5000 : connectTimeoutMs,
    commandTimeoutMs: isNaN(commandTimeoutMs) ? 10000 : commandTimeoutMs,
  };
}
