import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InstallerAdapter } from "./adapters/installer.js";
import { EcpAdapter } from "./adapters/ecp.js";
import { SgDebugAdapter } from "./adapters/sg-debug.js";
import { BsConsoleAdapter } from "./adapters/bs-console.js";
import { RokuServerConfig } from "./config.js";
import { handleBuildAndDeploy } from "./tools/build-and-deploy.js";
import { handleBuild } from "./tools/build.js";
import { handleDeploy } from "./tools/deploy.js";
import { handleSendKeys } from "./tools/send-keys.js";
import { handleGetUiTree } from "./tools/get-ui-tree.js";
import { handleCaptureState } from "./tools/capture-state.js";
import { handleAssertPlayback } from "./tools/assert-playback.js";
import { handleWaitForCondition } from "./tools/wait-for-condition.js";
import { handleLaunch } from "./tools/launch.js";
import {
  BuildAndDeployInputSchema,
  BuildInputSchema,
  DeployInputSchema,
  SendKeysInputSchema,
  GetUiTreeInputSchema,
  CaptureStateInputSchema,
  AssertPlaybackInputSchema,
  WaitForConditionInputSchema,
  LaunchInputSchema,
} from "./types/tools.js";
import { createRokuError, ErrorCode, RokuDevError } from "./types/errors.js";

export interface ServerAdapters {
  installer: InstallerAdapter;
  ecp: EcpAdapter;
  sgDebug: SgDebugAdapter;
  bsConsole: BsConsoleAdapter;
}

export function createRokuDevServer(
  config: RokuServerConfig,
  adapters?: Partial<ServerAdapters>
): { server: McpServer; adapters: ServerAdapters } {
  const server = new McpServer({
    name: "roku-dev",
    version: "1.0.0",
    description:
      "Roku development toolkit for AI-assisted BrightScript/SceneGraph development",
  });

  const installer =
    adapters?.installer ??
    new InstallerAdapter({
      deviceIp: config.deviceIp,
      port: config.installerPort,
      devPassword: config.devPassword,
      timeoutMs: 15000,
    });

  const ecp =
    adapters?.ecp ??
    new EcpAdapter({
      deviceIp: config.deviceIp,
      port: config.ecpPort,
      defaultKeyDelayMs: config.keypressDelayMs,
      timeoutMs: 15000,
    });

  const sgDebug =
    adapters?.sgDebug ??
    new SgDebugAdapter({
      deviceIp: config.deviceIp,
      port: config.sgPort,
      connectTimeoutMs: config.connectTimeoutMs,
      commandTimeoutMs: config.commandTimeoutMs,
    });

  const bsConsole =
    adapters?.bsConsole ??
    new BsConsoleAdapter({
      deviceIp: config.deviceIp,
      port: config.bsPort,
      bufferSize: config.logBufferSize,
      connectTimeoutMs: config.connectTimeoutMs,
    });

  const fullAdapters: ServerAdapters = {
    installer,
    ecp,
    sgDebug,
    bsConsole,
  };

  function formatError(err: unknown) {
    if (err instanceof RokuDevError) {
      return err.toMcpResult();
    }
    const rokuErr = createRokuError(
      ErrorCode.PARSE_ERROR,
      err instanceof Error ? err.message : String(err)
    );
    return rokuErr.toMcpResult();
  }

  // 1. Tool: roku_build
  server.tool(
    "roku_build",
    "Runs the project's build script and returns its validated Roku ZIP package. Use package_path when a build emits multiple ZIPs.",
    BuildInputSchema.shape,
    async (args) => {
      try {
        const result = await handleBuild({ project_dir: args.project_dir, package_path: args.package_path });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 2. Tool: roku_deploy
  server.tool(
    "roku_deploy",
    "Validates and sideloads a pre-built Roku ZIP package. The ZIP must contain manifest at its root.",
    DeployInputSchema.shape,
    async (args) => {
      try {
        const result = await handleDeploy({ package_path: args.package_path, action: args.action }, { installer, bsConsole });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 3. Tool: roku_build_and_deploy
  server.tool(
    "roku_build_and_deploy",
    "Legacy convenience: zips source directly and sideloads it. Prefer roku_build then roku_deploy for projects with a build step.",
    BuildAndDeployInputSchema.shape,
    async (args) => {
      try {
        const result = await handleBuildAndDeploy(
          {
            source_dir: args.source_dir,
            action: args.action,
            exclude_patterns: args.exclude_patterns,
          },
          { installer, bsConsole }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 2. Tool: roku_send_keys
  server.tool(
    "roku_send_keys",
    "Sends a sequence of ECP keypress commands with configurable inter-key delay.",
    SendKeysInputSchema.shape,
    async (args) => {
      try {
        const result = await handleSendKeys(
          {
            keys: args.keys,
            delay_ms: args.delay_ms,
          },
          { ecp }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 3. Tool: roku_get_ui_tree
  server.tool(
    "roku_get_ui_tree",
    "Captures and parses the full SceneGraph node tree from the SG Debug Server.",
    GetUiTreeInputSchema.shape,
    async (args) => {
      try {
        const result = await handleGetUiTree(
          {
            filter_id: args.filter_id,
            include_fields: args.include_fields,
            max_depth: args.max_depth,
          },
          { sgDebug }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 4. Tool: roku_capture_state
  server.tool(
    "roku_capture_state",
    "Returns a multi-modal snapshot of the device's current state.",
    CaptureStateInputSchema.shape,
    async (args) => {
      try {
        const result = await handleCaptureState(
          {
            log_lines: args.log_lines,
            include_screenshot: args.include_screenshot,
            include_ui_tree: args.include_ui_tree,
          },
          { installer, ecp, sgDebug, bsConsole }
        );

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ];

        if (result.screenshot && result.screenshot.base64) {
          content.push({
            type: "image",
            data: result.screenshot.base64,
            mimeType:
              result.screenshot.format === "png"
                ? "image/png"
                : "image/jpeg",
          });
        }

        return { content };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 5. Tool: roku_assert_playback
  server.tool(
    "roku_assert_playback",
    "Queries the media player state to verify video playback status.",
    AssertPlaybackInputSchema.shape,
    async () => {
      try {
        const result = await handleAssertPlayback({ ecp });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 6. Tool: roku_wait_for_condition
  server.tool(
    "roku_wait_for_condition",
    "Polls for a condition to be satisfied, enabling deterministic waiting without hardcoded sleeps.",
    WaitForConditionInputSchema.shape,
    async (args) => {
      try {
        const result = await handleWaitForCondition(
          {
            condition: args.condition,
            timeout_seconds: args.timeout_seconds,
            poll_interval_ms: args.poll_interval_ms,
          },
          { ecp, sgDebug, bsConsole }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  // 7. Tool: roku_launch
  server.tool(
    "roku_launch",
    "Deep-link into a specific content item within the sideloaded app.",
    LaunchInputSchema.shape,
    async (args) => {
      try {
        const result = await handleLaunch(
          {
            content_id: args.content_id,
            media_type: args.media_type,
            params: args.params,
          },
          { ecp }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatError(err);
      }
    }
  );

  return { server, adapters: fullAdapters };
}
