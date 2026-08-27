import net from "net";
import { RingBuffer } from "../lib/ring-buffer.js";
import {
  extractCrashEvent,
  isCrashLine,
} from "../parsers/crash-detector.js";
import { CrashEvent, LogEntry } from "../types/roku.js";
import { createRokuError, ErrorCode } from "../types/errors.js";

export interface BsConsoleAdapterConfig {
  deviceIp: string;
  port?: number;
  bufferSize?: number;
  connectTimeoutMs?: number;
}

export class BsConsoleAdapter {
  private readonly deviceIp: string;
  private readonly port: number;
  private readonly bufferSize: number;
  private readonly connectTimeoutMs: number;
  private readonly ringBuffer: RingBuffer;

  private socket: net.Socket | null = null;
  private isRunning: boolean = false;
  private isConnecting: boolean = false;
  private connected: boolean = false;
  private reconnectTimer?: NodeJS.Timeout;
  private lineBuffer: string = "";

  private lastCrash: CrashEvent | null = null;
  private hasUnacknowledgedCrash: boolean = false;

  constructor(config: BsConsoleAdapterConfig) {
    this.deviceIp = config.deviceIp;
    this.port = config.port ?? 8085;
    this.bufferSize = config.bufferSize ?? 500;
    this.connectTimeoutMs = config.connectTimeoutMs ?? 5000;
    this.ringBuffer = new RingBuffer(this.bufferSize);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.connected = false;
    this.isConnecting = false;
  }

  private connect(): void {
    if (!this.isRunning || this.isConnecting || this.connected) {
      return;
    }

    this.isConnecting = true;
    const socket = new net.Socket();
    this.socket = socket;

    let connectTimeoutTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      socket.destroy();
      this.handleDisconnect(false);
    }, this.connectTimeoutMs);

    socket.on("connect", () => {
      if (connectTimeoutTimer) {
        clearTimeout(connectTimeoutTimer);
        connectTimeoutTimer = undefined;
      }
      this.isConnecting = false;
      const wasDisconnected = !this.connected;
      this.connected = true;

      if (wasDisconnected) {
        this.ringBuffer.push(
          "[SYSTEM] BrightScript debug connection re-established."
        );
      }
    });

    socket.on("data", (chunk: Buffer) => {
      this.handleData(chunk.toString("utf-8"));
    });

    socket.on("error", () => {
      // Handled in close / error
    });

    socket.on("close", () => {
      if (connectTimeoutTimer) {
        clearTimeout(connectTimeoutTimer);
        connectTimeoutTimer = undefined;
      }
      this.handleDisconnect(this.connected);
    });

    socket.connect(this.port, this.deviceIp);
  }

  private handleDisconnect(wasConnected: boolean): void {
    this.connected = false;
    this.isConnecting = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
    }

    if (wasConnected) {
      this.ringBuffer.push(
        "[SYSTEM] BrightScript debug connection lost. Reconnecting..."
      );
    }

    if (this.isRunning && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.connect();
      }, 3000);
    }
  }

  private handleData(data: string): void {
    this.lineBuffer += data;
    const lines = this.lineBuffer.split(/\r?\n/);
    // Keep incomplete trailing line in lineBuffer
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line && line !== "") continue;
      this.processLogLine(line);
    }
  }

  private processLogLine(line: string): void {
    this.ringBuffer.push(line);

    if (isCrashLine(line)) {
      const recentLogs = this.ringBuffer.getAll().map((e) => e.text);
      const crashEvent = extractCrashEvent(recentLogs, recentLogs.length - 1);
      this.lastCrash = crashEvent;
      this.hasUnacknowledgedCrash = true;
    }
  }

  public async sendCommand(command: string, timeoutMs: number = 2000): Promise<string> {
    if (!this.connected || !this.socket) {
      throw createRokuError(
        ErrorCode.CONNECTION_LOST,
        "Cannot send command: BrightScript debug console (port 8085) is not connected"
      );
    }

    return new Promise<string>((resolve, reject) => {
      let output = "";
      const socket = this.socket!;

      const onData = (chunk: Buffer) => {
        output += chunk.toString("utf-8");
      };

      const timer = setTimeout(() => {
        socket.removeListener("data", onData);
        resolve(output);
      }, timeoutMs);

      socket.on("data", onData);

      try {
        socket.write(`${command}\r\n`);
      } catch (err) {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        reject(
          createRokuError(
            ErrorCode.CONNECTION_LOST,
            `Failed to write to debug console: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    });
  }

  public getRecentLogs(count: number): LogEntry[] {
    return this.ringBuffer.getRecent(count);
  }

  public getAllLogs(): LogEntry[] {
    return this.ringBuffer.getAll();
  }

  public getSince(seq: number): LogEntry[] {
    return this.ringBuffer.getSince(seq);
  }

  public getLastCrash(): CrashEvent | null {
    if (!this.lastCrash) {
      return null;
    }
    const allLogs = this.ringBuffer.getAll().map((e) => e.text);
    const triggerIdx = allLogs.findIndex(
      (l) => l === this.lastCrash?.trigger_line || isCrashLine(l)
    );
    if (triggerIdx !== -1) {
      this.lastCrash = extractCrashEvent(
        allLogs,
        triggerIdx,
        this.lastCrash.detected_at
      );
    }
    return this.lastCrash;
  }

  public hasCrash(): boolean {
    return this.hasUnacknowledgedCrash;
  }

  public clearCrash(): void {
    this.hasUnacknowledgedCrash = false;
    this.lastCrash = null;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public get totalBuffered(): number {
    return this.ringBuffer.totalBuffered;
  }

  public get bufferCapacity(): number {
    return this.ringBuffer.bufferCapacity;
  }
}
