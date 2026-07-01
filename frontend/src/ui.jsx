import React from "react";

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleString();
}

export function fmtSize(n) {
  if (!n) return "0 B";
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${wide ? " wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Colored availability indicator: green online, red offline, grey unknown.
export function StatusDot({ online, lastCheck }) {
  const state = online === true ? "online" : online === false ? "offline" : "unknown";
  const label =
    state === "online" ? "онлайн" : state === "offline" ? "офлайн" : "не проверялось";
  const when = lastCheck ? `, проверено ${fmtDate(lastCheck)}` : "";
  return (
    <span
      className={`status-dot ${state}`}
      role="img"
      aria-label={label}
      title={`${label}${when}`}
    />
  );
}

export function CopyButton({ text, label = "Скопировать", className = "btn small" }) {
  const [done, setDone] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" className={className} onClick={copy}>
      {done ? "Скопировано ✓" : label}
    </button>
  );
}
