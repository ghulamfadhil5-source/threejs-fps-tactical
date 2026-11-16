// Ashfall Yard — the look plan in one place. A dusk foundry yard: warm sand and
// rusted steel under a low orange sun, with one cool teal accent for the player's
// team and readable UI. Every colour in the game comes from these names.
export const PALETTE = {
  sky: '#4a3826',
  ground: '#7d6748',
  groundDark: '#5d4c36',
  wall: '#6e5b41',
  wallDark: '#4a3d2c',
  crate: '#8a6b3f',
  containerRust: '#9c4a28',
  containerTeal: '#2e6f6a',
  hazard: '#e8b93c',
  accent: '#2ec4b6',
  ink: '#f2ead9',
  muted: '#b3a58d',
  enemy: '#d95f43',
  ally: '#2ec4b6',
  bomb: '#e8b93c',
};

export function hex(name) {
  return PALETTE[name];
}
