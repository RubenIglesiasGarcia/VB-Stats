import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { WebPreview } from './WebPreview';
import './styles.css';
import './premium.css';

// Cloudflare Pages serves a clearly labeled, interactive mock. The real analysis
// backend must never be exposed to the public Internet without authentication.
const publicPreview = import.meta.env.VITE_WEB_PREVIEW === '1';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{publicPreview ? <WebPreview/> : <App/>}</React.StrictMode>
);
