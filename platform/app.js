const DB_NAME = "signe-learning-prototype";
const DB_VERSION = 1;
const STORE_NAME = "signs";
const XP_KEY = "signe-learning-xp";
let database;
let currentPracticeId = null;
let practiceStep = 1;
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function mediaMarkup(sign, className = "") {
  const url = URL.createObjectURL(sign.blob);
  const label = sign.mediaType.startsWith("video/") ? "VIDÉO" : "PHOTO";
  const media = sign.mediaType.startsWith("video/")
    ? `<video class="${className}" src="${url}" muted playsinline preload="metadata" ${className === "practice-preview" ? "controls" : ""}></video>`
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

function openAddDialog() {
  $("#form-error").textContent = "";
  $("#add-dialog").showModal();
}

async function startPractice(id) {
  const sign = (await getSigns()).find((entry) => entry.id === id);
  if (!sign) return;
  currentPracticeId = id;
  practiceStep = 1;
  $("#practice-title").textContent = `Observe : ${sign.name}`;
  $("#practice-description").textContent = "Regarde attentivement la référence, puis essaie de la reproduire.";
  $("#practice-step").textContent = "ÉTAPE 1 SUR 2";
  $(".practice-progress i").style.width = "50%";
  $("#practice-next").innerHTML = 'J’ai observé <span>→</span>';
  const { html, url } = mediaMarkup(sign, "practice-preview");
  const mediaHost = $("#practice-media");
  mediaHost.innerHTML = html;
  const video = mediaHost.querySelector("video");
  if (video) video.muted = false;
  $("#practice-dialog").dataset.objectUrl = url;
  $("#practice-dialog").showModal();
}

$("#practice-next").addEventListener("click", async () => {
  if (practiceStep === 1) {
    practiceStep = 2;
    $("#practice-title").textContent = "À toi d’essayer !";
    $("#practice-description").textContent = "Reproduis le signe devant ta caméra, puis valide quand tu as terminé.";
    $("#practice-step").textContent = "ÉTAPE 2 SUR 2";
    $(".practice-progress i").style.width = "100%";
    $("#practice-next").innerHTML = 'J’ai terminé <span>✓</span>';
    return;
  }
  const signs = await getSigns();
  const sign = signs.find((entry) => entry.id === currentPracticeId);
  if (sign && !sign.learned) {
    sign.learned = true;
    await saveSign(sign);
    setXp(getXp() + 10);
    showToast("Signe révisé ! +10 XP ✨");
  } else {
    showToast("Bonne révision ! Continue comme ça ✨");
  }
  $("#practice-dialog").close();
  await render();
});

$("#add-form").addEventListener("submit", async (event) => {
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

$$("[data-close]").forEach((button) => button.addEventListener("click", () => $("#" + button.dataset.close).close()));
$("#practice-dialog").addEventListener("close", (event) => {
  const url = event.currentTarget.dataset.objectUrl;
  if (url) URL.revokeObjectURL(url);
  $("#practice-media").replaceChildren();
});
$$('[data-page]').forEach((button) => button.addEventListener("click", () => {
  const page = button.dataset.page;
  $$(".page").forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  $("#breadcrumb-page").textContent = page === "accueil" ? "Accueil" : "Ma bibliothèque";
  window.scrollTo({ top: 0, behavior: "smooth" });
}));
$$('[data-goto="bibliotheque"]').forEach((button) => button.addEventListener("click", () => $('[data-page="bibliotheque"]').click()));

openDatabase().then(async (db) => {
  database = db;
  await render();
}).catch((error) => {
  console.error(error);
  document.body.innerHTML = '<main style="font-family: sans-serif; max-width: 620px; margin: 12vh auto; padding: 24px"><h1>Ce navigateur ne permet pas le stockage local nécessaire</h1><p>Essaie de lancer le prototype depuis Terminal avec <code>python3 -m http.server 8000</code>, puis ouvre <code>http://localhost:8000</code>.</p></main>';
});
