/* ============================================================
   SIGNVERIFY — APP LOGIC
   ============================================================ */

const API = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000"
    : window.location.origin;

// ---- ADMIN CONFIG ----
const ADMIN_PASSWORD = "admin123"; 
let isAdmin = false;    

// ---- STATE ----
let predictFile  = null;
let datasetLabel = "genuine";
let datasetFiles = [];

// ---- ADMIN TOGGLE ----
function toggleAdmin() {
  if (isAdmin) {
    // Lock — hide steps, tab bar and go back to predict
    isAdmin = false;
    switchTab("predict");
    document.getElementById("stepsSection").style.display = "none";
    document.getElementById("tabBar").style.display = "none";
    document.querySelectorAll(".tab--admin").forEach(t => t.style.display = "none");
    document.getElementById("adminBtn").classList.remove("admin-btn--unlocked");
    document.getElementById("adminBtnIcon").textContent = "🔒";
  } else {
    // Unlock
    const pwd = prompt("Enter admin password:");
    if (pwd === ADMIN_PASSWORD) {
      isAdmin = true;
      document.getElementById("stepsSection").style.display = "flex";
      document.getElementById("tabBar").style.display = "flex";
      document.querySelectorAll(".tab--admin").forEach(t => t.style.display = "flex");
      document.getElementById("adminBtn").classList.add("admin-btn--unlocked");
      document.getElementById("adminBtnIcon").textContent = "🔓";
    } else if (pwd !== null) {
      alert("Incorrect password.");
    }
  }
}

// ---- ON LOAD ----
window.addEventListener("DOMContentLoaded", () => {
  fetchStatus();
});

// ---- STATUS ----
async function fetchStatus() {
  const badge = document.getElementById("modelStatusBadge");
  const dot   = badge.querySelector(".dot");
  const text  = document.getElementById("modelStatusText");

  try {
    const res  = await fetch(`${API}/api/status`);
    const data = await res.json();

    if (data.model_trained) {
      dot.className  = "dot dot--trained";
      text.textContent = `Model ready · ${data.accuracy ?? "?"}% acc`;
    } else {
      dot.className  = "dot dot--untrained";
      text.textContent = "Model not trained";
    }

    // Update stat cards
    if (data.dataset) {
      document.getElementById("statGenuine").textContent  = data.dataset.genuine;
      document.getElementById("statForged").textContent   = data.dataset.forged;
    }
    if (data.accuracy != null) {
      document.getElementById("statAccuracy").textContent = data.accuracy + "%";
    }
  } catch {
    dot.className  = "dot dot--untrained";
    text.textContent = "Backend offline";
  }
}

// ---- TABS ----
function switchTab(name) {
  ["predict", "train", "dataset"].forEach(t => {
    document.getElementById(`panel-${t}`).classList.toggle("hidden", t !== name);
    const btn = document.getElementById(`tab-${t}`);
    // Don't touch display of hidden admin tabs
    if (btn.style.display !== "none") {
      btn.classList.toggle("tab--active", t === name);
    }
    btn.setAttribute("aria-selected", t === name ? "true" : "false");
  });
  if (name === "train") fetchStatus();
}

// ---- DRAG & DROP ----
function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("upload-area--dragover");
}
function handleDragLeave(e, id) {
  document.getElementById(id).classList.remove("upload-area--dragover");
}
function handleDrop(e, inputId) {
  e.preventDefault();
  e.currentTarget.classList.remove("upload-area--dragover");
  const dt    = e.dataTransfer;
  const input = document.getElementById(inputId);

  if (inputId === "predictFile") {
    const file = dt.files[0];
    if (file) setPredictFile(file);
  } else if (inputId === "datasetFiles") {
    const files = Array.from(dt.files);
    setDatasetFiles(files);
  }
}

// ---- PREDICT PANEL ----
function onPredictFileSelected(e) {
  const file = e.target.files[0];
  if (file) setPredictFile(file);
}

function setPredictFile(file) {
  predictFile = file;
  const preview = document.getElementById("predictPreview");
  const icon    = document.getElementById("predictPreviewWrap");
  preview.src   = URL.createObjectURL(file);
  preview.style.display = "block";
  icon.style.display    = "none";
  document.querySelector("#dropZonePredict .upload-label").textContent = file.name;
  document.getElementById("predictBtn").disabled  = false;
  document.getElementById("resultBox").style.display = "none";
}

async function runPredict() {
  if (!predictFile) return;

  const btn = document.getElementById("predictBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Analyzing…`;

  const form = new FormData();
  form.append("file", predictFile);

  try {
    const res  = await fetch(`${API}/api/predict`, { method: "POST", body: form });
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }
    showResult(data);
  } catch (err) {
    showError("Could not connect to backend. Is the server running?");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="btn-icon">🔍</span> Analyze Signature`;
  }
}

function showResult(data) {
  const box     = document.getElementById("resultBox");
  const icon    = document.getElementById("resultIcon");
  const label   = document.getElementById("resultLabel");
  const fill    = document.getElementById("confidenceFill");
  const confVal = document.getElementById("confidenceValue");
  const hint    = document.getElementById("resultHint");

  const isGenuine = data.prediction === "genuine";
  box.className   = `result-box result-box--${data.prediction}`;
  icon.textContent  = isGenuine ? "✅" : "❌";
  label.textContent = isGenuine ? "Genuine Signature" : "Forged Signature";

  // Animate confidence bar
  const conf = data.confidence ?? 0;
  confVal.textContent = conf + "%";
  fill.style.width = "0%";
  box.style.display = "block";
  requestAnimationFrame(() => {
    setTimeout(() => { fill.style.width = conf + "%"; }, 50);
  });

  hint.textContent = isGenuine
    ? "The signature matches the characteristics of a genuine sample."
    : "The signature shows signs of forgery based on pixel pattern analysis.";
}

function showError(msg) {
  const box = document.getElementById("resultBox");
  box.style.display = "block";
  box.className = "result-box result-box--forged";
  document.getElementById("resultIcon").textContent  = "⚠️";
  document.getElementById("resultLabel").textContent = "Error";
  document.getElementById("resultHint").textContent  = msg;
  document.getElementById("resultBox").querySelector(".result-confidence").style.display = "none";
}

// ---- TRAIN PANEL ----
async function runTrain() {
  const btn = document.getElementById("trainBtn");
  const log = document.getElementById("trainLog");
  const txt = document.getElementById("trainLogText");

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Training…`;
  log.style.display = "block";
  txt.textContent   = "⚙️  Loading dataset…";

  try {
    const res  = await fetch(`${API}/api/train`, { method: "POST" });
    const data = await res.json();

    if (data.error) {
      txt.style.color   = "#ef4444";
      txt.textContent   = "❌ " + data.error;
      return;
    }
    txt.style.color   = "#22c55e";
    txt.textContent   =
      `✅ Training complete!\n` +
      `   Model:     ${data.model ?? "SVM (RBF kernel)"}\n` +
      `   Accuracy:  ${data.accuracy}%\n` +
      `   Samples:   ${data.samples.genuine} genuine · ${data.samples.forged} forged\n` +
      `   Confusion Matrix:\n` +
      `     TN=${data.confusion_matrix[0][0]}  FP=${data.confusion_matrix[0][1]}\n` +
      `     FN=${data.confusion_matrix[1][0]}  TP=${data.confusion_matrix[1][1]}`;

    document.getElementById("statAccuracy").textContent = data.accuracy + "%";
    fetchStatus();
  } catch {
    txt.style.color   = "#ef4444";
    txt.textContent   = "❌ Could not reach backend.";
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="btn-icon">⚡</span> Start Training`;
  }
}

// ---- DATASET PANEL ----
function selectLabel(label) {
  datasetLabel = label;
  document.getElementById("selectedLabel").textContent = label;
  document.getElementById("toggleGenuine").classList.toggle("toggle-btn--active", label === "genuine");
  document.getElementById("toggleForged").classList.toggle("toggle-btn--active",  label === "forged");
}

function onDatasetSelected(e) {
  setDatasetFiles(Array.from(e.target.files));
}

function setDatasetFiles(files) {
  datasetFiles = files;
  const list   = document.getElementById("datasetFileList");
  list.innerHTML = "";
  files.forEach(f => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.innerHTML = `<span>📄</span>${f.name}`;
    list.appendChild(chip);
  });
  document.getElementById("uploadDatasetBtn").disabled = files.length === 0;
  document.querySelector("#dropZoneDataset .upload-label").textContent =
    files.length > 1 ? `${files.length} files selected` : (files[0]?.name ?? "");
}

async function uploadDataset() {
  if (!datasetFiles.length) return;
  const btn      = document.getElementById("uploadDatasetBtn");
  const feedback = document.getElementById("datasetFeedback");

  btn.disabled   = true;
  btn.innerHTML  = `<span class="spinner"></span> Uploading…`;
  feedback.textContent = "";
  feedback.className   = "upload-feedback";

  const form = new FormData();
  form.append("label", datasetLabel);
  datasetFiles.forEach(f => form.append("files", f));

  try {
    const res  = await fetch(`${API}/api/upload-dataset`, { method: "POST", body: form });
    const data = await res.json();

    if (data.error) {
      feedback.className   = "upload-feedback error";
      feedback.textContent = "❌ " + data.error;
      return;
    }
    feedback.textContent = `✅ ${data.count} file(s) uploaded to '${datasetLabel}' dataset.`;
    datasetFiles = [];
    document.getElementById("datasetFileList").innerHTML = "";
    document.getElementById("datasetFiles").value = "";
    document.querySelector("#dropZoneDataset .upload-label").textContent = "Drop multiple signature images";
    fetchStatus();
  } catch {
    feedback.className   = "upload-feedback error";
    feedback.textContent = "❌ Backend unreachable.";
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<span class="btn-icon">📤</span> Upload to Dataset`;
  }
}
