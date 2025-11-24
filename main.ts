import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.9/mod.ts";

const kv = await Deno.openKv();

// --- SMART IMAGE PROCESSOR (Quality First, Resize Last) ---
async function processImage(file: File): Promise<Uint8Array | null> {
    try {
        const buffer = await file.arrayBuffer();
        let image = await Image.decode(new Uint8Array(buffer));
        
        // Deno KV Limit (Safe Margin)
        const LIMIT = 63000; 
        
        // စမ်းသပ်မည့် Quality (မြင့်ရာမှ နိမ့်ရာသို့)
        let quality = 80; 
        let encoded = await image.encodeJPEG(quality);

        // 64KB အောက်မရောက်မချင်း Loop ပတ်မယ်
        while (encoded.length > LIMIT) {
            // ၁။ Quality ကို အရင်လျှော့မယ် (User လိုချင်သလို Size မချုံ့ချင်လို့)
            if (quality > 10) {
                quality -= 10;
                encoded = await image.encodeJPEG(quality);
            } 
            // ၂။ Quality က ၁၀% အောက်ရောက်သွားရင်တော့ ပုံက ကြည့်မကောင်းတော့ဘူး
            // ဒါကြောင့် မတတ်သာတဲ့အဆုံး Size (Dimension) ကို ၁၀% စီ လျှော့မယ်
            else {
                image.resize(Math.floor(image.width * 0.9), Image.RESIZE_AUTO);
                // Resize လုပ်ပြီးရင် Quality ပြန်တင်လို့ရပြီ (ကြည့်ကောင်းအောင်)
                quality = 50; 
                encoded = await image.encodeJPEG(quality);
            }
        }

        return encoded;
    } catch (e) {
        console.error("Image Error:", e);
        return null;
    }
}

serve(async (req) => {
  const url = new URL(req.url);

  // --- 1. UPLOAD ---
  if (req.method === "POST" && url.pathname === "/upload") {
      const form = await req.formData();
      const file = form.get("photo") as File;
      
      if (!file) return new Response("No file", { status: 400 });

      // Smart Process လုပ်မယ်
      const optimizedImage = await processImage(file);

      if (optimizedImage) {
          const id = Date.now().toString();
          await kv.set(["gallery", id], optimizedImage);
          return new Response(null, { status: 303, headers: { "Location": "/" } });
      } else {
          return new Response("Processing Failed (File too big or not an image)", { status: 500 });
      }
  }

  // --- 2. VIEW IMAGE ---
  if (url.pathname.startsWith("/img/")) {
      const id = url.pathname.split("/")[2];
      const entry = await kv.get(["gallery", id]);
      if (entry.value) {
          return new Response(entry.value as Uint8Array, {
              headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" }
          });
      }
      return new Response("Not Found", { status: 404 });
  }

  // --- 3. DELETE ---
  if (url.pathname.startsWith("/delete/")) {
      const id = url.pathname.split("/")[2];
      await kv.delete(["gallery", id]);
      return new Response(null, { status: 303, headers: { "Location": "/" } });
  }

  // --- 4. UI ---
  const images = [];
  const iter = kv.list({ prefix: ["gallery"] }, { reverse: true });
  for await (const entry of iter) images.push(entry.key[1]);

  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cloud Gallery</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
      <style>body{background:#111827;color:white}.loader{border:3px solid #374151;border-top:3px solid #3b82f6;border-radius:50%;width:20px;height:20px;animation:spin 1s linear infinite;display:inline-block}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
    </head>
    <body class="p-4">
      <div class="max-w-md mx-auto">
        <h1 class="text-xl font-bold mb-4 text-blue-400 flex items-center gap-2"><i class="fas fa-images"></i> Unlimited Gallery</h1>

        <form action="/upload" method="POST" enctype="multipart/form-data" class="mb-6 bg-gray-800 p-4 rounded-xl border border-gray-700" onsubmit="document.getElementById('btn').classList.add('opacity-50');document.getElementById('ld').classList.remove('hidden')">
            <div class="flex gap-2">
                <input type="file" name="photo" accept="image/*" required class="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700">
            </div>
            <button id="btn" class="mt-3 w-full bg-gray-700 py-2 rounded font-bold hover:bg-gray-600 flex items-center justify-center gap-2">
                <span>Upload Photo</span> <div id="ld" class="loader hidden"></div>
            </button>
        </form>

        <div class="grid grid-cols-2 gap-3">
            ${images.length === 0 ? '<p class="col-span-2 text-center text-gray-600 py-10">No photos yet</p>' : ''}
            ${images.map(id => `
                <div class="relative group bg-black rounded-lg overflow-hidden border border-gray-800">
                    <a href="/img/${id}" target="_blank">
                        <img src="/img/${id}" class="w-full h-32 object-cover opacity-90 group-hover:opacity-100 transition">
                    </a>
                    <a href="/delete/${id}" onclick="return confirm('Delete?')" class="absolute top-1 right-1 bg-red-600/80 text-white w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><i class="fas fa-times text-xs"></i></a>
                </div>
            `).join('')}
        </div>
      </div>
    </body>
    </html>
  `, { headers: { "content-type": "text/html" } });
});
