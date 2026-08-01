(function () {
  "use strict";

  const config = window.GIFT_CONFIG;
  const screens = [...document.querySelectorAll("[data-screen]")];
  const status = document.querySelector("#status");
  const progress = document.querySelector("#progress-bar");
  const dateOptions = document.querySelector("#date-options");
  const chooseButton = document.querySelector("#choose-button");
  const confirmButton = document.querySelector("#confirm-button");
  const cacheKey = `birthday-gift:${config.publicToken}`;
  const previewMode = location.protocol === "file:" || new URLSearchParams(location.search).get("preview") === "1" || config.publicToken.startsWith("VUL-");
  const progressByScreen = { loading: 5, welcome: 12, reveal: 28, condition: 44, selecting: 64, confirming: 80, submitting: 90, confirmed: 100, "no-dates": 64, error: 5 };
  let gift = null;
  let selectedDateId = null;
  let submitting = false;

  const nlDate = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });

  function formatDate(iso) {
    const text = nlDate.format(new Date(`${iso}T12:00:00Z`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function showScreen(name, focus = true) {
    screens.forEach((screen) => {
      const active = screen.dataset.screen === name;
      screen.hidden = !active;
      screen.classList.toggle("screen--active", active);
    });
    progress.style.width = `${progressByScreen[name] || 0}%`;
    status.textContent = "";
    if (focus) requestAnimationFrame(() => document.querySelector(`[data-screen="${name}"] h1`)?.focus());
  }

  function api(path, options = {}) {
    if (previewMode) return previewApi(path, options);
    const url = `${config.apiBaseUrl.replace(/\/$/, "")}${path}`;
    return fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.message || "De verbinding met het cadeau lukte niet.");
        error.code = body.code;
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    });
  }

  function previewApi(path, options = {}) {
    const cached = readCache();
    if (options.method === "POST" && path.endsWith("/confirm")) {
      const body = JSON.parse(options.body || "{}");
      const date = config.previewDates.find((item) => item.id === body.dateId);
      if (!date) return Promise.reject(new Error("Deze voorbeeld­datum is niet beschikbaar."));
      const result = { status: "confirmed", recipientName: config.recipientName, confirmedAt: new Date().toISOString(), notificationStatus: "preview", confirmedDate: date };
      cache(result);
      return Promise.resolve(result);
    }
    if (cached?.status === "confirmed" && cached.confirmedDate) return Promise.resolve(cached);
    return Promise.resolve({ status: "open", recipientName: config.recipientName, dates: config.previewDates });
  }

  function cache(value) {
    try { localStorage.setItem(cacheKey, JSON.stringify(value)); } catch (_) { /* Opslag is een gemak, geen vereiste. */ }
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch (_) { return null; }
  }

  function resetPreviewState() {
    if (!previewMode) return;
    try { localStorage.removeItem(cacheKey); } catch (_) { /* Preview werkt ook zonder beschikbare opslag. */ }
  }

  async function loadGift() {
    showScreen("loading", false);
    try {
      gift = await api(`/api/gifts/${encodeURIComponent(config.publicToken)}`);
      document.querySelectorAll("[data-recipient]").forEach((node) => { node.textContent = gift.recipientName || config.recipientName; });
      if (gift.status === "confirmed") {
        showConfirmed(gift, false);
        return;
      }
      if (!gift.dates?.length) {
        showScreen("no-dates");
        return;
      }
      const cached = readCache();
      selectedDateId = gift.dates.some((date) => date.id === cached?.selectedDateId) ? cached.selectedDateId : null;
      renderDates();
      showScreen("welcome");
    } catch (error) {
      document.querySelector("#error-message").textContent = error.message;
      showScreen("error");
    }
  }

  function renderDates() {
    dateOptions.replaceChildren(...gift.dates.map((date) => {
      const label = document.createElement("label");
      label.className = "date-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "gift-date";
      input.value = date.id;
      input.checked = date.id === selectedDateId;
      input.addEventListener("change", () => {
        selectedDateId = date.id;
        chooseButton.disabled = false;
        cache({ selectedDateId });
      });
      const copy = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = date.labelOverride || formatDate(date.dateIso);
      const sub = document.createElement("span");
      sub.textContent = "Beschikbaar voor ons alle vier";
      copy.append(strong, sub);
      label.append(input, copy);
      return label;
    }));
    chooseButton.disabled = !selectedDateId;
  }

  function selectedDate() { return gift?.dates.find((date) => date.id === selectedDateId); }

  function openConfirmation() {
    const date = selectedDate();
    if (!date) {
      status.textContent = "Kies eerst één van de beschikbare avonden.";
      return;
    }
    document.querySelector("#confirm-date").textContent = date.labelOverride || formatDate(date.dateIso);
    showScreen("confirming");
  }

  async function confirmChoice() {
    if (submitting || !selectedDate()) return;
    submitting = true;
    confirmButton.disabled = true;
    showScreen("submitting");
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    try {
      const result = await api(`/api/gifts/${encodeURIComponent(config.publicToken)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ dateId: selectedDateId, idempotencyKey }),
      });
      gift = result;
      cache({ status: "confirmed", confirmedDate: result.confirmedDate });
      showConfirmed(result, true);
    } catch (error) {
      try {
        const current = await api(`/api/gifts/${encodeURIComponent(config.publicToken)}`);
        if (current.status === "confirmed") {
          gift = current;
          showConfirmed(current, true);
          return;
        }
      } catch (_) { /* Toon hieronder de oorspronkelijke fout. */ }
      document.querySelector("#error-message").textContent = "We weten nog niet zeker of je keuze is opgeslagen. Controleer je verbinding en probeer opnieuw; we overschrijven nooit een bestaande keuze.";
      showScreen("error");
    } finally {
      submitting = false;
      confirmButton.disabled = false;
    }
  }

  function showConfirmed(result, celebrate) {
    const date = result.confirmedDate;
    document.querySelector("#final-date").textContent = date.labelOverride || formatDate(date.dateIso);
    const failed = result.notificationStatus === "failed";
    document.querySelector("#notification-warning").hidden = !failed;
    configureWhatsapp(date, failed);
    showScreen("confirmed");
    if (celebrate && !matchMedia("(prefers-reduced-motion: reduce)").matches) launchConfetti();
  }

  function configureWhatsapp(date, forceShow) {
    const link = document.querySelector("#whatsapp-link");
    const text = `Het staat vast: ${formatDate(date.dateIso)} gaan we met z'n vieren uit eten!`;
    const number = String(config.whatsappNumber || "").replace(/\D/g, "");
    link.href = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
    link.hidden = !forceShow && !number;
  }

  function addToCalendar() {
    if (!gift?.confirmedDate) return;
    const date = gift.confirmedDate.dateIso.replaceAll("-", "");
    const [hours, minutes] = config.dinnerTime.split(":");
    const start = `${date}T${hours}${minutes}00`;
    const endHour = String((Number(hours) + config.dinnerDurationHours) % 24).padStart(2, "0");
    const end = `${date}T${endHour}${minutes}00`;
    const escapeIcs = (value) => String(value).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Verjaardagscadeau//NL", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${config.publicToken}@verjaardagscadeau`, `DTSTART;TZID=Europe/Amsterdam:${start}`, `DTEND;TZID=Europe/Amsterdam:${end}`, "SUMMARY:Etentje met z'n vieren", `LOCATION:${escapeIcs(config.dinnerLocation)}`, "DESCRIPTION:Het verjaardagscadeau is officieel geactiveerd!", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "etentje-met-zijn-vieren.ics";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function launchConfetti() {
    const canvas = document.querySelector("#confetti");
    const context = canvas.getContext("2d");
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * ratio; canvas.height = innerHeight * ratio; context.scale(ratio, ratio);
    const colors = ["#d4a24c", "#f4e3be", "#8faca3", "#ffffff"];
    const pieces = Array.from({ length: 80 }, () => ({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * .4, vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 3, r: 3 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)], turn: Math.random() * Math.PI }));
    const started = performance.now();
    function frame(now) {
      context.clearRect(0, 0, innerWidth, innerHeight);
      pieces.forEach((piece) => { piece.x += piece.vx; piece.y += piece.vy; piece.turn += .08; context.save(); context.translate(piece.x, piece.y); context.rotate(piece.turn); context.fillStyle = piece.color; context.fillRect(-piece.r, -piece.r / 2, piece.r * 2, piece.r); context.restore(); });
      if (now - started < 3000) requestAnimationFrame(frame); else context.clearRect(0, 0, innerWidth, innerHeight);
    }
    requestAnimationFrame(frame);
  }

  document.querySelector("#date-form").addEventListener("submit", (event) => { event.preventDefault(); openConfirmation(); });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "reveal") showScreen("reveal");
    if (action === "condition") showScreen("condition");
    if (action === "select") showScreen(gift?.dates?.length ? "selecting" : "no-dates");
    if (action === "change") showScreen("selecting");
    if (action === "confirm") confirmChoice();
    if (action === "retry") loadGift();
    if (action === "calendar") addToCalendar();
  });

  document.querySelectorAll("[data-sons]").forEach((node) => { node.textContent = config.sonsLabel; });
  document.querySelector("#preview-notice").hidden = !previewMode;
  if (config.familyPhotoUrl) {
    const image = document.querySelector("#family-photo");
    image.src = config.familyPhotoUrl;
    image.alt = config.familyPhotoAlt;
    document.querySelector("#family-photo-wrap").hidden = false;
  }
  resetPreviewState();
  loadGift();
}());
