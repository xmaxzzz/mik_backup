import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api.js";
import { Modal } from "./ui.jsx";

const PRESETS = [
  { label: "Ежедневно в 03:00", cron: "0 3 * * *" },
  { label: "Каждые 6 часов", cron: "0 */6 * * *" },
  { label: "Раз в час", cron: "0 * * * *" },
  { label: "По понедельникам 02:00", cron: "0 2 * * 1" },
];

export default function Schedules() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // schedule object or {} for new
  const [managing, setManaging] = useState(null); // schedule whose devices we edit

  const refresh = useCallback(async () => {
    try {
      setItems(await api.listSchedules());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function remove(s) {
    if (
      !window.confirm(
        `Удалить расписание «${s.name}»? Привязанные устройства станут «Без расписания».`
      )
    )
      return;
    setError("");
    try {
      await api.deleteSchedule(s.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggle(s) {
    setError("");
    try {
      await api.updateSchedule(s.id, { enabled: !s.enabled });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Расписания</h2>
        <button className="btn" onClick={() => setEditing({})}>
          + Новое расписание
        </button>
      </div>
      {error && <div className="error banner">{error}</div>}
      {items.length === 0 ? (
        <p className="muted">Пока нет расписаний.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Cron</th>
              <th>Устройств</th>
              <th>Включено</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.cron}</td>
                <td>{s.device_count}</td>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => toggle(s)}
                    />
                    <span>{s.enabled ? "да" : "нет"}</span>
                  </label>
                </td>
                <td className="actions">
                  <button className="btn small" onClick={() => setManaging(s)}>
                    Устройства
                  </button>
                  <button className="btn small secondary" onClick={() => setEditing(s)}>
                    Изменить
                  </button>
                  <button className="btn small danger" onClick={() => remove(s)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <ScheduleForm
          schedule={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {managing && (
        <ScheduleDevices
          schedule={managing}
          onClose={() => setManaging(null)}
          onSaved={async () => {
            setManaging(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

// Bulk-manage which devices use a schedule: checked = attached to it.
function ScheduleDevices({ schedule, onClose, onSaved }) {
  const [devices, setDevices] = useState(null);
  const [checked, setChecked] = useState({}); // id -> bool
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [all, mine] = await Promise.all([
          api.listDevices(),
          api.getScheduleDevices(schedule.id),
        ]);
        setDevices(all);
        const init = {};
        const mineSet = new Set(mine);
        all.forEach((d) => (init[d.id] = mineSet.has(d.id)));
        setChecked(init);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [schedule.id]);

  const q = filter.trim().toLowerCase();
  const shown = (devices || []).filter(
    (d) =>
      !q ||
      [d.name, d.host, d.comment].some((v) => v && v.toLowerCase().includes(q))
  );
  const selectedCount = Object.values(checked).filter(Boolean).length;

  function setAllShown(value) {
    setChecked((c) => {
      const next = { ...c };
      shown.forEach((d) => (next[d.id] = value));
      return next;
    });
  }

  async function save() {
    setError("");
    setBusy(true);
    try {
      const ids = Object.keys(checked)
        .filter((id) => checked[id])
        .map(Number);
      await api.setScheduleDevices(schedule.id, ids);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Устройства расписания «${schedule.name}»`} onClose={onClose} wide>
      <p className="muted small">
        Отмеченные роутеры будут привязаны к этому расписанию; снятые —
        отвязаны (станут «Без расписания»). Устройства на других расписаниях не
        затрагиваются, пока вы их не отметите здесь.
      </p>
      <div className="filter-row">
        <input
          className="filter-input"
          placeholder="Поиск по имени или IP…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted small">выбрано {selectedCount}</span>
        <button type="button" className="link" onClick={() => setAllShown(true)}>
          отметить все{q ? " (по фильтру)" : ""}
        </button>
        <button type="button" className="link" onClick={() => setAllShown(false)}>
          снять
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {devices === null ? (
        <p className="muted small">Загрузка…</p>
      ) : (
        <div className="table-scroll" style={{ maxHeight: 340 }}>
          <table>
            <tbody>
              {shown.map((d) => (
                <tr key={d.id}>
                  <td style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={!!checked[d.id]}
                      onChange={(e) =>
                        setChecked((c) => ({ ...c, [d.id]: e.target.checked }))
                      }
                    />
                  </td>
                  <td>
                    {d.name}
                    {d.schedule_name && d.schedule_id !== schedule.id && (
                      <span className="muted small"> · сейчас: {d.schedule_name}</span>
                    )}
                  </td>
                  <td className="mono">{d.host}:{d.port}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Ничего не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <button className="btn" disabled={busy || devices === null} onClick={save}>
        {busy ? "Сохранение…" : "Сохранить"}
      </button>
    </Modal>
  );
}

function ScheduleForm({ schedule, onClose, onSaved }) {
  const isNew = !schedule.id;
  const [name, setName] = useState(schedule.name || "");
  const [cron, setCron] = useState(schedule.cron || "0 3 * * *");
  const [enabled, setEnabled] = useState(
    schedule.enabled === undefined ? true : schedule.enabled
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isNew) await api.createSchedule({ name, cron, enabled });
      else await api.updateSchedule(schedule.id, { name, cron, enabled });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? "Новое расписание" : "Изменить расписание"} onClose={onClose}>
      <form onSubmit={submit}>
        <label>Название</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <label>Cron (5 полей: мин час день месяц день-недели)</label>
        <input className="mono" value={cron} onChange={(e) => setCron(e.target.value)} />
        <div className="presets">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.cron}
              className="chip"
              onClick={() => setCron(p.cron)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Включено
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !name || !cron}>
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
      </form>
    </Modal>
  );
}
