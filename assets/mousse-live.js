(() => {
  const settings = window.MOUSSE_CONFIG || {};
  const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(settings.supabaseUrl || "") &&
    typeof settings.supabaseAnonKey === "string" && settings.supabaseAnonKey.length > 20;

  const status = (id, message, isError = false) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.classList.remove("hidden");
    element.classList.toggle("notice-error", isError);
  };

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":'&#39;' })[character]);
  const euroCents = (cents) => (Number(cents || 0) / 100).toLocaleString("fr-FR", {
    style: "currency", currency: "EUR"
  });

  if (!isConfigured) {
    window.MOUSSE_LIVE_STATUS = "not-configured";
    document.getElementById("merchantWorkspace")?.classList.remove("hidden");
    status("merchantAuthStatus", "Mode présentation : aucun compte ou e-mail de commande ne sera créé tant que le backend n’est pas configuré.");
    return;
  }
  if (!window.supabase?.createClient) {
    window.MOUSSE_LIVE_STATUS = "client-unavailable";
    status("merchantAuthStatus", "Le service de comptes n’a pas pu être chargé. Recharge la page ou réessaie plus tard.", true);
    return;
  }

  document.getElementById("liveShopPicker")?.classList.remove("hidden");
  window.demoCart = window.demoCart || [];
  const client = window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey);
  window.MOUSSE_CLIENT_AUTHENTICATED = false;
  window.MOUSSE_IS_MERCHANT_AUTHENTICATED = false;
  const publicClient = window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "mousse-public-anon-client" }
  });
  let currentUser = null;
  let currentMerchant = null;
  let currentShop = null;
  let currentIsAdmin = false;
  let loadGeneration = 0;
  window.MOUSSE_LIVE_STATUS = "configured";

  const workspace = document.getElementById("merchantWorkspace");
  const profile = (shop) => {
    const set = (id, value) => {
      const field = document.getElementById(id);
      if (field && value != null) field.value = value;
    };
    set("merchantName", shop.name);
    set("merchantEmail", shop.email);
    set("merchantAddress", shop.address);
    set("merchantIntro", shop.description);
    set("merchantColor", shop.theme_color || "#173f32");
    const delivery = document.getElementById("merchantDeliveryEnabled");
    if (delivery) delivery.checked = !!shop.delivery_enabled;
    set("merchantDeliveryFee", (Number(shop.delivery_fee_cents || 0) / 100).toFixed(2));
    set("merchantDeliveryMin", (Number(shop.delivery_min_cents || 0) / 100).toFixed(2));
    set("merchantTemplate", shop.shop_template || "classic");
    set("merchantActivity", shop.business_category || "other");
    set("merchantMenuStyle", shop.menu_style || "tiles");
    set("merchantCategoryTileSize", shop.category_tile_size || "medium");
    set("merchantProductTileSize", shop.product_tile_size || "medium");
    renderMerchantCategoryEditor();
    refreshProductCategoryOptions();
    set("merchantPauseMessage", shop.pause_message || "");
    set("merchantPauseReturn", shop.pause_return_at ? new Date(shop.pause_return_at).toISOString().slice(0, 16) : "");
    set("merchantDeliveryPostcodes", Array.isArray(shop.delivery_postcodes) ? shop.delivery_postcodes.join(", ") : "");
    set("merchantDeliveryRadius", shop.delivery_radius_km ?? "");
    set("merchantResponseDeadline", shop.response_deadline_minutes || 30);
    set("merchantReminderMinutes", shop.reminder_minutes || 10);
    const paused = document.getElementById("merchantOrdersPaused");
    if (paused) paused.checked = !!shop.order_paused;
    const published = document.getElementById("merchantPublished");
    if (published) { published.checked = !!shop.is_published; published.disabled = true; }
    window.renderMerchantPreview?.();
  };

  const applicationStatusLabels = {
    draft: "Brouillon", submitted: "Dossier transmis à MOUSSE", resubmitted: "Dossier corrigé et retransmis",
    changes_requested: "Corrections demandées", approved: "Dossier approuvé", rejected: "Dossier refusé"
  };

  async function loadMerchantApplication() {
    if (!currentUser) return;
    const { data, error } = await client.from("merchant_applications")
      .select("status,review_note,submitted_at,reviewed_at").eq("owner_id", currentUser.id).maybeSingle();
    if (error || !data) return;
    const notice = document.getElementById("setupNotice");
    if (!notice) return;
    notice.hidden = false;
    notice.textContent = (applicationStatusLabels[data.status] || data.status) +
      (data.review_note ? " — Retour MOUSSE : " + data.review_note : "") +
      (data.submitted_at ? " · Envoyé le " + new Date(data.submitted_at).toLocaleDateString("fr-FR") : "");
  }

  async function submitMerchantApplication(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const notice = document.getElementById("setupNotice");
    if (!notice) return;
    const showNotice = (message, isError = false) => {
      notice.textContent = message;
      notice.hidden = false;
      notice.classList.toggle("notice-error", isError);
    };
    if (!currentUser) {
      showNotice("Connecte-toi d’abord dans l’espace commerçant, puis reviens transmettre ton dossier. Rien n’a été envoyé.", true);
      return;
    }
    const formData = new FormData(form);
    const siret = String(formData.get("siret") || "").replace(/\D/g, "");
    if (!/^[0-9]{14}$/.test(siret)) {
      showNotice("Le SIRET doit contenir exactement 14 chiffres.", true);
      return;
    }
    const { data: existing, error: readError } = await client.from("merchant_applications")
      .select("status,review_note,reviewed_at").eq("owner_id", currentUser.id).maybeSingle();
    if (readError) {
      showNotice("Impossible de charger ton dossier. Réessaie dans un instant.", true);
      return;
    }
    if (existing?.status === "approved") {
      showNotice("Ton dossier est déjà approuvé. Contacte MOUSSE si tu dois modifier les informations de validation.", true);
      return;
    }
    const nextStatus = existing && ["changes_requested", "rejected"].includes(existing.status)
      ? "resubmitted" : existing?.status === "resubmitted" ? "resubmitted" : "submitted";
    const values = {
      owner_id: currentUser.id,
      business_name: String(formData.get("businessName") || "").trim(),
      legal_name: String(formData.get("legalName") || "").trim(),
      siret,
      category: String(formData.get("category") || "").trim(),
      manager_name: String(formData.get("managerName") || "").trim(),
      business_email: String(formData.get("email") || "").trim().toLowerCase(),
      phone: String(formData.get("phone") || "").trim(),
      website: String(formData.get("website") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      postal_code: String(formData.get("postalCode") || "").trim(),
      city: String(formData.get("city") || "").trim(),
      network: String(formData.get("network") || "").trim(),
      link_request: formData.get("linkRequest") === "on",
      opening_hours: String(formData.get("hours") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      products_services: String(formData.get("products") || "").trim(),
      requested_tools: formData.getAll("tools").map(value => String(value)),
      status: nextStatus,
      review_note: existing?.review_note || "",
      reviewed_at: existing?.reviewed_at || null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (!values.business_name || !values.category || !values.manager_name || !values.business_email ||
        !values.address || !values.postal_code || !values.city) {
      showNotice("Complète tous les champs obligatoires avant l’envoi.", true);
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Envoi du dossier…"; }
    const { error } = await client.from("merchant_applications").upsert(values, { onConflict: "owner_id" });
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = "Vérifier mon dossier"; }
    if (error) {
      showNotice("Le dossier n’a pas pu être enregistré. Vérifie ta connexion et les champs, puis réessaie.", true);
      return;
    }
    showNotice("Dossier enregistré et transmis à MOUSSE. Le SIRET et les informations doivent encore être vérifiés avant toute publication. Le logo et les photos ne sont pas encore téléversés.");
  }

  async function checkAdminAccess() {
    currentIsAdmin = false;
    const nav = document.getElementById("adminNavButton");
    if (!currentUser) {
      nav?.classList.add("hidden");
      return;
    }
    const { data, error } = await client.from("mousse_admins")
      .select("user_id").eq("user_id", currentUser.id).maybeSingle();
    currentIsAdmin = !error && !!data;
    nav?.classList.toggle("hidden", !currentIsAdmin);
    if (currentIsAdmin) await window.loadAdminApplications();
  }

  window.loadAdminApplications = async () => {
    const list = document.getElementById("adminApplicationsList");
    if (!list || !currentIsAdmin) return;
    const { data, error } = await client.from("merchant_applications")
      .select("id,owner_id,business_name,legal_name,siret,category,manager_name,business_email,phone,address,postal_code,city,description,products_services,requested_tools,status,review_note,submitted_at")
      .order("submitted_at", { ascending: false }).limit(100);
    if (error) {
      list.innerHTML = '<article class="card"><p>Impossible de charger les dossiers. Vérifie les droits d’administration.</p></article>';
      return;
    }
    const labels = { draft:"Brouillon", submitted:"À examiner", resubmitted:"Corrections renvoyées", changes_requested:"Corrections demandées", approved:"Approuvé", rejected:"Refusé" };
    list.innerHTML = data?.length ? data.map(app => {
      const tools = Array.isArray(app.requested_tools) ? app.requested_tools.join(", ") : "";
      const waiting = ["submitted", "resubmitted", "changes_requested"].includes(app.status);
      return '<article class="card admin-application-card" data-application-id="' + escape(app.id) + '">' +
        '<div class="cardhead"><span class="pill">' + escape(labels[app.status] || app.status) + '</span><small>' +
        escape(app.submitted_at ? new Date(app.submitted_at).toLocaleDateString("fr-FR") : "Non transmis") + '</small></div>' +
        '<h3>' + escape(app.business_name) + '</h3><p><strong>Raison sociale :</strong> ' + escape(app.legal_name || "Non renseignée") +
        '<br><strong>SIRET :</strong> ' + escape(app.siret) + '<br><strong>Activité :</strong> ' + escape(app.category) +
        '<br><strong>Responsable :</strong> ' + escape(app.manager_name) + '<br><strong>Contact :</strong> ' + escape(app.business_email) +
        (app.phone ? " · " + escape(app.phone) : "") + '<br><strong>Adresse :</strong> ' +
        escape([app.address, app.postal_code, app.city].filter(Boolean).join(", ")) + '</p>' +
        '<p>' + escape(app.description || "Aucune description") + '</p>' +
        (app.products_services ? '<p><strong>Offre :</strong> ' + escape(app.products_services) + '</p>' : "") +
        (tools ? '<p><strong>Outils souhaités :</strong> ' + escape(tools) + '</p>' : "") +
        (app.review_note ? '<div class="notice"><strong>Dernier retour :</strong> ' + escape(app.review_note) + '</div>' : "") +
        (waiting ? '<div class="field"><label>Motif / retour MOUSSE</label><textarea data-review-note maxlength="1000" placeholder="Obligatoire pour demander des corrections ou refuser">' +
          escape(app.review_note || "") + '</textarea></div><div class="admin-application-actions">' +
          '<button class="btn" type="button" data-review-decision="approved">Approuver et publier</button>' +
          '<button class="btn light" type="button" data-review-decision="changes_requested">Demander des corrections</button>' +
          '<button class="btn light" type="button" data-review-decision="rejected">Refuser le dossier</button></div>' :
          '<p class="muted">Aucune action nécessaire pour ce statut.</p>') + '</article>';
    }).join("") : '<article class="card"><p>Aucun dossier commerçant pour le moment.</p></article>';
  };

  document.getElementById("adminApplicationsList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review-decision]");
    if (!button || !currentIsAdmin) return;
    const card = button.closest("[data-application-id]");
    const decision = button.dataset.reviewDecision;
    const note = card?.querySelector("[data-review-note]")?.value.trim() || "";
    const message = document.getElementById("adminReviewStatus");
    if (!card) return;
    if (decision !== "approved" && note.length < 5) {
      status("adminReviewStatus", "Ajoute un motif clair d’au moins 5 caractères pour demander des corrections ou refuser.", true);
      return;
    }
    button.disabled = true;
    const { data, error } = await client.rpc("review_merchant_application", {
      p_application_id: card.dataset.applicationId,
      p_decision: decision,
      p_note: note
    });
    button.disabled = false;
    if (error || !data?.ok) {
      status("adminReviewStatus", "Décision non enregistrée. Vérifie les droits d’administration et la présence de la boutique liée.", true);
      return;
    }
    status("adminReviewStatus", decision === "approved"
      ? "Dossier approuvé : la vitrine liée est maintenant publiée."
      : decision === "changes_requested" ? "Corrections demandées. Le motif a été enregistré."
      : "Dossier refusé. Le motif a été enregistré.");
    await window.loadAdminApplications();
  });

  async function loadMerchant() {
    if (!currentUser) return;
    const { data, error } = await client.from("shops").select("*").eq("owner_id", currentUser.id).maybeSingle();
    if (error || !data) {
      status("merchantAuthStatus", "Le compte est connecté, mais sa fiche commerce n’a pas été créée. Vérifie le déclencheur d’inscription Supabase.", true);
      return;
    }
    currentMerchant = data;
    profile(data);
    workspace?.classList.remove("hidden");
    status("merchantAuthStatus", "Connecté à l’espace de " + data.name + ".");
    await window.renderMerchantProducts();
    await window.renderOrders();
    await loadMerchantApplication();
    await loadPublicShops(data.is_published ? data.id : null);
  }

  async function refreshSession() {
    const { data, error } = await client.auth.getSession();
    if (error) status("merchantAuthStatus", "Impossible de vérifier la session. Réessaie.", true);
    currentUser = data?.session?.user || null;
    const account = document.getElementById("merchantAccount");
    account?.classList.toggle("hidden", !!currentUser);
    document.getElementById("merchantSignOut")?.classList.toggle("hidden", !currentUser);
    workspace?.classList.toggle("hidden", !currentUser);
    if(currentUser){
      await loadMerchant(); await checkAdminAccess();
      if(currentIsAdmin||currentMerchant){window.MOUSSE_IS_MERCHANT_AUTHENTICATED=true;if(typeof window.enterMerchantWorkspace==="function")window.enterMerchantWorkspace();if(currentIsAdmin)window.showView?.("admin");}
      else window.MOUSSE_IS_MERCHANT_AUTHENTICATED=false;
    }else window.MOUSSE_IS_MERCHANT_AUTHENTICATED=false;
  }

  let featuredShopsCache = [];
  function rotateFeatured(list, day) {
    if (!list.length) return [];
    const start = day % list.length;
    return list.slice(start).concat(list.slice(0, start));
  }
  function renderFeaturedShops(shops) {
    const section = document.getElementById("liveFeaturedSection");
    const grid = document.getElementById("liveFeaturedShops");
    if (!section || !grid) return;
    featuredShopsCache = [...shops].sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
    const input = document.getElementById("featuredLocation");
    try {
      const savedLocation = localStorage.getItem("mousse-featured-location") || "";
      if (input && !input.value && savedLocation) input.value = savedLocation;
    } catch (_) {}
    const location = String(input?.value || "").trim().toLocaleLowerCase("fr-FR");
    if (!featuredShopsCache.length) {
      section.hidden = true;
      return;
    }
    // Location preference is user-entered (city/postcode); it never reads or assumes the visitor's precise location.
    const matchesLocation = shop => {
      const address = String(shop.address || "").toLocaleLowerCase("fr-FR");
      return !!location && address.includes(location);
    };
    const localShops = location ? featuredShopsCache.filter(matchesLocation) : [];
    const otherShops = location ? featuredShopsCache.filter(shop => !matchesLocation(shop)) : featuredShopsCache;
    // Daily rotation shares exposure fairly inside both groups; non-matching shops remain available in discovery.
    const day = Math.floor(Date.now() / 86400000);
    const rotatedLocal = rotateFeatured(localShops, day);
    const rotatedOthers = rotateFeatured(otherShops, day);
    const ordered = location && localShops.length
      ? rotatedLocal.concat(rotatedOthers)
      : rotateFeatured(featuredShopsCache, day);
    const picks = ordered.slice(0, Math.min(3, ordered.length));
    const status = document.getElementById("featuredLocationStatus");
    if (status) {
      status.textContent = location
        ? (localShops.length
          ? localShops.length + " vitrine(s) publiée(s) correspondent exactement à « " + String(input.value).trim() + " ». Les autres commerces restent accessibles dans la recherche."
          : "Aucune adresse de vitrine ne correspond exactement à « " + String(input.value).trim() + " ». Toutes les vitrines restent accessibles dans la recherche.")
        : "Toutes les vitrines publiées restent accessibles dans la recherche. Sélection gratuite et rotation équitable.";
    }
    section.hidden = false;
    grid.innerHTML = picks.map(shop =>
      '<article class="card"><div class="cardhead"><span class="symbol">🏪</span><span class="pill">' +
      (location && matchesLocation(shop) ? "Secteur choisi" : "Vitrine publiée") + '</span></div>' +
      '<h3>' + escape(shop.name) + '</h3><p>' + escape(shop.address || "Adresse non renseignée") + '</p>' +
      '<p>' + escape((shop.description || "Informations du commerce à compléter.").slice(0, 150)) + '</p>' +
      '<button class="btn pale" type="button" data-open-shop="' + escape(shop.id) + '">Découvrir la boutique ↗</button></article>'
    ).join("");
    grid.querySelectorAll("[data-open-shop]").forEach(button => button.addEventListener("click", () => {
      const picker = document.getElementById("liveShopSelect");
      if (picker) picker.value = button.dataset.openShop;
      currentShop = featuredShopsCache.find(shop => shop.id === button.dataset.openShop) || null;
      window.renderClientCatalog();
      window.toggleDelivery();
      window.showView?.("collect");
    }));
  }
  window.setFeaturedLocation = function () {
    const input = document.getElementById("featuredLocation");
    const value = String(input?.value || "").trim().slice(0, 100);
    if (!value) {
      const status = document.getElementById("featuredLocationStatus");
      if (status) status.textContent = "Saisis une ville ou un code postal pour prioriser les vitrines de ce secteur.";
      return;
    }
    try { localStorage.setItem("mousse-featured-location", value); } catch (_) {}
    renderFeaturedShops(featuredShopsCache);
  };
  window.clearFeaturedLocation = function () {
    const input = document.getElementById("featuredLocation");
    if (input) input.value = "";
    try { localStorage.removeItem("mousse-featured-location"); } catch (_) {}
    renderFeaturedShops(featuredShopsCache);
  };

  window.renderNearbyShops = async () => {
    const grid = document.getElementById("nearbyShopGrid");
    const statusEl = document.getElementById("nearbyStatus");
    if (!grid) return;
    grid.innerHTML = '<article class="card"><p>Chargement des commerces publiés…</p></article>';
    const { data, error } = await publicClient.from("shops")
      .select("id,name,address,description,delivery_enabled,order_paused")
      .eq("is_published", true).order("name");
    if (error) {
      grid.innerHTML = '<article class="card"><p>Les vitrines sont momentanément indisponibles. Réessaie dans quelques instants.</p></article>';
      if (statusEl) statusEl.textContent = "Impossible de charger les vitrines publiées.";
      return;
    }
    window.MOUSSE_NEARBY_SHOPS = data || [];
    window.filterNearbyShops?.();
  };

  window.filterNearbyShops = () => {
    const grid = document.getElementById("nearbyShopGrid");
    const statusEl = document.getElementById("nearbyStatus");
    if (!grid) return;
    const shops = window.MOUSSE_NEARBY_SHOPS || [];
    const query = (document.getElementById("nearbyLocation")?.value || "").trim().toLocaleLowerCase("fr");
    const filtered = query ? shops.filter(shop => String(shop.address || "").toLocaleLowerCase("fr").includes(query)) : shops;
    if (statusEl) statusEl.textContent = query
      ? filtered.length + " vitrine(s) publiée(s) trouvée(s) pour « " + query + " »."
      : filtered.length + " vitrine(s) MOUSSE publiée(s).";
    if (!filtered.length) {
      grid.innerHTML = '<article class="card"><div class="symbol">⌖</div><h3>Aucune vitrine trouvée</h3><p>Essaie une autre ville ou un autre code postal, ou reviens plus tard.</p></article>';
      return;
    }
    grid.innerHTML = filtered.map(shop =>
      '<article class="card"><div class="cardhead"><span class="symbol">🏪</span><span class="pill">Vitrine MOUSSE</span></div>' +
      '<h3>' + escape(shop.name) + '</h3><p>' + escape(shop.address || "Adresse non renseignée") + '</p>' +
      '<p>' + escape((shop.description || "Informations du commerce à compléter.").slice(0, 180)) + '</p>' +
      (shop.order_paused ? '<p><span class="pill amber">Commandes suspendues</span></p>' : shop.delivery_enabled ? '<p><span class="pill">Livraison proposée</span></p>' : '') +
      '<button class="btn pale" type="button" data-nearby-shop="' + escape(shop.id) + '">Voir la vitrine et commander ↗</button></article>'
    ).join("");
    grid.querySelectorAll("[data-nearby-shop]").forEach(button => button.addEventListener("click", () => {
      const picker = document.getElementById("liveShopSelect");
      if (picker) picker.value = button.dataset.nearbyShop;
      const shop = shops.find(item => item.id === button.dataset.nearbyShop);
      if (shop) currentShop = shop;
      window.renderClientCatalog?.();
      window.toggleDelivery?.();
      window.showView?.("collect");
    }));
  };

  async function loadPublicShops(preferredId = null) {
    const picker = document.getElementById("liveShopSelect");
    const catalog = document.getElementById("clientCatalog");
    if (!picker || !catalog) return;
    const { data, error } = await publicClient.from("shops")
      .select("id,name,address,description,theme_color,delivery_enabled,delivery_fee_cents,delivery_min_cents,shop_template,business_category,menu_style,menu_categories,menu_category_images,category_tile_size,product_tile_size,order_paused,pause_message,pause_return_at,delivery_postcodes,delivery_radius_km")
      .eq("is_published", true).order("name");
    if (error) {
      picker.innerHTML = '<option value="">Boutiques momentanément indisponibles</option>';
      catalog.innerHTML = '<p class="muted">Impossible de charger les boutiques pour le moment.</p>';
      return;
    }
    renderFeaturedShops(data || []);
    picker.innerHTML = '<option value="">Choisis une boutique</option>' +
      (data || []).map(shop => '<option value="' + escape(shop.id) + '">' + escape(shop.name) +
        (shop.address ? " · " + escape(shop.address) : "") + "</option>").join("");
    if (preferredId && (data || []).some(shop => shop.id === preferredId)) picker.value = preferredId;
    else if ((data || []).length === 1) picker.value = data[0].id;
    currentShop = (data || []).find(shop => shop.id === picker.value) || null;
    window.renderClientCatalog();
    window.toggleDelivery();
    if (!data?.length) catalog.innerHTML = '<p class="muted">Aucune boutique n’est encore ouverte aux commandes.</p>';
  }

  window.saveLiveAffluence = async (state) => {
    if (!currentUser || !currentMerchant) {
      return { ok: false, message: "Connecte-toi à ton espace commerçant pour publier l’affluence." };
    }
    const statusMap = { "Calme": "calme", "Modérée": "modere", "Forte": "charge", "Fermé": "ferme" };
    const dbStatus = statusMap[state.status];
    if (!dbStatus) return { ok: false, message: "Choisis un état d’affluence valide." };
    const note = [state.wait ? "Attente estimée : " + state.wait : "", (state.message || "").trim()]
      .filter(Boolean).join(" — ").slice(0, 500);
    const { error } = await client.from("shop_affluence").upsert({
      shop_id: currentMerchant.id, status: dbStatus, note, updated_at: new Date().toISOString()
    }, { onConflict: "shop_id" });
    if (error) return { ok: false, message: "L’affluence n’a pas pu être publiée. Vérifie la connexion puis réessaie." };
    await loadPublicShops(currentShop?.id || null);
    return { ok: true, message: "Affluence publiée et visible sur la vitrine publique du commerce." };
  };

  window.loginClient = async () => {
    const email=document.getElementById("clientAuthEmail")?.value.trim()||"", password=document.getElementById("clientAuthPassword")?.value||"";
    if(!email||!password)return status("clientAuthStatus","Renseigne ton adresse e-mail et ton mot de passe.",true);
    const {error}=await client.auth.signInWithPassword({email,password});
    if(error)return status("clientAuthStatus","Connexion impossible. Vérifie l’adresse et le mot de passe.",true);
    window.MOUSSE_CLIENT_AUTHENTICATED=true; status("clientAuthStatus","Connexion réussie. Chargement de ton espace client synchronisé."); window.openClientAccount?.();
  };
  window.registerClient = async () => {
    const email=document.getElementById("clientAuthEmail")?.value.trim()||"", password=document.getElementById("clientAuthPassword")?.value||"";
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return status("clientAuthStatus","Renseigne une adresse e-mail valide.",true);
    if(password.length<10)return status("clientAuthStatus","Choisis un mot de passe d’au moins 10 caractères.",true);
    const {data,error}=await client.auth.signUp({email,password,options:{data:{account_type:"client"},emailRedirectTo:"https://www.mousse-market.fr/"}});
    if(error)return status("clientAuthStatus","Création du compte impossible. Vérifie les champs et les réglages d’inscription.",true);
    if(!data.session)return status("clientAuthStatus","Compte créé. Confirme l’adresse reçue par e-mail, puis connecte-toi ici.");
    window.MOUSSE_CLIENT_AUTHENTICATED=true; status("clientAuthStatus","Compte créé et connecté. Chargement de ton espace client synchronisé."); window.openClientAccount?.();
  };
  // Client password recovery and profile data use Supabase Auth and database.
  window.saveClientNewPassword = async () => {
    const password = document.getElementById("clientNewPassword")?.value || "";
    const confirm = document.getElementById("clientNewPasswordConfirm")?.value || "";
    if (password.length < 10 || password !== confirm) return status("clientAuthStatus", "Les deux mots de passe doivent correspondre et contenir au moins 10 caractères.", true);
    const { error } = await client.auth.updateUser({ password });
    if (error) return status("clientAuthStatus", "Impossible d’enregistrer ce mot de passe. Rouvre le lien reçu par e-mail puis réessaie.", true);
    document.getElementById("clientRecoveryPanel")?.classList.add("hidden");
    document.getElementById("clientNewPassword").value = "";
    document.getElementById("clientNewPasswordConfirm").value = "";
    status("clientAuthStatus", "Mot de passe modifié. Tu peux maintenant te connecter.");
  };

  window.requestClientPasswordReset = async () => {
    const email=document.getElementById("clientAuthEmail")?.value.trim()||"";
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return status("clientAuthStatus","Saisis une adresse e-mail valide pour demander la réinitialisation.",true);
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:"https://www.mousse-market.fr/?recovery=client"});
    status("clientAuthStatus",error?"La demande n’a pas pu être envoyée. Vérifie la configuration e-mail et l’URL de redirection.":"Si cette adresse correspond à un compte, un e-mail de réinitialisation va être envoyé.");
  };
  window.logoutClient = async () => {
    const {error}=await client.auth.signOut(); if(error)return status("clientAuthStatus","Déconnexion impossible. Réessaie.",true);
    window.MOUSSE_CLIENT_AUTHENTICATED=false;window.MOUSSE_IS_MERCHANT_AUTHENTICATED=false;window.backToRoleGate?.();
  };

  window.loginMerchant = async () => {
    const gate=document.getElementById("merchantLoginGate"), gateVisible=!!(gate&&!gate.hidden);
    const email=(gateVisible?document.getElementById("merchantGateEmail")?.value:document.getElementById("merchantLoginEmail")?.value||"").trim();
    const password=gateVisible?document.getElementById("merchantGatePassword")?.value||"":document.getElementById("merchantLoginPassword")?.value||"";
    if(!email||!password)return status(gateVisible?"merchantGateStatus":"merchantAuthStatus","Renseigne ton adresse e-mail et ton mot de passe.",true);
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error)return status(gateVisible?"merchantGateStatus":"merchantAuthStatus","Connexion impossible. Vérifie l’adresse et le mot de passe.",true);
    currentUser=data.user; await refreshSession();
    if(!currentMerchant&&!currentIsAdmin){window.MOUSSE_IS_MERCHANT_AUTHENTICATED=false;return status(gateVisible?"merchantGateStatus":"merchantAuthStatus","Compte connecté, mais aucun espace professionnel actif n’est associé à ce compte. Vérifie ton inscription ou contacte MOUSSE.",true);}
    window.MOUSSE_IS_MERCHANT_AUTHENTICATED=true; window.enterMerchantWorkspace?.();
  };

  // The visible merchant login gate calls this name from its inline button handler.
  // Route it through the shared login function so the gate inputs and status are handled correctly.
  window.submitMerchantGateLogin = () => window.loginMerchant();

  window.resendMerchantConfirmation = async () => {
    const gate = document.getElementById("merchantLoginGate");
    const gateVisible = !!(gate && !gate.hidden);
    const email = String((gateVisible
      ? document.getElementById("merchantGateEmail")?.value
      : document.getElementById("merchantLoginEmail")?.value) || "").trim().toLowerCase();
    const statusId = gateVisible ? "merchantGateStatus" : "merchantAuthStatus";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return status(statusId, "Saisis d’abord une adresse e-mail valide.", true);
    }
    const { error } = await publicClient.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: "https://www.mousse-market.fr/" }
    });
    if (error) {
      return status(statusId, "Le renvoi n’a pas abouti. Réessaie dans quelques minutes ou vérifie la configuration e-mail Supabase.", true);
    }
    status(statusId, "Demande effectuée. Si cette adresse correspond à un compte en attente de confirmation, vérifie ta boîte de réception et les courriers indésirables.");
  };

  window.registerMerchant = async () => {
    const name = document.getElementById("signupShopName").value.trim();
    const email = document.getElementById("merchantLoginEmail").value.trim();
    const password = document.getElementById("merchantLoginPassword").value;
    if (name.length < 2) return status("merchantAuthStatus", "Renseigne d’abord le nom de ton commerce.", true);
    if (!email || password.length < 10) return status("merchantAuthStatus", "Utilise une adresse e-mail valide et un mot de passe d’au moins 10 caractères.", true);
    const { data, error } = await client.auth.signUp({
      email, password, options: {
        data: { account_type: "merchant", shop_name: name },
        emailRedirectTo: "https://www.mousse-market.fr/"
      }
    });
    if (error) return status("merchantAuthStatus", "Création du compte impossible. Vérifie les réglages d’inscription Supabase.", true);
    currentUser = data.session?.user || null;
    if (!currentUser) {
      return status("merchantAuthStatus", "Compte créé. Confirme l’adresse reçue par e-mail, puis connecte-toi ici.");
    }
    await refreshSession();
  };

  window.requestMerchantPasswordReset = async () => {
    const email = document.getElementById("merchantLoginEmail")?.value.trim() || "";
    const result = document.getElementById("merchantRecoveryStatus");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status("merchantRecoveryStatus", "Saisis d’abord une adresse e-mail valide.", true);
      return;
    }
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: "https://www.mousse-market.fr/?recovery=merchant"
    });
    // Keep the response generic to avoid disclosing whether an account exists.
    status("merchantRecoveryStatus", error
      ? "La demande n’a pas pu être envoyée. Vérifie la configuration e-mail et l’URL de redirection Supabase."
      : "Si cette adresse correspond à un compte, un e-mail de réinitialisation va être envoyé.");
  };

  window.saveMerchantNewPassword = async () => {
    const password = document.getElementById("merchantNewPassword")?.value || "";
    const confirm = document.getElementById("merchantNewPasswordConfirm")?.value || "";
    if (password.length < 10) return status("merchantRecoveryStatus", "Le nouveau mot de passe doit contenir au moins 10 caractères.", true);
    if (password !== confirm) return status("merchantRecoveryStatus", "Les deux mots de passe ne correspondent pas.", true);
    const { error } = await client.auth.updateUser({ password });
    if (error) return status("merchantRecoveryStatus", "Impossible d’enregistrer ce mot de passe. Rouvre le lien reçu par e-mail et réessaie.", true);
    document.getElementById("merchantRecoveryPanel")?.classList.add("hidden");
    document.getElementById("merchantNewPassword").value = "";
    document.getElementById("merchantNewPasswordConfirm").value = "";
    status("merchantRecoveryStatus", "Mot de passe modifié. Tu peux maintenant te connecter.");
  };

  window.logoutMerchant = async () => {
    const { error } = await client.auth.signOut();
    if (error) return status("merchantAuthStatus", "Déconnexion impossible. Réessaie.", true);
    currentUser = null;
    currentMerchant = null;
    workspace?.classList.add("hidden");
    document.getElementById("merchantAccount")?.classList.remove("hidden");
    document.getElementById("merchantSignOut")?.classList.add("hidden");
    status("merchantAuthStatus", "Tu es déconnecté.");
    window.leaveMerchantWorkspace?.();
    window.backToRoleGate?.();
  };

  window.saveMerchantDemo = async () => {
    if (!currentUser || !currentMerchant) return status("merchantAuthStatus", "Connecte-toi pour enregistrer le commerce.", true);
    const fee = Math.round(Number(document.getElementById("merchantDeliveryFee").value || 0) * 100);
    const minimum = Math.round(Number(document.getElementById("merchantDeliveryMin").value || 0) * 100);
    if (![fee, minimum].every(value => Number.isInteger(value) && value >= 0 && value <= 10000000)) {
      return status("merchantSaved", "Vérifie les montants de livraison.", true);
    }
    const values = {
      name: document.getElementById("merchantName").value.trim(),
      email: document.getElementById("merchantEmail").value.trim(),
      address: document.getElementById("merchantAddress").value.trim(),
      description: document.getElementById("merchantIntro").value.trim(),
      theme_color: document.getElementById("merchantColor").value,
      delivery_enabled: document.getElementById("merchantDeliveryEnabled").checked,
      delivery_fee_cents: fee,
      delivery_min_cents: minimum,
      shop_template: document.getElementById("merchantTemplate").value,
      business_category: document.getElementById("merchantActivity").value,
      menu_style: document.getElementById("merchantMenuStyle").value,
      menu_categories: getMerchantCategories(),
      menu_category_images: currentMerchant.menu_category_images && typeof currentMerchant.menu_category_images === "object" ? currentMerchant.menu_category_images : {},
      category_tile_size: document.getElementById("merchantCategoryTileSize")?.value || "medium",
      product_tile_size: document.getElementById("merchantProductTileSize")?.value || "medium",
      order_paused: document.getElementById("merchantOrdersPaused").checked,
      pause_message: document.getElementById("merchantPauseMessage").value.trim().slice(0, 240),
      pause_return_at: document.getElementById("merchantPauseReturn").value ? new Date(document.getElementById("merchantPauseReturn").value).toISOString() : null,
      delivery_postcodes: [...new Set(document.getElementById("merchantDeliveryPostcodes").value.split(",").map(value => value.trim()).filter(Boolean))],
      delivery_radius_km: document.getElementById("merchantDeliveryRadius").value ? Number(document.getElementById("merchantDeliveryRadius").value) : null,
      response_deadline_minutes: Number(document.getElementById("merchantResponseDeadline").value || 30),
      reminder_minutes: Number(document.getElementById("merchantReminderMinutes").value || 10),
      is_published: currentMerchant.is_published,
      updated_at: new Date().toISOString()
    };
    if (values.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return status("merchantSaved", "Renseigne un nom et une adresse e-mail valide pour le commerce.", true);
    if (!["classic", "restaurant", "services", "hybrid"].includes(values.shop_template)) return status("merchantSaved", "Choisis un modèle de vitrine valide.", true);
    if (!Number.isInteger(values.response_deadline_minutes) || values.response_deadline_minutes < 5 || values.response_deadline_minutes > 1440 ||
        !Number.isInteger(values.reminder_minutes) || values.reminder_minutes < 1 || values.reminder_minutes >= values.response_deadline_minutes) {
      return status("merchantSaved", "Le délai maximal doit être de 5 à 1 440 minutes et le rappel doit arriver avant l’expiration.", true);
    }
    if (values.delivery_radius_km !== null && (!Number.isInteger(values.delivery_radius_km) || values.delivery_radius_km < 1 || values.delivery_radius_km > 200)) return status("merchantSaved", "Le rayon de livraison doit être compris entre 1 et 200 km.", true);
    if (values.delivery_postcodes.some(code => !/^\d{5}$/.test(code))) return status("merchantSaved", "Chaque code postal doit contenir 5 chiffres.", true);
    if (values.pause_return_at && Number.isNaN(Date.parse(values.pause_return_at))) return status("merchantSaved", "Vérifie la date de reprise estimée.", true);
    if (values.order_paused && values.pause_return_at && Date.parse(values.pause_return_at) <= Date.now()) return status("merchantSaved", "La reprise estimée doit être dans le futur.", true);
    const { data, error } = await client.from("shops").update(values)
      .eq("id", currentMerchant.id).select("*").single();
    if (error) return status("merchantSaved", "Enregistrement impossible. Vérifie les règles de sécurité du commerce.", true);
    currentMerchant = data;
    window.renderMerchantPreview?.();
    status("merchantSaved", values.is_published
      ? "Commerce enregistré et publié dans le catalogue client."
      : "Commerce enregistré en mode privé.");
    await loadPublicShops(data.is_published ? data.id : null);
  };

  const defaultMenuCategories = {
    fast_food: ["Boissons", "Sandwichs", "Burgers", "Menus", "Desserts", "Accompagnements"],
    restaurant: ["Entrées", "Plats", "Boissons", "Desserts"],
    epicerie: ["Fruits et légumes", "Épicerie", "Boissons", "Produits frais"],
    retail: ["Nouveautés", "Vêtements", "Accessoires", "Promotions"],
    beauty: ["Coupes", "Colorations", "Soins", "Rendez-vous"],
    mechanic: ["Moteur", "Train roulant", "Freinage", "Diagnostic", "Entretien"],
    services: ["Prestations", "Dépannage", "Installation", "Autres"],
    cbd: ["Fleurs", "Résines", "Huiles", "Accessoires"],
    other: ["Produits", "Services", "Autres"]
  };
  const categoryLabels = { fast_food:"Fast-food / snack", restaurant:"Restaurant / café", epicerie:"Épicerie", retail:"Boutique / vêtements", beauty:"Coiffure / beauté", mechanic:"Mécanique auto / poids lourd", services:"Artisan / services", cbd:"CBD", other:"Autre métier" };
  function getMerchantCategories() {
    const stored = currentMerchant?.menu_categories;
    if (Array.isArray(stored) && stored.length) return [...new Set(stored.map(value => String(value).trim()).filter(Boolean))].slice(0, 40);
    const activity = document.getElementById("merchantActivity")?.value || currentMerchant?.business_category || "other";
    return [...(defaultMenuCategories[activity] || defaultMenuCategories.other)];
  }
  function renderMerchantCategoryEditor() {
    const element = document.getElementById("merchantCategoryEditor");
    if (!element) return;
    const categories = getMerchantCategories();
    const categoryImages = currentMerchant?.menu_category_images && typeof currentMerchant.menu_category_images === "object" ? currentMerchant.menu_category_images : {};
    element.innerHTML = categories.map((category, index) => '<div class="category-row"><input aria-label="Nom de catégorie" maxlength="60" value="' + escape(category) + '" data-category-name="' + index + '"><img class="category-photo" alt="" src="' + escape(categoryImages[category] || "") + '" ' + (categoryImages[category] ? "" : "hidden") + '><label class="category-photo-input">Photo <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-category-image="' + index + '" aria-label="Photo de la catégorie ' + escape(category) + '" style="width:100%"></label><button class="btn light" type="button" data-category-up="' + index + '" ' + (index === 0 ? "disabled" : "") + '>↑</button><button class="btn light" type="button" data-category-down="' + index + '" ' + (index === categories.length - 1 ? "disabled" : "") + '>↓</button><button class="btn light" type="button" data-category-delete="' + index + '">Supprimer</button></div>').join("");
    element.querySelectorAll("[data-category-name]").forEach(input => input.addEventListener("change", () => {
      const updated = getMerchantCategories();
      const index = Number(input.dataset.categoryName), oldName = updated[index], newName = input.value.trim().slice(0,60) || "Autres";
      updated[index] = newName;
      const images = { ...(currentMerchant?.menu_category_images || {}) };
      if (oldName !== newName && images[oldName]) { images[newName] = images[oldName]; delete images[oldName]; }
      currentMerchant = { ...(currentMerchant || {}), menu_categories: updated, menu_category_images: images }; renderMerchantCategoryEditor(); refreshProductCategoryOptions();
    }));
    element.querySelectorAll("[data-category-image]").forEach(input => input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
        input.value = ""; return status("merchantSaved", "Choisis une photo JPG, PNG, WEBP ou GIF de 5 Mo maximum.", true);
      }
      const category = getMerchantCategories()[Number(input.dataset.categoryImage)];
      if (!category || !currentMerchant?.id) return status("merchantSaved", "Reconnecte-toi avant d’ajouter une photo.", true);
      const extension = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif" })[file.type];
      const imagePath = currentMerchant.id + "/categories/" + (window.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(36).slice(2))) + "." + extension;
      status("merchantSaved", "Envoi de la photo de catégorie…");
      const { data: uploaded, error: uploadError } = await client.storage.from("product-images").upload(imagePath, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
      if (uploadError || !uploaded) return status("merchantSaved", "Photo non envoyée. Vérifie la connexion puis réessaie.", true);
      const images = { ...(currentMerchant.menu_category_images || {}), [category]: client.storage.from("product-images").getPublicUrl(uploaded.path).data.publicUrl };
      currentMerchant = { ...currentMerchant, menu_category_images: images };
      renderMerchantCategoryEditor();
      status("merchantSaved", "Photo ajoutée à la catégorie. Clique sur « Enregistrer la boutique » pour sauvegarder les réglages.");
    }));
    element.querySelectorAll("[data-category-delete]").forEach(button => button.addEventListener("click", () => {
      const updated = getMerchantCategories(); updated.splice(Number(button.dataset.categoryDelete),1);
      currentMerchant = { ...currentMerchant, menu_categories: updated.length ? updated : ["Autres"] }; renderMerchantCategoryEditor(); refreshProductCategoryOptions();
    }));
    element.querySelectorAll("[data-category-up], [data-category-down]").forEach(button => button.addEventListener("click", () => {
      const updated = getMerchantCategories(), i = Number(button.dataset.categoryUp ?? button.dataset.categoryDown), target = button.hasAttribute("data-category-up") ? i-1 : i+1;
      [updated[i], updated[target]] = [updated[target], updated[i]];
      currentMerchant = { ...currentMerchant, menu_categories: updated }; renderMerchantCategoryEditor(); refreshProductCategoryOptions();
    }));
    refreshProductCategoryOptions();
  }
  document.getElementById("merchantActivity")?.addEventListener("change", event => {
    const activity = event.target.value;
    const defaults = defaultMenuCategories[activity] || defaultMenuCategories.other;
    const stored = Array.isArray(currentMerchant?.menu_categories) ? currentMerchant.menu_categories : [];
    const previousDefaults = defaultMenuCategories[currentMerchant?.business_category || "other"] || defaultMenuCategories.other;
    const stillUsingDefaults = !stored.length || JSON.stringify(stored) === JSON.stringify(previousDefaults);
    currentMerchant = { ...(currentMerchant || {}), business_category: activity,
      menu_categories: stillUsingDefaults ? [...defaults] : stored };
    renderMerchantCategoryEditor();
  });
  window.addMenuCategory = () => {
    const input = document.getElementById("newMenuCategory");
    const name = input?.value.trim().slice(0,60);
    if (!name) return status("merchantSaved", "Écris le nom de la catégorie avant de l’ajouter.", true);
    const categories = getMerchantCategories();
    if (categories.some(category => category.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) return status("merchantSaved", "Cette catégorie existe déjà.", true);
    if (categories.length >= 40) return status("merchantSaved", "Maximum 40 catégories par commerce.", true);
    currentMerchant = { ...(currentMerchant || {}), menu_categories: [...categories, name] };
    if (input) input.value = "";
    renderMerchantCategoryEditor();
  };
  function refreshProductCategoryOptions() {
    const select = document.getElementById("productCategory");
    if (!select) return;
    const previous = select.value;
    const categories = getMerchantCategories();
    select.innerHTML = categories.map(category => '<option value="' + escape(category) + '">' + escape(category) + '</option>').join("") || '<option value="Autres">Autres</option>';
    if (categories.includes(previous)) select.value = previous;
  }
  function getPublicMenuCategories(shop, products) {
    const configured = Array.isArray(shop?.menu_categories) ? shop.menu_categories.filter(value => typeof value === "string" && value.trim()) : [];
    const used = [...new Set((products || []).map(product => product.category || "Autres"))];
    return [...new Set([...configured, ...used])];
  }
  window.prepareVehicleRequest = () => {
    const plate = (document.getElementById("vehiclePlate")?.value || "").trim().toUpperCase();
    const type = (document.getElementById("vehicleType")?.value || "").trim();
    const make = (document.getElementById("vehicleMake")?.value || "").trim();
    const model = (document.getElementById("vehicleModel")?.value || "").trim();
    const problem = (document.getElementById("vehicleProblem")?.value || "").trim();
    const message = document.getElementById("vehicleRequestStatus");
    if (message) { message.textContent = "Informations véhicule prêtes : " + [type, make, model, plate ? "plaque " + plate : "", problem].filter(Boolean).join(" · ") + ". La plaque est facultative."; message.classList.remove("hidden"); }
  };

  document.getElementById("productImage")?.addEventListener("change", event => {
    const file = event.target.files?.[0];
    const preview = document.getElementById("productImagePreview");
    if (!preview) return;
    if (!file) { preview.src = ""; preview.classList.add("hidden"); return; }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.target.value = "";
      preview.src = "";
      preview.classList.add("hidden");
      return status("productSaved", "Choisis une image JPG, PNG, WEBP ou GIF de 5 Mo maximum.", true);
    }
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
  });

  window.addMerchantProduct = async () => {
    if (!currentMerchant) return status("productSaved", "Connecte-toi avant d’ajouter des articles.", true);
    const name = document.getElementById("productName").value.trim().slice(0, 120);
    const price = Number(document.getElementById("productPrice").value);
    const stock = Number(document.getElementById("productStock").value);
    const imageField = document.getElementById("productImage");
    const imageFile = imageField?.files?.[0] || null;
    if (!name || !Number.isFinite(price) || price < 0 || price > 1000000 ||
        !Number.isInteger(stock) || stock < 0 || stock > 1000000) {
      return status("productSaved", "Vérifie le nom, le prix et le stock.", true);
    }
    let imageUrl = null;
    if (imageFile) {
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowedTypes.includes(imageFile.type) || imageFile.size > 5 * 1024 * 1024) {
        return status("productSaved", "Choisis une image JPG, PNG, WEBP ou GIF de 5 Mo maximum.", true);
      }
      const extension = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif" })[imageFile.type];
      const uniqueName = (window.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(36).slice(2)));
      const imagePath = currentMerchant.id + "/" + uniqueName + "." + extension;
      status("productSaved", "Envoi de la photo en cours…");
      const { data: uploaded, error: uploadError } = await client.storage.from("product-images").upload(imagePath, imageFile, {
        contentType: imageFile.type, upsert: false, cacheControl: "3600"
      });
      if (uploadError || !uploaded) return status("productSaved", "Photo non envoyée. Vérifie la connexion puis réessaie.", true);
      imageUrl = client.storage.from("product-images").getPublicUrl(uploaded.path).data.publicUrl;
    }
    const item = {
      shop_id: currentMerchant.id,
      name,
      description: document.getElementById("productDescription").value.trim().slice(0, 1000),
      category: document.getElementById("productCategory")?.value || "Autres",
      image_url: imageUrl,
      price_cents: Math.round(price * 100),
      stock,
      active: true
    };
    const { error } = await client.from("products").insert(item);
    if (error) return status("productSaved", "Article non enregistré. Vérifie les règles du catalogue.", true);
    ["productName", "productDescription", "productPrice"].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
    if (document.getElementById("productStock")) document.getElementById("productStock").value = "1";
    if (imageField) imageField.value = "";
    const preview = document.getElementById("productImagePreview");
    if (preview) { preview.src = ""; preview.classList.add("hidden"); }
    status("productSaved", "Article ajouté au catalogue partagé.");
    await window.renderMerchantProducts();
    await window.renderClientCatalog();
  };

  window.deleteMerchantProduct = async (id) => {
    if (!currentMerchant) return;
    const { error } = await client.from("products").delete()
      .eq("id", id).eq("shop_id", currentMerchant.id);
    if (error) return status("merchantAuthStatus", "Suppression impossible.", true);
    await window.renderMerchantProducts();
    await window.renderClientCatalog();
  };

  window.renderMerchantProducts = async () => {
    const element = document.getElementById("merchantProducts");
    if (!element || !currentMerchant) return;
    const { data, error } = await client.from("products").select("id,name,description,category,image_url,price_cents,stock,active")
      .eq("shop_id", currentMerchant.id).order("created_at", { ascending: false });
    if (error) {
      element.innerHTML = '<p class="muted">Impossible de charger le catalogue.</p>';
      return;
    }
    element.innerHTML = data?.length ? data.map(product =>
      '<div class="row product"><div class="productart">' + (product.image_url ? '<img src="' + escape(product.image_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:13px">' : '<span>🛍️</span>') + '</div><div class="productinfo"><strong>' +
      escape(product.name) + '</strong><small>' + escape(product.category || "Autres") + " · " + escape(product.description) + " · Stock : " +
      Number(product.stock) + '</small></div><div class="productprice">' + euroCents(product.price_cents) +
      '</div><button class="btn light" type="button" data-delete-product="' + escape(product.id) +
      '">Supprimer</button></div>'
    ).join("") : '<p class="muted">Aucun article ajouté. Crée ton premier produit.</p>';
    element.querySelectorAll("[data-delete-product]").forEach(button =>
      button.addEventListener("click", () => window.deleteMerchantProduct(button.dataset.deleteProduct))
    );
  };

  window.renderClientCatalog = async () => {
    const element = document.getElementById("clientCatalog");
    if (!element) return;
    if (!currentShop) {
      element.innerHTML = '<p class="muted">Choisis un commerce ou un prestataire pour voir son catalogue.</p>';
      const title = document.getElementById("catalogShopTitle"); if (title) title.textContent = "Les catégories";
      const intro = document.getElementById("catalogShopIntro"); if (intro) intro.textContent = "Choisis une catégorie pour voir les produits ou prestations.";
      document.getElementById("mousseCartBar")?.classList.add("hidden");
      return;
    }
    const generation = ++loadGeneration;
    const { data, error } = await publicClient.from("products").select("id,name,description,category,image_url,price_cents,stock,active").eq("shop_id", currentShop.id).eq("active", true).order("name");
    if (generation !== loadGeneration) return;
    if (error) { element.innerHTML = '<p class="muted">Impossible de charger les articles.</p>'; return; }
    const { data: crowd } = await publicClient.from("shop_affluence").select("status,note,updated_at").eq("shop_id", currentShop.id).maybeSingle();
    const crowdLabels = { calme:"🟢 Affluence calme", modere:"🟡 Affluence modérée", charge:"🔴 Forte affluence", ferme:"⚫ Commerce fermé" };
    const crowdHtml = crowd ? '<div class="notice" aria-live="polite"><strong>' + escape(crowdLabels[crowd.status] || "Affluence non renseignée") + '</strong>' + (crowd.note ? '<p>' + escape(crowd.note) + '</p>' : '') + '<small>Indiqué par le professionnel · mis à jour le ' + escape(new Date(crowd.updated_at).toLocaleString("fr-FR")) + '</small></div>' : '';
    const products = data || [];
    const categories = getPublicMenuCategories(currentShop, products);
    const selectedCategory = window.MOUSSE_SELECTED_MENU_CATEGORY || "";
    const selected = selectedCategory && categories.includes(selectedCategory) ? selectedCategory : "";
    if (selectedCategory && !selected) window.MOUSSE_SELECTED_MENU_CATEGORY = "";
    const shown = selected ? products.filter(product => (product.category || "Autres") === selected) : [];
    const isService = currentShop.business_category === "mechanic" || currentShop.shop_template === "services";
    const title = document.getElementById("catalogShopTitle");
    const intro = document.getElementById("catalogShopIntro");
    if (title) title.textContent = currentShop.name || "Catalogue";
    if (intro) intro.textContent = currentShop.description || (isService ? "Choisis une spécialité pour découvrir les prestations proposées." : "Choisis un rayon pour découvrir les produits proposés.");
    element.dataset.menuStyle = currentShop.menu_style || "tiles";
    element.dataset.categorySize = currentShop.category_tile_size || "medium";
    element.dataset.productSize = currentShop.product_tile_size || "medium";
    element.classList.remove("category-size-small", "category-size-medium", "category-size-large");
    element.classList.add("category-size-" + (["small","medium","large"].includes(currentShop.category_tile_size) ? currentShop.category_tile_size : "medium"));
    const categoryImages = currentShop.menu_category_images && typeof currentShop.menu_category_images === "object" ? currentShop.menu_category_images : {};
    const categoryTiles = '<div class="menu-category-grid">' + categories.map(category =>
      '<button type="button" class="menu-category-tile" data-menu-category="' + escape(category) + '">' + (categoryImages[category] ? '<img src="' + escape(categoryImages[category]) + '" alt="">' : '<span>' + (isService ? "🔧" : "▦") + '</span>') + '<span>' + escape(category) + '</span><small>' +
      products.filter(product => (product.category || "Autres") === category).length + (isService ? " prestation(s)" : " produit(s)") + '</small></button>').join("") + '</div>';
    const backButton = selected ? '<button type="button" class="btn light menu-back" data-menu-back>← Toutes les catégories</button><div class="sectiontitle"><div><div class="eyebrow">Catégorie sélectionnée</div><h2>' + escape(selected) + '</h2><p>Choisis les éléments que tu veux ajouter à ton panier.</p></div><span class="pill">Étape 2</span></div>' : '';
    const itemsHtml = selected ? (shown.length ? '<div class="product-card-grid">' + shown.map(product =>
      '<article class="row product"><div class="productart">' + (product.image_url ? '<img src="' + escape(product.image_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:13px">' : '<span>' + (isService ? "🔧" : "🛍️") + '</span>') +
      '</div><div class="productinfo"><strong>' + escape(product.name) + '</strong><small>' + escape(product.description || (isService ? "Prestation proposée par le professionnel." : "Détail à préciser par le commerçant.")) + '</small><small>' + (Number(product.stock) > 0 ? "Disponible" : "Indisponible") + '</small></div><div class="productprice">' + (Number(product.price_cents) > 0 ? euroCents(product.price_cents) : "Sur devis") + '</div><button class="btn pale" type="button" data-add-product="' + escape(product.id) + '" data-name="' + escape(product.name) + '" data-price="' + Number(product.price_cents) + '" data-stock="' + Number(product.stock) + '"' + (Number(product.stock) < 1 ? " disabled" : "") + '>Ajouter au panier</button></article>'
    ).join("") + '</div>' : '<div class="notice">Aucun produit ou prestation dans cette catégorie pour le moment. Le professionnel pourra en ajouter depuis son espace.</div>') : categoryTiles;
    element.innerHTML = crowdHtml + (selected ? backButton + itemsHtml : '<div class="sectiontitle"><div><div class="eyebrow">Étape 1</div><h2>Choisis une catégorie</h2><p>Chaque catégorie ouvre sa propre page de détail.</p></div></div>' + categoryTiles);
    element.querySelectorAll("[data-menu-category]").forEach(button => button.addEventListener("click", () => { window.MOUSSE_SELECTED_MENU_CATEGORY = button.dataset.menuCategory; window.renderClientCatalog(); }));
    element.querySelector("[data-menu-back]")?.addEventListener("click", () => { window.MOUSSE_SELECTED_MENU_CATEGORY = ""; window.renderClientCatalog(); });
    element.querySelectorAll("[data-add-product]").forEach(button => button.addEventListener("click", () => window.addToCart(button.dataset.addProduct, button.dataset.name, Number(button.dataset.price), Number(button.dataset.stock))));
    const vehicleCard = document.getElementById("vehicleRequestCard");
    if (vehicleCard) vehicleCard.hidden = !isService;
    window.renderCart?.();
  };

  window.addToCart = (id, name, priceCents, stock) => {
    const current = window.demoCart?.find(item => item.id === id);
    if (current && current.qty >= stock) return status("orderMessage", "Le stock disponible a été atteint.", true);
    if (current) current.qty += 1;
    else window.demoCart.push({ id, name, price: Number(priceCents) / 100, qty: 1, stock });
    window.renderCart();
  };

  window.toggleNotificationChannel = () => {
    const channel = document.querySelector('input[name="customerNotification"]:checked')?.value || "email";
    const email = document.getElementById("customerEmail");
    const phone = document.getElementById("customerPhone");
    document.getElementById("customerEmailField")?.classList.toggle("hidden", channel !== "email");
    document.getElementById("customerPhoneField")?.classList.toggle("hidden", channel !== "sms");
    if (email) email.required = channel === "email";
    if (phone) phone.required = channel === "sms";
  };

  window.toggleDelivery = () => {
    const select = document.getElementById("fulfilment");
    const addressFields = document.getElementById("deliveryFields");
    const deliveryOption = select?.querySelector('option[value="delivery"]');
    if (deliveryOption) deliveryOption.disabled = !currentShop?.delivery_enabled;
    if (deliveryOption?.disabled && select.value === "delivery") select.value = "pickup";
    addressFields?.classList.toggle("hidden", select?.value !== "delivery");
    if (select?.value === "delivery") window.loadClientDeliveryAddresses?.();
    window.renderCart();
    const fee = document.getElementById("deliveryFeeHint");
    if (fee) {
      if (currentShop?.order_paused) {
        const returnAt = currentShop.pause_return_at ? " · reprise estimée : " + new Date(currentShop.pause_return_at).toLocaleString("fr-FR") : "";
        fee.textContent = "Commandes temporairement suspendues. " + (currentShop.pause_message || "Le commerce ne prend pas de nouvelles commandes pour le moment.") + returnAt;
        fee.setAttribute("role", "status");
      } else {
        fee.textContent = currentShop?.delivery_enabled
          ? "Frais de livraison : " + euroCents(currentShop.delivery_fee_cents) +
            (currentShop.delivery_min_cents ? " · minimum " + euroCents(currentShop.delivery_min_cents) : "")
          : "Cette boutique propose le retrait en boutique.";
      }
    }
    const orderButton = document.querySelector('#view-collect button[onclick="placeDemoOrder()"]');
    if (orderButton) {
      orderButton.disabled = !!currentShop?.order_paused;
      orderButton.textContent = currentShop?.order_paused ? "Commandes temporairement suspendues" : "Confirmer la commande";
    }
  };

  const renderBaseCart = typeof window.renderCart === "function"
    ? window.renderCart.bind(window)
    : () => status("orderMessage", "Le panier n’a pas pu être initialisé. Recharge la page et réessaie.", true);
  window.renderCart = () => {
    renderBaseCart();
    const cart = window.demoCart || [];
    const count = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const subtotalBar = cart.reduce((sum, item) => sum + Math.round(Number(item.price || 0) * 100) * Number(item.qty || 0), 0);
    const bar = document.getElementById("mousseCartBar");
    const barLabel = document.getElementById("mousseCartBarLabel");
    const barTotal = document.getElementById("mousseCartBarTotal");
    bar?.classList.toggle("hidden", count === 0 || !currentShop);
    if (barLabel) barLabel.textContent = count ? count + (count > 1 ? " éléments dans le panier" : " élément dans le panier") : "Panier vide";
    if (barTotal) barTotal.textContent = euroCents(subtotalBar);
    const total = document.getElementById("cartTotal");
    const fulfillment = document.getElementById("fulfilment")?.value;
    if (!total || !currentShop || !window.demoCart.length) return;
    const subtotal = window.demoCart.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (fulfillment === "delivery") {
      total.textContent = euroCents(Math.round((subtotal + Number(currentShop.delivery_fee_cents || 0) / 100) * 100));
      const minimum = Number(currentShop.delivery_min_cents || 0) / 100;
      if (minimum && subtotal < minimum) status("orderMessage", "Minimum de commande pour la livraison : " + euroCents(currentShop.delivery_min_cents) + ".", true);
    }
  };

  window.openMousseCheckout = () => {
    if (!window.demoCart?.length) return status("orderMessage", "Ajoute au moins un produit ou une prestation avant de continuer.", true);
    document.getElementById("catalogStage")?.classList.add("hidden");
    document.getElementById("checkoutStage")?.classList.remove("hidden");
    window.renderCart?.();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Retour au catalogue sans modifier demoCart : les articles et quantités restent intacts.
  window.backToMousseCatalog = () => {
    document.getElementById("checkoutStage")?.classList.add("hidden");
    document.getElementById("catalogStage")?.classList.remove("hidden");
    window.renderClientCatalog?.();
    window.renderCart?.();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.placeDemoOrder = async () => {
    const name = document.getElementById("customerName").value.trim();
    const email = document.getElementById("customerEmail").value.trim();
    const fulfillment = document.getElementById("fulfilment").value;
    const notificationChannel = document.querySelector('input[name="customerNotification"]:checked')?.value || "email";
    const customerPhone = document.getElementById("customerPhone")?.value.trim() || "";
    if (notificationChannel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return status("orderMessage", "Renseigne une adresse e-mail valide pour recevoir le suivi.", true);
    }
    if (notificationChannel === "sms" && !/^\+[1-9]\d{7,14}$/.test(customerPhone)) {
      return status("orderMessage", "Renseigne un numéro au format international, par exemple +33612345678.", true);
    }
    const subtotalCents = window.demoCart.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0);
    if (fulfillment === "delivery" && subtotalCents < Number(currentShop?.delivery_min_cents || 0)) {
      return status("orderMessage", "Le panier n’atteint pas le minimum requis pour la livraison.", true);
    }
    if (!currentShop) return status("orderMessage", "Choisis une boutique avant de commander.", true);
    if (currentShop.order_paused) return status("orderMessage", currentShop.pause_message || "Cette boutique a temporairement suspendu les commandes.", true);
    if (fulfillment === "delivery") {
      const address = document.getElementById("deliveryAddress").value.trim();
      if (!address) return status("orderMessage", "Renseigne l’adresse de livraison.", true);
      const allowedPostcodes = Array.isArray(currentShop.delivery_postcodes) ? currentShop.delivery_postcodes : [];
      if (allowedPostcodes.length) {
        const enteredPostcodes = address.match(/\b\d{5}\b/g) || [];
        if (!enteredPostcodes.some(code => allowedPostcodes.includes(code))) {
          return status("orderMessage", "Cette adresse semble hors de la zone de livraison de ce commerce. Choisis le retrait en boutique ou contacte le commerçant.", true);
        }
      }
    }
    if (!name || !window.demoCart?.length) return status("orderMessage", "Renseigne ton nom et ajoute au moins un article.", true);
    const body = {
      shop_id: currentShop.id,
      customer_name: name,
      customer_email: notificationChannel === "email" ? email : null,
      customer_phone: notificationChannel === "sms" ? customerPhone : null,
      notification_channel: notificationChannel,
      fulfillment,
      delivery_address: document.getElementById("deliveryAddress").value.trim(),
      delivery_note: document.getElementById("deliveryNote").value.trim(),
      customer_note: [document.getElementById("customerNote").value.trim(),
        (currentShop.business_category === "mechanic" || currentShop.shop_template === "services")
          ? ["Véhicule : " + (document.getElementById("vehicleType")?.value || ""),
             document.getElementById("vehicleMake")?.value.trim() ? "Marque : " + document.getElementById("vehicleMake").value.trim() : "",
             document.getElementById("vehicleModel")?.value.trim() ? "Modèle : " + document.getElementById("vehicleModel").value.trim() : "",
             document.getElementById("vehiclePlate")?.value.trim() ? "Immatriculation : " + document.getElementById("vehiclePlate").value.trim().toUpperCase() : "",
             document.getElementById("vehicleProblem")?.value.trim() || ""].filter(Boolean).join(" · ") : ""
      ].filter(Boolean).join("\n"),
      payment_method: document.getElementById("paymentMethod")?.value || "on_site",
      website: document.getElementById("orderWebsite")?.value || "",
      items: window.demoCart.map(item => ({ product_id: item.id, quantity: item.qty }))
    };
    const button = document.querySelector('#view-collect button[onclick="placeDemoOrder()"]');
    if (button) button.disabled = true;
    try {
      const { data, error } = await publicClient.functions.invoke("create-order", { body });
      if (error) throw error;
      if (data?.order_created) {
        const merchantSent = !!data.merchant_notification_sent;
        const customerSent = !!data.customer_notification_sent;
        const notificationIssue = !merchantSent || !customerSent;
        const message = "Commande " + data.order_id + " enregistrée. Alerte boutique : " +
          (merchantSent ? "e-mail envoyé" : "non confirmée") + " · alerte client : " +
          (customerSent ? "envoyée" : "non confirmée") +
          (notificationIssue ? ". Ne valide pas la commande une deuxième fois ; contacte le commerce." : ".");
        status("orderMessage", message, notificationIssue);
        window.demoCart.length = 0;
        window.renderCart();
        document.getElementById("checkoutStage")?.classList.add("hidden");
        document.getElementById("catalogStage")?.classList.remove("hidden");
        window.MOUSSE_SELECTED_MENU_CATEGORY = "";
      } else {
        status("orderMessage", "La commande n’a pas pu être confirmée. Réessaie après vérification du service.", true);
      }
    } catch (error) {
      status("orderMessage", "Le service de commande est indisponible. Vérifie les paramètres du magasin et réessaie.", true);
    } finally {
      if (button) button.disabled = false;
    }
  };

  window.__MOUSSE_LIVE__ = {
    client,
    get merchant() { return currentMerchant; },
    get shop() { return currentShop; },
    refreshShops: loadPublicShops
  };

  document.getElementById("liveShopSelect")?.addEventListener("change", async (event) => {
    currentShop = null;
    window.MOUSSE_SELECTED_MENU_CATEGORY = "";
    window.demoCart.length = 0;
    window.renderCart();
    const { data } = await publicClient.from("shops").select(
      "id,name,address,description,theme_color,delivery_enabled,delivery_fee_cents,delivery_min_cents,shop_template,business_category,menu_style,menu_categories,menu_category_images,category_tile_size,product_tile_size,order_paused,pause_message,pause_return_at,delivery_postcodes,delivery_radius_km"
    ).eq("id", event.target.value).eq("is_published", true).maybeSingle();
    currentShop = data || null;
    await window.renderClientCatalog();
    window.toggleDelivery();
  });
  const statusLabels = {
    received: "Reçue", accepted: "Acceptée", preparing: "En préparation",
    ready: "Prête au retrait", shipped: "Expédiée", in_delivery: "En livraison",
    delivered: "Livrée", collected: "Retirée", cancelled: "Annulée"
  };
  const nextStatuses = (order) => ({
    received: ["preparing", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: order.fulfillment === "pickup" ? ["ready", "cancelled"] : ["shipped", "in_delivery", "cancelled"],
    ready: ["collected", "cancelled"],
    shipped: ["delivered"],
    in_delivery: ["delivered"],
    delivered: [],
    collected: [],
    cancelled: []
  }[order.status] || []);

  window.renderOrders = async () => {
    const element = document.getElementById("ordersList");
    if (!element || !currentMerchant) return;
    const { data, error } = await client.from("orders")
      .select("id,status,fulfillment,customer_name,customer_email,customer_phone,notification_channel,customer_notification_status,delivery_address,total_cents,tracking_number,created_at,order_items(product_name,quantity,unit_price_cents)")
      .eq("shop_id", currentMerchant.id).order("created_at", { ascending: false }).limit(50);
    if (error) {
      element.innerHTML = '<article class="card"><p>Impossible de charger les commandes.</p></article>';
      return;
    }
    element.innerHTML = data?.length ? data.map(order => {
      const items = (order.order_items || []).map(item =>
        escape(item.product_name) + " × " + Number(item.quantity)
      ).join(", ");
      const next = nextStatuses(order);
      if (["failed", "pending"].includes(order.customer_notification_status) && !next.includes(order.status)) {
        next.unshift(order.status);
      }
      const contact = order.notification_channel === "sms" ? order.customer_phone : order.customer_email;
      const options = [...new Set([order.status, ...next])].map(value =>
        '<option value="' + escape(value) + '"' + (value === order.status ? " selected" : "") + '>' +
        escape(statusLabels[value] || value) + (value === order.status && order.customer_notification_status === "failed" ? " · renvoyer l’alerte" : "") + "</option>"
      ).join("");
      return '<article class="card order-card" data-order-id="' + escape(order.id) + '">' +
        '<div class="cardhead"><h3>Commande ' + escape(order.id.slice(0, 8)) + '</h3><span class="pill">' +
        escape(statusLabels[order.status] || order.status) + '</span></div><p><strong>' +
        escape(order.customer_name) + '</strong> · ' + escape(contact || "Contact manquant") + '</p>' +
        '<p>' + (order.fulfillment === "pickup" ? "Click & Collect" : "Livraison") +
        (order.delivery_address ? " · " + escape(order.delivery_address) : "") + '</p><p>' + items +
        '</p><p><strong>' + euroCents(order.total_cents) + '</strong> · Alerte client : ' +
        escape(order.customer_notification_status === "sent" ? "envoyée" : order.customer_notification_status === "failed" ? "échec" : "en attente") +
        '</p><div class="field"><label>Statut et notification</label><select data-order-status>' + options +
        '</select></div>' + (order.fulfillment === "delivery" ?
          '<div class="field"><label>Numéro de suivi (si expédition postale)</label><input data-tracking value="' +
          escape(order.tracking_number || "") + '" maxlength="120" placeholder="Numéro ou lien de suivi"></div>' : "") +
        '<button class="btn" type="button" data-update-order>Mettre à jour et prévenir le client</button></article>';
    }).join("") : '<article class="card"><p>Aucune commande reçue pour le moment.</p></article>';
  };

  document.getElementById("ordersList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-update-order]");
    if (!button) return;
    const card = button.closest("[data-order-id]");
    const statusValue = card?.querySelector("[data-order-status]")?.value;
    if (!card || !statusValue) return;
    button.disabled = true;
    const { data, error } = await client.functions.invoke("notify-order-status", {
      body: {
        order_id: card.dataset.orderId,
        status: statusValue,
        tracking_number: card.querySelector("[data-tracking]")?.value.trim() || null
      }
    });
    button.disabled = false;
    if (error || !data?.updated) {
      status("merchantAuthStatus", "Statut non modifié. Vérifie le compte, le suivi et la configuration du service.", true);
      return;
    }
    await window.renderOrders();
    status("merchantAuthStatus", data.notification_sent
      ? "Statut enregistré et alerte envoyée au client."
      : "Statut enregistré, mais l’alerte a échoué. Vérifie la configuration puis réessaie le même statut.", !data.notification_sent);
  });

  document.querySelectorAll('input[name="customerNotification"]').forEach(input =>
    input.addEventListener("change", window.toggleNotificationChannel)
  );
  window.toggleNotificationChannel();

  document.getElementById("merchantSetupForm")?.addEventListener("submit", submitMerchantApplication);
  document.getElementById("merchantLoginButton")?.addEventListener("click", window.loginMerchant);
  document.getElementById("merchantRegisterButton")?.addEventListener("click", window.registerMerchant);
  document.getElementById("merchantForgotPassword")?.addEventListener("click", window.requestMerchantPasswordReset);
  document.getElementById("merchantSaveNewPassword")?.addEventListener("click", window.saveMerchantNewPassword);
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") { window.MOUSSE_CLIENT_AUTHENTICATED = false; window.MOUSSE_IS_MERCHANT_AUTHENTICATED = false; }
    if (event === "PASSWORD_RECOVERY") {
      // Keep the password-reset form aligned with the account type that requested the email.
      window.MOUSSE_CLIENT_AUTHENTICATED = false;
      window.MOUSSE_IS_MERCHANT_AUTHENTICATED = false;
      const recoveryType = new URLSearchParams(window.location.search).get("recovery");
      if (recoveryType === "merchant") {
        document.getElementById("merchantRecoveryPanel")?.classList.remove("hidden");
        status("merchantRecoveryStatus", "Lien de réinitialisation validé. Choisis ton nouveau mot de passe.");
        document.getElementById("merchantRecoveryPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.enterMousse?.("client");
        window.openClientLogin?.();
        document.getElementById("clientRecoveryPanel")?.classList.remove("hidden");
        status("clientAuthStatus", "Lien de réinitialisation validé. Choisis ton nouveau mot de passe.");
        document.getElementById("clientRecoveryPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  });
  document.getElementById("merchantSignOut")?.addEventListener("click", window.logoutMerchant);
  window.addEventListener("DOMContentLoaded", async () => {
    await refreshSession();
    await loadPublicShops();
  });
})();
