import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, downloadExport } from "./api.js";

export default function Settings() {
  return (
    <>
      <RosVersionCard />
      <YandexCard />
      <TelegramCard />
      <TransferCard />
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
        новее или равно, оранжевый — устарел). Определяется автоматически со
        страницы загрузки MikroTik (канал stable, обновление раз в ~6 ч). Поле
        ниже — ручное переопределение; оставьте пустым для автоопределения.
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

/* --------------------------------------------------------------------- */
/* Export / Import of the whole configuration (encrypted .mbk bundle)    */
/* --------------------------------------------------------------------- */
function TransferCard() {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Экспорт / Импорт конфигурации</h2>
      </div>
      <p className="muted small">
        Переносимый зашифрованный файл <span className="mono">.mbk</span> со всей базой:
        устройства, расписания, настройки и токены, SSH-ключ приложения и (по желанию)
        история бэкапов. Секреты шифруются под заданный пароль и при импорте
        перешифровываются ключом целевой машины — файл переносится на любую инсталляцию.
      </p>
      <ExportBlock />
      <hr className="sep" />
      <ImportBlock />
    </section>
  );
}

function ExportBlock() {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [opts, setOpts] = useState({
    include_settings: true,
    include_ssh_keys: true,
    include_backups: false,
  });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (key) => setOpts((o) => ({ ...o, [key]: !o[key] }));

  async function run() {
    setError("");
    setMsg("");
    if (passphrase.length < 8) return setError("Пароль должен быть не короче 8 символов.");
    if (passphrase !== confirm) return setError("Пароли не совпадают.");
    setBusy(true);
    try {
      await downloadExport(passphrase, opts);
      setMsg("Файл экспорта сформирован и скачан.");
      setPassphrase("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сформировать экспорт");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Экспорт</h3>
      <label>Пароль для файла</label>
      <input
        type="password"
        value={passphrase}
        placeholder="не короче 8 символов"
        onChange={(e) => setPassphrase(e.target.value)}
      />
      <label>Повторите пароль</label>
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <div className="checks" style={{ margin: "10px 0" }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={opts.include_settings}
            onChange={() => toggle("include_settings")}
          />{" "}
          Настройки и токены (Telegram / Яндекс)
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={opts.include_ssh_keys}
            onChange={() => toggle("include_ssh_keys")}
          />{" "}
          SSH-ключ приложения
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={opts.include_backups}
            onChange={() => toggle("include_backups")}
          />{" "}
          История бэкапов (.rsc) — файл будет крупнее
        </label>
      </div>
      <button className="btn" disabled={busy} onClick={run}>
        {busy ? "Формирование…" : "Скачать бэкап (.mbk)"}
      </button>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function ImportBlock() {
  const fileRef = useRef(null);
  const [passphrase, setPassphrase] = useState("");
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("merge");
  const [opts, setOpts] = useState({
    include_settings: true,
    include_ssh_keys: true,
    include_backups: true,
  });
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (key) => setOpts((o) => ({ ...o, [key]: !o[key] }));

  function selectedFile() {
    return fileRef.current?.files?.[0] || null;
  }

  function reset() {
    setPreview(null);
    setResult(null);
  }

  async function doPreview() {
    setError("");
    setMsg("");
    setResult(null);
    const file = selectedFile();
    if (!file) return setError("Выберите файл .mbk.");
    if (!passphrase) return setError("Введите пароль от файла.");
    setBusy(true);
    try {
      const p = await api.transferPreview(file, passphrase);
      setPreview(p);
      setOpts({
        include_settings: p.has_settings,
        include_ssh_keys: p.has_ssh_keys,
        include_backups: p.backup_count > 0,
      });
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "Не удалось прочитать файл");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setError("");
    setMsg("");
    const file = selectedFile();
    if (!file) return setError("Файл не выбран.");
    if (
      mode === "replace" &&
      !window.confirm(
        "Режим «заменить» удалит текущие устройства, расписания" +
          (opts.include_settings ? " и настройки" : "") +
          " перед импортом. Продолжить?"
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api.transferImport(file, passphrase, { mode, ...opts });
      setResult(r);
      setMsg("Импорт завершён.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось выполнить импорт");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Импорт</h3>
      <label>Файл .mbk</label>
      <input type="file" accept=".mbk" ref={fileRef} onChange={reset} />
      <label>Пароль от файла</label>
      <input
        type="password"
        value={passphrase}
        onChange={(e) => {
          setPassphrase(e.target.value);
          reset();
        }}
      />
      <button className="btn secondary" disabled={busy} onClick={doPreview}>
        {busy && !preview ? "Проверка…" : "Проверить файл"}
      </button>

      {preview && (
        <div className="notice" style={{ marginTop: 12 }}>
          <div className="muted small">
            Экспорт от:{" "}
            <span className="mono">{preview.exported_at || "неизвестно"}</span>
          </div>
          <div>
            Устройств: <b>{preview.device_count}</b> · расписаний:{" "}
            <b>{preview.schedule_count}</b>
            {preview.backup_count > 0 && (
              <>
                {" "}
                · бэкапов: <b>{preview.backup_count}</b>
              </>
            )}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {preview.has_settings
              ? `настройки: ${preview.settings_keys.length} ключ(ей)`
              : "настроек нет"}{" "}
            · {preview.has_ssh_keys ? "SSH-ключ есть" : "SSH-ключа нет"}
          </div>

          <div className="checks" style={{ margin: "12px 0" }}>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={!preview.has_settings}
                checked={opts.include_settings}
                onChange={() => toggle("include_settings")}
              />{" "}
              Импортировать настройки и токены
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={!preview.has_ssh_keys}
                checked={opts.include_ssh_keys}
                onChange={() => toggle("include_ssh_keys")}
              />{" "}
              Восстановить SSH-ключ (перезапишет ключ на этом сервере)
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={preview.backup_count === 0}
                checked={opts.include_backups}
                onChange={() => toggle("include_backups")}
              />{" "}
              Импортировать историю бэкапов
            </label>
          </div>

          <label>Режим</label>
          <div className="row">
            <label className="checkbox">
              <input
                type="radio"
                name="importmode"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />{" "}
              Объединить (обновить по host+логину, добавить новые)
            </label>
          </div>
          <div className="row">
            <label className="checkbox">
              <input
                type="radio"
                name="importmode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />{" "}
              Заменить (очистить текущие данные, затем импортировать)
            </label>
          </div>

          <button
            className={`btn ${mode === "replace" ? "danger" : ""}`}
            disabled={busy}
            onClick={doImport}
            style={{ marginTop: 10 }}
          >
            {busy ? "Импорт…" : "Импортировать"}
          </button>
        </div>
      )}

      {result && (
        <div className="notice" style={{ marginTop: 12 }}>
          Устройства: +{result.devices_created} новых, {result.devices_updated} обновлено ·
          расписания: +{result.schedules_created}, {result.schedules_updated} обновлено
          {result.backups_imported > 0 && <> · бэкапов: +{result.backups_imported}</>}
          <br />
          настройки: {result.settings_applied ? "импортированы" : "пропущены"} · SSH-ключ:{" "}
          {result.ssh_keys_applied ? "восстановлен" : "пропущен"}
        </div>
      )}
      {msg && !result && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
