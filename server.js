const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const dns = require('dns').promises;
const net = require('net');
const dgram = require('dgram');
const express = require('express');
const ExcelJS = require('exceljs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

app.post('/export-xlsx', async (req, res) => {
  const results = Array.isArray(req.body.results) ? req.body.results : [];

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Scan');

  worksheet.columns = [
    { header: 'IP', key: 'ip', width: 18 },
    { header: 'Estado', key: 'status', width: 16 },
    { header: 'Hostname', key: 'hostname', width: 24 },
    { header: 'Endereço MAC', key: 'mac', width: 20 },
    { header: 'Fabricante', key: 'vendor', width: 24 },
    { header: 'Sistema Operacional', key: 'os', width: 20 },
    { header: 'VM', key: 'vm', width: 10 },
    { header: 'Domínio AD', key: 'adDomain', width: 20 },
    { header: 'Portas Abertas (Serviços)', key: 'ports', width: 48 }
  ];

  worksheet.autoFilter = 'A1:I1';
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2F4F4F' }
  };

  for (const [index, host] of results.entries()) {
    const portsStr = host.ports && host.ports.length > 0
      ? host.ports.map(p => `${p.port}/${p.protocol} (${p.service})`).join(', ')
      : 'Nenhuma';

    worksheet.addRow({
      ip: host.ip,
      status: host.status,
      hostname: host.hostname,
      mac: host.mac,
      vendor: host.vendor,
      os: host.os,
      vm: host.vm || 'Não',
      adDomain: host.adDomain || 'N/A',
      ports: portsStr
    });

    const row = worksheet.getRow(index + 2);
    if (index % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5F5' }
      };
    }
  }

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.alignment = { vertical: 'middle', wrapText: true };
  });

  try {
    const buffer = await workbook.xlsx.writeBuffer();

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
    const fileName = `redes_scan_${dateStr}_${timeStr}.xlsx`;
    const targetDir = getCsvTargetDir();

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, buffer);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Erro exportando XLSX:', error);
    res.status(500).json({ error: 'Falha ao gerar o arquivo Excel.' });
  }
});

// MAC Vendor Database (OUI)
const MAC_VENDORS = {
  '00000C': 'Cisco Systems',
  '000D3A': 'Microsoft',
  '0010FA': 'Apple',
  '001C42': 'Parallels',
  '00155D': 'Microsoft Hyper-V',
  '000569': 'VMware',
  '000C29': 'VMware',
  '005056': 'VMware',
  '3C5A37': 'Apple',
  '705A0F': 'Hewlett Packard',
  'ACDE48': 'Apple',
  'FC3497': 'Apple',
  'C025E9': 'Apple',
  'A45E60': 'Apple',
  'F01898': 'Apple',
  'F40F24': 'Apple',
  'E4E0A6': 'Huawei',
  'B4B52F': 'Samsung',
  'D4F590': 'Dell',
  '001422': 'Dell',
  '0026B9': 'Dell',
  '180373': 'Dell',
  '0021CC': 'Intel',
  '001E68': 'Intel',
  '001377': 'Intel',
  'BC5436': 'Intel',
  'E0DB55': 'Intel',
  '708BCD': 'ASUSTek Computer',
  'E89A8F': 'ASUSTek Computer',
  '40163B': 'ASUSTek Computer',
  'A4EDB8': 'Xiaomi',
  '2C26C5': 'Xiaomi',
  '001788': 'Philips Lighting',
  '001132': 'Synology',
  '00116B': 'Iomega',
  '50C7BF': 'TP-Link',
  'E8DE27': 'TP-Link',
  'F81A67': 'TP-Link',
  '90F652': 'TP-Link',
  'B0B867': 'TP-Link',
  '0418D6': 'Ubiquiti Networks',
  '24A43C': 'Ubiquiti Networks',
  '788A20': 'Ubiquiti Networks',
  'FCECDA': 'Ubiquiti Networks',
  'B827EB': 'Raspberry Pi Foundation',
  'D83ADD': 'Raspberry Pi Foundation',
  'DCA632': 'Raspberry Pi Foundation',
  'E45F01': 'Raspberry Pi Foundation',
  '0014D1': 'TRENDnet',
  '000F66': 'Cisco',
  '001E13': 'Cisco',
  '002A10': 'Cisco',
  '0014BF': 'Linksys',
  '001839': 'Linksys',
  '002275': 'Belkin',
  '001CDF': 'Belkin',
  '001F33': 'Netgear',
  '0024B2': 'Netgear',
  'E03F49': 'Netgear'
};

// Port services and banners configurations
const TCP_SERVICES = {
  21: { name: 'FTP', probe: null },
  22: { name: 'SSH', probe: null },
  23: { name: 'Telnet', probe: null },
  25: { name: 'SMTP', probe: null },
  53: { name: 'DNS', probe: null },
  80: { name: 'HTTP', probe: 'GET / HTTP/1.0\r\n\r\n' },
  110: { name: 'POP3', probe: null },
  135: { name: 'MS-RPC', probe: null },
  139: { name: 'NetBIOS', probe: null },
  143: { name: 'IMAP', probe: null },
  443: { name: 'HTTPS', probe: 'GET / HTTP/1.0\r\n\r\n' },
  445: { name: 'Microsoft-DS', probe: null },
  1433: { name: 'MSSQL', probe: null },
  3306: { name: 'MySQL', probe: null },
  3389: { name: 'RDP', probe: null },
  8080: { name: 'HTTP-Proxy', probe: 'GET / HTTP/1.0\r\n\r\n' }
};

const UDP_SERVICES = {
  53: 'DNS',
  67: 'DHCP Server',
  68: 'DHCP Client',
  123: 'NTP',
  137: 'NetBIOS-NS',
  138: 'NetBIOS-DGM',
  161: 'SNMP',
  162: 'SNMP-Trap',
  445: 'Microsoft-DS'
};

// Utility to parse IP Range / CIDR
function parseTarget(target) {
  target = target.trim();
  const ips = [];

  // 1. CIDR notation (e.g. 192.168.1.0/24)
  if (target.includes('/')) {
    const parts = target.split('/');
    const baseIp = parts[0];
    const mask = parseInt(parts[1], 10);
    if (mask < 0 || mask > 32) return [];

    const ipNum = ipToLong(baseIp);
    const numHosts = Math.pow(2, 32 - mask);
    const maskBuffer = mask === 0 ? 0 : (~0 << (32 - mask));
    const startIpNum = (ipNum & maskBuffer) >>> 0;
    
    // For large networks, limit safety size to /24 (256 hosts) to avoid crashing local scanners
    const limit = Math.min(numHosts, 1024); 
    for (let i = 0; i < limit; i++) {
      ips.push(longToIp(startIpNum + i));
    }
  } 
  // 2. Dash range (e.g. 192.168.1.1-192.168.1.50 or 192.168.1.1-50)
  else if (target.includes('-')) {
    const parts = target.split('-');
    const startIpStr = parts[0].trim();
    let endIpStr = parts[1].trim();

    if (!endIpStr.includes('.')) {
      const startOctets = startIpStr.split('.');
      startOctets[3] = endIpStr;
      endIpStr = startOctets.join('.');
    }

    const startNum = ipToLong(startIpStr);
    const endNum = ipToLong(endIpStr);

    if (startNum <= endNum && (endNum - startNum) <= 1024) {
      for (let i = startNum; i <= endNum; i++) {
        ips.push(longToIp(i));
      }
    }
  } 
  // 3. Single IP
  else if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(target)) {
    ips.push(target);
  }

  return ips;
}

function ipToLong(ip) {
  return ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0;
}

function longToIp(long) {
  return [
    (long >>> 24) & 0xFF,
    (long >>> 16) & 0xFF,
    (long >>> 8) & 0xFF,
    long & 0xFF
  ].join('.');
}

// OS Heuristics from TTL
function getOSFromTTL(ttl) {
  if (!ttl) return 'Desconhecido';
  if (ttl <= 64) return 'Linux / macOS / Android';
  if (ttl <= 128) return 'Windows';
  if (ttl <= 255) return 'Dispositivo de Rede (Cisco/Router/Embedded)';
  return 'Desconhecido';
}

// MAC Vendor Lookup
function getVendorFromMac(mac) {
  if (!mac || mac === 'N/A') return 'Desconhecido';
  const prefix = mac.replace(/[:-]/g, '').slice(0, 6).toUpperCase();
  return MAC_VENDORS[prefix] || 'Desconhecido (Fabricante Genérico)';
}

// Ping sweep implementation
function pingHost(ip, timeoutMs) {
  return new Promise((resolve) => {
    // Windows ping syntax: ping -n 1 -w timeout ip
    exec(`ping -n 1 -w ${timeoutMs} ${ip}`, (error, stdout, stderr) => {
      if (error) {
        resolve({ ip, active: false, ttl: null });
        return;
      }
      
      // Matches TTL in English (TTL=128) or Portuguese (TTL=128)
      const ttlMatch = stdout.match(/TTL=(\d+)/i);
      if (ttlMatch) {
        const ttl = parseInt(ttlMatch[1], 10);
        resolve({ ip, active: true, ttl });
      } else {
        // Double check if output reports success but no TTL (e.g. localhost)
        if (stdout.includes('resposta de') || stdout.includes('reply from') || stdout.includes('0% de perda') || stdout.includes('0% loss')) {
          resolve({ ip, active: true, ttl: 64 }); // Default fallback TTL
        } else {
          resolve({ ip, active: false, ttl: null });
        }
      }
    });
  });
}

// DNS reverse lookup
async function resolveHostname(ip) {
  try {
    const hostnames = await dns.reverse(ip);
    return hostnames[0] || 'N/A';
  } catch (err) {
    return 'N/A';
  }
}

// MAC Address lookup via ARP table
function getMacAddress(ip) {
  return new Promise((resolve) => {
    // Windows arp command: arp -a ip
    exec(`arp -a ${ip}`, (error, stdout, stderr) => {
      if (error || !stdout) {
        resolve('N/A');
        return;
      }

      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(ip)) {
          // Regex to match MAC address formats (e.g., 00-11-22-33-44-55 or 00:11:22:33:44:55)
          const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})/);
          if (macMatch) {
            resolve(macMatch[0].toUpperCase().replace(/:/g, '-'));
            return;
          }
        }
      }
      resolve('N/A');
    });
  });
}

// TCP Port Scan & Service/Version Detection
function scanTcpPort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = 'closed';
    let serviceName = TCP_SERVICES[port]?.name || 'Desconhecido';
    let version = 'N/A';

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      status = 'open';
      
      // If service supports trigger probe, send it to grab version details
      const serviceInfo = TCP_SERVICES[port];
      if (serviceInfo && serviceInfo.probe) {
        socket.write(serviceInfo.probe);
      }
    });

    socket.on('data', (data) => {
      const banner = data.toString('utf8', 0, 100).trim();
      
      // Extract HTTP/HTTPS server header
      if (port === 80 || port === 8080 || port === 443) {
        const serverHeader = banner.match(/Server:\s*([^\r\n]+)/i);
        version = serverHeader ? serverHeader[1] : 'HTTP Server';
      } else {
        // Standard banner cleanups
        version = banner.replace(/[\r\n]+/g, ' ').substring(0, 50);
      }
      socket.destroy();
    });

    socket.on('timeout', () => {
      status = 'filtered';
      socket.destroy();
    });

    socket.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        status = 'closed';
      } else {
        status = 'filtered';
      }
    });

    socket.on('close', () => {
      resolve({ port, protocol: 'TCP', state: status, service: serviceName, version });
    });

    socket.connect(port, ip);
  });
}

// UDP Port Scan
function scanUdpPort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const client = dgram.createSocket('udp4');
    let state = 'open | filtered'; // Standard UDP result without raw socket ICMP catches
    let serviceName = UDP_SERVICES[port] || 'Desconhecido';
    let version = 'N/A';

    client.send(Buffer.from([0x00]), port, ip, (err) => {
      if (err) {
        state = 'closed';
        client.close();
        resolve({ port, protocol: 'UDP', state, service: serviceName, version });
        return;
      }
    });

    client.on('message', (msg) => {
      state = 'open';
      version = msg.toString('utf8', 0, 50).trim().replace(/[\r\n]+/g, ' ');
      client.close();
    });

    const timer = setTimeout(() => {
      client.close();
      resolve({ port, protocol: 'UDP', state, service: serviceName, version });
    }, timeoutMs);

    client.on('error', () => {
      state = 'closed';
      clearTimeout(timer);
      client.close();
    });
  });
}

// Custom Promise-based Worker Pool for Concurrency/Multi-threading
async function runConcurrent(tasks, limit, onTaskComplete) {
  const results = [];
  const executing = new Set();

  for (const taskFn of tasks) {
    const p = Promise.resolve().then(() => taskFn());
    results.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean, clean);

    // Call progress callback on individual task completions
    if (onTaskComplete) {
      p.then((res) => onTaskComplete(res)).catch(() => {});
    }

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

// Helper: get current user's home directory for dynamic path
function getUserHome() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

// Helper: get CSV target directory dynamically
function getCsvTargetDir() {
  return path.join(getUserHome(), 'Documents', 'python files', 'csv');
}

// Helper: get AD domain (Windows)
function getADDomain() {
  try {
    // Primeiro tenta obter via WMIC
    const output = execSync('wmic computersystem get domain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = output.split('\n').filter(l => l.trim() !== '');
    if (lines.length >= 2 && lines[1].trim()) {
      return lines[1].trim();
    }
    // Fallback usando PowerShell (mais universal em Windows modernos)
    const psOutput = execSync('powershell -NoProfile -Command "(Get-WmiObject -Class Win32_ComputerSystem).Domain"', { encoding: 'utf8' });
    const domain = psOutput.toString().trim();
    return domain || 'N/A';
  } catch (e) {
    return 'N/A';
  }
}

// Helper: detect VM based on MAC and Vendor
function detectVM(mac, vendor) {
  const vmMacPrefixes = ['00-05-69', '00-0C-29', '00-50-56', '08-00-27', '00-03-FF'];
  const vmVendors = ['VMware', 'VirtualBox', 'QEMU', 'Xen', 'Hyper-V', 'Microsoft Corporation'];
  
  const isVmMac = vmMacPrefixes.some(prefix => mac.startsWith(prefix));
  const isVmVendor = vmVendors.some(v => vendor && vendor.includes(v));
  
  return (isVmMac || isVmVendor) ? 'Sim' : 'Não';
}

// WebSocket handler
wss.on('connection', (ws) => {
  console.log('[WS] Novo cliente conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start') {
        const { target, portsTCP, portsUDP, timeout, concurrency, scanUdp } = data;
        
        const ipList = parseTarget(target);
        if (ipList.length === 0) {
          ws.send(JSON.stringify({ type: 'error', message: 'Alvo inválido! Insira um IP, faixa (ex: 192.168.1.1-50) ou CIDR (ex: 192.168.1.0/24).' }));
          return;
        }

        ws.send(JSON.stringify({ type: 'scan_started', total: ipList.length }));
        ws.send(JSON.stringify({ type: 'log', message: `[*] Iniciando varredura em ${ipList.length} endereço(s)...` }));
        ws.send(JSON.stringify({ type: 'log', message: `[*] Configurações: Threads/Concorrência=${concurrency}, Timeout=${timeout}ms` }));

        const startTime = Date.now();
        let activeCount = 0;
        let inactiveCount = 0;
        const hasPorts = (portsTCP && portsTCP.length > 0) || (scanUdp && portsUDP && portsUDP.length > 0);

        // 1. Host Discovery Stage
        ws.send(JSON.stringify({ type: 'log', message: `[~] FASE 1: Varredura de Hosts Ativos...` }));
        
        let completedPings = 0;
        const pingTasks = ipList.map(ip => () => pingHost(ip, timeout));
        
        const pingResults = await runConcurrent(pingTasks, concurrency, (res) => {
          completedPings++;
          const phase1Progress = Math.round((completedPings / ipList.length) * (hasPorts ? 30 : 50));
          ws.send(JSON.stringify({ type: 'progress', percent: phase1Progress }));
          if (res.active) {
            ws.send(JSON.stringify({ type: 'log', message: `[+] Host Ativo detectado: ${res.ip} (TTL=${res.ttl})` }));
          }
        });

        const activeHosts = [];
        const inactiveHosts = [];

        // 2. Details Enrichment Stage (DNS, MAC, OS, Vendor)
        ws.send(JSON.stringify({ type: 'log', message: `[~] FASE 2: Resolvendo detalhes dos Hosts (MAC, Fabricante, OS, Hostname)...` }));

        let completedDetails = 0;
        const detailTasks = pingResults.map(pingRes => async () => {
          const { ip, active, ttl } = pingRes;

          if (active) {
            activeCount++;
            const hostname = await resolveHostname(ip);
            const mac = await getMacAddress(ip);
            const vendor = getVendorFromMac(mac);
            const os = getOSFromTTL(ttl);
            const vm = detectVM(mac, vendor);
            const adDomain = getADDomain();

            const hostDetails = {
              ip,
              status: 'Ativo',
              hostname,
              mac,
              vendor,
              os,
              vm,
              adDomain,
              ports: []
            };

            ws.send(JSON.stringify({ 
              type: 'host_found', 
              host: hostDetails,
              log: `[i] Detalhes de ${ip}: Hostname=${hostname} | MAC=${mac} | Fabricante=${vendor} | OS OS=${os}`
            }));

            activeHosts.push(hostDetails);
          } else {
            inactiveCount++;
            const hostDetails = {
              ip,
              status: 'Inativo',
              hostname: 'N/A',
              mac: 'N/A',
              vendor: 'N/A',
              os: 'N/A',
              vm: 'Não',
              adDomain: 'N/A',
              ports: []
            };

            ws.send(JSON.stringify({ 
              type: 'host_inactive', 
              host: hostDetails,
              log: `[-] Host Inativo: ${ip}`
            }));

            inactiveHosts.push(hostDetails);
          }

          completedDetails++;
          const phase2Start = hasPorts ? 30 : 50;
          const phase2Weight = hasPorts ? 30 : 50;
          const phase2Progress = phase2Start + Math.round((completedDetails / ipList.length) * phase2Weight);
          ws.send(JSON.stringify({ type: 'progress', percent: phase2Progress }));
        });

        await runConcurrent(detailTasks, concurrency);

        // 3. Port Scanning Stage for Active Hosts
        if (activeHosts.length > 0 && hasPorts) {
          ws.send(JSON.stringify({ type: 'log', message: `[~] FASE 3: Varredura de Portas nos Hosts Ativos...` }));

          const totalPortsToScan = (portsTCP?.length || 0) + (scanUdp ? (portsUDP?.length || 0) : 0);
          const totalPortChecks = activeHosts.length * totalPortsToScan;
          let completedPortChecks = 0;

          for (const host of activeHosts) {
            const portTasks = [];
            
            // TCP Ports
            if (portsTCP && portsTCP.length > 0) {
              portsTCP.forEach(port => {
                portTasks.push(async () => {
                  const res = await scanTcpPort(host.ip, port, timeout);
                  
                  completedPortChecks++;
                  const phase3Progress = 60 + Math.round((completedPortChecks / totalPortChecks) * 40);
                  ws.send(JSON.stringify({ type: 'progress', percent: phase3Progress }));

                  if (res.state === 'open' || res.state === 'filtered') {
                    ws.send(JSON.stringify({
                      type: 'port_result',
                      ip: host.ip,
                      portResult: res,
                      log: `[+] [${res.protocol}] ${host.ip}:${res.port} está ${res.state.toUpperCase()} (Serviço: ${res.service} ${res.version !== 'N/A' ? '| Versão: ' + res.version : ''})`
                    }));
                  }
                  return res;
                });
              });
            }

            // UDP Ports
            if (scanUdp && portsUDP && portsUDP.length > 0) {
              portsUDP.forEach(port => {
                portTasks.push(async () => {
                  const res = await scanUdpPort(host.ip, port, timeout);
                  
                  completedPortChecks++;
                  const phase3Progress = 60 + Math.round((completedPortChecks / totalPortChecks) * 40);
                  ws.send(JSON.stringify({ type: 'progress', percent: phase3Progress }));

                  if (res.state === 'open' || res.state === 'open | filtered') {
                    ws.send(JSON.stringify({
                      type: 'port_result',
                      ip: host.ip,
                      portResult: res,
                      log: `[+] [${res.protocol}] ${host.ip}:${res.port} está ${res.state.toUpperCase()} (Serviço: ${res.service})`
                    }));
                  }
                  return res;
                });
              });
            }

            // Run port scan for this specific host
            const portResults = await runConcurrent(portTasks, concurrency);
            host.ports = portResults.filter(p => p.state === 'open' || p.state === 'filtered' || p.state === 'open | filtered');
          }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        ws.send(JSON.stringify({
          type: 'complete',
          summary: {
            active: activeCount,
            inactive: inactiveCount,
            total: ipList.length,
            time: duration
          },
          log: `[*] Varredura Concluída! Total de IPs: ${ipList.length} | Ativos: ${activeCount} | Inativos: ${inactiveCount} | Tempo decorrido: ${duration}s`
        }));
      } else if (data.type === 'export_csv') {
        const { results } = data;
        let csvContent = '\uFEFF'; // Add BOM for Excel UTF-8
        csvContent += 'IP;Estado;Hostname;Endereço MAC;Fabricante;Sistema Operacional;VM;Domínio AD;Portas Abertas (Serviços)\r\n';

        results.forEach(host => {
          const portsStr = host.ports && host.ports.length > 0 
            ? host.ports.map(p => `${p.port}/${p.protocol} (${p.service})`).join(', ')
            : 'Nenhuma';
          const row = [
              host.ip,
              host.status,
              host.hostname,
              host.mac,
              host.vendor,
              host.os,
              host.vm,
              host.adDomain,
              `"${portsStr}"`
            ].join(';');

          csvContent += row + '\r\n';
        });

        try {
          const targetDir = getCsvTargetDir();
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          const now = new Date();
          const dateStr = now.toISOString().slice(0, 10);
          const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
          const fileName = `redes_scan_${dateStr}_${timeStr}.csv`;
          const filePath = path.join(targetDir, fileName);

          fs.writeFileSync(filePath, csvContent, 'utf8');
          ws.send(JSON.stringify({ 
            type: 'log', 
            message: `[+] CSV salvo com sucesso localmente em:\n    ${filePath}` 
          }));
        } catch (err) {
          ws.send(JSON.stringify({ 
            type: 'log', 
            message: `[!] Erro ao salvar arquivo CSV no caminho especificado: ${err.message}` 
          }));
        }
      }
    } catch (err) {
      console.error(err);
      ws.send(JSON.stringify({ type: 'error', message: 'Erro no servidor durante a varredura.' }));
    }
  });

  ws.on('close', () => {
    console.log('[WS] Cliente desconectado');
  });
});

// Start Express server
server.listen(PORT, () => {
  console.log(`[HTTP] Servidor rodando em http://localhost:${PORT}`);
});
