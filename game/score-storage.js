import { getDeviceProfile } from "./device-utils.js";
import { PLAY_MODE, SCORE_MODE } from "./constants.js";

const SETTINGS_KEY = "han_soloist_settings_v1";
const SCOREBOARD_KEY = "han_soloist_scoreboard_v2";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export function saveSettings(next) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next || {}));
  } catch {
    void 0;
  }
}

export function createScoreStore() {
  return { personalBestByLevel: {}, leaderboardByLevel: {} };
}

export function loadScoreStore() {
  try {
    const raw = localStorage.getItem(SCOREBOARD_KEY);
    if (!raw) return createScoreStore();
    const parsed = JSON.parse(raw);
    return {
      personalBestByLevel: parsed?.personalBestByLevel || {},
      leaderboardByLevel: parsed?.leaderboardByLevel || {}
    };
  } catch {
    return createScoreStore();
  }
}

export function saveScoreStore(store) {
  try {
    localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(store));
  } catch {
    void 0;
  }
}

export function getModeKey(playMode) {
  if (playMode === PLAY_MODE.CAMERA) return SCORE_MODE.CAMERA;
  if (playMode === PLAY_MODE.KEYBOARD) return SCORE_MODE.KEYBOARD;
  if (playMode === PLAY_MODE.TOUCH) return SCORE_MODE.TOUCH;
  return SCORE_MODE.MOUSE;
}

export function recordScore({
  store,
  level,
  playMode,
  score,
  initials,
  countryCode,
  profileDefaults
}) {
  const safeLevel = String(Math.max(1, Math.floor(Number(level) || 1)));
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const mode = getModeKey(playMode);
  const device = getDeviceProfile(profileDefaults).type;
  const now = Date.now();

  const prevBest = Number(store.personalBestByLevel[safeLevel] || 0);
  const isNewPersonalBest = safeScore > prevBest;
  if (isNewPersonalBest) {
    store.personalBestByLevel[safeLevel] = safeScore;
  }

  const board = Array.isArray(store.leaderboardByLevel[safeLevel])
    ? store.leaderboardByLevel[safeLevel].slice()
    : [];
  board.push({
    initials: String(initials)
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3)
      .padEnd(3, "A"),
    score: safeScore,
    ts: now,
    mode,
    device,
    countryCode
  });
  board.sort((a, b) => b.score - a.score || a.ts - b.ts);
  store.leaderboardByLevel[safeLevel] = board.slice(0, 10);

  return {
    isNewPersonalBest,
    mode,
    device,
    topScores: store.leaderboardByLevel[safeLevel]
  };
}

export function getTopScoresForLevel(
  store,
  level,
  playMode = null,
  device = null
) {
  const safeLevel = String(Math.max(1, Math.floor(Number(level) || 1)));
  const mode = playMode ? getModeKey(playMode) : null;
  const list = Array.isArray(store.leaderboardByLevel[safeLevel])
    ? store.leaderboardByLevel[safeLevel]
    : [];
  return list
    .filter(
      (row) =>
        (!mode || row.mode === mode) && (!device || row.device === device)
    )
    .slice(0, 10);
}

// Firebase bridge shape: replace these no-op methods with real Firebase calls later.
export const leaderboardGateway = {
  async readTopScores() {
    return [];
  },
  async writeScore({ scoreEntry }) {
    void scoreEntry;
  }
};
