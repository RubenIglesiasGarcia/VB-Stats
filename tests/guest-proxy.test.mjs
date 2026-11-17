import test from "node:test";
import assert from "node:assert/strict";
import gateway from "../worker/index.js";

const SITE = "https://vb-stats.test.workers.dev";
const TOKEN = "test-only-placeholder-key-with-32-characters";
function bindings({ enabled=true, allowed=true }={}) {
  const rate = { limit: async () => ({ success: allowed }) };
  return {
    VBSTATS_RAILWAY_KEY: enabled ? TOKEN : undefined,
    VBSTATS_API_LIMIT: rate,
    VBSTATS_GUEST_START_LIMIT: rate,
    VBSTATS_GLOBAL_START_LIMIT: rate,
    VBSTATS_UPLOAD_LIMIT: rate,
    ASSETS: { fetch: () => new Response("static site") },
  };
}

test("static files are served without API access", async () => {
  const res = await gateway.fetch(new Request(SITE+"/"), bindings({enabled:false}));
  assert.equal(await res.text(), "static site");
});
test("guest API fails closed until owner configures secret", async () => {
  const res = await gateway.fetch(new Request(SITE+"/capabilities"), bindings({enabled:false}));
  assert.equal(res.status, 503);
});
test("no extra or unauthorized API endpoint is proxied", async () => {
  const res = await gateway.fetch(new Request(SITE+"/api/analysis/private"), bindings());
  assert.equal(res.status, 404);
});
test("cross-origin attempts cannot start analysis", async () => {
  const res = await gateway.fetch(new Request(SITE+"/api/analysis/youtube-jobs", {
    method:"POST",body:"{}",headers:{"Origin":"https://not-our-site.test"}
  }), bindings());
  assert.equal(res.status, 403);
});
test("rate-limit failure never contacts Railway", async () => {
  const res = await gateway.fetch(new Request(SITE+"/capabilities"), bindings({allowed:false}));
  assert.equal(res.status, 429);
});
test("secret is injected only on the server and response is cache-disabled", async () => {
  const original=globalThis.fetch;
  let called=false;
  globalThis.fetch = async (url, opts) => {
    called=true;
    assert.equal(url, "https://vb-stats-ai-beta-production.up.railway.app/capabilities");
    assert.equal(opts.headers.get("X-VB-Stats-Key"),TOKEN);
    return Response.json({engines:{ravel:{ready:true}},maxUploadMB:200});
  };
  try {
    const res=await gateway.fetch(new Request(SITE+"/capabilities"),bindings());
    assert.equal(res.status,200);
    assert.equal(res.headers.get("Cache-Control"),"no-store");
    assert.equal((await res.json()).maxUploadMB,25);
    assert.equal(called,true);
  } finally {globalThis.fetch=original;}
});
test("guest uploads over 25 MB are rejected", async () => {
  const res=await gateway.fetch(new Request(SITE+"/api/analysis/uploads",{
    method:"POST",body:"x",headers:{"Origin":SITE,"Content-Length":"30000000"}
  }),bindings());
  assert.equal(res.status,413);
});
