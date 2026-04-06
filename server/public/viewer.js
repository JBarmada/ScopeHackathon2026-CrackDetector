// ============================================================
// Autodesk Crack Inspector — Frontend Controller
// ============================================================

let viewer = null;
let crackOverlay = null;
let currentMode = 'viewer'; // 'viewer' or 'canvas'
let modelIsLoaded = false; // true only after a 3D model is loaded in the viewer
let currentModelName = null; // name of the currently loaded model

// --- DOM Elements ---
const viewerContainer = document.getElementById('viewer-container');
const photoCanvas = document.getElementById('photo-canvas');
const ctx = photoCanvas.getContext('2d');

const modelFileInput = document.getElementById('model-file');
const uploadModelBtn = document.getElementById('upload-model-btn');
const modelStatus = document.getElementById('model-status');
const modelSelect = document.getElementById('model-select');
const loadModelBtn = document.getElementById('load-model-btn');
const deleteModelBtn = document.getElementById('delete-model-btn');
const refreshModelsBtn = document.getElementById('refresh-models-btn');

const photoFileInput = document.getElementById('photo-file');
const detectBtn = document.getElementById('detect-btn');
const confidenceSlider = document.getElementById('confidence-slider');
const confidenceVal = document.getElementById('confidence-val');
const detectStatus = document.getElementById('detect-status');
const resultsPanel = document.getElementById('results-panel');
const resultsList = document.getElementById('results-list');
const clearOverlaysBtn = document.getElementById('clear-overlays-btn');
const scanViewBtn = document.getElementById('scan-view-btn');
const unloadModelBtn = document.getElementById('unload-model-btn');

// New feature DOM refs
const drawModeBtn    = document.getElementById('draw-mode-btn');
const drawModeHint   = document.getElementById('draw-mode-hint');
const drawCanvas     = document.getElementById('draw-canvas');
const evaluateBtn    = document.getElementById('evaluate-btn');
const dangerInfoBtn  = document.getElementById('danger-info-btn');
const calibrateBtn   = document.getElementById('calibrate-btn');
const syncAPSCalBtn  = document.getElementById('sync-aps-cal-btn');
const measureDepthBtn= document.getElementById('measure-depth-btn');
const measureStatus  = document.getElementById('measure-status');
const depthResult    = document.getElementById('depth-result');
const depthValue     = document.getElementById('depth-value');
const resultsCount   = document.getElementById('results-count');

// ============================================================
// Part A: APS Viewer Initialization
// ============================================================

async function getAccessToken(callback) {
  try {
    const resp = await fetch('/api/auth/token');
    const data = await resp.json();
    callback(data.access_token, 3600);
  } catch (err) {
    console.error('Auth error:', err);
    setStatus(modelStatus, 'Auth failed — check APS credentials', 'error');
  }
}

function initViewer() {
  return new Promise((resolve, reject) => {
    if (typeof Autodesk === 'undefined') {
      // APS Viewer SDK not loaded — show canvas mode only
      console.warn('APS Viewer SDK not available. Canvas-only mode.');
      viewerContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#a0a0c0;"><p>APS Viewer not loaded.<br>Upload a photo for 2D crack detection.</p></div>';
      resolve(null);
      return;
    }

    Autodesk.Viewing.Initializer({ getAccessToken }, () => {
      viewer = new Autodesk.Viewing.GuiViewer3D(viewerContainer);
      const startResult = viewer.start();
      if (startResult > 0) {
        reject(new Error('Viewer failed to start'));
        return;
      }

      // Create overlay div directly — no extension needed
      crackOverlay = createOverlay();
      resolve(viewer);
    });
  });
}

function loadModel(urn) {
  return new Promise((resolve, reject) => {
    if (!viewer) {
      reject(new Error('Viewer not initialized'));
      return;
    }

    switchToViewer();

    // Clear previous overlays and detections before loading new model
    if (crackOverlay) crackOverlay.clearDetections();
    currentDetections = [];
    if (typeof showResults === 'function' && resultsPanel) {
      resultsPanel.classList.add('hidden');
      resultsList.innerHTML = '';
      if (resultsCount) resultsCount.textContent = '';
    }

    Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      (doc) => {
        const defaultModel = doc.getRoot().getDefaultGeometry();
        viewer.loadDocumentNode(doc, defaultModel);
        modelIsLoaded = true;
        unloadModelBtn.disabled = false;
        document.dispatchEvent(new Event('modelLoaded'));
        // Track the model name from the dropdown, or fall back to URN suffix
        const selectedOpt = modelSelect.options[modelSelect.selectedIndex];
        currentModelName = (selectedOpt && selectedOpt.dataset.objectKey)
          ? selectedOpt.dataset.objectKey
          : urn.slice(-12);
        resolve();
      },
      (errorCode, errorMsg) => {
        reject(new Error(`Document load error ${errorCode}: ${errorMsg}`));
      },
    );
  });
}

// ============================================================
// Part B: Crack Overlay (plain div, no extension)
// ============================================================

function createOverlay() {
  const container = document.createElement('div');
  container.id = 'crack-overlay';
  container.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99;';
  viewerContainer.appendChild(container);

  return {
    showDetections(detections, imgWidth, imgHeight) {
      container.innerHTML = '';
      const rect = viewerContainer.getBoundingClientRect();
      const scaleX = rect.width / imgWidth;
      const scaleY = rect.height / imgHeight;

      detections.forEach((det) => {
        const [x1, y1, x2, y2] = det.bbox;
        const severity = det.confidence > 0.7 ? 'high' : det.confidence > 0.4 ? 'medium' : 'low';
        const color = severity === 'high' ? '255,48,48' : severity === 'medium' ? '255,170,0' : '48,255,48';

        const box = document.createElement('div');
        box.className = `detection-box ${severity}`;
        box.style.left = `${x1 * scaleX}px`;
        box.style.top = `${y1 * scaleY}px`;
        box.style.width = `${(x2 - x1) * scaleX}px`;
        box.style.height = `${(y2 - y1) * scaleY}px`;

        const label = document.createElement('div');
        label.className = 'detection-label';
        label.textContent = `${det.class} ${(det.confidence * 100).toFixed(0)}%`;
        box.appendChild(label);
        container.appendChild(box);

        if (det.mask_polygon && det.mask_polygon.length > 2) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
          svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

          const points = det.mask_polygon.map(([px, py]) => `${px * scaleX},${py * scaleY}`).join(' ');
          const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          polygon.setAttribute('points', points);
          polygon.setAttribute('fill', `rgba(${color},0.2)`);
          polygon.setAttribute('stroke', `rgba(${color},0.8)`);
          polygon.setAttribute('stroke-width', '2');
          svg.appendChild(polygon);
          container.appendChild(svg);
        }
      });
    },

    clearDetections() {
      container.innerHTML = '';
    },
  };
}

// ============================================================
// Part C: 2D Canvas Fallback
// ============================================================

let currentPhoto = null;
let canvasDetections = [];

function switchToCanvas() {
  currentMode = 'canvas';
  viewerContainer.classList.add('hidden');
  photoCanvas.classList.remove('hidden');
}

function switchToViewer() {
  currentMode = 'viewer';
  photoCanvas.classList.add('hidden');
  viewerContainer.classList.remove('hidden');
}

function drawPhotoWithDetections(img, detections) {
  switchToCanvas();

  const mainArea = document.getElementById('main-area');
  photoCanvas.width = mainArea.clientWidth;
  photoCanvas.height = mainArea.clientHeight;

  // Scale image to fit canvas while maintaining aspect ratio
  const scale = Math.min(
    photoCanvas.width / img.width,
    photoCanvas.height / img.height,
  );
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const offsetX = (photoCanvas.width - drawW) / 2;
  const offsetY = (photoCanvas.height - drawH) / 2;

  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  detections.forEach((det) => {
    const [x1, y1, x2, y2] = det.bbox;
    const severity = det.confidence > 0.7 ? 'high' : det.confidence > 0.4 ? 'medium' : 'low';
    const color = severity === 'high' ? '#ff3030' : severity === 'medium' ? '#ffaa00' : '#30ff30';

    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      offsetX + x1 * scale,
      offsetY + y1 * scale,
      (x2 - x1) * scale,
      (y2 - y1) * scale,
    );

    // Draw mask polygon
    if (det.mask_polygon && det.mask_polygon.length > 2) {
      ctx.beginPath();
      det.mask_polygon.forEach(([px, py], i) => {
        const cx = offsetX + px * scale;
        const cy = offsetY + py * scale;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.fillStyle = color.replace('#', 'rgba(') === color
        ? `${color}33`
        : hexToRgba(color, 0.15);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw label — flip inside box if too close to top edge
    const label = `${det.class} ${(det.confidence * 100).toFixed(0)}%`;
    ctx.font = 'bold 13px sans-serif';
    const textW = ctx.measureText(label).width;
    const labelX = offsetX + x1 * scale;
    const boxTop = offsetY + y1 * scale;
    const labelY = boxTop < 20 ? boxTop + 18 : boxTop - 2;
    ctx.fillStyle = color;
    ctx.fillRect(labelX, labelY - 16, textW + 8, 18);
    ctx.fillStyle = severity === 'high' ? '#fff' : '#000';
    ctx.fillText(label, labelX + 4, labelY);
  });
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============================================================
// Part D: UI Wiring
// ============================================================

function setStatus(el, message, type = 'info') {
  el.textContent = message;
  el.className = `status ${type}`;
}

// Global detections store (shared between AI and manual detections)
let currentDetections = [];

function showResults(detections) {
  currentDetections = detections;
  resultsPanel.classList.remove('hidden');
  resultsList.innerHTML = '';
  if (resultsCount) resultsCount.textContent = detections.length;

  if (detections.length === 0) {
    resultsList.innerHTML = '<div class="result-item">No defects detected</div>';
    return;
  }
  detections.forEach((det, i) => {
    const severity = det.confidence > 0.7 ? 'high' : det.confidence > 0.4 ? 'medium' : 'low';
    const item = document.createElement('div');
    item.className = 'result-item';
    item.dataset.index = i;
    item.innerHTML = `
      <span>#${i + 1} ${det.class}${det.manual ? ' ✏️' : ''}</span>
      <span class="conf ${severity}">${det.manual ? 'manual' : (det.confidence * 100).toFixed(1) + '%'}</span>
    `;
    item.addEventListener('click', () => openEvalModal(i));
    resultsList.appendChild(item);
  });
}

// --- Model Upload ---
modelFileInput.addEventListener('change', () => {
  uploadModelBtn.disabled = !modelFileInput.files.length;
});

uploadModelBtn.addEventListener('click', async () => {
  const file = modelFileInput.files[0];
  if (!file) return;

  uploadModelBtn.disabled = true;
  setStatus(modelStatus, 'Uploading...', 'info');

  try {
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch('/api/models/upload', { method: 'POST', body: formData });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Upload failed');

    setStatus(modelStatus, 'Translating model...', 'info');
    pollTranslation(data.urn);
  } catch (err) {
    setStatus(modelStatus, err.message, 'error');
    uploadModelBtn.disabled = false;
  }
});

const CRACK_JOKES = [
  "Analyzing your crack... professionally, of course.",
  "Finding cracks so you don't fall through them.",
  "Every crack tells a story. Let's read yours.",
  "Crack detection in progress... no, not that kind.",
  "Inspecting the situation... it's getting pretty deep.",
  "Your model is being thoroughly examined by Jad.",
  "We've seen worse cracks. Maybe.",
  "Processing... this might take a minute. Go touch grass.",
  "Running AI on your structure. The building is nervous.",
  "Translating model... Jad is on the case.",
];

async function pollTranslation(urn) {
  let jokeIndex = 0;
  const poll = setInterval(async () => {
    try {
      const resp = await fetch(`/api/models/${encodeURIComponent(urn)}/status`);
      const data = await resp.json();

      if (data.status === 'success') {
        clearInterval(poll);
        setStatus(modelStatus, 'Translation complete! Loading model...', 'success');
        uploadModelBtn.disabled = false;
        refreshModelList();
        await loadModel(urn);
      } else if (data.status === 'failed') {
        clearInterval(poll);
        setStatus(modelStatus, 'Translation failed', 'error');
        uploadModelBtn.disabled = false;
      } else {
        const joke = CRACK_JOKES[jokeIndex % CRACK_JOKES.length];
        jokeIndex++;
        setStatus(modelStatus, `⏳ ${joke} ${data.progress ? `(${data.progress})` : ''}`, 'info');
      }
    } catch (err) {
      clearInterval(poll);
      setStatus(modelStatus, `Poll error: ${err.message}`, 'error');
      uploadModelBtn.disabled = false;
    }
  }, 5000);
}

// --- Model List ---
async function refreshModelList() {
  try {
    const resp = await fetch('/api/models');
    const models = await resp.json();
    modelSelect.innerHTML = '<option value="">-- Select a model --</option>';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.urn;
      opt.dataset.objectKey = m.name;
      opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to refresh models:', err);
  }
}

modelSelect.addEventListener('change', () => {
  loadModelBtn.disabled = !modelSelect.value;
  deleteModelBtn.disabled = !modelSelect.value;
});

loadModelBtn.addEventListener('click', async () => {
  const urn = modelSelect.value;
  if (!urn) return;
  try {
    setStatus(modelStatus, 'Loading model...', 'info');
    await loadModel(urn);
    setStatus(modelStatus, 'Model loaded', 'success');
  } catch (err) {
    setStatus(modelStatus, err.message, 'error');
  }
});

refreshModelsBtn.addEventListener('click', refreshModelList);

deleteModelBtn.addEventListener('click', async () => {
  const selected = modelSelect.options[modelSelect.selectedIndex];
  if (!selected || !selected.value) return;

  const objectKey = selected.dataset.objectKey;
  if (!confirm(`Delete "${objectKey}"? This cannot be undone.`)) return;

  deleteModelBtn.disabled = true;
  setStatus(modelStatus, 'Deleting...', 'info');
  try {
    const resp = await fetch(`/api/models/${encodeURIComponent(objectKey)}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Delete failed');
    setStatus(modelStatus, 'Deleted.', 'success');
    await refreshModelList();
  } catch (err) {
    setStatus(modelStatus, err.message, 'error');
    deleteModelBtn.disabled = false;
  }
});

// --- Crack Detection ---
photoFileInput.addEventListener('change', () => {
  detectBtn.disabled = !photoFileInput.files.length;
});

confidenceSlider.addEventListener('input', () => {
  confidenceVal.textContent = confidenceSlider.value;
});

const MAX_IMG_SIZE = 1280;

function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMG_SIZE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((blob) => {
        const resizedImg = new Image();
        resizedImg.onload = () => resolve({ blob, img: resizedImg });
        resizedImg.src = URL.createObjectURL(blob);
      }, 'image/jpeg', 0.92);
    };
    img.src = URL.createObjectURL(file);
  });
}

detectBtn.addEventListener('click', async () => {
  const file = photoFileInput.files[0];
  if (!file) return;

  detectBtn.disabled = true;
  setStatus(detectStatus, 'Analyzing image...', 'info');

  try {
    const { blob, img: resizedImg } = await resizeImage(file);
    const formData = new FormData();
    formData.append('file', blob, file.name);

    const confidence = confidenceSlider.value;
    const resp = await fetch(`/api/inspect/detect?confidence=${confidence}`, {
      method: 'POST',
      body: formData,
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Detection failed');

    const count = data.detections.length;
    setStatus(detectStatus, `Found ${count} defect${count !== 1 ? 's' : ''}`, 'success');
    showResults(data.detections);
    saveInspectionEntry(data.detections);

    currentPhoto = resizedImg;
    canvasDetections = data.detections;

    if (viewer && modelIsLoaded && crackOverlay) {
      crackOverlay.showDetections(data.detections, data.image_width, data.image_height);
    } else {
      console.log('Canvas fallback — viewer:', !!viewer, 'modelLoaded:', modelIsLoaded, 'overlay:', !!crackOverlay);
      drawPhotoWithDetections(resizedImg, data.detections);
    }
  } catch (err) {
    setStatus(detectStatus, err.message, 'error');
  } finally {
    detectBtn.disabled = false;
  }
});

// --- Clear Overlays ---
clearOverlaysBtn.addEventListener('click', () => {
  if (crackOverlay) crackOverlay.clearDetections();

  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  resultsPanel.classList.add('hidden');
  resultsList.innerHTML = '';
  setStatus(detectStatus, '', 'info');
  canvasDetections = [];
  currentPhoto = null;

  if (!viewer) {
    switchToViewer();
  }
});

// --- Unload Model ---
unloadModelBtn.addEventListener('click', () => {
  if (viewer) {
    viewer.unloadModel(viewer.model);
  }
  modelIsLoaded = false;
  currentModelName = null;
  unloadModelBtn.disabled  = true;
  calibrateBtn.disabled    = true;
  syncAPSCalBtn.disabled   = true;
  measureDepthBtn.disabled = true;
  if (crackOverlay) crackOverlay.clearDetections();
  currentDetections = [];
  resultsPanel.classList.add('hidden');
  resultsList.innerHTML = '';
  if (resultsCount) resultsCount.textContent = '';
  setStatus(modelStatus, 'Model unloaded', 'info');
  // Switch to canvas/photo mode
  switchToCanvas();
  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
});

// --- Scan Current View ---
function enhanceCanvasForML(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx2 = out.getContext('2d');

  // Draw original
  ctx2.drawImage(sourceCanvas, 0, 0);

  // Boost contrast + brightness to match real photo appearance
  // filter: contrast makes cracks stand out more against the surface
  ctx2.filter = 'contrast(160%) brightness(95%) saturate(80%)';
  ctx2.drawImage(sourceCanvas, 0, 0);
  ctx2.filter = 'none';

  return out;
}

scanViewBtn.addEventListener('click', async () => {
  if (!viewer || !modelIsLoaded) {
    setStatus(detectStatus, 'Load a 3D model first', 'error');
    return;
  }

  scanViewBtn.disabled = true;
  setStatus(detectStatus, 'Capturing view...', 'info');

  try {
    const rawCanvas = viewerContainer.querySelector('canvas.lmv-webgl-canvas')
      || viewerContainer.querySelector('canvas');

    if (!rawCanvas) throw new Error('Could not find viewer canvas');

    // Enhance contrast before sending to ML
    const enhanced = enhanceCanvasForML(rawCanvas);
    const blob = await new Promise((resolve) => enhanced.toBlob(resolve, 'image/jpeg', 0.95));
    const formData = new FormData();
    formData.append('file', blob, 'viewer-snapshot.jpg');

    setStatus(detectStatus, 'Analyzing view...', 'info');
    // Use lower confidence threshold for rendered views vs real photos
    const confidence = Math.min(parseFloat(confidenceSlider.value), 0.15);
    const resp = await fetch(`/api/inspect/detect?confidence=${confidence}`, {
      method: 'POST',
      body: formData,
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Detection failed');

    const count = data.detections.length;
    setStatus(detectStatus, `Found ${count} defect${count !== 1 ? 's' : ''}`, count > 0 ? 'success' : 'info');
    showResults(data.detections);
    saveInspectionEntry(data.detections);

    if (crackOverlay) {
      crackOverlay.showDetections(data.detections, data.image_width, data.image_height);
    }
  } catch (err) {
    setStatus(detectStatus, err.message, 'error');
  } finally {
    scanViewBtn.disabled = false;
  }
});

// ============================================================
// Help Modal
// ============================================================

const helpBtn = document.getElementById('help-btn');
const helpModal = document.getElementById('help-modal');
const helpClose = document.getElementById('help-close');

helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
helpClose.addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.add('hidden'); });

// ============================================================
// 30-Day Inspection Log
// ============================================================

const STORAGE_KEY = 'crack_inspector_log';

function saveInspectionEntry(detections) {
  const log = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  log.push({
    timestamp: Date.now(),
    model: currentModelName || 'No model (photo only)',
    count: detections.length,
    detections: detections.map((d) => ({
      class: d.class,
      confidence: d.confidence,
    })),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

function renderReport(filterModel = 'all') {
  const log = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const content = document.getElementById('report-content');

  if (log.length === 0) {
    content.innerHTML = '<p style="color:#a0a0c0;text-align:center;padding:20px">No inspections recorded yet.<br>Run a detection to start tracking!</p>';
    return;
  }

  // Build model filter dropdown
  const allModels = [...new Set(log.map((e) => e.model || 'No model (photo only)'))];
  const filterHtml = `
    <div style="margin-bottom:14px">
      <label style="font-size:0.8rem;color:#a0a0c0;display:block;margin-bottom:4px">Filter by model:</label>
      <select id="report-filter" style="width:100%;padding:6px 8px;background:#0f3460;color:#e0e0e0;border:1px solid #533483;border-radius:4px;font-size:0.85rem">
        <option value="all" ${filterModel === 'all' ? 'selected' : ''}>All models</option>
        ${allModels.map((m) => `<option value="${m}" ${filterModel === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
  `;

  // Apply filter
  const filtered = filterModel === 'all' ? log : log.filter((e) => (e.model || 'No model (photo only)') === filterModel);

  if (filtered.length === 0) {
    content.innerHTML = filterHtml + '<p style="color:#a0a0c0;text-align:center;padding:20px">No scans for this model yet.</p>';
    document.getElementById('report-filter').addEventListener('change', (e) => renderReport(e.target.value));
    return;
  }

  const startDate = new Date(log[0].timestamp);
  const totalDefects = filtered.reduce((sum, e) => sum + e.count, 0);
  const totalScans = filtered.length;

  const summary = `
    <div style="display:flex;gap:12px;margin-bottom:16px">
      <div style="flex:1;background:#1a1a2e;border-radius:8px;padding:12px;text-align:center;border:1px solid #0f3460">
        <div style="font-size:1.6rem;font-weight:bold;color:#e94560">${totalScans}</div>
        <div style="font-size:0.75rem;color:#a0a0c0">Scans</div>
      </div>
      <div style="flex:1;background:#1a1a2e;border-radius:8px;padding:12px;text-align:center;border:1px solid #0f3460">
        <div style="font-size:1.6rem;font-weight:bold;color:#ff3030">${totalDefects}</div>
        <div style="font-size:0.75rem;color:#a0a0c0">Defects</div>
      </div>
      <div style="flex:1;background:#1a1a2e;border-radius:8px;padding:12px;text-align:center;border:1px solid #0f3460">
        <div style="font-size:1.6rem;font-weight:bold;color:#ffaa00">${Math.ceil((Date.now() - startDate) / 86400000)}</div>
        <div style="font-size:0.75rem;color:#a0a0c0">Days Active</div>
      </div>
    </div>
  `;

  const entries = [...filtered].reverse().map((entry) => {
    const date = new Date(entry.timestamp);
    const dayNum = Math.floor((date - startDate) / 86400000) + 1;
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const countClass = entry.count === 0 ? 'zero' : entry.count <= 2 ? 'low' : 'high';
    const modelTag = filterModel === 'all'
      ? `<span style="font-size:0.7rem;color:#533483;margin-left:6px">${entry.model || 'photo only'}</span>`
      : '';
    return `
      <div class="report-day">
        <div class="report-date">Day ${dayNum} — ${dateStr} at ${timeStr}${modelTag}</div>
        <div class="report-count ${countClass}">
          ${entry.count === 0 ? 'No defects found' : `${entry.count} defect${entry.count !== 1 ? 's' : ''} detected`}
        </div>
      </div>
    `;
  }).join('');

  content.innerHTML = filterHtml + summary + entries;
  document.getElementById('report-filter').addEventListener('change', (e) => renderReport(e.target.value));
}

const reportBtn = document.getElementById('report-btn');
const reportModal = document.getElementById('report-modal');
const reportClose = document.getElementById('report-close');
const reportClearBtn = document.getElementById('report-clear-btn');

reportBtn.addEventListener('click', () => {
  renderReport();
  reportModal.classList.remove('hidden');
});
reportClose.addEventListener('click', () => reportModal.classList.add('hidden'));
reportModal.addEventListener('click', (e) => { if (e.target === reportModal) reportModal.classList.add('hidden'); });
reportClearBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  renderReport();
});

// ============================================================
// APS Measurement — Calibration & Depth
// ============================================================

let mmPerPx = null;          // calibration: real-world mm per screen pixel
let lastMeasuredDepth = null; // last depth measurement in mm from hitTest
let measureMode = null;       // 'calibrate' | 'depth' | null
let measurePoints = [];       // collected {x,y,world} points for current measure op

function enableMeasureButtons() {
  if (viewer && modelIsLoaded) {
    calibrateBtn.disabled   = false;
    syncAPSCalBtn.disabled  = false;
    measureDepthBtn.disabled= false;
  }
}

// ---- APS Measure Extension + Auto-Scale ----

let _measureExt = null;

async function loadAndSyncMeasureExtension() {
  if (!viewer) return;
  try {
    _measureExt = await viewer.loadExtension('Autodesk.Measure');
    console.log('[CrackJad] Autodesk.Measure loaded');
  } catch (e) {
    console.warn('[CrackJad] Autodesk.Measure load failed (non-fatal):', e);
  }

  // --- Primary calibration: model unit scale + hitTest (no user action needed) ---
  autoComputeScale(false);

  // Re-compute silently after camera stops moving (debounced — do NOT run mid-rotation)
  let _camDebounce = null;
  viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => {
    clearTimeout(_camDebounce);
    _camDebounce = setTimeout(() => autoComputeScale(true), 600);
  });

  // Listen for APS measurement/calibration events (multiple names for version compat)
  const onMeasureEvent = () => setTimeout(() => {
    if (!syncFromExtProps(_measureExt)) autoComputeScale(false);
  }, 500);

  viewer.addEventListener(Autodesk.Viewing.TOOL_CHANGE_EVENT, onMeasureEvent);
  if (_measureExt && typeof _measureExt.addEventListener === 'function') {
    for (const evt of ['calibration-factor-changed', 'calibrationChanged', 'measurement-changed']) {
      try { _measureExt.addEventListener(evt, onMeasureEvent); } catch (_) {}
    }
  }

  // Wire the Sync button
  const syncBtn = document.getElementById('sync-aps-cal-btn');
  if (syncBtn) {
    syncBtn.disabled = false;
    syncBtn.addEventListener('click', () => {
      // Try APS ext props first; fall back to model-unit auto-compute
      if (!syncFromExtProps(_measureExt)) autoComputeScale(false);
    });
  }
}

// PRIMARY: derive mm/px from viewer.model.getUnitScale() + hitTest
// Works for any properly-exported CAD file (RVT, IFC, DWG, GLB, OBJ, STP)
// with no user action required.
function autoComputeScale(silent = false) {
  if (!viewer || !viewer.model) return false;
  try {
    const metersPerModelUnit = viewer.model.getUnitScale();
    if (!metersPerModelUnit || metersPerModelUnit <= 0) return false;
    const mmPerModelUnit = metersPerModelUnit * 1000;

    const vpW = viewer.container.clientWidth;
    const vpH = viewer.container.clientHeight;

    // Try hitTest at 6 locations; stop at first pair that hits geometry
    const OFFSET = 10;
    const spots = [
      [vpW*0.50, vpH*0.50], [vpW*0.40, vpH*0.50], [vpW*0.60, vpH*0.50],
      [vpW*0.50, vpH*0.40], [vpW*0.50, vpH*0.60], [vpW*0.35, vpH*0.35],
    ];
    let modelUnitsPerPx = null;
    for (const [cx, cy] of spots) {
      const h1 = viewer.impl.hitTest(cx,          cy, false);
      const h2 = viewer.impl.hitTest(cx + OFFSET,  cy, false);
      if (h1?.point && h2?.point) {
        const dx = h2.point.x - h1.point.x;
        const dy = h2.point.y - h1.point.y;
        const dz = h2.point.z - h1.point.z;
        const d  = Math.sqrt(dx*dx + dy*dy + dz*dz) / OFFSET;
        if (d > 0) { modelUnitsPerPx = d; break; }
      }
    }

    // Fallback: project model bbox centre through camera
    if (!modelUnitsPerPx) {
      const bbox = viewer.model.getBoundingBox?.();
      const origin = bbox
        ? bbox.getCenter(new THREE.Vector3())
        : new THREE.Vector3(0, 0, 0);
      const cam = viewer.impl.camera;
      const s1 = origin.clone().project(cam);
      const s2 = origin.clone().add(new THREE.Vector3(1, 0, 0)).project(cam);
      const pxPerUnit = Math.abs(s2.x - s1.x) * vpW / 2;
      if (pxPerUnit > 0) modelUnitsPerPx = 1 / pxPerUnit;
    }

    if (!modelUnitsPerPx || modelUnitsPerPx <= 0) return false;

    mmPerPx = modelUnitsPerPx * mmPerModelUnit;

    if (!silent) {
      const displayUnit = viewer.model.getDisplayUnit?.() || 'model units';
      const calStatus = document.getElementById('calibration-status');
      if (calStatus) {
        calStatus.textContent = `✅ Auto (${displayUnit}): 1px ≈ ${mmPerPx.toFixed(3)} mm`;
        calStatus.className = 'status success';
      }
      console.log(`[CrackJad] Auto-scale: ${mmPerPx.toFixed(4)} mm/px  ` +
        `(getUnitScale=${metersPerModelUnit}, mmPerModelUnit=${mmPerModelUnit.toFixed(4)})`);
    }
    return true;
  } catch (e) {
    console.warn('[CrackJad] autoComputeScale error:', e);
    return false;
  }
}

// SECONDARY: read calibrationFactor from Autodesk.Measure extension properties.
// Dumps ALL calibration-related props to console so we can see what APS exposes.
function syncFromExtProps(ext) {
  try {
    if (!ext) return false;

    // Deep-scan the ext object and its children for anything calibration-related
    const dump = {};
    const scan = (obj, label) => {
      if (!obj || typeof obj !== 'object') return;
      try {
        for (const k of Object.getOwnPropertyNames(obj)) {
          if (/calib|factor|unit/i.test(k)) dump[`${label}.${k}`] = obj[k];
        }
      } catch (_) {}
    };
    scan(ext,              'ext');
    scan(ext.measureTool,  'ext.measureTool');
    scan(ext._measureTool, 'ext._measureTool');
    scan(ext.tool,         'ext.tool');
    console.log('[CrackJad] Measure ext calibration dump:', dump);

    // Probe every plausible path
    const factorPaths = [
      ext.calibrationFactor,
      ext._calibrationFactor,
      ext.measureTool?.calibrationFactor,
      ext.measureTool?._calibrationFactor,
      ext._measureTool?.calibrationFactor,
      ext.tool?.calibrationFactor,
      ext.calibration?.factor,
    ];
    let factor = null;
    for (const v of factorPaths) {
      if (v != null && v !== 0 && typeof v === 'number') { factor = v; break; }
    }

    const unitPaths = [
      ext.calibrationUnits,        ext._calibrationUnits,
      ext.measureTool?.calibrationUnits, ext._measureTool?.calibrationUnits,
    ];
    let units = 'mm';
    for (const v of unitPaths) {
      if (v && typeof v === 'string') { units = v; break; }
    }

    console.log(`[CrackJad] calibrationFactor resolved: ${factor}, units: ${units}`);
    if (!factor || factor <= 0) return false;

    const toMm = { mm:1, cm:10, m:1000, in:25.4, ft:304.8,
                   millimeter:1, centimeter:10, meter:1000, foot:304.8, inch:25.4 };
    const mmPerModelUnit = factor * (toMm[units.toLowerCase()] ?? 1);
    if (mmPerModelUnit <= 0) return false;

    // Get px/model-unit from hitTest at viewport centre
    const vpW = viewer.container.clientWidth;
    const vpH = viewer.container.clientHeight;
    const h1  = viewer.impl.hitTest(vpW/2,    vpH/2, false);
    const h2  = viewer.impl.hitTest(vpW/2+10, vpH/2, false);
    if (h1?.point && h2?.point) {
      const dx = h2.point.x-h1.point.x, dy = h2.point.y-h1.point.y, dz = h2.point.z-h1.point.z;
      const mUPerPx = Math.sqrt(dx*dx+dy*dy+dz*dz) / 10;
      if (mUPerPx > 0) {
        mmPerPx = mUPerPx * mmPerModelUnit;
        const calStatus = document.getElementById('calibration-status');
        if (calStatus) {
          calStatus.textContent = `✅ APS synced: 1px ≈ ${mmPerPx.toFixed(3)} mm (${units})`;
          calStatus.className = 'status success';
        }
        console.log(`[CrackJad] APS calibration applied: ${mmPerPx.toFixed(4)} mm/px`);
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn('[CrackJad] syncFromExtProps error:', e);
    return false;
  }
}

function setMeasureMode(mode) {
  measureMode = mode;
  measurePoints = [];
  if (mode) {
    calibrateBtn.classList.toggle('active-tool', mode === 'calibrate');
    measureDepthBtn.classList.toggle('active-tool', mode === 'depth');
    setStatus(measureStatus, mode === 'calibrate'
      ? 'Click two known points on the model…'
      : 'Click first surface point…', 'info');
    measureStatus.classList.remove('hidden');
    viewerContainer.style.cursor = 'crosshair';
  } else {
    calibrateBtn.classList.remove('active-tool');
    measureDepthBtn.classList.remove('active-tool');
    measureStatus.classList.add('hidden');
    viewerContainer.style.cursor = '';
  }
}

calibrateBtn.addEventListener('click', () => {
  if (measureMode === 'calibrate') { setMeasureMode(null); return; }
  setMeasureMode('calibrate');
});

measureDepthBtn.addEventListener('click', () => {
  if (measureMode === 'depth') { setMeasureMode(null); return; }
  setMeasureMode('depth');
});

// Listen for clicks on the viewer container during measure mode
viewerContainer.addEventListener('click', (e) => {
  if (!measureMode || !viewer || !modelIsLoaded) return;

  // Get coords relative to viewer container
  const rect = viewerContainer.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  // Use APS hitTest to get world-space 3D coordinates
  const hitResult = viewer.impl.hitTest(cx, cy, false);
  const worldPt = hitResult ? hitResult.point : null;

  measurePoints.push({ x: cx, y: cy, world: worldPt });

  if (measureMode === 'calibrate' && measurePoints.length === 2) {
    const dx = measurePoints[1].x - measurePoints[0].x;
    const dy = measurePoints[1].y - measurePoints[0].y;
    const pxDist = Math.sqrt(dx * dx + dy * dy);
    const realMm = parseFloat(prompt(`Distance between those two points (mm)?\n(e.g. enter 1000 for 1 metre)`));
    if (!isNaN(realMm) && realMm > 0 && pxDist > 0) {
      mmPerPx = realMm / pxDist;
      const calStatus = document.getElementById('calibration-status');
      calStatus.textContent = `✅ Calibrated: 1px = ${mmPerPx.toFixed(3)} mm`;
      calStatus.className = 'status success';
    }
    setMeasureMode(null);

  } else if (measureMode === 'depth' && measurePoints.length === 1) {
    setStatus(measureStatus, 'Click second surface point…', 'info');

  } else if (measureMode === 'depth' && measurePoints.length === 2) {
    const p1 = measurePoints[0];
    const p2 = measurePoints[1];
    let depthMm = null;

    // If both hitTest points available, use 3D world distance
    if (p1.world && p2.world) {
      const unitScale = viewer.model ? viewer.model.getUnitScale() : 1; // model units → metres
      const dx3 = p2.world.x - p1.world.x;
      const dy3 = p2.world.y - p1.world.y;
      const dz3 = p2.world.z - p1.world.z;
      const dist3D = Math.sqrt(dx3 * dx3 + dy3 * dy3 + dz3 * dz3);
      depthMm = dist3D * unitScale * 1000; // metres → mm
    } else if (mmPerPx) {
      // Fallback: 2D screen distance × calibration
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      depthMm = Math.sqrt(dx * dx + dy * dy) * mmPerPx;
    }

    if (depthMm !== null) {
      lastMeasuredDepth = Math.round(depthMm * 10) / 10;
      depthValue.textContent = `${lastMeasuredDepth} mm`;
      depthResult.classList.remove('hidden');
      setStatus(measureStatus, `Depth measured: ${lastMeasuredDepth} mm`, 'success');
    } else {
      setStatus(measureStatus, 'HitTest failed — calibrate scale first', 'error');
    }
    setMeasureMode(null);
  }
});

// ============================================================
// Manual Draw Mode
// ============================================================

let isDrawMode = false;
let drawStart = null;
const drawCtx = drawCanvas.getContext('2d');

function enterDrawMode() {
  isDrawMode = true;
  drawModeBtn.classList.add('active-tool');
  drawModeBtn.textContent = '✏️ Drawing Mode ON';
  drawModeHint.classList.remove('hidden');

  // Size draw canvas to match main area
  const rect = document.getElementById('main-area').getBoundingClientRect();
  drawCanvas.width = rect.width;
  drawCanvas.height = rect.height;
  drawCanvas.classList.remove('hidden');
}

function exitDrawMode() {
  isDrawMode = false;
  drawModeBtn.classList.remove('active-tool');
  drawModeBtn.textContent = '✏️ Manual Draw Mode';
  drawModeHint.classList.add('hidden');
  drawCanvas.classList.add('hidden');
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

drawModeBtn.addEventListener('click', () => {
  if (isDrawMode) exitDrawMode();
  else enterDrawMode();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isDrawMode) exitDrawMode();
});

drawCanvas.addEventListener('mousedown', (e) => {
  if (!isDrawMode) return;
  const rect = drawCanvas.getBoundingClientRect();
  drawStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});

drawCanvas.addEventListener('mousemove', (e) => {
  if (!isDrawMode || !drawStart) return;
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.strokeStyle = '#ffaa00';
  drawCtx.lineWidth = 2;
  drawCtx.setLineDash([6, 3]);
  drawCtx.strokeRect(drawStart.x, drawStart.y, mx - drawStart.x, my - drawStart.y);
  drawCtx.fillStyle = 'rgba(255,170,0,0.08)';
  drawCtx.fillRect(drawStart.x, drawStart.y, mx - drawStart.x, my - drawStart.y);
});

drawCanvas.addEventListener('mouseup', (e) => {
  if (!isDrawMode || !drawStart) return;
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const x1 = Math.min(drawStart.x, mx);
  const y1 = Math.min(drawStart.y, my);
  const x2 = Math.max(drawStart.x, mx);
  const y2 = Math.max(drawStart.y, my);
  drawStart = null;

  if (x2 - x1 < 10 || y2 - y1 < 10) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    return;
  }

  // Show mini classification dialog
  showManualDetectDialog(x1, y1, x2, y2, rect.width, rect.height);
});

function showManualDetectDialog(x1, y1, x2, y2, canvasW, canvasH) {
  // Create a lightweight inline dialog
  const existing = document.getElementById('manual-dialog');
  if (existing) existing.remove();

  const dlg = document.createElement('div');
  dlg.id = 'manual-dialog';
  dlg.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    background:#16213e; border:1px solid #e94560; border-radius:10px;
    padding:20px; z-index:3000; width:300px; box-shadow:0 8px 32px rgba(0,0,0,0.6);
    font-size:0.85rem; color:#e0e0e0;
  `;
  dlg.innerHTML = `
    <h3 style="color:#e94560;margin-bottom:12px">✏️ Classify Manual Detection</h3>
    <label style="display:block;margin-bottom:4px;color:#a0a0c0">Crack Type</label>
    <select id="md-type" style="width:100%;margin-bottom:10px;padding:6px;background:#0f3460;color:#e0e0e0;border:1px solid #533483;border-radius:4px">
      <option value="shear">Shear Crack</option>
      <option value="flexural">Flexural / Moment Crack</option>
      <option value="shrinkage">Shrinkage Crack</option>
      <option value="settlement">Settlement Crack</option>
      <option value="corrosion">Corrosion-Induced</option>
      <option value="thermal">Thermal Crack</option>
      <option value="crack" selected>General Crack</option>
      <option value="unknown">Unknown</option>
    </select>
    <label style="display:block;margin-bottom:4px;color:#a0a0c0">Estimated Width (mm)</label>
    <input type="number" id="md-width" placeholder="e.g. 0.5" style="width:100%;margin-bottom:10px;padding:6px;background:#0f3460;color:#e0e0e0;border:1px solid #533483;border-radius:4px" step="0.1" min="0">
    <div style="display:flex;gap:8px;margin-top:4px">
      <button id="md-confirm" style="flex:2;padding:8px;background:#e94560;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600">Add Detection</button>
      <button id="md-cancel" style="flex:1;padding:8px;background:#333;color:#e0e0e0;border:none;border-radius:4px;cursor:pointer">Cancel</button>
    </div>
  `;
  document.body.appendChild(dlg);

  document.getElementById('md-cancel').addEventListener('click', () => {
    dlg.remove();
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  });

  document.getElementById('md-confirm').addEventListener('click', () => {
    const crackType = document.getElementById('md-type').value;
    const width = parseFloat(document.getElementById('md-width').value) || null;

    const newDet = {
      bbox: [x1, y1, x2, y2],
      confidence: 1.0,
      class: crackType,
      mask_polygon: [],
      manual: true,
      estimated_width_mm: width,
    };

    const merged = [...currentDetections, newDet];
    showResults(merged);
    saveInspectionEntry(merged);

    // Draw permanent box on draw canvas
    drawCtx.setLineDash([]);
    drawCtx.strokeStyle = '#ffaa00';
    drawCtx.lineWidth = 2;
    drawCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    drawCtx.font = 'bold 12px sans-serif';
    drawCtx.fillStyle = '#ffaa00';
    drawCtx.fillRect(x1, y1 > 20 ? y1 - 20 : y1, ctx.measureText(crackType).width + 12, 18);
    drawCtx.fillStyle = '#000';
    drawCtx.fillText(crackType, x1 + 4, y1 > 20 ? y1 - 5 : y1 + 14);

    dlg.remove();
    exitDrawMode();
    // Auto-open evaluation for the new detection
    openEvalModal(merged.length - 1);
  });
}

// ============================================================
// Crack Evaluation Modal
// ============================================================

const evalModal    = document.getElementById('eval-modal');
const evalClose    = document.getElementById('eval-close');
const evalCancel   = document.getElementById('eval-cancel');
const evalCalcBtn  = document.getElementById('eval-calc-btn');
const evalSaveBtn  = document.getElementById('eval-save-btn');
const evalDetSelect= document.getElementById('eval-det-select');
const evalUseDepth = document.getElementById('eval-use-depth-btn');
const evalVerdict  = document.getElementById('eval-verdict');
const verdictBadge = document.getElementById('verdict-badge');
const verdictDetail= document.getElementById('verdict-detail');
const verdictCost  = document.getElementById('verdict-cost');

const REPAIR_UNIT_DEFAULTS = {
  epoxy_injection: { cost: 150, unit: '$/L' },
  routing_sealing: { cost: 60,  unit: '$/m' },
  stitching:       { cost: 250, unit: '$/m' },
  overlay:         { cost: 80,  unit: '$/m²' },
  patching:        { cost: 120, unit: '$/L' },
  grouting:        { cost: 200, unit: '$/L' },
  carbon_wrap:     { cost: 400, unit: '$/m' },
  monitor:         { cost: 0,   unit: '—' },
  demolish:        { cost: 2000,unit: '$/m²' },
};

function suggestRepair(crackType, widthMm, depthMm, material, nearWater, loadBearing) {
  const w = widthMm || 0;
  const d = depthMm || 0;
  if (nearWater && d > 30) return 'grouting';
  if (crackType === 'corrosion' || (d > 50 && loadBearing)) return 'carbon_wrap';
  if (crackType === 'shear' || crackType === 'torsional') return loadBearing ? 'carbon_wrap' : 'stitching';
  if (w > 5 || d > 150) return 'demolish';
  if (w > 1 && loadBearing) return 'epoxy_injection';
  if (w > 1) return 'routing_sealing';
  if (w > 0.3) return 'epoxy_injection';
  if (crackType === 'shrinkage' || crackType === 'thermal') return w < 0.1 ? 'monitor' : 'routing_sealing';
  return 'monitor';
}

const DEMOLISH_JOKES = [
  "Jad has seen a lot of cracks. This one made him cry. 😢",
  "Jad says: 'I've inspected thousands of cracks. This one personally offended me.' 😤",
  "Even Jad's optimism couldn't survive this inspection. 💔",
  "Jad took one look, packed his bag, and said 'not my problem anymore.' 🧳",
  "Jad's professional opinion: 'Bro. Just... bro.' 🤦",
  "Jad has a motto: every crack can be fixed. Today, Jad revised his motto. ✏️",
  "Jad whispered 'I'm sorry' to the building and walked away slowly. 🚶",
  "Jad tried to find something positive to say. He is still trying. ⏳",
];
const REPAIR_JOKES = [
  "Jad has seen worse. He will not say when, but he has. 💪",
  "Jad approves. Jad has spoken. 🏆",
  "Jad looked at this crack and said 'yeah, I can fix that' without even flinching. 😎",
  "Jad's favourite crack type: the fixable kind. This is that. ✅",
  "Jad says: 'A little epoxy, a little prayer, we are good.' 🙏",
  "Jad has personally escorted worse cracks back to health. This one will be fine. 🩺",
  "Jad is already mentally ordering the repair materials. He is very excited. 🛒",
  "Don't worry. Jad has a guy for this. Jad IS the guy for this. 🔧",
];
const MONITOR_JOKES = [
  "Jad is watching. Jad is always watching. 👀",
  "Jad says: 'I'll keep my eye on it.' Jad has 47 other cracks he is also watching. 🧐",
  "Jad rated this crack a 3/10. Not impressed, not alarmed. 😐",
  "Jad's professional verdict: 'Meh.' — High praise from Jad, honestly. 🤷",
  "Jad put this crack on a 6-month check-in schedule. It is now Jad's problem in December. 📅",
  "Jad looked at this crack and yawned. That's actually a great sign. 😴",
  "Jad says this crack needs to 'think about what it's done' before any action is taken. 🪑",
  "Not urgent enough for Jad to put down his coffee. Solid outcome. ☕",
];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function calcVerdict(crackType, widthMm, depthMm, nearWater, seismic, loadBearing, activity) {
  const w = widthMm || 0;
  const d = depthMm || 0;

  // Immediate demolish conditions
  if (w > 10 || d > 200)
    return { verdict: 'DEMOLISH', reason: `Crack dimensions exceed safe repair thresholds. ${pick(DEMOLISH_JOKES)}` };
  if (crackType === 'shear' && loadBearing && activity === 'active')
    return { verdict: 'DEMOLISH', reason: `Active shear crack in load-bearing element — brittle failure risk. ${pick(DEMOLISH_JOKES)}` };
  if (nearWater && d > 100 && crackType !== 'shrinkage')
    return { verdict: 'DEMOLISH', reason: `Deep through-crack in water-retaining structure. ${pick(DEMOLISH_JOKES)}` };

  // Monitor only
  if (!loadBearing && w < 0.1 && activity !== 'active')
    return { verdict: 'MONITOR', reason: `Hairline crack in non-structural element. Low risk — monitor quarterly. ${pick(MONITOR_JOKES)}` };
  if (crackType === 'shrinkage' && w < 0.3 && !nearWater)
    return { verdict: 'MONITOR', reason: `Shallow shrinkage cracking. Seal if moisture ingress is a concern. ${pick(MONITOR_JOKES)}` };

  // Default: repair
  let reason = '';
  if (w > 1) reason += 'Wide crack (>1mm) requires injection or structural repair. ';
  if (d > 50) reason += 'Deep crack penetrates structural section. ';
  if (nearWater) reason += '⚠️ Water proximity — waterproofing critical. ';
  if (seismic) reason += '⚠️ Seismic zone — check code compliance. ';
  if (activity === 'active') reason += '⚠️ Active crack — identify and fix root cause before repairing. ';
  reason += pick(REPAIR_JOKES);
  return { verdict: 'REPAIR', reason: reason || `Crack requires sealing/injection to prevent deterioration. ${pick(REPAIR_JOKES)}` };
}

function openEvalModal(detIndex = 0) {
  if (currentDetections.length === 0) return;

  // Populate detection dropdown
  evalDetSelect.innerHTML = '';
  currentDetections.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `#${i + 1} — ${d.class}${d.manual ? ' (manual)' : ` (${(d.confidence * 100).toFixed(0)}%)`}`;
    evalDetSelect.appendChild(opt);
  });
  evalDetSelect.value = detIndex;

  // Pre-fill width from manual detection if available
  const det = currentDetections[detIndex];
  if (det && det.estimated_width_mm) {
    document.getElementById('eval-width').value = det.estimated_width_mm;
  }

  // Auto-suggest crack type in dropdown
  const crackTypeMap = { shear:'shear', flexural:'flexural', shrinkage:'shrinkage', corrosion:'corrosion', settlement:'settlement', thermal:'thermal' };
  const suggested = crackTypeMap[det && det.class] || '';
  if (suggested) document.getElementById('eval-crack-type').value = suggested;

  // Auto-suggest bbox length from calibration
  if (mmPerPx && det) {
    const [x1,y1,x2,y2] = det.bbox;
    const bboxLengthPx = Math.max(x2-x1, y2-y1);
    document.getElementById('eval-length').value = Math.round(bboxLengthPx * mmPerPx);
  }

  evalVerdict.classList.add('hidden');
  evalModal.classList.remove('hidden');
}

// When selected detection changes, update width pre-fill
evalDetSelect.addEventListener('change', () => {
  const i = parseInt(evalDetSelect.value);
  const det = currentDetections[i];
  if (det && det.estimated_width_mm) document.getElementById('eval-width').value = det.estimated_width_mm;
});

// Volume auto-calc on input change
['eval-width','eval-depth','eval-length'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateVolumeDisplay);
});

function updateVolumeDisplay() {
  const w = parseFloat(document.getElementById('eval-width').value) || 0;
  const d = parseFloat(document.getElementById('eval-depth').value) || 0;
  const l = parseFloat(document.getElementById('eval-length').value) || 0;
  if (w && d && l) {
    const core   = (w * d * l) / 1e6; // mm³ → cm³
    const repair = core * 1.25;
    document.getElementById('vol-core').textContent   = core.toFixed(4)   + ' cm³';
    document.getElementById('vol-repair').textContent = repair.toFixed(4) + ' cm³';
  } else {
    document.getElementById('vol-core').textContent   = '—';
    document.getElementById('vol-repair').textContent = '—';
  }
}

// Repair method change → update unit cost default
document.getElementById('eval-repair-method').addEventListener('change', () => {
  const method = document.getElementById('eval-repair-method').value;
  const def = REPAIR_UNIT_DEFAULTS[method];
  if (def) {
    document.getElementById('eval-unit-cost').value = def.cost;
    document.getElementById('eval-cost-unit').textContent = def.unit;
  }
});

// "Use Measured" depth button
evalUseDepth.addEventListener('click', () => {
  if (lastMeasuredDepth !== null) {
    document.getElementById('eval-depth').value = lastMeasuredDepth;
    updateVolumeDisplay();
  } else {
    alert('No depth measurement yet. Use "Measure Depth (2 pts)" with the model loaded first.');
  }
});

// Auto-suggest repair on Calculate
evalCalcBtn.addEventListener('click', () => {
  const crackType  = document.getElementById('eval-crack-type').value;
  const material   = document.getElementById('eval-material').value;
  const location   = document.getElementById('eval-location').value;
  const activity   = document.getElementById('eval-activity').value;
  const w = parseFloat(document.getElementById('eval-width').value)  || 0;
  const d = parseFloat(document.getElementById('eval-depth').value)  || 0;
  const l = parseFloat(document.getElementById('eval-length').value) || 0;
  const nearWater  = document.getElementById('eval-near-water').checked;
  const seismic    = document.getElementById('eval-seismic').checked;
  const loadBearing= document.getElementById('eval-load-bearing').checked;

  // Auto-suggest repair
  const suggestedRepair = suggestRepair(crackType, w, d, material, nearWater, loadBearing);
  document.getElementById('eval-repair-method').value = suggestedRepair;
  const def = REPAIR_UNIT_DEFAULTS[suggestedRepair];
  document.getElementById('eval-unit-cost').value = def.cost;
  document.getElementById('eval-cost-unit').textContent = def.unit;

  updateVolumeDisplay();

  // Verdict
  const { verdict, reason } = calcVerdict(crackType, w, d, nearWater, seismic, loadBearing, activity);

  // Cost estimate
  let costText = '';
  const unitCost = parseFloat(document.getElementById('eval-unit-cost').value) || 0;
  if (unitCost > 0 && verdict !== 'MONITOR') {
    if (def.unit === '$/L') {
      const vol = (w * d * l / 1e6) * 1.25; // cm³
      const litres = vol / 1000;
      const cost = litres * unitCost;
      costText = `Est. cost: ~$${cost.toFixed(2)} (${litres.toFixed(4)} L × $${unitCost}/L)`;
    } else if (def.unit === '$/m') {
      const metres = l / 1000;
      const cost = metres * unitCost;
      costText = `Est. cost: ~$${cost.toFixed(2)} (${metres.toFixed(3)} m × $${unitCost}/m)`;
    } else if (def.unit === '$/m²') {
      const m2 = (l / 1000) * (w / 1000);
      const cost = m2 * unitCost;
      costText = `Est. cost: ~$${cost.toFixed(2)} (${m2.toFixed(4)} m² × $${unitCost}/m²)`;
    }
  }

  evalVerdict.className = `verdict-box ${verdict.toLowerCase()}`;
  verdictBadge.textContent  = verdict;
  verdictDetail.textContent = reason;
  verdictCost.textContent   = costText;
  evalVerdict.classList.remove('hidden');
});

// Save evaluation to report
evalSaveBtn.addEventListener('click', () => {
  const i = parseInt(evalDetSelect.value);
  const det = currentDetections[i];
  const evalData = {
    location:    document.getElementById('eval-location').value,
    material:    document.getElementById('eval-material').value,
    crackType:   document.getElementById('eval-crack-type').value,
    activity:    document.getElementById('eval-activity').value,
    widthMm:     parseFloat(document.getElementById('eval-width').value)  || null,
    depthMm:     parseFloat(document.getElementById('eval-depth').value)  || null,
    lengthMm:    parseFloat(document.getElementById('eval-length').value) || null,
    repair:      document.getElementById('eval-repair-method').value,
    notes:       document.getElementById('eval-notes').value,
    verdict:     verdictBadge.textContent,
    costEstimate:verdictCost.textContent,
    nearWater:   document.getElementById('eval-near-water').checked,
    seismic:     document.getElementById('eval-seismic').checked,
    loadBearing: document.getElementById('eval-load-bearing').checked,
  };

  // Attach to detection
  if (det) det.evaluation = evalData;

  // Persist evaluation in log
  const log = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (log.length > 0) {
    const last = log[log.length - 1];
    if (last.detections && last.detections[i]) last.detections[i].evaluation = evalData;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  }

  evalModal.classList.add('hidden');
  setStatus(detectStatus, `Evaluation saved — Verdict: ${evalData.verdict}`, 'success');
});

evalClose.addEventListener('click',  () => evalModal.classList.add('hidden'));
evalCancel.addEventListener('click', () => evalModal.classList.add('hidden'));
evalModal.addEventListener('click',  (e) => { if (e.target === evalModal) evalModal.classList.add('hidden'); });
evaluateBtn.addEventListener('click',() => openEvalModal(0));

// ============================================================
// Danger Info Modal — Tab Switching
// ============================================================

const dangerModal = document.getElementById('danger-modal');
const dangerClose = document.getElementById('danger-close');

dangerInfoBtn.addEventListener('click', () => dangerModal.classList.remove('hidden'));
dangerClose.addEventListener('click',   () => dangerModal.classList.add('hidden'));
dangerModal.addEventListener('click', (e) => { if (e.target === dangerModal) dangerModal.classList.add('hidden'); });

document.querySelectorAll('.dtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dtab-content').forEach(c => { c.classList.remove('active'); c.classList.add('hidden'); });
    btn.classList.add('active');
    const target = document.getElementById(`tab-${btn.dataset.tab}`);
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
  });
});

// ============================================================
// Initialize on page load
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {
  await initViewer();
  refreshModelList();
});

// Enable measurement buttons and sync APS Measure extension when model loads
document.addEventListener('modelLoaded', () => {
  enableMeasureButtons();
  loadAndSyncMeasureExtension();
});
