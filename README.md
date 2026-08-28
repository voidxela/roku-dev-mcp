# Roku Development MCP Server (`roku-dev-mcp`)

[![License](https://img.shields.io/badge/license-Unlicense-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-1.0.0-orange.svg)](https://modelcontextprotocol.io)

An autonomous Model Context Protocol (MCP) server that empowers AI coding agents (such as Antigravity, Claude, and Cursor) to develop, deploy, navigate, inspect, and debug Roku BrightScript and SceneGraph applications.

---

## 1. Overview

Roku OS separates development APIs across four distinct network protocols on four different ports. `roku-dev-mcp` acts as a **middleware controller** that bridges the agent's structured JSON tool-call interface and Roku's fragmented developer API surface.

```
┌──────────────────────────────────────────────────────────────────┐
│                        MCP Client (Agent)                        │
│                  (Antigravity / Claude / etc.)                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │  MCP Protocol (stdio)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     roku-dev-mcp Server                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Tool Router  │  │  Log Buffer  │  │  Connection Manager    │  │
│  │  (Zod Schemas│  │  (Ring Buffer │  │  (Mutex, Reconnect,   │  │
│  │   & Handlers)│  │   & Crash Det)│  │   Timeouts)           │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────────────────┘  │
│         │                 │                  │                    │
│  ┌──────┴─────────────────┴──────────────────┴─────────────────┐ │
│  │                   Roku Interface Adapters                    │ │
│  │  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │ │
│  │  │ Port 80     │ │ Port     │ │ Port     │ │ Port 8085   │  │ │
│  │  │ Installer   │ │ 8060 ECP │ │ 8080 SG  │ │ BS Console  │  │ │
│  │  │ (HTTP/      │ │ (HTTP    │ │ Debug    │ │ (Telnet /   │  │ │
│  │  │  Digest)    │ │  REST)   │ │ (Telnet) │ │  Persistent)│  │ │
│  │  └──────┬──────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘  │ │
│  └─────────┼─────────────┼────────────┼──────────────┼──────────┘ │
└────────────┼─────────────┼────────────┼──────────────┼────────────┘
             │             │            │              │
             ▼             ▼            ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Roku Device (TV / Stick)                    │
│   :80 Installer   :8060 ECP   :8080 SG Debug   :8085 BS Debug   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Port Architecture Matrix

| Port | Protocol | Auth | Connection | Purpose |
|:---:|:---:|:---:|:---:|:---|
| **80** | HTTP | Digest (`rokudev` / password) | Per-request | Sideloading (`/plugin_install`), screenshot capture (`/plugin_inspect`) |
| **8060** | HTTP REST | None* | Per-request | Remote keypresses, deep linking, device/media state queries |
| **8080** | Telnet (TCP) | None | On-demand (Serialized) | SceneGraph live node tree dumps (`sgnodes all`) |
| **8085** | Telnet (TCP) | None | Persistent background | BrightScript console logs, real-time crash capture, interactive debugger |

*\*Requires "Control by mobile apps" enabled in Roku OS 14.1+.*

---

## 3. Prerequisites

### 3.1 Roku Device Configuration
1. **Developer Mode enabled**:
   - Remote sequence: `Home ×3 → Up ×2 → Right → Left → Right → Left → Right`.
   - Set a developer password (used as `ROKU_DEV_PASSWORD`).
2. **"Control by mobile apps" enabled**:
   - `Settings → System → Advanced system settings → Control by mobile apps` → select **"Enabled"**.
3. **Local Network Connectivity**:
   - Ensure the host machine running the MCP server is on the same subnet as the Roku device.
   - Ports `80`, `8060`, `8080`, and `8085` must be accessible.

### 3.2 Host Environment
- **Node.js**: `≥ 20.0.0` (LTS recommended)
- **npm** or **pnpm**

---

## 4. Configuration & Environment Variables

Create a `.env` file in the project root or configure environment variables in your MCP client:

| Variable | Required | Default | Description |
|:---|:---:|:---:|:---|
| `ROKU_DEV_PASSWORD` | **Yes** | — | Developer password set during Developer Mode activation. |
| `ROKU_DEVICE_IP` | No | *SSDP discovery* | IPv4 address of the target Roku device (e.g. `192.168.1.50`). |
| `ROKU_LOG_BUFFER_SIZE` | No | `500` | Max lines in the BrightScript ring buffer. |
| `ROKU_KEYPRESS_DELAY_MS` | No | `100` | Delay in milliseconds between sequential keypresses. |
| `ROKU_CONNECT_TIMEOUT_MS` | No | `5000` | TCP connection timeout for Telnet sockets. |
| `ROKU_COMMAND_TIMEOUT_MS` | No | `10000` | Telnet command execution timeout. |

---

## 5. MCP Client Setup

### 5.1 Antigravity / Claude Desktop Configuration

Add the server to your MCP client configuration (e.g., `mcpServers` in `claude_desktop_config.json` or Antigravity MCP settings):

```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_roku_dev_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

For detailed configuration instructions for **Antigravity**, **Claude CLI / Claude Desktop**, **Codex**, and **Opencode**, see [`docs/INSTALL.md`](docs/INSTALL.md).

---

## 6. Available MCP Tools

### 1. `roku_build`
Runs the project's `build` script with the detected package manager (`npm`, `pnpm`, or `yarn`) and returns its Roku ZIP artifact. If the build produces more than one ZIP, provide `package_path` to select one.

### 2. `roku_deploy`
Validates and sideloads a pre-built Roku ZIP. The archive must have `manifest` at its root; it can be produced by BrighterScript, `roku-deploy`, or any other build system.

### 3. `roku_build_and_deploy`
Legacy convenience tool that zips a BrightScript/SceneGraph project directory and sideloads the raw source. Prefer `roku_build` then `roku_deploy` for projects with a build step, because compiled/transformed sources must come from the build artifact.
- **Inputs**:
  - `source_dir` (`string`): Absolute path to project root (must contain `manifest`).
  - `action` (`"Install" | "Replace"`, default: `"Install"`): Install replaces any existing sideloaded app.
  - `exclude_patterns` (`string[]`, optional): Additional glob patterns to exclude.
- **Returns**: Deployment result, startup logs, install duration, and crash status.

### 4. `roku_send_keys`
Sends sequential ECP keypress commands with configurable inter-key delays.
- **Inputs**:
  - `keys` (`string[]`): Ordered list of ECP keys (e.g. `["Home", "Down", "Select", "Lit_a"]`).
  - `delay_ms` (`number`, optional): Delay between keypresses in milliseconds.
- **Returns**: Keys sent count, execution duration, and errors if any.

### 5. `roku_get_ui_tree`
Inspects and parses the live SceneGraph node tree into a JSON tree structure.
- **Inputs**:
  - `filter_id` (`string`, optional): Subtree root node ID.
  - `include_fields` (`boolean`, default: `true`): Include node field key-values.
  - `max_depth` (`number`, optional): Maximum tree depth.
- **Returns**: Parsed node tree with reference counts and field data.

### 6. `roku_capture_state`
Produces a composite multi-modal snapshot of the device state.
- **Inputs**:
  - `log_lines` (`number`, default: `50`): Recent BrightScript log entries.
  - `include_screenshot` (`boolean`, default: `true`): Base64 screenshot image.
  - `include_ui_tree` (`boolean`, default: `false`): SceneGraph tree snapshot.
- **Returns**: Composite JSON state plus inline image payload for multimodal agents.

### 7. `roku_assert_playback`
Queries ECP media player to verify video playback state and metrics.
- **Inputs**: None.
- **Returns**: `is_playing`, `is_buffering`, `progress_percent`, duration, stream bitrate, and audio/video formats.

### 8. `roku_wait_for_condition`
Deterministic condition-based polling to avoid hardcoded sleep timers.
- **Inputs**:
  - `condition` (`string`): Condition expression (`node_exists: {id}`, `node_field: {id}.{field}={val}`, `playback_state: {state}`, `app_active: {id}`, `log_contains: {pattern}`, `crash_detected`).
  - `timeout_seconds` (`number`, default: `10`): Max wait duration.
  - `poll_interval_ms` (`number`, default: `500`): Polling interval.
- **Returns**: Satisfaction flag, elapsed time, poll count, and matched snapshot.

### 9. `roku_launch`
Deep-links into specific content items within the sideloaded application.
- **Inputs**:
  - `content_id` (`string`, optional): Target content ID.
  - `media_type` (`string`, optional): Media type hint (`movie`, `series`, etc.).
  - `params` (`Record<string, string>`, optional): Extra query parameters.
- **Returns**: Launch confirmation and active app verification.

---

## 7. Development & Testing

```bash
# Install dependencies
npm install

# Run unit tests (uses built-in MockRokuDevice)
npm test

# Run unit tests specifically
npm run test:unit

# Run integration tests against a real Roku TV
npm run test:integration

# Run all tests (unit + integration)
ROKU_INTEGRATION_TEST=1 npm test

# Run build
npm run build
```

For full testing documentation and step-by-step verification instructions, refer to [`docs/TESTING.md`](docs/TESTING.md).

---

## 8. License

This project is licensed under the [Unlicense](LICENSE) — public domain.
