import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @smogon/calc is CommonJS; let Vite pre-bundle it.
  optimizeDeps: { include: ['@smogon/calc'] },
  build: {
    rolldownOptions: {
      output: {
        // React changes rarely: its own file stays cached across deploys of the app code.
        advancedChunks: {groups: [{name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/}]},
      },
    },
  },
})
