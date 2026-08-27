# Installation & MCP Client Configuration Guide

This guide details how to build and configure the `roku-dev-mcp` server with various AI coding environments, including **Antigravity**, **Claude CLI / Claude Desktop**, **Codex**, and **Opencode**.

---

## 1. Prerequisites & Build

### 1.1 Host Environment
- **Node.js** ≥ 20.0.0 (LTS recommended)
- **npm** or **pnpm**

### 1.2 Build the Server
Clone the repository and build the distribution bundle:

```bash
cd /path/to/roku-dev-mcp
npm install
npm run build
```

This creates the executable ESM entrypoint at:
```
/path/to/roku-dev-mcp/dist/index.js
```

---

## 2. Environment Variables Reference

When configuring `roku-dev-mcp` in any MCP client, supply the following environment variables:

| Variable | Required | Description | Example |
|:---|:---:|:---|:---|
| `ROKU_DEV_PASSWORD` | **Yes** | Developer password configured on the Roku device. | `secret123` |
| `ROKU_DEVICE_IP` | No | Target Roku device IP. If omitted, SSDP auto-discovery is used. | `192.168.1.50` |
| `ROKU_LOG_BUFFER_SIZE` | No | Ring buffer size for BrightScript logs (default: `500`). | `1000` |
| `ROKU_KEYPRESS_DELAY_MS` | No | Delay between sequential remote keypresses (default: `100`). | `150` |
| `ROKU_CONNECT_TIMEOUT_MS` | No | TCP connection timeout for Telnet ports (default: `5000`). | `5000` |
| `ROKU_COMMAND_TIMEOUT_MS` | No | Command timeout for SceneGraph queries (default: `10000`). | `10000` |

---

## 3. Client Configuration Guides

---

### 3.1 Antigravity (CLI & IDE)

Antigravity natively supports MCP servers configured in user or workspace settings.

#### Option A: Workspace Configuration (`.antigravity/mcp.json`)
Create or edit `.antigravity/mcp.json` at the root of your project:

```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

#### Option B: Global Antigravity CLI Config (`~/.gemini/antigravity-cli/config.json`)
Add the server under `mcpServers` in your global configuration:

```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

---

### 3.2 Claude (Claude Code CLI & Claude Desktop)

#### Claude Code (CLI)
You can register `roku-dev-mcp` using the `claude mcp` command:

```bash
claude mcp add roku-dev node /absolute/path/to/roku-dev-mcp/dist/index.js \
  -e ROKU_DEV_PASSWORD="your_developer_password" \
  -e ROKU_DEVICE_IP="192.168.1.50"
```

To verify the registration:
```bash
claude mcp list
```

#### Claude Desktop
Add the configuration to your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

---

### 3.3 Codex (OpenAI Codex CLI & IDE Integrations)

For OpenAI Codex environments supporting MCP:

#### Option A: Workspace Settings (`.codex/mcp.json`)
Add `roku-dev` to `.codex/mcp.json`:

```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

#### Option B: Global Codex Config (`~/.codex/config.json`)
```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

---

### 3.4 Opencode

For Opencode editor and agent workflows:

#### Workspace Configuration (`.opencode/mcp.json`)
Create `.opencode/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

#### Global Opencode Configuration (`~/.config/opencode/mcp.json`)
```json
{
  "mcpServers": {
    "roku-dev": {
      "command": "node",
      "args": ["/absolute/path/to/roku-dev-mcp/dist/index.js"],
      "env": {
        "ROKU_DEV_PASSWORD": "your_developer_password",
        "ROKU_DEVICE_IP": "192.168.1.50"
      }
    }
  }
}
```

---

## 4. Verification & Testing

After configuring your client, verify tool discovery and operation:

1. **Verify Tools Discovered**:
   Ask the assistant: *"What tools are available from the roku-dev MCP server?"*
   The client should list:
   - `roku_build_and_deploy`
   - `roku_send_keys`
   - `roku_get_ui_tree`
   - `roku_capture_state`
   - `roku_assert_playback`
   - `roku_wait_for_condition`
   - `roku_launch`

2. **Test Device Connection**:
   Ask the assistant: *"Capture the current state of the Roku device."*
   The assistant will invoke `roku_capture_state` and display the active channel, recent console logs, and screenshot.
