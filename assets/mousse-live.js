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
  window.demoCart = demoCart;
  const client = window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey);
  let currentUser = null;
  let currentMerchant = null;
  let currentShop = null;
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
    const published = document.getElementById("merchantPublished");
    if (published) published.checked = !!shop.is_published;
    window.renderMerchantPreview();
  };

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
    if (currentUser) await loadMerchant();
  }

  async function loadPublicShops(preferredId = null) {
    const picker = document.getElementById("liveShopSelect");
    const catalog = document.getElementById("clientCatalog");
    if (!picker || !catalog) return;
    const { data, error } = await client.from("shops")
      .select("id,name,address,description,theme_color,delivery_enabled,delivery_fee_cents,delivery_min_cents")
      .eq("is_published", true).order("name");
    if (error) {
      picker.innerHTML = '<option value="">Boutiques momentanément indisponibles</option>';
      catalog.innerHTML = '<p class="muted">Impossible de charger les boutiques pour le moment.</p>';
      return;
    }
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

  window.loginMerchant = async () => {
    const email = document.getElementById("merchantLoginEmail").value.trim();
    const password = document.getElementById("merchantLoginPassword").value;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return status("merchantAuthStatus", "Connexion impossible. Vérifie l’adresse et le mot de passe.", true);
    currentUser = data.user;
    await refreshSession();
  };

  window.registerMerchant = async () => {
    const name = document.getElementById("signupShopName").value.trim();
    const email = document.getElementById("merchantLoginEmail").value.trim();
    const password = document.getElementById("merchantLoginPassword").value;
    if (name.length < 2) return status("merchantAuthStatus", "Renseigne d’abord le nom de ton commerce.", true);
    if (!email || password.length < 10) return status("merchantAuthStatus", "Utilise une adresse e-mail valide et un mot de passe d’au moins 10 caractères.", true);
    const { data, error } = await client.auth.signUp({
      email, password, options: { data: { shop_name: name } }
    });
    if (error) return status("merchantAuthStatus", "Création du compte impossible. Vérifie les réglages d’inscription Supabase.", true);
    currentUser = data.session?.user || null;
    if (!currentUser) {
      return status("merchantAuthStatus", "Compte créé. Confirme l’adresse reçue par e-mail, puis connecte-toi ici.");
    }
    await refreshSession();
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
      is_published: document.getElementById("merchantPublished").checked,
      updated_at: new Date().toISOString()
    };
    if (values.name.length < 2 || !values.email) return status("merchantSaved", "Le nom et l’adresse e-mail du commerce sont obligatoires.", true);
    const { data, error } = await client.from("shops").update(values)
      .eq("id", currentMerchant.id).select("*").single();
    if (error) return status("merchantSaved", "Enregistrement impossible. Vérifie les règles de sécurité du commerce.", true);
    currentMerchant = data;
    window.renderMerchantPreview();
    status("merchantSaved", values.is_published
      ? "Commerce enregistré et publié dans le catalogue client."
      : "Commerce enregistré en mode privé.");
    await loadPublicShops(data.is_published ? data.id : null);
  };

  window.addMerchantProduct = async () => {
    if (!currentMerchant) return status("productSaved", "Connecte-toi avant d’ajouter des articles.", true);
    const name = document.getElementById("productName").value.trim().slice(0, 120);
    const price = Number(document.getElementById("productPrice").value);
    const stock = Number(document.getElementById("productStock").value);
    if (!name || !Number.isFinite(price) || price < 0 || price > 1000000 ||
        !Number.isInteger(stock) || stock < 0 || stock > 1000000) {
      return status("productSaved", "Vérifie le nom, le prix et le stock.", true);
    }
    const item = {
      shop_id: currentMerchant.id,
      name,
      description: document.getElementById("productDescription").value.trim().slice(0, 1000),
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
    const { data, error } = await client.from("products").select("id,name,description,price_cents,stock,active")
      .eq("shop_id", currentMerchant.id).order("created_at", { ascending: false });
    if (error) {
      element.innerHTML = '<p class="muted">Impossible de charger le catalogue.</p>';
      return;
    }
    element.innerHTML = data?.length ? data.map(product =>
      '<div class="row product"><div class="productart">🛍️</div><div class="productinfo"><strong>' +
      escape(product.name) + '</strong><small>' + escape(product.description) + " · Stock : " +
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
      element.innerHTML = '<p class="muted">Choisis une boutique pour voir son catalogue.</p>';
      return;
    }
    const generation = ++loadGeneration;
    const { data, error } = await client.from("products")
      .select("id,name,description,price_cents,stock,active")
      .eq("shop_id", currentShop.id).eq("active", true).order("name");
    if (generation !== loadGeneration) return;
    if (error) {
      element.innerHTML = '<p class="muted">Impossible de charger les articles.</p>';
      return;
    }
    element.innerHTML = data?.length ? data.map(product =>
      '<div class="row product"><div class="productart">🛍️</div><div class="productinfo"><strong>' +
      escape(product.name) + '</strong><small>' + escape(product.description) + " · " +
      (Number(product.stock) > 0 ? "En stock" : "Indisponible") + '</small></div><div class="productprice">' +
      euroCents(product.price_cents) + '</div><button class="btn pale" type="button" data-add-product="' +
      escape(product.id) + '" data-name="' + escape(product.name) + '" data-price="' +
      Number(product.price_cents) + '" data-stock="' + Number(product.stock) + '"' +
      (Number(product.stock) < 1 ? " disabled" : "") + '>Ajouter</button></div>'
    ).join("") : '<p class="muted">Cette boutique n’a pas encore d’article disponible.</p>';
    element.querySelectorAll("[data-add-product]").forEach(button =>
      button.addEventListener("click", () => window.addToCart(
        button.dataset.addProduct, button.dataset.name,
        Number(button.dataset.price), Number(button.dataset.stock)
      ))
    );
  };

  window.addToCart = (id, name, priceCents, stock) => {
    const current = window.demoCart?.find(item => item.id === id);
    if (current && current.qty >= stock) return status("orderMessage", "Le stock disponible a été atteint.", true);
    if (current) current.qty += 1;
    else window.demoCart.push({ id, name, price: Number(priceCents) / 100, qty: 1, stock });
    window.renderCart();
  };

  window.toggleDelivery = () => {
    const select = document.getElementById("fulfilment");
    const addressFields = document.getElementById("deliveryFields");
    const deliveryOption = select?.querySelector('option[value="delivery"]');
    if (deliveryOption) deliveryOption.disabled = !currentShop?.delivery_enabled;
    if (deliveryOption?.disabled && select.value === "delivery") select.value = "pickup";
    addressFields?.classList.toggle("hidden", select?.value !== "delivery");
    const fee = document.getElementById("deliveryFeeHint");
    if (fee) fee.textContent = currentShop?.delivery_enabled
      ? "Frais de livraison : " + euroCents(currentShop.delivery_fee_cents) +
        (currentShop.delivery_min_cents ? " · minimum " + euroCents(currentShop.delivery_min_cents) : "")
      : "Cette boutique propose le retrait en boutique.";
  };

  const renderBaseCart = window.renderCart.bind(window);
  window.renderCart = () => {
    renderBaseCart();
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

  window.placeDemoOrder = async () => {
    const name = document.getElementById("customerName").value.trim();
    const email = document.getElementById("customerEmail").value.trim();
    const fulfillment = document.getElementById("fulfilment").value;
    const subtotalCents = window.demoCart.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0);
    if (fulfillment === "delivery" && subtotalCents < Number(currentShop?.delivery_min_cents || 0)) {
      return status("orderMessage", "Le panier n’atteint pas le minimum requis pour la livraison.", true);
    }
    if (!currentShop) return status("orderMessage", "Choisis une boutique avant de commander.", true);
    if (!name || !window.demoCart?.length) return status("orderMessage", "Renseigne ton nom et ajoute au moins un article.", true);
    const body = {
      shop_id: currentShop.id,
      customer_name: name,
      customer_email: email || null,
      fulfillment,
      delivery_address: document.getElementById("deliveryAddress").value.trim(),
      delivery_note: document.getElementById("deliveryNote").value.trim(),
      customer_note: document.getElementById("customerNote").value.trim(),
      website: document.getElementById("orderWebsite")?.value || "",
      items: window.demoCart.map(item => ({ product_id: item.id, quantity: item.qty }))
    };
    const button = document.querySelector('#view-collect button[onclick="placeDemoOrder()"]');
    if (button) button.disabled = true;
    try {
      const { data, error } = await client.functions.invoke("create-order", { body });
      if (error) throw error;
      if (data?.email_sent) {
        status("orderMessage", "Commande " + data.order_id + " enregistrée. Un e-mail vient d’être envoyé à " + currentShop.name + ".");
        window.demoCart.length = 0;
        window.renderCart();
      } else if (data?.order_created) {
        status("orderMessage", "Commande enregistrée, mais l’envoi de l’e-mail n’a pas été confirmé. Ne valide pas une deuxième fois ; contacte le support pour vérifier la commande.", true);
        window.demoCart.length = 0;
        window.renderCart();
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
    window.demoCart.length = 0;
    window.renderCart();
    const { data } = await client.from("shops").select(
      "id,name,address,description,theme_color,delivery_enabled,delivery_fee_cents,delivery_min_cents"
    ).eq("id", event.target.value).eq("is_published", true).maybeSingle();
    currentShop = data || null;
    await window.renderClientCatalog();
    window.toggleDelivery();
  });
  document.getElementById("merchantLoginButton")?.addEventListener("click", window.loginMerchant);
  document.getElementById("merchantRegisterButton")?.addEventListener("click", window.registerMerchant);
  document.getElementById("merchantSignOut")?.addEventListener("click", window.logoutMerchant);
  window.addEventListener("DOMContentLoaded", async () => {
    await refreshSession();
    await loadPublicShops();
  });
})();
