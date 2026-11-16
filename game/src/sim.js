// sim.js — the one state store. Rounds, money, the bomb, the score and the win
// conditions live here and nowhere else; main.js renders from it and bots.js reads
// it. Nothing in this file touches the DOM or three.js.
import { MAP } from './map.js';
import { WEAPONS, GRENADE_PRICE } from './weapons.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 14;
export const BOMB_TIME = 35;
export const WIN_ROUNDS = 5;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;

export function createSim() {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    roundTime: BUY_TIME,
    bombPlanted: false,
    bombSite: null,
    bombPos: null,
    bombTimer: 0,
    plantProgress: 0,
    defuseProgress: 0,
    planting: false,
    winner: null, // 'us' | 'them' | null
    roundReason: '',
    matchOver: false,
    bombCarrier: true,
    message: '',
    messageAt: 0,
  };

  function startMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.scoreUs = 0;
    state.scoreThem = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.roundTime = BUY_TIME;
    state.bombPlanted = false;
    state.bombSite = null;
    state.bombPos = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.winner = null;
    state.matchOver = false;
    state.bombCarrier = true;
  }

  function startRound() {
    state.phase = 'buy';
    state.roundTime = BUY_TIME;
    state.bombPlanted = false;
    state.bombSite = null;
    state.bombPos = null;
    state.bombTimer = 0;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.planting = false;
    state.winner = null;
    state.roundReason = '';
    state.bombCarrier = true;
  }

  function beginLive() {
    state.phase = 'live';
    state.roundTime = ROUND_TIME;
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd') return;
    state.phase = 'roundEnd';
    state.winner = winner;
    state.roundReason = reason;
    state.roundTime = 4.5;
    if (winner === 'us') {
      state.scoreUs += 1;
      state.money += 300;
      if (state.bombPlanted) state.money += 300;
    } else {
      state.scoreThem += 1;
      state.money += 150;
    }
    state.matchOver = state.scoreUs >= WIN_ROUNDS || state.scoreThem >= WIN_ROUNDS;
  }

  // Called every fixed step while live. Returns nothing; main.js reads the state.
  function step(dt, ctx) {
    if (state.phase === 'buy') {
      state.roundTime -= dt;
      if (state.roundTime <= 0) beginLive();
      return;
    }
    if (state.phase === 'roundEnd') {
      state.roundTime -= dt;
      if (state.roundTime <= 0) {
        if (state.matchOver) startMatch();
        else { state.round += 1; startRound(); }
        ctx.onRoundStart(state.round, state.phase);
      }
      return;
    }
    if (state.phase !== 'live') return;
    state.roundTime -= dt;
    // Bomb countdown.
    if (state.bombPlanted) {
      state.bombTimer -= dt;
      if (state.bombTimer <= 0) {
        endRound('us', 'The charge blew Site ' + state.bombSite + '.');
        ctx.onBombExploded(state.bombPos);
        return;
      }
    }
    // Defuse channelled by a defender bot (bots.js writes defuseProgress).
    if (state.defuseProgress >= 1) {
      endRound('them', 'Defenders defused the charge.');
      return;
    }
    // Plant channel: the player holds E inside a site.
    if (state.planting && state.bombCarrier && !state.bombPlanted) {
      const site = ctx.playerSite;
      if (site) {
        state.plantProgress += dt / PLANT_TIME;
        if (state.plantProgress >= 1) {
          state.bombPlanted = true;
          state.bombSite = site;
          state.bombPos = { x: MAP.sites[site].x, z: MAP.sites[site].z };
          state.bombTimer = BOMB_TIME;
          state.bombCarrier = false;
          state.message = 'Charge planted at Site ' + site + ' — defend it!';
          ctx.onPlanted(state.bombPos);
        }
      } else {
        state.plantProgress = 0;
      }
    } else {
      state.plantProgress = 0;
    }
    // Elimination wins.
    if (ctx.enemiesAlive === 0) {
      endRound('us', 'Enemy team eliminated.');
      return;
    }
    if (ctx.playerDead && ctx.alliesAlive === 0) {
      endRound('them', 'Your team was eliminated.');
      return;
    }
    if (state.roundTime <= 0) {
      if (state.bombPlanted) endRound('them', 'Time ran out before the blast.');
      else endRound('them', 'Time expired — the charge was never planted.');
    }
  }

  function buy(id) {
    const def = WEAPONS[id];
    if (!def || state.money < def.price) return null;
    if (state.phase !== 'buy') return null;
    state.money -= def.price;
    return def;
  }

  function buyGrenade() {
    if (state.phase !== 'buy' || state.money < GRENADE_PRICE) return false;
    state.money -= GRENADE_PRICE;
    return true;
  }

  function addKillReward() {
    state.money += 300;
    state.kills += 1;
  }

  return {
    state, startMatch, startRound, beginLive, endRound, step, buy, buyGrenade, addKillReward,
  };
}
