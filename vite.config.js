import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/mentor-ai-paper-lab-pwa/',
  plugins: [react()],
  build: { outDir: 'dist' }
});
