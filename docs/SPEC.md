# Roku Development MCP Server — Design Specification

> **Version:** 1.0.0-draft
> **Status:** Design
> **License:** [Unlicense](../LICENSE)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Architecture](#3-architecture)
4. [Configuration & Environment](#4-configuration--environment)
5. [The Roku Interface Layer](#5-the-roku-interface-layer)
6. [MCP Tool Definitions](#6-mcp-tool-definitions)
7. [Connection Management](#7-connection-management)
8. [Error Taxonomy](#8-error-taxonomy)
9. [The Asynchronous Feedback Loop](#9-the-asynchronous-feedback-loop)
10. [Security Considerations](#10-security-considerations)
11. [Testing Strategy](#11-testing-strategy)
12. [Project Structure](#12-project-structure)
13. [Appendix A — Roku Protocol Quick Reference](#appendix-a--roku-protocol-quick-reference)
14. [Appendix B — Example Agent Workflow](#appendix-b--example-agent-workflow)

---

## 1. Overview

### 1.1 Problem Statement

Roku OS separates deployment, UI control, and telemetry across four distinct network protocols on four different ports. An AI coding agent (such as Antigravity) needs discrete, atomic tool calls that return structured JSON. Without a middleware layer, the agent would need to manage raw Telnet streams, multipart HTTP uploads with Digest Authentication, and ECP REST calls simultaneously — a brittle and error-prone arrangement.

### 1.2 Solution

This MCP server acts as a **middleware controller** that bridges the gap between the agent's structured tool-call interface and Roku's fragmented developer API surface. It translates raw Telnet streams and HTTP endpoints into a Model Context Protocol (MCP) API that the agent can reason about deterministically.

### 1.3 Design Goals

| Goal | Description |
|------|-------------|
| **Atomic operations** | Each tool call is self-contained: it opens connections, performs work, returns structured results, and cleans up. |
| **Deterministic feedback** | Replace hardcoded `sleep()` timers with condition-based polling (`roku_wait_for_condition`). |
| **Multi-modal state** | Combine logs, UI trees, screenshots, and playback state into unified snapshots the agent can reason about. |
| **Crash resilience** | Background log capture ensures BrightScript crashes are never lost, even if the agent isn't actively polling. |
| **Zero-config discovery** | The server auto-discovers Roku devices via SSDP when no explicit IP is provided. |

---

## 2. Prerequisites

### 2.1 Roku Device Setup

Before the MCP server can communicate with a Roku device, the following **must** be configured on the target TV:

1. **Developer Mode enabled.**
   Activate via the remote sequence: `Home ×3 → Up ×2 → Right → Left → Right → Left → Right`. Set a developer password when prompted. This password is the value for `ROKU_DEV_PASSWORD`.

2. **"Control by mobile apps" enabled.**
   Navigate to `Settings → System → Advanced system settings → Control by mobile apps` and select **"Enabled"**. This is **required for ECP keypresses as of Roku OS 14.1**.

3. **Network reachability.**
   The machine running the MCP server must be on the same LAN/subnet as the Roku device. Ports 80, 8060, 8080, and 8085 must not be blocked by a firewall.

### 2.2 Host Machine

- **Node.js** ≥ 20 (LTS)
- **npm** or **pnpm**
- Network access to the Roku device on ports 80, 8060, 8080, 8085

---

## 3. Architecture

### 3.1 High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        MCP Client (Agent)                        │
│                  (Antigravity / Claude / etc.)                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │  MCP Protocol (stdio or Streamable HTTP)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     roku-dev-mcp Server                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Tool Router  │  │  Log Buffer  │  │  Connection Manager    │  │
│  │              │  │  (Ring, 500  │  │                        │  │
│  │  Validates   │  │   lines)     │  │  Manages lifecycle of  │  │
│  │  input,      │  │              │  │  Telnet sockets and    │  │
│  │  dispatches  │  │  Background  │  │  HTTP clients for all  │  │
│  │  to Roku     │  │  capture     │  │  four Roku ports       │  │
│  │  interface   │  │  from 8085   │  │                        │  │
│  │  handlers    │  │              │  │                        │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────────────────┘  │
│         │                 │                  │                    │
│  ┌──────┴─────────────────┴──────────────────┴─────────────────┐ │
│  │                   Roku Interface Adapters                    │ │
│  │                                                              │ │
│  │  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │ │
│  │  │ Port 80     │ │ Port     │ │ Port     │ │ Port 8085   │  │ │
│  │  │ Installer   │ │ 8060 ECP │ │ 8080 SG  │ │ BS Console  │  │ │
│  │  │ (HTTP/      │ │ (HTTP    │ │ Debug    │ │ (Telnet)    │  │ │
│  │  │  Digest)    │ │  REST)   │ │ (Telnet) │ │             │  │ │
│  │  └──────┬──────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘  │ │
│  └─────────┼─────────────┼────────────┼──────────────┼──────────┘ │
└────────────┼─────────────┼────────────┼──────────────┼────────────┘
             │             │            │              │
             ▼             ▼            ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Roku Device (TV)                            │
│                                                                  │
│   :80 Installer   :8060 ECP   :8080 SG Debug   :8085 BS Debug   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Tool Router** | Receives MCP tool calls, validates input schemas (via Zod), dispatches to the appropriate Roku interface adapter, and formats the structured JSON response. |
| **Log Buffer** | A persistent background Telnet connection to port 8085 that continuously captures BrightScript console output into a ring buffer (default: 500 lines). Parses crash signatures in real-time. |
| **Connection Manager** | Manages the lifecycle of all four Roku connections. Handles reconnection logic, timeouts, and connection pooling for Telnet sockets. |
| **Roku Interface Adapters** | Four protocol-specific modules, one per Roku port. Each adapter encapsulates the protocol details (Digest Auth, Telnet line parsing, XML parsing) and exposes a clean async TypeScript API to the Tool Router. |

### 3.3 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| MCP Framework | `@modelcontextprotocol/sdk` v2 | Official MCP SDK for TypeScript. Provides `McpServer`, transport abstractions, and tool registration. |
| Transport | `StdioServerTransport` (default), `StreamableHTTPServerTransport` (optional) | stdio for local agent integration; HTTP for remote/networked setups. |
| Schema Validation | `zod` | Standard Schema support in MCP SDK. Validates all tool inputs before execution. |
| HTTP Client | Built-in `fetch` (Node 20+) with `digest-fetch` wrapper | Digest Auth required for port 80. ECP on port 8060 uses plain HTTP. |
| Telnet | `net.Socket` (Node.js built-in) | Raw TCP sockets for ports 8080 and 8085. No library needed — Roku's Telnet is plain TCP with line-delimited text. |
| XML Parsing | `fast-xml-parser` | Parse ECP XML responses (`/query/media-player`, `/query/active-app`) into JSON. |
| Archiving | `archiver` | Zip BrightScript/SceneGraph source trees for sideloading. |
| Build | `tsup` or `tsc` | Bundle for distribution as a single-file MCP server. |
| Runtime | Node.js ≥ 20 LTS | Required for native `fetch`, stable `AbortController`, and `using` syntax. |

---

## 4. Configuration & Environment

### 4.1 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ROKU_DEV_PASSWORD` | **Yes** | The developer password set during Developer Mode activation. Used for Digest Auth on port 80. **Must not be hardcoded or committed.** |
| `ROKU_DEVICE_IP` | No | IP address of the target Roku device (e.g., `192.168.1.42`). If omitted, the server attempts SSDP discovery on startup. |
| `ROKU_LOG_BUFFER_SIZE` | No | Maximum lines retained in the BrightScript console ring buffer. Default: `500`. |
| `ROKU_KEYPRESS_DELAY_MS` | No | Delay in milliseconds between sequential ECP keypresses. Default: `100`. Increase for slower Roku hardware. |
| `ROKU_CONNECT_TIMEOUT_MS` | No | Timeout in milliseconds for establishing Telnet connections. Default: `5000`. |
| `ROKU_COMMAND_TIMEOUT_MS` | No | Timeout in milliseconds for reading a complete response from a Telnet command. Default: `10000`. |

### 4.2 Startup Validation

On startup, the server **must**:

1. Assert that `ROKU_DEV_PASSWORD` is set and non-empty. If missing, exit with a clear error message:
   ```
   FATAL: ROKU_DEV_PASSWORD environment variable is required.
   Set it to the developer password configured on your Roku device.
   ```

2. Resolve the Roku device IP:
   - If `ROKU_DEVICE_IP` is set, validate it as a well-formed IPv4 address.
   - Otherwise, perform SSDP discovery (multicast `239.255.255.250:1900`, search target `roku:ecp`). If multiple devices are found, use the first responder and log a warning. If none are found within 5 seconds, exit with an error.

3. Perform a connectivity health check:
   - `GET http://{ip}:8060/query/device-info` — validates ECP is reachable and the device is awake.
   - Log the device model, firmware version, and serial number from the response.

4. Establish the background Telnet connection to port 8085 for log buffering.

### 4.3 MCP Server Registration

The server registers itself with the following metadata:

```typescript
const server = new McpServer({
  name: "roku-dev",
  version: "1.0.0",
  description: "Roku development toolkit for AI-assisted BrightScript/SceneGraph development",
});
```

---

## 5. The Roku Interface Layer

The server must maintain persistent or on-demand connections to four distinct Roku interfaces.

### 5.1 Port 80 — Development Application Installer

| Property | Value |
|----------|-------|
| **Protocol** | HTTP with Digest Authentication |
| **Auth Credentials** | Username: `rokudev`, Password: `$ROKU_DEV_PASSWORD` |
| **Purpose** | Application deployment (sideloading) and screenshot capture |

#### 5.1.1 Sideloading (`/plugin_install`)

**Request:**
```http
POST /plugin_install HTTP/1.1
Host: {roku_ip}
Content-Type: multipart/form-data
Authorization: Digest ...

--boundary
Content-Disposition: form-data; name="mysubmit"

Install
--boundary
Content-Disposition: form-data; name="archive"; filename="app.zip"
Content-Type: application/zip

<binary zip data>
--boundary--
```

**Form fields:**

| Field | Value | Description |
|-------|-------|-------------|
| `mysubmit` | `Install` | Installs a new application (replaces any existing sideloaded app). |
| `mysubmit` | `Replace` | Replaces the currently sideloaded application. |
| `mysubmit` | `Delete` | Removes the currently sideloaded application. |
| `archive` | `@path/to/app.zip` | The zipped application package. Only required for `Install` and `Replace`. |

**Response:** HTML page. The server must parse the response body to determine success or failure:
- Success indicators: `"Application Received"`, `"Install Success"` in the HTML body.
- Failure indicators: `"Install Failure"`, `"No pkg found"`, HTTP 401 (auth failure).

**Zip construction rules:**
- The zip must contain the application's directory structure at root level (i.e., `manifest`, `source/`, `components/` must be top-level entries).
- The `manifest` file **must** be present at the zip root.
- Excluded patterns: `.git/`, `node_modules/`, `.env`, `*.log`, `out/`, `.roku-deploy-staging/`.

#### 5.1.2 Screenshot Capture (`/plugin_inspect`)

**Request:**
```http
POST /plugin_inspect HTTP/1.1
Host: {roku_ip}
Authorization: Digest ...
Content-Type: application/x-www-form-urlencoded

mysubmit=Screenshot
```

**Response:** HTML page containing an `<img>` tag referencing the captured screenshot. The server must:
1. Parse the HTML response to extract the screenshot image path (typically `/pkgs/dev.jpg` or `/pkgs/dev.png`).
2. Fetch the image via a second authenticated GET request.
3. Return the image data as a base64-encoded string.

**Limitations:**
- Only works for the currently sideloaded channel.
- Cannot capture protected/DRM video content (returns a black frame).
- The device's UI must be on the sideloaded app's screen.

---

### 5.2 Port 8060 — External Control Protocol (ECP)

| Property | Value |
|----------|-------|
| **Protocol** | HTTP REST (no authentication required) |
| **Purpose** | Remote control keypresses, app launching, device/media state queries |

> **Important:** As of Roku OS 14.1, ECP keypress commands require **"Control by mobile apps"** to be enabled in the device's system settings.

#### 5.2.1 Keypress Commands

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/keypress/{key}` | POST | Press and release a key (empty body) |
| `/keydown/{key}` | POST | Press and hold a key |
| `/keyup/{key}` | POST | Release a held key |

**Supported key names** (case-sensitive):

| Category | Keys |
|----------|------|
| **Navigation** | `Home`, `Up`, `Down`, `Left`, `Right`, `Select`, `Back` |
| **Playback** | `Play`, `Rev`, `Fwd`, `InstantReplay` |
| **Input** | `Info`, `Backspace`, `Search`, `Enter` |
| **Volume (TV only)** | `VolumeUp`, `VolumeDown`, `VolumeMute` |
| **Power (TV only)** | `PowerOff` |
| **TV Input (TV only)** | `ChannelUp`, `ChannelDown`, `InputTuner`, `InputHDMI1`, `InputHDMI2`, `InputHDMI3`, `InputHDMI4`, `InputAV1` |
| **Misc** | `FindRemote` |
| **Literal characters** | `Lit_{char}` (e.g., `Lit_a`, `Lit_B`, `Lit_1`, `Lit_%40` for `@`) — used when a keyboard/text field is active |

#### 5.2.2 App Launch & Deep Linking

```http
POST /launch/{appId}?contentId={id}&mediaType={type} HTTP/1.1
Host: {roku_ip}:8060
```

For sideloaded development channels, `{appId}` is always `dev`.

#### 5.2.3 Query Endpoints

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/query/device-info` | GET | Device model, firmware, serial, network info (XML) |
| `/query/apps` | GET | List of installed channels with IDs (XML) |
| `/query/active-app` | GET | Currently focused app name and ID (XML) |
| `/query/media-player` | GET | Playback state, position, duration, buffering status (XML) |
| `/query/icon/{appId}` | GET | Channel icon (PNG image) |

**`/query/media-player` response structure:**

```xml
<player error="false" state="play">
  <plugin id="dev" name="MyApp" bandwidth="4000000 bps"/>
  <format
    audio="aac_adts" video="mpeg4_15"
    captions="none" drm="none"/>
  <buffering target="0" current="1000" max="1000"/>
  <new_stream speed="128"/>
  <position>12345 ms</position>
  <duration>887999 ms</duration>
  <is_live>false</is_live>
  <runtime>887999 ms</runtime>
  <stream_segment
    media_sequence="0" time="0"
    bitrate="4000000" width="1920" height="1080"/>
</player>
```

The server must parse this XML into a structured JSON object:

```json
{
  "state": "play",
  "error": false,
  "plugin": { "id": "dev", "name": "MyApp" },
  "position_ms": 12345,
  "duration_ms": 887999,
  "is_live": false,
  "buffering": { "target": 0, "current": 1000, "max": 1000 },
  "format": { "audio": "aac_adts", "video": "mpeg4_15", "drm": "none" },
  "stream_segment": { "bitrate": 4000000, "width": 1920, "height": 1080 }
}
```

**Player states:** `play`, `pause`, `buffering`, `stop`, `close`, `none`

---

### 5.3 Port 8080 — SceneGraph Debug Server

| Property | Value |
|----------|-------|
| **Protocol** | Telnet (raw TCP, line-delimited text) |
| **Purpose** | Inspect the live SceneGraph node tree for state assertion |
| **Connection** | On-demand (connect → send command → read response → close) |

#### 5.3.1 Available Commands

| Command | Description |
|---------|-------------|
| `sgnodes all` | Dumps every existing node created by the running channel, with reference counts |
| `sgnodes roots` | Dumps only root nodes (nodes with no parent) |
| `sgnodes {nodeId}` | Dumps details for a specific node by its `id` field |
| `sgversion` | Returns the SceneGraph runtime version |
| `fps_display {0\|1}` | Toggle FPS overlay display |
| `r2d2_bitmaps` | Dump texture memory usage |
| `loaded_textures` | List all currently loaded textures |

#### 5.3.2 Output Format

The output from `sgnodes all` is **plain text** (not XML/JSON), with an indented tree structure. Each line represents a node:

```
SceneGraph Nodes (all):

 Node: Group
   id = ""
   subtype = "HomeScene"
   osref = 2
   bscref = 1
   - LayoutGroup
     id = "mainLayout"
     subtype = "LayoutGroup"
     translation = [0, 0]
     - RowList
       id = "homeRowList"
       subtype = "RowList"
       itemSize = [1728, 400]
       numRows = 5
       - MarkupGrid
         id = "grid_0"
         subtype = "PosterGrid"
         ...
```

**The server must parse this indented text into a structured JSON tree.** The parser must:

1. Track indentation depth to reconstruct parent-child relationships.
2. Extract node type, `id`, `subtype`, and key-value field pairs.
3. Track `osref` and `bscref` counts for memory leak detection.

**Parsed JSON output:**

```json
{
  "total_nodes": 247,
  "tree": [
    {
      "type": "Group",
      "id": "",
      "subtype": "HomeScene",
      "osref": 2,
      "bscref": 1,
      "fields": {},
      "children": [
        {
          "type": "LayoutGroup",
          "id": "mainLayout",
          "subtype": "LayoutGroup",
          "fields": {
            "translation": "[0, 0]"
          },
          "children": [
            {
              "type": "RowList",
              "id": "homeRowList",
              "subtype": "RowList",
              "fields": {
                "itemSize": "[1728, 400]",
                "numRows": "5"
              },
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

#### 5.3.3 Connection Handling

- Port 8080 is **not** a persistent connection. The server should connect, send the command, read until the output terminates (detected by a configurable idle timeout of 2 seconds with no new data), then disconnect.
- Large node trees can produce output exceeding 100KB. The socket read must buffer until complete.
- If the port is unreachable (no sideloaded app running), the tool must return a clear error rather than hanging.

---

### 5.4 Port 8085 — BrightScript Debug Console

| Property | Value |
|----------|-------|
| **Protocol** | Telnet (raw TCP, line-delimited text) |
| **Purpose** | Runtime logging, crash capture, interactive debugging |
| **Connection** | **Persistent** — background connection maintained for the lifetime of the MCP server |

#### 5.4.1 Log Buffering

The server must maintain a **persistent background Telnet connection** to port 8085 that:

1. Continuously reads all output into a **ring buffer** (default 500 lines, configurable via `ROKU_LOG_BUFFER_SIZE`).
2. Assigns monotonically increasing sequence numbers to each line for cursor-based retrieval.
3. Timestamps each line with ISO 8601 timestamps at ingestion time.
4. Runs a **crash detector** regex against incoming lines that flags crash events.

#### 5.4.2 Crash Signature Detection

The server must recognize BrightScript crash patterns in real-time. When a crash is detected, it must flag the crash event and capture the surrounding context.

**Crash signature patterns:**

```
BRIGHTSCRIPT: ERROR: ...
```

```
Runtime Error (code ###) in ...
```

The crash detector regex:

```regex
/^(BRIGHTSCRIPT:\s*ERROR:|.*Runtime Error\s*\(code\s*\d+\)|.*ERR_.*STOP)/i
```

When a crash is detected, the server stores a crash event:

```json
{
  "detected_at": "2026-08-26T19:30:00.000Z",
  "trigger_line": "BRIGHTSCRIPT: ERROR: Runtime Error (code 244): \"Dot Operator invoked on invalid type\"",
  "context_lines": ["<50 lines before and after the trigger>"],
  "backtrace": [
    {
      "function": "onContentLoaded()",
      "file": "pkg:/components/HomeScene.brs",
      "line": 42
    }
  ]
}
```

#### 5.4.3 Debug Console Commands

These commands are available when the BrightScript debugger is in a paused state (after a `STOP` statement, crash, or `Ctrl+C`):

| Command | Alias | Description |
|---------|-------|-------------|
| `bt` | — | Print backtrace of call function context frames |
| `cont` | `c` | Continue script execution |
| `step` | `s` | Step to next executable statement |
| `over` | — | Step over function call |
| `out` | — | Step out of current function |
| `vars` | `v` | Show variables in current scope |
| `threads` | `ths` | Show all threads |
| `thread {id}` | `th {id}` | Switch to a specific thread |
| `up` | `u` | Move up the call stack |
| `down` | `d` | Move down the call stack |
| `bsc` | — | Print BrightScript component instances |
| `bscs` | — | Print component instance count summary |
| `brkd` | — | Toggle break on non-fatal diagnostics |
| `exit` | — | Exit the channel |

#### 5.4.4 Backtrace Format

When the debugger pauses, the console outputs a backtrace in this format:

```
#0  Function oncontentloaded() As Void
   file/line: pkg:/components/HomeScene.brs(42)
#1  Function main() As Void
   file/line: pkg:/source/main.brs(5)
```

The server must parse backtraces into structured JSON:

```json
[
  {
    "frame": 0,
    "function": "oncontentloaded() As Void",
    "file": "pkg:/components/HomeScene.brs",
    "line": 42
  },
  {
    "frame": 1,
    "function": "main() As Void",
    "file": "pkg:/source/main.brs",
    "line": 5
  }
]
```

---

## 6. MCP Tool Definitions

All tools are registered via the MCP SDK's `server.tool()` method with Zod input schemas. Every tool returns a structured JSON payload inside the MCP `content` array.

### 6.1 `roku_build`

Runs the project's own `build` script and returns a validated deployable Roku package. The tool detects `pnpm`, `yarn`, or `npm` from the lockfile, then runs the equivalent of `{package_manager} run build`. It never assumes an output filename or build-system implementation.

The build output must contain exactly one ZIP, unless `package_path` identifies the intended ZIP. The chosen ZIP must contain `manifest` at its root, which is the Roku sideloading requirement.

```typescript
{
  project_dir: z.string(),
  package_path: z.string().optional(),
}
```

### 6.2 `roku_deploy`

Sideloads a previously built Roku ZIP. This is the deployment primitive and accepts artifacts produced by BrighterScript, `roku-deploy`, or another compatible build system.

```typescript
{
  package_path: z.string(),
  action: z.enum(["Install", "Replace"]).default("Install"),
}
```

### 6.3 `roku_build_and_deploy` (legacy)

Zips a BrightScript/SceneGraph source directory and sideloads it to the Roku device. This convenience tool is appropriate only for projects without a separate build artifact. Agents should use `roku_build` followed by `roku_deploy` when the project defines a build step.

**Input Schema:**

```typescript
{
  source_dir: z.string()
    .describe("Absolute path to the BrightScript/SceneGraph project root. Must contain a 'manifest' file."),
  action: z.enum(["Install", "Replace"])
    .default("Install")
    .describe("Install: replace any existing sideloaded app. Replace: update the current sideloaded app in-place."),
  exclude_patterns: z.array(z.string())
    .optional()
    .describe("Additional glob patterns to exclude from the zip (beyond the defaults: .git, node_modules, .env, *.log)."),
}
```

**Behavior:**

1. Validate that `source_dir` exists and contains a `manifest` file at root.
2. Create a zip archive of the directory, excluding default and user-specified patterns.
3. POST the zip to `http://{roku_ip}/plugin_install` with Digest Auth and the appropriate `mysubmit` value.
4. Parse the HTML response to determine install success or failure.
5. Wait 2 seconds, then snapshot the first 50 lines of the log buffer (port 8085) to capture initialization output.
6. Return the result.

**Response Schema:**

```json
{
  "success": true,
  "message": "Application installed successfully",
  "install_time_ms": 3420,
  "zip_size_bytes": 245760,
  "startup_log": [
    "[2026-08-26T19:30:01Z] ------ Running dev 'Jellyfin' main ------",
    "[2026-08-26T19:30:01Z] Jellyfin: Initializing...",
    "[2026-08-26T19:30:02Z] Jellyfin: Server URL: http://192.168.1.10:8096"
  ],
  "crash_detected": false
}
```

**Error cases:**

| Condition | Error |
|-----------|-------|
| `manifest` not found | `MANIFEST_NOT_FOUND: No manifest file at {source_dir}/manifest` |
| Digest auth failure (401) | `AUTH_FAILED: Invalid developer password. Check ROKU_DEV_PASSWORD.` |
| Device unreachable | `DEVICE_UNREACHABLE: Cannot connect to {roku_ip}:80` |
| Install failure (HTML parse) | `INSTALL_FAILED: {parsed error message from HTML response}` |
| Crash on startup | `success: true, crash_detected: true` + crash details in `startup_log` |

---

### 6.4 `roku_send_keys`

Sends a sequence of ECP keypress commands with configurable inter-key delay.

**Input Schema:**

```typescript
{
  keys: z.array(z.string())
    .min(1)
    .describe("Ordered list of ECP key names to press sequentially. Supported: Home, Up, Down, Left, Right, Select, Back, Play, Rev, Fwd, InstantReplay, Info, Backspace, Search, Enter, VolumeUp, VolumeDown, VolumeMute, PowerOff, ChannelUp, ChannelDown, InputTuner, InputHDMI1-4, InputAV1, FindRemote, Lit_{char}."),
  delay_ms: z.number()
    .int()
    .min(0)
    .max(5000)
    .optional()
    .describe("Delay in milliseconds between each keypress. Default: value of ROKU_KEYPRESS_DELAY_MS env var (100ms). Increase for slow UIs or complex animations."),
}
```

**Behavior:**

1. Validate each key name against the known set.
2. Iterate through the array, sending `POST http://{roku_ip}:8060/keypress/{key}` for each.
3. Wait `delay_ms` between each press (default from env var).
4. Return the total execution summary.

**Response Schema:**

```json
{
  "keys_sent": ["Down", "Down", "Right", "Select"],
  "total_keys": 4,
  "delay_ms": 100,
  "elapsed_ms": 520,
  "errors": []
}
```

**Error handling:** If a keypress fails (device unreachable mid-sequence), the tool stops, returns the partial result, and includes the failure in `errors`.

---

### 6.5 `roku_get_ui_tree`

Captures and parses the full SceneGraph node tree from the SG Debug Server.

**Input Schema:**

```typescript
{
  filter_id: z.string()
    .optional()
    .describe("If provided, returns only the subtree rooted at the node with this ID. Uses 'sgnodes {id}' instead of 'sgnodes all'."),
  include_fields: z.boolean()
    .default(true)
    .describe("Whether to include node field key-value pairs in the output. Set false for a compact tree overview."),
  max_depth: z.number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum tree depth to return. Useful for limiting output size on deeply nested UIs."),
}
```

**Behavior:**

1. Open a TCP socket to `{roku_ip}:8080`.
2. Send `sgnodes all` (or `sgnodes {filter_id}` if specified).
3. Buffer the response until 2 seconds of idle (no new data).
4. Parse the indented text output into a JSON tree structure.
5. Apply `max_depth` and `include_fields` filters.
6. Close the socket.
7. Return the parsed tree.

**Response Schema:**

```json
{
  "total_nodes": 247,
  "captured_at": "2026-08-26T19:30:05.000Z",
  "tree": [
    {
      "type": "Group",
      "id": "homeScene",
      "subtype": "HomeScene",
      "children": [
        {
          "type": "RowList",
          "id": "homeRowList",
          "subtype": "RowList",
          "fields": { "numRows": "5", "itemSize": "[1728, 400]" },
          "children": []
        }
      ]
    }
  ]
}
```

**Why this tool is critical for agents:** The agent can use the UI tree to assert that specific components (like a `RowList` or `PosterGrid`) have populated with data, preventing it from blindly pressing buttons before the UI has loaded. This is the programmatic alternative to OCR-based screen reading.

---

### 6.6 `roku_capture_state`

Returns a multi-modal snapshot of the device's current state.

**Input Schema:**

```typescript
{
  log_lines: z.number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Number of most recent BrightScript console log lines to include from the ring buffer."),
  include_screenshot: z.boolean()
    .default(true)
    .describe("Whether to capture and include a base64 screenshot. Set false to reduce response size."),
  include_ui_tree: z.boolean()
    .default(false)
    .describe("Whether to also capture the SG node tree (expensive operation). Use roku_get_ui_tree for dedicated tree inspection."),
}
```

**Behavior:**

1. **Log snapshot:** Read the last `log_lines` entries from the ring buffer.
2. **Active app query:** `GET http://{roku_ip}:8060/query/active-app`, parse XML to JSON.
3. **Screenshot** (if `include_screenshot`): POST to `/plugin_inspect`, fetch the resulting image, base64-encode it.
4. **UI tree** (if `include_ui_tree`): Invoke the `roku_get_ui_tree` handler internally.
5. **Crash check:** Check whether any unacknowledged crash events exist in the log buffer.
6. Assemble and return the composite snapshot.

**Response Schema:**

```json
{
  "captured_at": "2026-08-26T19:30:10.000Z",
  "active_app": {
    "id": "dev",
    "name": "Jellyfin",
    "version": "1.8.0"
  },
  "log": {
    "lines": [
      { "seq": 142, "timestamp": "2026-08-26T19:30:09.100Z", "text": "Jellyfin: Loading media library..." },
      { "seq": 143, "timestamp": "2026-08-26T19:30:09.250Z", "text": "Jellyfin: Found 42 items" }
    ],
    "total_buffered": 143,
    "buffer_capacity": 500
  },
  "screenshot": {
    "format": "jpeg",
    "width": 1920,
    "height": 1080,
    "base64": "/9j/4AAQSkZJRg..."
  },
  "crash_detected": false,
  "crash_details": null,
  "ui_tree": null
}
```

The MCP response uses the `image` content type for the screenshot when available:

```json
{
  "content": [
    { "type": "text", "text": "{...structured JSON state...}" },
    { "type": "image", "data": "/9j/4AAQSkZJRg...", "mimeType": "image/jpeg" }
  ]
}
```

---

### 6.7 `roku_assert_playback`

Queries the media player state to verify video playback status.

**Input Schema:**

```typescript
{
  // No required inputs
}
```

**Behavior:**

1. `GET http://{roku_ip}:8060/query/media-player`
2. Parse the XML response into structured JSON.
3. Compute derived fields (e.g., `progress_percent`, `is_buffering`, `is_playing`).
4. Return the playback state.

**Response Schema:**

```json
{
  "is_playing": true,
  "is_buffering": false,
  "is_paused": false,
  "is_stopped": false,
  "state": "play",
  "error": false,
  "plugin": { "id": "dev", "name": "Jellyfin" },
  "position_ms": 12345,
  "duration_ms": 887999,
  "progress_percent": 1.39,
  "is_live": false,
  "buffering": { "target": 0, "current": 1000, "max": 1000 },
  "format": {
    "audio": "aac_adts",
    "video": "mpeg4_15",
    "drm": "none"
  },
  "stream_segment": {
    "bitrate": 4000000,
    "width": 1920,
    "height": 1080
  }
}
```

---

### 6.8 `roku_wait_for_condition`

Polls for a condition to be satisfied, enabling deterministic waiting without hardcoded sleeps.

**Input Schema:**

```typescript
{
  condition: z.string()
    .describe("Condition expression to evaluate. Supported formats:\n"
      + "- 'node_exists: {nodeId}' — polls sgnodes until a node with the given ID appears in the tree.\n"
      + "- 'node_field: {nodeId}.{field}={value}' — polls until a specific node field matches the expected value.\n"
      + "- 'playback_state: {state}' — polls /query/media-player until the player reaches the given state (play, pause, buffering, stop).\n"
      + "- 'app_active: {appId}' — polls /query/active-app until the given app is in the foreground.\n"
      + "- 'log_contains: {pattern}' — scans the log buffer for a line matching the given regex pattern.\n"
      + "- 'crash_detected' — returns immediately if a crash has been captured, or waits until one occurs."),
  timeout_seconds: z.number()
    .min(1)
    .max(120)
    .default(10)
    .describe("Maximum seconds to wait before returning a timeout error."),
  poll_interval_ms: z.number()
    .int()
    .min(100)
    .max(5000)
    .default(500)
    .describe("Milliseconds between each poll attempt."),
}
```

**Behavior:**

1. Parse the `condition` string into a condition type and parameters.
2. Enter a poll loop:
   a. Evaluate the condition (query the appropriate Roku interface).
   b. If satisfied, return immediately with success.
   c. If not, wait `poll_interval_ms` and retry.
   d. If `timeout_seconds` is exceeded, return a timeout result (**not** an error — the agent should decide how to proceed).
3. Return the result with timing metadata.

**Response Schema:**

```json
{
  "satisfied": true,
  "condition": "node_exists: VideoPlayer",
  "elapsed_ms": 3200,
  "polls": 7,
  "timeout": false,
  "snapshot": {
    "matched_node": {
      "type": "Video",
      "id": "VideoPlayer",
      "subtype": "VideoPlayer"
    }
  }
}
```

**Timeout response:**

```json
{
  "satisfied": false,
  "condition": "node_exists: VideoPlayer",
  "elapsed_ms": 10050,
  "polls": 20,
  "timeout": true,
  "snapshot": null
}
```

**Condition evaluation details:**

| Condition | Evaluation Method |
|-----------|-------------------|
| `node_exists: {id}` | Connect to port 8080, `sgnodes all`, search parsed tree for a node whose `id` field matches `{id}` (case-insensitive). |
| `node_field: {id}.{field}={value}` | Same as above, but also checks that the specified field on the matched node equals `{value}`. |
| `playback_state: {state}` | `GET :8060/query/media-player`, compare `state` attribute. |
| `app_active: {appId}` | `GET :8060/query/active-app`, compare returned app ID. |
| `log_contains: {pattern}` | Scan the ring buffer for a line matching the regex `{pattern}`. |
| `crash_detected` | Check the crash event flag on the log buffer. |

---

### 6.9 `roku_launch`

Deep-link into a specific content item within the sideloaded app.

**Input Schema:**

```typescript
{
  content_id: z.string()
    .optional()
    .describe("Content ID for deep linking (passed as contentId query parameter)."),
  media_type: z.string()
    .optional()
    .describe("Media type hint for deep linking (passed as mediaType query parameter). Common values: series, movie, episode, short-form."),
  params: z.record(z.string())
    .optional()
    .describe("Additional arbitrary query parameters to include in the launch URL."),
}
```

**Behavior:**

1. Construct the launch URL: `POST http://{roku_ip}:8060/launch/dev?contentId={content_id}&mediaType={media_type}&{params}`.
2. Send the POST request.
3. Wait 1 second for the app to begin launching.
4. Query `/query/active-app` to confirm the dev channel is now active.
5. Return the launch result.

**Response Schema:**

```json
{
  "launched": true,
  "app_id": "dev",
  "content_id": "movie-123",
  "media_type": "movie",
  "active_app_confirmed": true,
  "elapsed_ms": 1200
}
```

---

## 7. Connection Management

### 7.1 Connection Lifecycle

| Port | Connection Type | Lifecycle |
|------|----------------|-----------|
| 80 | HTTP (per-request) | Create for each deploy/screenshot operation. Digest auth is re-negotiated per request. |
| 8060 | HTTP (per-request) | Stateless REST calls. No persistent connection needed. |
| 8080 | TCP socket (on-demand) | Connect → send command → read response → disconnect. One operation at a time. |
| 8085 | TCP socket (persistent) | One local MCP instance owns the Roku socket; other local instances subscribe through a per-device IPC broker. Reconnects automatically on disconnect. |

### 7.2 Port 8085 Reconnection Strategy

The background log capture connection must be resilient:

Because a Roku permits only one BrightScript debug-console client, MCP server instances running as the same local user must coordinate through a per-device local IPC socket. The elected local owner keeps the single TCP connection to Roku; follower instances receive the owner’s buffered and live log lines. If the owner exits, a follower retries and becomes the owner. This prevents independently started coding agents from evicting each other from port 8085.

1. On initial connection failure: retry every 3 seconds, up to 10 attempts.
2. On mid-session disconnect (app crash/restart, device reboot):
   - Log the disconnection event to the ring buffer as a synthetic entry: `[SYSTEM] BrightScript debug connection lost. Reconnecting...`
   - Attempt reconnection every 3 seconds indefinitely.
   - On successful reconnection, log: `[SYSTEM] BrightScript debug connection re-established.`
3. During reconnection attempts, all tools that depend on port 8085 (log retrieval in `roku_capture_state`, `log_contains` condition) continue to work using the existing ring buffer contents.

### 7.3 Port 8080 Connection Serialization

Since port 8080 is used on-demand and the SceneGraph debug server may not handle concurrent connections:

- Maintain a **mutex/semaphore** that serializes all port 8080 operations.
- If a second tool call tries to use port 8080 while another is in progress, it must wait (with its own timeout) rather than opening a second connection.

### 7.4 Timeouts

| Operation | Timeout | Configurable Via |
|-----------|---------|------------------|
| TCP socket connect (8080, 8085) | 5,000ms | `ROKU_CONNECT_TIMEOUT_MS` |
| Telnet command response (8080) | 10,000ms | `ROKU_COMMAND_TIMEOUT_MS` |
| HTTP requests (80, 8060) | 15,000ms | — |
| Screenshot image fetch | 10,000ms | — |
| SSDP discovery | 5,000ms | — |

---

## 8. Error Taxonomy

All errors returned by tools follow a consistent structure:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\": \"ERROR_CODE\", \"message\": \"Human-readable description\", \"details\": {...}}"
    }
  ],
  "isError": true
}
```

### 8.1 Error Codes

| Code | Category | Description |
|------|----------|-------------|
| `DEVICE_UNREACHABLE` | Network | Cannot connect to the Roku device on the required port |
| `AUTH_FAILED` | Auth | Digest authentication failed (wrong `ROKU_DEV_PASSWORD`) |
| `MANIFEST_NOT_FOUND` | Validation | Source directory missing required `manifest` file |
| `INSTALL_FAILED` | Deployment | Roku rejected the sideloaded application |
| `INVALID_KEY` | Validation | Unrecognized ECP key name |
| `PORT_BUSY` | Concurrency | Another operation is using the requested port (8080 serialization) |
| `TIMEOUT` | Timeout | Operation exceeded its allowed time |
| `PARSE_ERROR` | Data | Failed to parse Roku response (malformed XML/text) |
| `NO_SIDELOADED_APP` | State | Operation requires a sideloaded app but none is installed |
| `INVALID_CONDITION` | Validation | Unrecognized condition format in `roku_wait_for_condition` |
| `CONNECTION_LOST` | Network | Persistent connection (8085) was lost during operation |

### 8.2 Error Recovery Guidance

Each error includes a `recovery_hint` field to help the agent self-correct:

```json
{
  "error": "AUTH_FAILED",
  "message": "Digest authentication failed for port 80",
  "recovery_hint": "Verify that the ROKU_DEV_PASSWORD environment variable matches the password set on the Roku device during Developer Mode activation.",
  "details": { "http_status": 401, "port": 80 }
}
```

---

## 9. The Asynchronous Feedback Loop

### 9.1 The Timing Problem

The biggest challenge for an AI agent testing a Roku app is **timing**. Roku's SceneGraph rendering is asynchronous — if the agent deploys Jellyfin and immediately tries to navigate, the SceneGraph components will not have finished mounting. Network-dependent content (media library listings, video streams) introduces even more latency variance.

Hardcoded `sleep()` calls are unacceptable because:
- They waste time when the UI loads fast.
- They fail silently when the UI loads slow.
- They give the agent no feedback about *what* is happening during the wait.

### 9.2 The Polling Strategy

The `roku_wait_for_condition` tool replaces all hardcoded sleeps with deterministic, observable waits. The canonical agent workflow becomes:

```
1. roku_launch(content_id: "movie-123", media_type: "movie")
2. roku_wait_for_condition("node_exists: VideoPlayer", timeout: 10)
3. roku_wait_for_condition("playback_state: play", timeout: 15)
4. roku_capture_state()   // Observe the result
```

Each step either succeeds with proof or fails with diagnostic context. The agent never operates in the dark.

### 9.3 Condition Composition

For complex scenarios, the agent should chain multiple `roku_wait_for_condition` calls:

```
// Wait for the home screen to fully load
roku_wait_for_condition("node_exists: homeRowList", timeout: 15)

// Navigate into a content item
roku_send_keys(["Down", "Down", "Select"])

// Wait for the detail screen
roku_wait_for_condition("node_exists: detailView", timeout: 10)

// Verify the correct content loaded
roku_wait_for_condition("node_field: detailTitle.text=Inception", timeout: 5)

// Start playback
roku_send_keys(["Play"])

// Wait for video to actually start
roku_wait_for_condition("playback_state: play", timeout: 20)

// Assert playback is working
roku_assert_playback()
```

### 9.4 Crash Recovery Flow

When the agent detects a crash (either via `roku_wait_for_condition("crash_detected")` or via the `crash_detected` flag in `roku_capture_state`), the recommended recovery flow is:

```
1. roku_capture_state(log_lines: 200)   // Capture full crash context
2. // Agent analyzes the backtrace, identifies the bug, edits the source
3. roku_build_and_deploy(source_dir: "/path/to/project")   // Redeploy
4. roku_wait_for_condition("app_active: dev", timeout: 15)   // Confirm launch
5. // Resume testing
```

---

## 10. Security Considerations

### 10.1 Credential Handling

- The `ROKU_DEV_PASSWORD` **must only** be read from the environment variable. It must never appear in:
  - Log output (mask it in any debug logging).
  - Tool responses.
  - Error messages (use `"Check ROKU_DEV_PASSWORD"` instead of echoing the value).
  - MCP protocol messages.

- The Digest Auth implementation handles the password in-memory only. The `HA1` hash is computed per-request and not persisted to disk.

### 10.2 Network Security

- All communication with the Roku device is over the **local network only**. The MCP server must not expose Roku endpoints to the internet.
- If using `StreamableHTTPServerTransport`, the MCP server should bind to `127.0.0.1` by default, not `0.0.0.0`.
- Consider supporting an optional `--require-auth` flag for the HTTP transport that enables bearer token authentication for the MCP server itself.

### 10.3 File System Access

- The `roku_build_and_deploy` tool accesses the file system to read source directories and create zip archives.
- The source directory path must be validated:
  - Resolve to an absolute path.
  - Ensure it contains a `manifest` file (confirms it's a Roku project, not an arbitrary directory).
  - The zip operation must not follow symlinks outside the source directory to prevent path traversal.

---

## 11. Testing Strategy

### 11.1 Unit Tests

Each Roku interface adapter must have unit tests with mocked network responses:

| Module | Test Cases |
|--------|------------|
| **Installer adapter** | Zip creation correctness, Digest Auth header generation, HTML response parsing (success/failure), missing manifest validation |
| **ECP adapter** | Key name validation, URL construction, XML parsing for all query endpoints, media-player response edge cases |
| **SG Debug adapter** | Text-to-JSON tree parser with varied indentation depths, empty tree, single node, deeply nested tree, large output (>100KB) |
| **BS Console adapter** | Ring buffer overflow behavior, crash pattern detection regex, backtrace parsing, timestamp assignment, reconnection state machine |
| **Condition evaluator** | All six condition types, timeout behavior, invalid condition format handling |

### 11.2 Integration Tests

Integration tests run against a real Roku device (gated behind a `ROKU_INTEGRATION_TEST=1` flag):

| Test | Validates |
|------|-----------|
| Deploy a minimal "Hello World" BrightScript app | End-to-end sideloading pipeline |
| Send keypresses and verify UI tree changes | ECP + SG Debug round-trip |
| Deploy a crashing app and verify crash capture | Log buffer + crash detector |
| Screenshot capture and validation | Installer screenshot pipeline |
| `roku_wait_for_condition` with real timing | Polling loop correctness |

### 11.3 Mock Server

Provide a `MockRokuDevice` class that simulates all four ports for local development without a physical Roku:

- Port 80: HTTP server with Digest Auth that accepts zip uploads.
- Port 8060: HTTP server that responds to ECP queries with static XML.
- Port 8080: TCP server that returns canned `sgnodes all` output.
- Port 8085: TCP server that streams synthetic log output and can trigger crash events on demand.

---

## 12. Project Structure

```
roku-dev-mcp/
├── docs/
│   └── SPEC.md                     # This document
├── src/
│   ├── index.ts                    # Entry point: MCP server setup and transport
│   ├── server.ts                   # McpServer instantiation and tool registration
│   ├── config.ts                   # Environment variable parsing and validation
│   ├── tools/
│   │   ├── build-and-deploy.ts     # roku_build_and_deploy tool handler
│   │   ├── send-keys.ts            # roku_send_keys tool handler
│   │   ├── get-ui-tree.ts          # roku_get_ui_tree tool handler
│   │   ├── capture-state.ts        # roku_capture_state tool handler
│   │   ├── assert-playback.ts      # roku_assert_playback tool handler
│   │   ├── wait-for-condition.ts   # roku_wait_for_condition tool handler
│   │   └── launch.ts              # roku_launch tool handler
│   ├── adapters/
│   │   ├── installer.ts            # Port 80: Digest Auth, zip upload, screenshot
│   │   ├── ecp.ts                  # Port 8060: ECP HTTP REST client
│   │   ├── sg-debug.ts             # Port 8080: SceneGraph debug Telnet client
│   │   └── bs-console.ts           # Port 8085: BrightScript debug Telnet + log buffer
│   ├── parsers/
│   │   ├── sgnodes-parser.ts       # Parse indented sgnodes text → JSON tree
│   │   ├── ecp-xml-parser.ts       # Parse ECP XML responses → JSON
│   │   ├── backtrace-parser.ts     # Parse BrightScript backtrace → structured frames
│   │   └── crash-detector.ts       # Regex-based crash signature detection
│   ├── lib/
│   │   ├── ring-buffer.ts          # Fixed-size ring buffer with sequence numbers
│   │   ├── digest-auth.ts          # HTTP Digest Authentication implementation
│   │   ├── ssdp-discovery.ts       # SSDP multicast discovery for Roku devices
│   │   ├── zipper.ts               # Source directory → zip archive creation
│   │   └── mutex.ts                # Async mutex for port 8080 serialization
│   └── types/
│       ├── roku.ts                 # Roku-specific type definitions
│       ├── tools.ts                # Tool input/output type definitions
│       └── errors.ts               # Error code enum and error factory
├── test/
│   ├── unit/
│   │   ├── adapters/
│   │   │   ├── installer.test.ts
│   │   │   ├── ecp.test.ts
│   │   │   ├── sg-debug.test.ts
│   │   │   └── bs-console.test.ts
│   │   ├── parsers/
│   │   │   ├── sgnodes-parser.test.ts
│   │   │   ├── ecp-xml-parser.test.ts
│   │   │   ├── backtrace-parser.test.ts
│   │   │   └── crash-detector.test.ts
│   │   └── lib/
│   │       ├── ring-buffer.test.ts
│   │       ├── digest-auth.test.ts
│   │       └── zipper.test.ts
│   ├── integration/
│   │   ├── deploy.test.ts
│   │   ├── keypress.test.ts
│   │   ├── screenshot.test.ts
│   │   ├── wait-condition.test.ts
│   │   └── crash-recovery.test.ts
│   └── mocks/
│       └── mock-roku-device.ts     # Simulates all four Roku ports
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

---

## Appendix A — Roku Protocol Quick Reference

### A.1 Port Matrix

| Port | Protocol | Auth | Connection | Purpose |
|------|----------|------|-----------|---------|
| **80** | HTTP | Digest (`rokudev` / password) | Per-request | Sideloading, screenshot capture |
| **8060** | HTTP REST | None¹ | Per-request | Keypresses, app launch, device/media queries |
| **8080** | Telnet (TCP) | None | On-demand | SceneGraph node tree inspection |
| **8085** | Telnet (TCP) | None | Persistent | BrightScript console logs, crash capture, debugging |

¹ Requires "Control by mobile apps" enabled in Roku OS 14.1+.

### A.2 ECP Quick Reference

```bash
# Keypress
curl -d '' http://{ip}:8060/keypress/Home

# Launch sideloaded app with deep link
curl -d '' 'http://{ip}:8060/launch/dev?contentId=123&mediaType=movie'

# Query device info
curl http://{ip}:8060/query/device-info

# Query active app
curl http://{ip}:8060/query/active-app

# Query media player
curl http://{ip}:8060/query/media-player
```

### A.3 Installer Quick Reference

```bash
# Sideload an app
curl --digest -u rokudev:$ROKU_DEV_PASSWORD \
  -F "mysubmit=Install" \
  -F "archive=@app.zip" \
  http://{ip}/plugin_install

# Take a screenshot
curl --digest -u rokudev:$ROKU_DEV_PASSWORD \
  -F "mysubmit=Screenshot" \
  http://{ip}/plugin_inspect

# Download the screenshot
curl --digest -u rokudev:$ROKU_DEV_PASSWORD \
  http://{ip}/pkgs/dev.jpg -o screenshot.jpg
```

### A.4 Telnet Quick Reference

```bash
# BrightScript console
telnet {ip} 8085

# SceneGraph debug
telnet {ip} 8080
# Then type: sgnodes all
```

---

## Appendix B — Example Agent Workflow

This appendix demonstrates a complete autonomous workflow where an Antigravity agent deploys, tests, and debugs a Jellyfin Roku application.

### B.1 Initial Deployment

```
Agent → roku_build_and_deploy(source_dir: "/home/user/jellyfin-roku")
  ← { success: true, crash_detected: false, startup_log: [...] }

Agent → roku_wait_for_condition("app_active: dev", timeout: 15)
  ← { satisfied: true, elapsed_ms: 2100 }

Agent → roku_wait_for_condition("node_exists: homeRowList", timeout: 20)
  ← { satisfied: true, elapsed_ms: 8400 }

Agent → roku_capture_state(include_screenshot: true)
  ← { active_app: { name: "Jellyfin" }, screenshot: { base64: "..." }, ... }
```

### B.2 Navigation & Playback Testing

```
Agent → roku_send_keys(["Down", "Down", "Right", "Select"])
  ← { keys_sent: 4, elapsed_ms: 520 }

Agent → roku_wait_for_condition("node_exists: detailView", timeout: 10)
  ← { satisfied: true, elapsed_ms: 1800 }

Agent → roku_send_keys(["Select"])  // Start playback
  ← { keys_sent: 1, elapsed_ms: 120 }

Agent → roku_wait_for_condition("playback_state: play", timeout: 20)
  ← { satisfied: true, elapsed_ms: 6200 }

Agent → roku_assert_playback()
  ← { is_playing: true, position_ms: 3200, duration_ms: 7200000, ... }
```

### B.3 Crash Recovery

```
Agent → roku_build_and_deploy(source_dir: "/home/user/jellyfin-roku")
  ← { success: true, crash_detected: true, startup_log: [
       "BRIGHTSCRIPT: ERROR: Runtime Error (code 244)...",
       "#0 Function oncontentloaded() ...",
       "   file/line: pkg:/components/HomeScene.brs(42)"
     ]}

// Agent reads the error, identifies null reference on line 42,
// edits HomeScene.brs to add a guard clause, then redeploys:

Agent → roku_build_and_deploy(source_dir: "/home/user/jellyfin-roku")
  ← { success: true, crash_detected: false }

Agent → roku_wait_for_condition("node_exists: homeRowList", timeout: 20)
  ← { satisfied: true, elapsed_ms: 7200 }
  // Bug fixed. Resume testing.
```
