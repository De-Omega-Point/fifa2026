import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/live-scores.js";

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/live-scores") {
      await handler(req, wrapResponse(res));
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(error.message || "Local server error");
  }
});

server.listen(PORT, () => {
  console.log(`Local scoreboard server running at http://localhost:${PORT}`);
});

function wrapResponse(res) {
  return {
    setHeader: (key, value) => res.setHeader(key, value),
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      if (!res.hasHeader("Content-Type")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(payload));
    },
    end(payload) {
      res.end(payload);
    }
  };
}

async function serveStatic(pathname, res) {
  const requestPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(ROOT, requestPath));
  const relativePath = path.relative(ROOT, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.split(path.sep)[0] === "api") {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", TYPES[path.extname(filePath)] || "application/octet-stream");
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  }
}
