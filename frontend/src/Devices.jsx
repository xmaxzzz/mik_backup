import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, downloadBackup } from "./api.js";
import { CopyButton, fmtDate, fmtSize, Modal, StatusDot } from "./ui.jsx";

const POLL_MS = 10000;

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [backups, setBackups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const selectedRef = useRef(null);

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

  const refreshBackups = useCallback(async (deviceId) => {
    try {
      setBackups(await api.listBackups(deviceId));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    refreshSchedules();
    refreshBackups(null);
  }, [refreshDevices, refreshSchedules, refreshBackups]);

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
      await refreshBackups(selectedRef.current ? selectedRef.current.id : null);
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
      if (selected && selected.id === device.id) {
        setSelected(null);
        selectedRef.current = null;
      }
      await refreshDevices();
      await refreshBackups(selectedRef.current ? selectedRef.current.id : null);
    } catch (err) {
      setError(err.message);
    }
  }

  function selectDevice(device) {
    const next = selected && selected.id === device.id ? null : device;
    setSelected(next);
    selectedRef.current = next;
    refreshBackups(next ? next.id : null);
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
                    className={selected && selected.id === d.id ? "selected" : ""}
                  >
                    <td className="dot-cell">
                      <StatusDot online={d.online} lastCheck={d.last_check_at} />
                    </td>
                    <td>
                      <button className="link" onClick={() => selectDevice(d)}>
                        {d.name}
                      </button>
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
                        className="btn small"
                        disabled={busyId === d.id}
                        onClick={() => runBackup(d)}
                      >
                        {busyId === d.id ? "Бэкап…" : "Бэкап"}
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => removeDevice(d)}
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

      <section className="card">
        <div className="card-head">
          <h2>
            Бэкапы {selected && <span className="muted">— {selected.name}</span>}
          </h2>
          {selected && (
            <button className="link" onClick={() => selectDevice(selected)}>
              Показать все
            </button>
          )}
        </div>
        {backups.length === 0 ? (
          <p className="muted">Бэкапов пока нет.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Файл</th>
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
                    <td className="mono">{b.filename}</td>
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
                    <td>
                      {b.status === "ok" && (
                        <button className="btn small" onClick={() => downloadBackup(b)}>
                          Скачать
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showAdd && (
        <AddDevice
          schedules={schedules}
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
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
        Для устройств с аутентификацией «по ключу» установите этот публичный ключ на
        роутер (пользователь <span className="mono">backup</span>).
      </p>
      {error && <div className="error">{error}</div>}
      {open && key && (
        <>
          <label>Публичный ключ</label>
          <textarea className="mono code" readOnly rows={2} value={key.public_key} />
          <CopyButton text={key.public_key} label="Скопировать публичный ключ" />
          <label style={{ marginTop: 14 }}>Готовый скрипт для роутера</label>
          <pre className="code block">{key.ready_rsc}</pre>
          <CopyButton text={key.ready_rsc} label="Скопировать скрипт" />
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

function AddDevice({ schedules, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 10322,
    username: "backup",
    auth_type: "key",
    password: "",
    enabled: true,
    schedule_id: "",
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
      await api.createDevice({
        name: form.name,
        host: form.host,
        port: Number(form.port),
        username: form.username,
        auth_type: form.auth_type,
        password: form.auth_type === "password" ? form.password : undefined,
        enabled: form.enabled,
        schedule_id: form.schedule_id ? Number(form.schedule_id) : null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка создания");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    form.name &&
    form.host &&
    form.username &&
    (form.auth_type === "key" || form.password);

  return (
    <Modal title="Добавить устройство" onClose={onClose}>
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          Включено (участвует в расписании)
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !canSubmit}>
          {busy ? "Сохранение…" : "Добавить"}
        </button>
      </form>
    </Modal>
  );
}

/* ----------------------------- CSV import ----------------------------- */
const CSV_TEMPLATE = "host,port,login,note\n10.0.0.1,10322,backup,Роутер офис\n10.0.0.2,,backup,Склад\n";

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
            backup), note</span>. Первая строка-заголовок опциональна.
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
