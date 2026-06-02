import { CORNER, DIRECTION, GAME_STATE, SCORE_MODE } from "./constants.js";
import { UI_STRINGS } from "./ui-strings.js";

export function getOverlayLayout(game, { dx, dy, dw, dh }) {
  const minDim = Math.min(dw, dh);
  const boxSize = minDim * 0.13;
  const strokeWidth = 6;
  const pad = Math.max(strokeWidth / 2, boxSize * 0.35);
  const positions = {
    [DIRECTION.UP]: [dx + dw / 2 - boxSize / 2, dy + pad],
    [DIRECTION.RIGHT]: [dx + dw - pad - boxSize, dy + dh / 2 - boxSize / 2],
    [DIRECTION.DOWN]: [dx + dw / 2 - boxSize / 2, dy + dh - pad - boxSize],
    [DIRECTION.LEFT]: [dx + pad, dy + dh / 2 - boxSize / 2],
    [DIRECTION.MIDDLE]: [dx + dw / 2 - boxSize / 2, dy + dh / 2 - boxSize / 2]
  };

  const centers = {};
  for (const dir of game.directions) {
    const [x, y] = positions[dir];
    centers[dir] = { x: x + boxSize / 2, y: y + boxSize / 2 };
  }

  const corners = {
    [CORNER.TOP_LEFT]: { x: dx + pad, y: dy + pad },
    [CORNER.TOP_RIGHT]: { x: dx + dw - pad, y: dy + pad },
    [CORNER.BOTTOM_LEFT]: { x: dx + pad, y: dy + dh - pad },
    [CORNER.BOTTOM_RIGHT]: { x: dx + dw - pad, y: dy + dh - pad }
  };

  const cornerTargets = {
    [CORNER.TOP_LEFT]: [DIRECTION.UP, DIRECTION.LEFT, DIRECTION.MIDDLE],
    [CORNER.TOP_RIGHT]: [DIRECTION.UP, DIRECTION.RIGHT, DIRECTION.MIDDLE],
    [CORNER.BOTTOM_LEFT]: [DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.MIDDLE],
    [CORNER.BOTTOM_RIGHT]: [DIRECTION.DOWN, DIRECTION.RIGHT, DIRECTION.MIDDLE]
  };

  return {
    dx,
    dy,
    dw,
    dh,
    boxSize,
    strokeWidth,
    pad,
    positions,
    centers,
    corners,
    cornerTargets
  };
}

export function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export function getDirectionIntensity(game, dir) {
  if (dir === game.primaryDirection) return 1;
  const s = game.activeDirStates.get(dir);
  return s ? s.intensity : 0;
}

export function drawLevelBanner(game, ctx, layout, elapsedMs) {
  const t = Math.min(1, Math.max(0, elapsedMs / game.levelBannerMs));
  const alpha = 1 - t;
  const c = layout.centers[DIRECTION.MIDDLE];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.floor(layout.boxSize * 1.15)}px sans-serif`;
  ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
  ctx.strokeStyle = `rgba(0,0,0,${0.85 * alpha})`;
  ctx.lineWidth = Math.max(6, layout.boxSize * 0.08);
  ctx.strokeText(`LEVEL ${game.currentLevel}`, c.x, c.y);
  ctx.fillText(`LEVEL ${game.currentLevel}`, c.x, c.y);
  ctx.restore();
}

export function drawCountdown(game, ctx, layout, elapsedMs) {
  const steps = 3;
  const stepMs = game.countdownMs / steps;
  const remaining = Math.max(0, steps - Math.floor(elapsedMs / stepMs));
  const label = remaining > 0 ? String(remaining) : UI_STRINGS.countdown.go;
  const c = layout.centers[DIRECTION.MIDDLE];

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.floor(layout.boxSize * 1.4)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = Math.max(6, layout.boxSize * 0.1);
  ctx.strokeText(label, c.x, c.y);
  ctx.fillText(label, c.x, c.y);
  ctx.restore();
}

export function drawScore(game, ctx, layout) {
  const c = layout.centers[DIRECTION.MIDDLE];
  const y = (c.y + layout.centers[DIRECTION.DOWN].y) / 2;
  const nowTs = performance.now();
  const pulseT = game.scorePulseStartTs
    ? Math.min(1, (nowTs - game.scorePulseStartTs) / game.scorePulseMs)
    : 1;
  const pulse =
    pulseT >= 1
      ? 1
      : 1 + 0.35 * Math.sin(Math.PI * (1 - pulseT)) * (1 - pulseT);
  const betweenLevelsScale =
    game.gameState === GAME_STATE.LEVEL_COMPLETE ? 1.8 : 1.0;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${Math.floor(layout.boxSize * 0.35 * pulse * betweenLevelsScale)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = Math.max(2, layout.boxSize * 0.04);
  const scoreLabel = game.formatScore(game.score);
  ctx.strokeText(scoreLabel, c.x, y);
  ctx.fillText(scoreLabel, c.x, y);
  if (game.powerMode) {
    const forceAccent =
      game.powerColors?.[DIRECTION.MIDDLE] || game.colors?.[DIRECTION.MIDDLE];
    const labelFadeMs = Number.isFinite(game.powerModeLabelFadeMs)
      ? Math.max(0, game.powerModeLabelFadeMs)
      : 5000;
    const labelStartTs = Number.isFinite(game.powerModeLabelStartTs)
      ? game.powerModeLabelStartTs
      : 0;
    const labelElapsed = labelStartTs > 0 ? nowTs - labelStartTs : 0;
    const strokeAlpha =
      labelFadeMs <= 0
        ? 0
        : Math.max(0, 1 - Math.min(1, labelElapsed / labelFadeMs));
    if (strokeAlpha > 0.001) {
      const fillAlphaCss = (0.95 * strokeAlpha).toFixed(3);
      ctx.font = `900 ${Math.floor(layout.boxSize * 0.45)}px sans-serif`;
      ctx.fillStyle = hexToRgba(forceAccent, fillAlphaCss);
      ctx.strokeText(game.powerModeLabel, c.x, c.y - layout.boxSize * 1.35);
      ctx.fillText(game.powerModeLabel, c.x, c.y - layout.boxSize * 1.35);
    }
  }
  ctx.restore();
}

export function drawMissDots(game, ctx, layout) {
  if (
    game.gameState !== GAME_STATE.PLAYING &&
    game.gameState !== GAME_STATE.COUNTDOWN
  )
    return;
  const c = layout.centers[DIRECTION.MIDDLE];
  const y = c.y;
  const gap = layout.boxSize * 0.22;
  const r = Math.max(3, Math.floor(layout.boxSize * 0.06));
  const totalW = gap * (game.maxMissDots - 1);
  const x0 = c.x - totalW / 2;

  ctx.save();
  for (let i = 0; i < game.maxMissDots; i++) {
    const filled = i < game.missCount;
    ctx.beginPath();
    ctx.arc(x0 + i * gap, y, r, 0, Math.PI * 2);
    ctx.fillStyle = filled ? "rgba(204,51,51,0.95)" : "rgba(255,255,255,0.2)";
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.floor(layout.boxSize * 0.015));
    ctx.strokeStyle = filled ? "rgba(80,0,0,0.9)" : "rgba(255,255,255,0.45)";
    ctx.stroke();
  }
  ctx.restore();
}

export function drawLevelComplete(game, ctx, layout, elapsedMs) {
  const t = Math.min(1, Math.max(0, elapsedMs / 700));
  const alpha = 1 - t * 0.25;
  const c = layout.centers[DIRECTION.MIDDLE];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = game.levelFailed
    ? game.isSingleLevelMode
      ? UI_STRINGS.levelComplete.tryAgain
      : UI_STRINGS.levelComplete.failed
    : game.levelPerfect
      ? UI_STRINGS.levelComplete.perfect
      : UI_STRINGS.levelComplete.complete;
  if (label === UI_STRINGS.levelComplete.perfect) {
    ctx.font = `900 ${Math.floor(layout.boxSize * 1.1)}px sans-serif`;
    ctx.fillStyle = `rgba(0,0,0,${0.95 * alpha})`;
    ctx.strokeStyle = `rgba(212,175,55,${0.95 * alpha})`;
    ctx.lineWidth = Math.max(7, layout.boxSize * 0.1);
  } else {
    ctx.font = `900 ${Math.floor(layout.boxSize * 0.55)}px sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${0.9 * alpha})`;
    ctx.strokeStyle = `rgba(0,0,0,${0.85 * alpha})`;
    ctx.lineWidth = Math.max(5, layout.boxSize * 0.08);
  }
  ctx.strokeText(label, c.x, c.y);
  ctx.fillText(label, c.x, c.y);
  ctx.restore();
}

export function drawFinalScore(game, ctx, layout) {
  const c = layout.centers[DIRECTION.MIDDLE];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(layout.dx, layout.dy, layout.dw, layout.dh);
  ctx.font = `900 ${Math.floor(layout.boxSize * 0.6)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = Math.max(6, layout.boxSize * 0.1);
  ctx.strokeText(
    UI_STRINGS.finalScore.heading,
    c.x,
    c.y - layout.boxSize * 0.9
  );
  ctx.fillText(UI_STRINGS.finalScore.heading, c.x, c.y - layout.boxSize * 0.9);
  ctx.font = `900 ${Math.floor(layout.boxSize * 1.0)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  const scoreLabel = game.formatScore(game.score);
  ctx.strokeText(scoreLabel, c.x, c.y + layout.boxSize * 0.2);
  ctx.fillText(scoreLabel, c.x, c.y + layout.boxSize * 0.2);
  ctx.font = `700 ${Math.floor(layout.boxSize * 0.35)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = Math.max(4, layout.boxSize * 0.07);
  ctx.strokeText(
    UI_STRINGS.finalScore.clickToReturn,
    c.x,
    c.y + layout.boxSize * 1.1
  );
  ctx.fillText(
    UI_STRINGS.finalScore.clickToReturn,
    c.x,
    c.y + layout.boxSize * 1.1
  );

  const modeKey = game.getScoreModeKey?.() || SCORE_MODE.MOUSE;
  const modeLabel =
    modeKey === SCORE_MODE.CAMERA
      ? UI_STRINGS.title.modeLabels.camera
      : modeKey === SCORE_MODE.KEYBOARD
        ? UI_STRINGS.title.modeLabels.keyboard
        : modeKey === SCORE_MODE.TOUCH
          ? UI_STRINGS.title.modeLabels.touch
          : UI_STRINGS.title.modeLabels.mouse;
  const highs = game.getTopScoresForMode?.(modeKey) || [];
  ctx.font = `800 ${Math.floor(layout.boxSize * 0.24)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = Math.max(3, layout.boxSize * 0.045);
  ctx.strokeText(
    `${modeLabel} ${UI_STRINGS.finalScore.top10Suffix}`,
    c.x,
    c.y + layout.boxSize * 1.55
  );
  ctx.fillText(
    `${modeLabel} ${UI_STRINGS.finalScore.top10Suffix}`,
    c.x,
    c.y + layout.boxSize * 1.55
  );

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${Math.floor(layout.boxSize * 0.16)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  const listX = c.x - layout.boxSize * 0.95;
  const listY = c.y + layout.boxSize * 1.75;
  const lineH = Math.floor(layout.boxSize * 0.18);
  if (!highs.length) {
    ctx.fillText(UI_STRINGS.finalScore.noScores, listX, listY);
  } else {
    for (let i = 0; i < highs.length && i < 10; i++) {
      const row = highs[i];
      const rank = String(i + 1).padStart(2, "0");
      const name = (row.initials || game.defaultInitials).padEnd(3, " ");
      const sc = game.formatScore(row.score || 0).padStart(6, " ");
      ctx.fillText(`${rank}. ${name}  ${sc}`, listX, listY + i * lineH);
    }
  }
  ctx.restore();
}

export function drawScorePopups(game, ctx, layout, nowTs) {
  if (!game.scorePopups.length) return;
  game.scorePopups = game.scorePopups.filter(
    (p) => nowTs - p.startTs < p.ttlMs
  );
  for (const p of game.scorePopups) {
    const mobileScale = game.isMobile ? 2.8 : 1.0;
    const t = Math.min(1, (nowTs - p.startTs) / p.ttlMs);
    const easeOut = 1 - Math.pow(1 - t, 3);
    const alpha = 2 - t;
    const center = layout.centers[p.dir] || layout.centers[DIRECTION.MIDDLE];
    const horizontalDrift =
      game.scorePopupHorizontalDriftScale *
      layout.boxSize *
      (p.horizontalDriftDir || 0) *
      easeOut;
    const x = center.x + horizontalDrift;
    const verticalOffset = p.verticalHalf === "BOTTOM" ? 0.22 : -0.22;
    const driftDir = p.verticalHalf === "BOTTOM" ? 1 : -1;
    const drift =
      layout.boxSize * game.scorePopupVerticalDriftScale * easeOut * driftDir;
    const y = center.y + layout.boxSize * verticalOffset + drift;
    const scale = 1 + game.scorePopupGrowthScale * easeOut * mobileScale;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.floor(layout.boxSize * 0.2 * scale)}px sans-serif`;
    ctx.fillStyle = hexToRgba(
      p.color || game.visualDefaults?.popupColor || game.colors?.[DIRECTION.MIDDLE],
      0.95 * alpha
    );
    ctx.fillText(`+${p.amount}`, x, y);
    ctx.restore();
  }
}

export function drawCaptureEffects(game, ctx, layout, nowTs) {
  if (!game.captureEffects.length) return;
  const durationMs = game.captureEffectDurationMs;
  game.captureEffects = game.captureEffects.filter(
    (fx) => nowTs - fx.startTs <= durationMs
  );
  if (!game.captureEffects.length) return;

  const baseRadius = layout.boxSize * game.captureEffectStartRadiusScale;
  const maxRadius = layout.boxSize * game.captureEffectEndRadiusScale;
  const lineWidth = game.captureEffectStrokeWidth;

  for (const fx of game.captureEffects) {
    const t = Math.min(1, Math.max(0, (nowTs - fx.startTs) / durationMs));
    // Ease-out cubic: grows quickly, then slows at larger radii.
    const eased = 1 - Math.pow(1 - t, 3);
    const radius = baseRadius + (maxRadius - baseRadius) * eased;
    const alpha = (1 - t) * game.captureEffectAlphaScale;
    const wave =
      Array.isArray(fx.waveProfile) && fx.waveProfile.length
        ? fx.waveProfile
        : [1];
    const n = wave.length;

    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (fx.waveTwist || 0) + t * 0.7;
      const wobble = wave[i];
      const rr = radius * wobble;
      const px = fx.x + Math.cos(a) * rr;
      const py = fx.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.lineWidth = lineWidth * (1.35 - t * 0.25);
    ctx.strokeStyle = hexToRgba(fx.color, alpha);
    ctx.shadowColor = hexToRgba(fx.color, alpha * 0.9);
    ctx.shadowBlur = 10 * layout.boxSize * game.captureEffectBlurScale * alpha;
    ctx.stroke();
    ctx.restore();
  }
}

export function drawOverlay(game, ctx, { dx, dy, dw, dh }) {
  const minDim = Math.min(dw, dh);
  const b = minDim * 0.13;
  const strokeWidth = game.targetBoxStrokeWidth || 8;
  const pad = Math.max(strokeWidth / 2, b * 0.35);
  const positions = {
    [DIRECTION.UP]: [dx + dw / 2 - b / 2, dy + pad],
    [DIRECTION.RIGHT]: [dx + dw - pad - b, dy + dh / 2 - b / 2],
    [DIRECTION.DOWN]: [dx + dw / 2 - b / 2, dy + dh - pad - b],
    [DIRECTION.LEFT]: [dx + pad, dy + dh / 2 - b / 2],
    [DIRECTION.MIDDLE]: [dx + dw / 2 - b / 2, dy + dh / 2 - b / 2]
  };
  for (const dir of game.directions) {
    ctx.save();
    ctx.beginPath();
    if (dir === DIRECTION.MIDDLE) {
      const [x, y] = positions[dir];
      const cx = x + b / 2;
      const cy = y + b / 2;
      const d = (b / 2) * Math.SQRT2;
      ctx.moveTo(cx, cy - d);
      ctx.lineTo(cx + d, cy);
      ctx.lineTo(cx, cy + d);
      ctx.lineTo(cx - d, cy);
    } else {
      ctx.rect(...positions[dir], b, b);
    }
    ctx.closePath();
    const stroke = game.powerMode
      ? game.powerColors?.[dir] || game.colors?.[dir]
      : game.colors[dir];
    const intensity = getDirectionIntensity(game, dir);
    if (game.powerMode) {
      const base = game.powerFillColors?.[dir] || game.fillColors[dir];
      const active =
        game.powerActiveFillColors?.[dir] || game.activeFillColors[dir];
      ctx.fillStyle = intensity > 0 ? active : base;
      if (intensity > 0 && intensity < 1) {
        ctx.globalAlpha = intensity;
      }
    } else {
      const base = game.fillColors[dir];
      const active = game.activeFillColors[dir];
      ctx.fillStyle = intensity > 0 ? active : base;
      if (intensity > 0 && intensity < 1) {
        ctx.globalAlpha = intensity;
      }
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export function drawDebugInfo(game, ctx, layout, nowTs) {
  const lines = [
    `mode: ${game.GAME_MODE}`,
    `play: ${game.play_mode}`,
    `state: ${game.gameState}`,
    `level: ${game.currentLevel}/${game.maxLevel}`,
    `score: ${game.score} streak: ${game.streak}`,
    `notes active: ${game.notes.filter((n) => !n.resolved).length}`,
    `events: ${game.songEventIndex}/${game.songEvents.length}`,
    `powerMode: ${game.powerMode ? "on" : "off"}`,
    `dir: ${game.primaryDirection}`,
    `assist win ms: ${game.hitAssistWindowMs}`,
    `t: ${Math.round(nowTs)}`
  ];

  const x = layout.dx + Math.max(10, layout.boxSize * 0.12);
  const y = layout.dy + Math.max(10, layout.boxSize * 0.1);
  const lh = Math.max(12, Math.floor(layout.boxSize * 0.15));
  const pad = Math.max(6, Math.floor(layout.boxSize * 0.08));
  const w = Math.max(260, Math.floor(layout.boxSize * 2.6));
  const h = pad * 2 + lh * lines.length;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - pad, y - pad, w, h);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${Math.max(11, Math.floor(layout.boxSize * 0.12))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lh);
  }
  ctx.restore();
}
