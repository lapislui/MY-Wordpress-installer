import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrowserInspector } from "./browserInspector.js";
import type { SnapshotStore } from "./snapshotStore.js";

export type WpDesktopMcpDeps = {
  store: SnapshotStore;
  inspector: BrowserInspector;
  listTabs?: () => Array<{ id: string; title: string; url: string; isLoading: boolean; nickname?: string }>;
  createTab?: (url: string, mode?: string) => Promise<void>;
  closeTab?: (tabId: string) => Promise<void>;
  navigateTab?: (tabId: string, url: string) => Promise<void>;
  executeTabJs?: (tabId: string, js: string) => Promise<any>;
  listSites?: () => any[];
  getSftpStatus?: () => any;
  startSftpServer?: (overrides?: any) => Promise<any>;
  stopSftpServer?: () => Promise<any>;
  clickElement?: (tabId: string, selector: string) => Promise<any>;
  fillInput?: (tabId: string, selector: string, value: string) => Promise<any>;
  getHtml?: (tabId: string) => Promise<string>;
  getElementInfo?: (tabId: string, selector: string) => Promise<any>;
  getConsoleLogs?: (tabId: string) => Promise<any[]>;
  getNetworkRequests?: (tabId: string) => Promise<any[]>;
  getPerformanceMetrics?: (tabId: string) => Promise<any>;
  takeTabScreenshot?: (tabId: string) => Promise<string>;
};

export function createWpDesktopMcpServer(deps: WpDesktopMcpDeps): McpServer {
  const { store, inspector } = deps;
  const server = new McpServer({
    name: "wp-desktop-site-inspector",
    version: "0.1.0"
  });

  // Helper check for Electron environment
  const assertElectron = <T>(cb: T | undefined): T => {
    if (!cb) {
      throw new Error("This tool is only available when the WP Desktop Electron application is running.");
    }
    return cb;
  };

  server.registerTool(
    "browser_list_tabs",
    {
      title: "List Browser Tabs",
      description: "List all active browser tabs in the running WP Desktop Electron application.",
      inputSchema: z.object({})
    },
    async () => {
      const listTabs = assertElectron(deps.listTabs);
      return jsonContent(listTabs());
    }
  );

  server.registerTool(
    "browser_create_tab",
    {
      title: "Create Browser Tab",
      description: "Create a new browser tab in the running WP Desktop Electron application.",
      inputSchema: z.object({
        url: z.string().url().describe("The URL to open in the new tab."),
        mode: z.enum(["auto", "normal", "incognito"]).optional().default("auto")
      })
    },
    async (args) => {
      const createTab = assertElectron(deps.createTab);
      await createTab(args.url, args.mode);
      return jsonContent({ success: true, message: "Created tab successfully." });
    }
  );

  server.registerTool(
    "browser_close_tab",
    {
      title: "Close Browser Tab",
      description: "Close an active browser tab by its ID in the running WP Desktop Electron application.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab to close.")
      })
    },
    async (args) => {
      const closeTab = assertElectron(deps.closeTab);
      await closeTab(args.tabId);
      return jsonContent({ success: true, message: `Closed tab ${args.tabId} successfully.` });
    }
  );

  server.registerTool(
    "browser_navigate",
    {
      title: "Navigate Browser Tab",
      description: "Navigate an existing browser tab to a new URL in the running WP Desktop Electron application.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab to navigate."),
        url: z.string().url().describe("The destination URL.")
      })
    },
    async (args) => {
      const navigateTab = assertElectron(deps.navigateTab);
      await navigateTab(args.tabId, args.url);
      return jsonContent({ success: true, message: `Navigated tab ${args.tabId} to ${args.url} successfully.` });
    }
  );

  server.registerTool(
    "browser_execute_js",
    {
      title: "Execute JS in Tab",
      description: "Evaluate a JavaScript script within the context of an open browser tab and return the result.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab in which to execute script."),
        script: z.string().describe("The JavaScript code string to evaluate.")
      })
    },
    async (args) => {
      const executeTabJs = assertElectron(deps.executeTabJs);
      const result = await executeTabJs(args.tabId, args.script);
      return jsonContent({ result });
    }
  );

  server.registerTool(
    "workspace_list_sites",
    {
      title: "List Workspace Sites",
      description: "Retrieve list of all local WordPress sites registered in WP Desktop.",
      inputSchema: z.object({})
    },
    async () => {
      const listSites = assertElectron(deps.listSites);
      return jsonContent(listSites());
    }
  );

  server.registerTool(
    "sftp_get_status",
    {
      title: "Get SFTP Status",
      description: "Check the status of the local SFTP server hosted by WP Desktop.",
      inputSchema: z.object({})
    },
    async () => {
      const getSftpStatus = assertElectron(deps.getSftpStatus);
      return jsonContent(getSftpStatus());
    }
  );

  server.registerTool(
    "sftp_start",
    {
      title: "Start SFTP Server",
      description: "Start the local SFTP server on the specified port, username, password, or configuration overrides.",
      inputSchema: z.object({
        port: z.number().int().min(1).max(65535).optional(),
        username: z.string().optional(),
        password: z.string().optional()
      })
    },
    async (args) => {
      const startSftpServer = assertElectron(deps.startSftpServer);
      const result = await startSftpServer(args);
      return jsonContent(result);
    }
  );

  server.registerTool(
    "sftp_stop",
    {
      title: "Stop SFTP Server",
      description: "Stop the running local SFTP server.",
      inputSchema: z.object({})
    },
    async () => {
      const stopSftpServer = assertElectron(deps.stopSftpServer);
      const result = await stopSftpServer();
      return jsonContent(result);
    }
  );

  server.registerTool(
    "browser_click_element",
    {
      title: "Click Element in Tab",
      description: "Click a DOM element matching a CSS selector inside an open browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab containing the element."),
        selector: z.string().describe("The CSS selector of the element to click.")
      })
    },
    async (args) => {
      const clickElement = assertElectron(deps.clickElement);
      const result = await clickElement(args.tabId, args.selector);
      return jsonContent(result);
    }
  );

  server.registerTool(
    "browser_fill_input",
    {
      title: "Fill Input in Tab",
      description: "Fill a form input field matching a CSS selector with a value inside an open browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab containing the input."),
        selector: z.string().describe("The CSS selector of the input field."),
        value: z.string().describe("The text value to type/fill.")
      })
    },
    async (args) => {
      const fillInput = assertElectron(deps.fillInput);
      const result = await fillInput(args.tabId, args.selector, args.value);
      return jsonContent(result);
    }
  );

  server.registerTool(
    "browser_get_html",
    {
      title: "Get Tab HTML",
      description: "Get the full DOM HTML structure of a browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab.")
      })
    },
    async (args) => {
      const getHtml = assertElectron(deps.getHtml);
      const html = await getHtml(args.tabId);
      return jsonContent({ html });
    }
  );

  server.registerTool(
    "browser_get_element_info",
    {
      title: "Get Element Details",
      description: "Inspect HTML structure, size/bounds, and computed CSS styles of an element matching a CSS selector in a browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab containing the element."),
        selector: z.string().describe("The CSS selector of the element to inspect.")
      })
    },
    async (args) => {
      const getElementInfo = assertElectron(deps.getElementInfo);
      const info = await getElementInfo(args.tabId, args.selector);
      return jsonContent(info);
    }
  );

  server.registerTool(
    "browser_get_console_logs",
    {
      title: "Get Tab Console Logs",
      description: "Retrieve recorded console logs and JavaScript errors for a browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab.")
      })
    },
    async (args) => {
      const getConsoleLogs = assertElectron(deps.getConsoleLogs);
      const logs = await getConsoleLogs(args.tabId);
      return jsonContent({ logs });
    }
  );

  server.registerTool(
    "browser_get_network_requests",
    {
      title: "Get Tab Network Logs",
      description: "Retrieve recorded API calls and network request logs for a browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab.")
      })
    },
    async (args) => {
      const getNetworkRequests = assertElectron(deps.getNetworkRequests);
      const requests = await getNetworkRequests(args.tabId);
      return jsonContent({ requests });
    }
  );

  server.registerTool(
    "browser_get_performance_metrics",
    {
      title: "Get Tab Performance Metrics",
      description: "Measure Core Web Vitals (FCP, LCP, CLS) of a browser tab.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab.")
      })
    },
    async (args) => {
      const getPerformanceMetrics = assertElectron(deps.getPerformanceMetrics);
      const metrics = await getPerformanceMetrics(args.tabId);
      return jsonContent(metrics);
    }
  );

  server.registerTool(
    "browser_take_tab_screenshot",
    {
      title: "Capture Tab Screenshot",
      description: "Capture a full visual PNG screenshot of the tab's current view.",
      inputSchema: z.object({
        tabId: z.string().describe("The ID of the tab to capture.")
      })
    },
    async (args) => {
      const takeTabScreenshot = assertElectron(deps.takeTabScreenshot);
      const screenshotBase64 = await takeTabScreenshot(args.tabId);
      return jsonContent({ screenshotBase64 });
    }
  );

  server.registerTool(
    "inspect_page",
    {
      title: "Inspect Page",
      description: "Open a URL with Playwright, extract title, visible text, headings, links, hashes, and optionally a screenshot. Saves a SQLite snapshot.",
      inputSchema: {
        url: z.string().url().describe("Website URL to inspect."),
        waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().default("domcontentloaded"),
        timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
        selector: z.string().optional().describe("Optional CSS selector to wait for before capturing the page."),
        screenshot: z.boolean().optional().default(false),
        fullPage: z.boolean().optional().default(true)
      }
    },
    async (args) => jsonContent(await inspector.inspect(args))
  );

  server.registerTool(
    "screenshot_page",
    {
      title: "Screenshot Page",
      description: "Capture a page screenshot with Playwright and store the screenshot path in SQLite snapshot history.",
      inputSchema: {
        url: z.string().url(),
        fullPage: z.boolean().optional().default(true),
        waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().default("domcontentloaded"),
        timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
        selector: z.string().optional()
      }
    },
    async (args) => {
      const result = await inspector.inspect({ ...args, screenshot: true });
      return jsonContent({
        snapshotId: result.snapshotId,
        url: result.url,
        finalUrl: result.finalUrl,
        title: result.title,
        screenshotPath: result.screenshotPath,
        changedFromPrevious: result.changedFromPrevious
      });
    }
  );

  server.registerTool(
    "detect_site_change",
    {
      title: "Detect Site Change",
      description: "Inspect a URL and compare it against the previous SQLite snapshot for that same URL.",
      inputSchema: {
        url: z.string().url(),
        waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().default("domcontentloaded"),
        timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
        selector: z.string().optional()
      }
    },
    async (args) => {
      const current = await inspector.inspect({ ...args, screenshot: false });
      const comparison = inspector.compareWithLatest(current);
      return jsonContent({
        currentSnapshotId: current.snapshotId,
        previousSnapshotId: comparison.previous?.id,
        changed: comparison.changed,
        summary: comparison.summary,
        current: {
          finalUrl: current.finalUrl,
          title: current.title,
          htmlHash: current.htmlHash,
          textHash: current.textHash,
          textSample: current.textSample
        },
        previous: comparison.previous ? {
          title: comparison.previous.title,
          htmlHash: comparison.previous.htmlHash,
          textHash: comparison.previous.textHash,
          createdAt: comparison.previous.createdAt
        } : null
      });
    }
  );

  server.registerTool(
    "list_snapshots",
    {
      title: "List Snapshots",
      description: "List persisted page snapshots from SQLite.",
      inputSchema: {
        url: z.string().url().optional(),
        limit: z.number().int().min(1).max(100).optional().default(20)
      }
    },
    async ({ url, limit }) => jsonContent(store.listSnapshots(url, limit).map((snapshot) => ({
      id: snapshot.id,
      url: snapshot.url,
      finalUrl: snapshot.finalUrl,
      title: snapshot.title,
      htmlHash: snapshot.htmlHash,
      textHash: snapshot.textHash,
      screenshotPath: snapshot.screenshotPath,
      createdAt: snapshot.createdAt
    })))
  );

  server.registerTool(
    "get_snapshot",
    {
      title: "Get Snapshot",
      description: "Read a stored snapshot by id, including text sample and screenshot path.",
      inputSchema: {
        id: z.number().int().positive()
      }
    },
    async ({ id }) => {
      const snapshot = store.getSnapshot(id);
      if (!snapshot) {
        return jsonContent({ error: `Snapshot ${id} was not found.` }, true);
      }
      return jsonContent({
        ...snapshot,
        textSample: snapshot.text.slice(0, 8000),
        text: undefined
      });
    }
  );

  return server;
}

function jsonContent(value: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
