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
      conceal("merchantSetup");
      reveal("merchantStart");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    conceal("merchantStart");
    conceal("merchantSetup");
    if (typeof window.showView === "function") window.showView("accueil");
    else reveal("view-accueil");
  };

  window.backToRoleGate = showGate;

  window.continueMerchant = function () {
    conceal("merchantStart");
    conceal("merchantSetup");
    if (typeof window.showView === "function") window.showView("commerce");
    else reveal("view-commerce");
    const email = byId("merchantLoginEmail");
    if (email) email.focus({ preventScroll: true });
  };

  window.openMerchantSetup = function () {
    conceal("merchantStart");
    reveal("merchantSetup");
    updateSetupProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.backToMerchantStart = function () {
    conceal("merchantSetup");
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