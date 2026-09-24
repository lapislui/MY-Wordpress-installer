// MCP connectors: each connector stores its credentials in the encrypted
// secure store, can test its connection, and contributes tools to WP Desktop's
// built-in MCP server. Tools that change anything (posting, creating, purging,
// writing files) are only exposed when the user enables write actions for
// that connector.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const MAX_ROWS = 200;
const MAX_FILE_BYTES = 256 * 1024;

// --- helpers -----------------------------------------------------------------

async function httpJson(url, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  const response = await fetch(url, {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  if (!response.ok) {
    const detail = data?.message || data?.error?.message || data?.errors?.[0]?.message || (typeof data === "string" ? data.slice(0, 200) : "");
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return data;
}

function requireField(config, key, label) {
  const value = String(config[key] || "").trim();
  if (!value) {
    throw new Error(`${label} is not set.`);
  }
  return value;
}

function assertReadOnlySql(sql) {
  const statement = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!statement) {
    throw new Error("SQL is empty.");
  }
  if (statement.includes(";")) {
    throw new Error("Only one statement per query.");
  }
  if (!/^(select|show|describe|desc|explain|with)\b/i.test(statement)) {
    throw new Error("Only read-only queries (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH) are allowed.");
  }
  return statement;
}

function limitRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { rowCount: list.length, truncated: list.length > MAX_ROWS, rows: list.slice(0, MAX_ROWS) };
}

// --- connectors ----------------------------------------------------------------

function resolveInsideRoots(roots, target) {
  const resolved = path.resolve(String(target || ""));
  const root = roots.find((candidate) => {
    const base = path.resolve(candidate);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
  if (!root) {
    throw new Error(`Path is outside the allowed folders: ${roots.join(", ")}`);
  }
  return resolved;
}

const filesystem = {
  id: "mcp_filesystem",
  label: "Filesystem",
  fields: [
    { key: "roots", label: "Allowed folders (one per line)", type: "textarea", placeholder: "E:\\xampp\\htdocs" }
  ],
  getRoots(config) {
    return String(config.roots || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  },
  async test(config) {
    const roots = filesystem.getRoots(config);
    if (!roots.length) {
      throw new Error("Add at least one folder.");
    }
    const missing = roots.filter((root) => !fs.existsSync(root));
    if (missing.length) {
      throw new Error(`Folder not found: ${missing.join(", ")}`);
    }
    return `${roots.length} folder${roots.length === 1 ? "" : "s"} available.`;
  },
  tools(config) {
    const roots = filesystem.getRoots(config);
    return [
      {
        name: "fs_list_directory",
        description: `List files and folders. Allowed roots: ${roots.join(", ")}`,
        params: { path: { type: "string", description: "Absolute folder path" } },
        handler: async ({ path: target }) => {
          const folder = resolveInsideRoots(roots, target);
          return fs.readdirSync(folder, { withFileTypes: true }).map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: entry.isFile() ? fs.statSync(path.join(folder, entry.name)).size : undefined
          }));
        }
      },
      {
        name: "fs_read_file",
        description: "Read a text file (first 256 KB).",
        params: { path: { type: "string", description: "Absolute file path" } },
        handler: async ({ path: target }) => {
          const file = resolveInsideRoots(roots, target);
          const handle = fs.openSync(file, "r");
          try {
            const buffer = Buffer.alloc(Math.min(fs.fstatSync(handle).size, MAX_FILE_BYTES));
            fs.readSync(handle, buffer, 0, buffer.length, 0);
            return { path: file, truncated: fs.fstatSync(handle).size > MAX_FILE_BYTES, content: buffer.toString("utf8") };
          } finally {
            fs.closeSync(handle);
          }
        }
      },
      {
        name: "fs_search_files",
        description: "Find files whose name contains a substring (up to 200 results).",
        params: {
          root: { type: "string", description: "Folder to search in" },
          query: { type: "string", description: "Case-insensitive part of the file name" }
        },
        handler: async ({ root, query }) => {
          const start = resolveInsideRoots(roots, root);
          const needle = String(query || "").toLowerCase();
          const results = [];
          const stack = [start];
          while (stack.length && results.length < 200) {
            const folder = stack.pop();
            let entries = [];
            try {
              entries = fs.readdirSync(folder, { withFileTypes: true });
            } catch (_) {
              continue;
            }
            for (const entry of entries) {
              const full = path.join(folder, entry.name);
              if (entry.isDirectory()) {
                if (entry.name !== "node_modules" && entry.name !== ".git") {
                  stack.push(full);
                }
              } else if (entry.name.toLowerCase().includes(needle)) {
                results.push(full);
              }
            }
          }
          return results;
        }
      },
      {
        name: "fs_write_file",
        write: true,
        description: "Create or overwrite a text file.",
        params: {
          path: { type: "string", description: "Absolute file path" },
          content: { type: "string", description: "Full file content" }
        },
        handler: async ({ path: target, content }) => {
          const file = resolveInsideRoots(roots, target);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, String(content ?? ""), "utf8");
          return { written: file, bytes: Buffer.byteLength(String(content ?? "")) };
        }
      }
    ];
  }
};

const github = {
  id: "mcp_github",
  label: "GitHub",
  fields: [{ key: "token", label: "Personal access token", type: "password", secret: true, placeholder: "github_pat_…" }],
  api(config, pathname, options) {
    return httpJson(`https://api.github.com${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${requireField(config, "token", "Token")}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "WP-Desktop" }
    });
  },
  async test(config) {
    const user = await github.api(config, "/user");
    return `Signed in as ${user.login}.`;
  },
  tools(config) {
    const repoParams = {
      owner: { type: "string", description: "Repository owner" },
      repo: { type: "string", description: "Repository name" }
    };
    const encode = encodeURIComponent;
    return [
      {
        name: "github_list_repos",
        description: "List repositories the token can access, most recently updated first.",
        params: {},
        handler: async () => (await github.api(config, "/user/repos?per_page=100&sort=updated")).map((repo) => ({
          full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch, updated_at: repo.updated_at, url: repo.html_url
        }))
      },
      {
        name: "github_list_issues",
        description: "List issues in a repository (pull requests excluded).",
        params: { ...repoParams, state: { type: "string", description: "open, closed or all", optional: true } },
        handler: async ({ owner, repo, state }) => (await github.api(config, `/repos/${encode(owner)}/${encode(repo)}/issues?per_page=50&state=${encode(state || "open")}`))
          .filter((issue) => !issue.pull_request)
          .map((issue) => ({ number: issue.number, title: issue.title, state: issue.state, user: issue.user?.login, labels: issue.labels?.map((label) => label.name), url: issue.html_url }))
      },
      {
        name: "github_get_issue",
        description: "Get an issue with its body and comments.",
        params: { ...repoParams, number: { type: "number", description: "Issue number" } },
        handler: async ({ owner, repo, number }) => {
          const base = `/repos/${encode(owner)}/${encode(repo)}/issues/${Number(number)}`;
          const [issue, comments] = await Promise.all([github.api(config, base), github.api(config, `${base}/comments?per_page=50`)]);
          return { number: issue.number, title: issue.title, state: issue.state, body: issue.body, comments: comments.map((comment) => ({ user: comment.user?.login, body: comment.body })) };
        }
      },
      {
        name: "github_list_pull_requests",
        description: "List pull requests in a repository.",
        params: { ...repoParams, state: { type: "string", description: "open, closed or all", optional: true } },
        handler: async ({ owner, repo, state }) => (await github.api(config, `/repos/${encode(owner)}/${encode(repo)}/pulls?per_page=50&state=${encode(state || "open")}`))
          .map((pull) => ({ number: pull.number, title: pull.title, state: pull.state, head: pull.head?.ref, base: pull.base?.ref, user: pull.user?.login, url: pull.html_url }))
      },
      {
        name: "github_get_file",
        description: "Read a file from a repository.",
        params: { ...repoParams, path: { type: "string", description: "File path in the repo" }, ref: { type: "string", description: "Branch, tag or commit", optional: true } },
        handler: async ({ owner, repo, path: filePath, ref }) => {
          const data = await github.api(config, `/repos/${encode(owner)}/${encode(repo)}/contents/${filePath.split("/").map(encode).join("/")}${ref ? `?ref=${encode(ref)}` : ""}`);
          if (Array.isArray(data)) {
            return data.map((entry) => ({ name: entry.name, type: entry.type, path: entry.path }));
          }
          return { path: data.path, sha: data.sha, content: Buffer.from(data.content || "", "base64").toString("utf8").slice(0, MAX_FILE_BYTES) };
        }
      },
      {
        name: "github_create_issue",
        write: true,
        description: "Open a new issue.",
        params: { ...repoParams, title: { type: "string", description: "Issue title" }, body: { type: "string", description: "Issue body (Markdown)", optional: true } },
        handler: async ({ owner, repo, title, body }) => {
          const issue = await github.api(config, `/repos/${encode(owner)}/${encode(repo)}/issues`, { method: "POST", body: { title, body: body || "" } });
          return { number: issue.number, url: issue.html_url };
        }
      },
      {
        name: "github_comment_on_issue",
        write: true,
        description: "Comment on an issue or pull request.",
        params: { ...repoParams, number: { type: "number", description: "Issue or PR number" }, body: { type: "string", description: "Comment (Markdown)" } },
        handler: async ({ owner, repo, number, body }) => {
          const comment = await github.api(config, `/repos/${encode(owner)}/${encode(repo)}/issues/${Number(number)}/comments`, { method: "POST", body: { body } });
          return { url: comment.html_url };
        }
      }
    ];
  }
};

function sqlConnectorFields(defaultPort, defaultUser) {
  return [
    { key: "host", label: "Host", type: "text", placeholder: "127.0.0.1" },
    { key: "port", label: "Port", type: "text", placeholder: String(defaultPort) },
    { key: "user", label: "User", type: "text", placeholder: defaultUser },
    { key: "password", label: "Password", type: "password", secret: true },
    { key: "database", label: "Database", type: "text" }
  ];
}

const mysqlConnector = {
  id: "mcp_mysql",
  label: "MySQL",
  fields: sqlConnectorFields(3306, "root"),
  async withConnection(config, fn) {
    const connection = await mysql.createConnection({
      host: config.host || "127.0.0.1",
      port: Number(config.port) || 3306,
      user: config.user || "root",
      password: config.password || "",
      database: config.database || undefined,
      connectTimeout: 8000
    });
    try {
      return await fn(connection);
    } finally {
      await connection.end();
    }
  },
  async test(config) {
    const version = await mysqlConnector.withConnection(config, async (connection) => (await connection.query("SELECT VERSION() AS v"))[0][0].v);
    return `Connected to MySQL ${version}.`;
  },
  tools(config) {
    return [
      {
        name: "mysql_list_tables",
        description: "List tables in the configured database (or a named one).",
        params: { database: { type: "string", description: "Database name", optional: true } },
        handler: ({ database }) => mysqlConnector.withConnection(config, async (connection) => {
          const [rows] = await connection.query("SELECT TABLE_NAME AS name, TABLE_ROWS AS approx_rows FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database || config.database]);
          return rows;
        })
      },
      {
        name: "mysql_describe_table",
        description: "Show a table's columns.",
        params: { table: { type: "string", description: "Table name" } },
        handler: ({ table }) => mysqlConnector.withConnection(config, async (connection) => {
          const [rows] = await connection.query("SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS `key` FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [config.database, table]);
          return rows;
        })
      },
      {
        name: "mysql_query",
        description: `Run a read-only SQL query (SELECT/SHOW/DESCRIBE/EXPLAIN). Returns up to ${MAX_ROWS} rows.`,
        params: { sql: { type: "string", description: "One read-only statement" } },
        handler: ({ sql }) => mysqlConnector.withConnection(config, async (connection) => {
          const statement = assertReadOnlySql(sql);
          await connection.query("START TRANSACTION READ ONLY");
          try {
            const [rows] = await connection.query(statement);
            return limitRows(rows);
          } finally {
            await connection.query("ROLLBACK");
          }
        })
      }
    ];
  }
};

const postgresConnector = {
  id: "mcp_postgres",
  label: "PostgreSQL",
  fields: sqlConnectorFields(5432, "postgres"),
  async withClient(config, fn) {
    const { Client } = require("pg");
    const client = new Client({
      host: config.host || "127.0.0.1",
      port: Number(config.port) || 5432,
      user: config.user || "postgres",
      password: config.password || "",
      database: config.database || "postgres",
      connectionTimeoutMillis: 8000
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  },
  async test(config) {
    const version = await postgresConnector.withClient(config, async (client) => (await client.query("SHOW server_version")).rows[0].server_version);
    return `Connected to PostgreSQL ${version}.`;
  },
  tools(config) {
    return [
      {
        name: "postgres_list_tables",
        description: "List tables in the database.",
        params: { schema: { type: "string", description: "Schema name (default public)", optional: true } },
        handler: ({ schema }) => postgresConnector.withClient(config, async (client) =>
          (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [schema || "public"])).rows)
      },
      {
        name: "postgres_describe_table",
        description: "Show a table's columns.",
        params: { table: { type: "string", description: "Table name" }, schema: { type: "string", description: "Schema (default public)", optional: true } },
        handler: ({ table, schema }) => postgresConnector.withClient(config, async (client) =>
          (await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position", [schema || "public", table])).rows)
      },
      {
        name: "postgres_query",
        description: `Run a read-only SQL query. Returns up to ${MAX_ROWS} rows.`,
        params: { sql: { type: "string", description: "One read-only statement" } },
        handler: ({ sql }) => postgresConnector.withClient(config, async (client) => {
          const statement = assertReadOnlySql(sql);
          await client.query("BEGIN TRANSACTION READ ONLY");
          try {
            const result = await client.query(statement);
            return limitRows(result.rows);
          } finally {
            await client.query("ROLLBACK");
          }
        })
      }
    ];
  }
};

const browser = {
  id: "mcp_browser",
  label: "Browser automation",
  fields: [],
  builtIn: true,
  async test(_config, deps) {
    const tabs = deps.listTabs ? deps.listTabs() : [];
    return `Browser tools are built in. ${tabs.length} tab${tabs.length === 1 ? "" : "s"} open.`;
  },
  tools() {
    return [];
  }
};

const slack = {
  id: "mcp_slack",
  label: "Slack",
  fields: [{ key: "token", label: "Bot token", type: "password", secret: true, placeholder: "xoxb-…" }],
  async api(config, method, params = {}, httpMethod = "GET") {
    const token = requireField(config, "token", "Bot token");
    const url = new URL(`https://slack.com/api/${method}`);
    let data;
    if (httpMethod === "GET") {
      Object.entries(params).forEach(([key, value]) => value !== undefined && url.searchParams.set(key, String(value)));
      data = await httpJson(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    } else {
      data = await httpJson(url.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: params });
    }
    if (!data.ok) {
      throw new Error(`Slack: ${data.error}`);
    }
    return data;
  },
  async test(config) {
    const data = await slack.api(config, "auth.test");
    return `Connected to ${data.team} as ${data.user}.`;
  },
  tools(config) {
    return [
      {
        name: "slack_list_channels",
        description: "List public channels the bot can see.",
        params: {},
        handler: async () => (await slack.api(config, "conversations.list", { limit: 200, exclude_archived: true, types: "public_channel,private_channel" }))
          .channels.map((channel) => ({ id: channel.id, name: channel.name, is_member: channel.is_member, topic: channel.topic?.value }))
      },
      {
        name: "slack_read_channel",
        description: "Read recent messages from a channel the bot is in.",
        params: { channel: { type: "string", description: "Channel ID" }, limit: { type: "number", description: "Messages to fetch (max 100)", optional: true } },
        handler: async ({ channel, limit }) => (await slack.api(config, "conversations.history", { channel, limit: Math.min(Number(limit) || 30, 100) }))
          .messages.map((message) => ({ user: message.user || message.bot_id, text: message.text, ts: message.ts }))
      },
      {
        name: "slack_post_message",
        write: true,
        description: "Post a message to a channel.",
        params: { channel: { type: "string", description: "Channel ID" }, text: { type: "string", description: "Message text" } },
        handler: async ({ channel, text }) => {
          const data = await slack.api(config, "chat.postMessage", { channel, text }, "POST");
          return { channel: data.channel, ts: data.ts };
        }
      }
    ];
  }
};

function notionText(richText) {
  return (richText || []).map((part) => part.plain_text || "").join("");
}

const notion = {
  id: "mcp_notion",
  label: "Notion",
  fields: [{ key: "token", label: "Integration secret", type: "password", secret: true, placeholder: "ntn_…" }],
  api(config, pathname, options = {}) {
    return httpJson(`https://api.notion.com/v1${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${requireField(config, "token", "Integration secret")}`, "Notion-Version": "2022-06-28" }
    });
  },
  async test(config) {
    const me = await notion.api(config, "/users/me");
    return `Connected as ${me.name || me.bot?.owner?.type || "integration"}.`;
  },
  tools(config) {
    return [
      {
        name: "notion_search",
        description: "Search pages and databases shared with the integration.",
        params: { query: { type: "string", description: "Search text" } },
        handler: async ({ query }) => (await notion.api(config, "/search", { method: "POST", body: { query, page_size: 25 } })).results.map((item) => ({
          id: item.id,
          type: item.object,
          title: notionText(item.properties?.title?.title || item.properties?.Name?.title || item.title),
          url: item.url
        }))
      },
      {
        name: "notion_read_page",
        description: "Read a page's text content.",
        params: { pageId: { type: "string", description: "Page ID" } },
        handler: async ({ pageId }) => {
          const blocks = await notion.api(config, `/blocks/${encodeURIComponent(pageId)}/children?page_size=100`);
          return blocks.results.map((block) => {
            const body = block[block.type] || {};
            return `${block.type}: ${notionText(body.rich_text)}`;
          }).join("\n");
        }
      },
      {
        name: "notion_append_paragraph",
        write: true,
        description: "Append a paragraph to a page.",
        params: { pageId: { type: "string", description: "Page ID" }, text: { type: "string", description: "Paragraph text" } },
        handler: async ({ pageId, text }) => {
          await notion.api(config, `/blocks/${encodeURIComponent(pageId)}/children`, {
            method: "PATCH",
            body: { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } }] }
          });
          return { appended: true };
        }
      }
    ];
  }
};

// Google Drive via a service account: share folders with the service
// account's email and paste its JSON key.
const gdriveTokenCache = new Map();

async function getGoogleAccessToken(serviceAccountJson) {
  let key;
  try {
    key = JSON.parse(serviceAccountJson);
  } catch (_) {
    throw new Error("The service account key isn't valid JSON.");
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("The JSON key is missing client_email or private_key.");
  }
  const cached = gdriveTokenCache.get(key.client_email);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return { token: cached.token, email: key.client_email };
  }
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google sign-in failed: ${data.error_description || data.error}`);
  }
  gdriveTokenCache.set(key.client_email, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return { token: data.access_token, email: key.client_email };
}

const gdrive = {
  id: "mcp_gdrive",
  label: "Google Drive",
  fields: [{ key: "serviceAccount", label: "Service account JSON key", type: "textarea", secret: true, placeholder: "{ \"type\": \"service_account\", … }" }],
  async api(config, pathname, { raw = false } = {}) {
    const { token } = await getGoogleAccessToken(requireField(config, "serviceAccount", "Service account key"));
    const response = await fetch(`https://www.googleapis.com/drive/v3${pathname}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      throw new Error(`Google Drive HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return raw ? response : response.json();
  },
  async test(config) {
    const { email } = await getGoogleAccessToken(requireField(config, "serviceAccount", "Service account key"));
    const files = await gdrive.api(config, "/files?pageSize=1&fields=files(id)");
    return `Signed in as ${email}. ${files.files.length ? "Shared files are visible." : "No files are shared with this account yet."}`;
  },
  tools(config) {
    return [
      {
        name: "gdrive_search",
        description: "Search Drive files shared with the service account by name or content.",
        params: { query: { type: "string", description: "Text to search for" } },
        handler: async ({ query }) => {
          const escaped = String(query).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
          const q = encodeURIComponent(`(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`);
          return (await gdrive.api(config, `/files?q=${q}&pageSize=25&fields=files(id,name,mimeType,modifiedTime,webViewLink)`)).files;
        }
      },
      {
        name: "gdrive_list_folder",
        description: "List files in a folder.",
        params: { folderId: { type: "string", description: "Folder ID" } },
        handler: async ({ folderId }) => {
          const q = encodeURIComponent(`'${String(folderId).replace(/'/g, "")}' in parents and trashed = false`);
          return (await gdrive.api(config, `/files?q=${q}&pageSize=100&fields=files(id,name,mimeType,modifiedTime)`)).files;
        }
      },
      {
        name: "gdrive_read_file",
        description: "Read a file's text. Google Docs/Sheets/Slides are exported as plain text/CSV.",
        params: { fileId: { type: "string", description: "File ID" } },
        handler: async ({ fileId }) => {
          const id = encodeURIComponent(fileId);
          const meta = await gdrive.api(config, `/files/${id}?fields=id,name,mimeType,size`);
          const exportTypes = {
            "application/vnd.google-apps.document": "text/plain",
            "application/vnd.google-apps.spreadsheet": "text/csv",
            "application/vnd.google-apps.presentation": "text/plain"
          };
          const exportType = exportTypes[meta.mimeType];
          if (!exportType && Number(meta.size) > MAX_FILE_BYTES * 4) {
            throw new Error("File is too large to read.");
          }
          const response = await gdrive.api(config, exportType ? `/files/${id}/export?mimeType=${encodeURIComponent(exportType)}` : `/files/${id}?alt=media`, { raw: true });
          return { name: meta.name, mimeType: meta.mimeType, content: (await response.text()).slice(0, MAX_FILE_BYTES) };
        }
      }
    ];
  }
};

const cloudflare = {
  id: "mcp_cloudflare",
  label: "Cloudflare",
  fields: [{ key: "token", label: "API token", type: "password", secret: true }],
  async api(config, pathname, options = {}) {
    const data = await httpJson(`https://api.cloudflare.com/client/v4${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${requireField(config, "token", "API token")}` }
    });
    if (!data.success) {
      throw new Error(`Cloudflare: ${data.errors?.map((error) => error.message).join(", ")}`);
    }
    return data.result;
  },
  async test(config) {
    const result = await cloudflare.api(config, "/user/tokens/verify");
    const zones = await cloudflare.api(config, "/zones?per_page=50");
    return `Token is ${result.status}. ${zones.length} zone${zones.length === 1 ? "" : "s"} accessible.`;
  },
  tools(config) {
    return [
      {
        name: "cloudflare_list_zones",
        description: "List zones (domains) the token can access.",
        params: {},
        handler: async () => (await cloudflare.api(config, "/zones?per_page=50")).map((zone) => ({ id: zone.id, name: zone.name, status: zone.status, plan: zone.plan?.name }))
      },
      {
        name: "cloudflare_list_dns_records",
        description: "List DNS records for a zone.",
        params: { zoneId: { type: "string", description: "Zone ID" } },
        handler: async ({ zoneId }) => (await cloudflare.api(config, `/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100`))
          .map((record) => ({ id: record.id, type: record.type, name: record.name, content: record.content, proxied: record.proxied, ttl: record.ttl }))
      },
      {
        name: "cloudflare_purge_cache",
        write: true,
        description: "Purge the cache for specific URLs, or everything when no URLs are given.",
        params: {
          zoneId: { type: "string", description: "Zone ID" },
          urls: { type: "array", description: "Full URLs to purge", optional: true }
        },
        handler: async ({ zoneId, urls }) => {
          const body = Array.isArray(urls) && urls.length ? { files: urls.slice(0, 30) } : { purge_everything: true };
          await cloudflare.api(config, `/zones/${encodeURIComponent(zoneId)}/purge_cache`, { method: "POST", body });
          return { purged: body.files ? body.files.length : "everything" };
        }
      }
    ];
  }
};

const CONNECTORS = [filesystem, github, postgresConnector, mysqlConnector, browser, slack, notion, gdrive, cloudflare];

function createMcpConnectors({ secureStore, deps = {} }) {
  const byId = new Map(CONNECTORS.map((connector) => [connector.id, connector]));

  function getConnector(id) {
    const connector = byId.get(id);
    if (!connector) {
      throw new Error(`Unknown connector ${id}.`);
    }
    return connector;
  }

  function getState(id) {
    return { enabled: false, allowWrites: false, config: {}, lastTest: null, ...(secureStore.get(`mcp.connector.${id}`) || {}) };
  }

  // Secrets never go back to the renderer; it only learns whether they're set.
  function describe(id) {
    const connector = getConnector(id);
    const state = getState(id);
    const config = {};
    const secretsSet = {};
    for (const field of connector.fields) {
      if (field.secret) {
        secretsSet[field.key] = Boolean(state.config[field.key]);
      } else {
        config[field.key] = state.config[field.key] || "";
      }
    }
    const tools = safeTools(connector, state.config);
    return {
      id,
      label: connector.label,
      builtIn: Boolean(connector.builtIn),
      fields: connector.fields.map(({ key, label, type, secret, placeholder }) => ({ key, label, type, secret: Boolean(secret), placeholder: placeholder || "" })),
      config,
      secretsSet,
      enabled: state.enabled,
      allowWrites: state.allowWrites,
      lastTest: state.lastTest,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, write: Boolean(tool.write) }))
    };
  }

  function safeTools(connector, config) {
    try {
      return connector.tools(config, deps);
    } catch (_) {
      return [];
    }
  }

  function save(id, { config = {}, enabled, allowWrites } = {}) {
    const connector = getConnector(id);
    const state = getState(id);
    for (const field of connector.fields) {
      if (!(field.key in config)) {
        continue;
      }
      const value = String(config[field.key] ?? "");
      // An empty secret field means "keep the saved one".
      if (field.secret && !value) {
        continue;
      }
      state.config[field.key] = value;
    }
    if (typeof enabled === "boolean") {
      state.enabled = enabled;
    }
    if (typeof allowWrites === "boolean") {
      state.allowWrites = allowWrites;
    }
    secureStore.set(`mcp.connector.${id}`, state);
    return describe(id);
  }

  function clearSecret(id, key) {
    const state = getState(id);
    delete state.config[key];
    secureStore.set(`mcp.connector.${id}`, state);
    return describe(id);
  }

  async function test(id) {
    const connector = getConnector(id);
    const state = getState(id);
    let result;
    try {
      result = { ok: true, message: await connector.test(state.config, deps), at: new Date().toISOString() };
    } catch (error) {
      result = { ok: false, message: error.message, at: new Date().toISOString() };
    }
    state.lastTest = result;
    secureStore.set(`mcp.connector.${id}`, state);
    return describe(id);
  }

  // Tools for the MCP server: only enabled connectors, and write tools only
  // when the user allowed them.
  function listTools() {
    const tools = [];
    for (const connector of CONNECTORS) {
      const state = getState(connector.id);
      if (!state.enabled) {
        continue;
      }
      for (const tool of safeTools(connector, state.config)) {
        if (tool.write && !state.allowWrites) {
          continue;
        }
        tools.push({
          name: tool.name,
          title: `${connector.label}: ${tool.name}`,
          description: tool.description,
          params: tool.params || {},
          write: Boolean(tool.write),
          handler: tool.handler
        });
      }
    }
    return tools;
  }

  async function callTool(name, args) {
    const tool = listTools().find((item) => item.name === name);
    if (!tool) {
      throw new Error(`Tool ${name} is not enabled.`);
    }
    return tool.handler(args || {});
  }

  return {
    list: () => CONNECTORS.map((connector) => describe(connector.id)),
    describe,
    save,
    clearSecret,
    test,
    listTools,
    callTool
  };
}

module.exports = { createMcpConnectors };
