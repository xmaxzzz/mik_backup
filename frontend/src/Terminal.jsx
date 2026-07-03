import React, { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, getToken } from "./api.js";

// The xterm instance + WebSocket bridge. Fills its parent container.
// Keystrokes/paste are sent as binary frames, resize as a JSON text frame;
// device output arrives as binary frames.
export function TerminalView({ device, generation = 0 }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      theme: { background: "#0b0f18", foreground: "#c9d4ea", cursor: "#3b82f6" },
      scrollback: 8000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    // let layout settle before the first fit (real window has real size)
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch (_) {
        /* not mounted */
      }
      term.focus();
    });

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/api/terminal/${device.id}?token=${encodeURIComponent(
      getToken()
    )}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    const enc = new TextEncoder();
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      sendResize();
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(data));
      });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") term.write(ev.data);
      else term.write(new Uint8Array(ev.data));
    };
    ws.onclose = () =>
      term.write("\r\n\x1b[33m*** Соединение закрыто ***\x1b[0m\r\n");
    ws.onerror = () => term.write("\r\n\x1b[31m*** Ошибка WebSocket ***\x1b[0m\r\n");

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
    // `generation` bump forces a full reconnect (Reconnect button)
  }, [device.id, generation]);

  return <div className="term-view" ref={hostRef} />;
}

// Full-window terminal page, opened via window.open("/terminal/{id}").
export default function TerminalPage({ deviceId }) {
  const [device, setDevice] = useState(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      setError("Нет активной сессии. Войдите в основном окне и откройте терминал заново.");
      return;
    }
    api
      .listDevices()
      .then((list) => {
        const d = list.find((x) => x.id === deviceId);
        if (!d) {
          setError("Устройство не найдено.");
          return;
        }
        setDevice(d);
        document.title = `SSH — ${d.name}`;
      })
      .catch((e) => setError(e.message));
  }, [deviceId]);

  return (
    <div className="term-page">
      <header className="term-page-head">
        <div className="brand">
          <span className="dot" />
          {device ? (
            <>
              SSH — {device.name}{" "}
              <span className="mono muted">
                {device.username}@{device.host}:{device.port}
              </span>
            </>
          ) : (
            "SSH-терминал"
          )}
        </div>
        <div className="topbar-right">
          <span className="muted small">вставка: Ctrl+Shift+V / правая кнопка</span>
          {device && (
            <button
              className="btn small secondary"
              onClick={() => setGeneration((g) => g + 1)}
            >
              Переподключиться
            </button>
          )}
          <button className="btn small" onClick={() => window.close()}>
            Закрыть
          </button>
        </div>
      </header>
      {error ? (
        <div className="center muted">{error}</div>
      ) : device ? (
        <TerminalView device={device} generation={generation} />
      ) : (
        <div className="center muted">Подключение…</div>
      )}
    </div>
  );
}
