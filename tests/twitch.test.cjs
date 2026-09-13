const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Compile the real server module with isolated credentials and a mocked transport.
// No real network calls or secrets are used by these contract tests.
function loadModule(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, URLSearchParams, AbortSignal, ...globals,
    require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: file });
  return exports;
}
const links = loadModule("lib/twitch-links.ts");
const video = { id: "123", user_login: "creator", user_name: "Creator", title: "Broadcast",
  view_count: 100, published_at: "2026-09-01T00:00:00Z", thumbnail_url: "https://static-cdn.jtvnw.net/thumb-%{width}x%{height}.jpg",
  duration: "1h2m3s", viewable: "public" };
const clip = { id: "Great-Clip", broadcaster_id: "7", broadcaster_name: "Creator", title: "Moment",
  view_count: 200, created_at: "2026-09-02T00:00:00Z", thumbnail_url: "https://clips-media-assets2.twitch.tv/test.jpg", duration: 23.4 };
const options = { query: "creator", parsed: { subject: null }, order: "relevance" };

function server(handler, configured = true) {
  const calls = [];
  const api = loadModule("lib/twitch.ts", { "server-only": {}, "./twitch-links": links }, {
    process: { env: configured ? { TWITCH_CLIENT_ID: "test-id", TWITCH_CLIENT_SECRET: "test-secret" } : {} },
    fetch: async (url, init) => {
      const parsed = new URL(url);
      calls.push(parsed);
      if (parsed.hostname === "id.twitch.tv") return Response.json({ access_token: "mock-token", expires_in: 3600 });
      assert.equal(parsed.hostname, "api.twitch.tv");
      assert.equal(init.headers["Client-Id"], "test-id");
      assert.equal(init.headers.Authorization, "Bearer mock-token");
      return handler(parsed);
    },
  });
  return { api, calls };
}

test("Twitch URLs recognize videos, both clip formats and channels; reject lookalike hosts", () => {
  assert.equal(links.parseTwitchLink("https://www.twitch.tv/videos/123?t=30s").kind, "video");
  assert.equal(links.parseTwitchLink("https://clips.twitch.tv/Great-Clip").id, "Great-Clip");
  assert.equal(links.parseTwitchLink("https://www.twitch.tv/creator/clip/Great-Clip").kind, "clip");
  assert.equal(links.parseTwitchLink("https://twitch.tv/creator/videos").id, "creator");
  for (const url of ["https://twitch.tv.evil.com/videos/123", "https://twitch.tv@evil.com/videos/123", "http://twitch.tv/videos/123", "https://twitch.tv/videos/nope"]) {
    assert.equal(links.parseTwitchLink(url), null);
  }
});

test("duration and embed parameters preserve VOD vs clip identity", () => {
  assert.equal(links.parseTwitchDuration("1h2m3s"), 3723);
  assert.equal(links.parseTwitchDuration("30s"), 30);
  assert.equal(links.parseTwitchDuration(""), null);
  assert.equal(links.parseTwitchDuration("garbage"), null);
  const vod = new URL(links.twitchEmbedUrl("vod-123", "example.com", 65));
  assert.equal(vod.hostname, "player.twitch.tv");
  assert.equal(vod.searchParams.get("video"), "v123");
  assert.equal(vod.searchParams.get("time"), "65s");
  assert.equal(vod.searchParams.get("parent"), "example.com");
  assert.equal(vod.searchParams.get("autoplay"), "false");
  const embed = new URL(links.twitchEmbedUrl("Great-Clip", "localhost"));
  assert.equal(embed.hostname, "clips.twitch.tv");
  assert.equal(embed.searchParams.get("clip"), "Great-Clip");
});

test("missing credentials returns setup state without network access", async () => {
  const { api, calls } = server(() => { throw new Error("Unexpected fetch"); }, false);
  assert.equal((await api.searchTwitch(options)).status, "setup_required");
  assert.equal(calls.length, 0);
});

test("channel discovery merges videos and clips with accurate metadata and sorting", async () => {
  const { api, calls } = server((url) => {
    if (url.pathname.endsWith("search/channels")) return Response.json({ data: [{ id: "7", broadcaster_login: "creator" }] });
    if (url.pathname.endsWith("videos")) return Response.json({ data: [video] });
    return Response.json({ data: [clip] });
  });
  const result = await api.searchTwitch({ ...options, order: "viewCount" });
  assert.equal(result.status, "ok");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].mediaType, "clip");
  assert.equal(result.results[1].id, "vod-123");
  assert.equal(result.results[1].durationSeconds, 3723);
  assert.equal(result.results[1].thumbnailUrl, "https://static-cdn.jtvnw.net/thumb-640x360.jpg");
  assert.equal(result.results[0].channelUrl, "https://www.twitch.tv/creator");
  assert.equal(calls.find((url) => url.pathname.endsWith("videos")).searchParams.get("sort"), "views");
});

test("direct VOD URL bypasses channel search and survives detail reload", async () => {
  const { api, calls } = server((url) => {
    assert.equal(url.pathname, "/helix/videos");
    assert.equal(url.searchParams.get("id"), "123");
    return Response.json({ data: [video] });
  });
  const result = await api.searchTwitch({ ...options, query: "https://twitch.tv/videos/123" });
  assert.equal(result.results[0].id, "vod-123");
  assert.equal((await api.getTwitchVideo("123")).url, "https://www.twitch.tv/videos/123");
  assert.equal(calls.filter((url) => url.hostname === "id.twitch.tv").length, 1);
});

test("direct clips use broadcaster login rather than display name", async () => {
  const { api } = server((url) => Response.json({ data: url.pathname.endsWith("users") ? [{ login: "creator_login" }] : [clip] }));
  const result = await api.searchTwitch({ ...options, query: "https://clips.twitch.tv/Great-Clip" });
  assert.equal(result.results[0].channelUrl, "https://www.twitch.tv/creator_login");
});

test("rate limits and partial provider failures are surfaced", async () => {
  const { api } = server((url) => {
    if (url.pathname.endsWith("search/channels")) return Response.json({ data: [{ id: "7", broadcaster_login: "creator" }] });
    if (url.pathname.endsWith("videos")) return Response.json({ data: [video] });
    return new Response(null, { status: 429 });
  });
  const partial = await api.searchTwitch(options);
  assert.equal(partial.status, "ok");
  assert.equal(partial.results.length, 1);
  assert.equal(partial.providerNotices.length, 1);
  const limited = server(() => new Response(null, { status: 429 }));
  assert.equal((await limited.api.searchTwitch(options)).status, "quota_exceeded");
});

test("401 refresh is retried once, and missing or malformed responses stay honest", async () => {
  let attempts = 0;
  const { api, calls } = server(() => ++attempts === 1 ? new Response(null, { status: 401 }) : Response.json({ data: [] }));
  assert.equal((await api.searchTwitch(options)).status, "ok");
  assert.equal(calls.filter((url) => url.hostname === "id.twitch.tv").length, 2);
  const missing = server(() => Response.json({ data: [] }));
  assert.equal(await missing.api.getTwitchVideo("123"), null);
  const expired = server(() => new Response(null, { status: 404 }));
  assert.equal(await expired.api.getTwitchVideo("123"), null);
  const broken = server(() => Response.json({ unexpected: true }));
  assert.equal((await broken.api.searchTwitch(options)).status, "error");
});
