const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5000;
const SRC = path.join(__dirname, "src");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function serveFile(res, filePath) {
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  } catch (_) {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/" || url === "/index.html") {
    const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
    const patched = html.replace(
      "<head>",
      `<head>\n  <script src="/browser-shim.js"></script>`
    );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(patched);
    return;
  }

  if (url === "/browser-shim.js") {
    serveFile(res, path.join(SRC, "browser-shim.js"));
    return;
  }

  const candidate = path.join(SRC, url);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(res, candidate);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WP Desktop running on http://0.0.0.0:${PORT}`);
});
