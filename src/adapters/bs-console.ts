import net from "net";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
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
  private brokerServer: net.Server | null = null;
  private brokerSocket: net.Socket | null = null;
  private readonly brokerPath: string;
  private isBrokerHost: boolean = false;
  private brokerClients = new Set<net.Socket>();
  private brokerLineBuffers = new Map<net.Socket, string>();
  private brokerBuffer: string = "";
  private pendingBrokerCommands = new Map<string, { resolve: (output: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
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
    const identity = crypto
      .createHash("sha256")
      .update(`${this.deviceIp}:${this.port}`)
      .digest("hex")
      .slice(0, 16);
    const runtimeDir = path.join(os.tmpdir(), `roku-dev-mcp-${process.getuid?.() ?? "user"}`);
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    this.brokerPath = process.platform === "win32"
      ? `\\\\.\\pipe\\roku-dev-mcp-${identity}`
      : path.join(runtimeDir, `console-${identity}.sock`);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startBroker();
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
    if (this.brokerSocket) {
      this.brokerSocket.removeAllListeners();
      this.brokerSocket.destroy();
      this.brokerSocket = null;
    }
    for (const client of this.brokerClients) {
      client.destroy();
    }
    this.brokerClients.clear();
    this.brokerLineBuffers.clear();
    for (const pending of this.pendingBrokerCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("BrightScript console broker stopped"));
    }
    this.pendingBrokerCommands.clear();
    if (this.brokerServer) {
      this.brokerServer.close();
      this.brokerServer = null;
    }
    this.isBrokerHost = false;
    this.connected = false;
    this.isConnecting = false;
  }

  /**
   * Roku permits only one BrightScript debugger connection. MCP stdio servers
   * are commonly started once per coding-agent session, so coordinate those
   * processes with a local Unix socket: one owns Roku port 8085 and broadcasts
   * its log stream to the rest.
   */
  private startBroker(): void {
    if (!this.isRunning || this.brokerServer || this.brokerSocket) return;

    const server = net.createServer((client) => this.acceptBrokerClient(client));
    this.brokerServer = server;
    server.once("error", (error: NodeJS.ErrnoException) => {
      this.brokerServer = null;
      if (error.code === "EADDRINUSE") {
        this.connectToBroker();
      } else {
        this.scheduleBrokerRetry();
      }
    });
    server.listen(this.brokerPath, () => {
      this.isBrokerHost = true;
      // Restrict the local IPC endpoint to the current user on Unix systems.
      if (process.platform !== "win32") fs.chmodSync(this.brokerPath, 0o600);
      this.connect();
    });
  }

  private connectToBroker(): void {
    if (!this.isRunning || this.brokerSocket) return;
    const socket = net.createConnection(this.brokerPath);
    this.brokerSocket = socket;
    socket.on("connect", () => {
      this.connected = true;
      socket.write(`${JSON.stringify({ type: "subscribe" })}\n`);
    });
    socket.on("data", (chunk: Buffer) => this.handleBrokerData(chunk.toString("utf-8")));
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" && process.platform !== "win32") {
        try { fs.unlinkSync(this.brokerPath); } catch { /* another process may have recovered it */ }
      }
    });
    socket.on("close", () => {
      if (this.brokerSocket !== socket) return;
      this.brokerSocket = null;
      this.connected = false;
      this.scheduleBrokerRetry();
    });
  }

  private scheduleBrokerRetry(): void {
    if (!this.isRunning || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startBroker();
    }, 3000);
  }

  private acceptBrokerClient(client: net.Socket): void {
    this.brokerClients.add(client);
    this.brokerLineBuffers.set(client, "");
    client.write(`${JSON.stringify({ type: "snapshot", lines: this.ringBuffer.getAll().map((entry) => entry.text) })}\n`);
    client.on("data", (chunk: Buffer) => this.handleBrokerClientData(client, chunk.toString("utf-8")));
    client.on("close", () => {
      this.brokerClients.delete(client);
      this.brokerLineBuffers.delete(client);
    });
    client.on("error", () => undefined);
  }

  private handleBrokerClientData(client: net.Socket, data: string): void {
    const messages = `${this.brokerLineBuffers.get(client) ?? ""}${data}`.split("\n");
    this.brokerLineBuffers.set(client, messages.pop() ?? "");
    for (const message of messages) {
      if (!message) continue;
      try {
        const parsed = JSON.parse(message) as { type: string; id?: string; command?: string; timeoutMs?: number };
        if (parsed.type === "command" && parsed.id && parsed.command) {
          this.sendCommand(parsed.command, parsed.timeoutMs).then(
            (output) => client.write(`${JSON.stringify({ type: "command_result", id: parsed.id, output })}\n`),
            (error) => client.write(`${JSON.stringify({ type: "command_error", id: parsed.id, message: error.message })}\n`)
          );
        }
      } catch {
        // Ignore malformed messages from a local broker client.
      }
    }
  }

  private handleBrokerData(data: string): void {
    this.brokerBuffer += data;
    const messages = this.brokerBuffer.split("\n");
    this.brokerBuffer = messages.pop() ?? "";
    for (const message of messages) {
      if (!message) continue;
      try {
        const parsed = JSON.parse(message) as { type: string; lines?: string[]; line?: string; id?: string; output?: string; message?: string };
        if (parsed.type === "snapshot" && parsed.lines) {
          for (const line of parsed.lines) this.processLogLine(line);
        } else if (parsed.type === "line" && parsed.line !== undefined) {
          this.processLogLine(parsed.line);
        } else if (parsed.id && (parsed.type === "command_result" || parsed.type === "command_error")) {
          const pending = this.pendingBrokerCommands.get(parsed.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingBrokerCommands.delete(parsed.id);
            if (parsed.type === "command_result") pending.resolve(parsed.output ?? "");
            else pending.reject(new Error(parsed.message ?? "BrightScript console command failed"));
          }
        }
      } catch {
        // A malformed local IPC message must not take down background logging.
      }
    }
  }

  private broadcastLogLine(line: string): void {
    if (!this.isBrokerHost) return;
    const message = `${JSON.stringify({ type: "line", line })}\n`;
    for (const client of this.brokerClients) {
      if (!client.destroyed) client.write(message);
    }
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

    if (this.isRunning && this.isBrokerHost && !this.reconnectTimer) {
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
    this.broadcastLogLine(line);

    if (isCrashLine(line)) {
      const recentLogs = this.ringBuffer.getAll().map((e) => e.text);
      const crashEvent = extractCrashEvent(recentLogs, recentLogs.length - 1);
      this.lastCrash = crashEvent;
      this.hasUnacknowledgedCrash = true;
    }
  }

  public async sendCommand(command: string, timeoutMs: number = 2000): Promise<string> {
    if (!this.isBrokerHost && this.brokerSocket && this.connected) {
      return this.sendBrokerCommand(command, timeoutMs);
    }
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

  private sendBrokerCommand(command: string, timeoutMs: number): Promise<string> {
    const socket = this.brokerSocket;
    if (!socket) return Promise.reject(new Error("BrightScript console broker is not connected"));
    const id = crypto.randomUUID();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBrokerCommands.delete(id);
        reject(new Error("Timed out waiting for BrightScript console broker"));
      }, timeoutMs + 1000);
      this.pendingBrokerCommands.set(id, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ type: "command", id, command, timeoutMs })}\n`);
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
