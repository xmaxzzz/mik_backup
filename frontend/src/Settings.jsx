import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api.js";

export default function Settings() {
  return (
    <>
      <RosVersionCard />
      <YandexCard />
      <TelegramCard />
    </>
  );
}

/* --------------------------------------------------------------------- */
/* RouterOS latest-stable reference (for the version badges)             */
/* --------------------------------------------------------------------- */
function RosVersionCard() {
  const [value, setValue] = useState("");
  const [effective, setEffective] = useState(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setValue(s.ros_latest_version || "");
      setEffective(s.ros_latest_effective || null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      await api.updateSettings({ ros_latest_version: value.trim() });
      setMsg("Сохранено.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Версия RouterOS</h2>
        <span className="muted small">
          сейчас используется: <span className="mono">{effective || "—"}</span>
        </span>
      </div>
      <p className="muted small">
        Актуальная стабильная версия, с которой сравниваются роутеры (зелёный —
        новее или равно, оранжевый — устарел). Файл MikroTik автоопределения
        (NEWEST7.stable) часто устаревший, поэтому укажите версию вручную —
        например <span className="mono">7.21.5</span>. Пусто — использовать
        автоопределение.
      </p>
      <label>Актуальная stable-версия</label>
      <input
        className="mono"
        placeholder="напр. 7.21.5 (пусто — авто)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn secondary" disabled={busy} onClick={save}>
        Сохранить
      </button>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

/* --------------------------------------------------------------------- */
/* Yandex.Disk                                                            */
/* --------------------------------------------------------------------- */
function YandexCard() {
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [code, setCode] = useState("");
  const [directToken, setDirectToken] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.yandexStatus();
      setStatus(s);
      const settings = await api.getSettings();
      setClientId(settings.yandex_client_id || "");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveClient() {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const patch = { yandex_client_id: clientId };
      if (clientSecret !== "") patch.yandex_client_secret = clientSecret;
      await api.updateSettings(patch);
      setClientSecret("");
      setMsg("Сохранено.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openAuth() {
    setError("");
    try {
      const { auth_url } = await api.yandexAuthUrl();
      window.open(auth_url, "_blank", "noopener");
      setMsg("Разрешите доступ в открывшемся окне и вставьте код ниже.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось получить URL");
    }
  }

  async function exchange() {
    setError("");
    setBusy(true);
    try {
      const s = await api.yandexExchange(code);
      setStatus(s);
      setCode("");
      setMsg("Подключено к Яндекс.Диску.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка обмена кода");
    } finally {
      setBusy(false);
    }
  }

  async function useDirectToken() {
    setError("");
    setBusy(true);
    try {
      const s = await api.yandexDirectToken(directToken);
      setStatus(s);
      setDirectToken("");
      setMsg("Токен сохранён, подключено.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка токена");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Отключить Яндекс.Диск?")) return;
    setBusy(true);
    try {
      setStatus(await api.yandexDisconnect());
      setMsg("Отключено.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Яндекс.Диск</h2>
        {status && (
          <span className={`tag ${status.connected ? "ok" : "error"}`}>
            {status.connected
              ? `подключено${status.display_name ? ": " + status.display_name : ""}`
              : "не подключено"}
          </span>
        )}
      </div>

      <p className="muted small">
        Зарегистрируйте приложение на{" "}
        <a href="https://oauth.yandex.ru/client/new" target="_blank" rel="noopener">
          oauth.yandex.ru
        </a>{" "}
        с правом <span className="mono">cloud_api:disk.read + cloud_api:disk.write</span> и
        redirect URI <span className="mono">https://oauth.yandex.ru/verification_code</span>.
      </p>

      <label>client_id</label>
      <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <label>
        client_secret{" "}
        {status?.client_secret_set && <span className="muted small">(сохранён)</span>}
      </label>
      <input
        type="password"
        value={clientSecret}
        placeholder={status?.client_secret_set ? "•••••••• (введите, чтобы изменить)" : ""}
        onChange={(e) => setClientSecret(e.target.value)}
      />
      <button className="btn secondary" disabled={busy} onClick={saveClient}>
        Сохранить client_id / secret
      </button>

      <hr className="sep" />

      {status?.connected ? (
        <>
          <FolderNavigator
            currentFolder={status.folder}
            onSaved={async () => {
              setMsg("Папка сохранена.");
              await refresh();
            }}
            onError={setError}
          />
          <button className="btn danger" disabled={busy} onClick={disconnect}>
            Отключить
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            Подключение: нажмите «Подключить», авторизуйтесь, скопируйте код и вставьте
            его.
          </p>
          <button className="btn" onClick={openAuth} disabled={!status}>
            Подключить (получить код)
          </button>
          <div className="row" style={{ marginTop: 12 }}>
            <div className="grow">
              <label>Код подтверждения</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <button className="btn" disabled={busy || !code} onClick={exchange}>
                Обменять код
              </button>
            </div>
          </div>
          <details className="fallback">
            <summary>Или вставить готовый OAuth-токен</summary>
            <label>OAuth-токен</label>
            <input
              value={directToken}
              onChange={(e) => setDirectToken(e.target.value)}
            />
            <button
              className="btn secondary"
              disabled={busy || !directToken}
              onClick={useDirectToken}
            >
              Сохранить токен
            </button>
          </details>
        </>
      )}

      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function FolderNavigator({ currentFolder, onSaved, onError }) {
  const [path, setPath] = useState("/");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (p) => {
      setBusy(true);
      try {
        setItems(await api.yandexFolders(p));
        setPath(p);
      } catch (err) {
        onError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    load("/");
  }, [load]);

  function parent() {
    if (path === "/") return;
    const up = path.replace(/\/[^/]+\/?$/, "") || "/";
    load(up);
  }

  async function createFolder() {
    const name = window.prompt("Имя новой папки:");
    if (!name) return;
    const full = `${path.replace(/\/$/, "")}/${name}`;
    setBusy(true);
    try {
      await api.yandexCreateFolder(full);
      await load(path);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectThis() {
    setBusy(true);
    try {
      await api.updateSettings({ yandex_folder: path });
      await onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="folder-nav">
      <div className="card-head">
        <h3>Папка для бэкапов</h3>
        <span className="muted small">
          текущая: <span className="mono">{currentFolder}</span>
        </span>
      </div>
      <div className="folder-bar">
        <button className="btn small secondary" onClick={parent} disabled={path === "/"}>
          ↑ вверх
        </button>
        <span className="mono path">{path}</span>
        <button className="btn small secondary" onClick={createFolder} disabled={busy}>
          + папка
        </button>
        <button className="btn small" onClick={selectThis} disabled={busy}>
          Выбрать эту папку
        </button>
      </div>
      <ul className="folder-list">
        {busy && <li className="muted">Загрузка…</li>}
        {!busy && items.length === 0 && <li className="muted">Нет вложенных папок</li>}
        {!busy &&
          items.map((f) => (
            <li key={f.path}>
              <button className="link" onClick={() => load(f.path)}>
                📁 {f.name}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/* Telegram                                                              */
/* --------------------------------------------------------------------- */
function TelegramCard() {
  const [chatId, setChatId] = useState("");
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setChatId(s.telegram_chat_id || "");
      setTokenSet(s.telegram_bot_token_set);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save() {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const patch = { telegram_chat_id: chatId };
      if (token !== "") patch.telegram_bot_token = token;
      await api.updateSettings(patch);
      setToken("");
      setMsg("Сохранено.");
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setError("");
    setMsg("");
    setBusy(true);
    try {
      const res = await api.testTelegram();
      if (res.ok) setMsg("Тестовое сообщение отправлено ✓");
      else setError(`Не отправлено: ${res.error || "неизвестная ошибка"}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Telegram-уведомления</h2>
        <span className={`tag ${tokenSet && chatId ? "ok" : "error"}`}>
          {tokenSet && chatId ? "настроено" : "не настроено"}
        </span>
      </div>
      <label>
        Bot token {tokenSet && <span className="muted small">(сохранён)</span>}
      </label>
      <input
        type="password"
        value={token}
        placeholder={tokenSet ? "•••••••• (введите, чтобы изменить)" : "123456:ABC-DEF..."}
        onChange={(e) => setToken(e.target.value)}
      />
      <label>Chat ID</label>
      <input value={chatId} onChange={(e) => setChatId(e.target.value)} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn secondary" disabled={busy} onClick={save}>
          Сохранить
        </button>
        <button className="btn" disabled={busy} onClick={test}>
          Отправить тест
        </button>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
