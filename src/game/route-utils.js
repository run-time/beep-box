export function parseLevelRoute(pathname = window.location.pathname) {
  const m = /^\/level\/(\d+)\/?$/.exec(String(pathname || ""));
  if (!m) return null;
  const level = Number(m[1]);
  return Number.isFinite(level) && level >= 1 ? level : null;
}

export function pushLevelRoute(level) {
  const n = Math.max(1, Math.floor(Number(level) || 1));
  const nextPath = `/level/${n}`;
  if (window.location.pathname !== nextPath) {
    window.history.pushState({}, "", nextPath);
  }
}

export function replaceRootRoute() {
  if (window.location.pathname !== "/") {
    window.history.replaceState({}, "", "/");
  }
}
