import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const kv = await Deno.openKv();

serve(async (req) => {
  const url = new URL(req.url);

  // --- 1. UPLOAD IMAGE ---
  if (req.method === "POST" && url.pathname === "/upload") {
      try {
          const { image, name } = await req.json();
          if (image) {
              const id = Date.now().toString();
              // Database ထဲ သိမ်းမည်
              await kv.set(["photos", id], { data: image, name: name, date: new Date().toLocaleString() });
              return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
          }
      } catch (e) {
          return new Response(JSON.stringify({ status: "error", msg: e.message }), { headers: { "Content-Type": "application/json" } });
      }
  }

  // --- 2. DELETE IMAGE ---
  if (req.method === "POST" && url.pathname === "/delete") {
      const { id } = await req.json();
      await kv.delete(["photos", id]);
      return new Response(JSON.stringify({ status: "success" }), { headers: { "Content-Type": "application/json" } });
  }

  // --- 3. UI (GALLERY) ---
  const photos = [];
  const iter = kv.list({ prefix: ["photos"] }, { reverse: true });
  for await (const entry of iter) {
      const p = entry.value as any;
      photos.push({ id: entry.key[1], ...p });
  }

  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>My Photo Storage</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <style>body { background: #111827; color: white; font-family: sans-serif; }</style>
    </head>
    <body class="p-6 max-w-2xl mx-auto">
      
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-blue-400"><i class="fas fa-images"></i> Cloud Gallery</h1>
        <span class="text-xs text-gray-500">${photos.length} Photos</span>
      </div>

      <div class="bg-gray-800 p-4 rounded-xl border border-gray-700 mb-8">
          <input type="file" id="fileInput" accept="image/*" class="hidden" onchange="processAndUpload(this)">
          <label for="fileInput" class="cursor-pointer flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-700 transition">
              <i class="fas fa-cloud-upload-alt text-3xl text-gray-400 mb-2"></i>
              <span class="text-sm text-gray-300">Click to Upload Photo</span>
              <span id="status" class="text-xs text-blue-400 mt-2 hidden">Compressing & Uploading...</span>
          </label>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
          ${photos.map(p => `
              <div class="relative group bg-black rounded-lg overflow-hidden shadow-lg border border-gray-800">
                  <img src="${p.data}" class="w-full h-40 object-cover" onclick="viewImage('${p.data}')">
                  <div class="absolute bottom-0 left-0 right-0 bg-black/70 p-2 flex justify-between items-center">
                      <span class="text-[10px] truncate w-20">${p.name}</span>
                      <button onclick="deletePhoto('${p.id}')" class="text-red-400 hover:text-red-200"><i class="fas fa-trash"></i></button>
                  </div>
              </div>
          `).join('')}
      </div>

      ${photos.length === 0 ? '<div class="text-center text-gray-600 mt-10">No photos saved yet.</div>' : ''}

      <script>
        // IMAGE COMPRESSION LOGIC (Client Side)
        function processAndUpload(input) {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                const status = document.getElementById('status');
                status.classList.remove('hidden');
                status.innerText = "Processing: " + file.name;

                const reader = new FileReader();
                reader.onload = function(e) {
                    const img = new Image();
                    img.src = e.target.result;
                    img.onload = function() {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        
                        // 1. Resize if too big (Max width 800px)
                        const MAX_WIDTH = 800;
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                        
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // 2. Reduce Quality to fit 64KB
                        let quality = 0.7; // Start at 70%
                        let dataUrl = canvas.toDataURL('image/jpeg', quality);
                        
                        // Loop to shrink size under 60KB
                        while (dataUrl.length > 60000 && quality > 0.1) {
                            quality -= 0.1;
                            dataUrl = canvas.toDataURL('image/jpeg', quality);
                        }

                        upload(dataUrl, file.name);
                    }
                }
                reader.readAsDataURL(file);
            }
        }

        function upload(base64, name) {
            fetch('/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64, name: name })
            }).then(res => res.json()).then(d => {
                if(d.status === 'success') location.reload();
                else alert("Upload Failed");
            });
        }

        function deletePhoto(id) {
            if(confirm("Delete this photo?")) {
                fetch('/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: id })
                }).then(() => location.reload());
            }
        }

        function viewImage(src) {
            const w = window.open("");
            w.document.write('<img src="'+src+'" style="width:100%">');
        }
      </script>
    </body>
    </html>
  `, { headers: { "content-type": "text/html" } });
});
