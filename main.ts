import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const kv = await Deno.openKv();

serve(async (req) => {
  const url = new URL(req.url);

  // --- 1. SAVE IMAGE API (Database ထဲသိမ်းခြင်း) ---
  if (req.method === "POST" && url.pathname === "/api/save") {
      try {
          const { image, name } = await req.json();
          if (image) {
              const id = Date.now().toString();
              await kv.set(["photos", id], { data: image, name: name, date: new Date().toLocaleString() });
              return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
          }
      } catch (e) { return new Response(JSON.stringify({ status: "error" }), { headers: { "Content-Type": "application/json" } }); }
  }

  // --- 2. DELETE IMAGE API ---
  if (req.method === "POST" && url.pathname === "/api/delete") {
      const { id } = await req.json();
      await kv.delete(["photos", id]);
      return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
  }

  // --- 3. PROXY (Remote URL ဆွဲရန်) ---
  // Client က တိုက်ရိုက်ဆွဲရင် CORS မိနိုင်လို့ Server က ကြားခံဆွဲပေးတာပါ
  if (url.pathname === "/api/proxy") {
      const target = url.searchParams.get("url");
      if(target) {
          try {
              const imgRes = await fetch(target);
              const blob = await imgRes.blob();
              return new Response(blob, { headers: { "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg" }});
          } catch(e) { return new Response("Error", {status: 500}); }
      }
  }

  // --- 4. SERVE IMAGE (Link ဖွင့်ကြည့်ရန်) ---
  if (url.pathname.startsWith("/img/")) {
      const id = url.pathname.split("/")[2];
      const entry = await kv.get(["photos", id]);
      if (entry.value) {
          const data = (entry.value as any).data;
          // Base64 to Uint8Array
          const binStr = atob(data.split(',')[1]);
          const len = binStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);
          
          return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=86400" } });
      }
      return new Response("Image Not Found", { status: 404 });
  }

  // --- 5. UI PAGE ---
  const photos = [];
  const iter = kv.list({ prefix: ["photos"] }, { reverse: true });
  for await (const entry of iter) photos.push({ id: entry.key[1], ...entry.value as any });

  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Image Keeper</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <style>body { background: #111827; color: #e5e7eb; font-family: sans-serif; }</style>
    </head>
    <body class="min-h-screen p-4 sm:p-8">
      <div class="max-w-3xl mx-auto">
        
        <h1 class="text-2xl font-bold text-blue-400 mb-6 flex items-center gap-2">
           <i class="fas fa-database"></i> Image Storage
        </h1>

        <div class="flex gap-2 mb-4">
            <button onclick="showTab('file')" id="btnFile" class="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold">File Upload</button>
            <button onclick="showTab('url')" id="btnUrl" class="flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg font-bold">Remote URL</button>
        </div>

        <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 mb-8">
            
            <div id="tabFile">
                <input type="file" id="fileInput" accept="image/*" class="hidden" onchange="handleFile(this.files[0])">
                <label for="fileInput" class="cursor-pointer flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700/50 transition">
                    <i class="fas fa-cloud-upload-alt text-3xl text-gray-400 mb-2"></i>
                    <span class="text-sm text-gray-300">ဓာတ်ပုံရွေးရန် နှိပ်ပါ (Click to Upload)</span>
                </label>
            </div>

            <div id="tabUrl" class="hidden">
                <div class="flex gap-2">
                    <input type="text" id="urlInput" placeholder="Paste Image URL here..." class="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 text-white focus:outline-none focus:border-blue-500">
                    <button onclick="handleUrl()" class="bg-blue-600 px-4 py-2 rounded-lg font-bold hover:bg-blue-700">Get</button>
                </div>
                <p class="text-xs text-gray-500 mt-2">Note: Direct image links work best (jpg, png).</p>
            </div>

            <div id="loading" class="hidden mt-4 text-center text-yellow-400 text-sm font-mono">
                <i class="fas fa-circle-notch fa-spin"></i> Compressing & Saving...
            </div>
        </div>

        <div class="space-y-3">
            <div class="flex justify-between items-end border-b border-gray-700 pb-2 mb-4">
                <h2 class="text-lg font-bold text-white">Saved Links (${photos.length})</h2>
                <span class="text-xs text-gray-500">Latest first</span>
            </div>

            ${photos.length === 0 ? '<div class="text-center text-gray-600 py-8">No images saved.</div>' : ''}

            ${photos.map(p => `
                <div class="bg-gray-800 p-3 rounded-lg border border-gray-700 flex items-center justify-between gap-3 group hover:border-blue-500/50 transition">
                    <div class="flex items-center gap-3 overflow-hidden">
                        <div class="w-10 h-10 rounded bg-gray-700 flex-shrink-0 flex items-center justify-center text-gray-500">
                            <i class="fas fa-image"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-white truncate">${p.name}</p>
                            <p class="text-[10px] text-gray-500">${p.date}</p>
                        </div>
                    </div>
                    
                    <div class="flex gap-2 flex-shrink-0">
                        <button onclick="copyLink('${url.origin}/img/${p.id}')" class="bg-gray-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1">
                            <i class="fas fa-copy"></i> Copy
                        </button>
                        <a href="/img/${p.id}" target="_blank" class="bg-gray-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1">
                            <i class="fas fa-external-link-alt"></i> View
                        </a>
                        <button onclick="deleteImg('${p.id}')" class="bg-gray-700 hover:bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold transition">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>

      </div>

      <script>
        function showTab(t) {
            document.getElementById('tabFile').classList.toggle('hidden', t !== 'file');
            document.getElementById('tabUrl').classList.toggle('hidden', t !== 'url');
            document.getElementById('btnFile').className = t === 'file' ? 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold' : 'flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg font-bold';
            document.getElementById('btnUrl').className = t === 'url' ? 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold' : 'flex-1 bg-gray-700 text-gray-300 py-2 rounded-lg font-bold';
        }

        // 1. FILE UPLOAD
        function handleFile(file) {
            if (!file) return;
            processImage(file, file.name);
        }

        // 2. URL UPLOAD
        async function handleUrl() {
            const url = document.getElementById('urlInput').value;
            if (!url) return alert("Please enter a URL");
            
            document.getElementById('loading').classList.remove('hidden');
            try {
                // Fetch via Server Proxy to bypass CORS
                const res = await fetch('/api/proxy?url=' + encodeURIComponent(url));
                if (!res.ok) throw new Error("Failed to fetch");
                const blob = await res.blob();
                // Get filename from URL or default
                const name = url.split('/').pop().split('?')[0] || "remote_image.jpg";
                const file = new File([blob], name, { type: blob.type });
                
                processImage(file, name);
            } catch (e) {
                alert("Error fetching URL. Image might be blocked.");
                document.getElementById('loading').classList.add('hidden');
            }
        }

        // 3. COMPRESSION & UPLOAD LOGIC
        function processImage(file, fileName) {
            document.getElementById('loading').classList.remove('hidden');
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.src = e.target.result;
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    let w = img.width, h = img.height;
                    
                    // Resize if huge
                    const MAX = 800;
                    if (w > MAX) { h *= MAX / w; w = MAX; }
                    
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);

                    // Compress loop
                    let q = 0.7;
                    let dataUrl = canvas.toDataURL('image/jpeg', q);
                    while (dataUrl.length > 60000 && q > 0.1) {
                        q -= 0.1;
                        dataUrl = canvas.toDataURL('image/jpeg', q);
                    }

                    // Send to Server
                    fetch('/api/save', {
                        method: 'POST',
                        body: JSON.stringify({ image: dataUrl, name: fileName })
                    }).then(() => location.reload());
                }
            }
            reader.readAsDataURL(file);
        }

        function deleteImg(id) {
            if(confirm("Delete this link history?")) {
                fetch('/api/delete', { method: 'POST', body: JSON.stringify({ id }) }).then(() => location.reload());
            }
        }

        function copyLink(txt) {
            navigator.clipboard.writeText(txt).then(() => alert("Link Copied!"));
        }
      </script>
    </body>
    </html>
  `, { headers: { "content-type": "text/html; charset=utf-8" } });
});
