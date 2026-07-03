import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError, getToken, setToken } from "./api.js";
import { Modal } from "./ui.jsx";
import Devices from "./Devices.jsx";
import Schedules from "./Schedules.jsx";
import Settings from "./Settings.jsx";
import TerminalPage from "./Terminal.jsx";

const TABS = [
  { key: "devices", label: "Устройства" },
  { key: "schedules", label: "Расписания" },
  { key: "settings", label: "Настройки" },
];

export default function App() {
  // Standalone SSH terminal window: /terminal/{id} — rendered on its own,
  // outside the dashboard shell (shares the auth token via localStorage).
  const termMatch = window.location.pathname.match(/^\/terminal\/(\d+)$/);
  if (termMatch) return <TerminalPage deviceId={Number(termMatch[1])} />;
  return <AuthedApp />;
}

function AuthedApp() {
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
      setAuthError(err instanceof ApiError ? err.message : "Ошибка входа");
    }
  }

  function handleLogout() {
    setToken(null);
    setUser(null);
  }

  if (booting) return <div className="center muted">Загрузка…</div>;
  if (!user) return <Login onLogin={handleLogin} error={authError} />;

  if (user.must_change_password) {
    return (
      <Shell user={user} onLogout={handleLogout} tab={null} onTab={() => {}}>
        <ChangePassword
          forced
          onDone={() => setUser({ ...user, must_change_password: false })}
        />
      </Shell>
    );
  }
  return <MainApp user={user} onLogout={handleLogout} />;
}

function MainApp({ user, onLogout }) {
  const [tab, setTab] = useState("devices");
  return (
    <Shell user={user} onLogout={onLogout} tab={tab} onTab={setTab}>
      {tab === "devices" && <Devices />}
      {tab === "schedules" && <Schedules />}
      {tab === "settings" && <Settings />}
    </Shell>
  );
}

function Shell({ user, onLogout, tab, onTab, children }) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" /> Mikrotik Backup
        </div>
        {tab !== null && (
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab ${tab === t.key ? "active" : ""}`}
                onClick={() => onTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <div className="topbar-right">
          <span className="muted">{user.username}</span>
          {!user.must_change_password && (
            <button className="link" onClick={() => setShowPw(true)}>
              Сменить пароль
            </button>
          )}
          <button className="btn secondary" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </header>
      <main className="container">{children}</main>
      {showPw && (
        <Modal title="Смена пароля" onClose={() => setShowPw(false)}>
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
        <p className="muted">Войдите, чтобы управлять бэкапами устройств.</p>
        <label>Имя пользователя</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />
        <label>Пароль</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !username || !password}>
          {busy ? "Вход…" : "Войти"}
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
    if (next.length < 8) return setError("Новый пароль должен быть не короче 8 символов.");
    if (next !== confirm) return setError("Пароли не совпадают.");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={forced ? "card login" : ""} onSubmit={submit}>
      {forced && (
        <>
          <h2>Задайте новый пароль</h2>
          <p className="muted">
            Вы используете начальный пароль администратора. Пожалуйста, смените его.
          </p>
        </>
      )}
      <label>Текущий пароль</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label>Новый пароль</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
      <label>Повторите новый пароль</label>
      <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={busy || !current || !next || !confirm}>
        {busy ? "Сохранение…" : "Обновить пароль"}
      </button>
    </form>
  );
}
