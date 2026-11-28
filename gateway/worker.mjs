// Founder-only inference gateway. No prompt or credential logging.
const MODEL = "openai/gpt-oss-120b";
const UPSTREAM = "https://api.groq.com/openai/v1/chat/completions";
const MAX_BODY = 24 * 1024;
const MAX_RESPONSE = 64 * 1024;
const DAY_LIMIT = 100;
const MINUTE_LIMIT = 6;
const tokenPattern = /^[0-9a-f]{64}$/;
function reply(status, code, extra = {}) {
  return new Response(JSON.stringify({status: code}), {
    status, headers: {"content-type": "application/json", "cache-control": "no-store", ...extra}
  });
}
async function equalToken(a, b) {
  if (!tokenPattern.test(a) || !tokenPattern.test(b)) return false;
  const enc = new TextEncoder();
  const [x,y] = await Promise.all([a,b].map(v => crypto.subtle.digest("SHA-256", enc.encode(v))));
  // Constant-work comparison of fixed-size digests.
  let diff = 0;
  const xx = new Uint8Array(x), yy = new Uint8Array(y);
  for (let i = 0; i < xx.length; i++) diff |= xx[i] ^ yy[i];
  return diff === 0;
}
async function boundedBody(stream, max) {
  if (!stream) throw new Error("empty body");
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error("body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}
export function normalize(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
  const allowed = new Set(["model","messages","stream","reasoning_effort","include_reasoning","max_completion_tokens","temperature"]);
  if (Object.keys(body).some(k => !allowed.has(k)) || body.model !== MODEL ||
      body.stream !== false || body.reasoning_effort !== "low" || body.include_reasoning !== false ||
      ![256,512].includes(body.max_completion_tokens) ||
      ![0.1,0.2,0.55].includes(body.temperature)) throw new Error("invalid options");
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > 11 ||
      messages[0]?.role !== "system" || messages.at(-1)?.role !== "user") throw new Error("invalid messages");
  let total = 0;
  for (const [i,m] of messages.entries()) {
    if (!m || typeof m !== "object" || Object.keys(m).length !== 2 ||
        !Object.hasOwn(m,"content") || !Object.hasOwn(m,"role") ||
        !(i === 0 ? m.role === "system" : ["user","assistant"].includes(m.role)) ||
        typeof m.content !== "string" || !m.content.trim() ||
        m.content.length > (i === 0 ? 9000 : 5000)) throw new Error("invalid message");
    total += m.content.length;
  }
  if (total > 16000) throw new Error("messages too large");
  return {model: MODEL, messages: messages.map(({role,content}) => ({role,content})),
    stream: false, reasoning_effort: "low", include_reasoning: false,
    max_completion_tokens: body.max_completion_tokens, temperature: body.temperature};
}
export function nextQuota(old, now) {
  const day = Math.floor(now / 86400000), minute = Math.floor(now / 60000);
  const daily = old?.day === day ? old.daily : 0;
  const perMinute = old?.minute === minute ? old.perMinute : 0;
  if (daily >= DAY_LIMIT) return {retry: Math.ceil(((day+1)*86400000-now)/1000)};
  if (perMinute >= MINUTE_LIMIT) return {retry: Math.ceil(((minute+1)*60000-now)/1000)};
  return {state:{day,minute,daily:daily+1,perMinute:perMinute+1}};
}
// One global SQLite-backed object; synchronous SQL operations serialize reservations.
// Only counters are persisted; failed upstream attempts consume quota as well.
export class GatewayQuota {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS quota (id INTEGER PRIMARY KEY, day INTEGER, minute INTEGER, daily INTEGER, perMinute INTEGER)");
  }
  async fetch(request) {
    if (request.method !== "POST") return reply(405,"method");
    const old = this.sql.exec("SELECT day, minute, daily, perMinute FROM quota WHERE id=1").toArray()[0];
    const next = nextQuota(old, Date.now());
    if (next.retry) return reply(429,"quota",{"retry-after":String(next.retry)});
    const s = next.state;
    this.sql.exec("INSERT OR REPLACE INTO quota VALUES (1,?,?,?,?)",s.day,s.minute,s.daily,s.perMinute);
    return reply(200,"reserved");
  }
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/health") return reply(404,"not_found");
      if (!tokenPattern.test(env.OPLYRA_CLIENT_TOKEN || "") || !env.GROQ_API_KEY) return reply(503,"not_configured");
      const auth = request.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ") || !(await equalToken(auth.slice(7), env.OPLYRA_CLIENT_TOKEN)))
        return reply(401,"unauthorized");
      if (url.pathname === "/health") return request.method === "GET" ? reply(200,"ready") : reply(405,"method");
      if (request.method !== "POST") return reply(405,"method");
      if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return reply(415,"content_type");
      if (Number(request.headers.get("content-length")) > MAX_BODY) return reply(413,"too_large");
      let payload;
      try { payload = normalize(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await boundedBody(request.body, MAX_BODY)))); }
      catch { return reply(400,"invalid_request"); }
      const gate = env.QUOTA.get(env.QUOTA.idFromName("founder-global"));
      const reservation = await gate.fetch("https://quota.internal/reserve",{method:"POST"});
      if (!reservation.ok) return reservation.status === 429
        ? reply(429,"quota",{"retry-after":reservation.headers.get("retry-after") || "60"})
        : reply(503,"quota_unavailable");
      const upstream = await fetch(UPSTREAM,{
        method:"POST", redirect:"error", signal:AbortSignal.timeout(30000),
        headers:{"authorization":"Bearer "+env.GROQ_API_KEY,"content-type":"application/json"},
        body:JSON.stringify(payload)
      });
      if (!upstream.ok) {
        const retry = upstream.headers.get("retry-after");
        await upstream.body?.cancel();
        return upstream.status === 429 ? reply(429,"provider_quota",{"retry-after":/^\d{1,5}$/.test(retry || "") ? retry : "60"})
          : reply(502,"provider_error");
      }
      const bytes = await boundedBody(upstream.body, MAX_RESPONSE);
      // Return only the fields needed by the existing Rust parser.
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(data.choices) || data.choices.length !== 1) return reply(502,"provider_response");
      const choice = data.choices[0];
      if (choice?.message?.role !== "assistant" || typeof choice.message.content !== "string" ||
          (choice.message.tool_calls != null && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length)))
        return reply(502,"provider_response");
      return new Response(JSON.stringify({choices:[{finish_reason:choice.finish_reason,
        message:{role:"assistant",content:choice.message.content}}]}),
        {headers:{"content-type":"application/json","cache-control":"no-store"}});
    } catch { return reply(503,"gateway_unavailable"); }
  }
};
