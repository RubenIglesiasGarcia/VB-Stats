import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { WebPreview } from './WebPreview';
import { OnlineStudio } from './OnlineStudio';
import './styles.css';
import './premium.css';

// Cloudflare Pages serves a clearly labeled, interactive mock. The real analysis
// backend must never be exposed to the public Internet without authentication.
const publicPreview = import.meta.env.VITE_WEB_PREVIEW === '1';
const onlineStudio = import.meta.env.VITE_ONLINE_STUDIO === '1';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{onlineStudio ? <OnlineStudio/> : publicPreview ? <WebPreview/> : <App/>}</React.StrictMode>
);
