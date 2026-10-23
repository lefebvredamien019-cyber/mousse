/* MOUSSE entry chooser and merchant onboarding navigation. */
(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const reveal = (id) => {
    const node = byId(id);
    if (node) node.hidden = false;
    return node;
  };
  const conceal = (id) => {
    const node = byId(id);
    if (node) node.hidden = true;
  };

  function showGate() {
    document.documentElement.classList.add("role-unselected");
    reveal("roleGate");
    conceal("clientStart");
    conceal("merchantStart");
    conceal("merchantSetup");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.enterMousse = function (role) {
    if (role !== "merchant" && role !== "client") return;
    conceal("roleGate");
    document.documentElement.classList.remove("role-unselected");

    if (role === "merchant") {
      conceal("clientStart");
      document.documentElement.classList.remove("role-unselected");
      conceal("merchantStart");
      const firstTime = byId("firstMerchantVisit");
      if (firstTime && firstTime.checked) {
        window.openMerchantSetup();
      } else {
        window.continueMerchant();
      }
      return;
    }

    conceal("merchantStart");
    conceal("merchantSetup");
    reveal("clientStart");
    document.documentElement.classList.add("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "none";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.continueClientBrowsing = function () {
    conceal("clientStart");
    document.documentElement.classList.remove("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "";
    if (typeof window.showView === "function") window.showView("accueil");
    else reveal("view-accueil");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.openClientAccount = function () {
    conceal("clientStart");
    document.documentElement.classList.remove("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "";
    if (typeof window.showView === "function") window.showView("client");
    else reveal("view-client");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.backToRoleGate = showGate;

  window.continueMerchant = function () {
    conceal("clientStart");
    conceal("merchantStart");
    conceal("merchantSetup");
    document.documentElement.classList.remove("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "";
    if (typeof window.showView === "function") window.showView("commerce");
    else reveal("view-commerce");
    const email = byId("merchantLoginEmail");
    if (email) email.focus({ preventScroll: true });
  };

  window.openMerchantSetup = function () {
    conceal("clientStart");
    conceal("merchantStart");
    document.documentElement.classList.add("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "none";
    reveal("merchantSetup");
    updateSetupProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.backToMerchantStart = function () {
    conceal("merchantSetup");
    document.documentElement.classList.add("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "none";
    reveal("merchantStart");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  function updateSetupProgress() {
    const form = byId("merchantSetupForm");
    if (!form) return;
    const required = Array.from(form.querySelectorAll("[required]"));
    const completed = required.filter((field) => {
      if (field.type === "checkbox") return field.checked;
      return String(field.value || "").trim().length > 0 && field.checkValidity();
    }).length;
    const percent = required.length ? Math.round((completed / required.length) * 100) : 0;
    const bar = byId("setupProgressBar");
    const label = byId("setupProgressText");
    if (bar) bar.style.width = percent + "%";
    if (label) label.textContent = percent + " % complété · les champs marqués * sont requis";
  }

  document.addEventListener("DOMContentLoaded", function () {
    const form = byId("merchantSetupForm");
    if (!form) return;
    form.addEventListener("input", updateSetupProgress);
    form.addEventListener("change", updateSetupProgress);
    updateSetupProgress();
  });
})();