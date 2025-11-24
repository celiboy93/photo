// Deno Deploy / KV Database
const kv = await Deno.openKv();

// --- CONFIG ---
// Deno Env ထဲမှာ ADMIN_PASS မရှိရင် "1234" ကို သုံးမယ်
const ADMIN_PASS = Deno.env.get("ADMIN_PASS") || "1234";

// --- MAIN SERVER ---
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const cookie = req.headers.get("Cookie") || "";
  const isAuth = cookie.includes(`auth=${ADMIN_PASS}`);

  // --- 1. LOGIN / LOGOUT ---
  if (req.method === "POST" && url.pathname === "/login") {
      const form = await req.formData();
      if (form.get("pass") === ADMIN_PASS) {
          const h = new Headers({ "Location": "/", "Set-Cookie": `auth=${ADMIN_PASS}; Path=/; HttpOnly; Max-Age=2592000` });
          return new Response(null, { status: 303, headers: h });
      }
      return new Response("Wrong Password! <a href='/'>Back</a>", { headers: {"content-type":"text/html"} });
  }
  if (url.pathname === "/logout") {
      const h = new Headers({ "Location": "/", "Set-Cookie": `auth=; Path=/; Max-Age=0` });
      return new Response(null, { status: 303, headers: h });
  }

  // --- 2. API ACTIONS (Protected) ---
  if (req.method === "POST") {
      if (!isAuth) return new Response("Unauthorized", { status: 401 });

      // Save Image
      if (url.pathname === "/api/save") {
          try {
              const { image, name } = await req.json();
              if (image) {
                  const id = Date.now().toString();
                  // FIX: Myanmar Timezone
                  const mmTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Yangon" });
                  await kv.set(["photos", id], { data: image, name: name, date: mmTime, hidden: false });
                  return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
              }
          } catch (e) { return new Response(JSON.stringify({ status: "error" }), { headers: { "Content-Type": "application/json" } }); }
      }

      // Delete Image (Permanently)
      if (url.pathname === "/api/delete") {
          const { id } = await req.json();
          await kv.delete(["photos", id]);
          return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
      }

      // Clear History List Only (Hide items, keep files)
      if (url.pathname === "/api/clear_history") {
          const iter = kv.list({ prefix: ["photos"] });
          for await (const entry of iter) {
              const val = entry.value as any;
              // Set hidden flag to true
              await kv.set(entry.key, { ...val, hidden: true });
          }
          return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
      }
  }

  // --- 3. PROXY (Protected) ---
  if (url.pathname === "/api/proxy") {
      if (!isAuth) return new Response("Unauthorized", { status: 401 });
      const target = url.searchParams.get("url");
      if(target) {
          try {
              const imgRes = await fetch(target);
              const blob = await imgRes.blob();
              return new Response(blob, { headers: { "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg" }});
          } catch(e) { return new Response("Error", {status: 500}); }
      }
  }

  // --- 4. VIEW IMAGE (Public Access) ---
  if (url.pathname.startsWith("/img/")) {
      const id = url.pathname.split("/")[2];
      const entry = await kv.get(["photos", id]);
      if (entry.value) {
          const data = (entry.value as any).data;
          const binStr = atob(data.split(',')[1]);
          const len = binStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
          return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=31536000" } });
      }
      return new Response("Image Not Found", { status: 404 });
  }

  // --- 5. UI PAGE ---
  const photos = [];
  const iter = kv.list({ prefix: ["photos"] }, { reverse: true });
  for await (const entry of iter) {
      const val = entry.value as any;
      // Show only if NOT hidden
      if (!val.hidden) {
          photos.push({ id: entry.key[1], ...val });
      }
  }

  // LOGIN FORM UI
  if (!isAuth) {
      return new Response(`
      <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-900 text-white flex items-center justify-center h-screen">
         <form action="/login" method="POST" class="bg-gray-800 p-8 rounded-xl text-center space-y-4 shadow-xl border border-gray-700">
            <h1 class="text-xl font-bold">Admin Access</h1>
            <input type="password" name="pass" placeholder="Password" class="bg-gray-700 border border-gray-600 p-2 rounded w-full text-center focus:outline-none focus:border-blue-500">
            <button class="bg-blue-600 w-full py-2 rounded font-bold hover:bg-blue-700">Login</button>
         </form>
      </body></html>`, { headers: { "content-type": "text/html" } });
  }

  // ADMIN DASHBOARD UI
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Image Keeper (Admin)</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <style>
        body { background: #111827; color: #e5e7eb; font-family: sans-serif; }
        .custom-scroll::-webkit-scrollbar { width: 6px; }
        .custom-scroll::-webkit-scrollbar-track { background: #1f2937; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: #6b7280; }
      </style>
    </head>
    <body class="min-h-screen p-4 sm:p-8">
      <div class="max-w-3xl mx-auto">
        <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold text-blue-400 flex items-center gap-2"><i class="fas fa-database"></i> Image Storage</h1>
            <a href="/logout" class="text-red-400 text-sm font-bold border border-red-900 bg-red-900/20 px-3 py-1 rounded hover:bg-red-900/50">Logout</a>
        </div>

        <div class="flex gap-2 mb-4">
            <button onclick="showTab('file')" id="btnFile" class="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold">File Upload</button>
            <button onclick="showTab('url')" id="btnUrl" class="flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg font-bold">Remote URL</button>
        </div>

        <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 mb-8 shadow-lg">
            <div id="tabFile">
                <input type="file" id="fileInput" accept="image/*" class="hidden" onchange="handleFile(this.files[0])">
                <label for="fileInput" class="cursor-pointer flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700/50 transition">
                    <i class="fas fa-cloud-upload-alt text-3xl text-gray-400 mb-2"></i>
                    <span class="text-sm text-gray-300">Click to Upload Image</span>
                </label>
            </div>
            <div id="tabUrl" class="hidden">
                <div class="flex gap-2">
                    <input type="text" id="urlInput" placeholder="Paste Image URL here..." class="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 text-white focus:outline-none focus:border-blue-500">
                    <button onclick="handleUrl()" class="bg-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-700">Get</button>
                </div>
            </div>
            <div id="loading" class="hidden mt-4 text-center text-yellow-400 text-sm font-mono"><i class="fas fa-circle-notch fa-spin"></i> Processing...</div>
        </div>

        <div>
            <div class="flex justify-between items-center border-b border-gray-700 pb-2 mb-4">
                <h2 class="text-lg font-bold text-white">History List (${photos.length})</h2>
                ${photos.length > 0 ? `<button onclick="clearHistory()" class="text-xs text-orange-400 hover:text-orange-300 border border-orange-900 bg-orange-900/20 px-3 py-1 rounded transition">Clear List Only</button>` : ''}
            </div>

            <!-- Scrollable Container (Fixed Height) -->
            <div class="space-y-3 max-h-[500px] overflow-y-auto custom-scroll pr-2">
                ${photos.length === 0 ? '<div class="text-center text-gray-600 py-8">No images in history.</div>' : ''}
                ${photos.map(p => `
                    <div class="bg-gray-800 p-3 rounded-lg border border-gray-700 flex items-center justify-between gap-3 group hover:border-blue-500/50 transition">
                        <div class="flex items-center gap-3 overflow-hidden">
                            <div class="w-10 h-10 rounded bg-gray-700 flex-shrink-0 flex items-center justify-center overflow-hidden"><img src="/img/${p.id}" class="w-full h-full object-cover"></div>
                            <div class="min-w-0"><p class="text-sm font-bold text-white truncate">${p.name}</p><p class="text-[10px] text-gray-500">${p.date}</p></div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            <button onclick="copyLink('${url.origin}/img/${p.id}')" class="bg-gray-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold transition"><i class="fas fa-copy"></i></button>
                            <a href="/img/${p.id}" target="_blank" class="bg-gray-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold transition"><i class="fas fa-eye"></i></a>
                            <button onclick="deleteImg('${p.id}')" class="bg-gray-700 hover:bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold transition"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>`).join('')}
            </div>
        </div>
      </div>
      <script>
        function showTab(t) {
            document.getElementById('tabFile').classList.toggle('hidden', t !== 'file');
            document.getElementById('tabUrl').classList.toggle('hidden', t !== 'url');
            document.getElementById('btnFile').className = t === 'file' ? 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold' : 'flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg font-bold';
            document.getElementById('btnUrl').className = t === 'url' ? 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold' : 'flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg font-bold';
        }
        function handleFile(file) { if(file) processImage(file, file.name); }
        async function handleUrl() {
            const url = document.getElementById('urlInput').value; if(!url) return;
            document.getElementById('loading').classList.remove('hidden');
            try { const res = await fetch('/api/proxy?url='+encodeURIComponent(url)); if(!res.ok) throw new Error(); const blob = await res.blob(); const name = url.split('/').pop().split('?')[0]||"remote.jpg"; processImage(new File([blob], name, {type:blob.type}), name); } 
            catch(e) { alert("Error fetching URL"); document.getElementById('loading').classList.add('hidden'); }
        }
        function processImage(file, fileName) {
            document.getElementById('loading').classList.remove('hidden');
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image(); img.src = e.target.result;
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height; const MAX = 800;
                    if (w > MAX) { h *= MAX / w; w = MAX; }
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                    let q = 0.7; let dataUrl = canvas.toDataURL('image/jpeg', q);
                    while (dataUrl.length > 60000 && q > 0.1) { q -= 0.1; dataUrl = canvas.toDataURL('image/jpeg', q); }
                    fetch('/api/save', { method: 'POST', body: JSON.stringify({ image: dataUrl, name: fileName }) }).then(() => location.reload());
                }
            }
            reader.readAsDataURL(file);
        }
        // Permanently Delete One
        function deleteImg(id) { if(confirm("Permanently delete this image?")) fetch('/api/delete', { method: 'POST', body: JSON.stringify({ id }) }).then(() => location.reload()); }
        
        // Hide All History (Keep Files)
        function clearHistory() { 
            if(confirm("Clear list only? (Files will remain accessible)")) {
                fetch('/api/clear_history', { method: 'POST' }).then(() => location.reload()); 
            }
        }
        
        function copyLink(txt) { navigator.clipboard.writeText(txt).then(() => alert("Link Copied!")); }
      </script>
    </body>
    </html>
  `, { headers: { "content-type": "text/html; charset=utf-8" } });
});
