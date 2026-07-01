import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadBackup, getToken, setToken } from "./api.js";

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleString();
}

function fmtSize(n) {
  if (!n) return "0 B";
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");

  const loadUser = useCallback(async () => {
    if (!getToken()) {
      setBooting(false);
      return;
    }
    try {
      setUser(await api.me());
    } catch (_) {
      setToken(null);
      setUser(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  async function handleLogin(username, password) {
    setAuthError("");
    try {
      const res = await api.login(username, password);
      setToken(res.access_token);
      setUser(await api.me());
    } catch (err) {
      setAuthError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
  }

  if (booting) return <div className="center muted">Loading…</div>;

  if (!user) return <Login onLogin={handleLogin} error={authError} />;

  if (user.must_change_password) {
    return (
      <Shell user={user} onLogout={handleLogout}>
        <ChangePassword
          forced
          onDone={() => setUser({ ...user, must_change_password: false })}
        />
      </Shell>
    );
  }

  return (
    <Shell user={user} onLogout={handleLogout}>
      <Dashboard />
    </Shell>
  );
}

function Shell({ user, onLogout, children }) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> Mikrotik Backup
        </div>
        <div className="topbar-right">
          <span className="muted">{user.username}</span>
          {!user.must_change_password && (
            <button className="link" onClick={() => setShowPw(true)}>
              Change password
            </button>
          )}
          <button className="btn secondary" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="container">{children}</main>
      {showPw && (
        <Modal title="Change password" onClose={() => setShowPw(false)}>
          <ChangePassword onDone={() => setShowPw(false)} />
        </Modal>
      )}
    </div>
  );
}

function Login({ onLogin, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await onLogin(username, password);
    setBusy(false);
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>
          <span className="dot" /> Mikrotik Backup
        </h1>
        <p className="muted">Sign in to manage device backups.</p>
        <label>Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function ChangePassword({ onDone, forced = false }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={forced ? "card login" : ""} onSubmit={submit}>
      {forced && (
        <>
          <h2>Set a new password</h2>
          <p className="muted">
            You are using the initial admin password. Please choose a new one.
          </p>
        </>
      )}
      <label>Current password</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label>New password</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      <label>Confirm new password</label>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={busy || !current || !next || !confirm}>
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [backups, setBackups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await api.listDevices());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const refreshBackups = useCallback(async (deviceId) => {
    try {
      setBackups(await api.listBackups(deviceId));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    refreshBackups(null);
  }, [refreshDevices, refreshBackups]);

  async function runBackup(device) {
    setError("");
    setBusyId(device.id);
    try {
      await api.backupDevice(device.id);
      await refreshDevices();
      await refreshBackups(selected ? selected.id : null);
    } catch (err) {
      setError(`Backup of ${device.name} failed: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function removeDevice(device) {
    if (!window.confirm(`Delete "${device.name}" and all its backups?`)) return;
    setError("");
    try {
      await api.deleteDevice(device.id);
      if (selected && selected.id === device.id) setSelected(null);
      await refreshDevices();
      await refreshBackups(selected && selected.id === device.id ? null : selected?.id);
    } catch (err) {
      setError(err.message);
    }
  }

  function selectDevice(device) {
    const next = selected && selected.id === device.id ? null : device;
    setSelected(next);
    refreshBackups(next ? next.id : null);
  }

  return (
    <>
      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Devices</h2>
          <button className="btn" onClick={() => setShowAdd(true)}>
            + Add device
          </button>
        </div>
        {devices.length === 0 ? (
          <p className="muted">No devices yet. Add a Mikrotik router to start backing it up.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Host</th>
                <th>User</th>
                <th>Enabled</th>
                <th>Last backup</th>
                <th>Backups</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr
                  key={d.id}
                  className={selected && selected.id === d.id ? "selected" : ""}
                >
                  <td>
                    <button className="link" onClick={() => selectDevice(d)}>
                      {d.name}
                    </button>
                  </td>
                  <td>
                    {d.host}:{d.port}
                  </td>
                  <td>{d.username}</td>
                  <td>{d.enabled ? "yes" : "no"}</td>
                  <td>
                    {fmtDate(d.last_backup_at)}{" "}
                    {d.last_backup_status && (
                      <span className={`tag ${d.last_backup_status}`}>
                        {d.last_backup_status}
                      </span>
                    )}
                  </td>
                  <td>{d.backup_count}</td>
                  <td className="actions">
                    <button
                      className="btn small"
                      disabled={busyId === d.id}
                      onClick={() => runBackup(d)}
                    >
                      {busyId === d.id ? "Backing up…" : "Back up now"}
                    </button>
                    <button className="btn small danger" onClick={() => removeDevice(d)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>
            Backups{" "}
            {selected && <span className="muted">— {selected.name}</span>}
          </h2>
          {selected && (
            <button className="link" onClick={() => selectDevice(selected)}>
              Show all
            </button>
          )}
        </div>
        {backups.length === 0 ? (
          <p className="muted">No backups recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>Size</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.created_at)}</td>
                  <td className="mono">{b.filename}</td>
                  <td>{fmtSize(b.size_bytes)}</td>
                  <td>
                    <span className={`tag ${b.status}`}>{b.status}</span>
                    {b.status === "error" && b.message && (
                      <div className="muted small">{b.message}</div>
                    )}
                  </td>
                  <td>
                    {b.status === "ok" && (
                      <button className="btn small" onClick={() => downloadBackup(b)}>
                        Download
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showAdd && (
        <Modal title="Add device" onClose={() => setShowAdd(false)}>
          <AddDevice
            onCreated={async () => {
              setShowAdd(false);
              await refreshDevices();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function AddDevice({ onCreated }) {
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    password: "",
    enabled: true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.createDevice({ ...form, port: Number(form.port) });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create device");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>Name</label>
      <input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
      <div className="row">
        <div className="grow">
          <label>Host / IP</label>
          <input value={form.host} onChange={(e) => set("host", e.target.value)} />
        </div>
        <div className="port">
          <label>SSH port</label>
          <input
            type="number"
            value={form.port}
            onChange={(e) => set("port", e.target.value)}
          />
        </div>
      </div>
      <label>SSH username</label>
      <input value={form.username} onChange={(e) => set("username", e.target.value)} />
      <label>SSH password</label>
      <input
        type="password"
        value={form.password}
        onChange={(e) => set("password", e.target.value)}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        Include in scheduled backups
      </label>
      {error && <div className="error">{error}</div>}
      <button
        className="btn"
        disabled={busy || !form.name || !form.host || !form.username || !form.password}
      >
        {busy ? "Saving…" : "Add device"}
      </button>
    </form>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
