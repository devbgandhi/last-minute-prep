const STORAGE_KEY = "last-minute-prep-guest-user-id";

export function getGuestUserId() {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const guestUserId = `guest-${crypto.randomUUID()}`;
  window.localStorage.setItem(STORAGE_KEY, guestUserId);
  return guestUserId;
}