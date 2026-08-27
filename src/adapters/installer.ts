import { digestFetch } from "../lib/digest-auth.js";
import { createRokuError, ErrorCode } from "../types/errors.js";
import { ScreenshotData } from "../types/tools.js";

export interface InstallerAdapterConfig {
  deviceIp: string;
  port?: number;
  devPassword?: string;
  timeoutMs?: number;
}

export class InstallerAdapter {
  private readonly deviceIp: string;
  private readonly port: number;
  private readonly devPassword?: string;
  private readonly timeoutMs: number;

  constructor(config: InstallerAdapterConfig) {
    this.deviceIp = config.deviceIp;
    this.port = config.port ?? 80;
    this.devPassword = config.devPassword;
    this.timeoutMs = config.timeoutMs || 15000;
  }

  private get baseUrl(): string {
    if (this.deviceIp.includes(":")) {
      return `http://${this.deviceIp}`;
    }
    return `http://${this.deviceIp}:${this.port}`;
  }

  private get authPassword(): string {
    return this.devPassword || "";
  }

  public async installOrReplace(
    zipBuffer: Buffer,
    action: "Install" | "Replace" = "Install"
  ): Promise<{ success: boolean; message: string }> {
    const url = `${this.baseUrl}/plugin_install`;

    // Construct multipart form-data
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const headerPart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="mysubmit"\r\n\r\n` +
      `${action}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="archive"; filename="app.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`;
    const footerPart = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(headerPart, "utf-8"),
      zipBuffer,
      Buffer.from(footerPart, "utf-8"),
    ]);

    const response = await digestFetch(url, {
      method: "POST",
      username: "rokudev",
      password: this.authPassword,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      timeoutMs: this.timeoutMs,
    });

    const html = await response.text();

    // Check for success indicators
    const isSuccess =
      html.includes("Application Received") ||
      html.includes("Install Success") ||
      html.includes("Identical to previous version") ||
      html.includes("Plugin replaced");

    if (isSuccess) {
      return {
        success: true,
        message: `Application ${action.toLowerCase()}ed successfully`,
      };
    }

    // Parse failure reason from HTML
    let errorMessage = "Installation failed on Roku device";
    const fontErrorMatch = html.match(/<font color="red">([^<]+)<\/font>/i);
    if (fontErrorMatch) {
      errorMessage = fontErrorMatch[1].trim();
    } else {
      const errorMatch = html.match(/class="error">([^<]+)</i);
      if (errorMatch) {
        errorMessage = errorMatch[1].trim();
      }
    }

    throw createRokuError(ErrorCode.INSTALL_FAILED, errorMessage, {
      html_snippet: html.slice(0, 300),
    });
  }

  public async deleteApp(): Promise<{ success: boolean; message: string }> {
    const url = `${this.baseUrl}/plugin_install`;
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="mysubmit"\r\n\r\n` +
      `Delete\r\n` +
      `--${boundary}--\r\n`;

    const response = await digestFetch(url, {
      method: "POST",
      username: "rokudev",
      password: this.authPassword,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.from(body, "utf-8"),
      timeoutMs: this.timeoutMs,
    });

    const html = await response.text();
    const isSuccess =
      html.includes("Delete Success") ||
      html.includes("Application Deleted") ||
      html.includes("No application installed");

    if (!isSuccess && response.status >= 400) {
      throw createRokuError(
        ErrorCode.INSTALL_FAILED,
        "Failed to delete sideloaded application"
      );
    }

    return {
      success: true,
      message: "Sideloaded application deleted successfully",
    };
  }

  public async captureScreenshot(): Promise<ScreenshotData> {
    const inspectUrl = `${this.baseUrl}/plugin_inspect`;

    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="mysubmit"\r\n\r\n` +
      `Screenshot\r\n` +
      `--${boundary}--\r\n`;

    const inspectResponse = await digestFetch(inspectUrl, {
      method: "POST",
      username: "rokudev",
      password: this.authPassword,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.from(body, "utf-8"),
      timeoutMs: this.timeoutMs,
    });

    const html = await inspectResponse.text();

    // Extract image path from HTML response (e.g. <img src="pkgs/dev.jpg?..." /> or /pkgs/dev.jpg)
    const imgMatch = html.match(/<img[^>]+src=["']?([^"'>\s]+)["']?/i);
    let imgPath = imgMatch ? imgMatch[1] : "/pkgs/dev.jpg";

    if (!imgPath.startsWith("/")) {
      imgPath = `/${imgPath}`;
    }

    // Fetch the screenshot binary
    const imgUrl = `${this.baseUrl}${imgPath}`;
    const imgResponse = await digestFetch(imgUrl, {
      method: "GET",
      username: "rokudev",
      password: this.authPassword,
      timeoutMs: 10000,
    });

    if (!imgResponse.ok) {
      throw createRokuError(
        ErrorCode.NO_SIDELOADED_APP,
        `Could not retrieve screenshot from ${imgPath}: HTTP ${imgResponse.status}`
      );
    }

    const arrayBuffer = await imgResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");
    const format = imgPath.endsWith(".png") ? "png" : "jpeg";

    return {
      format,
      width: 1920,
      height: 1080,
      base64,
    };
  }
}
