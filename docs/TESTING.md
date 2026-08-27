# Roku Development MCP Server — Testing Guide

This guide describes the testing strategy, test suite architecture, and step-by-step procedures for validating `roku-dev-mcp` against simulated environments and real Roku hardware.

---

## 1. Test Architecture Overview

The repository features a two-tiered testing architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                       Test Suites                           │
│                                                             │
│   ┌─────────────────────────┐   ┌───────────────────────┐   │
│   │       Unit Tests        │   │   Integration Tests   │   │
│   │  (Mocked / Offline)     │   │  (Physical Hardware)  │   │
│   │                         │   │                       │   │
│   │  • Parsers & Adapters   │   │  • Gated by           │   │
│   │  • Utilities & Buffers  │   │    ROKU_INTEGRATION_  │   │
│   │  • MockRokuDevice       │   │    TEST=1             │   │
│   │  • MCP Tool Handlers    │   │  • Real Roku Device   │   │
│   └─────────────────────────┘   └───────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 Unit Tests (`test/unit/`)
- Run with `npm test`.
- Completely self-contained and run in offline/CI environments.
- Use `MockRokuDevice` to simulate all 4 Roku ports (80, 8060, 8080, 8085).
- Validate line parsing, XML parsing, regex crash detection, ring buffering, Digest Auth generation, mutex concurrency, and MCP tool serialization.

### 1.2 Integration Tests (`test/integration/`)
- Run with `npm run test:integration` (or `ROKU_INTEGRATION_TEST=1 npm test`).
- Target a real physical Roku TV or streaming stick on the local network.
- Validate end-to-end sideloading, ECP key navigation, live SceneGraph debug tree dumps, screenshot capture, asynchronous polling, and crash recovery.

---

## 2. Checkpoint: Step-by-Step Manual Integration Test Run

Follow this checklist to perform the initial manual validation on a physical Roku device.

### Step 1: Device Preparation
1. **Enable Developer Mode** on your Roku:
   - On the physical remote, press: `Home ×3 → Up ×2 → Right → Left → Right → Left → Right`.
   - Complete the Developer Mode prompt and set a password. Note this password.
2. **Enable Control by Mobile Apps** (Required as of Roku OS 14.1+):
   - Go to `Settings → System → Advanced system settings → Control by mobile apps`.
   - Select **"Enabled"**.
3. **Obtain Roku IP Address**:
   - Go to `Settings → Network → About`. Note the IP address (e.g. `192.168.1.50`).

### Step 2: Environment Configuration
1. Open or create `.env` in the repository root:
   ```bash
   ROKU_DEV_PASSWORD=your_password_here
   ROKU_DEVICE_IP=192.168.1.50
   ```
2. Verify that `.env` is ignored by git (`git status` should not show `.env`).

### Step 3: Network & Port Connectivity Check
Verify network reachability from your host terminal:

```bash
# 1. Check ECP (Port 8060)
curl -s http://$ROKU_DEVICE_IP:8060/query/device-info

# 2. Check Developer Installer (Port 80 with Digest Auth)
curl -s --digest -u rokudev:$ROKU_DEV_PASSWORD http://$ROKU_DEVICE_IP/plugin_inspect
```

If both return valid responses, proceed to Step 4.

### Step 4: Run Automated Integration Tests
Execute the full integration test suite against the device:

```bash
ROKU_INTEGRATION_TEST=1 npm run test:integration
```

Expected output:
- `Integration: Deploy` -> Sideloads `test/fixtures/hello-world`, verifies active app is `dev`, uninstalls on teardown.
- `Integration: Keypress & SG Nodes` -> Sends `Down`, `Right`, `Select`, dumps live node tree from Port 8080.
- `Integration: Screenshot Capture` -> Captures base64 JPEG from Port 80.
- `Integration: Wait For Condition` -> Validates `app_active: dev`, `node_exists: mainLayout`, and `log_contains`.
- `Integration: Crash Recovery` -> Sideloads `test/fixtures/crashing-app`, detects runtime crash (code 244) and backtrace, and redeploys working app.

---

## 3. Manual Tool-by-Tool Smoke Verification

To manually test individual MCP tools using the CLI or an MCP Inspector:

### 3.1 Start the MCP Server
```bash
npm run build
node dist/index.js
```
The server will log startup connectivity info to `stderr` and listen for JSON-RPC messages on `stdin`.

### 3.2 Verification Scenarios

#### Scenario A: Sideload Hello World
Deploy the test fixture:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "roku_build_and_deploy",
    "arguments": {
      "source_dir": "./test/fixtures/hello-world",
      "action": "Install"
    }
  }
}
```
**Verification**: TV screen displays `"Hello Roku MCP!"`. Output confirms `success: true` and `crash_detected: false`.

#### Scenario B: Inspect SceneGraph Tree
Retrieve live node tree:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "roku_get_ui_tree",
    "arguments": {
      "include_fields": true
    }
  }
}
```
**Verification**: Output includes `MainScene`, `mainLayout` (`LayoutGroup`), `helloLabel` (`Label`), and `sampleGrid` (`PosterGrid`).

#### Scenario C: Capture Multimodal State
Capture screenshot and logs:
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "roku_capture_state",
    "arguments": {
      "include_screenshot": true,
      "log_lines": 30
    }
  }
}
```
**Verification**: Response includes recent log lines and base64 screenshot data.

#### Scenario D: Crash Capture & Recovery
Deploy the crashing fixture:
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "roku_build_and_deploy",
    "arguments": {
      "source_dir": "./test/fixtures/crashing-app",
      "action": "Install"
    }
  }
}
```
**Verification**: Tool returns `crash_detected: true`. Logs contain:
```
BRIGHTSCRIPT: ERROR: Runtime Error (code 244) in pkg:/components/CrashScene.brs
#0  Function triggercrash()
   file/line: pkg:/components/CrashScene.brs(12)
```

Redeploying `./test/fixtures/hello-world` recovers the device to a clean working state.

---

## 4. Troubleshooting Guide

| Issue / Error Code | Root Cause | Solution |
|:---|:---|:---|
| `DEVICE_UNREACHABLE` | TV is off, IP changed, or firewall blocks ports 80/8060/8080/8085. | Check `Settings → Network → About` on TV. Ensure TV and host are on the same Wi-Fi subnet. |
| `AUTH_FAILED` | Incorrect `ROKU_DEV_PASSWORD`. | Verify password in `.env`. Reset password by toggling Developer Mode off and on. |
| ECP Keypresses Ignored | "Control by mobile apps" disabled. | On TV: `Settings → System → Advanced system settings → Control by mobile apps` → set to **Enabled**. |
| `INSTALL_FAILED` | App compilation error or missing `manifest`. | Check BrightScript syntax and ensure `manifest` is in the project root. |
| `PORT_BUSY` | Multiple concurrent commands to Port 8080. | Handled automatically by `AsyncMutex`. Increase `ROKU_COMMAND_TIMEOUT_MS` if queries are large. |
| `TIMEOUT` | SceneGraph server or network latency. | Increase `timeout_seconds` in `roku_wait_for_condition` or check TV load. |
