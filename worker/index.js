// VB Stats public guest gateway. The Railway access key stays in Cloudflare Secret bindings.
// All endpoints are explicitly allowlisted; no public general-purpose proxy.
const API_ORIGIN = "https://vb-stats-ai-beta-production.up.railway.app";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
function error(detail, status = 503) {
  return new Response(JSON.stringify({ detail }), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  }});
}
function allowed(path, method) {
  if (path === "/capabilities") return method === "GET";
  if (["/api/analysis/youtube-jobs", "/api/analysis/auto-jobs", "/api/analysis/uploads"].includes(path)) return method === "POST";
  if (/^\/api\/analysis\/jobs\/[a-f0-9-]{36}$/.test(path)) return method === "GET" || method === "DELETE";
  if (/^\/api\/analysis\/jobs\/[a-f0-9-]{36}\/resume$/.test(path)) return method === "POST";
  if (/^\/api\/analysis\/uploads\/[a-f0-9-]{36}\/probe$/.test(path)) return method === "GET";
  if (/^\/api\/analysis\/uploads\/[a-f0-9-]{36}$/.test(path)) return method === "DELETE";
  return false;
}
async function api(request, env, url) {
  const path = url.pathname, method = request.method.toUpperCase();
  if (!allowed(path, method)) return error("Ruta de análisis no disponible.", 404);
  if (typeof env.VBSTATS_RAILWAY_KEY !== "string" || env.VBSTATS_RAILWAY_KEY.length < 24) {
    return error("El análisis online está preparándose. Vuelve a intentarlo más adelante.");
  }
  if (method !== "GET" && request.headers.get("Origin") !== url.origin) {
    return error("La solicitud debe iniciarse desde VB Stats.", 403);
  }
  const visitor = request.headers.get("CF-Connecting-IP") || "unknown-ip";
  try {
    if (!(await env.VBSTATS_API_LIMIT.limit({ key: visitor })).success) {
      return error("Demasiadas consultas. Prueba de nuevo dentro de un minuto.", 429);
    }
    if (method === "POST" && ["/api/analysis/youtube-jobs", "/api/analysis/auto-jobs"].includes(path)) {
      if (!(await env.VBSTATS_GUEST_START_LIMIT.limit({ key: visitor })).success ||
          !(await env.VBSTATS_GLOBAL_START_LIMIT.limit({ key: "guest-jobs" })).success) {
        return error("Hay muchos análisis en curso. Prueba de nuevo dentro de un minuto.", 429);
      }
    }
    if (method === "POST" && path === "/api/analysis/uploads") {
      if (!(await env.VBSTATS_UPLOAD_LIMIT.limit({ key: visitor })).success) {
        return error("Demasiadas subidas. Prueba de nuevo dentro de un minuto.", 429);
      }
      const size = Number(request.headers.get("content-length"));
      if (!Number.isSafeInteger(size) || size <= 0) {
        return error("Para subir un archivo es necesario indicar su tamaño.", 411);
      }
      if (size > MAX_UPLOAD_BYTES) {
        return error("La beta pública admite archivos de hasta 25 MB; también puedes usar un enlace de YouTube.", 413);
      }
    }
  } catch {
    return error("El control de uso no está disponible. Inténtalo de nuevo más tarde.");
  }
  const headers = new Headers({
    "X-VB-Stats-Key": env.VBSTATS_RAILWAY_KEY,
    "Accept": "application/json",
  });
  if (request.headers.has("Content-Type")) headers.set("Content-Type", request.headers.get("Content-Type"));
  try {
    const upstream = await fetch(API_ORIGIN + path, {
      method, headers,
      body: method === "GET" ? undefined : request.body,
      redirect: "manual", duplex: "half",
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return error("El motor de análisis ha cambiado de dirección. Inténtalo más tarde.", 502);
    }
    if (path === "/capabilities" && upstream.ok) {
      const data = await upstream.json();
      data.maxUploadMB = Math.min(Number(data.maxUploadMB) || 25, 25);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return error("El motor de IA no responde. Inténtalo más tarde.", 502);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/capabilities" || url.pathname.startsWith("/api/analysis/")) {
      return api(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};