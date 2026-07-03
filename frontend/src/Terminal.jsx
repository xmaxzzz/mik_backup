import React, { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getToken } from "./api.js";

// Full-screen-ish modal hosting an interactive SSH terminal for one device.
// Connects to /api/terminal/{id} over a WebSocket; keystrokes are sent as
// binary frames, resize as a JSON text frame; device output arrives as binary.
export default function Terminal({ device, onClose }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      theme: { background: "#0b0f18", foreground: "#c9d4ea", cursor: "#3b82f6" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    term.focus();
    termRef.current = term;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/terminal/${device.id}?token=${encodeURIComponent(
      getToken()
    )}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const enc = new TextEncoder();
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      sendResize();
      // keystrokes / pasted text -> binary frames
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(data));
      });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") term.write(ev.data);
      else term.write(new Uint8Array(ev.data));
    };
    ws.onclose = () => {
      term.write("\r\n\x1b[33m*** Соединение закрыто ***\x1b[0m\r\n");
    };
    ws.onerror = () => {
      term.write("\r\n\x1b[31m*** Ошибка WebSocket ***\x1b[0m\r\n");
    };

    const onResize = () => {
      try {
        fit.fit();
        sendResize();
      } catch (_) {
        /* not mounted */
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(hostRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      try {
        ws.close();
      } catch (_) {
        /* already closed */
      }
      term.dispose();
    };
  }, [device.id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal term-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            SSH — {device.name}{" "}
            <span className="muted small mono">
              {device.username}@{device.host}:{device.port}
            </span>
          </h2>
          <button className="link" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p className="muted small">
          Вставка: Ctrl+Shift+V или правой кнопкой мыши. Аутентификация —{" "}
          {device.auth_type === "key" ? "ключ приложения" : "сохранённый пароль"}.
        </p>
        <div className="term-host" ref={hostRef} />
      </div>
    </div>
  );
}
