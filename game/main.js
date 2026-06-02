import { NotePlayback } from "../playback.js";
import {
  advanceLevel as advanceLevelState,
  decodeLane as decodeSongLane,
  ensureLevelInstrumentsLoaded as ensureLevelInstrumentsLoadedState,
  ensureLevelReady as ensureLevelReadyState,
  ensureLevelSongLoaded as ensureLevelSongLoadedState,
  getNoteSpawnPoint as getSpawnPointFromLayout,
  maybeSpawnSongNotes as maybeSpawnSongNotesState,
  startLevel as startLevelState,
  startLevelFlow as startLevelFlowState
} from "./level-loader.js";
import {
  buildChordMidi as buildChordMidiState,
  getPointsPerNote as getPointsPerNoteState,
  isDirectionActive as isDirectionActiveState,
  maybeSpawnRandomNote as maybeSpawnRandomNoteState,
  resolveNoteHits as resolveNoteHitsState,
  selectDirection as selectDirectionState,
  spawnCaptureEffect as spawnCaptureEffectState,
  spawnScorePopups as spawnScorePopupsState,
  updateActiveFades as updateActiveFadesState,
  updateNotes as updateNotesState,
  updateUpcomingNoteAssist as updateUpcomingNoteAssistState
} from "./note-flow.js";
import {
  getImminentTargetDirections as getImminentTargetDirectionsState,
  getSquareMotionLayoutKey as getSquareMotionLayoutKeyState,
  resetSquareMotion as resetSquareMotionState,
  updateMouseActivation as updateMouseActivationState,
  updateSquareMotionActivation as updateSquareMotionActivationState,
  updateSquareMotionBaselines as updateSquareMotionBaselinesState
} from "./motion.js";
import {
  getDirectionIntensity as getRenderDirectionIntensity,
  getOverlayLayout as getRenderOverlayLayout
} from "./render.js";
import { processFrameStep } from "./process-frame.js";
import { getCountryByIp } from "./geo-utils.js";
import { getDeviceProfile } from "./device-utils.js";
import {
  getModeKey,
  getTopScoresForLevel,
  loadScoreStore,
  loadSettings,
  recordScore,
  saveScoreStore,
  saveSettings
} from "./score-storage.js";
import {
  parseLevelRoute,
  pushLevelRoute,
  replaceRootRoute
} from "./route-utils.js";
import {
  API_ROUTE,
  DIRECTION,
  GAME_MODE,
  GAME_STATE,
  PLAY_MODE,
  SCORE_MODE
} from "./constants.js";
import { UI_STRINGS } from "./ui-strings.js";

function loadDefaultConfigSync() {
  const req = new XMLHttpRequest();
  req.open("GET", new URL("./config.json", import.meta.url).href, false);
  req.send(null);
  if (req.status < 200 || req.status >= 300) {
    throw new Error(`Failed to load config.json: ${req.status}`);
  }
  return JSON.parse(req.responseText);
}

const defaultConfig = loadDefaultConfigSync();

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override.slice() : base.slice();
  }
  if (!isPlainObject(base)) {
    return override === undefined ? base : override;
  }

  const out = { ...base };
  if (!isPlainObject(override)) return out;
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in out ? mergeConfig(out[key], value) : value;
  }
  return out;
}

export class BeepBoxGame extends HTMLElement {
  constructor(customConfig = {}) {
    super();
    this.attachShadow({ mode: "open" });
    this.config = mergeConfig(defaultConfig, customConfig);
    const cfg = this.config;
    this.GAME_MODE = cfg.mode.gameMode; // 'prod' | 'stage' | 'test' | 'dev' | 'dev-mouse' | 'dev-keyboard' | 'dev-video' | 'dev-auto' | 'dev-record'
    this.play_mode = cfg.mode.defaultPlayMode;
    this.tapHoldMs = cfg.input.tapHoldMs;
    this.tapActiveUntilTs = 0;
    this.tapActiveDir = null;
    this.arrowHeld = new Set();
    this.activeFadeMs = cfg.input.activeFadeMs;
    this.primaryDirection = DIRECTION.MIDDLE;
    this.activeDirStates = new Map();
    // Per-square adaptive foreground detection for hand presence.
    this.squareMotionState = new Map();
    this.squareMotionLayoutKey = "";
    this.squareMotionFrames = 0;
    this.squareMotionTargetFrames = cfg.motion.targetFrames;
    this.squareMotionStride = cfg.motion.stride;
    this.squareMotionEnterDiffThreshold = cfg.motion.enterDiffThreshold; // luma delta (0..255)
    this.squareMotionExitDiffThreshold = cfg.motion.exitDiffThreshold; // hysteresis lower threshold
    this.squareMotionMinPct = cfg.motion.minPct; // minimum foreground occupancy to be valid
    this.squareMotionOffPct = cfg.motion.offPct; // drop active below this for hold release
    this.squareMotionEmaAlpha = cfg.motion.emaAlpha;
    this.squareMotionBgLearnAlpha = cfg.motion.bgLearnAlpha; // fast background learning
    this.squareMotionBgLearnAlphaFg = cfg.motion.bgLearnAlphaFg; // very slow while foreground present
    this.squareMotionActiveHoldMs = cfg.motion.activeHoldMs;
    this.squareMotionMiddleTopIgnore = cfg.motion.middleTopIgnore; // ignore top face-prone region in MIDDLE
    this.squareMotionPctSmoothed = new Map();
    this.squareMotionPctLast = new Map();
    this.squareMotionActiveDir = null;
    this.squareMotionActiveUntilTs = 0;
    this.directions = cfg.input.directions.slice();
    this.colors = { ...cfg.visual.colors };
    // Fill colors: mostly transparent by default so video remains visible.
    // "Active" highlights more strongly.
    this.fillColors = { ...cfg.visual.fillColors };
    this.activeFillColors = { ...cfg.visual.activeFillColors };
    this.powerColors = { ...cfg.visual.powerColors };
    this.powerFillColors = { ...cfg.visual.powerFillColors };
    this.powerActiveFillColors = { ...cfg.visual.powerActiveFillColors };
    this.visualDefaults = { ...cfg.visual.defaults };
    this.video = document.createElement("video");
    this.video.setAttribute("autoplay", "");
    this.video.setAttribute("playsinline", "");
    this.stream = null;
    this.animationFrame = null;
    this.lastFrameTs = performance.now();
    // Reusable analysis surface for pixel reads (avoid per-frame canvas allocation).
    this.analysisCanvas = document.createElement("canvas");
    this.analysisCtx = this.analysisCanvas.getContext("2d", {
      willReadFrequently: true
    });

    // Notes/levels (simple random test song)
    this.notes = [];
    this.lastSpawnTs = 0;
    this.spawnIntervalMs = cfg.song.spawnIntervalMs;
    this.playingStartTs = 0;
    this.songStartTs = 0;
    this.songEvents = [];
    this.songEventIndex = 0;
    this.levelSongCache = new Map();
    this.levelSongLoads = new Map();
    this.songTickMs = cfg.song.songTickMs;
    this.hitAssistWindowMs = cfg.song.hitAssistWindowMs;
    this.targetHitGraceMs = cfg.song.targetHitGraceMs;
    this.lastDirectionActivatedTs = new Map();

    // WebAudio (must be unlocked by a user gesture)
    this.audioCtx = null;
    this.masterGain = null;
    this.audioUnlocked = false;
    this.notePlayback = new NotePlayback();

    // Game state
    this.gameState = cfg.state.initialGameState; // title | level_banner | countdown | playing | level_complete | game_over
    this.levelBannerStartTs = 0;
    this.levelBannerMs = cfg.state.levelBannerMs;
    this.countdownStartTs = 0;
    this.countdownMs = cfg.state.countdownMs;
    this.levelCompleteStartTs = 0;
    this.levelCompletePauseMs = cfg.state.levelCompletePauseMs;
    this.songCompleteReadyDelayMs = cfg.song.songCompleteReadyDelayMs;
    this.songResolveSettledStartTs = 0;

    // Levels + scoring
    this.currentLevel = cfg.levels.startLevel;
    this.maxLevel = cfg.levels.maxLevel;
    this.maxLevelPromise = null;
    this.runEndLevel = null;
    this.isSingleLevelMode = false;
    this.score = 0;
    this.streak = 0;
    this.scoreBasePerNote = cfg.scoring.basePerNote;
    this.scoreStreakStepEvery = cfg.scoring.streakStepEvery;
    this.scoreStreakStepAmount = cfg.scoring.streakStepAmount;
    this.scoreMaxPerNote = cfg.scoring.maxPerNote;
    this.scoreForceModeThreshold = cfg.scoring.forceModeThreshold;
    this.defaultInitials = cfg.scoring.defaultInitials;
    this.powerMode = false;
    this.powerModeLabelStartTs = 0;
    this.powerModeLabelFadeMs = cfg.scoring.powerModeLabelFadeMs;
    this.powerModeLabel = cfg.scoring.powerModeLabel;
    this.scorePopups = [];
    this.scorePulseStartTs = 0;
    this.scorePulseMs = cfg.scoring.scorePulseMs;
    this.scorePopupGrowthScale = cfg.scoring.scorePopupGrowthScale;
    this.scorePopupVerticalDriftScale =
      cfg.scoring.scorePopupVerticalDriftScale;
    this.scorePopupHorizontalDriftScale =
      cfg.scoring.scorePopupHorizontalDriftScale;
    this.targetBoxStrokeWidth = cfg.render.targetBoxStrokeWidth;
    this.noteStrokeWidth = cfg.render.noteStrokeWidth;
    this.captureEffects = [];
    this.captureEffectDurationMs = cfg.captureEffects.durationMs;
    this.captureNoteScaleDurationFactor =
      cfg.captureEffects.noteScaleDurationFactor;
    this.captureNoteMaxScale = cfg.captureEffects.noteMaxScale;
    this.captureEffectStrokeWidth = cfg.captureEffects.strokeWidth;
    this.captureEffectBlurScale = cfg.captureEffects.blurScale;
    this.captureEffectStartRadiusScale = cfg.captureEffects.startRadiusScale;
    this.captureEffectEndRadiusScale = cfg.captureEffects.endRadiusScale;
    this.captureEffectLineWidthScale = cfg.captureEffects.lineWidthScale;
    this.captureEffectWavePeak = cfg.captureEffects.wavePeak;
    this.captureEffectWaveValley = cfg.captureEffects.waveValley;
    this.captureEffectAlphaScale = cfg.captureEffects.alphaScale;
    this.noteUpcomingOpacityStep = cfg.render.noteUpcomingOpacityStep;
    this.noteMinUpcomingOpacity = cfg.render.noteMinUpcomingOpacity;
    this.noteMaxUpcomingOpacity = cfg.render.noteMaxUpcomingOpacity;
    this.devAutoPostHitGraceMs = cfg.dev.autoPostHitGraceMs;
    this.devRecordLevelStartTs = 0;
    this.devRecordLastTarget = cfg.dev.defaultRecordTarget;
    this.devRecordLastChangeTs = 0;
    this.devRecordTargetRanges = [];
    this.devRecordLevelCompleteLogged = false;

    this.maxMissDots = cfg.misses.maxMissDots;
    this.missLeniencyMs = cfg.misses.leniencyMs;
    this.missCount = 0;
    this.lastMissTs = -Infinity;
    this.levelFailed = false;
    this.levelPerfect = false;

    this.settings = loadSettings();
    if (typeof this.settings.playMode === "string") {
      this.play_mode = this.settings.playMode;
    }
    this.scoreStore = loadScoreStore();
    this.countryCode = cfg.geo.defaultCountryCode;
    this.geoDefaults = {
      countryCode: cfg.geo.defaultCountryCode,
      countryName: cfg.geo.defaultCountryName
    };
    this.profileDefaults = {
      os: cfg.profile.unknownOs,
      browser: cfg.profile.unknownBrowser
    };
    this.defaultInstrument = cfg.song.defaultInstrument;
    this.countryLookupEnabled = cfg.mode.countryLookupEnabled;

    this.canvas = document.createElement("canvas");
    this.container = document.createElement("div");
    this.titleScreen = document.createElement("img");
    this.titleScreen.src = "./welcome.jpg";
    this.titleScreen.alt = "Han Soloist - Click to Start";
    this.titleScreen.decoding = "async";
    this.titleLevelBar = document.createElement("div");
    this.titleLevelBar.className = "title-level-bar";
    this.titleModeBar = document.createElement("div");
    this.titleModeBar.className = "title-mode-bar";
    this.resetLevelButton = document.createElement("button");
    this.resetLevelButton.type = "button";
    this.resetLevelButton.className = "reset-level-btn";
    this.resetLevelButton.setAttribute("aria-label", "Reset level");
    this.resetLevelButton.innerHTML =
      "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><path d=\"M12 16c1.671 0 3-1.331 3-3s-1.329-3-3-3-3 1.331-3 3 1.329 3 3 3z\"/><path d=\"M20.817 11.186a8.94 8.94 0 0 0-1.355-3.219 9.053 9.053 0 0 0-2.43-2.43 8.95 8.95 0 0 0-3.219-1.355 9.028 9.028 0 0 0-1.838-.18V2L8 5l3.975 3V6.002c.484-.002.968.044 1.435.14a6.961 6.961 0 0 1 2.502 1.053 7.005 7.005 0 0 1 1.892 1.892A6.967 6.967 0 0 1 19 13a7.032 7.032 0 0 1-.55 2.725 7.11 7.11 0 0 1-.644 1.188 7.2 7.2 0 0 1-.858 1.039 7.028 7.028 0 0 1-3.536 1.907 7.13 7.13 0 0 1-2.822 0 6.961 6.961 0 0 1-2.503-1.054 7.002 7.002 0 0 1-1.89-1.89A6.996 6.996 0 0 1 5 13H3a9.02 9.02 0 0 0 1.539 5.034 9.096 9.096 0 0 0 2.428 2.428A8.95 8.95 0 0 0 12 22a9.09 9.09 0 0 0 1.814-.183 9.014 9.014 0 0 0 3.218-1.355 8.886 8.886 0 0 0 1.331-1.099 9.228 9.228 0 0 0 1.1-1.332A8.952 8.952 0 0 0 21 13a9.09 9.09 0 0 0-.183-1.814z\"/></svg>";
    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .container {
        position: relative;
        width: 100%;
        height: 100%;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      img.title {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border-radius: 10%;
        -webkit-mask-image: radial-gradient(
          circle at center,
          #000 0%,
          #000 70%,
          transparent 100%
        );
        mask-image: radial-gradient(circle at center, #000 60%, #000 70%, transparent 80%);
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
      }

      .title-level-bar {
        position: absolute;
        left: 50%;
        top: 40px;
        transform: translateX(-50%);
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(111, 111, 111, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.15);
        pointer-events: auto;
        flex-wrap: wrap;
        justify-content: center;
        width: 70vw;
      }

      .title-mode-bar {
        position: absolute;
        left: 50%;
        bottom: 80px;
        transform: translateX(-50%);
        display: flex;
        gap: 0;
        padding: 12px 24px;
        background: rgba(255, 255, 255, 0.8);
        border-radius: 36px;
        border: none;
        box-shadow: 0 2px 24px 0 rgba(0,0,0,0.10);
        pointer-events: auto;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        max-width: min(95vw, 600px);
      }

      .title-mode-label {
        color: #111;
        font-family: sans-serif;
        font-weight: 900;
        font-size: 18px;
        margin-right: 12px;
      }

      .title-mode-choices {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-right: 32px;
      }

      @media (pointer: coarse) {
        .title-mode-choices {
          margin-right: 0;
        }
      }

      .mode-btn {
        appearance: none;
        border: 2px solid transparent;
        border-radius: 18px;
        background: transparent;
        color: #111;
        font-family: sans-serif;
        padding: 6px 12px;
        cursor: pointer;
        box-shadow: none;
        display: inline-flex;
        align-items: center;
        transition: border 0.15s, background 0.15s, color 0.15s;
      }

      .mode-btn.active {
        background: #fff;
        color: #111;
        border: 2px solid #111;
        box-shadow: none;
      }

      .title-start-btn {
        appearance: none;
        border: none;
        border-radius: 20px;
        background: #f4c542;
        color: #111;
        font-family: sans-serif;
        padding: 12px 36px;
        margin: 8px auto;
        cursor: pointer;
        box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.30);
      }

      .title-level-bar button {
        appearance: none;
        border: 0;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        font: 900 18px/1 sans-serif;
        padding: 10px 14px;
        cursor: pointer;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15) inset;
      }

      .title-level-bar button:hover {
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35) inset;
      }

      .title-level-bar button:active {
        transform: translateY(1px);
      }

      .reset-level-btn {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 48px;
        height: 48px;
        background: black;
        border: 0;
        color: #ffffff;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0.4;
        transition:
          opacity 120ms ease,
          background-color 120ms ease,
          transform 120ms ease,
          border-color 120ms ease,
          box-shadow 120ms ease;
        pointer-events: auto;
      }

      .reset-level-btn:hover {
        opacity: 0.98;
        background: rgba(0, 0, 0, 0.42);
        border-color: rgba(255, 255, 255, 0.92);
        transform: scale(1.04);
      }

      .reset-level-btn:active {
        transform: scale(0.98);
      }

      .reset-level-btn svg {
        width: 28px;
        height: 28px;
        fill: currentColor;
      }
    `;
    this.titleScreen.className = "title";
    this.shadowRoot.appendChild(style);
    this.container.className = "container";
    this.container.appendChild(this.canvas);
    this.container.appendChild(this.titleScreen);
    this.container.appendChild(this.titleModeBar);
    this.container.appendChild(this.titleLevelBar);
    this.container.appendChild(this.resetLevelButton);
    this.shadowRoot.appendChild(this.container);
    this.ctx = this.canvas.getContext("2d");
    this.canvas.style.display = "none";
    this.resizeCanvas = this.resizeCanvas.bind(this);
    this.unlockAudio = this.unlockAudio.bind(this);
    this.onUserStart = this.onUserStart.bind(this);
    this.mousePos = { x: 0, y: 0 };
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onResetLevelClick = this.onResetLevelClick.bind(this);

    if (window.Tone && window.SampleLibrary) {
      this.notePlayback.loadInstrument("piano").then(() => {
      });
      this.notePlayback.loadInstrument("organ").then(() => {
      });
    }
  }

  connectedCallback() {
    window.addEventListener("resize", this.resizeCanvas);
    window.addEventListener("mousemove", this.onMouseMove, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown, {
      passive: true
    });
    this.resetLevelButton.addEventListener("click", this.onResetLevelClick);
    this.titleScreen.addEventListener("click", this.onUserStart, {
      passive: true
    });
    this.container.addEventListener("click", this.onUserStart, {
      passive: true
    });
    this.resizeCanvas();
    void this.ensureMaxLevelLoaded().then(async () => {
      this.renderTitleLevelButtons();
      const routeLevel = parseLevelRoute();
      if (routeLevel == null) return;
      if (!this.levelFileIndex?.[String(routeLevel)]) {
        replaceRootRoute();
        return;
      }
      await this.startSingleLevelFromTitle(routeLevel);
    });
    void getCountryByIp({
      enabled: this.countryLookupEnabled,
      defaults: this.geoDefaults
    }).then((geo) => {
      this.countryCode = geo.countryCode || this.geoDefaults.countryCode;
    });
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this.resizeCanvas);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.resetLevelButton.removeEventListener("click", this.onResetLevelClick);
    this.titleScreen.removeEventListener("click", this.onUserStart);
    this.container.removeEventListener("click", this.onUserStart);
    this.stopCamera();
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
  }

  renderTitleLevelButtons() {
    if (!this.titleLevelBar) return;
    if (!this.titleModeBar) return;
    this.titleLevelBar.textContent = "";
    this.titleModeBar.textContent = "";
    if (this.gameState !== GAME_STATE.TITLE) {
      this.titleLevelBar.style.display = "none";
      this.titleModeBar.style.display = "none";
      return;
    }
    const mobile = this.isMobileDevice();
    const modeDefs = [
      {
        mode: PLAY_MODE.CAMERA,
        label: UI_STRINGS.title.modeLabels.camera
      }
    ];
    if (mobile) {
      modeDefs.push({
        mode: PLAY_MODE.TOUCH,
        label: UI_STRINGS.title.modeLabels.touch
      });
      if (
        this.play_mode !== PLAY_MODE.CAMERA &&
        this.play_mode !== PLAY_MODE.TOUCH
      ) {
        this.setPlayMode(PLAY_MODE.TOUCH);
      }
    } else {
      modeDefs.push(
        {
          mode: PLAY_MODE.MOUSE,
          label: UI_STRINGS.title.modeLabels.mouse
        },
        {
          mode: PLAY_MODE.KEYBOARD,
          label: UI_STRINGS.title.modeLabels.keyboard
        }
      );
    }

    this.titleModeBar.style.display = "";
    const label = document.createElement("span");
    label.className = "title-mode-label";
    label.textContent = UI_STRINGS.title.modePrompt;
    this.titleModeBar.appendChild(label);

    const modeChoices = document.createElement("div");
    modeChoices.className = "title-mode-choices";
    for (const m of modeDefs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `mode-btn${this.play_mode === m.mode ? " active" : ""}`;
      btn.textContent = m.label;
      btn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.setPlayMode(m.mode);
          if (m.mode === PLAY_MODE.CAMERA) {
            void this.startCamera();
          }
          this.renderTitleLevelButtons();
        },
        { passive: false }
      );
      modeChoices.appendChild(btn);
    }
    this.titleModeBar.appendChild(modeChoices);

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "title-start-btn";
    startBtn.textContent = UI_STRINGS.title.start;
    startBtn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.startFromTitleSelection();
      },
      { passive: false }
    );
    this.titleModeBar.appendChild(startBtn);

    if (this.GAME_MODE === GAME_MODE.PROD) {
      this.titleLevelBar.style.display = "none";
      return;
    }
    const levels = Object.keys(this.levelFileIndex || {})
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!levels.length) {
      this.titleLevelBar.style.display = "none";
      return;
    }
    this.titleLevelBar.style.display = "";
    for (const level of levels) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = String(level);
      btn.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          void this.startSingleLevelFromTitle(level);
        },
        { passive: false }
      );
      this.titleLevelBar.appendChild(btn);
    }
  }

  async startFromTitleSelection() {
    this.renderTitleLevelButtons();
    if (this.gameState !== GAME_STATE.TITLE) return;
    const nowTs = performance.now();
    this.unlockAudio();
    this.titleScreen.style.display = "none";
    this.canvas.style.display = "";
    if (this.titleLevelBar) this.titleLevelBar.style.display = "none";
    if (this.titleModeBar) this.titleModeBar.style.display = "none";
    await this.startNewRun(nowTs);
    this.startGameLoop();
  }

  async startSingleLevelFromTitle(level) {
    if (this.gameState !== GAME_STATE.TITLE) return;
    const nowTs = performance.now();
    this.unlockAudio();
    this.titleScreen.style.display = "none";
    this.canvas.style.display = "";
    if (this.titleLevelBar) this.titleLevelBar.style.display = "none";
    if (this.titleModeBar) this.titleModeBar.style.display = "none";
    this.startCamera();
    await this.ensureMaxLevelLoaded();
    const selected = Math.max(
      1,
      Math.min(Math.floor(Number(level) || 1), this.maxLevel || 1)
    );
    this.currentLevel = selected;
    this.runEndLevel = selected;
    this.isSingleLevelMode = true;
    this.score = 0;
    pushLevelRoute(selected);
    this.startLevelFlow(nowTs);
    this.startGameLoop();
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      this.mousePos = { x: 0, y: 0 };
      return;
    }
    const x = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    this.mousePos = { x, y };
  }

  onUserStart() {
    const nowTs = performance.now();
    if (this.gameState === GAME_STATE.TITLE) {
      const mobile = this.isMobileDevice();
      if (mobile) {
        return;
      }
      this.unlockAudio();
      this.titleScreen.style.display = "none";
      this.canvas.style.display = "";
      if (this.titleLevelBar) this.titleLevelBar.style.display = "none";
      if (this.titleModeBar) this.titleModeBar.style.display = "none";
      this.startCamera();
      void this.startNewRun(nowTs);
      return;
    }
    if (this.gameState === GAME_STATE.GAME_OVER) {
      this.returnToTitle();
    }
  }

  onResetLevelClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.gameState === GAME_STATE.TITLE) return;
    const nowTs = performance.now();
    this.startLevelFlow(nowTs);
  }

  async startNewRun(nowTs) {
    await this.ensureMaxLevelLoaded();
    if (!Number.isFinite(this.maxLevel) || this.maxLevel < 1) {
      this.returnToTitle();
      return;
    }
    this.currentLevel = 1;
    this.runEndLevel = this.maxLevel;
    this.isSingleLevelMode = false;
    this.score = 0;
    replaceRootRoute();
    this.startLevelFlow(nowTs);
  }

  returnToTitle() {
    this.stopCamera();
    this.gameState = GAME_STATE.TITLE;
    this.titleScreen.style.display = "";
    this.canvas.style.display = "none";
    if (this.titleLevelBar) this.titleLevelBar.style.display = "";
    if (this.titleModeBar) this.titleModeBar.style.display = "";
    this.notes = [];
    this.songEvents = [];
    this.songEventIndex = 0;
    this.currentLevel = 1;
    this.runEndLevel = null;
    this.isSingleLevelMode = false;
    this.maxLevelPromise = null;
    this.score = 0;
    this.streak = 0;
    this.powerMode = false;
    this.powerModeLabelStartTs = 0;
    this.scorePopups = [];
    this.arrowHeld.clear();
    this.tapActiveDir = null;
    this.tapActiveUntilTs = 0;
    this.resetLevelButton.style.display = "none";
    replaceRootRoute();
  }

  isMobileDevice() {
    if (window.matchMedia?.("(pointer: coarse)").matches) return true;
    if (window.matchMedia?.("(any-pointer: coarse)").matches) return true;
    if (window.matchMedia?.("(hover: none)").matches) return true;
    if ((navigator.maxTouchPoints || 0) > 0) return true;
    if (navigator.userAgentData?.mobile) return true;
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  setPlayMode(mode) {
    const allowed = new Set(Object.values(PLAY_MODE));
    if (!allowed.has(mode)) return;
    this.play_mode = mode;
    this.settings = { ...this.settings, playMode: mode };
    saveSettings(this.settings);
    this.arrowHeld.clear();
    this.tapActiveDir = null;
    this.tapActiveUntilTs = 0;
    if (mode !== PLAY_MODE.KEYBOARD) {
      this.primaryDirection = DIRECTION.MIDDLE;
    }
  }

  clearPrimaryDirection(nowTs) {
    const prev = this.primaryDirection;
    if (!prev) return;
    const prevIntensity = this.getDirectionIntensity(prev);
    this.activeDirStates.set(prev, {
      fadeStartTs: nowTs,
      intensity: prevIntensity
    });
    this.primaryDirection = null;
  }

  clearAllDirections() {
    this.primaryDirection = null;
    this.activeDirStates.clear();
    this.lastDirectionActivatedTs?.clear();
  }

  mapKeyToDirection(key) {
    const k = String(key || "").toLowerCase();
    if (k === "arrowup" || k === "w") return DIRECTION.UP;
    if (k === "arrowright" || k === "d") return DIRECTION.RIGHT;
    if (k === "arrowdown" || k === "s") return DIRECTION.DOWN;
    if (k === "arrowleft" || k === "a") return DIRECTION.LEFT;
    return null;
  }

  onKeyDown(e) {
    const allowKeyboard =
      this.play_mode === PLAY_MODE.KEYBOARD ||
      this.GAME_MODE === GAME_MODE.DEV_KEYBOARD ||
      this.GAME_MODE === GAME_MODE.DEV_RECORD;
    if (!allowKeyboard) return;
    if (
      this.GAME_MODE === GAME_MODE.DEV_RECORD &&
      !String(e.key || "")
        .toLowerCase()
        .startsWith("arrow")
    ) {
      return;
    }
    const dir = this.mapKeyToDirection(e.key);
    if (!dir) return;
    this.arrowHeld.add(dir);
    this.selectDirection(dir, performance.now());
    e.preventDefault();
  }

  onKeyUp(e) {
    const allowKeyboard =
      this.play_mode === PLAY_MODE.KEYBOARD ||
      this.GAME_MODE === GAME_MODE.DEV_KEYBOARD ||
      this.GAME_MODE === GAME_MODE.DEV_RECORD;
    if (!allowKeyboard) return;
    if (
      this.GAME_MODE === GAME_MODE.DEV_RECORD &&
      !String(e.key || "")
        .toLowerCase()
        .startsWith("arrow")
    ) {
      return;
    }
    const dir = this.mapKeyToDirection(e.key);
    if (!dir) return;
    this.arrowHeld.delete(dir);
    const remaining = Array.from(this.arrowHeld);
    const nowTs = performance.now();
    if (remaining.length)
      this.selectDirection(remaining[remaining.length - 1], nowTs);
    else this.selectDirection(DIRECTION.MIDDLE, nowTs);
    e.preventDefault();
  }

  onPointerDown(e) {
    if (this.play_mode !== PLAY_MODE.TOUCH) return;
    if (this.gameState !== GAME_STATE.PLAYING) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const layout = getRenderOverlayLayout(this, {
      dx: 0,
      dy: 0,
      dw: this.canvas.width,
      dh: this.canvas.height
    });
    const dir = this.getDirectionFromPoint(layout, x, y);
    const nowTs = performance.now();
    if (!dir) {
      this.tapActiveDir = null;
      this.tapActiveUntilTs = 0;
      this.clearAllDirections();
      return;
    }
    this.tapActiveDir = dir;
    this.tapActiveUntilTs = 0;
    this.selectDirection(dir, nowTs);
  }

  getDirectionFromPoint(layout, x, y) {
    for (const dir of this.directions) {
      const [px, py] = layout.positions[dir];
      const s = layout.boxSize;
      if (x >= px && x <= px + s && y >= py && y <= py + s) {
        return dir;
      }
    }
    return null;
  }

  async ensureMaxLevelLoaded() {
    if (this.maxLevelPromise) return this.maxLevelPromise;
    const p = (async () => {
      try {
        const res = await fetch(API_ROUTE.LEVELS_INDEX, { cache: "no-cache" });
        if (!res.ok) throw new Error(`levels-index: ${res.status}`);
        const data = await res.json();
        this.levelFileIndex = data?.levels || {};
        const levels = Object.keys(this.levelFileIndex).map((k) => Number(k));
        this.maxLevel = levels.length
          ? Math.max(...levels.filter((n) => Number.isFinite(n)))
          : 0;
      } catch {
        this.levelFileIndex = {};
        this.maxLevel = 0;
      }
    })();
    this.maxLevelPromise = p;
    return p;
  }

  unlockAudio() {
    if (this.audioUnlocked) {
      return;
    }
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }
      this.audioCtx = new AudioContextCtor();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = this.config.audio.masterGain;
      this.masterGain.connect(this.audioCtx.destination);
      this.audioUnlocked = true;
      // Resume if created in suspended state.
      this.audioCtx.resume?.();
    } catch {
      // Ignore; audio will remain disabled.
    }
  }

  midiToFreq(midi) {
    // A4 must be 440Hz for standard MIDI tuning.
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  playNote(
    midi,
    durationMs = 220,
    velocity = 0.85,
    instrument = "piano",
    effects = null
  ) {
    // Prefer Tone.js piano sampler if present; fallback to oscillator synth.
    if (this.notePlayback && window.Tone && window.SampleLibrary) {
      const durSec = Math.max(0.04, durationMs / 1000);
      // Apply effects before triggering note
      if (typeof this.notePlayback.applySongEffects === "function") {
        this.notePlayback.applySongEffects(effects);
      }
      void this.notePlayback.triggerNote(midi, durSec, velocity, instrument);
      return;
    }
    if (!this.audioUnlocked || !this.audioCtx || !this.masterGain) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const duration = durationMs / 1000;
    const freq = this.midiToFreq(midi);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  resizeCanvas() {
    const rect = this.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = w;
    this.canvas.height = h;
  }

  async startCamera() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.video.srcObject = this.stream;
      this.video.onloadedmetadata = () => {
        this.video.play();
        this.startGameLoop();
      };
    } catch {
      // Optionally show error overlay
      // Still run the render loop so non-video gameplay continues.
      this.startGameLoop();
    }
  }

  startGameLoop() {
    if (this.animationFrame) return;
    this.processFrame();
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  processFrame() {
    processFrameStep(this);
  }

  startLevel(level, layout, nowTs) {
    startLevelState(this, level, layout, nowTs);
  }

  startLevelFlow(nowTs) {
    startLevelFlowState(this, nowTs);
  }

  advanceLevel(nowTs, layout) {
    advanceLevelState(this, nowTs, layout);
  }

  async ensureLevelReady(level) {
    await ensureLevelReadyState(this, level);
  }

  async ensureLevelSongLoaded(level) {
    await ensureLevelSongLoadedState(this, level);
  }

  async ensureLevelInstrumentsLoaded(level) {
    await ensureLevelInstrumentsLoadedState(this, level);
  }

  decodeLane(lane) {
    return decodeSongLane(lane);
  }

  maybeSpawnSongNotes(nowTs, layout) {
    maybeSpawnSongNotesState(this, nowTs, layout);
  }

  registerMissEvent(nowTs) {
    if (this.GAME_MODE === "dev-record") return;
    if (nowTs - this.lastMissTs < this.missLeniencyMs) return;
    this.lastMissTs = nowTs;
    this.missCount = Math.min(this.maxMissDots, this.missCount + 1);
    if (this.missCount >= this.maxMissDots) {
      this.levelFailed = true;
      if (this.gameState === GAME_STATE.PLAYING && this.isSingleLevelMode) {
        this.gameState = GAME_STATE.LEVEL_COMPLETE;
        this.levelCompleteStartTs = nowTs;
        this.songResolveSettledStartTs = 0;
        this.finishDevRecordLevel(nowTs);
      } else if (this.gameState === GAME_STATE.PLAYING) {
        this.enterGameOver(nowTs);
      }
    }
  }

  getActiveTargetForRecord() {
    return this.primaryDirection || DIRECTION.MIDDLE;
  }

  startDevRecordLevel(nowTs) {
    if (this.GAME_MODE !== "dev-record") return;
    this.devRecordLevelStartTs = nowTs;
    this.devRecordLastTarget = this.getActiveTargetForRecord();
    this.devRecordLastChangeTs = nowTs;
    this.devRecordTargetRanges = [];
    this.devRecordLevelCompleteLogged = false;
  }

  captureDevRecordFrame(nowTs) {
    if (this.GAME_MODE !== "dev-record") return;
    if (
      !Number.isFinite(this.devRecordLevelStartTs) ||
      this.devRecordLevelStartTs <= 0
    ) {
      this.startDevRecordLevel(nowTs);
      return;
    }
    const target = this.getActiveTargetForRecord();
    if (target === this.devRecordLastTarget) return;
    this.devRecordTargetRanges.push({
      target: this.devRecordLastTarget || this.config.dev.defaultRecordTarget,
      from: Math.max(
        0,
        Math.round(this.devRecordLastChangeTs - this.devRecordLevelStartTs)
      ),
      to: Math.max(0, Math.round(nowTs - this.devRecordLevelStartTs))
    });
    this.devRecordLastTarget = target;
    this.devRecordLastChangeTs = nowTs;
  }

  finishDevRecordLevel(nowTs) {
    if (this.GAME_MODE !== "dev-record") return;
    if (this.devRecordLevelCompleteLogged) return;
    if (
      !Number.isFinite(this.devRecordLevelStartTs) ||
      this.devRecordLevelStartTs <= 0
    )
      return;
    this.devRecordTargetRanges.push({
      target: this.devRecordLastTarget || this.config.dev.defaultRecordTarget,
      from: Math.max(
        0,
        Math.round(this.devRecordLastChangeTs - this.devRecordLevelStartTs)
      ),
      to: Math.max(0, Math.round(nowTs - this.devRecordLevelStartTs))
    });
    const lines = this.devRecordTargetRanges.map(
      (r) => `target: ${r.target}, from: ${r.from}, to: ${r.to}`
    );
    void lines;
    this.devRecordLevelCompleteLogged = true;
  }

  getScoreModeKey() {
    return getModeKey(this.play_mode);
  }

  getTopScoresForMode(modeKey = this.getScoreModeKey()) {
    const device = getDeviceProfile(this.profileDefaults).type;
    const playMode =
      modeKey === SCORE_MODE.CAMERA
        ? PLAY_MODE.CAMERA
        : modeKey === SCORE_MODE.KEYBOARD
          ? PLAY_MODE.KEYBOARD
          : modeKey === SCORE_MODE.TOUCH
            ? PLAY_MODE.TOUCH
            : PLAY_MODE.MOUSE;
    return getTopScoresForLevel(
      this.scoreStore,
      this.currentLevel,
      playMode,
      device
    );
  }

  enterGameOver(nowTs) {
    void nowTs;
    this.gameState = GAME_STATE.GAME_OVER;
    this.songResolveSettledStartTs = 0;
    this.finishDevRecordLevel(performance.now());
    const entered = window.prompt("Enter 3 initials for leaderboard:", "AAA");
    const result = recordScore({
      store: this.scoreStore,
      level: this.currentLevel,
      playMode: this.play_mode,
      score: this.score,
      initials: entered == null ? this.defaultInitials : entered,
      countryCode: this.countryCode,
      profileDefaults: this.profileDefaults
    });
    saveScoreStore(this.scoreStore);
    if (result.isNewPersonalBest) {
      window.alert("New personal best!");
    }
  }

  formatScore(value) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    return n.toLocaleString("en-US");
  }

  getNoteSpawnPoint(layout, corner) {
    return getSpawnPointFromLayout(layout, corner);
  }

  maybeSpawnRandomNote(nowTs, layout) {
    maybeSpawnRandomNoteState(this, nowTs, layout);
  }

  buildChordMidi(rootMidi, size) {
    return buildChordMidiState(rootMidi, size);
  }

  updateNotes(dtMs) {
    updateNotesState(this, dtMs);
  }

  resolveNoteHits(nowTs) {
    resolveNoteHitsState(this, nowTs);
  }

  getPointsPerNote() {
    return getPointsPerNoteState(this);
  }

  spawnScorePopups(group, perNotePoints, nowTs) {
    spawnScorePopupsState(this, group, perNotePoints, nowTs);
  }

  updateUpcomingNoteAssist(layout, nowTs) {
    updateUpcomingNoteAssistState(this, layout, nowTs);
  }

  selectDirection(dir, nowTs) {
    selectDirectionState(this, dir, nowTs);
  }

  updateActiveFades(nowTs) {
    updateActiveFadesState(this, nowTs);
  }

  applyDevAutoSelection(nowTs) {
    const upcoming = this.notes
      .filter(
        (n) =>
          !n.resolved &&
          nowTs >= n.startTs &&
          nowTs - n.hitTs <= this.devAutoPostHitGraceMs &&
          n.hitTs - nowTs <= this.hitAssistWindowMs
      )
      .sort((a, b) => a.hitTs - b.hitTs);
    const nextDirs = new Set();
    if (upcoming.length) {
      const nextHitTs = upcoming[0].hitTs;
      for (const n of upcoming) {
        if (Math.abs(n.hitTs - nextHitTs) < 2) nextDirs.add(n.targetDir);
        else break;
      }
    }
    if (nextDirs.size) {
      const nextPrimary = nextDirs.has(DIRECTION.MIDDLE)
        ? DIRECTION.MIDDLE
        : Array.from(nextDirs)[0];
      this.primaryDirection = nextPrimary;
      for (const dir of this.directions) {
        if (nextDirs.has(dir)) {
          this.activeDirStates.set(dir, { fadeStartTs: null, intensity: 1 });
        } else {
          this.activeDirStates.delete(dir);
        }
      }
    } else {
      this.primaryDirection = DIRECTION.MIDDLE;
      this.activeDirStates.clear();
      this.activeDirStates.set(DIRECTION.MIDDLE, {
        fadeStartTs: null,
        intensity: 1
      });
    }
  }

  getDirectionIntensity(dir) {
    return getRenderDirectionIntensity(this, dir);
  }

  isDirectionActive(dir) {
    return isDirectionActiveState(this, dir);
  }

  getSquareMotionLayoutKey(layout) {
    return getSquareMotionLayoutKeyState(this, layout);
  }

  resetSquareMotion(layout) {
    resetSquareMotionState(this, layout);
  }

  getImminentTargetDirections(nowTs, horizonMs = 800) {
    return getImminentTargetDirectionsState(this, nowTs, horizonMs);
  }

  updateSquareMotionBaselines(data, width, height, layout) {
    updateSquareMotionBaselinesState(this, data, width, height, layout);
  }

  updateSquareMotionActivation(data, width, height, layout, nowTs) {
    updateSquareMotionActivationState(this, data, width, height, layout, nowTs);
  }

  updateMouseActivation(layout, nowTs) {
    return updateMouseActivationState(this, layout, nowTs);
  }

  spawnCaptureEffect(note, nowTs) {
    spawnCaptureEffectState(this, note, nowTs);
  }
}
