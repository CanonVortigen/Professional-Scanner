const mapStatus = document.getElementById('map-status');
const mapRefreshBtn = document.getElementById('map-refresh-btn');
const mapExportPngButton = document.getElementById('map-export-png');
const mapExportSvgButton = document.getElementById('map-export-svg');
const mapContainer = document.getElementById('map-page-canvas');

let Graph = null;
let latestResults = [];

window.addEventListener('DOMContentLoaded', () => {
  if (mapRefreshBtn) mapRefreshBtn.addEventListener('click', () => refreshTopology());
  if (mapExportPngButton) mapExportPngButton.addEventListener('click', () => exportMapImage('png'));
  if (mapExportSvgButton) mapExportSvgButton.addEventListener('click', () => exportMapImage('svg'));
  refreshTopology();
});

async function refreshTopology() {
  setStatus('Atualizando mapa...');
  try {
    const response = await fetch('/api/scan-results');
    if (!response.ok) throw new Error(`Falha ao obter resultados: ${response.statusText}`);
    const json = await response.json();
    latestResults = json.results || [];
    render3DMap(latestResults);
    setStatus(`${latestResults.length} hosts carregados em ${new Date(json.updated).toLocaleTimeString()}`);
  } catch (err) {
    setStatus(`Erro: ${err.message}`);
    if (mapContainer) mapContainer.innerHTML = `<div class="terminal-line error-msg">${err.message}</div>`;
  }
}

function setStatus(text) {
  if (mapStatus) mapStatus.textContent = text;
}

function render3DMap(results) {
  if (!mapContainer) return;
  mapContainer.innerHTML = '';

  if (!results || results.length === 0) {
    mapContainer.innerHTML = '<div class="terminal-line system-msg">Nenhum resultado de varredura disponível para gerar o mapa.</div>';
    return;
  }

  // Build nodes and links
  const nodes = [];
  const links = [];
  const subnetIndex = {};

  results.forEach((host) => {
    const ipId = host.ip;
    const subnet = host.subnet || 'unknown';
    const subnetId = `subnet:${subnet}`;

    if (!subnetIndex[subnet]) {
      subnetIndex[subnet] = true;
      nodes.push({ id: subnetId, name: subnet, group: 'subnet', val: 6 });
    }

    const name = host.hostname && host.hostname !== 'N/A' ? `${host.ip} - ${host.hostname}` : host.ip;
    const color = host.isDMZ ? '#f59e0b' : (host.environment === 'OT/ICS' ? '#ff8a65' : '#4facfe');
    nodes.push({ id: ipId, name, group: host.vlan || 'default', val: Math.max(2, (host.ports || []).length), color });
    links.push({ source: ipId, target: subnetId });
  });

  // Initialize 3d-force-graph
  Graph = ForceGraph3D()(mapContainer)
    .graphData({ nodes, links })
    .nodeAutoColorBy('group')
    .nodeLabel(node => `IP: ${node.id}\n${node.name || ''}`)
    .linkDirectionalParticles(0)
    .linkWidth(1.2)
    .nodeRelSize(4)
    .onNodeClick(node => {
      if (node && node.id && window.opener && !window.opener.closed) {
        try {
          const rowId = `row-${node.id.replace(/\./g, '_')}`;
          const row = window.opener.document.getElementById(rowId);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('highlight-row');
            setTimeout(() => row.classList.remove('highlight-row'), 2500);
          }
        } catch (e) {
          console.warn('Unable to access opener document or highlight row:', e.message);
        }
      }
    });

  // Apply custom materials/colors after scene is ready
  Graph.nodeThreeObject(node => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(generateNodeCanvas(node.name || node.id, node.color || '#4facfe')),
      depthWrite: false
    }));
    sprite.scale.set(40, 20, 1);
    return sprite;
  });

  // fit camera to graph
  setTimeout(() => {
    try { Graph.zoomToFit(400); } catch (e) {}
  }, 500);
}

function generateNodeCanvas(text, bgColor) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const padding = 6;
  ctx.font = '12px Plus Jakarta Sans, Arial';
  const metrics = ctx.measureText(text);
  const textWidth = Math.min(metrics.width, 160);
  canvas.width = textWidth + padding * 2;
  canvas.height = 20 + padding * 2;
  // background
  ctx.fillStyle = bgColor || '#4facfe';
  roundRect(ctx, 0, 0, canvas.width, canvas.height, 6);
  ctx.fill();
  // text
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function exportMapImage(format) {
  if (!Graph) {
    setStatus('Mapa indisponível para exportação.');
    return;
  }

  const canvas = mapContainer.querySelector('canvas');
  if (!canvas) {
    setStatus('Canvas do mapa não encontrado.');
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

  setStatus('Exportação SVG não suportada. Utilize PNG.');
}
