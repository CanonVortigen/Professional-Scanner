// Simple validation test for scan helpers
const { exec } = require('child_process');
const dns = require('dns').promises;
const net = require('net');

// Imports or mocks from server.js for quick validation
function getOSFromTTL(ttl) {
  if (!ttl) return 'Desconhecido';
  if (ttl <= 64) return 'Linux / macOS / Android';
  if (ttl <= 128) return 'Windows';
  if (ttl <= 255) return 'Dispositivo de Rede (Cisco/Router/Embedded)';
  return 'Desconhecido';
}

function pingHost(ip, timeoutMs) {
  return new Promise((resolve) => {
    exec(`ping -n 1 -w ${timeoutMs} ${ip}`, (error, stdout, stderr) => {
      if (error) {
        resolve({ ip, active: false, ttl: null });
        return;
      }
      const ttlMatch = stdout.match(/TTL=(\d+)/i);
      if (ttlMatch) {
        const ttl = parseInt(ttlMatch[1], 10);
        resolve({ ip, active: true, ttl });
      } else {
        if (stdout.includes('resposta de') || stdout.includes('reply from') || stdout.includes('0% de perda') || stdout.includes('0% loss')) {
          resolve({ ip, active: true, ttl: 64 });
        } else {
          resolve({ ip, active: false, ttl: null });
        }
      }
    });
  });
}

function getMacAddress(ip) {
  return new Promise((resolve) => {
    exec(`arp -a ${ip}`, (error, stdout, stderr) => {
      if (error || !stdout) {
        resolve('N/A');
        return;
      }
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(ip)) {
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

async function runTests() {
  console.log('=== TESTE DE VALIDAÇÃO DO SCANNER ===');
  
  // 1. Test IP Range calculations
  console.log('\n[1] Testando parsing de IPs...');
  const testIp = '127.0.0.1';
  console.log(`IP de teste: ${testIp}`);

  // 2. Test Ping Sweep
  console.log('\n[2] Testando comando Ping...');
  const pingRes = await pingHost(testIp, 1000);
  console.log(`Resultado do Ping para ${testIp}:`, pingRes);
  if (pingRes.active) {
    console.log(`Detecção de OS baseada em TTL (${pingRes.ttl}):`, getOSFromTTL(pingRes.ttl));
  }

  // 3. Test Hostname reverse dns
  console.log('\n[3] Testando resolução reversa DNS...');
  try {
    const hostnames = await dns.reverse(testIp);
    console.log(`Hostname para ${testIp}:`, hostnames[0] || 'N/A');
  } catch (err) {
    console.log(`Hostname para ${testIp}: N/A (Sem reverse DNS configurado localmente)`);
  }

  // 4. Test ARP MAC
  console.log('\n[4] Testando comando ARP...');
  const macRes = await getMacAddress(testIp);
  console.log(`MAC Address no cache ARP para ${testIp}:`, macRes);

  console.log('\n=== TESTES CONCLUÍDOS ===');
}

runTests();
