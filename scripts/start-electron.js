#!/usr/bin/env node
const path = require("path");
const { spawn } = require("child_process");
const electron = require("electron");

const appRoot = path.resolve(__dirname, "..");
const child = spawn(electron, [appRoot], {
  cwd: appRoot,
  stdio: "inherit",
  windowsHide: false
});

child.on("close", (code, signal) => {
  if (code === null) {
    console.error(`Electron exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}
