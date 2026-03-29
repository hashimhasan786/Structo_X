/* ══════════════════════════════════
   StructoX — main.js
   ══════════════════════════════════ */

// ── Navigation ──
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.section;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`section-${target}`).classList.add("active");
    document.getElementById("page-title").textContent = {
      upload: "Floor Plan Analyzer",
      analysis: "Structural Analysis",
      materials: "Material Recommendations",
      report: "Structural Report"
    }[target] || "StructoX";
  });
});

// ── Upload ──
const fileInput  = document.getElementById("file-input");
const dropZone   = document.getElementById("drop-zone");
const previewWrap = document.getElementById("preview-wrap");
const previewOrig = document.getElementById("preview-orig");
const previewProcessed = document.getElementById("preview-processed");
const statusBar  = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const resultCard = document.getElementById("result-card");
const quickStats = document.getElementById("quick-stats");

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// Drag & Drop
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) {
    fileInput.files = e.dataTransfer.files;
    handleFile(file);
  }
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  // Show original preview
  const objUrl = URL.createObjectURL(file);
  previewOrig.src = objUrl;
  previewWrap.style.display = "flex";

  // Show status
  statusBar.style.display = "flex";
  statusText.textContent = "Uploading & analysing…";
  resultCard.style.display = "none";

  processImage(file);
}

async function processImage(file) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    statusText.textContent = "Detecting walls & rooms…";

    const response = await fetch("/process", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Server error");
    }

    const data = await response.json();

    statusText.textContent = "Rendering results…";

    // Show processed image
    previewProcessed.src = data.image_base64 || data.image_url;
    resultCard.style.display = "block";

    // Render quick stats
    renderQuickStats(data);

    // Render analysis + report sections
    renderAnalysis(data.analysis);
    renderReport(data.analysis);

    // Done
    statusBar.style.display = "none";

    // Auto-show result card on screen
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });

  } catch (err) {
    statusText.textContent = "❌ Error: " + err.message;
    console.error(err);
  }
}

// ── Quick Stats Panel ──
function renderQuickStats(data) {
  const a = data.analysis;
  quickStats.innerHTML = `
    ${statCard("Walls Detected", a.walls.total, "lines / segments", "#e76f3b")}
    ${statCard("Rooms Found", a.room_count, "enclosed spaces", "#3b82f6")}
    ${statCard("Junctions", a.corners_junctions, "corner points", "#22c55e")}
    ${statCard("Est. Openings", a.estimated_openings.count, "doors / windows", "#f59e0b")}
    ${statCard("Coverage", a.floor_coverage_pct + "%", "floor area ratio", "#8b5cf6")}
    ${a.walls.estimated_length_m
      ? statCard("Wall Length", a.walls.estimated_length_m + " m", "estimated total", "#ef4444")
      : ""}
  `;
}

function statCard(label, value, sub, color) {
  return `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value" style="color:${color}">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
}

// ── Analysis Section ──
function renderAnalysis(a) {
  const el = document.getElementById("analysis-content");
  if (!a) { el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>No data</p></div>`; return; }

  const walls = a.walls;
  const rooms = a.rooms;

  let roomRows = rooms.length
    ? rooms.map(r => `
        <tr>
          <td>R${r.id}</td>
          <td>${r.label}</td>
          <td>${r.width_px} × ${r.height_px} px</td>
          <td>${r.area_px.toLocaleString()} px²</td>
          <td>${r.aspect_ratio}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" style="text-align:center;color:#71717a">No distinct rooms detected</td></tr>`;

  el.innerHTML = `
    <div class="analysis-grid">
      <div class="analysis-block">
        <div class="analysis-block-title"><i class="fa-solid fa-wall-brick"></i> Wall Breakdown</div>
        <div class="analysis-row"><span class="label">Total segments</span><span class="val">${walls.total}</span></div>
        <div class="analysis-row"><span class="label">Horizontal</span><span class="val">${walls.horizontal}</span></div>
        <div class="analysis-row"><span class="label">Vertical</span><span class="val">${walls.vertical}</span></div>
        <div class="analysis-row"><span class="label">Diagonal</span><span class="val">${walls.diagonal}</span></div>
        <div class="analysis-row"><span class="label">Total length (px)</span><span class="val">${walls.total_length_px.toLocaleString()}</span></div>
        ${walls.estimated_length_m ? `<div class="analysis-row"><span class="label">Est. length (m)</span><span class="val">${walls.estimated_length_m}</span></div>` : ""}
      </div>

      <div class="analysis-block">
        <div class="analysis-block-title"><i class="fa-solid fa-border-all"></i> Space Overview</div>
        <div class="analysis-row"><span class="label">Rooms detected</span><span class="val">${a.room_count}</span></div>
        <div class="analysis-row"><span class="label">Junctions</span><span class="val">${a.corners_junctions}</span></div>
        <div class="analysis-row"><span class="label">Openings est.</span><span class="val">${a.estimated_openings.count}</span></div>
        <div class="analysis-row"><span class="label">Floor coverage</span><span class="val">${a.floor_coverage_pct}%</span></div>
        <div class="analysis-row"><span class="label">Image size</span><span class="val">${a.image_size.width}×${a.image_size.height}</span></div>
        ${a.pixels_per_meter_estimate ? `<div class="analysis-row"><span class="label">Scale (px/m est.)</span><span class="val">${a.pixels_per_meter_estimate}</span></div>` : ""}
      </div>
    </div>

    <div class="analysis-block">
      <div class="analysis-block-title"><i class="fa-solid fa-table"></i> Room Details</div>
      <div class="rooms-table-wrap">
        <table class="table">
          <thead>
            <tr><th>#</th><th>Label</th><th>Dimensions (px)</th><th>Area (px²)</th><th>Aspect</th></tr>
          </thead>
          <tbody>${roomRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Report Section ──
function renderReport(a) {
  const el = document.getElementById("report-content");
  if (!a) return;

  const now = new Date().toLocaleString("en-IN");
  const w = a.walls;

  el.innerHTML = `
    <div class="report-meta">
      <div class="report-meta-item">Generated: <span>${now}</span></div>
      <div class="report-meta-item">Image: <span>${a.image_size.width} × ${a.image_size.height} px</span></div>
      <div class="report-meta-item">Rooms: <span>${a.room_count}</span></div>
      <div class="report-meta-item">Walls: <span>${w.total}</span></div>
    </div>

    <div class="report-section">
      <h3>1. Executive Summary</h3>
      <p>
        StructoX AI analysed the uploaded floor plan and identified
        <strong>${w.total} wall segments</strong> (${w.horizontal} horizontal,
        ${w.vertical} vertical, ${w.diagonal} diagonal) and
        <strong>${a.room_count} enclosed room(s)</strong>.
        An estimated <strong>${a.estimated_openings.count} openings</strong>
        (doors/windows) were inferred from wall gap patterns.
        The total floor plan coverage ratio stands at <strong>${a.floor_coverage_pct}%</strong>.
      </p>
    </div>

    <div class="report-section">
      <h3>2. Structural Elements</h3>
      <p>
        The predominant wall orientation is
        <strong>${w.horizontal >= w.vertical ? "horizontal" : "vertical"}</strong>,
        suggesting a ${w.horizontal >= w.vertical ? "landscape" : "portrait"}-oriented plan.
        ${w.diagonal > 0 ? `${w.diagonal} diagonal segment(s) may indicate angled walls, bay windows, or staircase elements.` : "No significant diagonal walls detected."}
        ${w.estimated_length_m ? `Total estimated wall length is approximately <strong>${w.estimated_length_m} metres</strong> (heuristic scale).` : ""}
      </p>
    </div>

    <div class="report-section">
      <h3>3. Room Analysis</h3>
      <p>
        ${a.room_count === 0
          ? "No distinct enclosed rooms were detected. The plan may be a single open space, or the image contrast may need improvement."
          : `${a.room_count} room(s) were identified. ` +
            (a.rooms.map(r => `<em>Room R${r.id}</em> is classified as a <strong>${r.label}</strong>`).join("; ")) + "."
        }
      </p>
    </div>

    <div class="report-section">
      <h3>4. Recommendations</h3>
      <p>
        Based on detected wall count and room sizes, standard RCC framing is recommended.
        Load-bearing walls should use Red Brick (IS:1077) at 230mm thickness.
        Partition walls can use AAC blocks for weight reduction.
        Floor slabs should be RCC M25 at 125mm.
        Engage a licensed structural engineer for detailed sizing verification.
      </p>
    </div>

    <div class="report-section">
      <h3>5. Colour Legend (Annotated Image)</h3>
      <p>
        <span class="tag tag-yellow">Yellow</span> = Horizontal walls &nbsp;
        <span class="tag tag-orange">Orange</span> = Vertical walls &nbsp;
        <span class="tag tag-green">Green</span> = Diagonal walls &nbsp;
        <span class="tag tag-blue">Blue</span> = Room contours
      </p>
    </div>
  `;
}

// ── Voice Input ──
let recognition = null;
let listening = false;
const micBtn = document.getElementById("mic-btn");
const searchInput = document.getElementById("search-input");

micBtn.addEventListener("click", () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice recognition not supported in this browser."); return; }

  if (!recognition) {
    recognition = new SR();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = e => {
      searchInput.value = e.results[0][0].transcript;
    };
    recognition.onend = () => { listening = false; micBtn.classList.remove("listening"); };
    recognition.onerror = () => { listening = false; micBtn.classList.remove("listening"); };
  }

  if (listening) { recognition.stop(); return; }
  recognition.start();
  listening = true;
  micBtn.classList.add("listening");
});
