/**
 * QuadBeam Vite Configuration
 * Uses relative base path ('./') so the production build works both at a domain root
 * and under any GitHub Pages repository subpath (https://USERNAME.github.io/REPOSITORY/).
 */
export default {
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 5173,
    strictPort: false,
    host: true
  },
  preview: {
    port: 4173,
    strictPort: false,
    host: true
  }
};
