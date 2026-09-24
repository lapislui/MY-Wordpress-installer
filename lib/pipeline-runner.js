// CI/CD Runner: detects build/test steps for a site (npm/composer scripts,
// PHPUnit, PHPCS), lets the user save a custom pipeline per site, and runs
// steps sequentially with streamed output. Stops at the first failing step.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PIPELINE_FILE = path.join(".wpdesktop", "pipeline.json");
const INTERESTING_NPM_SCRIPTS = ["lint", "lint:js", "lint:css", "test", "test:unit", "build", "production", "prod"];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

// Themes/plugins usually carry the package.json, not the WordPress root.
function findProjectRoots(sitePath) {
  const roots = [sitePath];
  for (const group of ["wp-content/themes", "wp-content/plugins"]) {
    const groupPath = path.join(sitePath, ...group.split("/"));
    let entries = [];
    try {
      entries = fs.readdirSync(groupPath, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(groupPath, entry.name);
      if (entry.isDirectory() && (fs.existsSync(path.join(candidate, "package.json")) || fs.existsSync(path.join(candidate, "composer.json")))) {
        roots.push(candidate);
      }
    }
  }
  return roots;
}

function detectSteps(sitePath) {
  const steps = [];
  for (const root of findProjectRoots(sitePath)) {
    const relative = path.relative(sitePath, root).split(path.sep).join("/") || ".";
    const label = relative === "." ? "" : ` (${relative.split("/").pop()})`;

    const pkg = readJson(path.join(root, "package.json"));
    if (pkg) {
      const hasLock = fs.existsSync(path.join(root, "package-lock.json"));
      steps.push({ name: `Install npm packages${label}`, command: hasLock ? "npm ci" : "npm install", cwd: relative });
      const scripts = Object.keys(pkg.scripts || {});
      for (const script of INTERESTING_NPM_SCRIPTS.filter((name) => scripts.includes(name))) {
        steps.push({ name: `npm run ${script}${label}`, command: `npm run ${script}`, cwd: relative });
      }
    }

    const composer = readJson(path.join(root, "composer.json"));
    if (composer) {
      steps.push({ name: `Install Composer packages${label}`, command: "composer install --no-interaction --prefer-dist", cwd: relative });
      const composerScripts = Object.keys(composer.scripts || {});
      for (const script of ["lint", "phpcs", "test"].filter((name) => composerScripts.includes(name))) {
        steps.push({ name: `composer ${script}${label}`, command: `composer run-script ${script}`, cwd: relative });
      }
      if (!composerScripts.includes("test") && (fs.existsSync(path.join(root, "phpunit.xml")) || fs.existsSync(path.join(root, "phpunit.xml.dist")))) {
        steps.push({ name: `PHPUnit${label}`, command: "vendor/bin/phpunit", cwd: relative });
      }
      if (!composerScripts.includes("phpcs") && fs.existsSync(path.join(root, "vendor", "bin", "phpcs")) && (fs.existsSync(path.join(root, "phpcs.xml")) || fs.existsSync(path.join(root, "phpcs.xml.dist")) || fs.existsSync(path.join(root, ".phpcs.xml.dist")))) {
        steps.push({ name: `PHP CodeSniffer${label}`, command: "vendor/bin/phpcs", cwd: relative });
      }
    }
  }
  return steps;
}

function loadPipeline(sitePath) {
  const saved = readJson(path.join(sitePath, PIPELINE_FILE));
  if (saved && Array.isArray(saved.steps)) {
    return { source: "saved", steps: saved.steps };
  }
  return { source: "detected", steps: detectSteps(sitePath) };
}

function savePipeline(sitePath, steps) {
  const clean = (Array.isArray(steps) ? steps : [])
    .map((step) => ({
      name: String(step.name || step.command || "").trim(),
      command: String(step.command || "").trim(),
      cwd: String(step.cwd || ".").trim() || "."
    }))
    .filter((step) => step.command);
  const target = path.join(sitePath, PIPELINE_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ steps: clean }, null, 2));
  return { source: "saved", steps: clean };
}

function createPipelineRunner({ historyPath }) {
  let current = null;

  function readHistory() {
    return readJson(historyPath) || [];
  }

  function writeHistory(entries) {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(entries.slice(0, 30), null, 2));
  }

  async function run({ siteId, siteName, sitePath, steps }, emit) {
    if (current) {
      throw new Error("A pipeline is already running.");
    }
    const runSteps = (Array.isArray(steps) ? steps : []).filter((step) => step.command);
    if (!runSteps.length) {
      throw new Error("The pipeline has no steps.");
    }
    const record = { id: `run-${Date.now()}`, siteId, siteName, startedAt: new Date().toISOString(), steps: [], status: "running" };
    current = { child: null, cancelled: false };
    emit({ type: "run-start", runId: record.id, total: runSteps.length });

    try {
      for (let index = 0; index < runSteps.length; index++) {
        const step = runSteps[index];
        if (current.cancelled) {
          break;
        }
        const cwd = path.resolve(sitePath, step.cwd || ".");
        if (!cwd.startsWith(path.resolve(sitePath))) {
          throw new Error(`Step "${step.name}" points outside the site folder.`);
        }
        emit({ type: "step-start", index, name: step.name, command: step.command });
        const started = Date.now();
        const code = await new Promise((resolve) => {
          const child = spawn(step.command, { cwd, shell: true, windowsHide: true, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
          current.child = child;
          const forward = (stream) => (chunk) => emit({ type: "output", index, stream, text: chunk.toString() });
          child.stdout.on("data", forward("stdout"));
          child.stderr.on("data", forward("stderr"));
          child.on("error", (error) => {
            emit({ type: "output", index, stream: "stderr", text: `${error.message}\n` });
            resolve(-1);
          });
          child.on("close", (exitCode) => resolve(exitCode ?? -1));
        });
        current.child = null;
        const durationMs = Date.now() - started;
        const status = current.cancelled ? "cancelled" : (code === 0 ? "passed" : "failed");
        record.steps.push({ name: step.name, command: step.command, status, code, durationMs });
        emit({ type: "step-end", index, status, code, durationMs });
        if (status !== "passed") {
          break;
        }
      }
      record.status = current.cancelled
        ? "cancelled"
        : (record.steps.length === runSteps.length && record.steps.every((step) => step.status === "passed") ? "passed" : "failed");
    } catch (error) {
      record.status = "failed";
      emit({ type: "output", index: record.steps.length, stream: "stderr", text: `${error.message}\n` });
    } finally {
      record.finishedAt = new Date().toISOString();
      current = null;
      writeHistory([record, ...readHistory()]);
      emit({ type: "run-end", runId: record.id, status: record.status, record });
    }
    return record;
  }

  function cancel() {
    if (!current) {
      return false;
    }
    current.cancelled = true;
    const child = current.child;
    if (child && !child.killed) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    }
    return true;
  }

  return {
    run,
    cancel,
    isRunning: () => Boolean(current),
    history: (siteId) => readHistory().filter((entry) => !siteId || entry.siteId === siteId)
  };
}

module.exports = { createPipelineRunner, loadPipeline, savePipeline, detectSteps };
