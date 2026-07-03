// Thin API client. Token is kept in localStorage.

const TOKEN_KEY = "mikbackup_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function handleErrors(res, auth) {
  if (res.status === 401 && auth) {
    setToken(null);
    throw new ApiError("Session expired, please sign in again.", 401);
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.detail) {
        detail =
          typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
      }
    } catch (_) {
      /* non-JSON error body */
    }
    throw new ApiError(detail, res.status);
  }
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await handleErrors(res, auth);
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function upload(path, file) {
  const form = new FormData();
  form.append("file", file);
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: form });
  await handleErrors(res, true);
  return res.json();
}

export const api = {
  // auth
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: { username, password }, auth: false }),
  me: () => request("/auth/me"),
  changePassword: (current_password, new_password) =>
    request("/auth/change-password", {
      method: "POST",
      body: { current_password, new_password },
    }),

  // devices
  listDevices: () => request("/devices"),
  createDevice: (device) => request("/devices", { method: "POST", body: device }),
  updateDevice: (id, patch) =>
    request(`/devices/${id}`, { method: "PATCH", body: patch }),
  deleteDevice: (id) => request(`/devices/${id}`, { method: "DELETE" }),
  backupDevice: (id) => request(`/devices/${id}/backup`, { method: "POST" }),
  getDevicePassword: (id) => request(`/devices/${id}/password`),
  generateDevicePassword: (id) =>
    request(`/devices/${id}/generate-password`, { method: "POST" }),
  importPreview: (file) => upload("/devices/import", file),
  importConfirm: (payload) =>
    request("/devices/import/confirm", { method: "POST", body: payload }),

  // backups
  listBackups: (deviceId) =>
    request(deviceId ? `/backups?device_id=${deviceId}` : "/backups"),
  deleteBackup: (id) => request(`/backups/${id}`, { method: "DELETE" }),

  // schedules
  listSchedules: () => request("/schedules"),
  createSchedule: (s) => request("/schedules", { method: "POST", body: s }),
  updateSchedule: (id, patch) =>
    request(`/schedules/${id}`, { method: "PATCH", body: patch }),
  deleteSchedule: (id) => request(`/schedules/${id}`, { method: "DELETE" }),

  // settings
  getSettings: () => request("/settings"),
  updateSettings: (patch) => request("/settings", { method: "PUT", body: patch }),
  testTelegram: () => request("/settings/test-telegram", { method: "POST" }),

  // ssh key
  getSshKey: () => request("/ssh-key"),

  // yandex
  yandexStatus: () => request("/yandex/status"),
  yandexAuthUrl: () => request("/yandex/auth-url"),
  yandexExchange: (code) => request("/yandex/exchange", { method: "POST", body: { code } }),
  yandexDirectToken: (token) =>
    request("/yandex/token", { method: "POST", body: { token } }),
  yandexDisconnect: () => request("/yandex/disconnect", { method: "POST" }),
  yandexFolders: (path) =>
    request(`/yandex/folders?path=${encodeURIComponent(path || "/")}`),
  yandexCreateFolder: (path) =>
    request("/yandex/folders", { method: "POST", body: { path } }),
};

// Download needs the auth header, so fetch as a blob and save it.
export async function downloadBackup(backup) {
  const res = await fetch(`/api/backups/${backup.id}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError("Download failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backup.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
