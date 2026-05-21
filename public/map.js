const mapStatus = document.getElementById('map-status');
const mapRefreshBtn = document.getElementById('map-refresh-btn');
const mapExportPngButton = document.getElementById('map-export-png');
const mapExportSvgButton = document.getElementById('map-export-svg');
const mapContainer = document.getElementById('map-page-canvas');

let mapNetwork = null;
let mapTopology = null;

window.addEventListener('DOMContentLoaded', () => {
  mapRefreshBtn.addEventListener('click', () => refreshTopology());
  mapExportPngButton.addEventListener('click', () => exportMapImage('png'));
  mapExportSvgButton.addEventListener('click', () => exportMapImage('svg'));
  refreshTopology();
});

async function refreshTopology() {
  setStatus('Atualizando mapa...');
  try {
    const response = await fetch('/api/scan-results');
    if (!response.ok) throw new Error(`Falha ao obter resultados: ${response.statusText}`);
    const json = await response.json();
    const results = json.results || [];
    renderMap(results);
    setStatus(`${results.length} hosts carregados em ${new Date(json.updated).toLocaleTimeString()}`);
  } catch (err) {
    setStatus(`Erro: ${err.message}`);
    mapContainer.innerHTML = `<div class="terminal-line error-msg">${err.message}</div>`;
  }
}

function setStatus(text) {
  mapStatus.textContent = text;
}

function renderMap(results) {
  const { nodes, edges } = buildTopologyFromResults(results);
  mapTopology = { nodes, edges };

  if (mapNetwork) {
    try { mapNetwork.destroy(); } catch (e) {}
    mapNetwork = null;
  }

  mapContainer.innerHTML = '';
  if (nodes.length === 0) {
    mapContainer.innerHTML = '<div class="terminal-line system-msg">Nenhum resultado de varredura disponível para gerar o mapa.</div>';
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
      font: { color: '#ffffff' }
    },
    edges: {
      color: { color: '#888' },
      smooth: { type: 'cubicBezier' }
    },
    physics: {
      stabilization: true,
      barnesHut: { gravitationalConstant: -2000, centralGravity: 0.3 }
    },
    interaction: { hover: true, tooltipDelay: 100 }
  };

  mapNetwork = new vis.Network(mapContainer, data, options);
  mapNetwork.on('click', (params) => {
    if (params.nodes && params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.data && node.data.ip) {
        const message = `Host selecionado: ${node.data.ip}`;
        setStatus(message);
      }
    }
  });
}

function buildTopologyFromResults(results) {
  const nodes = [];
  const edges = [];
  const vlanMap = {};
  const vlanColors = ['#4facfe','#00f2fe','#10b981','#f59e0b','#ef4444','#8b5cf6','#fb7185'];
  let vlanIdx = 0;
  const subnets = {};

  results.forEach(h => {
    const subnet = h.subnet || 'unknown';
    if (!subnets[subnet]) subnets[subnet] = { id: `subnet:${subnet}`, hosts: [] };
    subnets[subnet].hosts.push(h);
  });

  Object.keys(subnets).forEach(subnet => {
    nodes.push({ id: `subnet:${subnet}`, label: subnet, shape: 'box', color: '#222', font: { color: '#fff' }, data: { subnet } });
  });

  results.forEach(host => {
    const id = `host:${host.ip}`;
    const label = `${host.ip}\n${host.deviceType || (host.hostname !== 'N/A' ? host.hostname : '')}`;
    const vlan = host.vlan || 'default';
    if (!vlanMap[vlan]) vlanMap[vlan] = vlanColors[vlanIdx++ % vlanColors.length];

    const color = host.environment === 'OT/ICS' ? '#ff8a65' : (host.isDMZ ? '#f59e0b' : vlanMap[vlan]);
    const title = `${host.ip}\n${host.deviceType || 'Host Ativo'}\n${host.vendor}\n${host.os}`;
    nodes.push({ id, label, title, group: vlan, color: { background: color }, data: { ip: host.ip, host } });
    const subnetId = `subnet:${host.subnet || 'unknown'}`;
    edges.push({ from: id, to: subnetId });
  });

  return { nodes, edges };
}

function exportMapImage(format) {
  if (!mapNetwork || !mapTopology) {
    setStatus('Mapa indisponível para exportação. Gere o mapa primeiro.');
    return;
  }

  if (format === 'png') {
    const canvas = mapContainer.querySelector('canvas');
    if (!canvas) return setStatus('Canvas não encontrado para exportar PNG.');
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
    if (!svgText) return setStatus('Não foi possível gerar o SVG.');
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
  if (!mapNetwork || !mapTopology) return null;

  const positions = mapNetwork.getPositions();
  const padding = 50;
  const points = Object.values(positions);
  if (points.length === 0) return null;

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
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

  const edgeSvg = mapTopology.edges.map(edge => {
    const from = getPoint(edge.from);
    const to = getPoint(edge.to);
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#888" stroke-width="2" opacity="0.75"/>`;
  }).join('');

  const nodeSvg = mapTopology.nodes.map(node => {
    const pos = getPoint(node.id);
    const fill = (node.color && node.color.background) || '#4facfe';
    return `\n      <g>\n        <circle cx="${pos.x}" cy="${pos.y}" r="18" fill="${fill}" stroke="#fff" stroke-width="2" opacity="0.95" />\n        <text x="${pos.x}" y="${pos.y + 5}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" fill="#fff">${escapeXml(node.label)}</text>\n      </g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <rect width="100%" height="100%" fill="#05070a" />\n  ${edgeSvg}\n  ${nodeSvg}\n</svg>`;
}
