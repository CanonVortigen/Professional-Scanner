// Global state
let socket = null;
let scanResults = [];
let scanTimerInterval = null;
let scanStartTime = null;
let totalIps = 0;
let scannedIps = 0;

// DOM Elements
const connectionBadge = document.getElementById('connection-badge');
const targetInput = document.getElementById('target-input');
const portsPreset = document.getElementById('ports-preset');
const customPortsGroup = document.getElementById('custom-ports-group');
const customPortsInput = document.getElementById('custom-ports-input');
const scanUdpCheckbox = document.getElementById('scan-udp-checkbox');
const concurrencyInput = document.getElementById('concurrency-input');
const timeoutInput = document.getElementById('timeout-input');
const startBtn = document.getElementById('start-btn');
const exportBtn = document.getElementById('export-btn');
const clearBtn = document.getElementById('clear-btn');
const consoleOutput = document.getElementById('console-output');
const scanTimer = document.getElementById('scan-timer');
const searchInput = document.getElementById('search-input');
const resultsBody = document.getElementById('results-body');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

// Stats DOM Elements
const statTotal = document.getElementById('stat-total');
const statActive = document.getElementById('stat-active');
const statInactive = document.getElementById('stat-inactive');
const statTime = document.getElementById('stat-time');

// Connect to WebSocket Server
function connectWebSocket() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    connectionBadge.textContent = 'Conectado';
    connectionBadge.className = 'badge badge-connected';
    logToConsole('[i] Conexão estabelecida com o servidor de varredura.', 'system-msg');
  };

  socket.onclose = () => {
    connectionBadge.textContent = 'Desconectado';
    connectionBadge.className = 'badge badge-disconnected';
    logToConsole('[!] Conexão perdida. Tentando reconectar...', 'error-msg');
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.error('WebSocket Error:', err);
    connectionBadge.textContent = 'Erro';
    connectionBadge.className = 'badge badge-disconnected';
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  };
}

// Handle WebSocket messages
function handleServerMessage(data) {
  switch (data.type) {
    case 'log':
      const logClass = getLogClass(data.message);
      logToConsole(data.message, logClass);
      break;

    case 'scan_started':
      totalIps = data.total;
      scannedIps = 0;
      progressContainer.classList.remove('hidden');
      updateProgressBar(0);
      break;

    case 'host_found':
      scannedIps++;
      if (totalIps > 0) {
        updateProgressBar(Math.round((scannedIps / totalIps) * 100));
      }
      // Add or update active host
      addOrUpdateHost(data.host);
      if (data.log) logToConsole(data.log, 'success-msg');
      updateStats();
      break;

    case 'host_inactive':
      scannedIps++;
      if (totalIps > 0) {
        updateProgressBar(Math.round((scannedIps / totalIps) * 100));
      }
      // Add or update inactive host
      addOrUpdateHost(data.host);
      if (data.log) logToConsole(data.log, 'system-msg');
      updateStats();
      break;

    case 'port_result':
      const { ip, portResult } = data;
      const host = scanResults.find(h => h.ip === ip);
      if (host) {
        // Prevent duplicate ports
        if (!host.ports.some(p => p.port === portResult.port && p.protocol === portResult.protocol)) {
          host.ports.push(portResult);
          updateHostRow(host);
        }
      }
      if (data.log) logToConsole(data.log, 'accent-msg');
      break;

    case 'progress':
      // Update progress bar with percentage from server
      if (typeof data.percent === 'number') {
        updateProgressBar(data.percent);
      }
      break;

    case 'complete':
      updateProgressBar(100);
      setTimeout(() => {
        progressContainer.classList.add('hidden');
      }, 1500);
      if (data.log) logToConsole(data.log, 'success-msg');
      endScan(data.summary);
      break;

    case 'error':
      progressContainer.classList.add('hidden');
      logToConsole(`[!] ERRO: ${data.message}`, 'error-msg');
      endScan(null, true);
      break;
  }
}

// Logger helper
function logToConsole(message, className = '') {
  const line = document.createElement('div');
  line.className = `terminal-line ${className}`;
  line.textContent = message;
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Update progress bar UI
function updateProgressBar(percent) {
  percent = Math.min(100, Math.max(0, percent));
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
}

// Get CSS class based on log content
function getLogClass(msg) {
  if (msg.startsWith('[+]')) return 'success-msg';
  if (msg.startsWith('[-]')) return 'system-msg';
  if (msg.startsWith('[*]')) return 'accent-msg';
  if (msg.startsWith('[~]')) return 'accent-msg';
  if (msg.startsWith('[!]')) return 'error-msg';
  return '';
}

// Fill Target Input from suggestion links
function fillTarget(val) {
  targetInput.value = val;
  targetInput.focus();
}

// Toggle Visibility of Custom Ports Input
function toggleCustomPorts() {
  if (portsPreset.value === 'custom') {
    customPortsGroup.classList.remove('hidden');
    customPortsInput.required = true;
  } else {
    customPortsGroup.classList.add('hidden');
    customPortsInput.required = false;
  }
}

// Start Scan process
function startScan() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Erro: Servidor desconectado. Aguarde a reconexão.');
    return;
  }

  const target = targetInput.value.trim();
  if (!target) {
    alert('Por favor, insira um endereço IP, faixa ou CIDR.');
    return;
  }

  // Parse TCP ports selection
  let portsTCP = [];
  const preset = portsPreset.value;
  if (preset === 'common') {
    portsTCP = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 1433, 3306, 3389, 8080];
  } else if (preset === 'web') {
    portsTCP = [80, 443, 8080];
  } else if (preset === 'custom') {
    const rawPorts = customPortsInput.value.split(',');
    for (let p of rawPorts) {
      const portNum = parseInt(p.trim(), 10);
      if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535) {
        portsTCP.push(portNum);
      }
    }
    if (portsTCP.length === 0) {
      alert('Por favor, insira portas TCP válidas (1-65535).');
      return;
    }
  }

  // Parse UDP ports selection
  const scanUdp = scanUdpCheckbox.checked;
  const portsUDP = scanUdp ? [53, 123, 161] : [];

  const timeout = parseInt(timeoutInput.value, 10);
  const concurrency = parseInt(concurrencyInput.value, 10);

  // UI Updates for starting scan
  startBtn.disabled = true;
  startBtn.classList.add('pulse');
  startBtn.querySelector('.loader').classList.remove('hidden');
  startBtn.querySelector('.btn-text').textContent = 'Escaneando...';
  exportBtn.disabled = true;

  // Clear previous results
  scanResults = [];
  resultsBody.innerHTML = '';
  logToConsole('[*] Iniciando nova varredura de rede...', 'accent-msg');

  // Timer Initialization
  scanStartTime = Date.now();
  scanTimer.textContent = '0.00s';
  clearInterval(scanTimerInterval);
  scanTimerInterval = setInterval(() => {
    const elapsed = ((Date.now() - scanStartTime) / 1000).toFixed(2);
    scanTimer.textContent = `${elapsed}s`;
  }, 100);

  // Send start payload to backend
  socket.send(JSON.stringify({
    type: 'start',
    target,
    portsTCP,
    portsUDP,
    timeout,
    concurrency,
    scanUdp
  }));
}

// End Scan process
function endScan(summary, isError = false) {
  clearInterval(scanTimerInterval);
  
  // UI Restore
  startBtn.disabled = false;
  startBtn.classList.remove('pulse');
  startBtn.querySelector('.loader').classList.add('hidden');
  startBtn.querySelector('.btn-text').textContent = 'Iniciar Varredura';

  if (!isError && scanResults.length > 0) {
    exportBtn.disabled = false;
  }

  if (summary) {
    statTime.textContent = `${summary.time}s`;
    scanTimer.textContent = `${summary.time}s`;
  }
  updateStats();
}

// Add host to results memory and render to table
function addOrUpdateHost(host) {
  const index = scanResults.findIndex(h => h.ip === host.ip);
  if (index !== -1) {
    scanResults[index] = { ...scanResults[index], ...host };
  } else {
    scanResults.push(host);
  }
  
  // Sort IP range before rendering (ascending order)
  scanResults.sort((a, b) => {
    const aNum = a.ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0;
    const bNum = b.ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0;
    return aNum - bNum;
  });

  renderTable();
}

// Render the results table
function renderTable() {
  const filterVal = searchInput.value.toLowerCase();
  resultsBody.innerHTML = '';

  const filtered = scanResults.filter(host => {
    return host.ip.toLowerCase().includes(filterVal) ||
           host.status.toLowerCase().includes(filterVal) ||
           host.hostname.toLowerCase().includes(filterVal) ||
           host.mac.toLowerCase().includes(filterVal) ||
           host.vendor.toLowerCase().includes(filterVal) ||
           host.os.toLowerCase().includes(filterVal) ||
           (host.vm || '').toLowerCase().includes(filterVal) ||
           (host.adDomain || '').toLowerCase().includes(filterVal);
  });

  if (filtered.length === 0) {
    resultsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">Nenhum host corresponde aos filtros ou à varredura atual.</td>
      </tr>
    `;
    return;
  }

  filtered.forEach(host => {
    const row = document.createElement('tr');
    row.id = `row-${host.ip.replace(/\./g, '_')}`;

    // Badge styling for status
    const statusClass = host.status === 'Ativo' ? 'state-active' : 'state-inactive';

    // Formatted Ports
    let portsHtml = '';
    if (host.ports && host.ports.length > 0) {
      portsHtml = host.ports.map(p => {
        const titleText = `${p.service} ${p.version && p.version !== 'N/A' ? '(' + p.version + ')' : ''}`;
        const pClass = p.state === 'open' ? 'open' : 'filtered';
        return `<span class="port-badge ${pClass}" title="${titleText}">${p.port}/${p.protocol} (${p.service})</span>`;
      }).join(' ');
    } else {
      portsHtml = host.status === 'Ativo' ? '<span class="text-muted">Nenhuma porta aberta encontrada</span>' : '<span class="text-muted">—</span>';
    }

    const vmBadge = host.vm === 'Sim' ? '<span class="state-badge" style="background:rgba(255,165,0,0.2);color:#ffa500;">Sim</span>' : '<span class="text-muted">Não</span>';

    row.innerHTML = `
      <td><strong>${host.ip}</strong></td>
      <td><span class="state-badge ${statusClass}">${host.status}</span></td>
      <td>${host.hostname}</td>
      <td><code>${host.mac}</code></td>
      <td>${host.vendor}</td>
      <td>${host.os}</td>
      <td>${vmBadge}</td>
      <td>${host.adDomain || 'N/A'}</td>
      <td>${portsHtml}</td>
    `;
    resultsBody.appendChild(row);
  });
}

// Update single host row in DOM without full re-render (smooth real-time update)
function updateHostRow(host) {
  const rowId = `row-${host.ip.replace(/\./g, '_')}`;
  const row = document.getElementById(rowId);
  if (row) {
    const portsCell = row.cells[8];
    if (portsCell) {
      let portsHtml = '';
      if (host.ports && host.ports.length > 0) {
        portsHtml = host.ports.map(p => {
          const titleText = `${p.service} ${p.version && p.version !== 'N/A' ? '(' + p.version + ')' : ''}`;
          const pClass = p.state === 'open' ? 'open' : 'filtered';
          return `<span class="port-badge ${pClass}" title="${titleText}">${p.port}/${p.protocol} (${p.service})</span>`;
        }).join(' ');
      } else {
        portsHtml = '<span class="text-muted">Nenhuma porta aberta encontrada</span>';
      }
      portsCell.innerHTML = portsHtml;
    }
  }
}

// Update counts statistics
function updateStats() {
  const total = scanResults.length;
  const active = scanResults.filter(h => h.status === 'Ativo').length;
  const inactive = scanResults.filter(h => h.status === 'Inativo').length;

  statTotal.textContent = total;
  statActive.textContent = active;
  statInactive.textContent = inactive;
}

// Real-time table filter
function filterResults() {
  renderTable();
}

// Clear Console Log
function clearConsole() {
  consoleOutput.innerHTML = '<div class="terminal-line system-msg">[i] Console limpo. Pronto para nova varredura.</div>';
}

// Export Results to Excel
async function exportToExcel() {
  if (scanResults.length === 0) return;

  try {
    const response = await fetch('/export-xlsx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ results: scanResults })
    });

    if (!response.ok) {
      throw new Error(`Falha ao gerar Excel: ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    link.setAttribute('download', `redes_scan_${dateStr}_${timeStr}.xlsx`);

    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    appendLog(`[!] Erro ao exportar Excel: ${err.message}`);
  }
}

// Basic Table Sorting Logic
let sortDirection = false;
function sortTable(columnIndex) {
  sortDirection = !sortDirection;
  
  scanResults.sort((a, b) => {
    let valA = '', valB = '';
    
    switch (columnIndex) {
      case 0: // IP Address sorting needs numeric parsing
        valA = a.ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0;
        valB = b.ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0;
        return sortDirection ? valA - valB : valB - valA;
      case 1:
        valA = a.status.toLowerCase();
        valB = b.status.toLowerCase();
        break;
      case 2:
        valA = a.hostname.toLowerCase();
        valB = b.hostname.toLowerCase();
        break;
      case 3:
        valA = a.mac.toLowerCase();
        valB = b.mac.toLowerCase();
        break;
      case 4:
        valA = a.vendor.toLowerCase();
        valB = b.vendor.toLowerCase();
        break;
      case 5:
        valA = a.os.toLowerCase();
        valB = b.os.toLowerCase();
        break;
      case 6:
        valA = (a.vm || '').toLowerCase();
        valB = (b.vm || '').toLowerCase();
        break;
      case 7:
        valA = (a.adDomain || '').toLowerCase();
        valB = (b.adDomain || '').toLowerCase();
        break;
    }
    
    if (valA < valB) return sortDirection ? -1 : 1;
    if (valA > valB) return sortDirection ? 1 : -1;
    return 0;
  });

  renderTable();
}

// Event Listeners initialization
startBtn.addEventListener('click', startScan);
exportBtn.addEventListener('click', exportToExcel);
clearBtn.addEventListener('click', clearConsole);

// Initialize Websocket connection on page load
connectWebSocket();
toggleCustomPorts();
updateStats();
