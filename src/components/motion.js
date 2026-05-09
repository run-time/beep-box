export function getSquareMotionLayoutKey(game, layout) {
  const pos = game.directions
    .map((d) => {
      const [x, y] = layout.positions[d];
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join("|");
  return `${Math.round(layout.boxSize)}|${pos}|${game.squareMotionStride}`;
}

export function resetSquareMotion(game, layout) {
  game.squareMotionState.clear();
  game.squareMotionPctSmoothed.clear();
  game.squareMotionPctLast.clear();
  game.squareMotionFrames = 0;
  game.squareMotionActiveDir = null;
  game.squareMotionActiveUntilTs = 0;
  game.squareMotionLayoutKey = layout
    ? getSquareMotionLayoutKey(game, layout)
    : "";
}

export function getImminentTargetDirections(game, nowTs, horizonMs = 800) {
  const out = new Set();
  for (const n of game.notes) {
    if (n.resolved) continue;
    if (n.startTs > nowTs) continue;
    const dt = n.hitTs - nowTs;
    if (dt >= 0 && dt <= horizonMs) out.add(n.targetDir);
  }
  return out;
}

export function updateSquareMotionBaselines(game, data, width, height, layout) {
  if (game.gameState === "title" || game.gameState === "game_over") return;
  const key = getSquareMotionLayoutKey(game, layout);
  if (key !== game.squareMotionLayoutKey) resetSquareMotion(game, layout);
  if (game.squareMotionFrames >= game.squareMotionTargetFrames) return;

  const stride = game.squareMotionStride;
  for (const dir of game.directions) {
    const [x, y] = layout.positions[dir];
    const size = layout.boxSize;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + size));
    const y1 = Math.min(height, Math.ceil(y + size));
    const nx = Math.max(1, Math.ceil((x1 - x0) / stride));
    const ny = Math.max(1, Math.ceil((y1 - y0) / stride));
    const n = nx * ny;

    let state = game.squareMotionState.get(dir);
    if (!state || state.n !== n) {
      state = {
        x0,
        y0,
        x1,
        y1,
        stride,
        nx,
        ny,
        n,
        frames: 0,
        sum: new Float32Array(n),
        baseline: null,
        fgMask: null
      };
    } else {
      state.x0 = x0;
      state.y0 = y0;
      state.x1 = x1;
      state.y1 = y1;
      state.stride = stride;
      state.nx = nx;
      state.ny = ny;
    }

    let idx = 0;
    for (let iy = 0; iy < ny; iy++) {
      const yy = Math.min(y1 - 1, y0 + iy * stride);
      const row = yy * width;
      for (let ix = 0; ix < nx; ix++) {
        const xx = Math.min(x1 - 1, x0 + ix * stride);
        const i = (row + xx) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const l = (54 * r + 183 * g + 19 * b) >> 8;
        state.sum[idx++] += l;
      }
    }

    state.frames++;
    if (state.frames >= game.squareMotionTargetFrames) {
      const baseline = new Float32Array(n);
      for (let i = 0; i < n; i++) baseline[i] = state.sum[i] / state.frames;
      state.baseline = baseline;
      state.fgMask = new Uint8Array(n);
      state.sum = null;
    }

    game.squareMotionState.set(dir, state);
  }

  game.squareMotionFrames++;
}

export function updateSquareMotionActivation(
  game,
  data,
  width,
  height,
  layout,
  nowTs
) {
  if (game.gameState === "title" || game.gameState === "game_over") return;
  if (game.squareMotionFrames < game.squareMotionTargetFrames) return;

  const key = getSquareMotionLayoutKey(game, layout);
  if (key !== game.squareMotionLayoutKey) return;

  const enterThresh = game.squareMotionEnterDiffThreshold;
  const exitThresh = game.squareMotionExitDiffThreshold;
  let bestDir = "MIDDLE";
  let bestScore = 0;

  for (const dir of game.directions) {
    const state = game.squareMotionState.get(dir);
    if (!state || !state.baseline || !state.fgMask) continue;
    const { x0, y0, x1, y1, stride, nx, ny, n, baseline, fgMask } = state;
    let changed = 0;
    let validN = n;
    let idx = 0;
    for (let iy = 0; iy < ny; iy++) {
      const yy = Math.min(y1 - 1, y0 + iy * stride);
      const row = yy * width;
      for (let ix = 0; ix < nx; ix++) {
        if (
          dir === "MIDDLE" &&
          ny > 1 &&
          iy < Math.floor(ny * game.squareMotionMiddleTopIgnore)
        ) {
          idx++;
          validN--;
          continue;
        }
        const xx = Math.min(x1 - 1, x0 + ix * stride);
        const i = (row + xx) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const l = (54 * r + 183 * g + 19 * b) >> 8;
        const d = l - baseline[idx];
        const ad = d < 0 ? -d : d;
        const prevFg = fgMask[idx] === 1;
        const isFg = prevFg ? ad > exitThresh : ad > enterThresh;
        fgMask[idx] = isFg ? 1 : 0;
        if (isFg) changed++;
        const alpha = isFg
          ? game.squareMotionBgLearnAlphaFg
          : game.squareMotionBgLearnAlpha;
        baseline[idx] += (l - baseline[idx]) * alpha;
        idx++;
      }
    }

    const pct = validN > 0 ? changed / validN : 0;
    game.squareMotionPctLast.set(dir, pct);
    const prev = game.squareMotionPctSmoothed.get(dir) || 0;
    const smoothed =
      prev * (1 - game.squareMotionEmaAlpha) + pct * game.squareMotionEmaAlpha;
    game.squareMotionPctSmoothed.set(dir, smoothed);
    const score = smoothed;

    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  if (bestScore >= game.squareMotionMinPct) {
    game.squareMotionActiveDir = bestDir;
    game.squareMotionActiveUntilTs = nowTs + game.squareMotionActiveHoldMs;
    game.selectDirection(bestDir, nowTs);
    return;
  }

  if (
    game.squareMotionActiveDir &&
    nowTs <= game.squareMotionActiveUntilTs &&
    (game.squareMotionPctSmoothed.get(game.squareMotionActiveDir) || 0) >=
      game.squareMotionOffPct
  ) {
    game.selectDirection(game.squareMotionActiveDir, nowTs);
  } else {
    game.squareMotionActiveDir = null;
  }
}

export function updateMouseActivation(game, layout, nowTs) {
  const { x, y } = game.mousePos || { x: 0, y: 0 };
  const { dx, dy, dw, dh } = layout;
  const sectionW = dw / 3;
  const sectionH = dh / 3;
  const col = Math.floor((x - dx) / sectionW);
  const row = Math.floor((y - dy) / sectionH);

  let dir = null;
  if (row === 0 && col === 1) dir = "UP";
  else if (row === 1 && col === 0) dir = "LEFT";
  else if (row === 1 && col === 1) dir = "MIDDLE";
  else if (row === 1 && col === 2) dir = "RIGHT";
  else if (row === 2 && col === 1) dir = "DOWN";
  else dir = null;

  if (dir) {
    game.selectDirection(dir, nowTs);
    return true;
  }
  game.clearPrimaryDirection?.(nowTs);
  return false;
}
