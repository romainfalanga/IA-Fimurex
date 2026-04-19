// Fimurex AI Agent - Dashboard client.
// 100% cote navigateur : pre-traite le PDF (pdf.js), orchestre la pipeline
// et appelle OpenRouter directement. Aucun Worker intermediaire, aucune
// limite de sous-requetes.

import { runPipeline } from "./lib/pipeline.js";

// ---- PDF.js setup (single import) ----
const pdfjsLib = await import(
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs"
);
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);
const els = {
  pdfInput: $("pdf-input"),
  apiKey: $("api-key"),
  btnProcess: $("btn-process"),
  fileLabel: $("file-label-text"),
  fileName: $("file-name"),
  // Stage panels
  stageWelcome: $("stage-welcome"),
  stageIngestion: $("stage-ingestion"),
  stageExtraction: $("stage-extraction"),
  stageVision: $("stage-vision"),
  stageAssembly: $("stage-assembly"),
  stageResult: $("stage-result"),
  // Ingestion
  ingestionCounter: $("ingestion-counter"),
  pageGrid: $("page-grid"),
  // Extraction
  extractionCounter: $("extraction-counter"),
  extractionResults: $("extraction-results"),
  // Vision
  visionCounter: $("vision-counter"),
  visionResults: $("vision-results"),
  // Assembly
  assemblyStatus: $("assembly-status"),
  // Result
  carnetEntete: $("carnet-entete"),
  carnetContainer: $("carnet-container"),
  carnetTotal: $("carnet-total"),
  carnetAnomalies: $("carnet-anomalies"),
  btnJson: $("btn-download-json"),
  btnCsv: $("btn-download-csv"),
  // Activity
  activityBar: $("activity-bar"),
  activityToggle: $("activity-toggle"),
  activityLog: $("activity-log"),
  activityCount: $("activity-count"),
};

// ---- State ----
let lastResult = null;
let logCount = 0;
let pageCanvases = {}; // index -> canvas for thumbnails
let extractionDoneCount = 0;
let extractionTotalCount = 0;
let visionDoneCount = 0;
let visionTotalCount = 0;

// ---- File input ----
els.pdfInput.addEventListener("change", () => {
  const file = els.pdfInput.files?.[0];
  if (file) {
    els.fileLabel.classList.add("has-file");
    els.fileName.textContent = file.name;
  } else {
    els.fileLabel.classList.remove("has-file");
    els.fileName.textContent = "";
  }
});

// ---- Activity log toggle ----
els.activityToggle.addEventListener("click", () => {
  els.activityBar.classList.toggle("expanded");
});

// ---- Pipeline nav click ----
document.querySelectorAll("#pipeline-nav li").forEach((li) => {
  li.addEventListener("click", () => {
    const stage = li.dataset.stage;
    showStage(stage);
  });
});

// ---- Stages ----
const stageMap = {
  welcome: "stage-welcome",
  ingestion: "stage-ingestion",
  extraction: "stage-extraction",
  vision: "stage-vision",
  assembly: "stage-assembly",
  result: "stage-result",
};

function showStage(name) {
  Object.values(stageMap).forEach((id) => {
    $(id).classList.remove("active");
  });
  const panel = $(stageMap[name]);
  if (panel) panel.classList.add("active");

  // Update nav active
  document.querySelectorAll("#pipeline-nav li").forEach((li) => {
    li.classList.toggle("active", li.dataset.stage === name);
  });
}

function setStageStatus(stage, status) {
  const li = document.querySelector(`#pipeline-nav li[data-stage="${stage}"]`);
  if (!li) return;
  const icon = li.querySelector(".stage-icon");
  if (icon) icon.dataset.status = status;
}

// ---- Activity log ----
function addLog(tag, message, tagClass) {
  logCount++;
  els.activityCount.textContent = logCount;

  const entry = document.createElement("div");
  entry.className = "log-entry";

  const time = document.createElement("span");
  time.className = "log-time";
  const now = new Date();
  time.textContent =
    now.getHours().toString().padStart(2, "0") +
    ":" +
    now.getMinutes().toString().padStart(2, "0") +
    ":" +
    now.getSeconds().toString().padStart(2, "0");

  const tagEl = document.createElement("span");
  tagEl.className = `log-tag ${tagClass || "system"}`;
  tagEl.textContent = tag;

  const msg = document.createElement("span");
  msg.className = "log-msg";
  msg.textContent = message;

  entry.appendChild(time);
  entry.appendChild(tagEl);
  entry.appendChild(msg);
  els.activityLog.appendChild(entry);
  els.activityLog.scrollTop = els.activityLog.scrollHeight;
}

// ---- Classification heuristique ----
function classifyPage(text) {
  if (!text || !text.trim()) return "PLAN_COFFRAGE";
  const lower = text.toLowerCase();
  const gardeMarkers = [
    "dossier",
    "etabli par",
    "etabli  par",
    "controle par",
    "controle  par",
    "constructeur",
    "be sol",
  ];
  const gardeHits = gardeMarkers.filter((m) => lower.includes(m)).length;
  if (gardeHits >= 3) return "PAGE_GARDE";
  if (
    lower.includes("hypotheses") &&
    (lower.includes("zone sismique") ||
      lower.includes("beton") ||
      lower.includes("acier"))
  ) {
    return "HYPOTHESES";
  }
  if (
    /acier\s+ha\s*500\s*=/.test(lower) ||
    (lower.includes("pos.") &&
      lower.includes("armature") &&
      lower.includes("forme"))
  ) {
    return "FICHE_FABRICATION";
  }
  if (
    /\bdetails?\b/.test(lower) &&
    /(fondations|cv|poteaux|linteaux|chainages|porte-a-faux|jonctions|angles)/.test(
      lower,
    )
  ) {
    return "DETAIL";
  }
  if (/(coffrage|fondations|haut\s+(vs|rdc|r\+1))/.test(lower)) {
    return "PLAN_COFFRAGE";
  }
  if (lower.includes("annexe") || lower.includes("implantation"))
    return "ANNEXE";
  return "PLAN_COFFRAGE";
}

function detectNiveau(text) {
  const lower = text.toLowerCase();
  if (/\bfondations?\b/.test(lower)) return "Fondations";
  if (/\bhaut\s*(du\s*)?(vide\s*sanitaire|vs|v\.s\.)\b/.test(lower))
    return "Haut VS";
  if (/\bhaut\s*(du\s*)?(rdc|rez-de-chaussee|r\.d\.c\.)\b/.test(lower))
    return "Haut RDC";
  if (/\bhaut\s*(du\s*)?r\+?1\b/.test(lower)) return "Haut R+1";
  if (/\bhaut\s*(du\s*)?r\+?2\b/.test(lower)) return "Haut R+2";
  return null;
}

function detectRepereFiche(text) {
  const m = text.match(/\b(Ptre\s*\d+|Pot\.?\s*\d+|Chev\.?\s*\d+)\b/i);
  return m ? m[1].replace(/\s+/g, "") : null;
}

function categoryLabel(cat) {
  const labels = {
    PAGE_GARDE: "Garde",
    PLAN_COFFRAGE: "Plan",
    HYPOTHESES: "Hyp.",
    DETAIL: "Detail",
    FICHE_FABRICATION: "Fiche",
    ANNEXE: "Annexe",
  };
  return labels[cat] || cat;
}

// ---- PDF pre-processing ----
async function processPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const numPages = pdf.numPages;
  addLog("SYSTEM", `PDF charge : ${numPages} pages.`, "system");
  els.ingestionCounter.textContent = `0 / ${numPages} pages`;

  const pages = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((it) => it.str).join(" ");
    const category = classifyPage(text);
    const niveau = detectNiveau(text);
    const repere =
      category === "FICHE_FABRICATION" ? detectRepereFiche(text) : null;

    // Render thumbnail
    const viewport = page.getViewport({ scale: 0.4 });
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = viewport.width;
    thumbCanvas.height = viewport.height;
    const thumbCtx = thumbCanvas.getContext("2d");
    await page.render({ canvasContext: thumbCtx, viewport }).promise;
    pageCanvases[i - 1] = thumbCanvas;

    // Full render for plans
    let imageDataUrl;
    if (category === "PLAN_COFFRAGE") {
      const fullViewport = page.getViewport({ scale: 1.5 });
      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = fullViewport.width;
      fullCanvas.height = fullViewport.height;
      const fullCtx = fullCanvas.getContext("2d");
      await page.render({ canvasContext: fullCtx, viewport: fullViewport })
        .promise;
      imageDataUrl = fullCanvas.toDataURL("image/png");
    }

    pages.push({
      index: i - 1,
      category,
      text,
      niveau: niveau ?? undefined,
      repere: repere ?? undefined,
      imageDataUrl,
    });

    // Add card to grid
    addPageCard(i - 1, category, niveau);
    els.ingestionCounter.textContent = `${i} / ${numPages} pages`;
    addLog(
      "SYSTEM",
      `Page ${i} : ${category}${niveau ? " (" + niveau + ")" : ""}`,
      "system",
    );
  }
  return pages;
}

function addPageCard(index, category, niveau) {
  const card = document.createElement("div");
  card.className = "page-card";
  card.id = `page-card-${index}`;

  const thumb = document.createElement("div");
  thumb.className = "page-thumb";
  if (pageCanvases[index]) {
    thumb.appendChild(pageCanvases[index]);
  } else {
    const ph = document.createElement("span");
    ph.className = "placeholder";
    ph.textContent = "\u{1F4C4}";
    thumb.appendChild(ph);
  }

  const info = document.createElement("div");
  info.className = "page-info";

  const num = document.createElement("span");
  num.className = "page-num";
  num.textContent = `p.${index + 1}`;

  const badge = document.createElement("span");
  badge.className = "page-badge";
  badge.dataset.cat = category;
  badge.textContent = categoryLabel(category);

  info.appendChild(num);
  info.appendChild(badge);

  card.appendChild(thumb);
  card.appendChild(info);
  els.pageGrid.appendChild(card);
}

function setPageStatus(index, status) {
  const card = $(`page-card-${index}`);
  if (!card) return;
  let statusEl = card.querySelector(".page-status");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "page-status";
    card.appendChild(statusEl);
  }
  statusEl.className = `page-status ${status}`;
}

// ---- Pipeline runner (100% client-side) ----
async function streamPipeline(pages, apiKey) {
  if (!apiKey) {
    throw new Error(
      "Cle API OpenRouter manquante. Saisissez-la dans le panneau de gauche.",
    );
  }
  await runPipeline({ apiKey, pages }, handlePipelineEvent);
}

function handlePipelineEvent(event) {
  const { type, data } = event;

  switch (type) {
    case "pipeline_start":
      handlePipelineStart(data);
      break;

    case "page_classified":
      // Already handled during ingestion
      break;

    case "extraction_start":
      handleExtractionStart(data);
      break;

    case "extraction_done":
      handleExtractionDone(data);
      break;

    case "vision_start":
      handleVisionStart(data);
      break;

    case "vision_done":
      handleVisionDone(data);
      break;

    case "thinking":
      handleThinking(data);
      break;

    case "assembly_start":
      handleAssemblyStart(data);
      break;

    case "assembly_done":
      handleAssemblyDone(data);
      break;

    case "validation_done":
      handleValidationDone(data);
      break;

    case "pipeline_done":
      handlePipelineDone(data);
      break;

    case "error":
      handleError(data);
      break;
  }
}

// ---- Event handlers ----

function handlePipelineStart(data) {
  extractionTotalCount = data.extractablePages;
  visionTotalCount = data.planPages;
  extractionDoneCount = 0;
  visionDoneCount = 0;

  setStageStatus("ingestion", "done");
  setStageStatus("extraction", "active");
  showStage("extraction");

  els.extractionCounter.textContent = `0 / ${extractionTotalCount}`;
  els.visionCounter.textContent = `0 / ${visionTotalCount}`;

  addLog(
    "SYSTEM",
    `Pipeline demarre : ${data.totalPages} pages, ${data.planPages} plans, ${data.extractablePages} pages a extraire.`,
    "system",
  );
}

function handleExtractionStart(data) {
  setStageStatus("extraction", "active");
  setPageStatus(data.pageIndex, "processing");
  addLog(
    "EXTRACT",
    `Debut extraction page ${data.pageIndex + 1} (${data.categoryLabel}${data.niveau ? " - " + data.niveau : ""})`,
    "extraction",
  );
}

function handleExtractionDone(data) {
  extractionDoneCount++;
  els.extractionCounter.textContent = `${extractionDoneCount} / ${extractionTotalCount}`;
  setPageStatus(data.pageIndex, "done");

  // Add data panel
  addDataPanel(
    els.extractionResults,
    `Page ${data.pageIndex + 1} - ${data.categoryLabel}${data.niveau ? " (" + data.niveau + ")" : ""}`,
    data.result,
    data.category,
  );

  addLog(
    "EXTRACT",
    `Extraction terminee page ${data.pageIndex + 1} (${data.categoryLabel})`,
    "extraction",
  );

  // If all extractions done, switch to vision if there are plans
  if (extractionDoneCount >= extractionTotalCount && visionTotalCount > 0) {
    setStageStatus("extraction", "done");
    setStageStatus("vision", "active");
    showStage("vision");
  } else if (
    extractionDoneCount >= extractionTotalCount &&
    visionTotalCount === 0
  ) {
    setStageStatus("extraction", "done");
  }
}

function handleVisionStart(data) {
  setStageStatus("vision", "active");
  showStage("vision");
  setPageStatus(data.pageIndex, "processing");
  addLog(
    "VISION",
    `Analyse visuelle du plan "${data.niveau}" (page ${data.pageIndex + 1})`,
    "vision",
  );
}

function handleVisionDone(data) {
  visionDoneCount++;
  els.visionCounter.textContent = `${visionDoneCount} / ${visionTotalCount}`;
  setPageStatus(data.pageIndex, "done");

  addDataPanel(
    els.visionResults,
    `Plan "${data.niveau}" - Echelle ${data.echelleDetectee}`,
    data.result,
    "PLAN_COFFRAGE",
  );

  addLog(
    "VISION",
    `Vision terminee pour "${data.niveau}" (echelle: ${data.echelleDetectee})`,
    "vision",
  );

  if (visionDoneCount >= visionTotalCount) {
    setStageStatus("vision", "done");
  }
}

function handleThinking(data) {
  const stage = data.stage || "system";
  const tagClass =
    stage === "extraction"
      ? "extraction"
      : stage === "vision"
        ? "vision"
        : stage === "assembly"
          ? "assembly"
          : stage === "validation"
            ? "validation"
            : "thinking";
  addLog("THINK", data.message, tagClass);
}

function handleAssemblyStart(data) {
  setStageStatus("assembly", "active");
  showStage("assembly");
  addLog("ASSEMBLE", data.message || "Assemblage en cours...", "assembly");
}

function handleAssemblyDone(data) {
  setStageStatus("assembly", "done");
  addLog(
    "ASSEMBLE",
    `Carnet assemble : ${data.nbSections} sections, ${data.nbLignes} lignes, ${data.totalKg?.toFixed(2)} kg total.`,
    "assembly",
  );

  // Render carnet
  renderCarnet(data.carnet);
}

function handleValidationDone(data) {
  if (data.nbAnomalies > 0) {
    addLog(
      "VALID",
      `${data.nbAnomalies} anomalie(s) detectee(s).`,
      "validation",
    );
    renderAnomalies(data.anomalies);
  } else {
    addLog("VALID", "Aucune anomalie detectee.", "validation");
  }
}

function handlePipelineDone(data) {
  lastResult = data.result;
  setStageStatus("result", "done");
  showStage("result");

  const durationSec = (data.durationMs / 1000).toFixed(1);
  addLog(
    "SYSTEM",
    `Pipeline termine en ${durationSec}s. Total : ${data.result?.carnet?.total_general_kg?.toFixed(2)} kg.`,
    "system",
  );

  els.btnProcess.disabled = false;
}

function handleError(data) {
  addLog("ERREUR", data.message, "error");
  setStageStatus("extraction", "error");
  setStageStatus("vision", "error");
  setStageStatus("assembly", "error");
  els.btnProcess.disabled = false;
}

// ---- UI rendering helpers ----

function addDataPanel(container, title, data, category) {
  const panel = document.createElement("div");
  panel.className = "data-panel";

  const header = document.createElement("div");
  header.className = "data-panel-header";

  const titleEl = document.createElement("div");
  titleEl.className = "data-panel-title";

  const badge = document.createElement("span");
  badge.className = "page-badge";
  badge.dataset.cat = category;
  badge.textContent = categoryLabel(category);

  const label = document.createElement("span");
  label.textContent = title;

  titleEl.appendChild(badge);
  titleEl.appendChild(label);

  const toggle = document.createElement("span");
  toggle.className = "data-panel-toggle";
  toggle.textContent = "\u25BC";

  header.appendChild(titleEl);
  header.appendChild(toggle);

  const body = document.createElement("div");
  body.className = "data-panel-body";

  const tree = document.createElement("pre");
  tree.className = "json-tree";
  tree.textContent = JSON.stringify(data, null, 2);

  body.appendChild(tree);
  panel.appendChild(header);
  panel.appendChild(body);

  header.addEventListener("click", () => {
    panel.classList.toggle("open");
  });

  container.appendChild(panel);
}

function renderCarnet(carnet) {
  if (!carnet) return;

  // Entete
  const entete = carnet.entete || {};
  els.carnetEntete.innerHTML = `
    <div class="entete-field">
      <div class="entete-label">Dossier</div>
      <div class="entete-value">${esc(entete.dossier)}</div>
    </div>
    <div class="entete-field">
      <div class="entete-label">Chantier</div>
      <div class="entete-value">${esc(entete.chantier)}</div>
    </div>
    <div class="entete-field">
      <div class="entete-label">Commune</div>
      <div class="entete-value">${esc(entete.commune)}</div>
    </div>
    <div class="entete-field">
      <div class="entete-label">Zone sismique</div>
      <div class="entete-value">${esc(entete.zone_sismique)}</div>
    </div>
  `;

  // Sections
  els.carnetContainer.innerHTML = "";
  for (const section of carnet.sections || []) {
    const h = document.createElement("div");
    h.className = "section-header";
    h.textContent = section.section;
    els.carnetContainer.appendChild(h);

    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>Designation</th>
          <th>Nomenclature</th>
          <th>Type</th>
          <th>Poids/u (kg)</th>
          <th>Quantite</th>
          <th>Poids (kg)</th>
        </tr>
      </thead>
      <tbody>
        ${(section.lignes || [])
          .map(
            (l) => `
          <tr>
            <td>${esc(l.designation)}</td>
            <td>${esc(l.nomenclature)}</td>
            <td>${esc(l.type_armature)}</td>
            <td class="num">${Number(l.poids_unitaire_kg).toFixed(2)}</td>
            <td class="num">${l.quantite}</td>
            <td class="num">${Number(l.poids_total_kg).toFixed(2)}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    `;
    els.carnetContainer.appendChild(table);
  }

  // Total
  els.carnetTotal.innerHTML = `
    <span class="total-label">TOTAL GENERAL</span>
    <span class="total-value">${Number(carnet.total_general_kg).toFixed(2)} kg</span>
  `;
}

function renderAnomalies(anomalies) {
  if (!anomalies || anomalies.length === 0) {
    els.carnetAnomalies.innerHTML = "";
    return;
  }
  els.carnetAnomalies.innerHTML = anomalies
    .map(
      (a) => `
    <div class="anomaly-item">
      <span class="anomaly-icon">\u26A0</span>
      <span>${esc(a)}</span>
    </div>
  `,
    )
    .join("");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Downloads ----

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function carnetToCsv(carnet) {
  const rows = [
    [
      "Section",
      "Designation",
      "Nomenclature",
      "Type",
      "Poids/u (kg)",
      "Quantite",
      "Poids (kg)",
    ],
  ];
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      rows.push([
        s.section,
        l.designation,
        l.nomenclature,
        l.type_armature,
        l.poids_unitaire_kg.toFixed(2),
        l.quantite,
        l.poids_total_kg.toFixed(2),
      ]);
    }
  }
  rows.push([
    "TOTAL GENERAL",
    "",
    "",
    "",
    "",
    "",
    carnet.total_general_kg.toFixed(2),
  ]);
  return rows
    .map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"),
    )
    .join("\n");
}

els.btnJson.addEventListener("click", () => {
  if (!lastResult) return;
  download(
    "carnet_ba.json",
    JSON.stringify(lastResult.carnet, null, 2),
    "application/json",
  );
});

els.btnCsv.addEventListener("click", () => {
  if (!lastResult) return;
  download(
    "carnet_ba.csv",
    carnetToCsv(lastResult.carnet),
    "text/csv;charset=utf-8",
  );
});

// ---- Main orchestration ----

function resetUI() {
  logCount = 0;
  pageCanvases = {};
  extractionDoneCount = 0;
  extractionTotalCount = 0;
  visionDoneCount = 0;
  visionTotalCount = 0;
  lastResult = null;

  els.activityLog.innerHTML = "";
  els.activityCount.textContent = "0";
  els.pageGrid.innerHTML = "";
  els.extractionResults.innerHTML = "";
  els.visionResults.innerHTML = "";
  els.carnetEntete.innerHTML = "";
  els.carnetContainer.innerHTML = "";
  els.carnetTotal.innerHTML = "";
  els.carnetAnomalies.innerHTML = "";

  // Reset assembly status
  els.assemblyStatus.innerHTML =
    '<div class="spinner"></div><span>Gemini assemble le carnet a partir de toutes les donnees...</span>';

  // Reset all stage statuses
  ["ingestion", "extraction", "vision", "assembly", "result"].forEach((s) => {
    setStageStatus(s, "pending");
  });
}

els.btnProcess.addEventListener("click", async () => {
  const file = els.pdfInput.files?.[0];
  if (!file) {
    alert("Selectionnez d'abord un PDF d'Etude BA.");
    return;
  }

  els.btnProcess.disabled = true;
  resetUI();

  // Expand activity bar
  els.activityBar.classList.add("expanded");

  // Phase 1: Ingestion
  setStageStatus("ingestion", "active");
  showStage("ingestion");
  addLog("SYSTEM", "Pre-traitement du PDF dans le navigateur...", "system");

  try {
    const pages = await processPdf(file);
    setStageStatus("ingestion", "done");
    addLog(
      "SYSTEM",
      `Ingestion terminee : ${pages.length} pages classifiees.`,
      "system",
    );

    // Phase 2-5: Run pipeline directly in the browser
    addLog(
      "SYSTEM",
      `Lancement du pipeline IA sur ${pages.length} pages...`,
      "system",
    );
    await streamPipeline(pages, els.apiKey.value.trim());
  } catch (err) {
    addLog("ERREUR", err.message, "error");
    setStageStatus("ingestion", "error");
    alert(err.message);
  } finally {
    els.btnProcess.disabled = false;
  }
});
