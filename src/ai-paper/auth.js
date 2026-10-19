// Browser-side storage contains a signed, expiring research-session token,
// never the Claude API key or the user's AI access password.
// This token is used only to authorize PAPER research on the separate backend.
const PERSISTED = 'mentor-ai-research-login-v2';
const TAB_ONLY = 'mentor-ai-research-tab-v2';

function valid(s) {
  return !!(s && typeof s.token === 'string' && s.token.length >= 40 &&
    Number.isFinite(Date.parse(s.expiresAt)) && Date.parse(s.expiresAt) > Date.now());
}

export function loadAiSession() {
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const item = JSON.parse(storage.getItem(storage === window.localStorage ? PERSISTED : TAB_ONLY) || 'null');
      if (valid(item)) return item;
    } catch {}
  }
  clearAiSession();
  return null;
}

export function saveAiSession(next) {
  clearAiSession();
  const storage = next.remembered ? window.localStorage : window.sessionStorage;
  try {
    storage.setItem(next.remembered ? PERSISTED : TAB_ONLY,
      JSON.stringify({token:next.token,expiresAt:next.expiresAt,remembered:!!next.remembered}));
  } catch { /* Private browsing or storage restrictions: session remains in memory. */ }
}

export function clearAiSession() {
  try { window.localStorage.removeItem(PERSISTED); } catch {}
  try { window.sessionStorage.removeItem(TAB_ONLY); } catch {}
}

export function remainingAiSession(session) {
  return valid(session) ? Math.max(0, Date.parse(session.expiresAt) - Date.now()) : 0;
}
