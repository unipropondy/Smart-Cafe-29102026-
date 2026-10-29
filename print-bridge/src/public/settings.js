/* =====================================================================
   UniPro Print Bridge — Settings Dashboard  (settings.js)
   All API calls go to: /api/config, /health, /api/logs, /api/status
   ===================================================================== */

'use strict';

// ─── State ────────────────────────────────────────────────────────────
let currentConfig = null;
let healthData    = null;
let logLines      = [];
let statusData    = null;

// ─── Section Navigation ───────────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');

  if (name === 'logs')        startLogRefresh();
  if (name === 'status')      renderStatus();
  if (name === 'diagnostics') renderDiagnostics();
  if (name === 'backends')    renderBackends();
}

// ─── Toast ────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 320);
  }, duration);
}

// ─── Alert Banner ─────────────────────────────────────────────────────
function showAlert(containerId, msg, type = 'info') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.style.display = 'flex';
  el.className = `alert ${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ─── Button Loading State ─────────────────────────────────────────────
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) btn.classList.add('loading');
  else         btn.classList.remove('loading');
  btn.disabled = loading;
}

// ─── Top Bar Pill Update ──────────────────────────────────────────────
function updatePills() {
  if (!healthData) return;

  const versionPill = document.getElementById('pill-version');
  const connPill    = document.getElementById('pill-connection');
  const bridgePill  = document.getElementById('pill-bridge');

  // Version
  const ver = statusData?.appVersion || currentConfig?.version || '1.0.0';
  document.getElementById('pill-version-text').textContent = 'v' + ver;

  // Connection (any backend online)
  const backends = healthData.backends || [];
  const anyOnline = backends.some(b => b.enabled && b.connected);
  connPill.className = 'pill ' + (anyOnline ? 'online' : 'offline');
  document.getElementById('pill-connection-text').textContent = anyOnline ? 'Connected' : 'Disconnected';

  // Bridge running
  bridgePill.className = 'pill online';
  document.getElementById('pill-bridge-text').textContent = 'Bridge Running';
}

// ─── API: Load Config ─────────────────────────────────────────────────
async function loadConfig() {
  try {
    const [cfgRes, hlthRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/health')
    ]);
    currentConfig = await cfgRes.json();
    healthData    = await hlthRes.json();

    populateGeneralForm();
    renderBackends();
    updatePills();
  } catch (err) {
    toast('Failed to connect to Print Bridge server', 'error');
  }
}

// ─── Populate General Form ────────────────────────────────────────────
function populateGeneralForm() {
  if (!currentConfig) return;
  document.getElementById('storeId').value        = currentConfig.storeId        || '';
  document.getElementById('bridgeToken').value    = currentConfig.bridgeToken    || '';
  document.getElementById('pollIntervalMs').value = currentConfig.pollIntervalMs || 2000;
  document.getElementById('port').value           = currentConfig.port           || 3050;

  const cd = currentConfig.customerDisplay || {};
  document.getElementById('customerDisplayEnabled').checked      = cd.enabled !== false;
  document.getElementById('customerDisplayFullscreen').checked   = cd.fullscreen !== false;
  document.getElementById('customerDisplayAutoRecovery').checked = cd.autoRecovery !== false;
}

// ─── Save General Config ──────────────────────────────────────────────
async function saveGeneralConfig(e) {
  e.preventDefault();
  setLoading('saveGeneralBtn', true);

  currentConfig.storeId        = document.getElementById('storeId').value.trim();
  currentConfig.bridgeToken    = document.getElementById('bridgeToken').value.trim();
  currentConfig.pollIntervalMs = parseInt(document.getElementById('pollIntervalMs').value);
  currentConfig.port           = parseInt(document.getElementById('port').value);

  currentConfig.customerDisplay = {
    enabled:      document.getElementById('customerDisplayEnabled').checked,
    fullscreen:   document.getElementById('customerDisplayFullscreen').checked,
    autoRecovery: document.getElementById('customerDisplayAutoRecovery').checked
  };

  const ok = await saveConfig();
  setLoading('saveGeneralBtn', false);

  if (ok) {
    showAlert('generalSaveAlert', '✅ Configuration Saved', 'success');
    toast('Configuration saved successfully', 'success');
  } else {
    showAlert('generalSaveAlert', '❌ Failed to save configuration', 'error');
  }
}

// ─── POST /api/config ─────────────────────────────────────────────────
async function saveConfig() {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });
    const result = await res.json();
    if (result.success) {
      await loadConfig(); // Sync state
      return true;
    }
    toast('Save error: ' + (result.error || 'Unknown'), 'error');
    return false;
  } catch (err) {
    toast('Network error saving config', 'error');
    return false;
  }
}

// ─── Render Backends ──────────────────────────────────────────────────
function renderBackends() {
  const container = document.getElementById('backendsList');
  if (!container) return;

  const backends       = (currentConfig && currentConfig.backends) || [];
  const healthBackends = (healthData && healthData.backends)        || [];

  if (backends.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔗</div>
        <p>No backend servers configured.<br>Click <strong>+ Add Backend</strong> to get started.</p>
      </div>`;
    return;
  }

  container.innerHTML = backends.map((backend, idx) => {
    const health    = healthBackends.find(h => h.url === backend.url) || {};
    const isEnabled = backend.enabled !== false;

    let statusClass, statusText, statusIcon;
    if (!isEnabled) {
      statusClass = 'neutral'; statusText = 'Disabled'; statusIcon = '⏸';
    } else if (health.connected) {
      statusClass = 'online';  statusText = 'Connected'; statusIcon = '🟢';
    } else {
      statusClass = 'offline'; statusText = 'Offline';  statusIcon = '🔴';
    }

    const hb  = health.lastHeartbeat
      ? timeSince(new Date(health.lastHeartbeat))
      : 'Never';
    const auth = health.authenticated ? 'Authenticated' : (isEnabled ? 'Not Auth' : '—');
    const jobs = health.jobsProcessed || 0;

    return `
    <div class="backend-card ${!isEnabled ? 'disabled-card' : ''}">
      <div class="backend-main">
        <div class="backend-header">
          <span class="backend-name">${escHtml(backend.name)}</span>
          <span class="badge ${statusClass}">${statusIcon} ${statusText}</span>
          ${isEnabled ? '' : ''}
        </div>
        <div class="backend-url">${escHtml(backend.url)}</div>
        <div class="backend-meta">
          <div class="meta-item">
            <span class="meta-label">Last Heartbeat</span>
            <span class="meta-value">${hb}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Authentication</span>
            <span class="meta-value">${auth}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Jobs Processed</span>
            <span class="meta-value">${jobs}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Enabled</span>
            <span class="meta-value">${isEnabled ? '☑ Yes' : '☐ No'}</span>
          </div>
        </div>
      </div>
      <div class="backend-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditModal(${idx})">✏ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteBackend(${idx})">🗑 Delete</button>
      </div>
    </div>`;
  }).join('');
}

// ─── Backend Modal: Add ───────────────────────────────────────────────
function openAddModal() {
  document.getElementById('modalTitle').textContent = 'Add Backend';
  document.getElementById('editIndex').value        = '';
  document.getElementById('backendName').value      = '';
  document.getElementById('backendUrl').value       = '';
  document.getElementById('backendEnabled').checked = true;
  hideModalError();
  document.getElementById('backendModal').classList.add('open');
}

// ─── Backend Modal: Edit ──────────────────────────────────────────────
function openEditModal(idx) {
  const b = currentConfig.backends[idx];
  document.getElementById('modalTitle').textContent = 'Edit Backend';
  document.getElementById('editIndex').value        = idx;
  document.getElementById('backendName').value      = b.name;
  document.getElementById('backendUrl').value       = b.url;
  document.getElementById('backendEnabled').checked = b.enabled !== false;
  hideModalError();
  document.getElementById('backendModal').classList.add('open');
}

function closeModal() {
  document.getElementById('backendModal').classList.remove('open');
}

function hideModalError() {
  const el = document.getElementById('modal-error');
  el.style.display = 'none';
}

function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.className = 'alert error';
  el.textContent = msg;
  el.style.display = 'flex';
}

// ─── Backend Form Submit ──────────────────────────────────────────────
async function handleBackendSubmit(e) {
  e.preventDefault();
  hideModalError();

  const idxStr  = document.getElementById('editIndex').value;
  const name    = document.getElementById('backendName').value.trim();
  const url     = document.getElementById('backendUrl').value.trim();
  const enabled = document.getElementById('backendEnabled').checked;

  // Validate URL
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    showModalError('URL must start with http:// or https://');
    return;
  }

  // Duplicate URL check
  if (!currentConfig.backends) currentConfig.backends = [];
  const editIdx = idxStr === '' ? -1 : parseInt(idxStr);
  const duplicate = currentConfig.backends.some((b, i) => b.url === url && i !== editIdx);
  if (duplicate) {
    showModalError('A backend with this URL already exists.');
    return;
  }

  setLoading('modalSubmitBtn', true);

  if (editIdx === -1) {
    currentConfig.backends.push({ name, url, enabled });
  } else {
    currentConfig.backends[editIdx] = { name, url, enabled };
  }

  const ok = await saveConfig();
  setLoading('modalSubmitBtn', false);

  if (ok) {
    closeModal();
    toast(`Backend "${name}" ${editIdx === -1 ? 'added' : 'updated'} successfully`, 'success');
    showSection('backends');
  } else {
    showModalError('Failed to save. Check console for details.');
  }
}

// ─── Delete Backend ───────────────────────────────────────────────────
async function deleteBackend(idx) {
  const name = currentConfig.backends[idx].name;
  if (!confirm(`Delete backend "${name}"? This cannot be undone.`)) return;
  currentConfig.backends.splice(idx, 1);
  const ok = await saveConfig();
  if (ok) toast(`Backend "${name}" deleted`, 'warning');
}

// ─── Bridge Status ────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) statusData = await res.json();
  } catch (_) {
    // /api/status may not exist — fallback silently
    statusData = null;
  }
}

function renderStatus() {
  if (!healthData) return;

  const backends = healthData.backends || [];
  const connected = backends.filter(b => b.enabled && b.connected).length;
  const total     = backends.filter(b => b.enabled).length;
  const totalJobs = backends.reduce((s, b) => s + (b.jobsProcessed || 0), 0);

  // Stats Grid
  const statsGrid = document.getElementById('statsGrid');
  statsGrid.innerHTML = [
    { label: 'Bridge Running',    value: '🟢 Online',     sub: 'Express server active' },
    { label: 'Backends Online',   value: `${connected} / ${total}`, sub: 'Connected backends' },
    { label: 'Jobs Processed',    value: totalJobs,        sub: 'Total since start' },
    { label: 'Printer Connected', value: statusData?.printerConnected ? '🟢 Yes' : '🔴 No', sub: 'TCP socket' },
    { label: 'Customer Display',  value: statusData?.customerDisplayConnected ? '🟢 Yes' : '⚪ N/A', sub: 'Secondary screen' },
    { label: 'Polling Interval',  value: (currentConfig?.pollIntervalMs || '—') + ' ms', sub: 'Current setting' },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-sub">${s.sub}</div>
    </div>`).join('');

  // Runtime Table
  const cfgPath = statusData?.configPath || '—';
  const lastSaved = statusData?.configLastSaved
    ? new Date(statusData.configLastSaved).toLocaleString()
    : '—';

  const rows = [
    ['Application Version', statusData?.appVersion      || currentConfig?.version || '1.0.0'],
    ['Electron Version',    statusData?.electronVersion  || process?.versions?.electron || '—'],
    ['Node Version',        statusData?.nodeVersion      || process?.versions?.node      || '—'],
    ['Loaded Config Path',  cfgPath],
    ['Config Last Saved',   lastSaved],
    ['Store ID',            currentConfig?.storeId       || '—'],
    ['Bridge Port',         currentConfig?.port          || '—'],
    ['Polling Interval',    (currentConfig?.pollIntervalMs || '—') + ' ms'],
    ['Customer Display',    currentConfig?.customerDisplay?.enabled ? 'Enabled' : 'Disabled'],
  ];

  document.getElementById('runtimeTable').innerHTML = rows.map(([k, v]) =>
    `<tr><td>${k}</td><td>${escHtml(String(v))}</td></tr>`
  ).join('');
}

// ─── Diagnostics ──────────────────────────────────────────────────────
function renderDiagnostics() {
  const backends      = (currentConfig && currentConfig.backends) || [];
  const healthBacks   = (healthData    && healthData.backends)    || [];

  // Diag grid items
  const items = [
    {
      icon: '🖨️',
      name: 'Bridge Running',
      value: '🟢 Active'
    },
    {
      icon: '🔌',
      name: 'Printer Connected',
      value: statusData?.printerConnected ? '🟢 Connected' : '🔴 Disconnected'
    },
    {
      icon: '🖥️',
      name: 'Customer Display',
      value: statusData?.customerDisplayConnected ? '🟢 Connected' : '⚪ Not Active'
    },
    {
      icon: '🔗',
      name: 'Active Backends',
      value: `${healthBacks.filter(b => b.connected).length} / ${backends.length} online`
    }
  ];

  document.getElementById('diagGrid').innerHTML = items.map(it => `
    <div class="diag-item">
      <div class="diag-icon">${it.icon}</div>
      <div class="diag-body">
        <div class="diag-name">${it.name}</div>
        <div class="diag-value">${it.value}</div>
      </div>
    </div>`).join('');

  // Printer table
  const printerInfo = statusData?.printer || {};
  const rows = [
    ['Configured Printers',  (backends.map(b => b.name).join(', ')) || '—'],
    ['Kitchen Routes',       statusData?.kitchenRoutes      || '—'],
    ['Cashier Printer',      statusData?.cashierPrinter     || 'Receipt Printer'],
    ['TCP Printer IP',       printerInfo.ip    || 'Not configured'],
    ['TCP Printer Port',     printerInfo.port  || '9100'],
    ['TCP Printer Status',   printerInfo.status || 'Unknown'],
    ['USB Printer Status',   printerInfo.usbStatus || 'Not connected'],
  ];

  document.getElementById('printerTable').innerHTML = rows.map(([k, v]) =>
    `<tr><td>${k}</td><td>${escHtml(String(v))}</td></tr>`
  ).join('');
}

async function reconnectPrinter() {
  try {
    const res = await fetch('/api/printer/reconnect', { method: 'POST' });
    const data = await res.json();
    toast(data.message || 'Reconnect signal sent', 'info');
    setTimeout(refreshDiagnostics, 1500);
  } catch (_) {
    toast('Reconnect failed (endpoint may not apply)', 'warning');
  }
}

async function refreshDiagnostics() {
  await Promise.all([loadConfig(), fetchStatus()]);
  renderDiagnostics();
  toast('Diagnostics refreshed', 'info');
}

// ─── Logs ─────────────────────────────────────────────────────────────
let logRefreshTimer = null;

function startLogRefresh() {
  fetchLogs();
  if (logRefreshTimer) clearInterval(logRefreshTimer);
  logRefreshTimer = setInterval(fetchLogs, 3000);
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    if (!res.ok) throw new Error('Not ok');
    const data = await res.json();
    logLines = data.lines || [];
    renderLogs();
  } catch (_) {
    // Silently ignore if /api/logs not available yet
  }
}

function renderLogs() {
  const output   = document.getElementById('log-output');
  const autoScroll = document.getElementById('logAutoScroll').checked;
  const wasAtBottom = output.scrollHeight - output.scrollTop <= output.clientHeight + 50;

  output.innerHTML = logLines.map(line => {
    let cls = 'log-plain';
    if (/\[INFO\]/i.test(line))  cls = 'log-info';
    if (/\[WARN\]/i.test(line))  cls = 'log-warn';
    if (/\[ERROR\]/i.test(line)) cls = 'log-error';
    return `<span class="log-line ${cls}">${escHtml(line)}</span>`;
  }).join('\n');

  document.getElementById('log-count').textContent = `${logLines.length} entries`;

  if (autoScroll && wasAtBottom) {
    output.scrollTop = output.scrollHeight;
  }
}

function clearLogView() {
  logLines = [];
  renderLogs();
}

async function downloadLogs() {
  const blob = new Blob([logLines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `printbridge-logs-${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeSince(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5)   return 'Just now';
  if (secs < 60)  return `${secs} sec ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  return `${Math.floor(secs / 3600)} hr ago`;
}

// Close modal on backdrop click
document.getElementById('backendModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ─── Auto-Refresh (5s) ────────────────────────────────────────────────
async function autoRefresh() {
  try {
    const [cfgRes, hlthRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/health')
    ]);
    currentConfig = await cfgRes.json();
    healthData    = await hlthRes.json();

    await fetchStatus();

    updatePills();

    // Refresh visible section
    const active = document.querySelector('.section.active');
    if (active?.id === 'section-backends')    renderBackends();
    if (active?.id === 'section-status')      renderStatus();
    if (active?.id === 'section-diagnostics') renderDiagnostics();
  } catch (_) {}
}

// ─── Init ─────────────────────────────────────────────────────────────
(async () => {
  await loadConfig();
  await fetchStatus();
  updatePills();
  renderStatus();

  // 5-second polling for status/backends
  setInterval(autoRefresh, 5000);
})();
