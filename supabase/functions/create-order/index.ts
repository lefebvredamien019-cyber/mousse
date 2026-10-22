const allowedOrigins = (Deno.env.get("APP_ORIGINS") ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

const json = (status, body, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });

const clip = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.includes(origin)) {
    return new Response("Origin not allowed", { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors(origin) });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("ORDER_EMAIL_FROM");
  const rateLimitSalt = Deno.env.get("ORDER_RATE_LIMIT_SALT");
  if (!supabaseUrl || !serviceKey || !resendKey || !emailFrom || !rateLimitSalt) {
    return json(503, { error: "Order service is not configured" }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request body" }, origin);
  }
  // Quietly accept bot honeypot submissions without creating orders or sending email.
  if (clip(body?.website, 200)) return json(200, { accepted: true }, origin);

  const shopId = clip(body?.shop_id, 64);
  const customerName = clip(body?.customer_name, 120);
  const customerEmail = clip(body?.customer_email, 254);
  const customerPhone = clip(body?.customer_phone, 20);
  const notificationChannel = body?.notification_channel;
  const fulfillment = body?.fulfillment;
  const deliveryAddress = clip(body?.delivery_address, 300);
  const deliveryNote = clip(body?.delivery_note, 500);
  const customerNote = clip(body?.customer_note, 500);
  const items = body?.items;

  if (!/^[0-9a-f-]{36}$/i.test(shopId) || customerName.length < 2 ||
      !Array.isArray(items) || items.length < 1 || items.length > 50 ||
      !["pickup", "delivery"].includes(fulfillment) ||
      (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) ||
      (fulfillment === "delivery" && deliveryAddress.length < 5)) {
    return json(400, { error: "Please check the order details" }, origin);
  }

  const clientIp = request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!clientIp) return json(400, { error: "Unable to validate this request" }, origin);
  const bucket = await sha256(clientIp + ":" + rateLimitSalt);
  const headers = {
    "apikey": serviceKey,
    "Authorization": "Bearer " + serviceKey,
    "Content-Type": "application/json",
  };
  const callSupabase = async (path, payload, method = "POST") => {
    const response = await fetch(supabaseUrl + "/rest/v1/" + path, {
      method,
      headers: { ...headers, "Prefer": "return=representation" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const result = await response.json().catch(() => null);
    return { response, result };
  };

  let createdOrderId = null;
  try {
    const rate = await callSupabase("rpc/consume_order_rate_limit", {
      p_bucket: bucket, p_limit: 5, p_window_seconds: 900,
    });
    if (!rate.response.ok) {
      console.error("Rate-limit check failed:", rate.response.status);
      return json(503, { error: "Order service is temporarily unavailable" }, origin);
    }
    if (rate.result !== true) return json(429, { error: "Please wait before placing another order" }, origin);

    const order = await callSupabase("rpc/create_customer_order", {
      p_shop_id: shopId,
      p_customer_name: customerName,
      p_customer_email: notificationChannel === "email" ? customerEmail : null,
      p_customer_phone: notificationChannel === "sms" ? customerPhone : null,
      p_notification_channel: notificationChannel,
      p_fulfillment: fulfillment,
      p_delivery_address: fulfillment === "delivery" ? deliveryAddress : null,
      p_delivery_note: deliveryNote,
      p_customer_note: customerNote,
      p_items: items,
    });
    if (!order.response.ok || !order.result?.order_id || !order.result?.shop_email) {
      console.error("Order creation failed:", order.response.status);
      return json(400, { error: "The order could not be created. Please review the shop and basket." }, origin);
    }

    const data = order.result;
    createdOrderId = data.order_id;
    const lineText = (data.items ?? []).map((item) =>
      escapeHtml(item.quantity) + " × " + escapeHtml(item.name) + " — " +
      (Number(item.unit_price_cents * item.quantity) / 100).toFixed(2) + " €"
    ).join("<br>");
    const deliveryText = fulfillment === "delivery"
      ? "<p><strong>Adresse de livraison :</strong> " + escapeHtml(data.delivery_address) +
        "<br>" + escapeHtml(data.delivery_note || "") + "</p>"
      : "<p><strong>Retrait :</strong> Click & Collect en boutique.</p>";
    const total = (Number(data.total_cents) / 100).toFixed(2);
    const merchantEmailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom,
        to: [data.shop_email],
        ...(data.customer_email ? { reply_to: data.customer_email } : {}),
        subject: "Nouvelle commande MOUSSE — " + data.shop_name,
        html: "<h1>Nouvelle commande</h1><p>Commande <strong>" +
          escapeHtml(data.order_id) + "</strong> reçue pour <strong>" +
          escapeHtml(data.shop_name) + "</strong>.</p><p>Client : " +
          escapeHtml(data.customer_name) + "<br>Contact : " +
          escapeHtml(data.customer_email || data.customer_phone || "") + "</p>" +
          deliveryText + "<p>" + lineText + "</p><p><strong>Total : " + total +
          " €</strong></p>" +
          (data.customer_note ? "<p>Note : " + escapeHtml(data.customer_note) + "</p>" : ""),
      }),
    });

    let customerNotificationSent = false;
    if (notificationChannel === "email") {
      const customerResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: emailFrom,
          to: [data.customer_email],
          reply_to: data.shop_email,
          subject: "Commande reçue — " + data.shop_name,
          html: "<h1>Commande reçue</h1><p>Bonjour " + escapeHtml(data.customer_name) +
            ", la boutique <strong>" + escapeHtml(data.shop_name) +
            "</strong> a bien reçu ta commande <strong>" + escapeHtml(data.order_id) +
            "</strong>.</p><p>" + lineText + "</p>" + deliveryText +
            "<p>Total : <strong>" + total + " €</strong></p>" +
            "<p>Tu recevras une nouvelle notification lorsque son statut changera.</p>",
        }),
      });
      customerNotificationSent = customerResponse.ok;
    } else {
      const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
      const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
      if (twilioSid && twilioToken && twilioFrom) {
        const smsBody = "MOUSSE — " + data.shop_name + " a reçu ta commande " +
          data.order_id + ". Tu recevras une alerte à chaque mise à jour.";
        const smsResponse = await fetch(
          "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(twilioSid) + "/Messages.json",
          {
            method: "POST",
            headers: {
              "Authorization": "Basic " + btoa(twilioSid + ":" + twilioToken),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ To: data.customer_phone, From: twilioFrom, Body: smsBody }),
          },
        );
        customerNotificationSent = smsResponse.ok;
      }
    }

    const merchantNotificationSent = merchantEmailResponse.ok;
    await callSupabase("orders?id=eq." + encodeURIComponent(data.order_id), {
      notification_status: merchantNotificationSent ? "sent" : "failed",
      customer_notification_status: customerNotificationSent ? "sent" : "failed",
    }, "PATCH");

    return json(200, {
      order_id: data.order_id,
      order_created: true,
      merchant_notification_sent: merchantNotificationSent,
      customer_notification_sent: customerNotificationSent,
    }, origin);
  } catch (error) {
    console.error("Order service failed:", error instanceof Error ? error.message : "unknown error");
    if (createdOrderId) {
      try {
        await callSupabase("orders?id=eq." + encodeURIComponent(createdOrderId), {
          notification_status: "failed",
          customer_notification_status: "failed",
        }, "PATCH");
      } catch {
        console.error("Order notification status could not be updated.");
      }
      return json(200, { order_id: createdOrderId, order_created: true, merchant_notification_sent: false, customer_notification_sent: false }, origin);
    }
    return json(503, { error: "Order service is temporarily unavailable" }, origin);
  }
});
