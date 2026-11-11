/**
 * QuadBeam Application Entry Point
 */

import { QuadBeamApp } from './app.js';

const app = new QuadBeamApp();

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
  } else {
    app.init();
  }
}

export default app;
