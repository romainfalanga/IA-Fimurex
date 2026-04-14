// Fimurex AI Agent - client. Pre-traite le PDF dans le navigateur
// (extraction de texte + rendu PNG de chaque page) puis envoie les
// pages au Worker pour orchestration OpenRouter.

import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";

const els = {
  pdfInput: document.getElementById("pdf-input"),
  apiKey: document.getElementById("api-key"),
  echelle: document.getElementById("echelle"),
  btnProcess: document.getElementById("btn-process"),
  stepProgress: document.getElementById("step-progress"),
  stepResult: document.getElementById("step-result"),
  progress: document.getElementById("progress"),
  log: document.getElementById("log"),
  entete: document.getElementById("entete"),
  carnet: document.getElementById("carnet-container"),
  total: document.getElementById("total"),
  debug: document.getElementById("debug"),
  btnJson: document.getElementById("btn-download-json"),
  btnCsv: document.getElementById("btn-download-csv"),
};

let lastResult = null;

function log(msg) {
  els.log.textContent += msg + "\n";
  els.log.scrollTop = els.log.scrollHeight;
}

// --- Classification heuristique (miroir du module Python ingestion.py) ----

function classifyPage(text) {
  if (!text || !text.trim()) return "PLAN_COFFRAGE";
  const lower = text.toLowerCase();
  const gardeMarkers = ["dossier", "etabli par", "etabli  par", "controle par", "controle  par", "constructeur", "be sol"];
  const gardeHits = gardeMarkers.filter((m) => lower.includes(m)).length;
  if (gardeHits >= 3) return "PAGE_GARDE";
  if (lower.includes("hypotheses") && (lower.includes("zone sismique") || lower.includes("beton") || lower.includes("acier"))) {
    return "HYPOTHESES";
  }
  if (/acier\s+ha\s*500\s*=/.test(lower) || (lower.includes("pos.") && lower.includes("armature") && lower.includes("forme"))) {
    return "FICHE_FABRICATION";
  }
  if (/\bdetails?\b/.test(lower) && /(fondations|cv|poteaux|linteaux|chainages|porte-a-faux|jonctions|angles)/.test(lower)) {
    return "DETAIL";
  }
  if (/(coffrage|fondations|haut\s+(vs|rdc|r\+1))/.test(lower)) {
    return "PLAN_COFFRAGE";
  }
  if (lower.includes("annexe") || lower.includes("implantation")) return "ANNEXE";
  return "PLAN_COFFRAGE";
}

function detectNiveau(text) {
  const lower = text.toLowerCase();
  if (/\bfondations?\b/.test(lower)) return "Fondations";
  if (/\bhaut\s*(du\s*)?(vide\s*sanitaire|vs|v\.s\.)\b/.test(lower)) return "Haut VS";
  if (/\bhaut\s*(du\s*)?(rdc|rez-de-chaussee|r\.d\.c\.)\b/.test(lower)) return "Haut RDC";
  if (/\bhaut\s*(du\s*)?r\+?1\b/.test(lower)) return "Haut R+1";
  if (/\bhaut\s*(du\s*)?r\+?2\b/.test(lower)) return "Haut R+2";
  return null;
}

function detectRepereFiche(text) {
  const m = text.match(/\b(Ptre\s*\d+|Pot\.?\s*\d+|Chev\.?\s*\d+)\b/i);
  return m ? m[1].replace(/\s+/g, "") : null;
}

// --- Pre-traitement PDF ---------------------------------------------------

async function processPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  log(`PDF charge : ${pdf.numPages} pages.`);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    els.progress.value = (i / pdf.numPages) * 40; // 0-40 %
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((it) => it.str).join(" ");
    const category = classifyPage(text);
    const niveau = detectNiveau(text);
    const repere = category === "FICHE_FABRICATION" ? detectRepereFiche(text) : null;

    let imageDataUrl;
    if (category === "PLAN_COFFRAGE") {
      // Rendu PNG uniquement pour les plans (necessaires a l'analyse visuelle).
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      imageDataUrl = canvas.toDataURL("image/png");
    }

    pages.push({
      index: i - 1,
      category,
      text,
      niveau: niveau ?? undefined,
      repere: repere ?? undefined,
      imageDataUrl,
    });
    log(`Page ${i} : ${category}${niveau ? ` (${niveau})` : ""}`);
  }
  return pages;
}

// --- Appel au Worker ------------------------------------------------------

async function callWorker(pages, echelle, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-OpenRouter-Key"] = apiKey;
  const response = await fetch("/api/process", {
    method: "POST",
    headers,
    body: JSON.stringify({ pages, echelle }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${response.status} ${response.statusText} - ${err}`);
  }
  return response.json();
}

// --- Rendu du resultat ----------------------------------------------------

function renderCarnet(result) {
  const carnet = result.carnet;
  els.entete.innerHTML = `
    <p><strong>Dossier :</strong> ${esc(carnet.entete.dossier)} &mdash;
       <strong>Chantier :</strong> ${esc(carnet.entete.chantier)} &mdash;
       <strong>Commune :</strong> ${esc(carnet.entete.commune)} &mdash;
       <strong>Zone sismique :</strong> ${esc(carnet.entete.zone_sismique)}</p>
  `;
  const container = els.carnet;
  container.innerHTML = "";
  for (const section of carnet.sections) {
    const h = document.createElement("div");
    h.className = "section-header";
    h.textContent = section.section;
    container.appendChild(h);

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
        ${section.lignes.map((l) => `
          <tr>
            <td>${esc(l.designation)}</td>
            <td>${esc(l.nomenclature)}</td>
            <td>${esc(l.type_armature)}</td>
            <td class="num">${l.poids_unitaire_kg.toFixed(2)}</td>
            <td class="num">${l.quantite}</td>
            <td class="num">${l.poids_total_kg.toFixed(2)}</td>
          </tr>
        `).join("")}
      </tbody>
    `;
    container.appendChild(table);
  }
  els.total.textContent = `TOTAL GENERAL : ${carnet.total_general_kg.toFixed(2)} kg`;
  els.debug.textContent = JSON.stringify(
    { vision: result.vision, extracted: result.extracted, anomalies: result.anomalies },
    null,
    2,
  );
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Exports JSON / CSV ---------------------------------------------------

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
  const rows = [["Section", "Designation", "Nomenclature", "Type", "Poids/u (kg)", "Quantite", "Poids (kg)"]];
  for (const s of carnet.sections) {
    for (const l of s.lignes) {
      rows.push([s.section, l.designation, l.nomenclature, l.type_armature, l.poids_unitaire_kg.toFixed(2), l.quantite, l.poids_total_kg.toFixed(2)]);
    }
  }
  rows.push(["TOTAL GENERAL", "", "", "", "", "", carnet.total_general_kg.toFixed(2)]);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
}

// --- Orchestration UI -----------------------------------------------------

els.btnProcess.addEventListener("click", async () => {
  const file = els.pdfInput.files?.[0];
  if (!file) {
    alert("Selectionnez d'abord un PDF d'Etude BA.");
    return;
  }
  els.btnProcess.disabled = true;
  els.stepProgress.hidden = false;
  els.stepResult.hidden = true;
  els.log.textContent = "";
  els.progress.value = 0;

  try {
    log("Pre-traitement du PDF dans le navigateur...");
    const pages = await processPdf(file);
    els.progress.value = 45;
    log(`Envoi de ${pages.length} pages au Worker Cloudflare...`);
    const result = await callWorker(pages, els.echelle.value, els.apiKey.value.trim());
    els.progress.value = 100;
    log(`Total general : ${result.carnet.total_general_kg.toFixed(2)} kg`);
    if (result.anomalies?.length) {
      log(`Anomalies : ${result.anomalies.length}`);
      for (const a of result.anomalies) log(`  - ${a}`);
    }
    lastResult = result;
    renderCarnet(result);
    els.stepResult.hidden = false;
  } catch (err) {
    log(`ERREUR : ${err.message}`);
    alert(err.message);
  } finally {
    els.btnProcess.disabled = false;
  }
});

els.btnJson.addEventListener("click", () => {
  if (!lastResult) return;
  download("carnet_ba.json", JSON.stringify(lastResult.carnet, null, 2), "application/json");
});
els.btnCsv.addEventListener("click", () => {
  if (!lastResult) return;
  download("carnet_ba.csv", carnetToCsv(lastResult.carnet), "text/csv;charset=utf-8");
});
