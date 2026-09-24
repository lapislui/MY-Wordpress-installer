import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { SnapshotRecord } from "./snapshotStore.js";
import { SnapshotStore } from "./snapshotStore.js";

export type InspectOptions = {
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
  selector?: string;
  screenshot?: boolean;
  fullPage?: boolean;
};

export type PageInspection = {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  textSample: string;
  htmlHash: string;
  textHash: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ text: string; href: string }>;
  screenshotPath?: string;
  snapshotId?: number;
  changedFromPrevious?: boolean;
  previousSnapshotId?: number;
};

export class BrowserInspector {
  private browser: Browser | null = null;

  constructor(private readonly store: SnapshotStore) {}

  async inspect(options: InspectOptions): Promise<PageInspection> {
    const page = await this.newPage();
    try {
      await page.goto(options.url, {
        waitUntil: options.waitUntil || "domcontentloaded",
        timeout: options.timeoutMs || 30000
      });
      if (options.selector) {
        await page.locator(options.selector).first().waitFor({ timeout: options.timeoutMs || 30000 });
      }

      const title = await page.title();
      const finalUrl = page.url();
      const text = normalizeWhitespace(await page.locator("body").innerText({ timeout: 10000 }).catch(() => ""));
      const html = await page.content();
      const headings = await extractHeadings(page);
      const links = await extractLinks(page);
      let screenshotPath: string | undefined;

      if (options.screenshot) {
        screenshotPath = await this.writeScreenshot(page, options.fullPage !== false);
      }

      const previous = this.store.getLatestSnapshot(options.url);
      const snapshot = this.store.createSnapshot({
        url: options.url,
        finalUrl,
        title,
        text,
        htmlHash: sha256(html),
        textHash: sha256(text),
        screenshotPath,
        metadata: { headings, linksCount: links.length }
      });

      return {
        url: options.url,
        finalUrl,
        title,
        text,
        textSample: text.slice(0, 4000),
        htmlHash: snapshot.htmlHash,
        textHash: snapshot.textHash,
        headings,
        links,
        screenshotPath,
        snapshotId: snapshot.id,
        changedFromPrevious: previous ? previous.htmlHash !== snapshot.htmlHash || previous.textHash !== snapshot.textHash : undefined,
        previousSnapshotId: previous?.id
      };
    } finally {
      await page.close();
    }
  }

  compareWithLatest(current: PageInspection): { changed: boolean; summary: string; previous?: SnapshotRecord } {
    const snapshots = this.store.listSnapshots(current.url, 2);
    const previous = snapshots.find((snapshot) => snapshot.id !== current.snapshotId);
    if (!previous) {
      return { changed: false, summary: "No previous snapshot exists for this URL." };
    }

    const changed = previous.htmlHash !== current.htmlHash || previous.textHash !== current.textHash;
    return {
      changed,
      previous,
      summary: changed
        ? `Changed since snapshot ${previous.id}. Previous title: "${previous.title}".`
        : `No content hash changes since snapshot ${previous.id}.`
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  private async newPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    const context = await this.browser.newContext({
      viewport: { width: 1440, height: 1000 },
      userAgent: "WP Desktop MCP Inspector/0.1"
    });
    return context.newPage();
  }

  private async writeScreenshot(page: Page, fullPage: boolean): Promise<string> {
    const fileName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
    const target = path.join(this.store.screenshotsDir, fileName);
    await page.screenshot({ path: target, fullPage });
    fs.statSync(target);
    return target;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function extractHeadings(page: Page): Promise<Array<{ level: number; text: string }>> {
  return page.locator("h1,h2,h3,h4,h5,h6").evaluateAll((nodes) =>
    nodes.slice(0, 50).map((node) => ({
      level: Number(node.tagName.slice(1)),
      text: (node.textContent || "").replace(/\s+/g, " ").trim()
    })).filter((entry) => entry.text)
  );
}

async function extractLinks(page: Page): Promise<Array<{ text: string; href: string }>> {
  return page.locator("a[href]").evaluateAll((nodes) =>
    nodes.slice(0, 100).map((node) => ({
      text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
      href: (node as HTMLAnchorElement).href
    })).filter((entry) => entry.href)
  );
}
