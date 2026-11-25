const allowedOrigins = (Deno.env.get("APP_ORIGINS") ?? "https://www.mousse-market.fr")
  .split(",").map((value) => value.trim()).filter(Boolean);
const cors = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});
const json = (status: number, body: unknown, origin: string) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" } });
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const signToken = async (payload: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
};
Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.includes(origin)) return new Response("Origin not allowed", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!url || !service || !sid || !token || !from) return json(503, { error: "SMS verification is not configured" }, origin);

  let body: { action?: string; phone?: string; code?: string };
  try { body = await request.json(); } catch { return json(400, { error: "Invalid request" }, origin); }
  const phone = typeof body.phone === "string" ? body.phone.replace(/[\s().-]/g, "") : "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return json(400, { error: "Enter a valid international phone number" }, origin);

  const headers = { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json", Prefer: "return=representation" };
  const table = url + "/rest/v1/customer_phone_otps";
  const phoneHash = await digest("mousse-phone:" + phone + ":" + service);
  const read = async () => {
    const response = await fetch(table + "?phone_hash=eq." + encodeURIComponent(phoneHash) + "&select=*&limit=1", { headers });
    const rows = await response.json().catch(() => []);
    return { response, row: Array.isArray(rows) ? rows[0] : null };
  };

  if (body.action === "send") {
    const clientIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!clientIp) return json(400, { error: "Unable to validate this request" }, origin);
    const bucket = await digest("mousse-sms:" + clientIp + ":" + service);
    const rate = await fetch(url + "/rest/v1/rpc/consume_order_rate_limit", {
      method: "POST",
      headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" },
      body: JSON.stringify({ p_bucket: bucket, p_limit: 5, p_window_seconds: 900 }),
    });
    const allowed = await rate.json().catch(() => false);
    if (!rate.ok) return json(503, { error: "Verification service unavailable" }, origin);
    if (allowed !== true) return json(429, { error: "Too many SMS requests. Try again later." }, origin);
    const current = await read();
    if (!current.response.ok) return json(503, { error: "Verification service unavailable" }, origin);
    if (current.row?.last_sent_at && Date.now() - Date.parse(current.row.last_sent_at) < 60_000) {
      return json(429, { error: "Wait one minute before requesting another code" }, origin);
    }
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const code = String(random[0] % 1_000_000).padStart(6, "0");
    const codeHash = await digest("mousse-otp:" + phone + ":" + code + ":" + service);
    const saved = await fetch(table + "?on_conflict=phone_hash", {
      method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ phone_hash: phoneHash, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), attempts: 0, last_sent_at: new Date().toISOString() }),
    });
    if (!saved.ok) return json(503, { error: "Could not prepare verification code" }, origin);
    const sms = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + "/Messages.json", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(sid + ":" + token), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: phone, From: from, Body: "MOUSSE : ton code de vérification est " + code + ". Il expire dans 10 minutes. Ne le partage avec personne." }),
    });
    if (!sms.ok) {
      await fetch(table + "?phone_hash=eq." + encodeURIComponent(phoneHash), { method: "DELETE", headers });
      console.error("Twilio verification SMS failed:", sms.status);
      return json(503, { error: "SMS could not be sent. Check the phone number and try later." }, origin);
    }
    return json(200, { sent: true, expires_in_seconds: 600, retry_after_seconds: 60 }, origin);
  }

  if (body.action === "verify") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return json(400, { error: "Enter the 6-digit code" }, origin);
    const current = await read();
    const row = current.row;
    if (!current.response.ok) return json(503, { error: "Verification service unavailable" }, origin);
    if (!row || Date.parse(row.expires_at) <= Date.now()) return json(410, { error: "Code expired. Request a new one." }, origin);
    if (Number(row.attempts) >= 5) return json(429, { error: "Too many attempts. Request a new code." }, origin);
    const expected = await digest("mousse-otp:" + phone + ":" + code + ":" + service);
    if (expected !== row.code_hash) {
      await fetch(table + "?phone_hash=eq." + encodeURIComponent(phoneHash), {
        method: "PATCH", headers, body: JSON.stringify({ attempts: Number(row.attempts) + 1 }),
      });
      return json(400, { error: "Incorrect code. Check the 6 digits and try again." }, origin);
    }
    await fetch(table + "?phone_hash=eq." + encodeURIComponent(phoneHash), { method: "DELETE", headers });
    const expiresAt = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ phone, exp: expiresAt, purpose: "mousse-order-phone" })));
    const signature = await signToken(payload, service);
    return json(200, { verified: true, proof: payload + "." + signature, expires_at: new Date(expiresAt * 1000).toISOString() }, origin);
  }

  return json(400, { error: "Unknown action" }, origin);
});