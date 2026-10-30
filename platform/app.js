const DB_NAME = "signe-learning-prototype";
const DB_VERSION = 1;
const STORE_NAME = "signs";
const XP_KEY = "signe-learning-xp";
const DAILY_KEY = "signe-learning-daily";
let database;
let currentPracticeId = null;
let cameraStream = null;
let referenceObjectUrl = null;
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest(mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const getSigns = () => storeRequest("readonly", (store) => store.getAll());
const saveSign = (sign) => storeRequest("readwrite", (store) => store.put(sign));
const deleteSign = (id) => storeRequest("readwrite", (store) => store.delete(id));
const getXp = () => Number(localStorage.getItem(XP_KEY) || 0);
const setXp = (value) => localStorage.setItem(XP_KEY, String(value));

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDailyProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(DAILY_KEY) || "null");
    if (saved?.date === localDateKey()) return saved;
  } catch {
    // Start a fresh daily challenge if the saved value is unreadable.
  }
  const fresh = { date: localDateKey(), count: 0 };
  localStorage.setItem(DAILY_KEY, JSON.stringify(fresh));
  return fresh;
}

function recordDailyPractice() {
  const progress = getDailyProgress();
  const before = progress.count;
  progress.count = Math.min(3, before + 1);
  localStorage.setItem(DAILY_KEY, JSON.stringify(progress));
  return { before, count: progress.count };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function mediaMarkup(sign, className = "") {
  const url = URL.createObjectURL(sign.blob);
  const label = sign.mediaType.startsWith("video/") ? "VIDÉO" : "PHOTO";
  const media = sign.mediaType.startsWith("video/")
    ? `<video class="${className}" src="${url}" muted playsinline preload="metadata" ${className.startsWith("practice-") ? "controls" : ""}></video>`
    : `<img class="${className}" src="${url}" alt="Référence pour le signe ${escapeHtml(sign.name)}" />`;
  return { html: `${media}<span class="media-type">${label}</span>`, url };
}

function signCard(sign) {
  const { html } = mediaMarkup(sign, "card-media");
  return `<article class="sign-card">
    <div class="sign-thumb">${html}${sign.learned ? '<span class="learned-pill">✓ APPRIS</span>' : ""}</div>
    <div class="sign-card-body"><h3 class="sign-card-title">${escapeHtml(sign.name)}</h3>
      <div class="sign-card-meta">${escapeHtml(sign.category || "À apprendre")} · ajouté ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(sign.createdAt)}</div>
      <div class="card-actions"><button class="card-action" data-practice="${sign.id}">${sign.learned ? "Réviser le signe →" : "Commencer →"}</button><button class="card-action delete" data-delete="${sign.id}" aria-label="Supprimer ${escapeHtml(sign.name)}">Supprimer</button></div>
    </div>
  </article>`;
}

function emptyState(title, message, action = true) {
  return `<div class="empty-state"><div><div class="empty-illustration">✳</div><strong>${title}</strong><p>${message}</p>${action ? '<button class="text-button" data-open-add>Ajouter mon premier signe <span>→</span></button>' : ""}</div></div>`;
}

async function render() {
  const signs = (await getSigns()).sort((a, b) => b.createdAt - a.createdAt);
  const learned = signs.filter((sign) => sign.learned).length;
  const xp = getXp();
  $("#stat-total").textContent = signs.length;
  $("#plural-total").textContent = signs.length === 1 ? "" : "s";
  $("#stat-learned").textContent = learned;
  $("#stat-points").textContent = xp;
  $("#nav-count").textContent = signs.length;
  $("#library-total").textContent = `${signs.length} signe${signs.length === 1 ? "" : "s"}`;
  const daily = getDailyProgress();
  $("#daily-count").textContent = daily.count;
  $("#daily-progress").style.width = `${(daily.count / 3) * 100}%`;
  $("#daily-challenge").classList.toggle("complete", daily.count === 3);
  $("#daily-caption").textContent = daily.count === 3
    ? "Défi accompli ! Tu peux continuer à réviser si tu en as envie."
    : "Chaque répétition compte. Tu peux réviser le même signe plusieurs fois.";
  $("#daily-start").innerHTML = daily.count === 3 ? "Réviser encore <span>↗</span>" : "Choisir un signe <span>→</span>";

  const practiceSigns = signs.filter((sign) => !sign.learned).slice(0, 3);
  $("#practice-grid").innerHTML = practiceSigns.length
    ? practiceSigns.map(signCard).join("")
    : emptyState(signs.length ? "Bravo, tout est révisé !" : "Ta bibliothèque commence ici", signs.length ? "Ajoute d’autres signes pour continuer à pratiquer." : "Ajoute une photo ou une vidéo pour créer ton premier exercice.");
  const query = $("#search").value.trim().toLocaleLowerCase("fr");
  const filtered = signs.filter((sign) => `${sign.name} ${sign.category}`.toLocaleLowerCase("fr").includes(query));
  $("#library-grid").innerHTML = filtered.length
    ? filtered.map(signCard).join("")
    : emptyState(query ? "Aucun résultat" : "Ta bibliothèque est encore vide", query ? "Essaie un autre nom de signe." : "Tes références apparaîtront ici après leur ajout.", !query);
  bindCardActions();
}

function bindCardActions() {
  $$('[data-practice]').forEach((button) => button.addEventListener("click", () => startPractice(button.dataset.practice)));
  $$('[data-delete]').forEach((button) => button.addEventListener("click", async () => {
    const sign = (await getSigns()).find((entry) => entry.id === button.dataset.delete);
    if (!sign || !window.confirm(`Supprimer « ${sign.name} » de ta bibliothèque ?`)) return;
    await deleteSign(sign.id);
    await render();
    showToast("Le signe a été supprimé.");
  }));
  $$('[data-open-add]').forEach((button) => button.addEventListener("click", openAddDialog));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function celebrateChallenge() {
  const colors = ["#9685d0", "#c5b9e8", "#e8bfad", "#a9c2aa", "#f0d993"];
  for (let index = 0; index < 22; index += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.left = `${43 + Math.random() * 14}%`;
    piece.style.backgroundColor = colors[index % colors.length];
    piece.style.setProperty("--dx", `${Math.round(Math.random() * 300 - 150)}px`);
    piece.style.setProperty("--dy", `${Math.round(100 + Math.random() * 180)}px`);
    piece.style.setProperty("--rotate", `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 120}ms`);
    document.body.append(piece);
    setTimeout(() => piece.remove(), 1250);
  }
}

function openAddDialog() {
  $("#form-error").textContent = "";
  $("#add-dialog").showModal();
}

async function startPractice(id) {
  const sign = (await getSigns()).find((entry) => entry.id === id);
  if (!sign) return;
  stopCamera();
  if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
  currentPracticeId = id;
  $("#practice-page-title").textContent = sign.name;
  $("#camera-error").textContent = "";
  const { html, url } = mediaMarkup(sign, "practice-reference-media");
  referenceObjectUrl = url;
  const mediaHost = $("#practice-reference");
  mediaHost.innerHTML = html;
  const video = mediaHost.querySelector("video");
  if (video) video.muted = false;
  navigateToPage("pratique");
  enableCamera();
}

async function openPracticePage() {
  const signs = await getSigns();
  if (!signs.length) {
    navigateToPage("bibliotheque");
    showToast("Ajoute d’abord une photo ou une vidéo de référence pour pratiquer.");
    return;
  }
  const sign = signs.find((entry) => !entry.learned) || signs[0];
  startPractice(sign.id);
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  const feed = $("#webcam-feed");
  if (!feed) return;
  feed.srcObject = null;
  feed.hidden = true;
  $("#camera-placeholder").hidden = false;
  $("#live-badge").hidden = true;
  $("#camera-start").hidden = false;
  $("#camera-stop").hidden = true;
  $("#camera-status").classList.remove("active");
  $("#camera-status").lastChild.textContent = " Caméra désactivée";
}

function clearPractice() {
  stopCamera();
  if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
  referenceObjectUrl = null;
  $("#practice-reference").replaceChildren();
  currentPracticeId = null;
}

async function enableCamera() {
  $("#camera-error").textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    $("#camera-error").textContent = "La caméra nécessite un navigateur compatible et une page sécurisée. Lance le site sur localhost.";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    const feed = $("#webcam-feed");
    feed.srcObject = cameraStream;
    feed.hidden = false;
    $("#camera-placeholder").hidden = true;
    $("#live-badge").hidden = false;
    $("#camera-start").hidden = true;
    $("#camera-stop").hidden = false;
    $("#camera-status").classList.add("active");
    $("#camera-status").lastChild.textContent = " Caméra active";
    await feed.play();
  } catch (error) {
    stopCamera();
    const messages = {
      NotAllowedError: "L’accès à la caméra a été refusé. Autorise-le dans les réglages du navigateur, puis réessaie.",
      NotFoundError: "Aucune caméra n’a été trouvée sur cet appareil.",
      NotReadableError: "La caméra est déjà utilisée par une autre application.",
    };
    $("#camera-error").textContent = messages[error.name] || "Impossible d’ouvrir la caméra. Vérifie ses autorisations et réessaie.";
  }
}

async function finishPractice() {
  const signs = await getSigns();
  const sign = signs.find((entry) => entry.id === currentPracticeId);
  if (!sign) return;
  const wasLearned = sign?.learned;
  if (sign && !sign.learned) {
    sign.learned = true;
    await saveSign(sign);
    setXp(getXp() + 10);
  }
  const daily = recordDailyPractice();
  const encouragements = wasLearned
    ? ["Bien révisé ! La répétition aide à mémoriser.", "Une pratique de plus, bravo !", "Tu avances à ton rythme, et ça compte."]
    : ["Bien joué, +10 XP !", "Un signe de plus dans ta boîte à outils !", "Premier passage validé, bravo !"];
  if (daily.before < 3 && daily.count === 3) {
    showToast("Défi du jour accompli ! Bravo 🎉");
    celebrateChallenge();
  } else {
    showToast(encouragements[Math.floor(Math.random() * encouragements.length)]);
  }
  clearPractice();
  await render();
  navigateToPage("bibliotheque");
}

function navigateToPage(page) {
  if (page === "pratique" && !currentPracticeId) {
    page = "bibliotheque";
    showToast("Choisis un signe dans ta bibliothèque pour commencer.");
  }
  if (page !== "pratique" && currentPracticeId) clearPractice();
  $$(".page").forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  const labels = { accueil: "Accueil", bibliotheque: "Ma bibliothèque", pratique: "Pratiquer" };
  $("#breadcrumb-page").textContent = labels[page];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#add-form").addEventListener("submit", async (event) => {
  if (event.submitter?.formMethod === "dialog") return;
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#sign-name").value.trim();
  const file = $("#sign-file").files[0];
  if (!name || !file) return;
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    $("#form-error").textContent = "Choisis une image ou une vidéo.";
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    $("#form-error").textContent = "Le fichier dépasse la limite de 100 Mo.";
    return;
  }
  try {
    await saveSign({ id: crypto.randomUUID(), name, category: $("#sign-category").value, blob: file, mediaType: file.type, createdAt: Date.now(), learned: false });
    $("#add-dialog").close();
    form.reset();
    $("#upload-title").textContent = "Choisir un fichier";
    $("#upload-caption").textContent = "Image ou vidéo · 100 Mo max";
    await render();
    showToast("Ton signe a été ajouté à la bibliothèque.");
  } catch (error) {
    $("#form-error").textContent = "Le navigateur n’a pas pu enregistrer ce fichier. Essaie un fichier plus léger.";
  }
});

$("#sign-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $("#upload-title").textContent = file.name;
  $("#upload-caption").textContent = `${file.type.startsWith("video/") ? "Vidéo" : "Image"} · ${(file.size / (1024 * 1024)).toFixed(1)} Mo`;
  $("#form-error").textContent = "";
});

$("#search").addEventListener("input", render);
$("#add-open").addEventListener("click", openAddDialog);
$("#add-open-library").addEventListener("click", openAddDialog);
$("#daily-start").addEventListener("click", async () => {
  const signs = await getSigns();
  if (!signs.length) {
    openAddDialog();
    showToast("Ajoute un signe pour commencer ton défi !");
    return;
  }
  const lastId = localStorage.getItem("signe-learning-last-challenge");
  const choices = signs.length > 1 ? signs.filter((sign) => sign.id !== lastId) : signs;
  const chosen = choices[Math.floor(Math.random() * choices.length)];
  localStorage.setItem("signe-learning-last-challenge", chosen.id);
  startPractice(chosen.id);
});

$("#camera-start").addEventListener("click", enableCamera);
$("#camera-stop").addEventListener("click", stopCamera);
$("#practice-finish").addEventListener("click", finishPractice);
$("#practice-back").addEventListener("click", () => navigateToPage("bibliotheque"));

$$('[data-page]').forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.page === "pratique" && !currentPracticeId) {
    openPracticePage();
    return;
  }
  navigateToPage(button.dataset.page);
}));
$$('[data-goto="bibliotheque"]').forEach((button) => button.addEventListener("click", () => $('[data-page="bibliotheque"]').click()));
window.addEventListener("beforeunload", stopCamera);
window.addEventListener("unhandledrejection", (event) => {
  console.error("Learn LSF action failed:", event.reason);
  showToast("Une action n’a pas abouti. Recharge la page et réessaie.");
});

openDatabase().then(async (db) => {
  database = db;
  await render();
}).catch((error) => {
  console.error("Learn LSF could not initialize:", error);
  const notice = document.createElement("div");
  notice.className = "app-error-notice";
  notice.setAttribute("role", "alert");
  notice.textContent = `Le stockage local n’a pas pu démarrer (${error.message || "erreur inconnue"}). Essaie avec un navigateur récent et ouvre le site sur localhost.`;
  document.body.prepend(notice);
});
