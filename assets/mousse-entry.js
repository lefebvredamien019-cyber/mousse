/* MOUSSE entry chooser: connects the two start-screen buttons to the existing views. */
(function () {
  "use strict";

  window.enterMousse = function (role) {
    if (role !== "merchant" && role !== "client") return;

    const gate = document.getElementById("roleGate");
    if (gate) gate.hidden = true;
    document.documentElement.classList.remove("role-unselected");

    if (typeof window.showView === "function") {
      // Merchants land directly on account login; customers land on discovery.
      window.showView(role === "merchant" ? "commerce" : "accueil");
    } else {
      const target = document.getElementById(
        role === "merchant" ? "view-commerce" : "view-accueil"
      );
      if (target) target.classList.add("active");
    }

    if (role === "merchant") {
      const email = document.getElementById("merchantLoginEmail");
      if (email) email.focus({ preventScroll: true });
    }
  };
})();