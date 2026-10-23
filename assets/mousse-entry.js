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
    conceal("merchantLoginGate");
    conceal("clientAuthPanel");
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
        window.openMerchantLogin();
      }
      return;
    }

    conceal("merchantStart");
    conceal("merchantSetup");
    conceal("merchantLoginGate");
    conceal("clientAuthPanel");
    reveal("clientStart");
    document.documentElement.classList.add("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "none";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.continueClientBrowsing = function () {
    conceal("clientStart");
    conceal("clientAuthPanel");
    document.documentElement.classList.remove("role-unselected");
    const shell = document.querySelector(".shell");
    if (shell) shell.style.display = "";
    if (typeof window.showView === "function") window.showView("accueil");
    else reveal("view-accueil");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.openClientLogin = function () {
    conceal("merchantLoginGate"); conceal("merchantStart"); conceal("merchantSetup");
    reveal("clientStart"); reveal("clientAuthPanel");
    document.documentElement.classList.add("role-unselected");
    const shell = document.querySelector(".shell"); if (shell) shell.style.display = "none";
    const email = byId("clientAuthEmail"); if (email) email.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  window.closeClientLogin = function () {
    conceal("clientAuthPanel");
    const email = byId("clientAuthEmail"); if (email) email.value = "";
    const password = byId("clientAuthPassword"); if (password) password.value = "";
  };
  window.openClientAccount = function () {
    if (!window.MOUSSE_CLIENT_AUTHENTICATED) return window.openClientLogin();
    conceal("clientStart"); conceal("clientAuthPanel");
    document.documentElement.classList.remove("role-unselected");
    const shell = document.querySelector(".shell"); if (shell) shell.style.display = "";
    if (typeof window.showView === "function") window.showView("client"); else reveal("view-client");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.backToRoleGate = showGate;

  window.continueMerchant = function () { window.openMerchantLogin(); };
  window.openMerchantLogin = function () {
    conceal("clientStart"); conceal("clientAuthPanel"); conceal("merchantStart"); conceal("merchantSetup");
    reveal("merchantLoginGate"); document.documentElement.classList.add("role-unselected");
    const shell = document.querySelector(".shell"); if (shell) shell.style.display = "none";
    const email = byId("merchantGateEmail"); if (email) email.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  window.submitMerchantGateLogin = async function () {
    const email=byId("merchantGateEmail")?.value.trim()||"", password=byId("merchantGatePassword")?.value||"";
    if(!email||!password){const el=byId("merchantGateStatus");if(el){el.textContent="Renseigne ton adresse e-mail et ton mot de passe.";el.classList.remove("hidden");}return;}
    const oldEmail=byId("merchantLoginEmail"),oldPassword=byId("merchantLoginPassword");if(oldEmail)oldEmail.value=email;if(oldPassword)oldPassword.value=password;
    if(typeof window.loginMerchant==="function")await window.loginMerchant();else{const el=byId("merchantGateStatus");if(el){el.textContent="Le service de connexion n’est pas disponible. Recharge la page puis réessaie.";el.classList.remove("hidden");}}
  };
  window.requestMerchantGateReset = async function () {
    const email=byId("merchantGateEmail")?.value.trim()||"",oldEmail=byId("merchantLoginEmail");if(oldEmail)oldEmail.value=email;
    if(typeof window.requestMerchantPasswordReset==="function")await window.requestMerchantPasswordReset();
    const oldStatus=byId("merchantRecoveryStatus"),gateStatus=byId("merchantGateStatus");if(oldStatus&&gateStatus){gateStatus.textContent=oldStatus.textContent||"Si cette adresse correspond à un compte, un e-mail de réinitialisation va être envoyé.";gateStatus.classList.remove("hidden");}
  };
  window.enterMerchantWorkspace = function () {
    conceal("roleGate");conceal("clientStart");conceal("clientAuthPanel");conceal("merchantStart");conceal("merchantLoginGate");conceal("merchantSetup");
    document.documentElement.classList.remove("role-unselected");const shell=document.querySelector(".shell");if(shell)shell.style.display="";
    if(typeof window.showView==="function")window.showView("merchantDashboard");window.scrollTo({top:0,behavior:"smooth"});
  };

  window.openMerchantSetup = function () {
    conceal("merchantLoginGate");
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
    conceal("merchantLoginGate");
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