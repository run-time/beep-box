export function getOverlayLayout(game, { dx, dy, dw, dh }) {
  const minDim = Math.min(dw, dh);
  const boxSize = minDim * 0.13;
  const strokeWidth = 6;
  const pad = Math.max(strokeWidth / 2, boxSize * 0.35);
  const positions = {
    UP: [dx + dw / 2 - boxSize / 2, dy + pad],
    RIGHT: [dx + dw - pad - boxSize, dy + dh / 2 - boxSize / 2],
    DOWN: [dx + dw / 2 - boxSize / 2, dy + dh - pad - boxSize],
    LEFT: [dx + pad, dy + dh / 2 - boxSize / 2],
    MIDDLE: [dx + dw / 2 - boxSize / 2, dy + dh / 2 - boxSize / 2]
  };

  const centers = {};
  for (const dir of game.directions) {
    const [x, y] = positions[dir];
    centers[dir] = { x: x + boxSize / 2, y: y + boxSize / 2 };
  }

  const corners = {
    TOP_LEFT: { x: dx + pad, y: dy + pad },
    TOP_RIGHT: { x: dx + dw - pad, y: dy + pad },
    BOTTOM_LEFT: { x: dx + pad, y: dy + dh - pad },
    BOTTOM_RIGHT: { x: dx + dw - pad, y: dy + dh - pad }
  };

  const cornerTargets = {
    TOP_LEFT: ["UP", "LEFT", "MIDDLE"],
    TOP_RIGHT: ["UP", "RIGHT", "MIDDLE"],
    BOTTOM_LEFT: ["DOWN", "LEFT", "MIDDLE"],
    BOTTOM_RIGHT: ["DOWN", "RIGHT", "MIDDLE"]
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
  const c = layout.centers.MIDDLE;
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
  const label = remaining > 0 ? String(remaining) : "GO";
  const c = layout.centers.MIDDLE;

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
  const c = layout.centers.MIDDLE;
  const y = (c.y + layout.centers.DOWN.y) / 2;
  const nowTs = performance.now();
  const pulseT = game.scorePulseStartTs
    ? Math.min(1, (nowTs - game.scorePulseStartTs) / game.scorePulseMs)
    : 1;
  const pulse =
    pulseT >= 1
      ? 1
      : 1 + 0.35 * Math.sin(Math.PI * (1 - pulseT)) * (1 - pulseT);
  const betweenLevelsScale = game.gameState === "level_complete" ? 1.8 : 1.0;
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
    const forceAccent = "#9D4EDD";
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
  if (game.gameState !== "playing" && game.gameState !== "countdown") return;
  const c = layout.centers.MIDDLE;
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
  const c = layout.centers.MIDDLE;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = game.levelFailed
    ? game.isSingleLevelMode
      ? "TRY AGAIN"
      : "FAILED"
    : game.levelPerfect
      ? "PERFECT"
      : "COMPLETE";
  if (label === "PERFECT") {
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
  const c = layout.centers.MIDDLE;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(layout.dx, layout.dy, layout.dw, layout.dh);
  ctx.font = `900 ${Math.floor(layout.boxSize * 0.6)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.lineWidth = Math.max(6, layout.boxSize * 0.1);
  ctx.strokeText("FINAL SCORE", c.x, c.y - layout.boxSize * 0.9);
  ctx.fillText("FINAL SCORE", c.x, c.y - layout.boxSize * 0.9);
  ctx.font = `900 ${Math.floor(layout.boxSize * 1.0)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  const scoreLabel = game.formatScore(game.score);
  ctx.strokeText(scoreLabel, c.x, c.y + layout.boxSize * 0.2);
  ctx.fillText(scoreLabel, c.x, c.y + layout.boxSize * 0.2);
  ctx.font = `700 ${Math.floor(layout.boxSize * 0.35)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = Math.max(4, layout.boxSize * 0.07);
  ctx.strokeText("Click to return", c.x, c.y + layout.boxSize * 1.1);
  ctx.fillText("Click to return", c.x, c.y + layout.boxSize * 1.1);

  const modeKey = game.getScoreModeKey?.() || "mouse";
  const modeLabel =
    modeKey === "force"
      ? "FORCE"
      : modeKey === "keyboard"
        ? "KEYBOARD"
        : modeKey === "tap"
          ? "TAP"
          : "MOUSE";
  const highs = game.getTopScoresForMode?.(modeKey) || [];
  ctx.font = `800 ${Math.floor(layout.boxSize * 0.24)}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = Math.max(3, layout.boxSize * 0.045);
  ctx.strokeText(`${modeLabel} TOP 10`, c.x, c.y + layout.boxSize * 1.55);
  ctx.fillText(`${modeLabel} TOP 10`, c.x, c.y + layout.boxSize * 1.55);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${Math.floor(layout.boxSize * 0.16)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
  const listX = c.x - layout.boxSize * 0.95;
  const listY = c.y + layout.boxSize * 1.75;
  const lineH = Math.floor(layout.boxSize * 0.18);
  if (!highs.length) {
    ctx.fillText("No scores yet", listX, listY);
  } else {
    for (let i = 0; i < highs.length && i < 10; i++) {
      const row = highs[i];
      const rank = String(i + 1).padStart(2, "0");
      const name = (row.initials || "AAA").padEnd(3, " ");
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
    const center = layout.centers[p.dir] || layout.centers.MIDDLE;
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
    ctx.fillStyle = hexToRgba(p.color || "#ffffff", 0.95 * alpha);
    ctx.fillText(`+${p.amount}`, x, y);
    ctx.restore();
  }
}

export function drawEdgeGlow(game, ctx, layout) {
  if (!Array.isArray(game.edgeGlowBursts) || !game.edgeGlowBursts.length)
    return;
  const { dx, dy, dw, dh } = layout;
  const targetSpan = Math.max(1, layout.boxSize || Math.min(dw, dh) * 0.2);
  const regularModeScale = Number.isFinite(game.regularEdgeModeScale)
    ? Math.max(0, game.regularEdgeModeScale)
    : 0.5;
  const modeHeightScale = game.powerMode ? 1 : regularModeScale;
  const rawMaxScale = Number.isFinite(game.edgeGlowHeightMaxScale)
    ? Math.max(0.01, game.edgeGlowHeightMaxScale)
    : 1.0;
  const rawMinScale = Number.isFinite(game.edgeGlowHeightMinScale)
    ? Math.max(0, game.edgeGlowHeightMinScale)
    : 0.2;
  const heightMaxScale = Math.max(rawMinScale, rawMaxScale);
  const heightMinScale = Math.min(rawMinScale, rawMaxScale);
  const heightMaxPx = targetSpan * heightMaxScale * modeHeightScale;
  const heightMinPx = targetSpan * heightMinScale * modeHeightScale;
  const edgePurple = "#7B2CBF";
  const nowTs = performance.now();

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";

  const phaseByDir = { UP: 0.2, RIGHT: 1.4, DOWN: 2.7, LEFT: 3.9 };
  const steps = Number.isFinite(game.edgeGlowPolySteps)
    ? Math.max(12, Math.floor(game.edgeGlowPolySteps))
    : 42;
  const blurScale = Number.isFinite(game.edgeGlowBlurScale)
    ? Math.max(0, game.edgeGlowBlurScale)
    : 0.35;
  const blurPx = Math.max(0, targetSpan * blurScale);
  const strokePx = Number.isFinite(game.edgeGlowStrokePx)
    ? Math.max(0, game.edgeGlowStrokePx)
    : 2;
  const driftRatio = Number.isFinite(game.edgeGlowDriftRatio)
    ? Math.max(0, Math.min(1, game.edgeGlowDriftRatio))
    : 0.28;
  const cornerFadeScale = Number.isFinite(game.edgeGlowCornerFadeScale)
    ? Math.max(0.01, game.edgeGlowCornerFadeScale)
    : 0.18;
  const cornerFadePower = Number.isFinite(game.edgeGlowCornerFadePower)
    ? Math.max(0.2, game.edgeGlowCornerFadePower)
    : 1.35;
  const fadeMs = Number.isFinite(game.edgeGlowBurstFadeMs)
    ? Math.max(60, game.edgeGlowBurstFadeMs)
    : 520;

  const pseudoNoise = (x) => {
    const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  const drawWaveBand = (burst, rect, axis) => {
    const dir = burst.dir;
    const ageMs = nowTs - (burst.startTs || nowTs);
    if (ageMs < 0 || ageMs >= fadeMs) return;
    const life = Math.max(0, Math.min(1, ageMs / fadeMs));
    const fade = Math.pow(1 - life, 1.45);
    const strength = Number.isFinite(burst.strength)
      ? Math.max(0, Math.min(1, burst.strength))
      : 0.7;
    const alpha = (0.25 + 0.7 * strength) * fade;
    if (alpha <= 0.001) return;
    const p = (phaseByDir[dir] || 0) + (burst.seed || 0) * 10;
    const intensityNorm = 1 - life;
    const crossSize = axis === "vertical" ? rect.h : rect.w;
    const runSize = axis === "vertical" ? rect.w : rect.h;
    const minDepth = Math.max(0, Math.min(crossSize, heightMinPx));
    const maxDepth = Math.max(minDepth, Math.min(crossSize, heightMaxPx));
    const baseScale = Number.isFinite(burst.sizeScale)
      ? Math.max(0.1, burst.sizeScale)
      : 0.5;
    const scaledMaxDepth = Math.max(
      minDepth,
      Math.min(maxDepth, maxDepth * baseScale)
    );
    const driftInward = life * crossSize * driftRatio;
    const amp = (maxDepth - minDepth) * (0.45 + 0.35 * intensityNorm);

    const g =
      axis === "vertical"
        ? ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h)
        : ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y);
    const color = burst.color || edgePurple;
    g.addColorStop(0, hexToRgba(color, alpha * 0.95));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.shadowBlur = blurPx;
    ctx.shadowColor = hexToRgba(color, alpha * 0.9);
    ctx.fillStyle = g;

    if (axis === "vertical") {
      const yEdge = dir === "DOWN" ? rect.y + rect.h : rect.y;
      const innerPoints = [];
      ctx.beginPath();
      ctx.moveTo(rect.x, yEdge);
      ctx.lineTo(rect.x + rect.w, yEdge);
      for (let i = steps; i >= 0; i--) {
        const progress = i / Math.max(1, steps);
        const x = rect.x + progress * rect.w;
        const n1 = Math.sin(progress * Math.PI * 7.4 + p);
        const n2 = Math.sin(progress * Math.PI * 12.8 + p * 1.6);
        const n3 = (pseudoNoise(progress * 73 + p * 3.7) * 2 - 1) * 0.55;
        const composite = n1 * 0.42 + n2 * 0.33 + n3 * 0.25;
        const edgeDistPx = Math.min(progress, 1 - progress) * runSize;
        const cornerFadePx = Math.max(1, runSize * cornerFadeScale);
        const cornerEnvelope = Math.pow(
          Math.min(1, edgeDistPx / cornerFadePx),
          cornerFadePower
        );
        const depth = minDepth + (0.5 + 0.5 * composite) * amp * cornerEnvelope;
        const inward = Math.max(
          0,
          Math.min(scaledMaxDepth, depth + driftInward)
        );
        const y = dir === "DOWN" ? yEdge - inward : yEdge + inward;
        innerPoints.push({ x, y });
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      if (strokePx > 0 && innerPoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(innerPoints[0].x, innerPoints[0].y);
        for (let i = 1; i < innerPoints.length; i++) {
          ctx.lineTo(innerPoints[i].x, innerPoints[i].y);
        }
        ctx.lineWidth = strokePx;
        ctx.strokeStyle = hexToRgba(color, Math.min(1, alpha * 0.9));
        ctx.stroke();
      }
      return;
    }

    const xEdge = dir === "RIGHT" ? rect.x + rect.w : rect.x;
    const innerPoints = [];
    ctx.beginPath();
    ctx.moveTo(xEdge, rect.y);
    ctx.lineTo(xEdge, rect.y + rect.h);
    for (let i = steps; i >= 0; i--) {
      const progress = i / Math.max(1, steps);
      const y = rect.y + progress * rect.h;
      const n1 = Math.sin(progress * Math.PI * 7.4 + p);
      const n2 = Math.sin(progress * Math.PI * 12.8 + p * 1.6);
      const n3 = (pseudoNoise(progress * 73 + p * 3.7) * 2 - 1) * 0.55;
      const composite = n1 * 0.42 + n2 * 0.33 + n3 * 0.25;
      const edgeDistPx = Math.min(progress, 1 - progress) * runSize;
      const cornerFadePx = Math.max(1, runSize * cornerFadeScale);
      const cornerEnvelope = Math.pow(
        Math.min(1, edgeDistPx / cornerFadePx),
        cornerFadePower
      );
      const depth = minDepth + (0.5 + 0.5 * composite) * amp * cornerEnvelope;
      const inward = Math.max(0, Math.min(scaledMaxDepth, depth + driftInward));
      const x = dir === "RIGHT" ? xEdge - inward : xEdge + inward;
      innerPoints.push({ x, y });
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    if (strokePx > 0 && innerPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(innerPoints[0].x, innerPoints[0].y);
      for (let i = 1; i < innerPoints.length; i++) {
        ctx.lineTo(innerPoints[i].x, innerPoints[i].y);
      }
      ctx.lineWidth = strokePx;
      ctx.strokeStyle = hexToRgba(color, Math.min(1, alpha * 0.9));
      ctx.stroke();
    }
  };

  for (const burst of game.edgeGlowBursts) {
    const dir = burst.dir;
    if (dir === "UP") {
      drawWaveBand(burst, { x: dx, y: dy, w: dw, h: heightMaxPx }, "vertical");
    } else if (dir === "DOWN") {
      drawWaveBand(
        burst,
        { x: dx, y: dy + dh - heightMaxPx, w: dw, h: heightMaxPx },
        "vertical"
      );
    } else if (dir === "LEFT") {
      drawWaveBand(
        burst,
        { x: dx, y: dy, w: heightMaxPx, h: dh },
        "horizontal"
      );
    } else if (dir === "RIGHT") {
      drawWaveBand(
        burst,
        { x: dx + dw - heightMaxPx, y: dy, w: heightMaxPx, h: dh },
        "horizontal"
      );
    }
  }

  ctx.restore();
}

export function drawNotes(game, ctx, layout) {
  const nowTs = performance.now();
  const box = layout.boxSize;
  const range = game.activeMidiRange || { minMidi: 21, maxMidi: 108 };
  const minMidi = Number(range.minMidi);
  const maxMidi = Number(range.maxMidi);
  const upcoming = game.notes
    .filter((n) => !n.resolved && nowTs >= n.startTs)
    .slice()
    .sort((a, b) => a.hitTs - b.hitTs);
  const nextHitTs = upcoming.length ? upcoming[0].hitTs : null;
  const stepOpacity = Number.isFinite(game.noteUpcomingOpacityStep)
    ? Math.max(0, game.noteUpcomingOpacityStep)
    : 0.05;
  const rawMinUpcomingOpacity = Number.isFinite(game.noteMinUpcomingOpacity)
    ? Math.max(0, Math.min(1, game.noteMinUpcomingOpacity))
    : 0.2;
  const rawMaxUpcomingOpacity = Number.isFinite(game.noteMaxUpcomingOpacity)
    ? Math.max(0, Math.min(1, game.noteMaxUpcomingOpacity))
    : 1;
  const minUpcomingOpacity = Math.min(
    rawMinUpcomingOpacity,
    rawMaxUpcomingOpacity
  );
  const maxUpcomingOpacity = Math.max(
    rawMinUpcomingOpacity,
    rawMaxUpcomingOpacity
  );
  const hitTimeRanks = new Map();
  let lastHitTs = -Infinity;
  let rank = -1;
  for (const n of upcoming) {
    if (Math.abs(n.hitTs - lastHitTs) > 1) {
      rank += 1;
      lastHitTs = n.hitTs;
    }
    hitTimeRanks.set(n, rank);
  }

  for (const note of game.notes) {
    if (nowTs < note.startTs) continue;
    const denom = Math.max(1, note.hitTs - note.startTs);
    const t = Math.min(1, Math.max(0, (nowTs - note.startTs) / denom));
    const x = note.from.x + (note.to.x - note.from.x) * t;
    const y = note.from.y + (note.to.y - note.from.y) * t;
    const denomMidi = Math.max(1, maxMidi - minMidi);
    const midiNorm = Math.max(
      0,
      Math.min(1, (note.midi - minMidi) / denomMidi)
    );
    const diameterPct = 0.6 - midiNorm * 0.5;
    const r = (box * diameterPct) / 2;
    const isNext = nextHitTs != null && Math.abs(note.hitTs - nextHitTs) < 2;
    const upcomingRank = hitTimeRanks.get(note);
    const captureAnimDurationMs =
      game.captureEffectDurationMs * game.captureNoteScaleDurationFactor;
    let captureT = 0;
    if (note.hit && Number.isFinite(note.captureAnimStartTs)) {
      captureT = Math.min(
        1,
        Math.max(0, (nowTs - note.captureAnimStartTs) / captureAnimDurationMs)
      );
    }
    if (captureT >= 1) continue;
    const captureScale =
      note.hit && captureT > 0
        ? 1 + (game.captureNoteMaxScale - 1) * captureT
        : 1;
    const animatedR = r * captureScale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, animatedR, 0, Math.PI * 2);
    ctx.closePath();
    const forceNoteByDir = {
      UP: "#3C096C",
      RIGHT: "#5A189A",
      DOWN: "#7B2CBF",
      LEFT: "#9D4EDD",
      MIDDLE: "#7B2CBF"
    };
    const base = game.powerMode
      ? forceNoteByDir[note.targetDir] || "#7B2CBF"
      : game.colors[note.targetDir];
    const hitFadeAlpha = note.hit ? 1 - captureT : 1;
    let noteAlpha = minUpcomingOpacity;
    if (Number.isFinite(upcomingRank) && upcomingRank >= 0) {
      noteAlpha = Math.max(
        minUpcomingOpacity,
        maxUpcomingOpacity - upcomingRank * stepOpacity
      );
    }
    if (isNext) noteAlpha = maxUpcomingOpacity;
    const borderAlpha = Math.min(1, noteAlpha + stepOpacity * 2);
    ctx.fillStyle = note.hit
      ? `rgba(255,255,255,${0.3 * hitFadeAlpha})`
      : hexToRgba(base, noteAlpha);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, animatedR + 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.lineWidth = game.noteStrokeWidth;
    ctx.strokeStyle = note.hit
      ? hexToRgba(base, borderAlpha * hitFadeAlpha)
      : hexToRgba(base, borderAlpha);
    ctx.stroke();
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
    UP: [dx + dw / 2 - b / 2, dy + pad],
    RIGHT: [dx + dw - pad - b, dy + dh / 2 - b / 2],
    DOWN: [dx + dw / 2 - b / 2, dy + dh - pad - b],
    LEFT: [dx + pad, dy + dh / 2 - b / 2],
    MIDDLE: [dx + dw / 2 - b / 2, dy + dh / 2 - b / 2]
  };
  const forceOverlayByDir = {
    UP: "#9D4EDD",
    RIGHT: "#9D4EDD",
    DOWN: "#9D4EDD",
    LEFT: "#9D4EDD",
    MIDDLE: "#9D4EDD"
  };
  for (const dir of game.directions) {
    ctx.save();
    ctx.beginPath();
    if (dir === "MIDDLE") {
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
      ? forceOverlayByDir[dir] || "#7B2CBF"
      : game.colors[dir];
    const intensity = getDirectionIntensity(game, dir);
    if (game.powerMode) {
      const a = 0.15 + 0.4 * intensity;
      ctx.fillStyle = hexToRgba(stroke, a);
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
    `force: ${game.powerMode ? "on" : "off"}`,
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
