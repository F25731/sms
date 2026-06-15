const http = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const SMS_BASE_URL = "https://sms.oapi.vip/api.php";
const SMS_API_KEY = process.env.SMS_API_KEY || process.env.API_KEY || "";
const PUBLIC_DIR = join(__dirname, "public");
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MINUTES || 30) * 60 * 1000;
const MIN_POLL_INTERVAL_MS = Number(process.env.MIN_POLL_INTERVAL_SECONDS || 3) * 1000;

const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const staticCacheControl = {
  ".html": "no-cache",
  ".css": "no-cache",
  ".js": "no-cache"
};

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message, extra = {}) {
  json(res, status, { ok: false, error: message, ...extra });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function getSession(sessionId) {
  cleanupSessions();
  if (!sessionId || !sessions.has(sessionId)) return null;
  const session = sessions.get(sessionId);
  session.lastSeenAt = Date.now();
  return session;
}

async function callSmsApi(action, body = {}) {
  if (!SMS_API_KEY) {
    return {
      ok: false,
      status: 500,
      retryAfter: null,
      data: { ok: false, error: "Missing SMS_API_KEY" }
    };
  }

  const url = new URL(SMS_BASE_URL);
  url.searchParams.set("action", action);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": SMS_API_KEY
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text || "Upstream returned a non-JSON response" };
  }

  return {
    ok: response.ok && data.ok === true,
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    data
  };
}

function publicSession(session) {
  return {
    phone: session.phone,
    remaining: session.remaining,
    maxUses: session.maxUses,
    usedCount: session.usedCount,
    completed: session.completed,
    sms: session.sms,
    code: session.smsCode,
    createdAt: session.createdAt,
    expiresAt: session.createdAt + SESSION_TTL_MS
  };
}

async function handleApi(req, res, pathname) {
  if (req.method !== "POST" && pathname !== "/api/session" && pathname !== "/api/health") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  try {
    if (pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        apiKeyConfigured: Boolean(SMS_API_KEY),
        sessionCount: sessions.size
      });
      return;
    }

    if (pathname === "/api/redeem") {
      const body = await readJson(req);
      const code = String(body.code || "").trim();
      if (!code) {
        sendError(res, 400, "请输入卡密");
        return;
      }

      const upstream = await callSmsApi("open_get_phone", { code });
      if (!upstream.ok) {
        sendError(res, upstream.status || 502, upstream.data.error || "兑换失败", {
          retry_after: upstream.data.retry_after || Number(upstream.retryAfter) || undefined
        });
        return;
      }

      const phone = upstream.data.phone || "";
      const remaining = typeof upstream.data.remaining === "number" ? upstream.data.remaining : null;

      const sessionId = randomUUID();
      sessions.set(sessionId, {
        code,
        phone,
        remaining,
        maxUses: null,
        usedCount: null,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        lastPollAt: 0,
        completed: false,
        sms: "",
        smsCode: ""
      });

      json(res, 200, {
        ok: true,
        sessionId,
        phone,
        remaining
      });
      return;
    }

    if (pathname === "/api/session") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const session = getSession(url.searchParams.get("session"));
      if (!session) {
        sendError(res, 404, "会话已失效，请重新兑换");
        return;
      }

      json(res, 200, { ok: true, ...publicSession(session) });
      return;
    }

    if (pathname === "/api/sms") {
      const body = await readJson(req);
      const session = getSession(body.sessionId);
      const force = body.force === true;
      if (!session) {
        sendError(res, 404, "会话已失效，请重新兑换");
        return;
      }

      if (session.completed && !force) {
        json(res, 200, { ok: true, ...publicSession(session) });
        return;
      }

      const now = Date.now();
      const waitMs = MIN_POLL_INTERVAL_MS - (now - session.lastPollAt);
      if (waitMs > 0 && !force) {
        sendError(res, 429, "轮询太快，请稍后再试", {
          retry_after: Math.ceil(waitMs / 1000),
          ...publicSession(session)
        });
        return;
      }

      session.lastPollAt = now;
      const upstream = await callSmsApi("open_get_sms", { code: session.code });

      if (upstream.status === 200 && upstream.data.ok === false) {
        json(res, 200, {
          ok: false,
          pending: true,
          error: upstream.data.error || "暂未收到验证码",
          ...publicSession(session)
        });
        return;
      }

      if (!upstream.ok) {
        sendError(res, upstream.status || 502, upstream.data.error || "获取验证码失败", {
          retry_after: upstream.data.retry_after || Number(upstream.retryAfter) || undefined
        });
        return;
      }

      session.completed = true;
      session.sms = upstream.data.sms || "";
      session.smsCode = upstream.data.code || "";
      if (typeof upstream.data.remaining === "number") {
        session.remaining = upstream.data.remaining;
      }

      json(res, 200, { ok: true, ...publicSession(session) });
      return;
    }

    if (pathname === "/api/change-phone") {
      const body = await readJson(req);
      const session = getSession(body.sessionId);
      if (!session) {
        sendError(res, 404, "会话已失效，请重新兑换");
        return;
      }
      if (session.completed) {
        sendError(res, 400, "已收到验证码，不能换号");
        return;
      }

      const upstream = await callSmsApi("open_change_phone", { code: session.code });
      if (!upstream.ok) {
        sendError(res, upstream.status || 502, upstream.data.error || "换号失败", {
          retry_after: upstream.data.retry_after || Number(upstream.retryAfter) || undefined
        });
        return;
      }

      session.phone = upstream.data.phone || session.phone;
      if (typeof upstream.data.remaining === "number") {
        session.remaining = upstream.data.remaining;
      }
      session.lastPollAt = 0;
      session.completed = false;
      session.sms = "";
      session.smsCode = "";
      session.createdAt = Date.now();

      json(res, 200, { ok: true, ...publicSession(session) });
      return;
    }

    sendError(res, 404, "API not found");
  } catch (error) {
    sendError(res, error.status || 500, error.message || "Internal server error");
  }
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const extension = extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": staticCacheControl[extension] || "public, max-age=300"
    });
    res.end(body);
  } catch {
    const fallback = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url.pathname);
    return;
  }

  await serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, () => {
  console.log(`SMS glass relay listening on http://localhost:${PORT}`);
});
