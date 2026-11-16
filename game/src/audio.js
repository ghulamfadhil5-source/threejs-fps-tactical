// Audio: everything is synthesised with WebAudio — no audio files, no network.
// Short noise bursts for gunfire, a low thump for the blast, clicks for reloads.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBurst(duration, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(master);
    src.start();
  }

  function tone(freq, duration, gain, slideTo) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'longshot') { noiseBurst(0.22, 900, 0.9); tone(140, 0.18, 0.4, 55); }
      else if (kind === 'hornet') noiseBurst(0.08, 2200, 0.5);
      else noiseBurst(0.12, 1600, 0.65);
    },
    enemyShot(dist) {
      const g = Math.max(0.08, 0.5 - dist * 0.015);
      noiseBurst(0.1, 1200, g);
    },
    reload() { tone(700, 0.06, 0.2); setTimeout(() => tone(500, 0.06, 0.2), 180); },
    dry() { tone(1200, 0.04, 0.15); },
    hit() { tone(1800, 0.05, 0.25); },
    kill() { tone(880, 0.09, 0.25); setTimeout(() => tone(1320, 0.12, 0.25), 90); },
    hurt() { tone(220, 0.15, 0.4, 110); },
    plant() { tone(660, 0.08, 0.25); },
    beep() { tone(990, 0.07, 0.2); },
    explosion() {
      noiseBurst(0.9, 300, 1.0);
      tone(70, 0.8, 0.9, 30);
    },
    roundWin() { tone(523, 0.12, 0.25); setTimeout(() => tone(784, 0.2, 0.25), 120); },
    roundLose() { tone(392, 0.15, 0.25); setTimeout(() => tone(262, 0.25, 0.25), 150); },
    buy() { tone(1046, 0.07, 0.2); },
  };
}
