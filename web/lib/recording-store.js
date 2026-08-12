// In-memory, tab-scoped cache for the full-interview recording Blob. Client
// navigation between the interview workspace and results page is a SPA
// transition (no full reload), so a plain module-level Map survives it. This
// is intentionally not persisted anywhere — refreshing the results page or
// returning later loses it, same as this app's other in-session-only state.
const recordings = new Map();

export function saveFullRecording(sessionId, blob) {
  recordings.set(sessionId, blob);
}

export function getFullRecording(sessionId) {
  return recordings.get(sessionId) || null;
}
