export function installBrowserErrorReporter({ statusElementId = 'status', logger = console } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.addEventListener('error', (event) => {
    const statusEl = document.getElementById(statusElementId);
    if (statusEl) statusEl.textContent = `❌ JS 에러: ${event.message || event.error}`;
    logger.error('[app.js]', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const statusEl = document.getElementById(statusElementId);
    if (statusEl) statusEl.textContent = `❌ 비동기 에러: ${event.reason?.message || event.reason}`;
    logger.error('[app.js rejection]', event.reason);
  });
}
