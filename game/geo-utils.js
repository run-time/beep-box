export async function getCountryByIp({
  enabled = false,
  defaults = {}
} = {}) {
  const fallback = {
    countryCode: defaults.countryCode || "",
    countryName: defaults.countryName || ""
  };
  if (!enabled) return fallback;

  try {
    const res = await fetch("https://ipapi.co/json/", { cache: "no-store" });
    if (!res.ok) throw new Error(`geo lookup failed: ${res.status}`);
    const data = await res.json();
    return {
      countryCode: String(data?.country_code || fallback.countryCode).toUpperCase(),
      countryName: String(data?.country_name || fallback.countryName)
    };
  } catch {
    return fallback;
  }
}

export function countryCodeToFlagEmoji(countryCode) {
  const code = String(countryCode || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(
    ...[...code].map((c) => 127397 + c.charCodeAt(0))
  );
}
