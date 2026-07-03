import React, { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, getToken } from "./api.js";

// The xterm instance + WebSocket bridge. Fills its parent container.
// `credentials` (optional) => connect with a one-off login/password instead of
// the device's configured auth. `onConnFailed` fires on a failed connection.
export function TerminalView({ device, credentials = null, generation = 0, onConnFailed }) {
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
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch (_) {
        /* not mounted */
      }
      term.focus();
    });

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    let url = `${proto}://${window.location.host}/api/terminal/${device.id}?token=${encodeURIComponent(
      getToken()
    )}`;
    if (credentials) url += "&auth=password";
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    const enc = new TextEncoder();
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      // password mode: the server reads this credentials frame FIRST
      if (credentials) {
        ws.send(
          JSON.stringify({
            type: "credentials",
            username: credentials.username,
            password: credentials.password,
          })
        );
      }
      sendResize();
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(data));
      });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        // text frames that are JSON with a "type" are control messages
        let ctrl = null;
        try {
          const o = JSON.parse(ev.data);
          if (o && typeof o === "object" && o.type) ctrl = o;
        } catch (_) {
          /* plain terminal text */
        }
        if (ctrl) {
          if (ctrl.type === "conn_failed" && onConnFailed) onConnFailed(ctrl);
          return;
        }
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data));
      }
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
    // `generation` bump forces a full reconnect (Reconnect / auth change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, generation]);

  return <div className="term-view" ref={hostRef} />;
}

// Full-window terminal page, opened via window.open("/terminal/{id}").
export default function TerminalPage({ deviceId }) {
  const [device, setDevice] = useState(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [credentials, setCredentials] = useState(null); // active password creds
  const [showLogin, setShowLogin] = useState(false);
  const [hint, setHint] = useState("");
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");

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
        setFormUser(d.username);
        document.title = `SSH — ${d.name}`;
      })
      .catch((e) => setError(e.message));
  }, [deviceId]);

  function onConnFailed(ctrl) {
    // offer login/password unless we're already trying password auth
    if (!credentials) {
      setShowLogin(true);
      setHint(
        ctrl.auth
          ? "Ключ не установлен или не принят. Подключитесь по логину и паролю."
          : "Не удалось подключиться. Можно попробовать логин/пароль."
      );
    }
  }

  function connectWithPassword(e) {
    e.preventDefault();
    setCredentials({ username: formUser, password: formPass });
    setShowLogin(false);
    setHint("");
    setGeneration((g) => g + 1);
  }

  function connectWithKey() {
    setCredentials(null);
    setShowLogin(false);
    setHint("");
    setFormPass("");
    setGeneration((g) => g + 1);
  }

  return (
    <div className="term-page">
      <header className="term-page-head">
        <div className="brand">
          <span className="dot" />
          {device ? (
            <>
              SSH — {device.name}{" "}
              <span className="mono muted">
                {(credentials ? credentials.username : device.username)}@{device.host}:
                {device.port}
              </span>
              {credentials && <span className="tag ok">по паролю</span>}
            </>
          ) : (
            "SSH-терминал"
          )}
        </div>
        <div className="topbar-right">
          {device && (
            <>
              {credentials ? (
                <button className="btn small secondary" onClick={connectWithKey}>
                  По ключу
                </button>
              ) : (
                <button
                  className="btn small secondary"
                  onClick={() => setShowLogin((s) => !s)}
                >
                  По логину/паролю
                </button>
              )}
              <button
                className="btn small secondary"
                onClick={() => setGeneration((g) => g + 1)}
              >
                Переподключиться
              </button>
            </>
          )}
          <button className="btn small" onClick={() => window.close()}>
            Закрыть
          </button>
        </div>
      </header>

      {device && showLogin && (
        <form className="term-login-bar" onSubmit={connectWithPassword}>
          {hint && <span className="muted small">{hint}</span>}
          <input
            placeholder="логин"
            value={formUser}
            onChange={(e) => setFormUser(e.target.value)}
          />
          <input
            type="password"
            placeholder="пароль"
            value={formPass}
            autoFocus
            onChange={(e) => setFormPass(e.target.value)}
          />
          <button className="btn small" disabled={!formUser || !formPass}>
            Подключиться
          </button>
          <button
            type="button"
            className="btn small secondary"
            onClick={() => {
              setShowLogin(false);
              setHint("");
            }}
          >
            Отмена
          </button>
        </form>
      )}

      {error ? (
        <div className="center muted">{error}</div>
      ) : device ? (
        <TerminalView
          device={device}
          credentials={credentials}
          generation={generation}
          onConnFailed={onConnFailed}
        />
      ) : (
        <div className="center muted">Подключение…</div>
      )}
    </div>
  );
}
