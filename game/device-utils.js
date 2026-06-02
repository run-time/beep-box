import { UAParser } from "ua-parser-js";

export function getDeviceProfile(defaults = { os: "Unknown", browser: "Unknown" }) {
  const parser = new UAParser();
  const ua = parser.getResult();
  const type = normalizeDeviceType(ua.device?.type);
  return {
    type,
    os: ua.os?.name || defaults.os,
    browser: ua.browser?.name || defaults.browser
  };
}

export function normalizeDeviceType(type) {
  if (type === "mobile") return "phone";
  if (type === "tablet") return "tablet";
  if (type === "smarttv") return "computer";

  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const shortest = Math.min(
    window.screen?.width || 0,
    window.screen?.height || 0
  );

  if (coarse && touchPoints > 0 && shortest > 0 && shortest < 768)
    return "phone";
  if (coarse && touchPoints > 0) return "tablet";
  return "computer";
}
