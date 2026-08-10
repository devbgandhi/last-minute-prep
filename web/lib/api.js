const ENV_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
const API_URL_STORAGE_KEY = "last-minute-prep-api-url";

function getApiBaseUrl() {
  if (ENV_API_BASE_URL) {
    return ENV_API_BASE_URL;
  }

  if (typeof window !== "undefined") {
    return window.localStorage.getItem(API_URL_STORAGE_KEY) || "";
  }

  return "";
}

export function hasApiBaseUrl() {
  return Boolean(getApiBaseUrl());
}

export function saveApiBaseUrl(url) {
  if (typeof window === "undefined") {
    return;
  }

  const cleaned = (url || "").trim().replace(/\/$/, "");
  if (!cleaned) {
    window.localStorage.removeItem(API_URL_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(API_URL_STORAGE_KEY, cleaned);
}

export async function apiFetch(path, options = {}) {
  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    throw new Error("API URL is not set. Configure NEXT_PUBLIC_API_URL or set it in the app.");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }

  if (!response.ok) {
    const message = data.error || data.detail || `Request failed with ${response.status}`;
    throw new Error(`${message} [${options.method || "GET"} ${path}]`);
  }

  return data;
}