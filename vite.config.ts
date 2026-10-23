import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @smogon/calc is CommonJS; let Vite pre-bundle it.
  optimizeDeps: { include: ['@smogon/calc'] },
})
