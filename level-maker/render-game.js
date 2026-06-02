export function noteSizePx(midi) {
  // 21 (A0) => 20px, 108 (C8) => 8px
  const t = (midi - 21) / (108 - 21);
  const clamped = Math.max(0, Math.min(1, t));
  return 20 - clamped * 12;
}

export function drawGameFrame(ctx, canvas, gameNotes, nowSeconds, layout = {}) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const dpr = window.devicePixelRatio || 1;
  const targets =
    layout.targets || [
      { x: 0.5, y: 0.12, color: "#c62828" },
      { x: 0.08, y: 0.5, color: "#f9a825" },
      { x: 0.92, y: 0.5, color: "#1e88e5" },
      { x: 0.5, y: 0.88, color: "#43a047" },
      { x: 0.5, y: 0.5, color: "#9e9e9e" }
    ];
  const targetSize = 24 * dpr;

  ctx.globalAlpha = 0.85;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 3 * dpr;
    const cx = t.x * w;
    const cy = t.y * h;
    if (i === 4) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(
        -targetSize / 2,
        -targetSize / 2,
        targetSize,
        targetSize
      );
      ctx.restore();
    } else {
      ctx.strokeRect(cx - targetSize / 2, cy - targetSize / 2, targetSize, targetSize);
    }
  }
  ctx.globalAlpha = 1;

  for (const n of gameNotes) {
    const appearAt = n.time - n.spawn;
    if (nowSeconds < appearAt) continue;
    if (nowSeconds > n.time) continue;

    const desc = layout.laneDescriptor?.(n.lane);
    if (!desc?.from || !desc?.to) continue;
    const from = {
      x: (desc.from.x / 100) * w,
      y: (desc.from.y / 100) * h
    };
    const to = { x: (desc.to.x / 100) * w, y: (desc.to.y / 100) * h };

    let progress = (nowSeconds - appearAt) / n.spawn;
    progress = Math.max(0, Math.min(1, progress));
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;

    const r = (noteSizePx(n.midi) / 2) * dpr;
    ctx.beginPath();
    ctx.fillStyle = desc.color;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
  }
}
