import { DIRECTION, GAME_MODE, GAME_STATE, PLAY_MODE } from "./constants.js";
import {
  drawCaptureEffects,
  drawCountdown,
  drawDebugInfo,
  drawFinalScore,
  drawLevelBanner,
  drawLevelComplete,
  drawMissDots,
  drawNotes,
  drawOverlay,
  drawScore,
  drawScorePopups,
  getOverlayLayout
} from "./render.js";

function getModeFlags(game) {
  const devMixedMode = game.GAME_MODE === GAME_MODE.DEV;
  const devMouseMode = game.GAME_MODE === GAME_MODE.DEV_MOUSE;
  const devKeyboardMode = game.GAME_MODE === GAME_MODE.DEV_KEYBOARD;
  const devVideoMode = game.GAME_MODE === GAME_MODE.DEV_VIDEO;
  const devAutoMode = game.GAME_MODE === GAME_MODE.DEV_AUTO;
  const devRecordMode = game.GAME_MODE === GAME_MODE.DEV_RECORD;
  return {
    devMixedMode,
    devMouseMode,
    devKeyboardMode,
    devVideoMode,
    devAutoMode,
    devRecordMode,
    hideVideoFeed: devMouseMode || devKeyboardMode || devRecordMode,
    wantsVideoFeed:
      game.play_mode === PLAY_MODE.CAMERA || devMixedMode || devVideoMode
  };
}

function applyInputSelection(game, nowTs, mouseFrame, flags) {
  let keyboardRegistered = false;
  let mouseRegistered = false;

  if (flags.devAutoMode) {
    game.applyDevAutoSelection(nowTs);
  } else if (flags.devKeyboardMode || flags.devRecordMode) {
    const held = Array.from(game.arrowHeld);
    if (held.length) {
      game.selectDirection(held[held.length - 1], nowTs);
      keyboardRegistered = true;
    } else {
      game.selectDirection(DIRECTION.MIDDLE, nowTs);
    }
  } else if (flags.devMouseMode) {
    mouseRegistered = game.updateMouseActivation(mouseFrame, nowTs);
  } else if (flags.devMixedMode) {
    const held = Array.from(game.arrowHeld);
    if (held.length) {
      game.selectDirection(held[held.length - 1], nowTs);
      keyboardRegistered = true;
    } else {
      mouseRegistered = game.updateMouseActivation(mouseFrame, nowTs);
    }
  } else if (game.play_mode === PLAY_MODE.MOUSE) {
    mouseRegistered = game.updateMouseActivation(mouseFrame, nowTs);
  } else if (game.play_mode === PLAY_MODE.KEYBOARD) {
    const held = Array.from(game.arrowHeld);
    if (held.length) game.selectDirection(held[held.length - 1], nowTs);
    else game.selectDirection(DIRECTION.MIDDLE, nowTs);
  } else if (game.play_mode === PLAY_MODE.TOUCH && game.tapActiveDir) {
    game.selectDirection(game.tapActiveDir, nowTs);
  }

  return { keyboardRegistered, mouseRegistered };
}

function drawBackgroundAndSampleFrame(game, ctx, dims, flags, playfield) {
  const { cw, ch, vw, vh } = dims;
  let { dx, dy, dw, dh } = playfield;
  let frameData = null;
  let frameW = cw;
  let frameH = ch;

  const canDrawVideo = game.stream && (vw > 0 || vh > 0);
  const showVideoFeed = canDrawVideo && !flags.hideVideoFeed && flags.wantsVideoFeed;

  if (showVideoFeed) {
    const scale = Math.min(cw / vw, ch / vh);
    dx = (cw - vw * scale) / 2;
    dy = (ch - vh * scale) / 2;
    dw = vw * scale;
    dh = vh * scale;

    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    if (game.powerMode) {
      ctx.filter = "hue-rotate(275deg) saturate(2.35) contrast(1.08)";
    }
    if (vw > 0 && vh > 0) ctx.drawImage(game.video, dx, dy, dw, dh);
    else ctx.drawImage(game.video, 0, 0, cw, ch);
    ctx.filter = "none";
    ctx.restore();

    if (game.analysisCanvas.width !== cw) game.analysisCanvas.width = cw;
    if (game.analysisCanvas.height !== ch) game.analysisCanvas.height = ch;
    const tctx = game.analysisCtx;
    tctx.clearRect(0, 0, cw, ch);
    tctx.save();
    tctx.translate(cw, 0);
    tctx.scale(-1, 1);
    if (vw > 0 && vh > 0) tctx.drawImage(game.video, dx, dy, dw, dh);
    else tctx.drawImage(game.video, 0, 0, cw, ch);
    tctx.restore();
    const frame = tctx.getImageData(0, 0, cw, ch);
    frameData = frame.data;
    frameW = frame.width;
    frameH = frame.height;
  } else {
    ctx.save();
    if (flags.hideVideoFeed) {
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

  return { dx, dy, dw, dh, frameData, frameW, frameH };
}

export function processFrameStep(game) {
  const ctx = game.ctx;
  const cw = game.canvas.width;
  const ch = game.canvas.height;
  const vw = game.video.videoWidth;
  const vh = game.video.videoHeight;
  const nowTs = performance.now();
  const dtMs = Math.min(50, Math.max(0, nowTs - game.lastFrameTs));
  game.lastFrameTs = nowTs;
  ctx.clearRect(0, 0, cw, ch);

  const flags = getModeFlags(game);
  let dx = 0;
  let dy = 0;
  let dw = cw;
  let dh = ch;

  const shouldConstrainPlayfield =
    !flags.wantsVideoFeed &&
    !game.isMobileDevice() &&
    (game.play_mode === PLAY_MODE.MOUSE ||
      game.play_mode === PLAY_MODE.KEYBOARD ||
      flags.devMouseMode ||
      flags.devKeyboardMode);

  if (shouldConstrainPlayfield) {
    const fallbackAspect = 4 / 3;
    const aspect = vw > 0 && vh > 0 ? vw / vh : fallbackAspect;
    const scale = Math.min(cw / aspect, ch);
    dw = scale * aspect;
    dh = scale;
    dx = (cw - dw) / 2;
    dy = (ch - dh) / 2;
  }

  const mouseFrame = { dx, dy, dw, dh };
  const input = applyInputSelection(game, nowTs, mouseFrame, flags);

  const bg = drawBackgroundAndSampleFrame(
    game,
    ctx,
    { cw, ch, vw, vh },
    flags,
    { dx, dy, dw, dh }
  );
  dx = bg.dx;
  dy = bg.dy;
  dw = bg.dw;
  dh = bg.dh;

  const layout = getOverlayLayout(game, { dx, dy, dw, dh });
  const skipBannerAndCountdown =
    flags.devMixedMode ||
    flags.devMouseMode ||
    flags.devKeyboardMode ||
    flags.devVideoMode ||
    flags.devAutoMode ||
    flags.devRecordMode;
  const showDebugInfo =
    game.GAME_MODE === GAME_MODE.TEST || skipBannerAndCountdown;

  const shouldUseVideoSelection =
    !!bg.frameData &&
    !flags.devRecordMode &&
    flags.wantsVideoFeed &&
    !(flags.devMixedMode && (input.keyboardRegistered || input.mouseRegistered));

  if (shouldUseVideoSelection) {
    game.updateSquareMotionBaselines(bg.frameData, bg.frameW, bg.frameH, layout);
    game.updateSquareMotionActivation(
      bg.frameData,
      bg.frameW,
      bg.frameH,
      layout,
      nowTs
    );
  }

  let bannerElapsed = null;
  if (game.gameState === GAME_STATE.LEVEL_BANNER) {
    if (skipBannerAndCountdown) {
      game.gameState = GAME_STATE.PLAYING;
      game.notes = [];
      game.lastSpawnTs = 0;
      game.playingStartTs = nowTs;
      game.startDevRecordLevel(nowTs);
      game.resetSquareMotion(layout);
      game.startLevel(game.currentLevel, layout, nowTs);
    } else {
      const elapsed = nowTs - game.levelBannerStartTs;
      if (elapsed >= game.levelBannerMs) {
        if (!game.levelReady?.has(game.currentLevel)) {
          void game.ensureLevelReady(game.currentLevel);
          bannerElapsed = game.levelBannerMs - 250;
        } else {
          game.gameState = GAME_STATE.COUNTDOWN;
          game.countdownStartTs = nowTs;
          game.notes = [];
          game.lastSpawnTs = 0;
          game.songEvents = [];
          game.songEventIndex = 0;
        }
      } else {
        bannerElapsed = elapsed;
      }
    }
  }

  if (game.gameState === GAME_STATE.COUNTDOWN) {
    const elapsed = nowTs - game.countdownStartTs;
    if (elapsed >= game.countdownMs || skipBannerAndCountdown) {
      game.gameState = GAME_STATE.PLAYING;
      game.notes = [];
      game.lastSpawnTs = 0;
      game.playingStartTs = nowTs;
      game.startDevRecordLevel(nowTs);
      game.resetSquareMotion(layout);
      game.startLevel(game.currentLevel, layout, nowTs);
    }
  }

  if (game.gameState === GAME_STATE.PLAYING) {
    game.captureDevRecordFrame(nowTs);
    game.maybeSpawnSongNotes(nowTs, layout);
    if (flags.devAutoMode) game.applyDevAutoSelection(nowTs);
    if (!flags.devRecordMode) game.updateUpcomingNoteAssist(layout, nowTs);
    game.updateActiveFades(nowTs);
    game.updateNotes(dtMs);
    game.resolveNoteHits(nowTs);
    if (!flags.devRecordMode) drawNotes(game, ctx, layout);
    drawCaptureEffects(game, ctx, layout, nowTs);
    drawScore(game, ctx, layout);
    drawMissDots(game, ctx, layout);
    drawScorePopups(game, ctx, layout, nowTs);

    if (game.songEvents.length && game.songEventIndex >= game.songEvents.length) {
      const hasActive = game.notes.some((n) => !n.resolved);
      if (hasActive) game.songResolveSettledStartTs = 0;
      else if (!game.songResolveSettledStartTs) game.songResolveSettledStartTs = nowTs;
      else if (nowTs - game.songResolveSettledStartTs >= game.songCompleteReadyDelayMs) {
        game.levelFailed = game.missCount >= game.maxMissDots;
        game.levelPerfect = !game.levelFailed && game.missCount === 0;
        game.gameState = GAME_STATE.LEVEL_COMPLETE;
        game.levelCompleteStartTs = nowTs;
        game.songResolveSettledStartTs = 0;
        game.finishDevRecordLevel(nowTs);
      }
    }
  }

  if (game.gameState === GAME_STATE.LEVEL_COMPLETE) {
    drawCaptureEffects(game, ctx, layout, nowTs);
    drawScore(game, ctx, layout);
    drawMissDots(game, ctx, layout);
    drawScorePopups(game, ctx, layout, nowTs);
    drawLevelComplete(game, ctx, layout, nowTs - game.levelCompleteStartTs);
    if (nowTs - game.levelCompleteStartTs >= game.levelCompletePauseMs) {
      game.advanceLevel(nowTs, layout);
    }
  }

  if (game.gameState === GAME_STATE.GAME_OVER) {
    drawFinalScore(game, ctx, layout);
  }

  if (game.gameState === GAME_STATE.PLAYING) {
    drawOverlay(game, ctx, { dx, dy, dw, dh });
  }

  if (!skipBannerAndCountdown && game.gameState === GAME_STATE.COUNTDOWN) {
    drawOverlay(game, ctx, { dx, dy, dw, dh });
    drawCountdown(game, ctx, layout, nowTs - game.countdownStartTs);
  }

  if (!skipBannerAndCountdown && bannerElapsed != null) {
    drawLevelBanner(game, ctx, layout, bannerElapsed);
  }

  if (showDebugInfo) {
    drawDebugInfo(game, ctx, layout, nowTs);
  }

  if (game.gameState === GAME_STATE.TITLE) {
    game.resetLevelButton.style.display = "none";
    game.animationFrame = null;
    return;
  }

  game.resetLevelButton.style.display =
    game.canvas.style.display === "none" ? "none" : "flex";

  game.animationFrame = requestAnimationFrame(() => game.processFrame());
}
