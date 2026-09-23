import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// server.fs.allow lets the frontend import the shared API contract
// (shared/types.ts) that lives one level above the app root.
export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
});