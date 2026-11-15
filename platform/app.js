const DB_NAME = "signe-learning-prototype";
const DB_VERSION = 1;
const STORE_NAME = "signs";
const XP_KEY = "signe-learning-xp";
const DAILY_KEY = "signe-learning-daily";
let database;
let datasetSigns = [];
let currentPracticeId = null;
let cameraStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartedAt = null;
let practiceHasResult = false;
let practiceRewarded = false;
let recognizerReady = false;
let healthPollTimer = null;
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

async function getSigns() {
  const savedSigns = await storeRequest("readonly", (store) => store.getAll());
  let learnedDatasetSigns = {};
  try {
    learnedDatasetSigns = JSON.parse(localStorage.getItem("learned-dataset-signs") || "{}");
  } catch {
    learnedDatasetSigns = {};
  }
  const builtInSigns = datasetSigns.map((sign) => ({
    ...sign,
    learned: Boolean(learnedDatasetSigns[sign.id]),
  }));
  return [...builtInSigns, ...savedSigns];
}

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
  const url = sign.source === "dataset" ? sign.mediaUrl : URL.createObjectURL(sign.blob);
  const label = sign.mediaType.startsWith("video/") ? "VIDÉO" : "PHOTO";
  const media = sign.mediaType.startsWith("video/")
    ? `<video class="${className}" src="${url}" muted playsinline preload="metadata" ${className.startsWith("practice-") ? "controls" : ""}></video>`
    : `<img class="${className}" src="${url}" alt="Référence pour le signe ${escapeHtml(sign.name)}" />`;
  return { html: `${media}<span class="media-type">${label}</span>`, url: sign.source === "dataset" ? null : url };
}

function signCard(sign) {
  const { html } = mediaMarkup(sign, "card-media");
  return `<article class="sign-card">
    <div class="sign-thumb">${html}${sign.learned ? '<span class="learned-pill">✓ APPRIS</span>' : ""}</div>
    <div class="sign-card-body"><h3 class="sign-card-title">${escapeHtml(sign.name)}</h3>
      <div class="sign-card-meta">${escapeHtml(sign.category || "À apprendre")}${sign.source === "dataset" ? ` · ${sign.videoCount} vidéo${sign.videoCount === 1 ? "" : "s"}` : " · vidéo personnelle"}</div>
      <div class="card-actions"><button class="card-action" data-practice="${sign.id}">${sign.learned ? "Réviser le signe →" : "Commencer →"}</button>${sign.source === "dataset" ? "" : `<button class="card-action delete" data-delete="${sign.id}" aria-label="Supprimer ${escapeHtml(sign.name)}">Supprimer</button>`}</div>
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
  const datasetEntries = filtered.filter((sign) => sign.source === "dataset");
  const userEntries = filtered.filter((sign) => sign.source !== "dataset");
  $("#dataset-signs-grid").innerHTML = datasetEntries.length
    ? datasetEntries.map(signCard).join("")
    : emptyState(query ? "Aucun signe de base trouvé" : "Le dataset n’est pas chargé", query ? "Essaie un autre nom." : "Lance le serveur intégré avec tes vidéos DTW locales.", false);
  $("#user-signs-grid").innerHTML = userEntries.length
    ? userEntries.map(signCard).join("")
    : emptyState(query ? "Aucune vidéo personnelle trouvée" : "Aucune vidéo ajoutée", query ? "Essaie un autre nom." : "Ajoute une vidéo courte pour créer ta propre référence.");
  bindCardActions();
}

function bindCardActions() {
  $$('[data-practice]').forEach((button) => button.addEventListener("click", () => startPractice(button.dataset.practice)));
  $$('[data-delete]').forEach((button) => button.addEventListener("click", async () => {
    const sign = (await getSigns()).find((entry) => entry.id === button.dataset.delete);
    if (!sign || !window.confirm(`Supprimer « ${sign.name} » de ta bibliothèque ?`)) return;
    if (sign.referenceId) {
      try {
        const response = await fetch("/api/user-reference", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference_id: sign.referenceId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Suppression de la référence impossible.");
      } catch (error) {
        showToast(error.message);
        return;
      }
    }
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
  if (
    sign.source !== "dataset" &&
    sign.mediaType.startsWith("video/") &&
    !sign.referenceId
  ) {
    try {
      const upload = new FormData();
      upload.append("label", sign.name);
      const extension = sign.mediaType.includes("webm") ? "webm" : sign.mediaType.includes("mp4") ? "mp4" : "mov";
      upload.append("video", sign.blob, `previous-library-video.${extension}`);
      const response = await fetch("/api/user-reference", { method: "POST", body: upload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Impossible d’ajouter cette vidéo au reconnaisseur.");
      sign.source = "user";
      sign.referenceId = result.reference_id;
      await saveSign(sign);
    } catch (error) {
      showToast(error.message);
      return;
    }
  }
  stopCamera();
  if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
  currentPracticeId = id;
  practiceHasResult = false;
  practiceRewarded = false;
  recognizerReady = false;
  clearTimeout(healthPollTimer);
  resetRecognitionControls();
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
  checkRecognizerStatus();
}

function resetRecognitionControls() {
  const recordButton = $("#practice-record");
  const finishButton = $("#practice-finish");
  if (!recordButton || !finishButton) return;
  recordButton.disabled = true;
  recordButton.hidden = false;
  recordButton.textContent = "Enregistrer mon essai";
  finishButton.disabled = true;
  finishButton.hidden = false;
  finishButton.innerHTML = "Analyser mon essai <span>✓</span>";
  $("#practice-guidance").textContent = "Enregistre ton essai, puis demande son analyse.";
  $("#recognition-result").hidden = true;
  $("#recognition-result").replaceChildren();
  $("#recognizer-status").textContent = "Vérification du reconnaisseur local…";
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
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  mediaRecorder = null;
  recordedChunks = [];
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
  $("#practice-record").disabled = true;
}

function clearPractice() {
  clearTimeout(healthPollTimer);
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
    $("#live-badge").textContent = "EN DIRECT";
    $("#camera-start").hidden = true;
    $("#camera-stop").hidden = false;
    $("#camera-status").classList.add("active");
    $("#camera-status").lastChild.textContent = " Caméra active";
    await feed.play();
    $("#practice-record").disabled = !recognizerReady;
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

async function checkRecognizerStatus() {
  clearTimeout(healthPollTimer);
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const status = await response.json();
    if (status.status === "ready") {
      recognizerReady = true;
      $("#recognizer-status").textContent = "Reconnaisseur prêt.";
      $("#practice-record").disabled = !cameraStream;
      return;
    }
    if (status.status === "error") {
      recognizerReady = false;
      $("#practice-record").disabled = true;
      $("#recognizer-status").textContent = `Reconnaisseur indisponible : ${status.error}`;
      return;
    }
    $("#recognizer-status").textContent = "Préparation des références de signes… cela peut prendre un peu de temps au premier lancement.";
  } catch {
    recognizerReady = false;
    $("#practice-record").disabled = true;
    $("#recognizer-status").textContent = "Serveur local indisponible. Lance platform/server.py depuis l’environnement Python du projet.";
  }
  healthPollTimer = setTimeout(checkRecognizerStatus, 2500);
}

async function finishPractice() {
  if (practiceHasResult && mediaRecorder?.state !== "recording") {
    clearPractice();
    await render();
    navigateToPage("bibliotheque");
    return;
  }
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;
  const finishButton = $("#practice-finish");
  const recordButton = $("#practice-record");
  finishButton.disabled = true;
  recordButton.disabled = true;
  $("#practice-guidance").textContent = "Analyse en cours…";
  $("#camera-error").textContent = "";
  const recorder = mediaRecorder;
  const clip = await new Promise((resolve, reject) => {
    recorder.addEventListener("error", () => reject(new Error("L’enregistrement a échoué.")), { once: true });
    recorder.addEventListener("stop", () => resolve(new Blob(recordedChunks, { type: recorder.mimeType || "video/webm" })), { once: true });
    recorder.stop();
  }).catch((error) => {
    $("#camera-error").textContent = error.message;
    finishButton.disabled = false;
    recordButton.disabled = false;
    return null;
  });
  mediaRecorder = null;
  const durationSeconds = recordingStartedAt === null ? null : (performance.now() - recordingStartedAt) / 1000;
  recordingStartedAt = null;
  recordedChunks = [];
  if (!clip || !clip.size) {
    $("#camera-error").textContent = "La vidéo est vide. Enregistre un essai un peu plus long.";
    $("#practice-guidance").textContent = "Réessaie avec un nouvel enregistrement.";
    recordButton.disabled = false;
    return;
  }

  try {
    const formData = new FormData();
    const extension = clip.type.includes("mp4") ? "mp4" : "webm";
    formData.append("video", clip, `practice.${extension}`);
    if (durationSeconds !== null) formData.append("duration_seconds", String(durationSeconds));
    const currentSigns = await getSigns();
    const expectedSign = currentSigns.find((entry) => entry.id === currentPracticeId);
    if (!expectedSign) throw new Error("Le signe à pratiquer n’a pas été retrouvé.");
    formData.append("expected", expectedSign.name);
    const response = await fetch("/api/recognize", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Le serveur n’a pas pu analyser cette vidéo.");
    showRecognitionResult(result);
    practiceHasResult = true;
    const signs = await getSigns();
    const sign = signs.find((entry) => entry.id === currentPracticeId);
    const wasLearned = sign?.learned;
    if (sign && result.matches_expected && !practiceRewarded) {
      if (!sign.learned && sign.source === "dataset") {
        let learnedLabels = {};
        try {
          learnedLabels = JSON.parse(localStorage.getItem("learned-dataset-signs") || "{}");
        } catch {
          learnedLabels = {};
        }
        learnedLabels[sign.id] = true;
        localStorage.setItem("learned-dataset-signs", JSON.stringify(learnedLabels));
      } else if (!sign.learned) {
        sign.learned = true;
        await saveSign(sign);
      }
      if (!wasLearned) {
        setXp(getXp() + 10);
      }
      practiceRewarded = true;
      showToast(wasLearned ? "Signe reconnu, bien joué !" : "Signe reconnu, +10 XP !");
    }
    const daily = recordDailyPractice();
    if (daily.before < 3 && daily.count === 3) celebrateChallenge();
    finishButton.disabled = false;
    finishButton.innerHTML = "Terminer <span>✓</span>";
    recordButton.disabled = false;
    recordButton.textContent = "Réessayer";
    $("#practice-guidance").textContent = result.matches_expected
      ? "Le signe de référence a été reconnu. Tu peux réessayer ou terminer."
      : "Regarde le résultat, puis réessaie si tu le souhaites.";
    await render();
  } catch (error) {
    $("#camera-error").textContent = error.message;
    practiceHasResult = true;
    finishButton.disabled = false;
    finishButton.innerHTML = "Terminer <span>✓</span>";
    $("#practice-guidance").textContent = "L’analyse n’a pas abouti. Vérifie que le serveur Learn LSF est lancé, puis réessaie.";
    recordButton.disabled = false;
    recordButton.textContent = "Réessayer";
  }
}

function showRecognitionResult(result) {
  const host = $("#recognition-result");
  host.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = !result.expected_available
    ? `« ${result.expected} » n’est pas dans les signes de référence du reconnaisseur.`
    : result.matches_expected
      ? `Bien joué ! « ${result.prediction} » a été reconnu.`
      : result.prediction === "Signe inconnu"
        ? "Le signe n’a pas pu être reconnu cette fois."
        : `Le signe détecté est « ${result.prediction} ».`;
  host.append(title);
  if (!result.matches_expected && result.expected_available && result.prediction !== "Signe inconnu") {
    const detail = document.createElement("span");
    detail.textContent = ` La référence attendue était « ${result.expected} ». Tu peux réessayer.`;
    host.append(detail);
  }
  host.hidden = false;
}

function startPracticeRecording() {
  if (!cameraStream) {
    $("#camera-error").textContent = "Active d’abord la caméra.";
    return;
  }
  if (!window.MediaRecorder) {
    $("#camera-error").textContent = "Ce navigateur ne permet pas d’enregistrer la vidéo pour l’analyse.";
    return;
  }
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type));
  try {
    practiceHasResult = false;
    mediaRecorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : undefined);
    recordedChunks = [];
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordedChunks.push(event.data);
    });
    mediaRecorder.start(250);
    recordingStartedAt = performance.now();
    $("#practice-record").disabled = true;
    $("#practice-record").textContent = "Enregistrement…";
    $("#practice-finish").disabled = false;
    $("#practice-finish").innerHTML = "Arrêter et analyser <span>✓</span>";
    $("#practice-guidance").textContent = "Fais le signe face à la caméra, puis arrête l’enregistrement.";
    $("#recognition-result").hidden = true;
    $("#camera-error").textContent = "";
    $("#live-badge").textContent = "ENREGISTREMENT";
  } catch (error) {
    $("#camera-error").textContent = `Impossible de démarrer l’enregistrement : ${error.message}`;
  }
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
  let uploadedReferenceId = null;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalSubmitText = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.textContent = file.type.startsWith("video/") ? "Ajout et analyse…" : "Enregistrement…";
  try {
    let referenceId = null;
    if (file.type.startsWith("video/")) {
      const upload = new FormData();
      upload.append("label", name);
      upload.append("video", file, file.name);
      const response = await fetch("/api/user-reference", { method: "POST", body: upload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Impossible d’ajouter cette vidéo au reconnaisseur.");
      referenceId = result.reference_id;
      uploadedReferenceId = referenceId;
    }
    await saveSign({ id: crypto.randomUUID(), name, category: $("#sign-category").value, blob: file, mediaType: file.type, createdAt: Date.now(), learned: false, source: "user", referenceId });
    $("#add-dialog").close();
    form.reset();
    $("#upload-title").textContent = "Choisir un fichier";
    $("#upload-caption").textContent = "Image ou vidéo · 100 Mo max";
    await render();
    showToast("Ton signe a été ajouté à la bibliothèque.");
  } catch (error) {
    if (uploadedReferenceId) {
      fetch("/api/user-reference", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_id: uploadedReferenceId }),
      }).catch(() => {});
    }
    $("#form-error").textContent = error.message || "Le navigateur n’a pas pu enregistrer ce fichier. Essaie un fichier plus léger.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalSubmitText;
  }
});

$("#sign-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $("#upload-title").textContent = file.name;
  $("#upload-caption").textContent = `${file.type.startsWith("video/") ? "Vidéo" : "Image"} · ${(file.size / (1024 * 1024)).toFixed(1)} Mo`;
  $("#form-error").textContent = "";
});

async function loadDatasetSigns() {
  try {
    const response = await fetch("/api/signs", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    datasetSigns = payload.signs || [];
  } catch {
    datasetSigns = [];
  }
}

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
$("#practice-record").addEventListener("click", startPracticeRecording);
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
  await loadDatasetSigns();
  await render();
}).catch((error) => {
  console.error("Learn LSF could not initialize:", error);
  const notice = document.createElement("div");
  notice.className = "app-error-notice";
  notice.setAttribute("role", "alert");
  notice.textContent = `Le stockage local n’a pas pu démarrer (${error.message || "erreur inconnue"}). Essaie avec un navigateur récent et ouvre le site sur localhost.`;
  document.body.prepend(notice);
});
