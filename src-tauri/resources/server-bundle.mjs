// ai-bridge.ts
import { createHash, timingSafeEqual } from "node:crypto";
var MAX_INPUT = 1024 * 1024;
var MAX_OUTPUT = 4 * 1024 * 1024;
var jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
var loopback = (s) => s === "127.0.0.1" || s === "::1" || s === "::ffff:127.0.0.1";
function authorized(req, secret) {
  if (!secret || !loopback(req.socket.remoteAddress || "")) return false;
  const received = String(req.headers["x-yh-bot-capability"] || "");
  const a = Buffer.from(secret), b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
function handleAiProof(req, res, secret, nonce) {
  if (req.method !== "GET" || !secret || !loopback(req.socket.remoteAddress || "") || !/^[0-9a-f]{64}$/.test(nonce)) {
    res.writeHead(403).end();
    return;
  }
  const proof = createHash("sha256").update(nonce + secret).digest("hex");
  res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store", "content-length": Buffer.byteLength(proof) }).end(proof);
}
async function input(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new Error("\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function handleAiBridge(req, res, secret) {
  const finish = (status, body) => {
    if (!res.headersSent) res.writeHead(status, jsonHeaders);
    if (!res.writableEnded) res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || !authorized(req, secret)) {
    finish(403, { error: "\u5B89\u5168\u8FDE\u63A5\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u542F\u684C\u9762\u5BA2\u6237\u7AEF" });
    return;
  }
  let key = "";
  const controller = new AbortController();
  let timer;
  try {
    const body = await input(req);
    const url = new URL(String(body.url || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("\u670D\u52A1\u5730\u5740\u65E0\u6548");
    if (!["openai", "anthropic"].includes(body.format)) throw new Error("\u63A5\u53E3\u683C\u5F0F\u65E0\u6548");
    if (!["GET", "POST"].includes(body.method)) throw new Error("\u8BF7\u6C42\u65B9\u6CD5\u65E0\u6548");
    key = String(body.key || "");
    if (key.length > 8192 || /[\r\n]/.test(key)) throw new Error("API Key \u683C\u5F0F\u65E0\u6548");
    const headers = { "accept": "application/json", "content-type": "application/json" };
    let authMode = body.authMode || "default";
    if (!["default", "bearer", "x-api-key", "api-key", "none"].includes(authMode)) throw new Error("\u8BA4\u8BC1\u65B9\u5F0F\u65E0\u6548");
    if (authMode === "default") authMode = body.format === "anthropic" ? "x-api-key" : "bearer";
    if (key && authMode !== "none") {
      if (authMode === "bearer") headers.authorization = `Bearer ${key}`;
      else headers[authMode] = key;
    }
    if (body.format === "anthropic") headers["anthropic-version"] = String(body.anthropicVersion || "2023-06-01").replace(/[^\d-]/g, "").slice(0, 10);
    const timeout = Math.max(1e3, Math.min(Number(body.timeoutMs) || 6e4, 3e5));
    timer = setTimeout(() => controller.abort(), timeout);
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const upstream = await fetch(url, {
      method: body.method,
      headers,
      body: body.method === "POST" ? JSON.stringify(body.payload || {}) : void 0,
      redirect: "error",
      signal: controller.signal
    });
    const reader = upstream.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) for (; ; ) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > MAX_OUTPUT) {
        await reader.cancel();
        throw new Error("\u670D\u52A1\u8FD4\u56DE\u5185\u5BB9\u8FC7\u5927");
      }
      chunks.push(next.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: "\u670D\u52A1\u672A\u8FD4\u56DE\u6709\u6548 JSON" } };
    }
    if (!upstream.ok) {
      const detail = String(data?.error?.message || data?.message || `HTTP ${upstream.status}`).slice(0, 1200);
      finish(200, { status: upstream.status, data: { error: { message: key ? detail.split(key).join("[\u5DF2\u9690\u85CF]") : detail } } });
    } else {
      const redact = (value) => {
        if (typeof value === "string") return key ? value.split(key).join("[\u5DF2\u9690\u85CF]") : value;
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
        return value;
      };
      finish(200, { status: upstream.status, data: redact(data) });
    }
  } catch (e) {
    const message = e?.name === "AbortError" ? "\u8BF7\u6C42\u8D85\u65F6\u6216\u5DF2\u53D6\u6D88" : String(e?.message || "\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25");
    finish(502, { error: key ? message.split(key).join("[\u5DF2\u9690\u85CF]") : message });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// server.ts
import http from "node:http";

// sticker-directory.ts
async function stickerDirectory(req, res, search) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (req.method !== "GET") {
    res.writeHead(405, headers).end('{"error":{"message":"\u9700\u8981 GET \u8BF7\u6C42"}}');
    return;
  }
  const id = new URLSearchParams(search).get("author_id") || "";
  if (!/^\d{1,32}$/.test(id)) {
    res.writeHead(400, headers).end('{"error":{"message":"\u7528\u6237 ID \u4E0D\u6B63\u786E"}}');
    return;
  }
  try {
    const upstream = await fetch("https://yhsticker.us.ci/api/v1/packs?" + new URLSearchParams({ author_id: id, all: "true" }), { signal: AbortSignal.timeout(15e3) });
    const body = await upstream.json();
    if (!upstream.ok) throw new Error(body?.error?.message || "\u76EE\u5F55\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528");
    if (!Array.isArray(body.data)) throw new Error("\u76EE\u5F55\u8FD4\u56DE\u683C\u5F0F\u4E0D\u6B63\u786E");
    res.writeHead(200, headers).end(JSON.stringify(body));
  } catch (error) {
    res.writeHead(502, headers).end(JSON.stringify({ error: { message: error.name === "TimeoutError" ? "\u8868\u60C5\u5305\u76EE\u5F55\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5" : error.message } }));
  }
}

// server.ts
import https4 from "node:https";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync, execFile, spawn } from "node:child_process";
import { mkdirSync, readFileSync as readFileSync2 } from "node:fs";
import { existsSync as existsSync2 } from "node:fs";
import { dirname, extname, isAbsolute, join as join2, normalize } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// webdav.ts
import https from "node:https";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
var API_HOST = "chat-go.jwzhd.com";
function pbDecode(buf) {
  const out = {};
  let i = 0;
  const rv = () => {
    let s = 0, sh = 0;
    while (i < buf.length) {
      const b = buf[i++];
      s |= (b & 127) << sh;
      if (!(b & 128)) break;
      sh += 7;
    }
    return s;
  };
  while (i < buf.length) {
    const tag = rv(), f = tag >> 3, w = tag & 7;
    let v;
    if (w === 0) v = rv();
    else if (w === 2) {
      const n = rv();
      v = buf.subarray(i, i + n);
      i += n;
    } else if (w === 5) {
      v = buf.subarray(i, i + 4);
      i += 4;
    } else if (w === 1) {
      v = buf.subarray(i, i + 8);
      i += 8;
    } else break;
    (out[f] = out[f] || []).push(v);
  }
  return out;
}
var pbStr = (d, f) => {
  const v = d[f]?.[0];
  return v && Buffer.isBuffer(v) ? v.toString("utf8") : v !== void 0 ? String(v) : "";
};
var pbNum = (d, f) => Number(d[f]?.[0] ?? 0);
var pbList = (d, f) => d[f] || [];
function apiReq(method, path, token, body, ctype = "application/json") {
  return new Promise((resolve, reject) => {
    const payload = body ?? Buffer.alloc(0);
    const req = https.request({
      hostname: API_HOST,
      port: 443,
      method,
      path,
      headers: {
        token,
        ...payload.length ? { "Content-Type": ctype, "Content-Length": payload.length } : {},
        origin: "https://www.yunhu.chat",
        referer: "https://www.yunhu.chat/"
      }
    }, (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve({ status: r.statusCode || 500, buf: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(6e4, () => req.destroy(new Error("upstream timeout")));
    req.end(payload);
  });
}
async function apiJson(path, token, body) {
  const r = await apiReq("POST", path, token, Buffer.from(JSON.stringify(body ?? {})));
  let j;
  try {
    j = JSON.parse(r.buf.toString("utf8") || "{}");
  } catch {
    throw new Error("\u4E0A\u6E38\u8FD4\u56DE\u975E JSON");
  }
  if (j.code !== 1) throw new Error(j.msg || "code=" + j.code);
  return j.data ?? {};
}
async function myGroups(token) {
  const r = await apiReq("POST", "/v1/friend/address-book-list", token, Buffer.alloc(0));
  const out = [];
  try {
    for (const sb of pbList(pbDecode(r.buf), 2)) {
      const sec = pbDecode(sb);
      if (pbNum(sec, 3) !== 2) continue;
      for (const gb of pbList(sec, 2)) {
        const g = pbDecode(gb);
        const id = pbStr(g, 1);
        if (id) out.push({ id, name: pbStr(g, 8) || pbStr(g, 2) || id });
      }
    }
  } catch {
  }
  return out;
}
async function listDir(chatId, token, folderId) {
  const d = await apiJson("/v1/disk/file-list", token, { chatId, chatType: 2, folderId, sort: "name_asc" });
  return (d.list || []).map((x) => ({
    id: x.id,
    name: x.name,
    size: x.fileSize || 0,
    isFolder: x.objectType === 1,
    mtime: (x.uploadTime || 0) * 1e3,
    url: x.qiniuKey || "",
    by: x.uploadByName || ""
  }));
}
async function resolvePath(chatId, token, segs) {
  let folderId = 0;
  for (const seg of segs.slice(0, -1)) {
    const list = await listDir(chatId, token, folderId);
    const hit = list.find((x) => x.isFolder && x.name === seg);
    if (!hit) return null;
    folderId = hit.id;
  }
  return folderId;
}
async function uploadToQiniu(token, key, data, contentType) {
  const r = await apiReq("GET", "/v1/misc/qiniu-token2", token);
  const upToken = JSON.parse(r.buf.toString("utf8") || "{}")?.data?.token;
  if (!upToken) throw new Error("\u672A\u53D6\u5F97\u4E0A\u4F20 token");
  const seg = String(upToken).split(":");
  const ak = seg[0] || "";
  let bucket = "";
  try {
    const b64 = (seg[2] || "").replace(/-/g, "+").replace(/_/g, "/");
    bucket = String(JSON.parse(Buffer.from(b64, "base64").toString("utf8")).scope || "").split(":")[0];
  } catch {
  }
  let host = "upload.qiniup.com";
  if (ak && bucket) {
    try {
      const q = await fetchJson(`https://api.qiniu.com/v4/query?ak=${ak}&bucket=${bucket}`);
      const d = q?.up?.domains?.[0] || q?.up?.acc?.domains?.[0] || q?.up?.src?.domains?.[0];
      if (d) host = String(d).replace(/^https?:\/\//, "");
    } catch {
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const fd = new FormData();
    fd.append("token", upToken);
    fd.append("key", key);
    fd.append("file", new Blob([new Uint8Array(data)], { type: contentType || "application/octet-stream" }), key);
    const res = await fetch(`https://${host}/`, { method: "POST", body: fd });
    const txt = await res.text();
    if (res.ok) return key;
    const m = txt.match(/please use\s+([a-z0-9.-]+)/i);
    if (m) {
      host = m[1];
      continue;
    }
    throw new Error("\u4E03\u725B\u4E0A\u4F20\u5931\u8D25\uFF1A" + txt.slice(0, 160));
  }
  throw new Error("\u4E03\u725B\u4E0A\u4F20\u5931\u8D25\uFF1A\u533A\u57DF\u91CD\u8BD5\u6B21\u6570\u7528\u5C3D");
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "yunhu-webdav/1.0" } }, (r) => {
      const c = [];
      r.on("data", (x) => c.push(x));
      r.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(c).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}
function readBody(req, max = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on("data", (c) => {
      len += c.length;
      if (len > max) {
        req.destroy();
        reject(new Error("\u6587\u4EF6\u8FC7\u5927"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
var httpDate = (ms) => new Date(ms || Date.now()).toUTCString();
function entry(href, isFolder, size, mtime, name) {
  const nm = name || decodeURIComponent(href.split("/").filter(Boolean).pop() || "");
  return `  <D:response>
    <D:href>${esc(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${esc(nm)}</D:displayname>
        <D:getlastmodified>${httpDate(mtime)}</D:getlastmodified>
        <D:getcontentlength>${isFolder ? 0 : size}</D:getcontentlength>
        <D:resourcetype>${isFolder ? "<D:collection/>" : ""}</D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}
var PWD_FILE = join(process.cwd(), "yunhu.mountpwd.json");
var pwdCache = {};
try {
  if (existsSync(PWD_FILE)) pwdCache = JSON.parse(readFileSync(PWD_FILE, "utf8") || "{}");
} catch {
  pwdCache = {};
}
function savePwd(mountId, pwd) {
  pwdCache[String(mountId)] = pwd;
  try {
    writeFileSync(PWD_FILE, JSON.stringify(pwdCache, null, 2));
  } catch {
  }
}
function getPwd(mountId) {
  return pwdCache[String(mountId)] || "";
}
function hasPwd(mountId) {
  return !!pwdCache[String(mountId)];
}
async function mountList(groupId, token) {
  const r = await apiReq(
    "POST",
    "/v1/mount-setting/list",
    token,
    Buffer.from(JSON.stringify({ groupId })),
    "application/json"
  );
  const j = JSON.parse(r.buf.toString("utf8") || "{}");
  return j?.data?.list || [];
}
function renderHtml(res, m, chatId, sub, entries, basePath, pwd = "", typed = "") {
  const esc2 = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const up = sub.length ? `<a href="${basePath.replace(/[^/]+\/?$/, "")}">\u2191 \u4E0A\u7EA7</a>` : "";
  const rows = entries.map((e) => {
    const name = e.href.split("/").filter(Boolean).pop() || "";
    const isDir = e.isDir;
    return `<tr><td>${isDir ? "\u{1F4C1}" : "\u{1F4C4}"}</td><td><a href="${basePath.replace(/\/?$/, "")}/${encodeURIComponent(name)}${isDir ? "/" : ""}">${esc2(name)}</a></td><td>${e.size || ""}</td><td>${esc2(e.mtime || "")}</td></tr>`;
  }).join("\n");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${esc2(m.mountName)} - \u4E91\u6E56\u7FA4\u7F51\u76D8</title>
<style>body{font:14px/1.6 system-ui,sans-serif;background:#17181f;color:#e6e6e6;padding:20px}a{color:#5a8cf8;text-decoration:none}a:hover{text-decoration:underline}table{border-collapse:collapse;width:100%}td,th{padding:6px 10px;border-bottom:1px solid #2a2c36;text-align:left}h1{font-size:18px}code{background:#22242e;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>\u{1F517} ${esc2(m.mountName)}</h1><p>\u7FA4 <code>${esc2(chatId)}</code> \u6302\u8F7D\u7684\u7B2C\u4E09\u65B9\u7F51\u76D8 \xB7 <code>${esc2(m.webdavUrl)}</code></p>
<p>${up} <a href="/webdav/${esc2(chatId)}/">\u8FD4\u56DE\u7FA4\u7F51\u76D8\u6839\u76EE\u5F55</a></p>
<table><thead><tr><th></th><th>\u540D\u79F0</th><th>\u5927\u5C0F</th><th>\u4FEE\u6539\u65F6\u95F4</th></tr></thead><tbody>${rows}</tbody></table>
${entries.length ? "" : `<div style="margin-top:16px;padding:12px;border:1px solid #2a2c36;border-radius:8px">
<p>\u76EE\u5F55\u662F\u7A7A\u7684\u3002\u5982\u679C\u8FD9\u4E2A\u76D8\u9700\u8981\u5BC6\u7801\uFF0C\u5728\u8FD9\u91CC\u8F93\u4E00\u6B21\u5C31\u80FD\u6D4F\u89C8\uFF08\u4E91\u6E56\u63A5\u53E3\u4E0D\u628A\u6302\u8F7D\u5BC6\u7801\u4E0B\u53D1\u5230\u5BA2\u6237\u7AEF\uFF09\uFF1A</p>
<form method="get"><input name="pwd" type="password" placeholder="\u76D8\u5BC6\u7801" value="${esc2(typed)}" style="background:#22242e;border:1px solid #2a2c36;color:#eee;padding:5px 8px;border-radius:6px">
<button style="padding:5px 12px;border-radius:6px;border:1px solid #2a2c36;background:#2a2c36;color:#eee;cursor:pointer">\u8FDB\u5165</button></form></div>`}
<p style="color:#888;margin-top:18px">\u60F3\u5F53\u78C1\u76D8\u7528\uFF1F\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u91CC\u6302\uFF1A<code>${esc2(m.webdavUrl)}</code></p></body></html>`);
}
function propfindEntries(m, path, pwdIn = "") {
  return new Promise((resolve, reject) => {
    const base = String(m.webdavUrl || "").replace(/\/+$/, "");
    const target = base + "/" + path.split("/").filter(Boolean).map(encodeURIComponent).join("/") + "/";
    const u = new URL(target);
    const r2 = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      method: "PROPFIND",
      path: u.pathname + u.search,
      headers: {
        Authorization: "Basic " + Buffer.from(`${m.webdavUserName || ""}:${pwdIn || m.webdavPassword || ""}`).toString("base64"),
        Depth: "1",
        "User-Agent": "yunhu-webdav/1.0",
        "Content-Type": "application/xml"
      }
    }, (up) => {
      const out = [];
      up.on("data", (c) => out.push(c));
      up.on("end", () => {
        const xml = Buffer.concat(out).toString("utf8");
        const entries = [];
        for (const b of xml.split(/<[Dd]:response>/).slice(1)) {
          const href = (b.match(/<[Dd]:href>([^<]*)<\/[Dd]:href>/) || [])[1] || "";
          if (!href) continue;
          const decoded = decodeURIComponent(href).replace(/\/+$/, "");
          if (decoded === u.pathname.replace(/\/+$/, "")) continue;
          entries.push({
            href,
            isDir: /<[Dd]:collection\s*\/>/.test(b),
            size: Number((b.match(/<[Dd]:getcontentlength>([^<]*)</) || [])[1] || 0) || "",
            mtime: (b.match(/<[Dd]:getlastmodified>([^<]*)</) || [])[1] || ""
          });
        }
        resolve(entries);
      });
    });
    r2.on("error", reject);
    r2.setTimeout(2e4, () => r2.destroy(new Error("\u6302\u8F7D\u76D8\u8D85\u65F6")));
    r2.end();
  });
}
async function proxyMount(req, res, m, sub, pwdIn = "") {
  const pwd = pwdIn || String(m.webdavPassword || "");
  const base = String(m.webdavUrl || "").replace(/\/+$/, "");
  if (!base) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("\u6302\u8F7D\u6CA1\u6709\u914D\u5730\u5740");
    return true;
  }
  const wantsHtml = req.method === "GET" && String(req.headers.accept || "").includes("text/html");
  if (wantsHtml) {
    try {
      const root2 = String(m.webdavRootPath || "").replace(/^\/+|\/+$/g, "");
      const entries = await propfindEntries(m, [root2, ...sub].filter(Boolean).join("/"), pwd);
      const sid = String(m.groupId || req.headers["x-yh-group"] || "");
      const basePath = `/webdav/${sid}/@mount/${m.id}/` + sub.map(encodeURIComponent).join("/");
      return renderHtml(res, m, sid, sub, entries, basePath, pwd, pwdIn), true;
    } catch (e) {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>\u6302\u8F7D\u76D8\u8BBF\u95EE\u5931\u8D25</h1><p>${String(e.message)}</p>`);
      return true;
    }
  }
  const root = String(m.webdavRootPath || "").replace(/^\/+|\/+$/g, "");
  const path = [root, ...sub].filter(Boolean).join("/");
  const target = base + "/" + path.split("/").map(encodeURIComponent).join("/") + (sub.length && !path.endsWith("/") ? "" : "/");
  const auth = "Basic " + Buffer.from(`${m.webdavUserName || ""}:${pwd}`).toString("base64");
  const headers = {
    Authorization: auth,
    Depth: String(req.headers.depth ?? "1"),
    "User-Agent": "yunhu-webdav/1.0"
  };
  if (req.headers["content-type"]) headers["Content-Type"] = String(req.headers["content-type"]);
  return await new Promise((resolve) => {
    let body;
    if (req.method === "PUT" || req.method === "POST") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        body = Buffer.concat(chunks);
        go();
      });
      return;
    }
    go();
    function go() {
      const u = new URL(target);
      const r2 = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        method: req.method,
        path: u.pathname + u.search,
        headers: { ...headers, ...body ? { "Content-Length": body.length } : {} }
      }, (up) => {
        const out = [];
        up.on("data", (c) => out.push(c));
        up.on("end", () => {
          const h = { "Access-Control-Allow-Origin": "*" };
          const ct = String(up.headers["content-type"] || "application/octet-stream");
          h["Content-Type"] = ct;
          res.writeHead(up.statusCode || 502, h);
          res.end(req.method === "HEAD" ? void 0 : Buffer.concat(out));
          resolve(true);
        });
      });
      r2.on("error", (e) => {
        try {
          res.writeHead(502, { "Content-Type": "text/plain" }).end("\u6302\u8F7D\u76D8\u8BBF\u95EE\u5931\u8D25\uFF1A" + e.message);
        } catch {
        }
        resolve(true);
      });
      r2.setTimeout(3e4, () => r2.destroy(new Error("\u6302\u8F7D\u76D8\u8D85\u65F6")));
      if (body) r2.end(body);
      else r2.end();
    }
  });
}
async function handleMountJson(req, res, url) {
  if (url.pathname !== "/mount-json") return false;
  const json2 = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(data));
  };
  try {
    const gid = String(url.searchParams.get("gid") || "");
    const mid = String(url.searchParams.get("mid") || "");
    const path = String(url.searchParams.get("path") || "");
    const pwd = String(url.searchParams.get("pwd") || "");
    const token = String(req.headers.token || url.searchParams.get("token") || "");
    if (!gid || !mid || !token) return json2(400, { ok: false, msg: "\u7F3A gid / mid / token" }), true;
    const mounts = await mountList(gid, token);
    const m = mounts.find((x) => String(x.id) === String(mid));
    if (!m) return json2(404, { ok: false, msg: "\u6CA1\u6709\u8FD9\u4E2A\u6302\u8F7D" }), true;
    const root = String(m.webdavRootPath || "").replace(/^\/+|\/+$/g, "");
    const effectivePwd = pwd || getPwd(mid) || String(m.webdavPassword || "");
    if (pwd && url.searchParams.get("save") === "1") savePwd(mid, pwd);
    const entries = await propfindEntries(m, [root, path].filter(Boolean).join("/"), effectivePwd);
    return json2(200, {
      ok: true,
      name: m.mountName,
      url: m.webdavUrl,
      needPassword: !effectivePwd && entries.length === 0,
      hasSavedPassword: hasPwd(mid),
      entries: entries.map((e) => ({
        name: decodeURIComponent(String(e.href).split("/").filter(Boolean).pop() || ""),
        isDir: e.isDir,
        size: e.size,
        mtime: e.mtime
      }))
    }), true;
  } catch (e) {
    return json2(200, { ok: false, msg: String(e?.message || e) }), true;
  }
}
async function handleWebdav(req, res, pathname, search) {
  if (pathname !== "/webdav" && !pathname.startsWith("/webdav/")) return false;
  const send = (code, body = "", headers = {}) => {
    res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", ...headers });
    res.end(req.method === "HEAD" ? void 0 : body);
  };
  if (req.method === "OPTIONS") {
    return send(200, "", { DAV: "1,2", Allow: "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE", "MS-Author-Via": "DAV" }), true;
  }
  let user = "", token = "";
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Basic ")) {
    const [u, p] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
    user = decodeURIComponent(u || "");
    token = p || "";
  }
  const q = new URLSearchParams(search || "");
  if (!token) token = q.get("token") || "";
  if (!user) user = q.get("chatId") || "";
  if (!token) {
    return send(401, "\u9700\u8981\u8BA4\u8BC1\uFF1Auser = \u7FA4\u804A ID\uFF08\u6216 all\uFF09\uFF0Cpass = \u4E91\u6E56 token", { "WWW-Authenticate": 'Basic realm="yunhu-webdav"' }), true;
  }
  let segs = pathname.replace(/^\/webdav\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (segs.length && /^\d{5,}$/.test(segs[0])) {
    user = segs[0];
    segs = segs.slice(1);
  }
  try {
    if (!user || user === "all") {
      if (req.method !== "PROPFIND") return send(405, "\u6839\u76EE\u5F55\u53EA\u652F\u6301 PROPFIND\uFF0C\u8BF7\u8FDB\u5165 /webdav/<\u7FA4ID>/"), true;
      const groups = await myGroups(token);
      const parts = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<D:multistatus xmlns:D="DAV:">',
        entry("/webdav/", true, 0, Date.now(), "\u4E91\u6E56\u7FA4\u7F51\u76D8")
      ];
      for (const g of groups) {
        parts.push(entry("/webdav/" + g.id + "/", true, 0, Date.now(), `${g.name} (${g.id})`));
      }
      parts.push("</D:multistatus>");
      res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" });
      res.end(parts.join("\n"));
      return true;
    }
    const chatId = user;
    if (segs[0] === "@mount") {
      const url0 = new URL(req.url || "/", "http://localhost");
      const mountId = segs[1];
      const sub = segs.slice(2);
      if (!mountId) return send(400, "\u7F3A\u5C11\u6302\u8F7D ID"), true;
      let mounts = [];
      try {
        mounts = await mountList(chatId, token);
      } catch (e) {
        return send(500, "\u8BFB\u53D6\u6302\u8F7D\u5931\u8D25\uFF1A" + e.message), true;
      }
      const m = mounts.find((x) => String(x.id) === String(mountId));
      if (!m) return send(404, "\u6CA1\u6709\u8FD9\u4E2A\u6302\u8F7D"), true;
      return await proxyMount(req, res, m, sub, url0.searchParams.get("pwd") || ""), true;
    }
    if (req.method === "PROPFIND") {
      const depth = String(req.headers.depth ?? "1");
      const folderId = await resolvePath(chatId, token, segs);
      if (folderId === null) return send(404, "\u8DEF\u5F84\u4E0D\u5B58\u5728"), true;
      const list = await listDir(chatId, token, folderId);
      const last = segs[segs.length - 1];
      const mine = last ? list.find((x) => x.name === last) : null;
      const selfPath = "/webdav/" + chatId + "/" + segs.map(encodeURIComponent).join("/");
      const parts = ['<?xml version="1.0" encoding="utf-8"?>', '<D:multistatus xmlns:D="DAV:">'];
      if (mine && !mine.isFolder) {
        parts.push(entry(selfPath, false, mine.size, mine.mtime));
      } else {
        parts.push(entry(selfPath.replace(/\/?$/, "/"), true, 0, Date.now(), segs[segs.length - 1] || chatId));
        if (depth !== "0") {
          for (const it of list) {
            parts.push(entry(selfPath.replace(/\/?$/, "/") + encodeURIComponent(it.name), it.isFolder, it.size, it.mtime, it.name));
          }
          if (!segs.length) {
            try {
              for (const m of await mountList(chatId, token)) {
                parts.push(entry(`${selfPath.replace(/\/?$/, "/")}@mount/${m.id}/`, true, 0, Date.now(), `\u{1F517} ${m.mountName}`));
              }
            } catch {
            }
          }
        }
      }
      parts.push("</D:multistatus>");
      res.writeHead(207, { "Content-Type": "application/xml; charset=utf-8" });
      res.end(parts.join("\n"));
      return true;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const folderId = await resolvePath(chatId, token, segs);
      if (folderId === null) return send(404, "\u8DEF\u5F84\u4E0D\u5B58\u5728"), true;
      const list = await listDir(chatId, token, folderId);
      const f = list.find((x) => x.name === segs[segs.length - 1]);
      if (!f) return send(404, "\u6587\u4EF6\u4E0D\u5B58\u5728"), true;
      if (f.isFolder) return send(405, "\u8FD9\u662F\u6587\u4EF6\u5939"), true;
      res.writeHead(302, { Location: "/res/" + String(f.url).replace(/^https?:\/\//, ""), "Content-Length": "0" });
      res.end();
      return true;
    }
    if (req.method === "PUT") {
      const folderId = await resolvePath(chatId, token, segs);
      const name = segs[segs.length - 1];
      if (folderId === null || !name) return send(409, "\u76EE\u6807\u76EE\u5F55\u4E0D\u5B58\u5728"), true;
      const data = await readBody(req);
      if (!data.length) return send(400, "\u7A7A\u6587\u4EF6"), true;
      const md5 = crypto.createHash("md5").update(data).digest("hex");
      const ext = (name.split(".").pop() || "bin").slice(0, 12);
      const qiniuKey = `disk/${md5}${name.includes(".") ? "." + ext : ""}`;
      await uploadToQiniu(token, qiniuKey, data, String(req.headers["content-type"] || ""));
      await apiJson("/v1/disk/upload-file", token, {
        chatId,
        chatType: 2,
        fileSize: Math.max(1, Math.round(data.length / 1024)),
        // 接口单位是 KB
        fileName: name,
        fileMd5: `${md5}.${ext}`,
        fileEtag: `F${md5.slice(0, 20)}`,
        qiniuKey,
        folderId
      });
      return send(201, "\u4E0A\u4F20\u6210\u529F"), true;
    }
    if (req.method === "MKCOL") {
      const folderId = await resolvePath(chatId, token, segs);
      if (folderId === null) return send(409, "\u7236\u76EE\u5F55\u4E0D\u5B58\u5728"), true;
      try {
        await apiJson("/v1/disk/create-folder", token, {
          chatId,
          chatType: 2,
          folderName: segs[segs.length - 1] || "\u65B0\u5EFA\u6587\u4EF6\u5939",
          parentFolderId: folderId
        });
        return send(201), true;
      } catch (e) {
        return send(500, "\u5EFA\u76EE\u5F55\u5931\u8D25\uFF1A" + e.message), true;
      }
    }
    if (req.method === "DELETE") {
      const folderId = await resolvePath(chatId, token, segs);
      if (folderId === null) return send(404, "\u8DEF\u5F84\u4E0D\u5B58\u5728"), true;
      const list = await listDir(chatId, token, folderId);
      const f = list.find((x) => x.name === segs[segs.length - 1]);
      if (!f) return send(404, "\u4E0D\u5B58\u5728"), true;
      try {
        await apiJson("/v1/disk/remove", token, { id: f.id });
        return send(204), true;
      } catch (e) {
        return send(403, "\u5220\u9664\u5931\u8D25\uFF1A" + e.message + "\uFF08\u4E91\u6E56\u5BF9\u7FA4\u7F51\u76D8\u5220\u9664\u6709\u6743\u9650\u9650\u5236\uFF09"), true;
      }
    }
    if (req.method === "MOVE") {
      const folderId = await resolvePath(chatId, token, segs);
      if (folderId === null) return send(404, "\u6E90\u8DEF\u5F84\u4E0D\u5B58\u5728"), true;
      const list = await listDir(chatId, token, folderId);
      const src = list.find((x) => x.name === segs[segs.length - 1]);
      if (!src) return send(404, "\u6E90\u6587\u4EF6\u4E0D\u5B58\u5728"), true;
      const destHdr = String(req.headers.destination || "");
      if (!destHdr) return send(400, "\u7F3A\u5C11 Destination \u5934"), true;
      let destPath;
      try {
        destPath = decodeURIComponent(new URL(destHdr).pathname || "");
      } catch {
        destPath = decodeURIComponent(destHdr);
      }
      const destSegs = destPath.replace(/^\/webdav\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      if (destSegs.length && /^\d{5,}$/.test(destSegs[0])) destSegs.shift();
      const destFolderId = await resolvePath(chatId, token, destSegs.slice(0, -1));
      if (destFolderId !== folderId) return send(409, "\u4E91\u6E56 WebDAV \u4E0D\u652F\u6301\u8DE8\u76EE\u5F55\u79FB\u52A8\uFF08\u4E0B\u8F7D \u2192 \u5220\u9664 \u2192 \u4E0A\u4F20\uFF09"), true;
      const newName = destSegs[destSegs.length - 1] || src.name;
      try {
        await apiJson("/v1/disk/rename", token, { id: src.id, objectType: src.isFolder ? 1 : 2, name: newName });
        return send(204), true;
      } catch (e) {
        return send(403, "\u91CD\u547D\u540D\u5931\u8D25\uFF1A" + e.message), true;
      }
    }
    return send(405, "\u4E0D\u652F\u6301\u7684\u65B9\u6CD5 " + req.method), true;
  } catch (e) {
    return send(500, "WebDAV \u9519\u8BEF\uFF1A" + e.message), true;
  }
}

// satori.ts
import https2 from "node:https";
function pbDecode2(buf) {
  const out = {};
  let i = 0;
  const rv = () => {
    let s = 0, sh = 0;
    while (i < buf.length) {
      const b = buf[i++];
      s |= (b & 127) << sh;
      if (!(b & 128)) break;
      sh += 7;
    }
    return s;
  };
  while (i < buf.length) {
    const tag = rv(), f = tag >> 3, w = tag & 7;
    let v;
    if (w === 0) v = rv();
    else if (w === 2) {
      const n = rv();
      v = buf.subarray(i, i + n);
      i += n;
    } else if (w === 5) {
      v = buf.subarray(i, i + 4);
      i += 4;
    } else if (w === 1) {
      v = buf.subarray(i, i + 8);
      i += 8;
    } else break;
    (out[f] = out[f] || []).push(v);
  }
  return out;
}
var pbStr2 = (d, f) => {
  const v = d[f]?.[0];
  return v && Buffer.isBuffer(v) ? v.toString("utf8") : v !== void 0 ? String(v) : "";
};
var pbNum2 = (d, f) => Number(d[f]?.[0] ?? 0);
var pbList2 = (d, f) => d[f] || [];
function pvint(x) {
  const o = [];
  while (true) {
    const b = x & 127;
    x >>>= 7;
    if (x) o.push(b | 128);
    else {
      o.push(b);
      break;
    }
  }
  return Buffer.from(o);
}
var pbFieldStr = (f, s) => {
  const e = Buffer.from(s, "utf8");
  return Buffer.concat([pvint(f << 3 | 2), pvint(e.length), e]);
};
var pbFieldNum = (f, n) => Buffer.concat([pvint(f << 3 | 0), pvint(n)]);
function apiReq2(method, path, token, body, ctype = "application/octet-stream") {
  return new Promise((resolve, reject) => {
    const payload = body ?? Buffer.alloc(0);
    const req = https2.request({
      hostname: "chat-go.jwzhd.com",
      port: 443,
      method,
      path,
      headers: {
        token,
        ...payload.length ? { "Content-Type": ctype, "Content-Length": payload.length } : {},
        origin: "https://www.yunhu.chat",
        referer: "https://www.yunhu.chat/"
      }
    }, (r) => {
      const c = [];
      r.on("data", (x) => c.push(x));
      r.on("end", () => resolve({ status: r.statusCode || 500, buf: Buffer.concat(c) }));
    });
    req.on("error", reject);
    req.setTimeout(2e4, () => req.destroy(new Error("upstream timeout")));
    req.end(payload);
  });
}
async function groupsOf(token) {
  const r = await apiReq2("POST", "/v1/friend/address-book-list", token, Buffer.alloc(0));
  const out = [];
  for (const sb of pbList2(pbDecode2(r.buf), 2)) {
    const sec = pbDecode2(sb);
    const t = pbNum2(sec, 3);
    for (const gb of pbList2(sec, 2)) {
      const g = pbDecode2(gb);
      const id = pbStr2(g, 1);
      if (id) out.push({ id, name: pbStr2(g, 8) || pbStr2(g, 2) || id, type: t });
    }
  }
  return out;
}
async function messagesOf(token, chatId, size = 30) {
  const body = Buffer.concat([pbFieldNum(2, size), pbFieldStr(5, chatId), pbFieldNum(4, 2)]);
  const r = await apiReq2("POST", "/v1/msg/list-message", token, body);
  const out = [];
  for (const mb of pbList2(pbDecode2(r.buf), 2)) {
    const m = pbDecode2(mb);
    const s = m[2] ? pbDecode2(m[2][0]) : {};
    out.push({
      id: pbStr2(m, 1),
      chatId,
      senderId: pbStr2(s, 1),
      sender: pbStr2(s, 3) || pbStr2(s, 1),
      avatar: pbStr2(s, 4),
      type: pbNum2(m, 3),
      content: (() => {
        const b = m[5]?.[0];
        if (!b) return "";
        const c = pbDecode2(b);
        return pbStr2(c, 1) || Buffer.from(b).toString("utf8");
      })(),
      ts: pbNum2(m, 7) || pbNum2(m, 8)
    });
  }
  return out.reverse();
}
var json = (res, code, data) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
};
async function handleSatori(req, res, pathname, search) {
  if (!pathname.startsWith("/satori/")) return false;
  const url = new URL(pathname + (search || ""), "http://x");
  const p = url.pathname.replace(/^\/satori/, "");
  const auth = String(req.headers.authorization || "");
  const token = auth.replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  if (!token) return json(res, 401, { code: 401, message: "\u9700\u8981 Authorization: Bearer <token>" }), true;
  try {
    if (p === "/v1/login.get") {
      const r = await apiReq2("POST", "/v1/user/get-user-data", token, Buffer.from("{}"), "application/json");
      let uid = "";
      let intro = "";
      try {
        const j = JSON.parse(r.buf.toString("utf8") || "{}");
        const d = j?.data?.data || {};
        uid = String(d.userId || "");
        intro = String(d.introduction || "");
      } catch {
      }
      let name = "", avatar = "";
      if (uid) {
        try {
          const r2 = await apiReq2("POST", "/v1/user/get-user", token, pbFieldStr(2, uid));
          const d2 = pbDecode2(r2.buf);
          const u = d2[2] ? pbDecode2(d2[2][0]) : {};
          name = pbStr2(u, 2);
          avatar = pbStr2(u, 4);
        } catch {
        }
      }
      return json(res, 200, {
        code: 0,
        login: { user: { id: uid, name, avatar, nick: name } },
        user: { id: uid, name, avatar },
        introduction: intro
      }), true;
    }
    if (p === "/v1/guild.list") {
      const all = await groupsOf(token);
      const list = all.filter((g) => g.type === 2).map((g) => ({ id: g.id, name: g.name, avatar: "" }));
      return json(res, 200, { code: 0, data: list, guilds: list }), true;
    }
    if (p === "/v1/channel.list") {
      const all = await groupsOf(token);
      const list = all.map((g) => ({ id: g.id, name: g.name, type: g.type === 2 ? 0 : 1, parent_id: g.id }));
      return json(res, 200, { code: 0, data: list, channels: list }), true;
    }
    if (p === "/v1/message.list") {
      const channelId = url.searchParams.get("channel_id") || "";
      if (!channelId) return json(res, 400, { code: 400, message: "\u7F3A\u5C11 channel_id" }), true;
      const msgs = await messagesOf(token, channelId);
      const data = msgs.map((m) => ({
        id: m.id,
        content: m.content || "",
        channel: { id: m.chatId, type: 0 },
        guild: { id: m.chatId },
        user: { id: m.senderId, name: m.sender, avatar: m.avatar },
        created_at: m.ts
      }));
      return json(res, 200, { code: 0, data, messages: data }), true;
    }
    if (p === "/v1/message.create" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const channelId = String(body.channel_id || "");
      const text = typeof body.content === "string" ? body.content : String(body.content ?? "");
      if (!channelId || !text) return json(res, 400, { code: 400, message: "\u7F3A\u5C11 channel_id / content" }), true;
      const mid = Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
      const contentBuf = pbFieldStr(1, text);
      const msgBuf = Buffer.concat([
        pbFieldStr(2, mid),
        pbFieldStr(3, channelId),
        pbFieldNum(4, 2),
        pbFieldStr(5, contentBuf.toString("binary")),
        pbFieldNum(6, 1)
      ]);
      const r = await apiReq2("POST", "/v1/msg/send-message", token, msgBuf);
      const ok = r.buf.includes(Buffer.from("success")) || r.status === 200;
      return json(res, ok ? 200 : 500, { code: ok ? 0 : 500, data: ok ? [{ id: mid }] : null }), true;
    }
    if (p === "/v1/message.update" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const channelId = String(body.channel_id || "");
      const msgId = String(body.message_id || "");
      const text = typeof body.content === "string" ? body.content : String(body.content ?? "");
      if (!channelId || !msgId || !text) return json(res, 400, { code: 400, message: "\u7F3A\u5C11 channel_id / message_id / content" }), true;
      const contentBuf = pbFieldStr(1, text);
      const msgBuf = Buffer.concat([
        pbFieldStr(2, msgId),
        pbFieldStr(3, channelId),
        pbFieldNum(4, 2),
        pbFieldStr(5, contentBuf.toString("binary")),
        pbFieldNum(6, 1)
      ]);
      const r = await apiReq2("POST", "/v1/msg/edit-message", token, msgBuf);
      const ok = r.status === 200;
      return json(res, ok ? 200 : 500, { code: ok ? 0 : 500, data: ok ? [{ id: msgId }] : null }), true;
    }
    if (p === "/v1/message.delete" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const channelId = String(body.channel_id || "");
      const msgId = String(body.message_id || "");
      if (!channelId || !msgId) return json(res, 400, { code: 400, message: "\u7F3A\u5C11 channel_id / message_id" }), true;
      const msgBuf = Buffer.concat([pbFieldStr(2, msgId), pbFieldStr(3, channelId), pbFieldNum(4, 2)]);
      const r = await apiReq2("POST", "/v1/msg/recall-msg", token, msgBuf);
      const ok = r.status === 200;
      return json(res, ok ? 200 : 500, { code: ok ? 0 : 500 }), true;
    }
    if (p === "/v1/user.get") {
      const id = url.searchParams.get("id") || "";
      if (!id) return json(res, 400, { code: 400, message: "\u7F3A\u5C11 id" }), true;
      const r = await apiReq2("POST", "/v1/user/get-user", token, pbFieldStr(2, id));
      const d = pbDecode2(r.buf);
      const u = d[2] ? pbDecode2(d[2][0]) : {};
      return json(res, 200, {
        code: 0,
        data: {
          id: pbStr2(u, 1) || id,
          name: pbStr2(u, 2),
          avatar: pbStr2(u, 4),
          register_time: pbStr2(u, 7),
          online_day: pbNum2(u, 11)
        }
      }), true;
    }
    return json(res, 404, { code: 404, message: "\u672A\u77E5\u7AEF\u70B9 " + p + "\uFF08WebSocket \u4E8B\u4EF6\u63A8\u9001\u672A\u5B9E\u73B0\uFF09" }), true;
  } catch (e) {
    return json(res, 500, { code: 500, message: String(e.message || e) }), true;
  }
}

// satori-ws.ts
import crypto2 from "node:crypto";
import https3 from "node:https";
import { EventEmitter } from "node:events";
var API_HOST2 = "chat-go.jwzhd.com";
function encodeFrame(payload, opcode = 1) {
  const data = Buffer.from(payload, "utf8");
  const len = data.length;
  let head;
  if (len < 126) {
    head = Buffer.from([128 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 128 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 128 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, data]);
}
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const opcode = b0 & 15;
    const masked = (b1 & 128) !== 0;
    let len = b1 & 127;
    let p = off + 2;
    if (len === 126) {
      if (p + 2 > buf.length) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    let mask = null;
    if (masked) {
      if (p + 4 > buf.length) break;
      mask = buf.subarray(p, p + 4);
      p += 4;
    }
    if (p + len > buf.length) break;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    frames.push({ opcode, payload: data.toString("utf8") });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}
function acceptKey(key) {
  return crypto2.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}
function apiReq3(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ?? Buffer.alloc(0);
    const req = https3.request({
      hostname: API_HOST2,
      port: 443,
      method,
      path,
      headers: {
        token,
        ...payload.length ? { "Content-Type": "application/octet-stream", "Content-Length": payload.length } : {},
        origin: "https://www.yunhu.chat",
        referer: "https://www.yunhu.chat/"
      }
    }, (r) => {
      const c = [];
      r.on("data", (x) => c.push(x));
      r.on("end", () => resolve(Buffer.concat(c)));
    });
    req.on("error", reject);
    req.setTimeout(2e4, () => req.destroy(new Error("timeout")));
    req.end(payload);
  });
}
function pbDecode3(buf) {
  const out = {};
  let i = 0;
  const rv = () => {
    let s = 0, sh = 0;
    while (i < buf.length) {
      const b = buf[i++];
      s |= (b & 127) << sh;
      if (!(b & 128)) break;
      sh += 7;
    }
    return s;
  };
  while (i < buf.length) {
    const tag = rv(), f = tag >> 3, w = tag & 7;
    let v;
    if (w === 0) v = rv();
    else if (w === 2) {
      const n = rv();
      v = buf.subarray(i, i + n);
      i += n;
    } else if (w === 5) {
      v = buf.subarray(i, i + 4);
      i += 4;
    } else if (w === 1) {
      v = buf.subarray(i, i + 8);
      i += 8;
    } else break;
    (out[f] = out[f] || []).push(v);
  }
  return out;
}
var pbStr3 = (d, f) => {
  const v = d[f]?.[0];
  return v && Buffer.isBuffer(v) ? v.toString("utf8") : v !== void 0 ? String(v) : "";
};
var pbNum3 = (d, f) => Number(d[f]?.[0] ?? 0);
var pbList3 = (d, f) => d[f] || [];
var pv = (x) => {
  const o = [];
  while (true) {
    const b = x & 127;
    x >>>= 7;
    if (x) o.push(b | 128);
    else {
      o.push(b);
      break;
    }
  }
  return Buffer.from(o);
};
var fStr = (f, s) => {
  const e = Buffer.from(s, "utf8");
  return Buffer.concat([pv(f << 3 | 2), pv(e.length), e]);
};
var fNum = (f, n) => Buffer.concat([pv(f << 3 | 0), pv(n)]);
async function channelsOf(token) {
  const r = await apiReq3("POST", "/v1/friend/address-book-list", token, Buffer.alloc(0));
  const out = [];
  try {
    for (const sb of pbList3(pbDecode3(r), 2)) {
      const sec = pbDecode3(sb);
      if (pbNum3(sec, 3) !== 2) continue;
      for (const gb of pbList3(sec, 2)) {
        const id = pbStr3(pbDecode3(gb), 1);
        if (id) out.push(id);
      }
    }
  } catch {
  }
  return out;
}
async function latestOf(token, chatId) {
  const body = Buffer.concat([fNum(2, 5), fStr(5, chatId), fNum(4, 2)]);
  const r = await apiReq3("POST", "/v1/msg/list-message", token, body);
  const list = [];
  for (const mb of pbList3(pbDecode3(r), 2)) {
    const m = pbDecode3(mb);
    const s = m[2] ? pbDecode3(m[2][0]) : {};
    list.push({
      id: pbStr3(m, 1),
      channel_id: chatId,
      user: { id: pbStr3(s, 1), name: pbStr3(s, 3), avatar: pbStr3(s, 4) },
      content: (() => {
        const b = m[5]?.[0];
        if (!b) return "";
        const c = pbDecode3(b);
        return pbStr3(c, 1);
      })() || "",
      created_at: pbNum3(m, 7)
    });
  }
  return list;
}
var SatoriSocket = class extends EventEmitter {
  // ⚠️ Node 的 strip-only TS 模式不支持「参数属性」写法，
  //    所以这里必须显式声明字段 + 赋值，不能写 constructor(private x)
  constructor(sock, token) {
    super();
    this.seen = /* @__PURE__ */ new Set();
    this.buf = Buffer.alloc(0);
    // 收包缓冲（subarray 的类型泛型在 Node26 下不一致，用 any 省事）
    this.closed = false;
    this.sock = sock;
    this.token = token;
    sock.on("data", (d) => this.onData(d));
    sock.on("close", () => this.close());
    sock.on("error", () => this.close());
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    const { frames, rest } = decodeFrames(this.buf);
    this.buf = rest;
    for (const f of frames) {
      if (f.opcode === 8) return this.close();
      if (f.opcode === 9) {
        this.send(Buffer.alloc(0), 10);
        continue;
      }
      if (f.opcode === 1) this.emit("message", f.payload);
    }
  }
  send(payload, opcode = 1) {
    if (this.closed) return;
    try {
      this.sock.write(encodeFrame(typeof payload === "string" ? payload : payload.toString("utf8"), opcode));
    } catch {
      this.close();
    }
  }
  event(name, data) {
    this.send(JSON.stringify({ op: 0, body: { event: name, ...data } }));
  }
  /** 开始轮询推送（只看前 8 个群，够用又不至于把接口打爆） */
  async start() {
    let channels = [];
    try {
      channels = (await channelsOf(this.token)).slice(0, 8);
    } catch {
    }
    this.event("ready", { logins: [{ sn: 0, user: { id: "", name: "" } }] });
    const tick = async () => {
      if (this.closed) return;
      for (const ch of channels) {
        try {
          for (const m of await latestOf(this.token, ch)) {
            if (this.seen.has(m.id)) continue;
            this.seen.add(m.id);
            this.event("message-created", { message: { id: m.id, content: m.content, channel: { id: ch, type: 0 }, user: m.user, created_at: m.created_at } });
          }
        } catch {
        }
      }
    };
    await tick();
    this.timer = setInterval(tick, 4e3);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    try {
      this.sock.end();
    } catch {
    }
    this.emit("closed");
  }
};
function isSatoriWs(pathname) {
  return pathname === "/satori/v1/ws";
}

// server.ts
var __dirname = fileURLToPath(new URL(".", import.meta.url));
var BASE = process.env.YH_ROOT || __dirname;
var PORT = Number(process.env.PORT || 8902);
var HOST = process.env.HOST || "0.0.0.0";
var UPSTREAM = process.env.UPSTREAM || "https://chat-go.jwzhd.com";
var ROOT = join2(BASE, "dist");
var CONFIG_FILE = join2(BASE, "yunhu.config.yml");
var DATA_DIR_FILE = join2(homedir(), ".yhchat-dir");
var DATA_ALLOW = /* @__PURE__ */ new Set(["session", "accounts", "cache", "pin", "lock", "relay", "recall"]);
var DATA_MAX_BYTES = 2 * 1024 * 1024;
var JSON_HDR = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function defaultDataDir() {
  return join2(homedir(), "Documents", "yhchat");
}
function resolveDataDir() {
  if (process.env.YH_DATA_DIR) return process.env.YH_DATA_DIR;
  try {
    const custom = readFileSync2(DATA_DIR_FILE, "utf8").trim();
    if (custom) return custom;
  } catch {
  }
  return defaultDataDir();
}
var DATA_DIR = resolveDataDir();
try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch {
}
async function handleDataDir(req, res) {
  if (req.method === "GET") {
    res.writeHead(200, JSON_HDR);
    res.end(JSON.stringify({ dir: DATA_DIR, custom: existsSync2(DATA_DIR_FILE), default: defaultDataDir() }));
    return;
  }
  if (req.method === "PUT" || req.method === "POST") {
    try {
      const body = JSON.parse(await readBody2(req));
      const dir = String(body.dir || "").trim();
      if (!dir || dir.length > 260) {
        res.writeHead(400, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u76EE\u5F55\u8DEF\u5F84\u4E0D\u5408\u6CD5" }));
        return;
      }
      mkdirSync(dir, { recursive: true });
      for (const name of [...DATA_ALLOW, "download-settings"]) {
        const from = join2(DATA_DIR, name + ".json");
        const to = join2(dir, name + ".json");
        if (existsSync2(from) && !existsSync2(to)) {
          await writeFile(to, await readFile(from, "utf8"), "utf8").catch(() => {
          });
        }
      }
      await writeFile(DATA_DIR_FILE, dir, "utf8");
      DATA_DIR = dir;
      res.writeHead(200, JSON_HDR);
      res.end(JSON.stringify({ ok: true, dir }));
    } catch (e) {
      res.writeHead(500, JSON_HDR);
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    }
    return;
  }
  res.writeHead(405).end("method not allowed");
}
var DEFAULT_CONFIG = `# \u4E91\u6E56\u7B2C\u4E09\u65B9\u5BA2\u6237\u7AEF\u914D\u7F6E
app:
  title: \u4E91\u6E56 \xB7 \u7B2C\u4E09\u65B9\u5BA2\u6237\u7AEF
  theme: dark
  pollMs: 4000
plugins:
  config: {}
  theme:
    preset: kobe
    accent: ''
    wallpaper: ''
    radius: 10
    blur: 0
  message-actions: {}
  logger: {}
  ui: {}
  console: {}
  api: {}
  auth: {}
  adapter: {}
  chat:
    pollMs: 4000
  ws:
    heartbeat: 25000
  quickreply:
    enabled: false
    items:
      - \u6536\u5230 \u2705
      - \u7A0D\u7B49\u4E00\u4E0B
      - \u597D\u7684
`;
var RES_HOST_RE = /^chat-(img|img2|img3|audio1|file|file-oss|storage1|video1)\.jwznb\.com$/i;
var RES_REFERER = "http://myapp.jwznb.com";
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json"
};
function follow(target, req, res, referer, depth = 0, cacheControl = "no-store") {
  const url = new URL(target);
  const headers = { ...req.headers, host: url.host, "accept-encoding": "identity" };
  delete headers.origin;
  delete headers.referer;
  delete headers.cookie;
  if (referer) headers.referer = referer;
  const r = https4.request({
    hostname: url.hostname,
    port: url.port || 443,
    method: req.method,
    path: url.pathname + url.search,
    headers
  }, (up) => {
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location && depth < 3) {
      up.resume();
      return follow(new URL(up.headers.location, url).toString(), req, res, referer, depth + 1, cacheControl);
    }
    const h = {
      "content-type": safeHeader(up.headers["content-type"]) || "application/octet-stream",
      // Newly uploaded objects can briefly return 403/404. Never cache that failure for a day.
      "cache-control": (up.statusCode || 502) >= 200 && (up.statusCode || 502) < 300 ? cacheControl : "no-store",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-range, content-length, accept-ranges"
    };
    for (const k of ["content-length", "content-range", "accept-ranges", "etag", "last-modified", "content-disposition"]) {
      const v = safeHeader(up.headers[k]);
      if (v !== void 0) h[k] = v;
    }
    try {
      res.writeHead(up.statusCode || 502, h);
    } catch {
      res.writeHead(up.statusCode || 502, { "content-type": "application/octet-stream", "cache-control": cacheControl });
    }
    up.once("error", (error) => {
      if (!res.destroyed) res.destroy(error);
    });
    up.pipe(res);
  });
  const abortUpstream = () => {
    if (!res.writableFinished) r.destroy();
  };
  res.once("close", abortUpstream);
  r.once("close", () => res.off("close", abortUpstream));
  r.on("error", (e) => {
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy(e);
      return;
    }
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ code: -1, msg: "proxy error: " + e.message }));
  });
  if (req.method === "GET" || req.method === "HEAD") r.end();
  else req.pipe(r);
}
function safeHeader(v) {
  if (v === void 0) return void 0;
  const s = Array.isArray(v) ? v.join(", ") : String(v);
  return /^[\x09\x20-\x7e]*$/.test(s) ? s : void 0;
}
function resProxy(req, res, pathname, search) {
  const m = pathname.match(/^\/res\/([^/]+)(\/.*)?$/);
  if (!m) {
    res.writeHead(400).end("bad res url");
    return;
  }
  const host = decodeURIComponent(m[1]);
  if (!RES_HOST_RE.test(host)) {
    res.writeHead(403).end("host not allowed");
    return;
  }
  follow(`https://${host}${m[2] || "/"}${search}`, req, res, RES_REFERER, 0, "public, max-age=86400");
}
function upProxy(req, res, pathname, search) {
  const m = pathname.match(/^\/up\/([^/]+)(\/.*)?$/);
  if (!m) {
    res.writeHead(400).end("bad up url");
    return;
  }
  const host = decodeURIComponent(m[1]);
  if (!/^[\w.-]+$/.test(host)) {
    res.writeHead(403).end("host not allowed");
    return;
  }
  const url = new URL(`https://${host}${m[2] || "/"}${search}`);
  const headers = { ...req.headers, host: url.host };
  delete headers.origin;
  delete headers.referer;
  const r = https4.request({
    hostname: url.hostname,
    port: 443,
    method: req.method,
    path: url.pathname + url.search,
    headers
  }, (up) => {
    res.writeHead(up.statusCode || 502, {
      "content-type": safeHeader(up.headers["content-type"]) || "application/octet-stream",
      "access-control-allow-origin": "*"
    });
    up.pipe(res);
  });
  r.on("error", (e) => {
    res.writeHead(502).end("up proxy error: " + e.message);
  });
  req.pipe(r);
}
async function readBody2(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
async function handleConfig(req, res) {
  if (req.method === "GET") {
    try {
      const text = existsSync2(CONFIG_FILE) ? await readFile(CONFIG_FILE, "utf8") : DEFAULT_CONFIG;
      if (!existsSync2(CONFIG_FILE)) await writeFile(CONFIG_FILE, DEFAULT_CONFIG, "utf8");
      res.writeHead(200, { "content-type": "text/yaml; charset=utf-8", "cache-control": "no-store" });
      res.end(text);
    } catch (e) {
      res.writeHead(500).end(String(e.message));
    }
    return;
  }
  if (req.method === "PUT" || req.method === "POST") {
    try {
      const body = await readBody2(req);
      await writeFile(CONFIG_FILE, body, "utf8");
      console.log("[config] \u5DF2\u66F4\u65B0 yunhu.config.yml");
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500).end(String(e.message));
    }
    return;
  }
  res.writeHead(405).end("method not allowed");
}
async function handleData(req, res, name) {
  if (!DATA_ALLOW.has(name)) {
    res.writeHead(404, JSON_HDR).end(JSON.stringify({ ok: false, msg: "unknown data key" }));
    return;
  }
  const file = join2(DATA_DIR, name + ".json");
  if (req.method === "GET") {
    try {
      const text = existsSync2(file) ? await readFile(file, "utf8") : "";
      res.writeHead(200, JSON_HDR).end(text || "{}");
    } catch (e) {
      res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    }
    return;
  }
  if (req.method === "PUT" || req.method === "POST") {
    const body = await readBody2(req);
    if (body.length > DATA_MAX_BYTES) {
      res.writeHead(413, JSON_HDR).end(JSON.stringify({ ok: false, msg: "too large" }));
      return;
    }
    try {
      JSON.parse(body);
      await writeFile(file, body, "utf8");
      res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, JSON_HDR).end(JSON.stringify({ ok: false, msg: "bad json: " + e.message }));
    }
    return;
  }
  if (req.method === "DELETE") {
    try {
      await unlink(file);
    } catch {
    }
    res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(405, JSON_HDR).end(JSON.stringify({ ok: false, msg: "method not allowed" }));
}
async function handleUpdateCheck(res) {
  const bases = [
    "https://api.github.com",
    "https://ghfast.top/https://api.github.com",
    "https://ghproxy.net/https://api.github.com"
  ];
  const path = "/repos/yibanm/yunhu-richkobe/releases";
  let payload = "";
  let okStatus = 0;
  for (const base of bases) {
    const r = await new Promise((resolve) => {
      const req = https4.get(base + path, { headers: { "user-agent": "yunhu-client", accept: "application/vnd.github+json" } }, (up) => {
        const chunks = [];
        up.on("data", (c) => chunks.push(c));
        up.on("end", () => resolve({ status: up.statusCode || 502, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", (e) => resolve({ status: 502, body: JSON.stringify({ message: e.message }) }));
      req.setTimeout(8e3, () => {
        req.destroy();
        resolve({ status: 504, body: '{"message":"timeout"}' });
      });
    });
    if (r.status === 200) {
      okStatus = 200;
      payload = r.body;
      break;
    }
  }
  if (okStatus !== 200) {
    res.writeHead(502, JSON_HDR).end(JSON.stringify({ ok: false, msg: "github \u4E0D\u53EF\u8FBE\uFF08\u76F4\u8FDE\u4E0E\u955C\u50CF\u5747\u5931\u8D25\uFF09" }));
    return;
  }
  try {
    const list = JSON.parse(payload);
    const ver = (t) => t.replace(/^v/, "").split(".").map(Number);
    const cands = list.filter((x) => /^v?\d+\.\d+\.\d+$/.test(x.tag_name || ""));
    if (!cands.length) {
      res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: false, msg: "no versioned release" }));
      return;
    }
    cands.sort((a, b) => {
      const pa = ver(a.tag_name), pb = ver(b.tag_name);
      for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    });
    const j = cands[0];
    const direct = j.html_url || "";
    res.writeHead(200, JSON_HDR).end(JSON.stringify({
      ok: true,
      tag: j.tag_name || "",
      name: j.name || j.tag_name || "",
      notes: j.body || "",
      url: direct,
      urlFast: direct ? `https://ghfast.top/${direct}` : "",
      assets: (j.assets || []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        urlFast: a.browser_download_url ? `https://ghfast.top/${a.browser_download_url}` : "",
        size: a.size
      }))
    }));
  } catch {
    res.writeHead(502, JSON_HDR).end(JSON.stringify({ ok: false, msg: "bad github payload" }));
  }
}
var FILE_DIR_FILE = join2(homedir(), ".yhchat-filedir");
function defaultFileDir() {
  return process.env.YH_DOWNLOADS_DIR || join2(homedir(), "Downloads");
}
function resolveFileDir() {
  if (process.env.YH_FILE_DIR) return process.env.YH_FILE_DIR;
  try {
    const custom = readFileSync2(FILE_DIR_FILE, "utf8").trim();
    if (isAbsolute(custom)) return custom;
  } catch {
  }
  return defaultFileDir();
}
var FILE_DIR = resolveFileDir();
function downloadSettingsPath() {
  return join2(DATA_DIR, "download-settings.json");
}
function resolveDownloadMode() {
  try {
    if (JSON.parse(readFileSync2(downloadSettingsPath(), "utf8")).mode === "ask") return "ask";
  } catch {
  }
  return "direct";
}
var downloadMode = resolveDownloadMode();
function fileDirectorySettings() {
  return { dir: FILE_DIR, custom: FILE_DIR !== defaultFileDir(), default: defaultFileDir(), mode: downloadMode };
}
try {
  mkdirSync(FILE_DIR, { recursive: true });
} catch {
}
async function handleFileDir(req, res) {
  if (req.method === "GET") {
    res.writeHead(200, JSON_HDR);
    res.end(JSON.stringify(fileDirectorySettings()));
    return;
  }
  if (req.method === "PUT" || req.method === "POST") {
    try {
      const body = JSON.parse(await readBody2(req));
      if (Object.hasOwn(body, "mode")) {
        const { mode } = body;
        if (mode !== "ask" && mode !== "direct" || Object.hasOwn(body, "dir") || Object.hasOwn(body, "reset")) {
          res.writeHead(400, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u4E0B\u8F7D\u4F4D\u7F6E\u9009\u9879\u4E0D\u5408\u6CD5" }));
          return;
        }
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(downloadSettingsPath(), JSON.stringify({ mode }), "utf8");
        downloadMode = mode;
        res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, ...fileDirectorySettings() }));
        return;
      }
      const dir = body.reset === true ? defaultFileDir() : String(body.dir || "").trim();
      if (!isAbsolute(dir) || dir.length > 32767 || dir.includes("\0")) {
        res.writeHead(400, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84" }));
        return;
      }
      await mkdir(dir, { recursive: true });
      if (body.reset === true) await rm(FILE_DIR_FILE, { force: true });
      else await writeFile(FILE_DIR_FILE, dir, "utf8");
      FILE_DIR = process.env.YH_FILE_DIR || dir;
      res.writeHead(200, JSON_HDR);
      res.end(JSON.stringify({ ok: true, ...fileDirectorySettings() }));
    } catch (e) {
      res.writeHead(500, JSON_HDR);
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    }
    return;
  }
  res.writeHead(405).end("method not allowed");
}
async function handleSaveImage(req, res, search) {
  if (req.method !== "POST") {
    res.writeHead(405, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u9700\u8981 POST \u8BF7\u6C42" }));
    return;
  }
  const origin = req.headers.origin;
  if (!req.headers.token || origin && new URL(origin).host !== req.headers.host) {
    res.writeHead(403, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u4EC5\u5141\u8BB8\u5BA2\u6237\u7AEF\u4FDD\u5B58\u56FE\u7247" }));
    return;
  }
  const type = String(req.headers["content-type"] || "").split(";")[0];
  if (!["image/png", "image/jpeg", "image/gif"].includes(type)) {
    res.writeHead(415, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u4EC5\u652F\u6301 PNG\u3001JPG \u6216 GIF \u56FE\u7247" }));
    return;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 40 * 1024 * 1024) {
      res.writeHead(413, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u56FE\u7247\u8D85\u8FC7 40 MB" }));
      return;
    }
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  const valid = type === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : type === "image/gif" ? /^GIF8[79]a$/.test(data.subarray(0, 6).toString("ascii")) : data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!valid) {
    res.writeHead(415, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u56FE\u7247\u5185\u5BB9\u683C\u5F0F\u4E0D\u6B63\u786E" }));
    return;
  }
  const requested = new URLSearchParams(search).get("name") || "image_edited";
  const base = requested.split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/\.[^.]*$/, "").slice(0, 120) || "image_edited";
  const extension = type === "image/png" ? ".png" : type === "image/gif" ? ".gif" : ".jpg";
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  const directory = await downloadDirectory(controller.signal);
  if (!directory) {
    res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, cancelled: true }));
    return;
  }
  await mkdir(directory, { recursive: true });
  controller.signal.throwIfAborted();
  let dest = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    dest = join2(directory, base + (attempt ? "-" + Date.now() + "-" + attempt : "") + extension);
    try {
      await writeFile(dest, data, { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 19) throw error;
    }
  }
  res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, path: dest }));
}
async function selectDirectory(initialDir = "", signal) {
  const prompt = initialDir ? "\u9009\u62E9\u4E0B\u8F7D\u4FDD\u5B58\u4F4D\u7F6E" : "\u9009\u62E9\u76EE\u5F55";
  const run = (cmd, args) => new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        encoding: "utf8",
        timeout: 6e5,
        windowsHide: true,
        signal,
        env: { ...process.env, YH_PICK_DIR_INITIAL: initialDir, YH_PICK_DIR_PROMPT: prompt }
      },
      (error, stdout) => resolve({ out: stdout.trim(), code: error ? error.code ?? "FAILED" : 0 })
    );
  });
  let result;
  if (process.platform === "win32") {
    const script = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;$f=New-Object System.Windows.Forms.FolderBrowserDialog;$f.Description=$env:YH_PICK_DIR_PROMPT;if($env:YH_PICK_DIR_INITIAL){$f.SelectedPath=$env:YH_PICK_DIR_INITIAL};if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){Write-Output $f.SelectedPath}";
    result = await run("powershell.exe", ["-NoProfile", "-STA", "-Command", script]);
  } else if (process.platform === "darwin") {
    const script = 'on run argv\ntry\nif item 1 of argv is "" then\nreturn POSIX path of (choose folder with prompt (item 2 of argv))\nelse\nreturn POSIX path of (choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv)))\nend if\non error number -128\nreturn ""\nend try\nend run';
    result = await run("osascript", ["-e", script, initialDir, prompt]);
  } else {
    const args = ["--file-selection", "--directory", "--title=" + prompt];
    if (initialDir) args.push("--filename=" + initialDir.replace(/\/$/, "") + "/");
    result = await run("zenity", args);
    signal?.throwIfAborted();
    if (result.code !== 0 && result.code !== 1) result = await run("kdialog", ["--getexistingdirectory", initialDir, "--title", prompt]);
    if (result.code === 1) return null;
  }
  signal?.throwIfAborted();
  if (result.code !== 0 || result.out && !isAbsolute(result.out)) throw new Error("\u65E0\u6CD5\u6253\u5F00\u4FDD\u5B58\u4F4D\u7F6E\u9009\u62E9\u7A97\u53E3");
  return result.out || null;
}
async function handlePickDir(_req, res) {
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  try {
    const dir = await selectDirectory("", controller.signal);
    res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, dir: dir || "" }));
  } catch (error) {
    if (!res.destroyed) res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, dir: "", note: error.message }));
  }
}
function downloadDirectory(signal) {
  return downloadMode === "ask" ? selectDirectory(FILE_DIR, signal) : FILE_DIR;
}
var localDownloads = /* @__PURE__ */ new Map();
function localDownloadTarget(input2, requestHost) {
  const base = `http://127.0.0.1:${PORT}`;
  const url = new URL(input2, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
  if (RES_HOST_RE.test(url.host)) return base + "/res/" + url.host + url.pathname + url.search;
  const sameHost = url.origin === base || url.host === requestHost;
  if (sameHost && /^\/(?:res|webdav)\//.test(url.pathname)) return base + url.pathname + url.search;
  return "";
}
function localFileName(input2) {
  let name = input2.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().replace(/[. ]+$/, "").slice(0, 140).replace(/[. ]+$/, "") || "file";
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = "_" + name;
  return name;
}
async function storeDownload(target, directory, name, signal, progress) {
  const cacheKey = directory + "\n" + target + "\n" + name;
  const saved = localDownloads.get(cacheKey);
  if (saved && existsSync2(saved)) return saved;
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(join2(directory, ".yh-download-"));
  const part = join2(scratch, "data.part");
  try {
    const source = await new Promise((resolve, reject) => {
      const request = http.get(target, { signal }, resolve);
      request.on("error", reject);
      request.setTimeout(3e4, () => request.destroy(new Error("\u6587\u4EF6\u4E0B\u8F7D\u8D85\u65F6")));
    });
    if (source.statusCode !== 200) {
      source.destroy();
      throw new Error("\u4E0B\u8F7D\u5931\u8D25 HTTP " + source.statusCode);
    }
    const total = Number(source.headers["content-length"]) || 0;
    let received = 0;
    let last = Date.now();
    progress?.(received, total);
    const meter = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length;
        const now = Date.now();
        if (now - last >= 150) {
          last = now;
          progress?.(received, total);
        }
        done(null, chunk);
      }
    });
    await pipeline(source, meter, createWriteStream(part), { signal });
    if (total && received !== total) throw new Error("\u6587\u4EF6\u4E0B\u8F7D\u4E0D\u5B8C\u6574");
    progress?.(received, total);
    const extension = extname(name);
    const base = name.slice(0, name.length - extension.length);
    for (let attempt = 0; attempt < 100; attempt++) {
      signal.throwIfAborted();
      const dest = join2(directory, attempt ? `${base} (${attempt})${extension}` : name);
      try {
        try {
          await link(part, dest);
        } catch (error) {
          if (!["EPERM", "ENOTSUP", "EXDEV", "EOPNOTSUPP", "ENOSYS"].includes(error.code)) throw error;
          await copyFile(part, dest, constants.COPYFILE_EXCL);
        }
        localDownloads.set(cacheKey, dest);
        if (localDownloads.size > 200) {
          const oldest = localDownloads.keys().next().value;
          if (oldest !== void 0) localDownloads.delete(oldest);
        }
        return dest;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    throw new Error("\u540C\u540D\u6587\u4EF6\u8FC7\u591A");
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {
    });
  }
}
async function handleLocalDownload(req, res, search) {
  if (req.method !== "POST") {
    res.writeHead(405, JSON_HDR).end(JSON.stringify({ msg: "\u9700\u8981 POST \u8BF7\u6C42" }));
    return;
  }
  if (!req.headers.token || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
    res.writeHead(403, JSON_HDR).end(JSON.stringify({ msg: "\u4EC5\u5141\u8BB8\u5BA2\u6237\u7AEF\u53D1\u8D77\u4E0B\u8F7D" }));
    return;
  }
  const q = new URLSearchParams(search);
  const target = localDownloadTarget(q.get("url") || "", req.headers.host);
  if (!target) {
    res.writeHead(403, JSON_HDR).end(JSON.stringify({ msg: "\u6587\u4EF6\u5730\u5740\u4E0D\u53D7\u652F\u6301" }));
    return;
  }
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  res.writeHead(200, { ...JSON_HDR, "content-type": "application/x-ndjson; charset=utf-8" });
  const report = (data) => {
    if (!res.destroyed) res.write(JSON.stringify(data) + "\n");
  };
  try {
    if (downloadMode === "ask") report({ choosing: true });
    const directory = await downloadDirectory(controller.signal);
    if (!directory) report({ ok: true, cancelled: true });
    else {
      const path = await storeDownload(
        target,
        directory,
        localFileName(q.get("name") || ""),
        controller.signal,
        (received, total) => {
          if (!res.writableNeedDrain) report({ received, total });
        }
      );
      report({ ok: true, path });
    }
  } catch (error) {
    report({ ok: false, msg: error.message });
  }
  res.end();
}
async function handleLocalOpen(req, res, search) {
  const query = new URLSearchParams(search);
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  try {
    const target = localDownloadTarget(query.get("url") || "", req.headers.host);
    if (!target) {
      res.writeHead(403, JSON_HDR).end(JSON.stringify({ ok: false, msg: "\u6587\u4EF6\u5730\u5740\u4E0D\u53D7\u652F\u6301" }));
      return;
    }
    const name = localFileName(query.get("name") || "");
    const keySuffix = "\n" + target + "\n" + name;
    let dest = [...localDownloads].reverse().find(([key, path]) => key.endsWith(keySuffix) && existsSync2(path))?.[1];
    if (!dest) {
      const directory = await downloadDirectory(controller.signal);
      if (!directory) {
        res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, cancelled: true }));
        return;
      }
      dest = await storeDownload(target, directory, name, controller.signal);
    }
    if (res.destroyed) return;
    if (process.platform === "win32") {
      await new Promise((resolve, reject) => {
        const explorer = spawn("explorer.exe", ["/select," + dest], { detached: true, stdio: "ignore" });
        explorer.once("error", reject);
        explorer.once("spawn", () => {
          explorer.unref();
          resolve();
        });
      });
    } else {
      await new Promise((resolve, reject) => execFile(process.platform === "darwin" ? "open" : "xdg-open", [dirname(dest)], { timeout: 1e4 }, (error) => error ? reject(error) : resolve()));
    }
    res.writeHead(200, JSON_HDR).end(JSON.stringify({ ok: true, path: dest }));
  } catch (e) {
    res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
  }
}
async function handleLocalRead(req, res, search) {
  const tok = String(req.headers.token || "").trim();
  if (!tok) {
    res.writeHead(401, JSON_HDR).end(JSON.stringify({ ok: false, msg: "token required" }));
    return;
  }
  const q = new URLSearchParams(search || "");
  const p = String(q.get("path") || "");
  if (!p || !existsSync2(p)) {
    res.writeHead(404, JSON_HDR).end(JSON.stringify({ ok: false, msg: "file not found" }));
    return;
  }
  try {
    const data = await readFile(p);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(extname(p) ? p.slice(0, -extname(p).length).split(/[\\/]/).pop() + extname(p) : p.split(/[\\/]/).pop()),
      "access-control-allow-origin": "*"
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
  }
}
async function staticFile(res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  let file = join2(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync2(file)) file = join2(ROOT, "index.html");
  try {
    const data = await readFile(file);
    const cc = extname(file) === ".html" ? "no-store" : "public, max-age=86400";
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": cc });
    res.end(data);
  } catch {
    res.writeHead(404).end("404");
  }
}
function serverApp(req, res) {
  const { pathname, search } = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS"
    }).end();
    return;
  }
  if (pathname === "/bot-ai/request") {
    void handleAiBridge(req, res, process.env.YH_BOT_BRIDGE_SECRET || "");
    return;
  }
  if (pathname === "/bot-ai/proof") {
    handleAiProof(req, res, process.env.YH_BOT_BRIDGE_SECRET || "", new URLSearchParams(search).get("nonce") || "");
    return;
  }
  if (pathname === "/config") {
    handleConfig(req, res);
    return;
  }
  const dataM = pathname.match(/^\/data\/([a-z]+)$/);
  if (dataM) {
    handleData(req, res, dataM[1]);
    return;
  }
  if (pathname === "/data-dir") {
    handleDataDir(req, res).catch((e) => {
      res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname === "/update-check" && req.method === "GET") {
    handleUpdateCheck(res).catch((e) => {
      res.writeHead(502, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname === "/local-download") {
    void handleLocalDownload(req, res, search).catch((e) => {
      if (!res.headersSent) res.writeHead(400, JSON_HDR);
      res.end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname === "/local-open" && req.method === "GET") {
    handleLocalOpen(req, res, search).catch((e) => {
      res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname === "/sticker-directory") {
    void stickerDirectory(req, res, search);
    return;
  }
  if (pathname === "/local-save-image") {
    handleSaveImage(req, res, search).catch((e) => {
      res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname === "/file-dir") {
    handleFileDir(req, res).catch((e) => {
      res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname === "/pick-dir" && req.method === "GET") {
    handlePickDir(req, res);
    return;
  }
  if (pathname === "/local-read" && req.method === "GET") {
    handleLocalRead(req, res, search).catch((e) => {
      res.writeHead(500, JSON_HDR).end(JSON.stringify({ ok: false, msg: e.message }));
    });
    return;
  }
  if (pathname.startsWith("/satori/")) {
    handleSatori(req, res, pathname, search).catch((e) => {
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 500, message: e.message }));
      } catch {
      }
    });
    return;
  }
  if (pathname === "/webdav" || pathname.startsWith("/webdav/")) {
    handleWebdav(req, res, pathname, search).then((ok) => {
      if (!ok) res.writeHead(404).end("WebDAV route not handled");
    }).catch((e) => {
      try {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("WebDAV error: " + e.message);
      } catch {
      }
    });
    return;
  }
  if (pathname === "/mount-json") {
    handleMountJson(req, res, new URL(req.url || "/", "http://x")).catch((e) => {
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, msg: e.message }));
      } catch {
      }
    });
    return;
  }
  if (pathname.startsWith("/res/")) {
    resProxy(req, res, pathname, search);
    return;
  }
  if (pathname.startsWith("/up/")) {
    upProxy(req, res, pathname, search);
    return;
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    follow(UPSTREAM + pathname.replace(/^\/api/, "") + search, req, res, null, 0, "no-store");
    return;
  }
  staticFile(res, pathname);
}
var server = http.createServer(serverApp).listen(PORT, HOST, () => {
  console.log(`[yunhu] http://${HOST}:${PORT}  root=${ROOT}`);
  console.log(`        api \u2192 ${UPSTREAM}   res \u2192 Referer: ${RES_REFERER}   config \u2192 ${CONFIG_FILE}`);
  console.log(`        satori: /satori/v1/*  (HTTP) + /satori/v1/ws (WebSocket)`);
});
var HTTPS_PORT = Number(process.env.HTTPS_PORT || 8903);
var CERT_DIR = join2(BASE, "certs");
try {
  const keyFile = join2(CERT_DIR, "key.pem");
  const certFile = join2(CERT_DIR, "cert.pem");
  if (!existsSync2(keyFile) || !existsSync2(certFile)) {
    mkdirSync(CERT_DIR, { recursive: true });
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "3650",
      "-subj",
      "/CN=yunhu-client",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
    ], { stdio: "ignore" });
    console.log("[yunhu] \u5DF2\u81EA\u7B7E HTTPS \u8BC1\u4E66\uFF08\u81EA\u7B7E\u7684\uFF0C\u6D4F\u89C8\u5668\u4F1A\u63D0\u793A\u4E0D\u5B89\u5168\uFF0C\u624B\u52A8\u4FE1\u4EFB\u5373\u53EF\uFF09");
  }
  const httpsSrv = https4.createServer({
    key: readFileSync2(keyFile),
    cert: readFileSync2(certFile)
  }, serverApp);
  httpsSrv.on("error", (e) => {
    console.log(`[yunhu] https ${HTTPS_PORT} \u8D77\u4E0D\u6765\uFF08${e.code || e.message}\uFF09\uFF0C\u4EC5 http \u53EF\u7528`);
  });
  httpsSrv.listen(HTTPS_PORT, HOST, () => {
    console.log(`[yunhu] https://${HOST}:${HTTPS_PORT}  (\u624B\u673A\u5F55\u97F3/\u5F55\u50CF\u8981\u7528\u8FD9\u4E2A\uFF0C\u56E0\u4E3A\u662F\u5B89\u5168\u4E0A\u4E0B\u6587)`);
  });
} catch (e) {
  console.log("[yunhu] HTTPS \u6CA1\u8D77\u6765\uFF08\u4E0D\u5F71\u54CD http\uFF09\uFF1A" + (e?.message || e));
}
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (!isSatoriWs(url.pathname)) {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  if (!key || !token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${acceptKey(String(key))}\r
\r
`
  );
  socket.setNoDelay(true);
  const ws = new SatoriSocket(socket, token);
  ws.on("message", (raw) => {
    try {
      const j = JSON.parse(raw);
      if (j.op === 1) ws.event("pong", {});
    } catch {
    }
  });
  ws.start().catch(() => {
  });
});
process.on("uncaughtException", (e) => {
  console.error("[yunhu] uncaughtException\uFF08\u5DF2\u515C\u5E95\uFF0C\u8FDB\u7A0B\u4E0D\u9000\u51FA\uFF09:", e?.message || e);
});
process.on("unhandledRejection", (e) => {
  console.error("[yunhu] unhandledRejection\uFF08\u5DF2\u515C\u5E95\uFF0C\u8FDB\u7A0B\u4E0D\u9000\u51FA\uFF09:", e?.message || e);
});
