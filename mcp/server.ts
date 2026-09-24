#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const store = null;
const inspector = null;
const server = null;

let activeBridge: { close: () => void } | null = null;
let activeStandalone: { store: any; inspector: any } | null = null;

function getMcpPortFromSettings(): number {
  try {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const settingsPath = path.join(appData, "WP Desktop", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (settings?.mcpServer?.port) {
        return Number(settings.mcpServer.port);
      }
    }
  } catch (_) {
    // Ignore and fall back to default
  }
  return 3789;
}

async function isElectronMcpRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp/status`);
    if (res.ok) {
      const data = await res.json() as any;
      return data?.running === true;
    }
  } catch (_) {
    // ignore
  }
  return false;
}

async function main() {
  const port = getMcpPortFromSettings();
  const isRunning = await isElectronMcpRunning(port);

  if (isRunning) {
    console.error(`[WP Desktop MCP] Connecting to running Electron app on port ${port}...`);
    const stdioTransport = new StdioServerTransport();
    const clientTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));

    stdioTransport.onmessage = (message) => {
      clientTransport.send(message).catch(err => {
        console.error("[WP Desktop MCP Bridge] Error sending to Electron:", err);
      });
    };

    clientTransport.onmessage = (message) => {
      stdioTransport.send(message).catch(err => {
        console.error("[WP Desktop MCP Bridge] Error sending to Stdio:", err);
      });
    };

    stdioTransport.onclose = () => {
      clientTransport.close();
      void shutdown(0);
    };

    clientTransport.onclose = () => {
      stdioTransport.close();
      void shutdown(0);
    };

    activeBridge = {
      close: () => {
        clientTransport.close();
        stdioTransport.close();
      }
    };

    await Promise.all([
      clientTransport.start(),
      stdioTransport.start()
    ]);
  } else {
    console.error("[WP Desktop MCP] Electron app not running. Starting standalone MCP server...");
    const { SnapshotStore } = await import("./core/snapshotStore.js");
    const { BrowserInspector } = await import("./core/browserInspector.js");
    const { createWpDesktopMcpServer } = await import("./core/mcpServerFactory.js");

    const localStore = new SnapshotStore(process.env.WPDESKTOP_MCP_HOME);
    const localInspector = new BrowserInspector(localStore);
    const localServer = createWpDesktopMcpServer({ store: localStore, inspector: localInspector });

    activeStandalone = { store: localStore, inspector: localInspector };

    const stdioTransport = new StdioServerTransport();
    await localServer.connect(stdioTransport);
  }
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

async function shutdown(code: number) {
  if (activeBridge) {
    activeBridge.close();
  } else if (activeStandalone) {
    await activeStandalone.inspector.close();
    activeStandalone.store.close();
  }
  process.exit(code);
}

main().catch(async (error) => {
  console.error(error);
  await shutdown(1);
});
