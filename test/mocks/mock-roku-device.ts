import http from "http";
import net from "net";
import crypto from "crypto";

export interface MockRokuOptions {
  installerPort?: number;
  ecpPort?: number;
  sgPort?: number;
  bsPort?: number;
  password?: string;
}

export class MockRokuDevice {
  public installerPort: number;
  public ecpPort: number;
  public sgPort: number;
  public bsPort: number;
  public password: string;

  private installerServer?: http.Server;
  private ecpServer?: http.Server;
  private sgServer?: net.Server;
  private bsServer?: net.Server;
  private bsSockets: Set<net.Socket> = new Set();

  public lastKeypress?: string;
  public lastLaunchedApp?: string;
  public activeAppId: string = "dev";
  public activeAppName: string = "MockApp";
  public playerState: string = "play";
  public sgnodesResponse: string = `
SceneGraph Nodes (all):

 Node: Group
   id = "root"
   subtype = "HomeScene"
   - LayoutGroup
     id = "mainLayout"
     - RowList
       id = "homeRowList"
       itemSize = [1728, 400]
       numRows = 5
`;

  constructor(options: MockRokuOptions = {}) {
    this.installerPort = options.installerPort ?? 80;
    this.ecpPort = options.ecpPort ?? 8060;
    this.sgPort = options.sgPort ?? 8080;
    this.bsPort = options.bsPort ?? 8085;
    this.password = options.password ?? "testpass";
  }

  public async start(): Promise<void> {
    await Promise.all([
      this.startInstallerServer(),
      this.startEcpServer(),
      this.startSgServer(),
      this.startBsServer(),
    ]);
  }

  public async stop(): Promise<void> {
    for (const socket of this.bsSockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    this.bsSockets.clear();

    await Promise.all([
      new Promise<void>((r) => (this.installerServer ? this.installerServer.close(() => r()) : r())),
      new Promise<void>((r) => (this.ecpServer ? this.ecpServer.close(() => r()) : r())),
      new Promise<void>((r) => (this.sgServer ? this.sgServer.close(() => r()) : r())),
      new Promise<void>((r) => (this.bsServer ? this.bsServer.close(() => r()) : r())),
    ]);
  }

  public emitBsLog(line: string): void {
    for (const socket of this.bsSockets) {
      try {
        socket.write(`${line}\r\n`);
      } catch {
        // ignore
      }
    }
  }

  public emitCrash(errorMessage: string = "Dot Operator invoked on invalid type"): void {
    this.emitBsLog(
      `BRIGHTSCRIPT: ERROR: Runtime Error (code 244): "${errorMessage}"`
    );
    this.emitBsLog("#0  Function oncontentloaded() As Void");
    this.emitBsLog("   file/line: pkg:/components/HomeScene.brs(42)");
    this.emitBsLog("#1  Function main() As Void");
    this.emitBsLog("   file/line: pkg:/source/main.brs(5)");
  }

  private startInstallerServer(): Promise<void> {
    return new Promise((resolve) => {
      this.installerServer = http.createServer((req, res) => {
        const auth = req.headers["authorization"];
        const realm = "rokudev";
        const nonce = "mocknonce12345";

        if (!auth) {
          res.writeHead(401, {
            "WWW-Authenticate": `Digest realm="${realm}", nonce="${nonce}", qop="auth"`,
          });
          res.end("401 Unauthorized");
          return;
        }

        // Basic verification of Digest Auth
        const url = req.url || "";
        if (req.method === "POST" && url.startsWith("/plugin_install")) {
          let body = Buffer.alloc(0);
          req.on("data", (chunk) => {
            body = Buffer.concat([body, chunk]);
          });
          req.on("end", () => {
            const bodyStr = body.toString("utf-8");
            if (bodyStr.includes("Delete")) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<html><body>Application Deleted</body></html>");
            } else if (bodyStr.includes("fail_app")) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<html><body><font color=\"red\">Install Failure: Compilation error</font></body></html>");
            } else {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<html><body>Install Success. Application Received</body></html>");
            }
          });
        } else if (req.method === "POST" && url.startsWith("/plugin_inspect")) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><img src=\"/pkgs/dev.jpg\" /></body></html>");
        } else if (req.method === "GET" && url.startsWith("/pkgs/dev.jpg")) {
          res.writeHead(200, { "Content-Type": "image/jpeg" });
          // Send 1x1 dummy jpeg buffer
          res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9]));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.installerServer.listen(this.installerPort, () => {
        const addr = this.installerServer!.address() as net.AddressInfo;
        this.installerPort = addr.port;
        resolve();
      });
    });
  }

  private startEcpServer(): Promise<void> {
    return new Promise((resolve) => {
      this.ecpServer = http.createServer((req, res) => {
        const url = req.url || "";

        if (req.method === "POST" && url.startsWith("/keypress/")) {
          const key = decodeURIComponent(url.split("/keypress/")[1]);
          this.lastKeypress = key;
          res.writeHead(200);
          res.end();
        } else if (req.method === "POST" && url.startsWith("/launch/")) {
          const app = url.split("/launch/")[1]?.split("?")[0];
          this.lastLaunchedApp = app;
          this.activeAppId = app;
          res.writeHead(200);
          res.end();
        } else if (url === "/query/active-app") {
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(
            `<active-app><app id="${this.activeAppId}" version="1.0.0">${this.activeAppName}</app></active-app>`
          );
        } else if (url === "/query/device-info") {
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(
            `<device-info><model-name>Roku Ultra</model-name><model-number>4800X</model-number><software-version>14.0.0</software-version><serial-number>X00000ABCD</serial-number></device-info>`
          );
        } else if (url === "/query/apps") {
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(
            `<apps><app id="dev" type="appl" version="1.0.0">MyApp</app></apps>`
          );
        } else if (url === "/query/media-player") {
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(`
<player error="false" state="${this.playerState}">
  <plugin id="dev" name="MyApp"/>
  <format audio="aac_adts" video="mpeg4_15"/>
  <buffering target="0" current="1000" max="1000"/>
  <position>5000 ms</position>
  <duration>100000 ms</duration>
  <is_live>false</is_live>
</player>
`);
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.ecpServer.listen(this.ecpPort, () => {
        const addr = this.ecpServer!.address() as net.AddressInfo;
        this.ecpPort = addr.port;
        resolve();
      });
    });
  }

  private startSgServer(): Promise<void> {
    return new Promise((resolve) => {
      this.sgServer = net.createServer((socket) => {
        socket.on("data", (chunk) => {
          const cmd = chunk.toString("utf-8").trim();
          if (cmd.startsWith("sgnodes")) {
            socket.write(this.sgnodesResponse);
            // End socket after writing
            setTimeout(() => socket.end(), 100);
          }
        });
      });

      this.sgServer.listen(this.sgPort, () => {
        const addr = this.sgServer!.address() as net.AddressInfo;
        this.sgPort = addr.port;
        resolve();
      });
    });
  }

  private startBsServer(): Promise<void> {
    return new Promise((resolve) => {
      this.bsServer = net.createServer((socket) => {
        this.bsSockets.add(socket);

        socket.write("------ Running dev 'MyApp' main ------\r\n");

        socket.on("data", (chunk) => {
          const cmd = chunk.toString("utf-8").trim();
          if (cmd === "bt") {
            socket.write("#0  Function main() As Void\r\n   file/line: pkg:/source/main.brs(5)\r\n");
          }
        });

        socket.on("close", () => {
          this.bsSockets.delete(socket);
        });

        socket.on("error", () => {
          this.bsSockets.delete(socket);
        });
      });

      this.bsServer.listen(this.bsPort, () => {
        const addr = this.bsServer!.address() as net.AddressInfo;
        this.bsPort = addr.port;
        resolve();
      });
    });
  }
}
