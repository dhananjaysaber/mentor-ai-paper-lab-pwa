// GitHub Pages hosts only static UI. All secrets and FYERS market data remain on a
// separate HTTPS backend. This module never embeds an API key or a broker secret.
export const AI_BACKEND = String(import.meta.env.VITE_AI_API_BASE || (
  window.location.hostname.endsWith('github.io') ? 'https://mentor-ai-paper-lab.netlify.app' : ''
)).replace(/\/$/, '');
const SESSION_KEY = 'mentor-ai-paper-lab-fyers-session-v1';
let ready = false;

function consumeReturnedFyersSession() {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const session = params.get('fyers_session');
  if (!session) return;
  try { window.sessionStorage.setItem(SESSION_KEY, session); } catch {}
  params.delete('fyers_session');
  const nextHash = params.toString();
  const next = window.location.pathname + window.location.search + (nextHash ? '#' + nextHash : '');
  window.history.replaceState({}, document.title, next);
}
function getSession() {
  try { return window.sessionStorage.getItem(SESSION_KEY) || ''; }
  catch { return ''; }
}
export function getAiFyersLoginUrl() {
  const backend = AI_BACKEND || window.location.origin;
  const url = new URL('/api/fyers/login', backend);
  if (backend !== window.location.origin) {
    const returnTo = new URL(import.meta.env.BASE_URL || './', window.location.origin).toString();
    url.searchParams.set('returnTo', returnTo);
  }
  return url.toString();
}
export function installAiBridge() {
  if (ready) return;
  ready = true;
  consumeReturnedFyersSession();
  if (!AI_BACKEND || AI_BACKEND === window.location.origin) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const path = typeof input === 'string' ? input : (input?.url || '');
    const isFyers = path.startsWith('/api/fyers/');
    const isClaude = path.startsWith('/.netlify/functions/ai-analyze');
    if (!isFyers && !isClaude) return originalFetch(input, init);
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {});
    if (isFyers && getSession()) headers.set('Authorization', 'Bearer ' + getSession());
    return originalFetch(AI_BACKEND + path, {...init, headers, mode: 'cors', credentials: 'omit'});
  };
}
