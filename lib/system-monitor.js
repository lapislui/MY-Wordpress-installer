// Real host metrics for the Server Monitor screen: CPU from os.cpus() deltas,
// memory, disk usage per drive, and reachability/latency of local dev services.

const os = require("os");
const fs = require("fs");
const net = require("net");
const http = require("http");

const DEV_SERVICES = [
  { name: "Web server (HTTP)", port: 80 },
  { name: "Web server (HTTPS)", port: 443 },
  { name: "MySQL / MariaDB", port: 3306 },
  { name: "PostgreSQL", port: 5432 },
  { name: "Redis", port: 6379 },
  { name: "Mailpit / MailHog", port: 8025 },
  { name: "Ollama", port: 11434 }
];

let previousCpuTimes = null;

function readCpuTimes() {
  return os.cpus().map((cpu) => {
    const times = cpu.times;
    return { idle: times.idle, total: times.user + times.nice + times.sys + times.irq + times.idle };
  });
}

// Percentage busy since the previous call (first call measures over 250 ms).
async function getCpuUsage() {
  let before = previousCpuTimes;
  if (!before) {
    before = readCpuTimes();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const after = readCpuTimes();
  previousCpuTimes = after;
  let idle = 0;
  let total = 0;
  after.forEach((cpu, index) => {
    idle += cpu.idle - (before[index]?.idle || 0);
    total += cpu.total - (before[index]?.total || 0);
  });
  return total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

function getDisks() {
  const roots = process.platform === "win32"
    ? "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\`)
    : ["/"];
  const disks = [];
  for (const root of roots) {
    try {
      if (process.platform === "win32" && !fs.existsSync(root)) {
        continue;
      }
      const stats = fs.statfsSync(root);
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      if (total > 0) {
        disks.push({ mount: root, total, free, used: total - free });
      }
    } catch (_) {
      // Unreadable drive (e.g. empty card reader) - skip it.
    }
  }
  return disks;
}

function checkPort(port, host = "127.0.0.1", timeoutMs = 600) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = net.connect({ port, host });
    const finish = (open) => {
      socket.destroy();
      resolve({ open, latencyMs: open ? Number(process.hrtime.bigint() - started) / 1e6 : null });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function timeHttpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      response.once("end", () => resolve({
        ok: true,
        status: response.statusCode,
        latencyMs: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10
      }));
    });
    request.once("timeout", () => { request.destroy(); resolve({ ok: false, error: "timed out" }); });
    request.once("error", (error) => resolve({ ok: false, error: error.code || error.message }));
  });
}

async function getSystemStats({ siteUrl } = {}) {
  const [cpuPercent, services, site] = await Promise.all([
    getCpuUsage(),
    Promise.all(DEV_SERVICES.map(async (service) => ({ ...service, ...(await checkPort(service.port)) }))),
    siteUrl ? timeHttpGet(siteUrl) : Promise.resolve(null)
  ]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus();
  return {
    timestamp: Date.now(),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    uptimeSeconds: os.uptime(),
    cpu: { percent: cpuPercent, cores: cpus.length, model: cpus[0]?.model?.trim() || "" },
    memory: { total: totalMem, free: freeMem, used: totalMem - freeMem, percent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 },
    disks: getDisks(),
    services,
    site: site ? { url: siteUrl, ...site } : null
  };
}

module.exports = { getSystemStats };
