import {
  ActiveApp,
  DeviceInfo,
  InstalledApp,
  isValidECPKey,
  MediaPlayerInfo,
} from "../types/roku.js";
import {
  parseActiveAppXml,
  parseAppsXml,
  parseDeviceInfoXml,
  parseMediaPlayerXml,
} from "../parsers/ecp-xml-parser.js";
import { createRokuError, ErrorCode } from "../types/errors.js";
import { LaunchResult, SendKeysResult } from "../types/tools.js";

export interface EcpAdapterConfig {
  deviceIp: string;
  port?: number;
  defaultKeyDelayMs?: number;
  timeoutMs?: number;
}

export class EcpAdapter {
  private readonly deviceIp: string;
  private readonly port: number;
  private readonly defaultKeyDelayMs: number;
  private readonly timeoutMs: number;

  constructor(config: EcpAdapterConfig) {
    this.deviceIp = config.deviceIp;
    this.port = config.port ?? 8060;
    this.defaultKeyDelayMs = config.defaultKeyDelayMs ?? 100;
    this.timeoutMs = config.timeoutMs ?? 15000;
  }

  private get baseUrl(): string {
    if (this.deviceIp.includes(":")) {
      return `http://${this.deviceIp}`;
    }
    return `http://${this.deviceIp}:${this.port}`;
  }

  private async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

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
          `ECP request to ${path} timed out after ${this.timeoutMs}ms`
        );
      }
      throw createRokuError(
        ErrorCode.DEVICE_UNREACHABLE,
        `Cannot connect to Roku ECP at ${this.deviceIp}:8060: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  public async sendKey(key: string): Promise<void> {
    if (!isValidECPKey(key)) {
      throw createRokuError(
        ErrorCode.INVALID_KEY,
        `Invalid or unsupported ECP key name: '${key}'`
      );
    }

    const response = await this.request(`/keypress/${encodeURIComponent(key)}`, {
      method: "POST",
      body: "",
    });

    if (!response.ok) {
      throw createRokuError(
        ErrorCode.DEVICE_UNREACHABLE,
        `ECP keypress '${key}' failed with status HTTP ${response.status}`
      );
    }
  }

  public async sendKeys(
    keys: string[],
    delayMs?: number
  ): Promise<SendKeysResult> {
    const delay = delayMs !== undefined ? delayMs : this.defaultKeyDelayMs;
    const startTime = Date.now();
    const sent: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        await this.sendKey(key);
        sent.push(key);
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
  }

  public async launch(
    appId: string = "dev",
    options?: {
      contentId?: string;
      mediaType?: string;
      params?: Record<string, string>;
    }
  ): Promise<LaunchResult> {
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
