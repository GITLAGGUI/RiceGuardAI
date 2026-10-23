import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
const absolute=(path:string)=>fileURLToPath(new URL(path,import.meta.url));
export default defineConfig({
  cacheDir:'.gemini-preview-cache',
  optimizeDeps:{entries:['qa/gemini-preview.html']},
  plugins:[react(),tailwindcss()],
  resolve:{alias:[
    {find:'@/context/AuthContext',replacement:absolute('./gemini-preview-auth.ts')},
    {find:'@/lib/supabase',replacement:absolute('./gemini-preview-auth.ts')},
    {find:'@',replacement:absolute('../src')},
  ]},
  server:{host:'127.0.0.1',port:5186,strictPort:true},
});
