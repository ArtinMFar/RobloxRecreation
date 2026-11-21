// Roblox runs edge to edge. In a mobile browser the address bar takes about a
// fifth of the height, and with a fixed vertical field of view everything is
// drawn that much smaller. So: go fullscreen (and landscape) on the first tap
// in touch mode, and offer a toggle button. iPhone Safari has no element
// fullscreen; there "Add to Home Screen" opens the page full screen instead.

const ICON_ENTER =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_EXIT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function setupFullscreen({ button, isTouchMode }) {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  const supported = !!request && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? false);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  async function enter() {
    try {
      await request.call(root, { navigationUI: 'hide' });
    } catch {
      return;
    }
    try {
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* orientation lock is optional (not allowed on every device) */
    }
  }
  function exit() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) fn.call(document);
  }

  const update = () => {
    const full = isFull();
    button.innerHTML = full ? ICON_EXIT : ICON_ENTER;
    button.setAttribute('aria-label', full ? 'Exit full screen' : 'Full screen');
  };
  button.hidden = !supported;
  update();
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  button.addEventListener('click', () => (isFull() ? exit() : enter()));

  // Touch only grants permission on pointerup, so that is when we ask. Only
  // once per visit: if the player leaves full screen they meant it.
  let autoTried = false;
  addEventListener(
    'pointerup',
    (e) => {
      if (autoTried || !supported || e.pointerType !== 'touch' || !isTouchMode() || isFull()) return;
      if (e.target instanceof Element && e.target.closest('#fullscreen-btn')) return;
      autoTried = true;
      enter();
    },
    true,
  );

  return { supported };
}
