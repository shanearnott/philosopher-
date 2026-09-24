// On-device storage. Everything lives in this browser only; the plan's
// "private by default". Reads and writes tolerate blocked storage.

const KEY = "stoa.v1";

export function freshState() {
  return {
    v: 1,
    profile: { role: "", challenges: "", goals: "" },
    settings: { theme: "auto", hideNumbers: false, token: "" },
    progress: { completedDay: 0 },
    sessions: {},
    ledger: [],
    journal: [],
    favourites: {},
    evenings: {},
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    const base = freshState();
    return { ...base, ...s, profile: { ...base.profile, ...s.profile }, settings: { ...base.settings, ...s.settings } };
  } catch {
    return freshState();
  }
}

let warned = false;
export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    if (!warned) {
      warned = true;
      console.warn("Stoa: storage unavailable; this session won't be kept.");
    }
    return false;
  }
}

export function wipe() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
