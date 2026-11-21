// HUD: input-mode switch, help and settings panels, stats, hints.
const ICONS = {
  keyboard:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M18 10h.01M7.5 14h9"/></svg>',
  touch:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/></svg>',
};

const STORE_KEY = 'movement-sandbox-settings';
const DEFAULTS = { cameraMode: 'Default', sensitivity: 1, showStats: false, inputMode: null };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function createUI({ onChange }) {
  const $ = (id) => document.getElementById(id);
  const settings = loadSettings();
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings last for this visit only */
    }
  };
  const changed = () => {
    save();
    onChange(settings);
  };

  const helpBtn = $('help-btn');
  const helpPanel = $('help-panel');
  const settingsBtn = $('settings-btn');
  const settingsPanel = $('settings-panel');
  const modeBtn = $('mode-btn');
  const stats = $('stats');

  const setOpen = (btn, panel, open) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  const closePanels = () => {
    setOpen(helpBtn, helpPanel, false);
    setOpen(settingsBtn, settingsPanel, false);
  };
  helpBtn.addEventListener('click', () => {
    const open = helpPanel.hidden;
    closePanels();
    setOpen(helpBtn, helpPanel, open);
  });
  settingsBtn.addEventListener('click', () => {
    const open = settingsPanel.hidden;
    closePanels();
    setOpen(settingsBtn, settingsPanel, open);
  });
  $('game').addEventListener('pointerdown', closePanels);

  const camMode = $('camera-mode');
  const sens = $('sens');
  const sensOut = $('sens-out');
  const statsToggle = $('stats-toggle');
  camMode.value = settings.cameraMode;
  sens.value = settings.sensitivity;
  sensOut.textContent = Number(settings.sensitivity).toFixed(2);
  statsToggle.checked = settings.showStats;
  stats.hidden = !settings.showStats;

  camMode.addEventListener('change', () => {
    settings.cameraMode = camMode.value;
    changed();
  });
  sens.addEventListener('input', () => {
    settings.sensitivity = Number(sens.value);
    sensOut.textContent = settings.sensitivity.toFixed(2);
    changed();
  });
  statsToggle.addEventListener('change', () => {
    settings.showStats = statsToggle.checked;
    stats.hidden = !settings.showStats;
    changed();
  });
  // Keep game keys from scrolling/stepping the focused form controls.
  for (const node of [camMode, sens, statsToggle, modeBtn, helpBtn, settingsBtn]) {
    node.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) node.blur();
    });
  }

  let currentMode = 'keyboard';
  modeBtn.addEventListener('click', () => {
    settings.inputMode = currentMode === 'touch' ? 'keyboard' : 'touch';
    modeBtn.blur();
    changed();
  });

  let helpShownAt = performance.now();
  setOpen(helpBtn, helpPanel, true);

  return {
    settings,
    closeHelpOnActivity() {
      if (!helpPanel.hidden && performance.now() - helpShownAt > 1500) setOpen(helpBtn, helpPanel, false);
      helpShownAt = -Infinity;
    },
    showMode(mode) {
      currentMode = mode;
      const next = mode === 'touch' ? 'keyboard' : 'touch';
      modeBtn.innerHTML = `${ICONS[next]}<span>${next === 'keyboard' ? 'Keyboard' : 'Touch'}</span>`;
      modeBtn.setAttribute('aria-label', `Switch to ${next} controls`);
      for (const dl of helpPanel.querySelectorAll('[data-for]')) dl.hidden = dl.dataset.for !== mode;
    },
    placeModeButton(ts) {
      const inset = parseFloat(getComputedStyle($('safe-area-probe')).paddingLeft) || 0;
      const r = ts.startDiameter / 2;
      modeBtn.style.left = `${Math.max(12 + inset, ts.idle.x - r)}px`;
      modeBtn.style.bottom = `${innerHeight - (ts.idle.y - r) + 14}px`;
    },
    setStats(text) {
      if (settings.showStats) stats.textContent = text;
    },
    setCrosshair(on) {
      $('crosshair').hidden = !on;
    },
    setLockHint(on) {
      $('lock-hint').hidden = !on;
    },
    loaded() {
      const l = $('loading');
      l.classList.add('done');
      setTimeout(() => l.remove(), 400);
    },
    error(message) {
      const l = $('loading');
      l.classList.add('error');
      l.textContent = message;
    },
  };
}
