import {
  ActiveApp,
  DeviceInfo,
  InstalledApp,
  isValidECPKey,
  MediaPlayerInfo,
  normalizeECPKey,
} from "../types/roku.js";
import {
  parseActiveAppXml,
  parseAppsXml,
  parseDeviceInfoXml,
  parseMediaPlayerXml,
} from "../parsers/ecp-xml-parser.js";
import { createRokuError, ErrorCode, RokuDevError } from "../types/errors.js";
import { LaunchResult, SendKeysResult } from "../types/tools.js";
import { AsyncMutex } from "../lib/mutex.js";

export interface EcpAdapterConfig {
  deviceIp: string;
  port?: number;
  defaultKeyDelayMs?: number;
  timeoutMs?: number;
  keypressTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class EcpAdapter {
  private readonly deviceIp: string;
  private readonly port: number;
  private readonly defaultKeyDelayMs: number;
  private readonly timeoutMs: number;
  private readonly keypressTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly mutex = new AsyncMutex();

  constructor(config: EcpAdapterConfig) {
    this.deviceIp = config.deviceIp;
    this.port = config.port ?? 8060;
    this.defaultKeyDelayMs = config.defaultKeyDelayMs ?? 100;
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.keypressTimeoutMs = config.keypressTimeoutMs ?? 3000;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelayMs = config.retryDelayMs ?? 50;
  }

  private get baseUrl(): string {
    if (this.deviceIp.includes(":")) {
      return `http://${this.deviceIp}`;
    }
    return `http://${this.deviceIp}:${this.port}`;
  }

  private async executeWithRetry<T>(
    fn: (attempt: number) => Promise<T>,
    options: {
      maxRetries?: number;
      retryDelayMs?: number;
      operationName?: string;
    } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const retryDelay = options.retryDelayMs ?? this.retryDelayMs;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err: unknown) {
        lastError = err;
        // Do not retry fatal client errors (e.g. invalid key)
        if (err instanceof RokuDevError && err.code === ErrorCode.INVALID_KEY) {
          throw err;
        }
        if (attempt < maxRetries) {
          const delay = retryDelay * (attempt + 1);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  private async request(
    path: string,
    options: RequestInit = {},
    customTimeoutMs?: number
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const timeout = customTimeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") {
        throw createRokuError(
          ErrorCode.TIMEOUT,
          `ECP request to ${path} timed out after ${timeout}ms`
        );
      }
      throw createRokuError(
        ErrorCode.DEVICE_UNREACHABLE,
        `Cannot connect to Roku ECP at ${this.deviceIp}:${this.port}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendKeyInternal(
    key: string,
    action: "keypress" | "keydown" | "keyup" = "keypress"
  ): Promise<string[]> {
    const normalized = normalizeECPKey(key);
    if (!normalized) {
      throw createRokuError(
        ErrorCode.INVALID_KEY,
        `Invalid or unsupported ECP key name: '${key}'`
      );
    }

    const paths: { path: string; keyName: string }[] = [];
    if (normalized.startsWith("Lit_")) {
      const rawSuffix = normalized.slice(4);
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawSuffix);
      } catch {
        decoded = rawSuffix;
      }

      if (decoded.length === 0) {
        throw createRokuError(
          ErrorCode.INVALID_KEY,
          `Invalid empty literal key: '${key}'`
        );
      }

      for (const char of decoded) {
        paths.push({
          path: `/${action}/Lit_${encodeURIComponent(char)}`,
          keyName: `Lit_${char}`,
        });
      }
    } else {
      paths.push({
        path: `/${action}/${encodeURIComponent(normalized)}`,
        keyName: normalized,
      });
    }

    const sentKeys: string[] = [];
    for (let i = 0; i < paths.length; i++) {
      const item = paths[i];
      await this.executeWithRetry(
        async () => {
          const response = await this.request(
            item.path,
            {
              method: "POST",
              headers: {
                "Content-Length": "0",
              },
              body: "",
            },
            this.keypressTimeoutMs
          );

          if (!response.ok) {
            if (response.status >= 500) {
              throw createRokuError(
                ErrorCode.DEVICE_UNREACHABLE,
                `ECP ${action} '${item.keyName}' failed with server status HTTP ${response.status}`
              );
            }
            throw createRokuError(
              ErrorCode.DEVICE_UNREACHABLE,
              `ECP ${action} '${item.keyName}' failed with status HTTP ${response.status}`
            );
          }
        },
        {
          operationName: `${action} ${item.keyName}`,
        }
      );
      sentKeys.push(item.keyName);

      if (i < paths.length - 1 && this.defaultKeyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.defaultKeyDelayMs));
      }
    }

    return sentKeys;
  }

  public async sendKey(key: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await this.sendKeyInternal(key, "keypress");
    });
  }

  public async keyDown(key: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await this.sendKeyInternal(key, "keydown");
    });
  }

  public async keyUp(key: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await this.sendKeyInternal(key, "keyup");
    });
  }

  public async sendKeys(
    keys: string[],
    delayMs?: number
  ): Promise<SendKeysResult> {
    return this.mutex.runExclusive(async () => {
      const delay = delayMs !== undefined ? delayMs : this.defaultKeyDelayMs;
      const startTime = Date.now();
      const sent: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        try {
          const sentItems = await this.sendKeyInternal(key, "keypress");
          sent.push(...sentItems);
        } catch (err) {
          errors.push(
            `Failed on key '${key}' at index ${i}: ${err instanceof Error ? err.message : String(err)}`
          );
          break; // Stop on first error as per spec
        }

        if (i < keys.length - 1 && delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      return {
        keys_sent: sent,
        total_keys: sent.length,
        delay_ms: delay,
        elapsed_ms: Date.now() - startTime,
        errors,
      };
    });
  }

  public async sendText(
    text: string,
    delayMs?: number
  ): Promise<SendKeysResult> {
    if (!text) {
      return {
        keys_sent: [],
        total_keys: 0,
        delay_ms: delayMs ?? this.defaultKeyDelayMs,
        elapsed_ms: 0,
        errors: [],
      };
    }
    const keys = Array.from(text).map((char) => `Lit_${char}`);
    return this.sendKeys(keys, delayMs);
  }

  public async launch(
    appId: string = "dev",
    options?: {
      contentId?: string;
      mediaType?: string;
      params?: Record<string, string>;
    }
  ): Promise<LaunchResult> {
    return this.mutex.runExclusive(async () => {
      const startTime = Date.now();
      const queryParams = new URLSearchParams();

      if (options?.contentId) {
        queryParams.set("contentId", options.contentId);
      }
      if (options?.mediaType) {
        queryParams.set("mediaType", options.mediaType);
      }
      if (options?.params) {
        for (const [key, value] of Object.entries(options.params)) {
          queryParams.set(key, value);
        }
      }

      const qs = queryParams.toString();
      const path = `/launch/${encodeURIComponent(appId)}${qs ? `?${qs}` : ""}`;

      const response = await this.request(path, {
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
        body: "",
      });

      if (!response.ok) {
        throw createRokuError(
          ErrorCode.DEVICE_UNREACHABLE,
          `Failed to launch app '${appId}': HTTP ${response.status}`
        );
      }

      // Wait 1 second for app to begin launching
      await new Promise((r) => setTimeout(r, 1000));

      let activeConfirmed = false;
      try {
        const activeApp = await this.getActiveApp();
        activeConfirmed = activeApp.id === appId;
      } catch {
        // Non-fatal if active app query fails during startup
      }

      return {
        launched: true,
        app_id: appId,
        content_id: options?.contentId,
        media_type: options?.mediaType,
        active_app_confirmed: activeConfirmed,
        elapsed_ms: Date.now() - startTime,
      };
    });
  }

  public async getActiveApp(): Promise<ActiveApp> {
    const response = await this.request("/query/active-app");
    const xml = await response.text();
    return parseActiveAppXml(xml);
  }

  public async getDeviceInfo(): Promise<DeviceInfo> {
    const response = await this.request("/query/device-info");
    const xml = await response.text();
    return parseDeviceInfoXml(xml);
  }

  public async getInstalledApps(): Promise<InstalledApp[]> {
    const response = await this.request("/query/apps");
    const xml = await response.text();
    return parseAppsXml(xml);
  }

  public async getMediaPlayer(): Promise<MediaPlayerInfo> {
    const response = await this.request("/query/media-player");
    const xml = await response.text();
    return parseMediaPlayerXml(xml);
  }
}

