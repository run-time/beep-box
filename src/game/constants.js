export const PLAY_MODE = Object.freeze({
  CAMERA: "camera",
  MOUSE: "mouse",
  KEYBOARD: "keyboard",
  TOUCH: "touch"
});

export const SCORE_MODE = Object.freeze({
  CAMERA: "camera",
  MOUSE: "mouse",
  KEYBOARD: "keyboard",
  TOUCH: "touch"
});

export const GAME_STATE = Object.freeze({
  TITLE: "title",
  LEVEL_BANNER: "level_banner",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  LEVEL_COMPLETE: "level_complete",
  GAME_OVER: "game_over"
});

export const GAME_MODE = Object.freeze({
  PROD: "prod",
  STAGE: "stage",
  TEST: "test",
  DEV: "dev",
  DEV_MOUSE: "dev-mouse",
  DEV_KEYBOARD: "dev-keyboard",
  DEV_VIDEO: "dev-video",
  DEV_AUTO: "dev-auto",
  DEV_RECORD: "dev-record"
});

export const DIRECTION = Object.freeze({
  UP: "UP",
  RIGHT: "RIGHT",
  DOWN: "DOWN",
  LEFT: "LEFT",
  MIDDLE: "MIDDLE"
});

export const CORNER = Object.freeze({
  TOP_LEFT: "TOP_LEFT",
  TOP_RIGHT: "TOP_RIGHT",
  BOTTOM_LEFT: "BOTTOM_LEFT",
  BOTTOM_RIGHT: "BOTTOM_RIGHT"
});

export const API_ROUTE = Object.freeze({
  LEVELS_INDEX: "/api/levels-index"
});
