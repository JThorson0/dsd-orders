// js/cutoffs.js — OTS deadline math. Pure, no DOM.
// Cutoffs: Tuesday 7:30 AM ET → Thursday delivery.
//          Saturday 7:30 AM ET → Tuesday delivery.

const TZ = "America/New_York";
const WD_NAME = { 2: "Tuesday", 6: "Saturday" };

function etParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    y: +get("year"),
    m: +get("month"),
    d: +get("day"),
  };
}

// Convert an ET wall-clock time to the UTC instant it represents.
function etWallToUtc(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(guess));
  const get = (t) => parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(
    +get("year"),
    +get("month") - 1,
    +get("day"),
    +get("hour") % 24,
    +get("minute"),
    +get("second")
  );
  return new Date(guess - (asUtc - guess));
}

// Next upcoming cutoff strictly after `now`.
// Returns { cutoff: Date, key: "YYYY-MM-DD" (ET date), delivery, weekday }.
export function getNextCutoff(now = new Date()) {
  const ep = etParts(now);
  for (let off = 0; off < 8; off++) {
    // DST-safe day stepping in ET calendar days.
    const dUtc = new Date(Date.UTC(ep.y, ep.m - 1, ep.d + off));
    const wd = dUtc.getUTCDay();
    if (wd === 2 || wd === 6) {
      const cutoff = etWallToUtc(
        dUtc.getUTCFullYear(),
        dUtc.getUTCMonth() + 1,
        dUtc.getUTCDate(),
        7,
        30
      );
      if (cutoff.getTime() > now.getTime()) {
        const key =
          `${dUtc.getUTCFullYear()}-` +
          `${String(dUtc.getUTCMonth() + 1).padStart(2, "0")}-` +
          `${String(dUtc.getUTCDate()).padStart(2, "0")}`;
        return {
          cutoff,
          key,
          weekday: WD_NAME[wd],
          delivery: wd === 2 ? "Thursday" : "Tuesday",
        };
      }
    }
  }
  return null;
}

export function formatCountdown(ms) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// "Saturday 7:30 AM ET → Tuesday delivery (in 2d 4h)"
export function describeCutoff(cutoffInfo, now = new Date()) {
  if (!cutoffInfo) return "No upcoming cutoff";
  const left = formatCountdown(cutoffInfo.cutoff.getTime() - now.getTime());
  return `${cutoffInfo.weekday} 7:30 AM ET → ${cutoffInfo.delivery} delivery (in ${left})`;
}
