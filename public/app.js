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
const stopBtn = document.getElementById('stop-btn');
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
  
  connectionBadge.textContent = 'Conectando...';
  connectionBadge.className = 'badge badge-connecting';
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    connectionBadge.textContent = 'Conectado';
    connectionBadge.className = 'badge badge-connected';
    logToConsole('[i] Conexão estabelecida com o servidor de varredura.', 'system-msg');
  };

  socket.onclose = (event) => {
    connectionBadge.textContent = 'Desconectado';
    connectionBadge.className = 'badge badge-disconnected';
    logToConsole(`[!] Conexão perdida (code=${event.code}${event.reason ? `, reason=${event.reason}` : ''}). Tentando reconectar...`, 'error-msg');
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.error('WebSocket Error:', err);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectionBadge.textContent = 'Erro de conexão';
      connectionBadge.className = 'badge badge-disconnected';
      logToConsole(`[!] Erro no WebSocket: readyState=${socket.readyState}`, 'error-msg');
    }
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

    case 'host_update':
      addOrUpdateHost(data.host);
      if (data.log) logToConsole(data.log, 'accent-msg');
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

    case 'stopped':
      updateProgressBar(100);
      setTimeout(() => {
        progressContainer.classList.add('hidden');
      }, 1500);
      if (data.log) logToConsole(data.log, 'system-msg');
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
  stopBtn.disabled = false;
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

function stopScan() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Erro: servidor desconectado. Não é possível parar a varredura.');
    return;
  }
  stopBtn.disabled = true;
  logToConsole('[*] Solicitando parada da varredura...', 'system-msg');
  socket.send(JSON.stringify({ type: 'stop' }));
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
  stopBtn.disabled = true;

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
           host.os.toLowerCase().includes(filterVal) ||
           (host.vm || '').toLowerCase().includes(filterVal) ||
           (host.adDomain || '').toLowerCase().includes(filterVal) ||
           (host.vlan || '').toLowerCase().includes(filterVal) ||
           (host.subnet || '').toLowerCase().includes(filterVal) ||
           ((host.isDMZ ? 'dmz' : '')).toLowerCase().includes(filterVal) ||
           (host.environment || '').toLowerCase().includes(filterVal) ||
           (host.deviceType || '').toLowerCase().includes(filterVal);
  });

  if (filtered.length === 0) {
    resultsBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="14">Nenhum host corresponde aos filtros ou à varredura atual.</td>
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
      <td>${host.os}</td>
      <td>${vmBadge}</td>
      <td>${host.adDomain || 'N/A'}</td>
      <td>${host.vlan || 'N/A'}</td>
      <td>${host.subnet || 'N/A'}</td>
      <td>${host.isDMZ ? '<span class="state-badge dmz">Sim</span>' : '<span class="text-muted">Não</span>'}</td>
      <td>${host.environment || 'IT'}</td>
      <td>${host.deviceType || 'Host Ativo'}</td>
      <td><div class="ports-list">${portsHtml}</div></td>
    `;
    resultsBody.appendChild(row);
  });
}

// Update single host row in DOM without full re-render (smooth real-time update)
function updateHostRow(host) {
  const rowId = `row-${host.ip.replace(/\./g, '_')}`;
  const row = document.getElementById(rowId);
  if (row) {
    const portsCell = row.cells[11];
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
      portsCell.innerHTML = `<div class="ports-list">${portsHtml}</div>`;
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

// Export Results to JSON (client-side download)
function exportToJson() {
  if (scanResults.length === 0) return;

  try {
    const payload = { updated: new Date().toISOString(), results: scanResults };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    link.download = `redes_scan_${dateStr}_${timeStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    logToConsole(`[!] Erro ao exportar JSON: ${err.message}`, 'error-msg');
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
        valA = a.os.toLowerCase();
        valB = b.os.toLowerCase();
        break;
      case 4:
        valA = (a.vm || '').toLowerCase();
        valB = (b.vm || '').toLowerCase();
        break;
      case 5:
        valA = (a.adDomain || '').toLowerCase();
        valB = (b.adDomain || '').toLowerCase();
        break;
      case 6:
        valA = (a.vlan || '').toLowerCase();
        valB = (b.vlan || '').toLowerCase();
        break;
      case 7:
        valA = (a.subnet || '').toLowerCase();
        valB = (b.subnet || '').toLowerCase();
        break;
      case 8:
        valA = a.isDMZ ? 'sim' : 'nao';
        valB = b.isDMZ ? 'sim' : 'nao';
        break;
      case 9:
        valA = (a.environment || '').toLowerCase();
        valB = (b.environment || '').toLowerCase();
        break;
      case 10:
        valA = (a.deviceType || '').toLowerCase();
        valB = (b.deviceType || '').toLowerCase();
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
stopBtn.addEventListener('click', stopScan);
exportBtn.addEventListener('click', exportToJson);
clearBtn.addEventListener('click', clearConsole);

let networkInstance = null;
let latestTopology = null;

function initMapWindowListener() {
  const mapBtn = document.getElementById('map-btn');
  if (!mapBtn) {
    console.warn('Map button not found for opening map window.');
    return;
  }

  mapBtn.addEventListener('click', () => {
    window.open('/map', 'NetworkMap', 'width=1200,height=800,resizable=yes,scrollbars=yes');
  });
}

window.addEventListener('DOMContentLoaded', initMapWindowListener);

function exportMapImage(format) {
  if (!networkInstance || !latestTopology) {
    logToConsole('[!] Mapa indisponível para exportação.', 'error-msg');
    return;
  }

  const canvas = document.querySelector('#map-canvas canvas');
  if (!canvas) {
    logToConsole('[!] Canvas do mapa não encontrado.', 'error-msg');
    return;
  }

  if (format === 'png') {
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `topologia_rede_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  if (format === 'svg') {
    const svgText = generateSvgExport();
    if (!svgText) {
      logToConsole('[!] Não foi possível gerar SVG do mapa.', 'error-msg');
      return;
    }
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `topologia_rede_${new Date().toISOString().replace(/[:.]/g, '-')}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

function generateSvgExport() {
  if (!networkInstance || !latestTopology) return null;

  const positions = networkInstance.getPositions();
  const padding = 50;
  const points = Object.values(positions);
  if (points.length === 0) return null;

  let minX = Math.min(...points.map(p => p.x));
  let maxX = Math.max(...points.map(p => p.x));
  let minY = Math.min(...points.map(p => p.y));
  let maxY = Math.max(...points.map(p => p.y));
  const width = Math.round(maxX - minX + padding * 2);
  const height = Math.round(maxY - minY + padding * 2);

  const getPoint = (id) => {
    const pos = positions[id];
    return {
      x: Math.round(pos.x - minX + padding),
      y: Math.round(pos.y - minY + padding)
    };
  };

  const escapeXml = (str) => str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const edgeSvg = latestTopology.edges.map(edge => {
    const from = getPoint(edge.from);
    const to = getPoint(edge.to);
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#888" stroke-width="2" opacity="0.75"/>`;
  }).join('');

  const nodeSvg = latestTopology.nodes.map(node => {
    const pos = getPoint(node.id);
    const fill = (node.color && node.color.background) || '#4facfe';
    return `
      <g>
        <circle cx="${pos.x}" cy="${pos.y}" r="18" fill="${fill}" stroke="#fff" stroke-width="2" opacity="0.95" />
        <text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#fff">${escapeXml(node.label)}</text>
      </g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <rect width="100%" height="100%" fill="#05070a" />\n  ${edgeSvg}\n  ${nodeSvg}\n</svg>`;
}

function renderNetworkMap() {
  const { nodes, edges } = buildTopologyFromResults(scanResults);
  latestTopology = { nodes, edges };

  const container = document.getElementById('map-canvas');
  container.innerHTML = '';

  if (nodes.length === 0) {
    container.innerHTML = '<div class="terminal-line error-msg">Nenhum resultado de varredura disponível para gerar o mapa.</div>';
    return;
  }

  const data = {
    nodes: new vis.DataSet(nodes),
    edges: new vis.DataSet(edges)
  };

  const options = {
    nodes: {
      shape: 'dot',
      size: 18,
      font: { color: '#ffffff', size: 12, face: 'Plus Jakarta Sans' }
    },
    edges: {
      color: { color: '#8e96b5', highlight: '#f59e0b' },
      width: 2,
      smooth: { type: 'cubicBezier' }
    },
    layout: {
      improvedLayout: true
    },
    physics: {
      enabled: true,
      stabilization: {
        enabled: true,
        iterations: 300,
        updateInterval: 50
      },
      barnesHut: {
        gravitationalConstant: -2000,
        centralGravity: 0.18,
        springLength: 180,
        springConstant: 0.04,
        damping: 0.09
      }
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      dragView: true,
      zoomView: true,
      multiselect: false
    }
  };

  networkInstance = new vis.Network(container, data, options);
  networkInstance.once('stabilizationIterationsDone', () => {
    networkInstance.fit({ animation: true, easingFunction: 'easeInOutQuad', duration: 600 });
  });
  networkInstance.on('resize', () => networkInstance.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } }));

  networkInstance.on('click', (params) => {
    if (params.nodes && params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.data && node.data.ip) {
        // Scroll table to host row
        const row = document.getElementById(`row-${node.data.ip.replace(/\./g, '_')}`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.add('highlight-row');
          setTimeout(() => row.classList.remove('highlight-row'), 2500);
        }
      }
    }
  });
}

function buildTopologyFromResults(results) {
  const nodes = [];
  const edges = [];

  // Map VLAN/subnet groups to colors
  const vlanMap = {};
  const vlanColors = ['#4facfe','#00f2fe','#10b981','#f59e0b','#ef4444','#8b5cf6','#fb7185'];
  let vlanIdx = 0;

  // Create subnet nodes
  const subnets = {};
  results.forEach(h => {
    const subnet = h.subnet || 'unknown';
    if (!subnets[subnet]) subnets[subnet] = { id: `subnet:${subnet}`, hosts: [] };
    subnets[subnet].hosts.push(h);
  });

  Object.keys(subnets).forEach((subnet, idx) => {
    nodes.push({ id: `subnet:${subnet}`, label: subnet, shape: 'box', color: '#222', font: { color: '#fff' }, data: { subnet } });
  });

  // Host nodes
  results.forEach(host => {
    const id = `host:${host.ip}`;
    const label = `${host.ip}\n${host.hostname !== 'N/A' ? host.hostname : ''}`;
    const vlan = host.vlan || 'default';
    if (!vlanMap[vlan]) vlanMap[vlan] = vlanColors[vlanIdx++ % vlanColors.length];

    const color = host.environment === 'OT/ICS' ? '#ff8a65' : (host.isDMZ ? '#f59e0b' : vlanMap[vlan]);

    nodes.push({ id, label, title: `${host.ip}\n${host.vendor}\n${host.os}`, group: vlan, color: { background: color }, data: { ip: host.ip, host } });

    // Edge to subnet
    const subnetId = `subnet:${host.subnet || 'unknown'}`;
    edges.push({ from: id, to: subnetId });
  });

  return { nodes, edges };
}

// Initialize Websocket connection on page load
connectWebSocket();
toggleCustomPorts();
updateStats();
