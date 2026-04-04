// ============================================================
// Autodesk Crack Inspector — Frontend Controller
// ============================================================

let viewer = null;
let currentMode = 'viewer'; // 'viewer' or 'canvas'
let modelIsLoaded = false; // true only after a 3D model is loaded in the viewer

// --- DOM Elements ---
const viewerContainer = document.getElementById('viewer-container');
const photoCanvas = document.getElementById('photo-canvas');
const ctx = photoCanvas.getContext('2d');

const modelFileInput = document.getElementById('model-file');
const uploadModelBtn = document.getElementById('upload-model-btn');
const modelStatus = document.getElementById('model-status');
const modelSelect = document.getElementById('model-select');
const loadModelBtn = document.getElementById('load-model-btn');
const refreshModelsBtn = document.getElementById('refresh-models-btn');

const photoFileInput = document.getElementById('photo-file');
const detectBtn = document.getElementById('detect-btn');
const confidenceSlider = document.getElementById('confidence-slider');
const confidenceVal = document.getElementById('confidence-val');
const detectStatus = document.getElementById('detect-status');
const resultsPanel = document.getElementById('results-panel');
const resultsList = document.getElementById('results-list');
const clearOverlaysBtn = document.getElementById('clear-overlays-btn');

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

      // Register our custom extension
      Autodesk.Viewing.theExtensionManager.registerExtension(
        'CrackOverlayExtension',
        CrackOverlayExtension,
      );
      viewer.loadExtension('CrackOverlayExtension');

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
        resolve();
      },
      (errorCode, errorMsg) => {
        reject(new Error(`Document load error ${errorCode}: ${errorMsg}`));
      },
    );
  });
}

// ============================================================
// Part B: CrackOverlayExtension (3D Viewer Overlay)
// ============================================================

class CrackOverlayExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options) {
    super(viewer, options);
    this.overlayContainer = null;
    this.detections = [];
  }

  load() {
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'crack-overlay';
    this.overlayContainer.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99;';
    this.viewer.container.appendChild(this.overlayContainer);
    return true;
  }

  unload() {
    if (this.overlayContainer) {
      this.overlayContainer.remove();
      this.overlayContainer = null;
    }
    return true;
  }

  showDetections(detections, imgWidth, imgHeight) {
    this.clearDetections();
    this.detections = detections;

    const containerRect = this.viewer.container.getBoundingClientRect();
    const scaleX = containerRect.width / imgWidth;
    const scaleY = containerRect.height / imgHeight;

    detections.forEach((det) => {
      const [x1, y1, x2, y2] = det.bbox;
      const severity = det.confidence > 0.7 ? 'high' : det.confidence > 0.4 ? 'medium' : 'low';

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

      this.overlayContainer.appendChild(box);

      // Draw mask polygon if available
      if (det.mask_polygon && det.mask_polygon.length > 2) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText =
          'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
        svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);

        const points = det.mask_polygon
          .map(([px, py]) => `${px * scaleX},${py * scaleY}`)
          .join(' ');

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', points);
        const color = severity === 'high' ? '255,48,48' : severity === 'medium' ? '255,170,0' : '48,255,48';
        polygon.setAttribute('fill', `rgba(${color},0.2)`);
        polygon.setAttribute('stroke', `rgba(${color},0.8)`);
        polygon.setAttribute('stroke-width', '2');

        svg.appendChild(polygon);
        this.overlayContainer.appendChild(svg);
      }
    });
  }

  clearDetections() {
    if (this.overlayContainer) {
      this.overlayContainer.innerHTML = '';
    }
    this.detections = [];
  }
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

    // Draw label
    const label = `${det.class} ${(det.confidence * 100).toFixed(0)}%`;
    ctx.font = 'bold 13px sans-serif';
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(offsetX + x1 * scale, offsetY + y1 * scale - 18, textW + 8, 18);
    ctx.fillStyle = severity === 'high' ? '#fff' : '#000';
    ctx.fillText(label, offsetX + x1 * scale + 4, offsetY + y1 * scale - 4);
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

async function pollTranslation(urn) {
  const poll = setInterval(async () => {
    try {
      const resp = await fetch(`/api/models/${encodeURIComponent(urn)}/status`);
      const data = await resp.json();

      if (data.status === 'success') {
        clearInterval(poll);
        setStatus(modelStatus, 'Translation complete!', 'success');
        uploadModelBtn.disabled = false;
        refreshModelList();
        await loadModel(urn);
      } else if (data.status === 'failed') {
        clearInterval(poll);
        setStatus(modelStatus, 'Translation failed', 'error');
        uploadModelBtn.disabled = false;
      } else {
        setStatus(modelStatus, `Translating... ${data.progress || ''}`, 'info');
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
      opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to refresh models:', err);
  }
}

modelSelect.addEventListener('change', () => {
  loadModelBtn.disabled = !modelSelect.value;
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

// --- Crack Detection ---
photoFileInput.addEventListener('change', () => {
  detectBtn.disabled = !photoFileInput.files.length;
});

confidenceSlider.addEventListener('input', () => {
  confidenceVal.textContent = confidenceSlider.value;
});

detectBtn.addEventListener('click', async () => {
  const file = photoFileInput.files[0];
  if (!file) return;

  detectBtn.disabled = true;
  setStatus(detectStatus, 'Analyzing image...', 'info');

  try {
    const formData = new FormData();
    formData.append('file', file);

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

    // Load the photo and display detections
    const img = new Image();
    img.onload = () => {
      currentPhoto = img;
      canvasDetections = data.detections;

      if (viewer && modelIsLoaded) {
        // Overlay on the 3D viewer (only when a model is actually loaded)
        const ext = viewer.getExtension('CrackOverlayExtension');
        if (ext) {
          ext.showDetections(data.detections, data.image_width, data.image_height);
        }
      } else {
        // 2D canvas — show the photo with detections drawn on it
        drawPhotoWithDetections(img, data.detections);
      }
    };
    img.src = URL.createObjectURL(file);
  } catch (err) {
    setStatus(detectStatus, err.message, 'error');
  } finally {
    detectBtn.disabled = false;
  }
});

// --- Clear Overlays ---
clearOverlaysBtn.addEventListener('click', () => {
  if (viewer) {
    const ext = viewer.getExtension('CrackOverlayExtension');
    if (ext) ext.clearDetections();
  }

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

// ============================================================
// Initialize on page load
// ============================================================

window.addEventListener('DOMContentLoaded', async () => {
  await initViewer();
  refreshModelList();
});
