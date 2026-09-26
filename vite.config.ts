import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Served at api.t98.dev/jobgrindr/, beside 1x1.
  base: '/jobgrindr/',
  plugins: [react()],
  server: {
    // The API server (server/server.js) in development.
    proxy: { '/jobgrindr/api': 'http://127.0.0.1:3001' },
  },
});
