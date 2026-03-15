// ============ STATE ============
const state = {
  file: null,
  result: null,
  map: null,
  marker: null,
  circle: null,
  analyzing: false,
};

// ============ DOM ELEMENTS ============
const $ = (sel) => document.querySelector(sel);

const dom = {
  uploadZone: $('#uploadZone'),
  fileInput: $('#fileInput'),
  uploadContent: $('#uploadContent'),
  previewContainer: $('#previewContainer'),
  previewImage: $('#previewImage'),
  clearBtn: $('#clearBtn'),
  analyzeBtn: $('#analyzeBtn'),
  btnLoader: $('#btnLoader'),
  results: $('#results'),
  skeleton: $('#skeleton'),
  resultName: $('#resultName'),
  resultCountry: $('#resultCountry'),
  confidenceValue: $('#confidenceValue'),
  confidenceFill: $('#confidenceFill'),
  latValue: $('#latValue'),
  lngValue: $('#lngValue'),
  copyCoords: $('#copyCoords'),
  cluesToggle: $('#cluesToggle'),
  cluesBody: $('#cluesBody'),
  reasoning: $('#reasoning'),
  cluesList: $('#cluesList'),
  mapOverlay: $('#mapOverlay'),
  headerStats: $('#headerStats'),
  headerConfidence: $('#headerConfidence'),
  headerLocation: $('#headerLocation'),
  toastContainer: $('#toastContainer'),
  streetviewBtn: $('#streetviewBtn'),
};

// ============ CLUE TYPE ICONS ============
const clueIcons = {
  street_sign: '\u{1f6a7}',
  text_language: '\u{1f524}',
  architecture: '\u{1f3db}',
  vegetation: '\u{1f333}',
  road_markings: '\u{1f6e3}',
  license_plate: '\u{1f698}',
  sun_position: '\u2600\ufe0f',
  terrain: '\u26f0\ufe0f',
  brand_logo: '\u{1f3f7}',
  infrastructure: '\u{1f3d7}',
  driving_side: '\u{1f697}',
  clothing: '\u{1f455}',
  weather: '\u{1f326}',
  utility_poles: '\u{1f4e1}',
  road_surface: '\u{1f6e4}',
  traffic_signs: '\u26a0\ufe0f',
  flag: '\u{1f3f4}',
  storefront: '\u{1f3ea}',
  vehicle_type: '\u{1f69a}',
  landscape: '\u{1f304}',
};

// ============ MAP INIT ============
function initMap() {
  state.map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  const darkLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }
  );

  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
      maxZoom: 18,
    }
  );

  const streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }
  );

  darkLayer.addTo(state.map);

  L.control.layers(
    {
      'Dark': darkLayer,
      'Satellite': satelliteLayer,
      'Street': streetLayer,
    },
    {},
    { position: 'topright' }
  ).addTo(state.map);
}

// ============ UPLOAD HANDLING ============
function setupUpload() {
  // Click to upload
  dom.uploadZone.addEventListener('click', (e) => {
    if (e.target === dom.clearBtn || e.target.closest('.btn-clear')) return;
    dom.fileInput.click();
  });

  dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // Drag and drop
  dom.uploadZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dom.uploadZone.classList.add('dragover');
  });

  dom.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.uploadZone.classList.add('dragover');
  });

  dom.uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!dom.uploadZone.contains(e.relatedTarget)) {
      dom.uploadZone.classList.remove('dragover');
    }
  });

  dom.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Clear
  dom.clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearUpload();
  });
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image must be under 10MB', 'error');
    return;
  }

  state.file = file;

  const url = URL.createObjectURL(file);
  dom.previewImage.src = url;
  dom.previewContainer.style.display = 'block';
  dom.uploadContent.style.display = 'none';
  dom.analyzeBtn.disabled = false;
}

function clearUpload() {
  state.file = null;
  dom.fileInput.value = '';
  dom.previewContainer.style.display = 'none';
  dom.uploadContent.style.display = 'flex';
  dom.analyzeBtn.disabled = true;
  if (dom.previewImage.src) {
    URL.revokeObjectURL(dom.previewImage.src);
    dom.previewImage.src = '';
  }
}

// ============ ANALYSIS ============
async function analyze() {
  if (!state.file || state.analyzing) return;

  state.analyzing = true;
  dom.analyzeBtn.classList.add('loading');
  dom.analyzeBtn.disabled = true;
  dom.results.style.display = 'none';
  dom.skeleton.style.display = 'flex';

  try {
    const formData = new FormData();
    formData.append('image', state.file);

    const res = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Analysis failed' }));
      throw new Error(err.error || `Server error (${res.status})`);
    }

    const result = await res.json();
    state.result = result;

    displayResults(result);
    updateMap(result);

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    state.analyzing = false;
    dom.analyzeBtn.classList.remove('loading');
    dom.analyzeBtn.disabled = !state.file;
    dom.skeleton.style.display = 'none';
  }
}

dom.analyzeBtn.addEventListener('click', analyze);

// ============ DISPLAY RESULTS ============
function displayResults(r) {
  dom.results.style.display = 'flex';

  // Header
  dom.resultName.textContent = r.locationName || 'Unknown Location';
  const countryText = [r.city, r.region, r.country].filter(Boolean).join(', ');
  dom.resultCountry.textContent = countryText || '—';

  // Confidence
  const pct = r.confidencePercent || 0;
  dom.confidenceValue.textContent = `${pct}%`;
  dom.confidenceFill.className = 'confidence-fill';
  dom.confidenceFill.classList.add(r.confidence || 'low');
  requestAnimationFrame(() => {
    dom.confidenceFill.style.width = `${pct}%`;
  });

  // Coords
  dom.latValue.textContent = r.latitude?.toFixed(6) ?? '—';
  dom.lngValue.textContent = r.longitude?.toFixed(6) ?? '—';

  // Header stats
  dom.headerStats.style.display = 'flex';
  dom.headerConfidence.textContent = `${pct}% ${r.confidence || ''}`;
  dom.headerLocation.textContent = r.country || '—';

  // Reasoning
  dom.reasoning.textContent = r.analysis?.reasoning || '';

  // Clues
  dom.cluesList.innerHTML = '';
  if (r.analysis?.clues) {
    r.analysis.clues.forEach((clue) => {
      const icon = clueIcons[clue.type] || '\u{1f50d}';
      const card = document.createElement('div');
      card.className = 'clue-card';
      card.innerHTML = `
        <div class="clue-icon">${icon}</div>
        <div class="clue-content">
          <div class="clue-type">${(clue.type || '').replace(/_/g, ' ')}</div>
          <div class="clue-observation">${escapeHtml(clue.observation || '')}</div>
          ${clue.significance ? `<div class="clue-significance">${escapeHtml(clue.significance)}</div>` : ''}
        </div>
      `;
      dom.cluesList.appendChild(card);
    });
  }
}

// ============ MAP UPDATE ============
function updateMap(r) {
  // Remove old marker and circle
  if (state.marker) {
    state.map.removeLayer(state.marker);
    state.marker = null;
  }
  if (state.circle) {
    state.map.removeLayer(state.circle);
    state.circle = null;
  }

  const lat = r.latitude;
  const lng = r.longitude;

  if (lat == null || lng == null) return;

  // Hide overlay, show street view button
  dom.mapOverlay.classList.add('hidden');
  dom.streetviewBtn.style.display = 'flex';

  // Confidence-based settings
  let zoom, radius, color;
  switch (r.confidence) {
    case 'high':
      zoom = 14;
      radius = 5000;
      color = '#00e676';
      break;
    case 'medium':
      zoom = 10;
      radius = 50000;
      color = '#ffab00';
      break;
    default:
      zoom = 6;
      radius = 200000;
      color = '#ff5252';
  }

  // Confidence circle
  state.circle = L.circle([lat, lng], {
    radius,
    color,
    fillColor: color,
    fillOpacity: 0.08,
    weight: 1.5,
    opacity: 0.4,
    dashArray: '6 4',
  }).addTo(state.map);

  // Pulsing marker
  const markerHtml = `
    <div class="pulse-marker">
      <div class="dot"></div>
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="ring"></div>
    </div>
  `;

  const icon = L.divIcon({
    html: markerHtml,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  state.marker = L.marker([lat, lng], { icon })
    .addTo(state.map)
    .bindPopup(`
      <strong>${escapeHtml(r.locationName || 'Detected Location')}</strong><br>
      ${escapeHtml([r.city, r.country].filter(Boolean).join(', '))}<br>
      <span style="opacity:0.6">${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
    `);

  // Fly to location
  state.map.flyTo([lat, lng], zoom, {
    duration: 2.5,
    easeLinearity: 0.25,
  });
}

// ============ STREET VIEW ============
function openStreetView() {
  if (!state.result) return;
  const { latitude, longitude } = state.result;
  if (latitude == null || longitude == null) return;

  // Open Google Street View in a new tab (always works, no API key)
  window.open(
    `https://www.google.com/maps/@${latitude},${longitude},3a,90y,0h,90t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192`,
    '_blank'
  );
}

dom.streetviewBtn.addEventListener('click', openStreetView);

// ============ CLUES TOGGLE ============
dom.cluesToggle.addEventListener('click', () => {
  dom.cluesToggle.classList.toggle('open');
  dom.cluesBody.classList.toggle('open');
});

// ============ COPY COORDINATES ============
dom.copyCoords.addEventListener('click', async () => {
  if (!state.result) return;
  const text = `${state.result.latitude}, ${state.result.longitude}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Coordinates copied!', 'success');
  } catch {
    showToast('Failed to copy', 'error');
  }
});

// ============ UTILITIES ============
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============ INIT ============
initMap();
setupUpload();
