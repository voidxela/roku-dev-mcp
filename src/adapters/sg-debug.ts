import net from "net";
import { AsyncMutex } from "../lib/mutex.js";
import { parseSGNodes, ParseSGNodesOptions } from "../parsers/sgnodes-parser.js";
import { createRokuError, ErrorCode } from "../types/errors.js";
import { SGTreeResult } from "../types/roku.js";

export interface SgDebugAdapterConfig {
  deviceIp: string;
  port?: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export class SgDebugAdapter {
  private readonly deviceIp: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly mutex: AsyncMutex;

  constructor(config: SgDebugAdapterConfig) {
    this.deviceIp = config.deviceIp;
    this.port = config.port ?? 8080;
    this.connectTimeoutMs = config.connectTimeoutMs ?? 5000;
    this.commandTimeoutMs = config.commandTimeoutMs ?? 10000;
    this.idleTimeoutMs = config.idleTimeoutMs ?? 2000;
    this.mutex = new AsyncMutex();
  }

  public async executeCommand(command: string): Promise<string> {
    return this.mutex.runExclusive(async () => {
      return new Promise<string>((resolve, reject) => {
        const socket = new net.Socket();
        let receivedData = "";
        let idleTimer: NodeJS.Timeout | undefined;
        let commandTimer: NodeJS.Timeout | undefined;
        let connectTimer: NodeJS.Timeout | undefined;
        let finished = false;

        const cleanup = () => {
          if (finished) return;
          finished = true;

          if (idleTimer) clearTimeout(idleTimer);
          if (commandTimer) clearTimeout(commandTimer);
          if (connectTimer) clearTimeout(connectTimer);

          socket.removeAllListeners();
          try {
            socket.destroy();
          } catch {
            // ignore
          }
        };

        const finishSuccess = () => {
          cleanup();
          resolve(receivedData);
        };

        const finishError = (err: Error) => {
          cleanup();
          reject(err);
        };

        connectTimer = setTimeout(() => {
          finishError(
            createRokuError(
              ErrorCode.DEVICE_UNREACHABLE,
              `Timed out connecting to Roku SceneGraph Debug server at ${this.deviceIp}:8080`
            )
          );
        }, this.connectTimeoutMs);

        commandTimer = setTimeout(() => {
          if (receivedData.trim().length > 0) {
            // If we got partial data and timed out, resolve with what we have
            finishSuccess();
          } else {
            finishError(
              createRokuError(
                ErrorCode.TIMEOUT,
                `SceneGraph Debug command '${command}' timed out after ${this.commandTimeoutMs}ms`
              )
            );
          }
        }, this.commandTimeoutMs);

        socket.on("connect", () => {
          if (connectTimer) clearTimeout(connectTimer);
          socket.write(`${command}\r\n`);

          // Start idle timer after sending command
          idleTimer = setTimeout(finishSuccess, this.idleTimeoutMs);
        });

        socket.on("data", (chunk: Buffer) => {
          receivedData += chunk.toString("utf-8");

          // Reset idle timer on every new chunk received
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(finishSuccess, this.idleTimeoutMs);
        });

        socket.on("error", (err) => {
          finishError(
            createRokuError(
              ErrorCode.DEVICE_UNREACHABLE,
              `Cannot connect to Roku SceneGraph Debug at ${this.deviceIp}:8080: ${err.message}`
            )
          );
        });

        socket.on("close", () => {
          finishSuccess();
        });

        socket.connect(this.port, this.deviceIp);
      });
    }, this.commandTimeoutMs + this.connectTimeoutMs);
  }

  public async getUiTree(options: ParseSGNodesOptions = {}): Promise<SGTreeResult> {
    const cmd = options.filterId ? `sgnodes ${options.filterId}` : "sgnodes all";
    const rawOutput = await this.executeCommand(cmd);

    return parseSGNodes(rawOutput, options);
  }
}
