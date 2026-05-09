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
  decayEdgeGlow as decayEdgeGlowState,
  getPointsPerNote as getPointsPerNoteState,
  isDirectionActive as isDirectionActiveState,
  kickEdgeGlow as kickEdgeGlowState,
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
  drawCaptureEffects,
  drawCountdown,
  drawDebugInfo,
  drawEdgeGlow,
  drawFinalScore,
  drawLevelBanner,
  drawLevelComplete,
  drawMissDots,
  drawNotes,
  drawOverlay,
  drawScore,
  drawScorePopups,
  getDirectionIntensity as getRenderDirectionIntensity,
  getOverlayLayout as getRenderOverlayLayout
} from "./render.js";

export class HanSoloistGame extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.GAME_MODE = "stage"; // 'prod' | 'stage' | 'test' | 'dev' | 'dev-mouse' | 'dev-keyboard' | 'dev-video' | 'dev-auto' | 'dev-record'
    this.play_mode = "use-the-mouse";
    this.tapHoldMs = 260;
    this.tapActiveUntilTs = 0;
    this.tapActiveDir = null;
    this.arrowHeld = new Set();
    this.activeFadeMs = 200;
    this.primaryDirection = "MIDDLE";
    this.activeDirStates = new Map();
    // Per-square adaptive foreground detection for hand presence.
    this.squareMotionState = new Map();
    this.squareMotionLayoutKey = "";
    this.squareMotionFrames = 0;
    this.squareMotionTargetFrames = 18;
    this.squareMotionStride = 4;
    this.squareMotionEnterDiffThreshold = 24; // luma delta (0..255)
    this.squareMotionExitDiffThreshold = 18; // hysteresis lower threshold
    this.squareMotionMinPct = 0.1; // minimum foreground occupancy to be valid
    this.squareMotionOffPct = 0.065; // drop active below this for hold release
    this.squareMotionEmaAlpha = 0.2;
    this.squareMotionBgLearnAlpha = 0.05; // fast background learning
    this.squareMotionBgLearnAlphaFg = 0.002; // very slow while foreground present
    this.squareMotionActiveHoldMs = 300;
    this.squareMotionMiddleTopIgnore = 0.35; // ignore top face-prone region in MIDDLE
    this.squareMotionPctSmoothed = new Map();
    this.squareMotionPctLast = new Map();
    this.squareMotionActiveDir = null;
    this.squareMotionActiveUntilTs = 0;
    this.directions = ["UP", "RIGHT", "DOWN", "LEFT", "MIDDLE"];
    this.colors = {
      UP: "#cc3333", // red
      RIGHT: "#3366cc", // blue
      DOWN: "#339966", // green
      LEFT: "#999900", // yellow
      MIDDLE: "#999999" // grey
    };
    // Fill colors: mostly transparent by default so video remains visible.
    // "Active" highlights more strongly.
    this.fillColors = {
      UP: "rgba(204,51,51,0.10)",
      RIGHT: "rgba(51,102,204,0.10)",
      DOWN: "rgba(51,153,102,0.10)",
      LEFT: "rgba(153,153,0,0.10)",
      MIDDLE: "rgba(153,153,153,0.10)"
    };
    this.activeFillColors = {
      UP: "rgba(204,51,51,0.50)",
      RIGHT: "rgba(51,102,204,0.50)",
      DOWN: "rgba(51,153,102,0.50)",
      LEFT: "rgba(153,153,0,0.50)",
      MIDDLE: "rgba(153,153,153,0.50)"
    };
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
    this.spawnIntervalMs = 550;
    this.playingStartTs = 0;
    this.songStartTs = 0;
    this.songEvents = [];
    this.songEventIndex = 0;
    this.levelSongCache = new Map();
    this.levelSongLoads = new Map();
    // Original game advanced `songStep` once per `frameDelay` (10ms).
    // Treat song "ticks" as 10ms to match the legacy pacing.
    this.songTickMs = 10;
    this.hitAssistWindowMs = 750;
    this.targetHitGraceMs = 180;
    this.lastDirectionActivatedTs = new Map();

    // WebAudio (must be unlocked by a user gesture)
    this.audioCtx = null;
    this.masterGain = null;
    this.audioUnlocked = false;
    this.notePlayback = new NotePlayback();

    // Game state
    this.gameState = "title"; // title | level_banner | countdown | playing | level_complete | game_over
    this.levelBannerStartTs = 0;
    this.levelBannerMs = 3000;
    this.countdownStartTs = 0;
    this.countdownMs = 3000;
    this.levelCompleteStartTs = 0;
    this.levelCompletePauseMs = 4000;
    this.songCompleteReadyDelayMs = 2000;
    this.songResolveSettledStartTs = 0;

    // Levels + scoring
    this.currentLevel = 1;
    this.maxLevel = 1;
    this.maxLevelPromise = null;
    this.runEndLevel = null;
    this.isSingleLevelMode = false;
    this.score = 0;
    this.streak = 0;
    this.scoreBasePerNote = 1;
    this.scoreStreakStepEvery = 8;
    this.scoreStreakStepAmount = 2;
    this.scoreMaxPerNote = 444;
    this.scoreForceModeThreshold = 44;
    this.powerMode = false;
    this.powerModeLabelStartTs = 0;
    this.powerModeLabelFadeMs = 5000;
    this.powerModeLabel = "POWER MODE";
    this.scorePopups = [];
    this.scorePulseStartTs = 0;
    this.scorePulseMs = 650;
    this.scorePopupGrowthScale = 1.2;
    this.scorePopupVerticalDriftScale = 0.4;
    this.scorePopupHorizontalDriftScale = 0.4;
    this.targetBoxStrokeWidth = 6;
    this.noteStrokeWidth = 4;
    this.captureEffects = [];
    this.captureEffectDurationMs = 280;
    this.captureNoteScaleDurationFactor = 2;
    this.captureNoteMaxScale = 2.4;
    this.captureEffectStrokeWidth = 8;
    this.captureEffectBlurScale = 2.5;
    this.captureEffectStartRadiusScale = 2.4;
    this.captureEffectEndRadiusScale = 1.4;
    this.captureEffectLineWidthScale = 0.06;
    this.captureEffectWavePeak = 0.92;
    this.captureEffectWaveValley = 0.08;
    this.captureEffectAlphaScale = 0.4;
    this.noteUpcomingOpacityStep = 0.2;
    this.noteMinUpcomingOpacity = 0.1;
    this.noteMaxUpcomingOpacity = 1.0;
    this.devAutoPostHitGraceMs = 140;
    this.devRecordLevelStartTs = 0;
    this.devRecordLastTarget = "NONE";
    this.devRecordLastChangeTs = 0;
    this.devRecordTargetRanges = [];
    this.devRecordLevelCompleteLogged = false;

    this.maxMissDots = 4;
    this.missLeniencyMs = 1000;
    this.missCount = 0;
    this.lastMissTs = -Infinity;
    this.levelFailed = false;
    this.levelPerfect = false;

    // Edge glow feedback (on successful captures)
    this.edgeGlow = new Map([
      ["UP", 0],
      ["RIGHT", 0],
      ["DOWN", 0],
      ["LEFT", 0]
    ]);
    this.edgeGlowBursts = [];
    this.edgeGlowColor = new Map([
      ["UP", this.colors.UP],
      ["RIGHT", this.colors.RIGHT],
      ["DOWN", this.colors.DOWN],
      ["LEFT", this.colors.LEFT]
    ]);
    // 1.0 = full thickness (middle hits), 0.5 = half thickness (edge hits)
    this.edgeGlowSizeScale = new Map([
      ["UP", 0.6],
      ["RIGHT", 0.6],
      ["DOWN", 0.6],
      ["LEFT", 0.6]
    ]);
    this.edgeGlowEnabled = false;
    // Stronger punch, faster fade.
    this.edgeGlowHalfLifeMs = 340;
    this.edgeGlowKick = 6.0;
    this.edgeGlowMax = 1.0;
    // Edge glow waveform tuning (editable at runtime for quick iteration)
    this.edgeGlowHeightMinScale = 0.2;
    this.edgeGlowHeightMaxScale = 0.8;
    this.edgeGlowCornerFadeScale = 0.18;
    this.edgeGlowCornerFadePower = 1.35;
    this.edgeGlowBlurScale = 0.7;
    this.edgeGlowStrokePx = 4;
    this.regularEdgeModeScale = 0.5;
    this.edgeGlowPolySteps = 128;
    this.edgeGlowDriftRatio = 0.88;
    this.edgeGlowBurstFadeMs = 480;
    this.highScoreStorageKey = "han_soloist_highscores_v1";
    this.highScores = this.createEmptyHighScores();

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
    this.resetLevelButton.innerHTML = "<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><path d=\"M12 16c1.671 0 3-1.331 3-3s-1.329-3-3-3-3 1.331-3 3 1.329 3 3 3z\"/><path d=\"M20.817 11.186a8.94 8.94 0 0 0-1.355-3.219 9.053 9.053 0 0 0-2.43-2.43 8.95 8.95 0 0 0-3.219-1.355 9.028 9.028 0 0 0-1.838-.18V2L8 5l3.975 3V6.002c.484-.002.968.044 1.435.14a6.961 6.961 0 0 1 2.502 1.053 7.005 7.005 0 0 1 1.892 1.892A6.967 6.967 0 0 1 19 13a7.032 7.032 0 0 1-.55 2.725 7.11 7.11 0 0 1-.644 1.188 7.2 7.2 0 0 1-.858 1.039 7.028 7.028 0 0 1-3.536 1.907 7.13 7.13 0 0 1-2.822 0 6.961 6.961 0 0 1-2.503-1.054 7.002 7.002 0 0 1-1.89-1.89A6.996 6.996 0 0 1 5 13H3a9.02 9.02 0 0 0 1.539 5.034 9.096 9.096 0 0 0 2.428 2.428A8.95 8.95 0 0 0 12 22a9.09 9.09 0 0 0 1.814-.183 9.014 9.014 0 0 0 3.218-1.355 8.886 8.886 0 0 0 1.331-1.099 9.228 9.228 0 0 0 1.1-1.332A8.952 8.952 0 0 0 21 13a9.09 9.09 0 0 0-.183-1.814z\"/></svg>";
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
      console.log(
        "[HanSoloist] Tone.js and SampleLibrary detected. Loading piano and organ..."
      );
      this.notePlayback.loadInstrument("piano").then(() => {
        console.log("[HanSoloist] Piano instrument loaded");
      });
      this.notePlayback.loadInstrument("organ").then(() => {
        console.log("[HanSoloist] Organ instrument loaded");
      });
    } else {
      console.warn(
        "[HanSoloist] Tone.js or SampleLibrary not found on page load"
      );
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
    this.loadHighScores();
    void this.ensureMaxLevelLoaded().then(() => this.renderTitleLevelButtons());
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
    if (this.gameState !== "title") {
      this.titleLevelBar.style.display = "none";
      this.titleModeBar.style.display = "none";
      return;
    }
    const mobile = this.isMobileDevice();
    const modeDefs = [
      {
        mode: "use-the-force",
        label: "FORCE"
      }
    ];
    if (mobile) {
      modeDefs.push({
        mode: "use-the-tap",
        label: "TAP"
      });
      if (
        this.play_mode !== "use-the-force" &&
        this.play_mode !== "use-the-tap"
      ) {
        this.setPlayMode("use-the-tap");
      }
    } else {
      modeDefs.push(
        {
          mode: "use-the-mouse",
          label: "MOUSE"
        },
        {
          mode: "use-the-arrows",
          label: "KEYBOARD"
        }
      );
    }

    this.titleModeBar.style.display = "";
    const label = document.createElement("span");
    label.className = "title-mode-label";
    label.textContent = "USE THE";
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
          if (m.mode === "use-the-force") {
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
    startBtn.textContent = "START";
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

    if (this.GAME_MODE === "prod") {
      this.titleLevelBar.style.display = "none";
      return;
    }
    const max = Math.max(0, Math.floor(this.maxLevel || 0));
    if (max < 1) {
      this.titleLevelBar.style.display = "none";
      return;
    }
    this.titleLevelBar.style.display = "";
    for (let level = 1; level <= max; level++) {
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
    if (this.gameState !== "title") return;
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
    if (this.gameState !== "title") return;
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
    if (this.gameState === "title") {
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
    if (this.gameState === "game_over") {
      this.returnToTitle();
    }
  }

  onResetLevelClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.gameState === "title") return;
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
    this.startLevelFlow(nowTs);
  }

  returnToTitle() {
    this.stopCamera();
    this.gameState = "title";
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
    const allowed = new Set([
      "use-the-force",
      "use-the-mouse",
      "use-the-arrows",
      "use-the-tap"
    ]);
    if (!allowed.has(mode)) return;
    this.play_mode = mode;
    this.arrowHeld.clear();
    this.tapActiveDir = null;
    this.tapActiveUntilTs = 0;
    if (mode !== "use-the-arrows") {
      this.primaryDirection = "MIDDLE";
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
    if (k === "arrowup" || k === "w") return "UP";
    if (k === "arrowright" || k === "d") return "RIGHT";
    if (k === "arrowdown" || k === "s") return "DOWN";
    if (k === "arrowleft" || k === "a") return "LEFT";
    return null;
  }

  onKeyDown(e) {
    const allowKeyboard =
      this.play_mode === "use-the-arrows" ||
      this.GAME_MODE === "dev-keyboard" ||
      this.GAME_MODE === "dev-record";
    if (!allowKeyboard) return;
    if (
      this.GAME_MODE === "dev-record" &&
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
      this.play_mode === "use-the-arrows" ||
      this.GAME_MODE === "dev-keyboard" ||
      this.GAME_MODE === "dev-record";
    if (!allowKeyboard) return;
    if (
      this.GAME_MODE === "dev-record" &&
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
    else this.selectDirection("MIDDLE", nowTs);
    e.preventDefault();
  }

  onPointerDown(e) {
    if (this.play_mode !== "use-the-tap") return;
    if (this.gameState !== "playing") return;
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
        const res = await fetch("/api/max-level", { cache: "no-cache" });
        if (!res.ok) throw new Error(`max-level: ${res.status}`);
        const data = await res.json();
        const maxLevel = Number(data?.maxLevel);
        this.maxLevel =
          Number.isFinite(maxLevel) && maxLevel >= 0 ? maxLevel : 0;
      } catch {
        this.maxLevel = 0;
      }
    })();
    this.maxLevelPromise = p;
    return p;
  }

  unlockAudio() {
    if (this.audioUnlocked) {
      console.log("[unlockAudio] Audio already unlocked");
      return;
    }
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        console.warn("[unlockAudio] No AudioContext available");
        return;
      }
      this.audioCtx = new AudioContextCtor();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 0.35;
      this.masterGain.connect(this.audioCtx.destination);
      this.audioUnlocked = true;
      // Resume if created in suspended state.
      this.audioCtx.resume?.();
      console.log("[unlockAudio] Audio unlocked, context:", this.audioCtx);
    } catch (err) {
      console.error("[unlockAudio] Error unlocking audio:", err);
      // Ignore; audio will remain disabled.
    }
  }

  midiToFreq(midi) {
    // A4 must be 440Hz for standard MIDI tuning.
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  playNote(midi, durationMs = 220, velocity = 0.85, instrument = "piano") {
    // Prefer Tone.js piano sampler if present; fallback to oscillator synth.
    if (this.notePlayback && window.Tone && window.SampleLibrary) {
      const durSec = Math.max(0.04, durationMs / 1000);
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
    } catch (e) {
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
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const nowTs = performance.now();
    const dtMs = Math.min(50, Math.max(0, nowTs - this.lastFrameTs));
    this.lastFrameTs = nowTs;
    ctx.clearRect(0, 0, cw, ch);
    this.decayEdgeGlow(dtMs);
    // Background: show camera output only in "force" mode; otherwise keep it dark.
    let dx = 0;
    let dy = 0;
    let dw = cw;
    let dh = ch;
    let frameData = null;
    let frameW = cw;
    let frameH = ch;

    const devMixedMode = this.GAME_MODE === "dev";
    const devMouseMode = this.GAME_MODE === "dev-mouse";
    const devKeyboardMode = this.GAME_MODE === "dev-keyboard";
    const devVideoMode = this.GAME_MODE === "dev-video";
    const devAutoMode = this.GAME_MODE === "dev-auto";
    const devRecordMode = this.GAME_MODE === "dev-record";
    const hideVideoFeed = devMouseMode || devKeyboardMode || devRecordMode;
    const wantsVideoFeed =
      this.play_mode === "use-the-force" || devMixedMode || devVideoMode;
    const shouldConstrainPlayfield =
      !wantsVideoFeed &&
      !this.isMobileDevice() &&
      (this.play_mode === "use-the-mouse" ||
        this.play_mode === "use-the-arrows" ||
        devMouseMode ||
        devKeyboardMode);
    if (shouldConstrainPlayfield) {
      const fallbackAspect = 4 / 3;
      const aspect = vw > 0 && vh > 0 ? vw / vh : fallbackAspect;
      const scale = Math.min(cw / aspect, ch);
      dw = scale * aspect;
      dh = scale;
      dx = (cw - dw) / 2;
      dy = (ch - dh) / 2;
    }

    const mouseFrame = {
      dx: dx,
      dy: dy,
      dw: dw,
      dh: dh
    };

    let keyboardRegistered = false;
    let mouseRegistered = false;
    if (devAutoMode) {
      this.applyDevAutoSelection(nowTs);
    } else if (devKeyboardMode || devRecordMode) {
      const held = Array.from(this.arrowHeld);
      if (held.length) {
        this.selectDirection(held[held.length - 1], nowTs);
        keyboardRegistered = true;
      } else {
        this.selectDirection("MIDDLE", nowTs);
      }
    } else if (devMouseMode) {
      mouseRegistered = this.updateMouseActivation(mouseFrame, nowTs);
    } else if (devMixedMode) {
      const held = Array.from(this.arrowHeld);
      if (held.length) {
        this.selectDirection(held[held.length - 1], nowTs);
        keyboardRegistered = true;
      } else {
        mouseRegistered = this.updateMouseActivation(mouseFrame, nowTs);
      }
    } else if (this.play_mode === "use-the-mouse") {
      mouseRegistered = this.updateMouseActivation(mouseFrame, nowTs);
    } else if (this.play_mode === "use-the-arrows") {
      const held = Array.from(this.arrowHeld);
      if (held.length) this.selectDirection(held[held.length - 1], nowTs);
      else this.selectDirection("MIDDLE", nowTs);
    } else if (this.play_mode === "use-the-tap") {
      if (this.tapActiveDir) {
        this.selectDirection(this.tapActiveDir, nowTs);
      }
    }

    const canDrawVideo = this.stream && (vw > 0 || vh > 0);
    const showVideoFeed = canDrawVideo && !hideVideoFeed && wantsVideoFeed;
    if (showVideoFeed) {
      const scale = Math.min(cw / vw, ch / vh);
      dx = (cw - vw * scale) / 2;
      dy = (ch - vh * scale) / 2;
      dw = vw * scale;
      dh = vh * scale;

      ctx.save();
      ctx.translate(cw, 0);
      ctx.scale(-1, 1); // mirror
      if (this.powerMode) {
        ctx.filter = "hue-rotate(275deg) saturate(2.35) contrast(1.08)";
      }
      // If dims are temporarily 0 (some browsers), still attempt drawing to fill.
      if (vw > 0 && vh > 0) ctx.drawImage(this.video, dx, dy, dw, dh);
      else ctx.drawImage(this.video, 0, 0, cw, ch);
      ctx.filter = "none";
      ctx.restore();

      if (this.analysisCanvas.width !== cw) this.analysisCanvas.width = cw;
      if (this.analysisCanvas.height !== ch) this.analysisCanvas.height = ch;
      const tctx = this.analysisCtx;
      tctx.clearRect(0, 0, cw, ch);
      tctx.save();
      tctx.translate(cw, 0);
      tctx.scale(-1, 1);
      if (vw > 0 && vh > 0) tctx.drawImage(this.video, dx, dy, dw, dh);
      else tctx.drawImage(this.video, 0, 0, cw, ch);
      tctx.restore();
      const frame = tctx.getImageData(0, 0, cw, ch);
      frameData = frame.data;
      frameW = frame.width;
      frameH = frame.height;
    } else {
      ctx.save();
      if (hideVideoFeed) {
        const g = ctx.createRadialGradient(
          cw * 0.5,
          ch * 0.5,
          0,
          cw * 0.5,
          ch * 0.5,
          Math.max(cw, ch) * 0.7
        );
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#ededda");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = "#000";
      }
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    const layout = getRenderOverlayLayout(this, { dx, dy, dw, dh });
    const skipBannerAndCountdown =
      devMixedMode ||
      devMouseMode ||
      devKeyboardMode ||
      devVideoMode ||
      devAutoMode ||
      devRecordMode;
    const showDebugInfo =
      this.GAME_MODE === "test" ||
      devMixedMode ||
      devMouseMode ||
      devKeyboardMode ||
      devVideoMode ||
      devAutoMode ||
      devRecordMode;

    // Force-mode selection (camera motion).
    const shouldUseVideoSelection =
      !!frameData &&
      !devRecordMode &&
      wantsVideoFeed &&
      !(devMixedMode && (keyboardRegistered || mouseRegistered));
    if (shouldUseVideoSelection) {
      this.updateSquareMotionBaselines(frameData, frameW, frameH, layout);
      this.updateSquareMotionActivation(
        frameData,
        frameW,
        frameH,
        layout,
        nowTs
      );
    }

    let bannerElapsed = null;
    if (this.gameState === "level_banner") {
      if (skipBannerAndCountdown) {
        this.gameState = "playing";
        this.notes = [];
        this.lastSpawnTs = 0;
        this.playingStartTs = nowTs;
        this.startDevRecordLevel(nowTs);
        this.resetSquareMotion(layout);
        this.startLevel(this.currentLevel, layout, nowTs);
      } else {
        const elapsed = nowTs - this.levelBannerStartTs;
        if (elapsed >= this.levelBannerMs) {
          if (!this.levelReady?.has(this.currentLevel)) {
            void this.ensureLevelReady(this.currentLevel);
            bannerElapsed = this.levelBannerMs - 250;
          } else {
            this.gameState = "countdown";
            this.countdownStartTs = nowTs;
            this.notes = [];
            this.lastSpawnTs = 0;
            this.songEvents = [];
            this.songEventIndex = 0;
          }
        } else {
          bannerElapsed = elapsed;
        }
      }
    }

    // Skip countdown in dev mode for faster iteration.
    if (this.gameState === "countdown") {
      const elapsed = nowTs - this.countdownStartTs;
      if (elapsed >= this.countdownMs || skipBannerAndCountdown) {
        this.gameState = "playing";
        this.notes = [];
        this.lastSpawnTs = 0;
        this.playingStartTs = nowTs;
        this.startDevRecordLevel(nowTs);
        this.resetSquareMotion(layout);
        this.startLevel(this.currentLevel, layout, nowTs);
      }
    }

    if (this.gameState === "playing") {
      this.captureDevRecordFrame(nowTs);
      this.maybeSpawnSongNotes(nowTs, layout);
      if (devAutoMode) this.applyDevAutoSelection(nowTs);
      if (!devRecordMode) {
        this.updateUpcomingNoteAssist(layout, nowTs);
      }
      this.updateActiveFades(nowTs);
      this.updateNotes(dtMs);
      this.resolveNoteHits(nowTs);
      if (!devRecordMode) {
        drawNotes(this, ctx, layout);
      }
      drawCaptureEffects(this, ctx, layout, nowTs);
      drawScore(this, ctx, layout);
      drawMissDots(this, ctx, layout);
      drawScorePopups(this, ctx, layout, nowTs);

      if (
        this.songEvents.length &&
        this.songEventIndex >= this.songEvents.length
      ) {
        const hasActive = this.notes.some((n) => !n.resolved);
        if (hasActive) {
          this.songResolveSettledStartTs = 0;
        } else if (!this.songResolveSettledStartTs) {
          this.songResolveSettledStartTs = nowTs;
        } else if (
          nowTs - this.songResolveSettledStartTs >= this.songCompleteReadyDelayMs
        ) {
          this.levelFailed = this.missCount >= this.maxMissDots;
          this.levelPerfect = !this.levelFailed && this.missCount === 0;
          this.gameState = "level_complete";
          this.levelCompleteStartTs = nowTs;
          this.songResolveSettledStartTs = 0;
          this.finishDevRecordLevel(nowTs);
        }
      }
    }

    if (this.gameState === "level_complete") {
      drawCaptureEffects(this, ctx, layout, nowTs);
      drawScore(this, ctx, layout);
      drawMissDots(this, ctx, layout);
      drawScorePopups(this, ctx, layout, nowTs);
      drawLevelComplete(this, ctx, layout, nowTs - this.levelCompleteStartTs);
      if (nowTs - this.levelCompleteStartTs >= this.levelCompletePauseMs) {
        this.advanceLevel(nowTs, layout);
      }
    }

    if (this.gameState === "game_over") {
      drawFinalScore(this, ctx, layout);
    }

    if (this.gameState === "playing") {
      drawEdgeGlow(this, ctx, layout);
      drawOverlay(this, ctx, { dx, dy, dw, dh });
    }

    if (!skipBannerAndCountdown && this.gameState === "countdown") {
      drawCountdown(this, ctx, layout, nowTs - this.countdownStartTs);
    }

    if (!skipBannerAndCountdown && bannerElapsed != null) {
      drawLevelBanner(this, ctx, layout, bannerElapsed);
    }

    if (showDebugInfo) {
      drawDebugInfo(this, ctx, layout, nowTs);
    }

    if (this.gameState === "title") {
      this.resetLevelButton.style.display = "none";
      this.animationFrame = null;
      return;
    }

    this.resetLevelButton.style.display =
      this.canvas.style.display === "none" ? "none" : "flex";

    this.animationFrame = requestAnimationFrame(() => this.processFrame());
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
      if (this.gameState === "playing" && this.isSingleLevelMode) {
        this.gameState = "level_complete";
        this.levelCompleteStartTs = nowTs;
        this.songResolveSettledStartTs = 0;
        this.finishDevRecordLevel(nowTs);
      } else if (this.gameState === "playing") {
        this.enterGameOver(nowTs);
      }
    }
  }

  getActiveTargetForRecord() {
    return this.primaryDirection || "MIDDLE";
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
      target: this.devRecordLastTarget || "NONE",
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
      target: this.devRecordLastTarget || "NONE",
      from: Math.max(
        0,
        Math.round(this.devRecordLastChangeTs - this.devRecordLevelStartTs)
      ),
      to: Math.max(0, Math.round(nowTs - this.devRecordLevelStartTs))
    });
    const lines = this.devRecordTargetRanges.map(
      (r) => `target: ${r.target}, from: ${r.from}, to: ${r.to}`
    );
    console.log(lines.join("\n"));
    this.devRecordLevelCompleteLogged = true;
  }

  getScoreModeKey() {
    if (this.play_mode === "use-the-force") return "force";
    if (this.play_mode === "use-the-arrows") return "keyboard";
    if (this.play_mode === "use-the-tap") return "tap";
    return "mouse";
  }

  createEmptyHighScores() {
    return { force: [], mouse: [], keyboard: [], tap: [] };
  }

  loadHighScores() {
    try {
      const raw = localStorage.getItem(this.highScoreStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const out = this.createEmptyHighScores();
      for (const mode of Object.keys(out)) {
        const list = Array.isArray(parsed[mode]) ? parsed[mode] : [];
        out[mode] = list
          .filter((s) => s && Number.isFinite(s.score) && typeof s.initials === "string")
          .map((s) => ({
            initials: s.initials.slice(0, 3).toUpperCase(),
            score: Math.max(0, Math.floor(s.score)),
            ts: Number.isFinite(s.ts) ? s.ts : Date.now()
          }))
          .sort((a, b) => b.score - a.score || a.ts - b.ts)
          .slice(0, 10);
      }
      this.highScores = out;
    } catch {
      this.highScores = this.createEmptyHighScores();
    }
  }

  saveHighScores() {
    try {
      localStorage.setItem(this.highScoreStorageKey, JSON.stringify(this.highScores));
    } catch {
      void 0;
    }
  }

  getTopScoresForMode(modeKey = this.getScoreModeKey()) {
    return this.highScores[modeKey] || [];
  }

  isHighScore(score, modeKey = this.getScoreModeKey()) {
    const list = this.getTopScoresForMode(modeKey);
    if (list.length < 10) return true;
    return score > (list[list.length - 1]?.score || 0);
  }

  addHighScore(initials, score, modeKey = this.getScoreModeKey()) {
    const clean = String(initials || "AAA")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3)
      .padEnd(3, "A");
    const list = this.getTopScoresForMode(modeKey).slice();
    list.push({ initials: clean, score: Math.max(0, Math.floor(score)), ts: Date.now() });
    list.sort((a, b) => b.score - a.score || a.ts - b.ts);
    this.highScores[modeKey] = list.slice(0, 10);
    this.saveHighScores();
  }

  promptHighScoreInitials(modeKey, score) {
    if (!this.isHighScore(score, modeKey)) return;
    const entered = window.prompt("New high score! Enter 3 initials:", "AAA");
    if (entered == null) return;
    this.addHighScore(entered, score, modeKey);
  }

  enterGameOver(nowTs) {
    void nowTs;
    this.gameState = "game_over";
    this.songResolveSettledStartTs = 0;
    this.finishDevRecordLevel(performance.now());
    this.promptHighScoreInitials(this.getScoreModeKey(), this.score);
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
      const nextPrimary = nextDirs.has("MIDDLE")
        ? "MIDDLE"
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
      this.primaryDirection = "MIDDLE";
      this.activeDirStates.clear();
      this.activeDirStates.set("MIDDLE", { fadeStartTs: null, intensity: 1 });
    }
  }

  getDirectionIntensity(dir) {
    return getRenderDirectionIntensity(this, dir);
  }

  isDirectionActive(dir) {
    return isDirectionActiveState(this, dir);
  }

  kickEdgeGlow(dir) {
    kickEdgeGlowState(this, dir);
  }

  decayEdgeGlow(dtMs) {
    decayEdgeGlowState(this, dtMs);
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
