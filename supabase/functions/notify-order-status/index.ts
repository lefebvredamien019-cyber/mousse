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

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

const statusMessage = (status, shopName, orderId, tracking) => {
  const prefix = "Commande " + orderId + " — " + shopName + " : ";
  const messages = {
    received: "la boutique a bien reçu ta commande.",
    accepted: "la boutique a accepté ta commande.",
    preparing: "le commerçant prépare ta commande.",
    ready: "ta commande est prête au retrait.",
    shipped: tracking
      ? "ta commande a été expédiée. Suivi : " + tracking
      : "ta commande a été expédiée.",
    in_delivery: "ta commande est en cours de livraison.",
    delivered: "ta commande est indiquée comme livrée.",
    collected: "ta commande a été retirée. Merci et à bientôt !",
    cancelled: "ta commande a été annulée. Contacte la boutique si tu as une question.",
  };
  return prefix + messages[status];
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.includes(origin)) return new Response("Origin not allowed", { status: 403 });
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !anonKey || !serviceKey || !authorization) {
    return json(503, { error: "Order status service is not configured" }, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid request body" }, origin);
  }

  const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
  const status = body?.status;
  const trackingNumber = typeof body?.tracking_number === "string"
    ? body.tracking_number.trim().slice(0, 120)
    : "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId) ||
      !["preparing", "ready", "shipped", "in_delivery", "delivered", "collected", "cancelled"].includes(status)) {
    return json(400, { error: "Please check the order status" }, origin);
  }

  const authHeaders = {
    "apikey": anonKey,
    "Authorization": authorization,
    "Content-Type": "application/json",
  };

  try {
    const rpcResponse = await fetch(supabaseUrl + "/rest/v1/rpc/update_merchant_order_status", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_order_id: orderId,
        p_status: status,
        p_tracking_number: trackingNumber || null,
      }),
    });
    const order = await rpcResponse.json().catch(() => null);
    if (!rpcResponse.ok || !order?.order_id) {
      console.error("Order status update failed:", rpcResponse.status);
      return json(rpcResponse.status === 401 ? 401 : 400, {
        error: "The status could not be updated for this shop",
      }, origin);
    }

    let notificationSent = false;
    const message = statusMessage(status, order.shop_name, order.order_id, order.tracking_number);
    if (order.notification_channel === "email") {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const emailFrom = Deno.env.get("ORDER_EMAIL_FROM");
      if (resendKey && emailFrom && order.customer_email && order.shop_email) {
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: emailFrom,
              to: [order.customer_email],
              reply_to: order.shop_email,
              subject: "Suivi de ta commande — " + order.shop_name,
              html: "<p>Bonjour " + escapeHtml(order.customer_name) + ",</p><p>" +
                escapeHtml(message) + "</p>" +
                (order.tracking_number ? "<p>Suivi : " + escapeHtml(order.tracking_number) + "</p>" : "") +
                "<p>Pour toute question, réponds directement à la boutique.</p>",
            }),
          });
          notificationSent = response.ok;
        } catch {
          notificationSent = false;
        }
      }
    } else if (order.notification_channel === "sms") {
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const token = Deno.env.get("TWILIO_AUTH_TOKEN");
      const from = Deno.env.get("TWILIO_FROM_NUMBER");
      if (sid && token && from && order.customer_phone) {
        try {
          const response = await fetch(
            "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + "/Messages.json",
            {
              method: "POST",
              headers: {
                "Authorization": "Basic " + btoa(sid + ":" + token),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({ To: order.customer_phone, From: from, Body: message }),
            },
          );
          notificationSent = response.ok;
        } catch {
          notificationSent = false;
        }
      }
    }

    const serviceHeaders = {
      "apikey": serviceKey,
      "Authorization": "Bearer " + serviceKey,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };
    const saved = await fetch(
      supabaseUrl + "/rest/v1/orders?id=eq." + encodeURIComponent(order.order_id),
      {
        method: "PATCH",
        headers: serviceHeaders,
        body: JSON.stringify({ customer_notification_status: notificationSent ? "sent" : "failed" }),
      },
    );
    if (!saved.ok) console.error("Could not record customer notification result:", saved.status);

    return json(200, {
      updated: true,
      status: order.status,
      notification_sent: notificationSent,
    }, origin);
  } catch (error) {
    console.error("Order status service failed:", error instanceof Error ? error.message : "unknown error");
    return json(503, { error: "Order status service is temporarily unavailable" }, origin);
  }
});
