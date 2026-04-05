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

    Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      (doc) => {
        const defaultModel = doc.getRoot().getDefaultGeometry();
        viewer.loadDocumentNode(doc, defaultModel);
        modelIsLoaded = true;
        unloadModelBtn.disabled = false;
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

function showResults(detections) {
  resultsPanel.classList.remove('hidden');
  resultsList.innerHTML = '';
  if (detections.length === 0) {
    resultsList.innerHTML = '<div class="result-item">No defects detected</div>';
    return;
  }
  detections.forEach((det, i) => {
    const severity = det.confidence > 0.7 ? 'high' : det.confidence > 0.4 ? 'medium' : 'low';
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <span>#${i + 1} ${det.class}</span>
      <span class="conf ${severity}">${(det.confidence * 100).toFixed(1)}%</span>
    `;
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
  unloadModelBtn.disabled = true;
  if (crackOverlay) crackOverlay.clearDetections();
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
// Initialize on page load
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {
  await initViewer();
  refreshModelList();
});
