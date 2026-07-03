import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadBackup } from "./api.js";
import { CopyButton, fmtDate, fmtSize, Modal, StatusDot } from "./ui.jsx";

// Open the SSH terminal for a device in a separate browser window.
// A stable window name per device reuses/focuses an already-open terminal.
function openTerminal(device) {
  window.open(
    `/terminal/${device.id}`,
    `mik-term-${device.id}`,
    "width=1024,height=680,menubar=no,toolbar=no,location=no,status=no"
  );
}

// Copy text to the clipboard, with a fallback for non-secure contexts.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }
}

const POLL_MS = 10000;

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await api.listDevices());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const refreshSchedules = useCallback(async () => {
    try {
      setSchedules(await api.listSchedules());
    } catch (_) {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    refreshSchedules();
  }, [refreshDevices, refreshSchedules]);

  // live-refresh device list (online dots) every 10s without reloading page
  useEffect(() => {
    const id = setInterval(() => {
      api.listDevices().then(setDevices).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function runBackup(device) {
    setError("");
    setBusyId(device.id);
    try {
      await api.backupDevice(device.id);
      await refreshDevices();
    } catch (err) {
      setError(`Бэкап «${device.name}» не удался: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function removeDevice(device) {
    if (!window.confirm(`Удалить «${device.name}» и все его бэкапы?`)) return;
    setError("");
    try {
      await api.deleteDevice(device.id);
      await refreshDevices();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      {error && <div className="error banner">{error}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Устройства</h2>
          <div className="btn-group">
            <button className="btn secondary" onClick={() => setShowImport(true)}>
              Импорт списка
            </button>
            <button className="btn" onClick={() => setShowAdd(true)}>
              + Добавить устройство
            </button>
          </div>
        </div>
        {devices.length === 0 ? (
          <p className="muted">
            Пока нет устройств. Добавьте роутер Mikrotik, чтобы начать бэкапить.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Имя</th>
                  <th>Адрес</th>
                  <th>Аутентификация</th>
                  <th>Расписание</th>
                  <th>Посл. бэкап</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr
                    key={d.id}
                    className="row-click"
                    onClick={() => setEditing(d)}
                    title="Открыть карточку роутера (настройки + бэкапы)"
                  >
                    <td className="dot-cell">
                      <StatusDot online={d.online} lastCheck={d.last_check_at} />
                    </td>
                    <td>
                      <span className="link">{d.name}</span>
                      {d.comment && (
                        <div className="muted small">{d.comment}</div>
                      )}
                    </td>
                    <td className="mono">
                      {d.host}:{d.port}
                    </td>
                    <td>
                      {d.auth_type === "key" ? "🔑 ключ" : "🔒 пароль"}{" "}
                      <span className="muted small">{d.username}</span>
                    </td>
                    <td>{d.schedule_name || <span className="muted">— ручной</span>}</td>
                    <td>
                      {d.last_backup_status ? (
                        <>
                          <span className={`tag ${d.last_backup_status}`}>
                            {d.last_backup_status === "ok" ? "успех" : "ошибка"}
                          </span>{" "}
                          <span className="muted small">{fmtDate(d.last_backup_at)}</span>
                          {d.last_backup_error && (
                            <div className="muted small" title={d.last_backup_error}>
                              {d.last_backup_error.slice(0, 60)}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="actions">
                      <button
                        className="btn small secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTerminal(d);
                        }}
                        title="Открыть SSH-терминал в отдельном окне"
                      >
                        SSH
                      </button>
                      <button
                        className="btn small"
                        disabled={busyId === d.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          runBackup(d);
                        }}
                      >
                        {busyId === d.id ? "Бэкап…" : "Бэкап"}
                      </button>
                      <button
                        className="btn small danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeDevice(d);
                        }}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SshKeyPanel />

      {showAdd && (
        <DeviceForm
          schedules={schedules}
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false);
            await refreshDevices();
          }}
        />
      )}
      {editing && (
        <DeviceForm
          device={editing}
          schedules={schedules}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refreshDevices();
          }}
        />
      )}
      {showImport && (
        <ImportDevices
          schedules={schedules}
          onClose={() => setShowImport(false)}
          onDone={async () => {
            setShowImport(false);
            await refreshDevices();
          }}
        />
      )}
    </>
  );
}

/* ----------------------------- SSH key panel ----------------------------- */
function SshKeyPanel() {
  const [key, setKey] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (key) {
      setOpen((o) => !o);
      return;
    }
    try {
      setKey(await api.getSshKey());
      setOpen(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>SSH-ключ приложения</h2>
        <button className="btn secondary" onClick={load}>
          {open ? "Скрыть" : "Показать ключ и инструкцию"}
        </button>
      </div>
      <p className="muted small">
        Приложение входит на роутеры по этому ключу. Готовый код для вставки в
        роутер (с паролем) формируется в карточке устройства — кнопка
        «Сгенерировать пароль». Файл ключа создаётся кодом прямо на роутере —
        вручную загружать ничего не нужно.
      </p>
      {error && <div className="error">{error}</div>}
      {open && key && (
        <>
          <label>Публичный ключ</label>
          <textarea className="mono code" readOnly rows={2} value={key.public_key} />
          <CopyButton text={key.public_key} label="Скопировать публичный ключ" />
        </>
      )}
    </section>
  );
}

/* ----------------------------- Add device ----------------------------- */
function ScheduleSelect({ value, onChange, schedules }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Без расписания (только вручную)</option>
      {schedules.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.cron})
        </option>
      ))}
    </select>
  );
}

function DeviceForm({ device = null, schedules, onClose, onSaved }) {
  const isNew = !device;
  const [form, setForm] = useState({
    name: device?.name || "",
    host: device?.host || "",
    port: device?.port ?? 10322,
    username: device?.username || "backuser",
    auth_type: device?.auth_type || "key",
    password: "",
    comment: device?.comment || "",
    enabled: device?.enabled ?? true,
    schedule_id: device?.schedule_id ? String(device.schedule_id) : "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState(null); // {password, ready_rsc}
  const [copied, setCopied] = useState(false); // ready_rsc auto-copied
  const [revealed, setRevealed] = useState(null); // stored password shown
  const [hasPassword, setHasPassword] = useState(device?.has_password || false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = {
        name: form.name,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        auth_type: form.auth_type,
        comment: form.comment,
        enabled: form.enabled,
        schedule_id: form.schedule_id ? Number(form.schedule_id) : null,
      };
      if (form.auth_type === "password" && form.password) {
        body.password = form.password;
      }
      if (isNew) await api.createDevice(body);
      else await api.updateDevice(device.id, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function generatePassword() {
    if (
      hasPassword &&
      !window.confirm(
        "У устройства уже есть сохранённый пароль. Сгенерировать новый вместо него?"
      )
    )
      return;
    setError("");
    setBusy(true);
    try {
      const res = await api.generateDevicePassword(device.id);
      setGenerated(res);
      setRevealed(null);
      setHasPassword(true);
      // auto-copy the RouterOS script so it can be pasted straight away
      setCopied(await copyText(res.ready_rsc));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка генерации");
    } finally {
      setBusy(false);
    }
  }

  async function revealPassword() {
    setError("");
    try {
      const res = await api.getDevicePassword(device.id);
      setRevealed(res.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось получить пароль");
    }
  }

  // a password is required only when the device will use password auth
  // and doesn't already have one stored
  const needPassword =
    form.auth_type === "password" && (isNew || !hasPassword);
  const canSubmit =
    form.name && form.host && form.username && (!needPassword || form.password);

  return (
    <Modal
      title={isNew ? "Добавить устройство" : "Изменить устройство"}
      onClose={onClose}
      medium={!isNew}
    >
      <form onSubmit={submit}>
        <label>Имя</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        <div className="row">
          <div className="grow">
            <label>Хост / IP</label>
            <input value={form.host} onChange={(e) => set("host", e.target.value)} />
          </div>
          <div className="port">
            <label>SSH-порт</label>
            <input
              type="number"
              value={form.port}
              onChange={(e) => set("port", e.target.value)}
            />
          </div>
        </div>
        <label>SSH-пользователь</label>
        <input value={form.username} onChange={(e) => set("username", e.target.value)} />

        <label>Аутентификация</label>
        <div className="seg">
          <label className={form.auth_type === "key" ? "active" : ""}>
            <input
              type="radio"
              name="auth"
              checked={form.auth_type === "key"}
              onChange={() => set("auth_type", "key")}
            />
            🔑 По ключу приложения
          </label>
          <label className={form.auth_type === "password" ? "active" : ""}>
            <input
              type="radio"
              name="auth"
              checked={form.auth_type === "password"}
              onChange={() => set("auth_type", "password")}
            />
            🔒 По паролю
          </label>
        </div>
        {form.auth_type === "password" && (
          <>
            <label>SSH-пароль</label>
            <input
              type="password"
              value={form.password}
              placeholder={needPassword ? "" : "•••••••• (пусто — не менять)"}
              onChange={(e) => set("password", e.target.value)}
            />
          </>
        )}

        <label>Расписание</label>
        <ScheduleSelect
          value={form.schedule_id}
          schedules={schedules}
          onChange={(v) => set("schedule_id", v || "")}
        />

        <label>Комментарий</label>
        <input
          value={form.comment}
          placeholder="например: объект, за NAT, особенности доступа…"
          onChange={(e) => set("comment", e.target.value)}
        />

        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          Включено (участвует в расписании)
        </label>

        {!isNew && (
          <>
            <hr className="sep" />
            <label>Пароль устройства и код для роутера</label>
            <div className="btn-group">
              <button
                type="button"
                className="btn small"
                disabled={busy}
                onClick={generatePassword}
              >
                Сгенерировать пароль
              </button>
              {hasPassword && (
                <button
                  type="button"
                  className="btn small secondary"
                  onClick={() =>
                    revealed ? setRevealed(null) : revealPassword()
                  }
                >
                  {revealed ? "Скрыть пароль" : "Показать пароль"}
                </button>
              )}
            </div>
            {revealed && !generated && (
              <div className="notice">
                Пароль: <span className="mono">{revealed}</span>{" "}
                <CopyButton text={revealed} label="Скопировать" className="btn small secondary" />
              </div>
            )}
            {generated && (
              <>
                <div className="notice">
                  Пароль сохранён: <span className="mono">{generated.password}</span>
                  {copied && " · код скопирован в буфер обмена ✓"}
                </div>
                <label>Код для вставки в роутер</label>
                <pre className="code block">{generated.ready_rsc}</pre>
                <CopyButton text={generated.ready_rsc} label="Скопировать код ещё раз" />
              </>
            )}
          </>
        )}

        {!isNew && <DeviceBackups device={device} />}

        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !canSubmit}>
          {busy ? "Сохранение…" : isNew ? "Добавить" : "Сохранить"}
        </button>
      </form>
    </Modal>
  );
}

/* --------------------- backups inside the device card --------------------- */
function DeviceBackups({ device }) {
  const [backups, setBackups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setBackups(await api.listBackups(device.id));
    } catch (e) {
      setError(e.message);
    }
  }, [device.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function backupNow() {
    setError("");
    setBusy(true);
    try {
      await api.backupDevice(device.id);
    } catch (e) {
      // a failed backup still records an (error) row — show it below
      setError(e instanceof ApiError ? e.message : "Бэкап не удался");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function del(b) {
    if (!window.confirm(`Удалить бэкап ${b.filename}?`)) return;
    setError("");
    try {
      await api.deleteBackup(b.id);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <hr className="sep" />
      <div className="card-head">
        <h3>Бэкапы</h3>
        <button type="button" className="btn small" disabled={busy} onClick={backupNow}>
          {busy ? "Бэкап…" : "Сделать бэкап сейчас"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {backups === null ? (
        <p className="muted small">Загрузка…</p>
      ) : backups.length === 0 ? (
        <p className="muted small">Бэкапов пока нет.</p>
      ) : (
        <div className="table-scroll dev-backups" style={{ maxHeight: 240 }}>
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Размер</th>
                <th>Я.Диск</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.created_at)}</td>
                  <td>{fmtSize(b.size_bytes)}</td>
                  <td>{b.yandex_uploaded ? "☁️" : "—"}</td>
                  <td>
                    <span className={`tag ${b.status}`}>
                      {b.status === "ok" ? "успех" : "ошибка"}
                    </span>
                    {b.status === "error" && b.message && (
                      <div className="muted small">{b.message}</div>
                    )}
                  </td>
                  <td className="actions">
                    {b.status === "ok" && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => downloadBackup(b)}
                      >
                        Скачать
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => del(b)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ----------------------------- CSV import ----------------------------- */
const CSV_TEMPLATE = "host,port,login,note\n10.0.0.1,10322,backuser,Роутер офис\n10.0.0.2,,backuser,Склад\n";

function ImportDevices({ schedules, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [selectedRows, setSelectedRows] = useState({});
  const [authType, setAuthType] = useState("key");
  const [password, setPassword] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const p = await api.importPreview(file);
      setPreview(p);
      const sel = {};
      p.rows.forEach((r, i) => (sel[i] = r.valid));
      setSelectedRows(sel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка чтения CSV");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setError("");
    setBusy(true);
    try {
      const rows = preview.rows
        .filter((r, i) => selectedRows[i] && r.valid)
        .map((r) => ({ host: r.host, port: r.port, login: r.login, note: r.note }));
      if (rows.length === 0) {
        setError("Не выбрано ни одной корректной строки.");
        setBusy(false);
        return;
      }
      await api.importConfirm({
        rows,
        auth_type: authType,
        password: authType === "password" ? password : undefined,
        schedule_id: scheduleId ? Number(scheduleId) : null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = Object.values(selectedRows).filter(Boolean).length;

  return (
    <Modal title="Импорт устройств из CSV" onClose={onClose} wide>
      {!preview ? (
        <>
          <p className="muted small">
            Колонки: <span className="mono">host, port (деф. 10322), login (деф.
            backuser), note</span>. Первая строка-заголовок опциональна.
          </p>
          <pre className="code block">{CSV_TEMPLATE}</pre>
          <label>Файл CSV (до 1 МБ)</label>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
        </>
      ) : (
        <>
          <p className="muted small">
            Найдено {preview.total} строк, корректных {preview.valid_count}. Выбрано{" "}
            {selectedCount}.
          </p>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Хост</th>
                  <th>Порт</th>
                  <th>Логин</th>
                  <th>Примечание</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className={r.valid ? "" : "row-bad"}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={!r.valid}
                        checked={!!selectedRows[i]}
                        onChange={(e) =>
                          setSelectedRows((s) => ({ ...s, [i]: e.target.checked }))
                        }
                      />
                    </td>
                    <td className="mono">{r.host}</td>
                    <td>{r.port}</td>
                    <td>{r.login}</td>
                    <td>{r.note}</td>
                    <td>
                      {r.valid ? (
                        <span className="tag ok">ok</span>
                      ) : (
                        <span className="tag error" title={r.error}>
                          {r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <hr className="sep" />
          <label>Аутентификация для всех</label>
          <div className="seg">
            <label className={authType === "key" ? "active" : ""}>
              <input
                type="radio"
                name="iauth"
                checked={authType === "key"}
                onChange={() => setAuthType("key")}
              />
              🔑 По ключу
            </label>
            <label className={authType === "password" ? "active" : ""}>
              <input
                type="radio"
                name="iauth"
                checked={authType === "password"}
                onChange={() => setAuthType("password")}
              />
              🔒 Общий пароль
            </label>
          </div>
          {authType === "password" && (
            <>
              <label>Общий SSH-пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}
          <label>Расписание</label>
          <ScheduleSelect
            value={scheduleId}
            schedules={schedules}
            onChange={(v) => setScheduleId(v || "")}
          />
          {error && <div className="error">{error}</div>}
          <button
            className="btn"
            disabled={busy || selectedCount === 0 || (authType === "password" && !password)}
            onClick={doImport}
          >
            {busy ? "Импорт…" : `Импортировать (${selectedCount})`}
          </button>
        </>
      )}
      {error && !preview && <div className="error">{error}</div>}
    </Modal>
  );
}
