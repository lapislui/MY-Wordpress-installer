// Deployment Manager: compares a local site with its SFTP target, uploads only
// changed files, and pushes the local database to the remote server over SSH
// (with a remote backup taken first).

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DEFAULT_EXCLUDES = [
  ".git", ".svn", ".hg", "node_modules", ".wpdesktop", ".idea", ".vscode",
  "wp-config.php", ".env", "wp-content/cache", "wp-content/upgrade", "wp-content/debug.log"
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function toPosix(relative) {
  return relative.split(path.sep).join("/");
}

function isExcluded(relative, excludes) {
  const posix = toPosix(relative);
  return excludes.some((pattern) => posix === pattern || posix.startsWith(`${pattern}/`));
}

function listLocalFiles(root, excludes) {
  const files = new Map();
  const stack = [""];
  while (stack.length) {
    const relativeDir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      if (isExcluded(relative, excludes)) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(relative);
      } else if (entry.isFile()) {
        const stats = fs.statSync(path.join(root, relative));
        files.set(toPosix(relative), { size: stats.size, mtime: Math.floor(stats.mtimeMs / 1000) });
      }
    }
  }
  return files;
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

async function listRemoteFiles(sftp, remoteRoot, excludes, onProgress) {
  const files = new Map();
  const stack = [""];
  let scanned = 0;
  while (stack.length) {
    const relativeDir = stack.pop();
    const remoteDir = relativeDir ? `${remoteRoot}/${relativeDir}` : remoteRoot;
    let entries;
    try {
      entries = await sftpCall(sftp, "readdir", remoteDir);
    } catch (error) {
      if (!relativeDir) {
        if (error.code === 2) {
          return files; // Remote folder doesn't exist yet: everything is new.
        }
        throw new Error(`Can't read remote folder ${remoteDir}: ${error.message}`);
      }
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.filename}` : entry.filename;
      if (isExcluded(relative, excludes)) {
        continue;
      }
      if (entry.attrs.isDirectory()) {
        stack.push(relative);
      } else if (entry.attrs.isFile()) {
        files.set(relative, { size: entry.attrs.size, mtime: entry.attrs.mtime });
      }
    }
    scanned += 1;
    if (scanned % 25 === 0) {
      onProgress?.({ logLine: `Scanned ${scanned} remote folders…` });
    }
  }
  return files;
}

function execRemote(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk) => { stdout += chunk; });
      stream.stderr.on("data", (chunk) => { stderr += chunk; });
      stream.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  });
}

function createDeployService({ findSite, getSshConnection, createSqlDump, getLocalDbProfile }) {
  async function getSiteWithSftp(siteId) {
    const site = await findSite(siteId);
    if (!site) {
      throw new Error("Site not found.");
    }
    if (!site.sftp?.host) {
      throw new Error("This site has no SFTP server configured. Set one up on the SFTP screen first.");
    }
    if (!site.path || !fs.existsSync(site.path)) {
      throw new Error("The site's local folder was not found.");
    }
    return site;
  }

  function getExcludes(site, extra = []) {
    return [...DEFAULT_EXCLUDES, ...(site.deploy?.excludes || []), ...extra].filter(Boolean);
  }

  async function plan(siteId, { onProgress } = {}) {
    const site = await getSiteWithSftp(siteId);
    const excludes = getExcludes(site);
    const remoteRoot = (site.sftp.remoteDir || ".").replace(/\/+$/, "") || "/";
    onProgress?.({ logLine: `Scanning local files in ${site.path}…` });
    const local = listLocalFiles(site.path, excludes);
    onProgress?.({ logLine: `Connecting to ${site.sftp.username}@${site.sftp.host}…` });
    const { conn, sftp } = await getSshConnection(site.sftp);
    try {
      onProgress?.({ logLine: `Scanning remote folder ${remoteRoot}…` });
      const remote = await listRemoteFiles(sftp, remoteRoot, excludes, onProgress);
      const changed = [];
      let bytes = 0;
      for (const [relative, info] of local) {
        const remoteInfo = remote.get(relative);
        const reason = !remoteInfo ? "new" : (remoteInfo.size !== info.size ? "size" : (info.mtime > remoteInfo.mtime ? "newer" : ""));
        if (reason) {
          changed.push({ path: relative, reason, size: info.size });
          bytes += info.size;
        }
      }
      const remoteOnly = [...remote.keys()].filter((relative) => !local.has(relative));
      changed.sort((a, b) => a.path.localeCompare(b.path));
      return {
        site: { id: site.id, name: site.name },
        target: `${site.sftp.username}@${site.sftp.host}:${remoteRoot}`,
        localCount: local.size,
        remoteCount: remote.size,
        changed,
        changedBytes: bytes,
        remoteOnly: remoteOnly.slice(0, 500),
        remoteOnlyCount: remoteOnly.length,
        excludes
      };
    } finally {
      conn.end();
    }
  }

  async function pushFiles(siteId, { files, onProgress, isCancelled } = {}) {
    const site = await getSiteWithSftp(siteId);
    const remoteRoot = (site.sftp.remoteDir || ".").replace(/\/+$/, "") || "/";
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      return { uploaded: 0 };
    }
    const { conn, sftp } = await getSshConnection(site.sftp);
    const createdDirs = new Set();
    const ensureDir = async (dir) => {
      if (!dir || dir === "." || dir === "/" || createdDirs.has(dir)) {
        return;
      }
      await ensureDir(path.posix.dirname(dir));
      try {
        await sftpCall(sftp, "mkdir", dir);
      } catch (_) {
        // Already exists.
      }
      createdDirs.add(dir);
    };
    let uploaded = 0;
    try {
      for (const relative of list) {
        if (isCancelled?.()) {
          onProgress?.({ logLine: "Upload cancelled.", isError: true });
          break;
        }
        const localPath = path.join(site.path, ...relative.split("/"));
        const remotePath = `${remoteRoot}/${relative}`;
        await ensureDir(path.posix.dirname(remotePath));
        await sftpCall(sftp, "fastPut", localPath, remotePath);
        uploaded += 1;
        onProgress?.({ logLine: `Uploaded ${relative}`, progress: Math.round((uploaded / list.length) * 100) });
      }
    } finally {
      conn.end();
    }
    return { uploaded, total: list.length };
  }

  async function pushDatabase(siteId, { remoteDb, remoteDbPassword, searchReplace, onProgress } = {}) {
    const site = await getSiteWithSftp(siteId);
    if (!remoteDb?.name || !remoteDb?.user) {
      throw new Error("Enter the remote database name and user first.");
    }
    const local = getLocalDbProfile(site);
    const dbName = site.dbName;
    if (!dbName) {
      throw new Error("The local site has no database name.");
    }

    onProgress?.({ logLine: `Exporting local database ${dbName}…`, progress: 5 });
    const connection = await mysql.createConnection({
      host: local.host, port: Number(local.port) || 3306, user: local.user, password: local.password
    });
    let dump;
    try {
      dump = await createSqlDump({ connection, dbName });
    } finally {
      await connection.end();
    }

    const { conn, sftp } = await getSshConnection(site.sftp);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const mysqlArgs = `-h ${shellQuote(remoteDb.host || "localhost")} -u ${shellQuote(remoteDb.user)} ${shellQuote(`-p${remoteDbPassword || ""}`)} ${shellQuote(remoteDb.name)}`;
    try {
      const home = (await sftpCall(sftp, "realpath", ".")).replace(/\/+$/, "");
      const backupFile = `${home}/wpdesktop-backup-${remoteDb.name}-${stamp}.sql`;
      const importFile = `${home}/wpdesktop-import-${stamp}.sql`;

      onProgress?.({ logLine: `Backing up remote database to ${backupFile}…`, progress: 25 });
      const backup = await execRemote(conn, `mysqldump ${mysqlArgs} > ${shellQuote(backupFile)}`);
      if (backup.code !== 0) {
        throw new Error(`Remote backup failed, nothing was changed: ${backup.stderr.trim() || `exit ${backup.code}`}`);
      }

      onProgress?.({ logLine: "Uploading database export…", progress: 45 });
      await new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(importFile);
        stream.on("close", resolve);
        stream.on("error", reject);
        stream.end(dump);
      });

      onProgress?.({ logLine: `Importing into ${remoteDb.name}…`, progress: 65 });
      const imported = await execRemote(conn, `mysql ${mysqlArgs} < ${shellQuote(importFile)}`);
      await execRemote(conn, `rm -f ${shellQuote(importFile)}`);
      if (imported.code !== 0) {
        throw new Error(`Import failed: ${imported.stderr.trim() || `exit ${imported.code}`}. Restore with: mysql … < ${backupFile}`);
      }

      const notes = [];
      if (searchReplace?.from && searchReplace?.to && searchReplace.from !== searchReplace.to) {
        onProgress?.({ logLine: `Replacing ${searchReplace.from} → ${searchReplace.to}…`, progress: 85 });
        const remoteRoot = site.sftp.remoteDir || ".";
        const replaced = await execRemote(
          conn,
          `wp search-replace ${shellQuote(searchReplace.from)} ${shellQuote(searchReplace.to)} --all-tables --skip-columns=guid --path=${shellQuote(remoteRoot)}`
        );
        if (replaced.code === 0) {
          notes.push(replaced.stdout.trim().split("\n").pop());
        } else {
          notes.push(`URL replacement skipped: WP-CLI isn't available on the server (${(replaced.stderr || "").trim().split("\n")[0]}). Run wp search-replace manually.`);
        }
      }

      onProgress?.({ logLine: "Database push complete.", progress: 100 });
      return { ok: true, backupFile, notes };
    } finally {
      conn.end();
    }
  }

  return { plan, pushFiles, pushDatabase };
}

module.exports = { createDeployService, shellQuote };
