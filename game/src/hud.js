// The DOM HUD: health, ammo, money, round timer, score, bomb status, kill feed,
// buy menu and the overlay panels. It never touches the simulation; main.js pushes
// numbers in and reads the play callback out. Updates are cached so the DOM is
// only written when a value actually changes.
const COPY = {
  start: {
    title: 'ASHFALL YARD',
    copy: 'A foundry yard at dusk. Plant the charge at Site A or Site B — or wipe the defenders out. First to 5 rounds takes the yard.',
    action: 'Click to play',
  },
  paused: {
    title: 'ASHFALL YARD',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoEl = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const scoreEl = $('score-value');
  const roundEl = $('round-value');
  const bombEl = $('bomb-status');
  const feedEl = $('feed');
  const bannerEl = $('banner');
  const buyEl = $('buy-menu');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  let hitTimer = 0;
  let bannerTimer = 0;
  const cache = {};

  function setText(el, key, value) {
    if (cache[key] === value) return;
    cache[key] = value;
    el.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name, grenades) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', `${name}  ·  grenades ${grenades}`);
      ammoEl.classList.toggle('empty', mag === 0);
    },
    setHealth(hp) {
      const v = Math.max(0, Math.round(hp));
      setText(healthNum, 'hp', String(v));
      if (cache.hpFill !== v) {
        cache.hpFill = v;
        healthFill.style.width = `${v}%`;
        healthFill.classList.toggle('low', v <= 30);
      }
    },
    setMoney(money) { setText(moneyEl, 'money', `$${money}`); },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      setText(timerEl, 'timer', `${mm}:${ss}`);
      timerEl.classList.toggle('buy', phase === 'buy');
    },
    setScore(us, them) { setText(scoreEl, 'score', `${us} — ${them}`); },
    setRound(round) { setText(roundEl, 'round', `ROUND ${round}`); },
    setBomb(text, planted) {
      setText(bombEl, 'bomb', text);
      bombEl.classList.toggle('planted', !!planted);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    feed(text) {
      const div = document.createElement('div');
      div.textContent = text;
      feedEl.prepend(div);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.lastChild);
      setTimeout(() => div.remove(), 6000);
    },
    banner(text, ms = 2600) {
      bannerEl.textContent = text;
      bannerEl.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), ms);
    },
    showBuy(show) { buyEl.hidden = !show; },
    setPlant(progress, label) {
      if (progress <= 0) { plantBar.hidden = true; return; }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      $('plant-label').textContent = label;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' || mode === 'match' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
