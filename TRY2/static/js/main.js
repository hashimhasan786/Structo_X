/* ══════════════════════════════════════════════════════════
   StructoX — main.js
   Handles: navigation, upload, pipeline progress,
   Stage 1–5 rendering, Three.js 3D viewer, voice input
   ══════════════════════════════════════════════════════════ */

"use strict";

// ── Navigation ─────────────────────────────────────────────────────────────
const tabTitles = {
  upload:   "Floor Plan Analyzer",
  parse:    "Stage 1 · Floor Plan Parser",
  geometry: "Stage 2 · Geometry Reconstruction",
  model3d:  "Stage 3 · 3D Structural Model",
  materials:"Stage 4 · Material Analysis",
  explain:  "Stage 5 · AI Explanation",
};

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${tab}`).classList.add("active");
    document.getElementById("topbar-title").textContent = tabTitles[tab] || "StructoX";
    if (tab === "model3d" && window._pendingModel) {
      build3DScene(window._pendingModel);
      window._pendingModel = null;
    }
  });
});

// ── Upload & Pipeline ───────────────────────────────────────────────────────
const fileInput  = document.getElementById("file-input");
const dropZone   = document.getElementById("drop-zone");
const uzInner    = document.getElementById("uz-inner");
const uzPreview  = document.getElementById("uz-preview");
const imgOrig    = document.getElementById("img-orig");
const btnRun     = document.getElementById("btn-run");
const progCard   = document.getElementById("progress-card");
const errBar     = document.getElementById("error-bar");
const errText    = document.getElementById("error-text");

let selectedFile = null;

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) showPreview(fileInput.files[0]);
});

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault(); dropZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) showPreview(e.dataTransfer.files[0]);
});

function showPreview(file) {
  selectedFile = file;
  imgOrig.src = URL.createObjectURL(file);
  uzInner.style.display  = "none";
  uzPreview.style.display = "flex";
}

btnRun.addEventListener("click", () => {
  if (selectedFile) runPipeline(selectedFile);
});

// ── Stage progress UI ───────────────────────────────────────────────────────
const STAGES = ["1","2","3","4","5"];

function setStage(n, state) { // state: 'spin' | 'done' | 'error'
  const dot = document.getElementById(`pgd-${n}`);
  const lbl = document.getElementById(`pg-s${n}`);
  const sdot = document.getElementById(`dot-${n}`);
  if (dot) { dot.className = "prog-dot " + state; }
  if (lbl) { lbl.className = "prog-stage " + (state === "done" ? "done" : state === "spin" ? "active" : ""); }
  if (sdot) { sdot.className = "ps-dot " + (state === "done" ? "done" : state === "spin" ? "active" : state === "error" ? "error" : ""); }
}

function resetProgress() {
  STAGES.forEach(n => setStage(n, ""));
  progCard.style.display = "flex";
  errBar.style.display   = "none";
}

async function runPipeline(file) {
  resetProgress();
  // Animate stages
  setStage("1","spin");

  const fd = new FormData();
  fd.append("file", file);

  try {
    const resp = await fetch("/process", { method: "POST", body: fd });
    const data = await resp.json();

    if (!data.success) {
      const s = data.stage || "?";
      const stageNum = {parsing:"1",geometry:"2","3d_model":"3",materials:"4",explainability:"5"}[s] || "1";
      setStage(stageNum, "error");
      errText.textContent = `Stage ${s}: ${data.error}`;
      errBar.style.display = "flex";
      return;
    }

    // Mark all done sequentially for visual effect
    for (let i = 1; i <= 5; i++) {
      setStage(String(i), "done");
      await sleep(120);
    }

    // Render all stages
    renderStage1(data);
    renderStage2(data);
    renderStage3(data);
    renderStage4(data);
    renderStage5(data);

    // Auto-navigate to stage 1
    setTimeout(() => document.querySelector('[data-tab="parse"]').click(), 300);

  } catch(e) {
    setStage("1","error");
    errText.textContent = "Network error: " + e.message;
    errBar.style.display = "flex";
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ══ Stage 1 Renderer ═════════════════════════════════════════════════════════
function renderStage1(data) {
  const s1 = data.stage1;
  const el = document.getElementById("parse-content");

  const ws = s1.wall_summary;
  const rooms = s1.rooms || [];
  const openings = s1.openings || [];

  const roomRows = rooms.slice(0,12).map(r => `
    <tr>
      <td style="font-family:var(--mono);color:var(--accent)">R${r.id}</td>
      <td>${r.label}</td>
      <td style="font-family:var(--mono)">${r.bbox.w}×${r.bbox.h}px</td>
      <td style="font-family:var(--mono)">${r.area_px.toLocaleString()}</td>
      <td style="font-family:var(--mono)">${r.aspect_ratio}</td>
    </tr>`).join("");

  el.innerHTML = `
    <div class="parse-grid">
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-image"></i> Annotated Plan</div>
        <div class="parse-image-wrap">
          <img src="${data.annotated_image_b64 || data.annotated_image_url}" alt="Annotated"/>
          <div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic">
            Yellow=Horizontal · Orange=Vertical · Green=Diagonal · Blue=Room contours · Cyan=Openings
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-chart-bar"></i> Detection Summary</div>
          <div class="kpi-grid">
            ${kpi(ws.total, "Total Walls", ws.horizontal+"H / "+ws.vertical+"V / "+ws.diagonal+"D", "var(--accent)")}
            ${kpi(s1.room_count, "Rooms", "enclosed regions", "var(--blue)")}
            ${kpi(s1.opening_count, "Openings", "doors & windows", "var(--green)")}
            ${kpi(s1.junction_count, "Junctions", "corners detected", "var(--yellow)")}
          </div>
          <div style="margin-top:8px;padding-top:12px;border-top:1px solid var(--border)">
            <div class="wall-bar"><span class="wb-label">Total wall length</span><span class="wb-val">${ws.total_length_m} m</span></div>
            <div class="wall-bar"><span class="wb-label">Image resolution</span><span class="wb-val">${s1.image_size.w}×${s1.image_size.h}px</span></div>
            <div class="wall-bar"><span class="wb-label">Scale estimate</span><span class="wb-val">${s1.scale.px_per_m} px/m</span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-title"><i class="fa-solid fa-border-all"></i> Wall Breakdown</div>
          <div class="wall-bar"><span class="wb-label">Horizontal</span><span class="wb-val">${ws.horizontal}</span><span class="wb-type wb-lb" style="background:rgba(0,200,255,.12);color:#0cc">H</span></div>
          <div class="wall-bar"><span class="wb-label">Vertical</span><span class="wb-val">${ws.vertical}</span><span class="wb-type wb-par" style="background:rgba(255,140,50,.12);color:var(--accent2)">V</span></div>
          <div class="wall-bar"><span class="wb-label">Diagonal</span><span class="wb-val">${ws.diagonal}</span><span class="wb-type" style="background:rgba(100,255,150,.1);color:var(--green)">D</span></div>
        </div>
      </div>
    </div>
    ${rooms.length ? `
    <div class="card">
      <div class="card-title"><i class="fa-solid fa-table"></i> Detected Rooms (${rooms.length})</div>
      <div style="overflow-x:auto">
        <table class="cost-table">
          <thead><tr><th>#</th><th>Label</th><th>Dimensions</th><th>Area (px²)</th><th>Aspect</th></tr></thead>
          <tbody>${roomRows}</tbody>
        </table>
      </div>
    </div>` : ""}
  `;
}

// ══ Stage 2 Renderer ═════════════════════════════════════════════════════════
function renderStage2(data) {
  const g = data.stage2;
  const el = document.getElementById("geometry-content");
  const concerns = g.structural_concerns || [];
  const spans = g.room_spans || [];

  const spanRows = spans.map(s => `
    <tr>
      <td style="font-family:var(--mono);color:var(--accent)">R${s.room_id}</td>
      <td>${s.room_label}</td>
      <td style="font-family:var(--mono)">${s.span_x_m}m × ${s.span_y_m}m</td>
      <td style="font-family:var(--mono);font-weight:600">${s.max_span_m}m</td>
      <td>${s.needs_steel ? '<span class="tag tag-red">Steel Required</span>' : s.needs_beam ? '<span class="tag tag-yellow">Beam Needed</span>' : '<span class="tag tag-green">OK</span>'}</td>
    </tr>`).join("");

  el.innerHTML = `
    <div class="geo-grid">
      ${kpiCard("Load-Bearing Walls", g.lb_count, "structural walls", "var(--accent)")}
      ${kpiCard("Partition Walls", g.partition_count, "non-structural", "var(--blue)")}
      ${kpiCard("Graph Nodes", g.node_count, "corners / junctions", "var(--green)")}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-diagram-project"></i> Wall Classification</div>
        ${(g.classified_walls||[]).slice(0,15).map(w => `
          <div class="wall-bar">
            <span class="wb-label" style="font-family:var(--mono);font-size:11.5px">W${w.id} · ${w.orientation} · ${w.length_m||0}m</span>
            <span class="wb-type ${w.load_bearing ? 'wb-lb' : 'wb-par'}">${w.wall_type === 'load_bearing' ? 'LB' : 'PAR'}</span>
          </div>`).join("")}
        ${(g.classified_walls||[]).length > 15 ? `<div style="font-size:11px;color:var(--text3);margin-top:8px">…and ${g.classified_walls.length - 15} more walls</div>` : ""}
      </div>
      <div class="card">
        <div class="card-title"><i class="fa-solid fa-triangle-exclamation"></i> Structural Concerns</div>
        ${concerns.length ? concerns.map(c => `
          <div class="concern-card">
            <i class="fa-solid fa-circle-exclamation"></i>
            <div>
              <div class="msg" style="font-weight:600;margin-bottom:3px">${c.label}</div>
              <div class="msg">${c.message}</div>
              <span class="concern-sev ${c.severity === 'HIGH' ? 'sev-high' : 'sev-medium'}" style="margin-top:6px;display:inline-block">${c.severity}</span>
            </div>
          </div>`).join("") : `<div style="color:var(--green);font-size:13px;padding:10px 0"><i class="fa-solid fa-circle-check"></i> No critical concerns detected.</div>`}
      </div>
    </div>
    ${spans.length ? `
    <div class="card">
      <div class="card-title"><i class="fa-solid fa-ruler-combined"></i> Room Span Analysis</div>
      <div style="overflow-x:auto">
        <table class="cost-table">
          <thead><tr><th>#</th><th>Room</th><th>Dimensions</th><th>Max Span</th><th>Status</th></tr></thead>
          <tbody>${spanRows}</tbody>
        </table>
      </div>
    </div>` : ""}
  `;
}

// ══ Stage 3 Renderer ═════════════════════════════════════════════════════════
function renderStage3(data) {
  const m = data.stage3;
  const el = document.getElementById("model3d-content");

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><i class="fa-solid fa-cube"></i> Interactive 3D Model</div>
      <div id="three-canvas-wrap"></div>
      <div class="three-legend">
        <div class="tl-item"><div class="tl-swatch" style="background:#c0392b"></div>Load-bearing walls</div>
        <div class="tl-item"><div class="tl-swatch" style="background:#7f8c8d"></div>Partition walls</div>
        <div class="tl-item"><div class="tl-swatch" style="background:#2c3e50"></div>Columns</div>
        <div class="tl-item"><div class="tl-swatch" style="background:#bdc3c7;opacity:.6"></div>Floor slab</div>
        <div class="tl-item"><div class="tl-swatch" style="background:#95a5a6;opacity:.5"></div>Roof slab</div>
      </div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:8px">
        <i class="fa-solid fa-mouse"></i> Left-drag to orbit · Scroll to zoom · Right-drag to pan
      </div>
    </div>
    <div class="model-stats">
      ${kpiCard("3D Objects", m.object_count, "total scene elements", "var(--accent)")}
      ${kpiCard("Wall Meshes", m.wall_count_3d, "LB + partition", "var(--blue)")}
      ${kpiCard("Columns", m.column_count, "at LB junctions", "var(--yellow)")}
      ${kpiCard("Floor Height", "3.0m", "standard extrusion", "var(--green)")}
    </div>
  `;

  // Build scene (may be deferred if tab inactive)
  if (document.getElementById("tab-model3d").classList.contains("active")) {
    build3DScene(m);
  } else {
    window._pendingModel = m;
  }
}

// ── Three.js scene ────────────────────────────────────────────────────────
function build3DScene(modelData) {
  const wrap = document.getElementById("three-canvas-wrap");
  if (!wrap) return;
  wrap.innerHTML = "";

  const W = wrap.clientWidth || 900;
  const H = wrap.clientHeight || 520;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x0a0c10);
  wrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0c10, 40, 120);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(20, 30, 20);
  dir.castShadow = true;
  scene.add(dir);

  const cfg = modelData.scene_config;
  const cam = new THREE.PerspectiveCamera(cfg.camera.fov, W / H, 0.1, 500);
  cam.position.set(...cfg.camera.position);
  cam.lookAt(...cfg.camera.target);

  // Grid
  const grid = new THREE.GridHelper(Math.max(cfg.plan_w_m, cfg.plan_d_m) * 2, 20, 0x1a2030, 0x1a2030);
  scene.add(grid);

  // Build objects
  for (const obj of modelData.objects) {
    const [sx, sy, sz] = obj.size;
    let geo;
    if (obj.type === "column") {
      geo = new THREE.BoxGeometry(sx, sy, sz);
    } else {
      geo = new THREE.BoxGeometry(sx, sy, sz);
    }

    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(obj.color),
      transparent: obj.opacity < 1,
      opacity: obj.opacity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...obj.position);
    if (obj.rotation_y) mesh.rotation.y = obj.rotation_y;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // Orbit controls (manual — no import needed)
  let isDragging = false, isRightDrag = false;
  let lastX = 0, lastY = 0;
  let theta = Math.PI / 4, phi = Math.PI / 3;
  let radius = Math.max(cfg.plan_w_m, cfg.plan_d_m) * 2;
  const target = new THREE.Vector3(...cfg.camera.target);

  function updateCamera() {
    cam.position.x = target.x + radius * Math.sin(phi) * Math.sin(theta);
    cam.position.y = target.y + radius * Math.cos(phi);
    cam.position.z = target.z + radius * Math.sin(phi) * Math.cos(theta);
    cam.lookAt(target);
  }
  updateCamera();

  renderer.domElement.addEventListener("mousedown", e => {
    isDragging = true;
    isRightDrag = e.button === 2;
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => isDragging = false);
  window.addEventListener("mousemove", e => {
    if (!isDragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (isRightDrag) {
      target.x -= dx * 0.02; target.z -= dy * 0.02;
    } else {
      theta -= dx * 0.008;
      phi = Math.max(0.1, Math.min(Math.PI * 0.48, phi - dy * 0.006));
    }
    updateCamera();
  });
  renderer.domElement.addEventListener("wheel", e => {
    radius = Math.max(1, radius + e.deltaY * 0.04);
    updateCamera();
    e.preventDefault();
  }, { passive: false });
  renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());

  // Render loop
  function animate() {
    if (!wrap.isConnected) return;
    requestAnimationFrame(animate);
    renderer.render(scene, cam);
  }
  animate();

  // Resize
  window.addEventListener("resize", () => {
    const nw = wrap.clientWidth, nh = wrap.clientHeight;
    renderer.setSize(nw, nh);
    cam.aspect = nw / nh;
    cam.updateProjectionMatrix();
  });
}

// ══ Stage 4 Renderer ═════════════════════════════════════════════════════════
function renderStage4(data) {
  const s4 = data.stage4;
  const el = document.getElementById("materials-content");
  const recs = s4.recommendations || {};
  const cost = s4.cost_summary || {};

  const icons = {
    load_bearing_wall: "fa-wall-brick",
    partition_wall:    "fa-border-all",
    floor_slab:        "fa-layer-group",
    column:            "fa-lines-leaning",
    roof_slab:         "fa-house-chimney",
    long_span_beam:    "fa-ruler-horizontal",
  };

  let html = "";

  for (const [key, rec] of Object.entries(recs)) {
    const opts = rec.ranked_options || [];
    const wp   = rec.weight_profile || {};
    const maxScore = Math.max(...opts.map(o => o.tradeoff_score), 0.01);

    const optHtml = opts.map((opt, idx) => {
      const pct = Math.max(5, Math.round((opt.tradeoff_score / maxScore) * 100));
      const fillClass = idx === 0 ? "" : (idx === 1 ? "rank2" : "rank3");
      return `
        <div class="mat-option">
          <div class="mat-rank">#${opt.rank} ${idx === 0 ? '— <span style="color:var(--accent)">Selected</span>' : ''}</div>
          <div class="mat-name">${opt.name}</div>
          <div class="mat-score-bar"><div class="mat-score-fill ${fillClass}" style="width:${pct}%"></div></div>
          <div class="mat-meta">
            Score: <span>${opt.tradeoff_score.toFixed(3)}</span><br/>
            Strength: <span>${opt.compressive_mpa} MPa</span><br/>
            Cost: <span>₹${opt.cost_inr_sqft || opt.cost_inr_rmt || "—"}/sqft</span><br/>
            Use: <span>${opt.best_use}</span>
          </div>
        </div>`;
    }).join("");

    html += `
      <div class="mat-element">
        <div class="mat-element-header">
          <div class="mat-el-name">
            <i class="fa-solid ${icons[key] || 'fa-cube'}" style="color:var(--accent)"></i>
            ${rec.element}
            ${rec.count > 0 ? `<span class="tag tag-blue" style="font-size:10px">${rec.count} detected</span>` : ""}
          </div>
          <div style="font-size:11.5px;color:var(--text2)">
            w<sub>S</sub>=${wp.strength} · w<sub>D</sub>=${wp.durability} · w<sub>C</sub>=${wp.cost}
          </div>
        </div>
        <div class="mat-options">${optHtml}</div>
        <div style="padding:12px 18px;font-size:12px;color:var(--text3);border-top:1px solid var(--border);font-style:italic">
          ${wp.rationale || ""}
        </div>
      </div>`;
  }

  // Cost breakdown
  const costRows = (cost.line_items || []).map(item => `
    <tr>
      <td>${item.item}</td>
      <td>${item.material}</td>
      <td style="font-family:var(--mono)">${item.qty}</td>
      <td style="font-family:var(--mono)">₹${item.cost_inr.toLocaleString("en-IN")}</td>
    </tr>`).join("");

  html += `
    <div class="card">
      <div class="card-title"><i class="fa-solid fa-indian-rupee-sign"></i> Estimated Cost Breakdown</div>
      <div style="overflow-x:auto">
        <table class="cost-table">
          <thead><tr><th>Item</th><th>Material</th><th>Quantity</th><th>Cost (₹)</th></tr></thead>
          <tbody>${costRows}</tbody>
        </table>
      </div>
    </div>`;

  el.innerHTML = html;
}

// ══ Stage 5 Renderer ═════════════════════════════════════════════════════════
function renderStage5(data) {
  const s5 = data.stage5;
  const el = document.getElementById("explain-content");
  if (!s5) { el.innerHTML = `<div class="empty-state"><p>Explanation not available</p></div>`; return; }

  const isLLM = s5.source === "claude-api";
  const matList = Array.isArray(s5.material_explanations)
    ? s5.material_explanations.map(m => `<li>${m}</li>`).join("")
    : `<li>${s5.material_explanations || "No data"}</li>`;

  const concList = Array.isArray(s5.structural_concerns)
    ? s5.structural_concerns.map(c => `<li>${c}</li>`).join("")
    : `<li>${s5.structural_concerns || "None"}</li>`;

  el.innerHTML = `
    <div class="card">
      <div class="${isLLM ? 'source-badge llm' : 'source-badge'}">
        <i class="fa-solid ${isLLM ? 'fa-brain' : 'fa-gear'}"></i>
        ${isLLM ? 'Generated by Claude AI (Anthropic)' : 'Rule-based generation'}
      </div>

      <div class="explain-section">
        <h3><i class="fa-solid fa-file-lines"></i> Executive Summary</h3>
        <p>${s5.summary || "—"}</p>
      </div>

      <div class="explain-section">
        <h3><i class="fa-solid fa-cubes"></i> Material Justifications</h3>
        <ul>${matList}</ul>
      </div>

      <div class="explain-section">
        <h3><i class="fa-solid fa-triangle-exclamation"></i> Structural Concerns</h3>
        <ul>${concList}</ul>
      </div>

      <div class="explain-section">
        <h3><i class="fa-solid fa-balance-scale"></i> Cost–Strength Tradeoff Logic</h3>
        <p>${s5.tradeoff_logic || "—"}</p>
      </div>
    </div>
  `;
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function kpi(val, label, sub, color) {
  return `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-val" style="color:${color}">${val}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
}

function kpiCard(label, val, sub, color) {
  return `
    <div class="card" style="text-align:center;padding:16px">
      <div class="kpi-label">${label}</div>
      <div class="kpi-val" style="color:${color};font-size:28px">${val}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
}

// ── Voice Input ─────────────────────────────────────────────────────────────
let recognition = null, listening = false;
const micBtn      = document.getElementById("mic-btn");
const searchInput = document.getElementById("search-input");

micBtn.addEventListener("click", () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice recognition not supported."); return; }
  if (!recognition) {
    recognition = new SR();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.onresult = e => { searchInput.value = e.results[0][0].transcript; };
    recognition.onend = () => { listening = false; micBtn.classList.remove("listening"); };
    recognition.onerror = () => { listening = false; micBtn.classList.remove("listening"); };
  }
  if (listening) { recognition.stop(); return; }
  recognition.start();
  listening = true;
  micBtn.classList.add("listening");
});
