import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import OsrsClientApp from "./client/OsrsClientApp";
import "./index.css";
import { disposeServerConnection, initServerConnection } from "./network/ServerConnection";
import reportWebVitals from "./reportWebVitals";
import { Bzip2 } from "./rs/compression/Bzip2";
import { Gzip } from "./rs/compression/Gzip";
import { registerServiceWorker } from "./serviceWorkerRegistration";
import { installUiDiagnostic } from "./ui/UiScaleDiagnostic";

declare const module: any; // HMR typing

Bzip2.initWasm();
Gzip.initWasm();

// Opt-in URL flag to enable verbose resize debugging
try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("debugResize")) {
        (window as any).__RESIZE_DEBUG__ = true;
        // eslint-disable-next-line no-console
        console.log("[resize] debug enabled via ?debugResize");
    }
} catch {}

// UI scale diagnostic kit — available via __uiDiag in browser console
// Auto-dumps diagnostics on login. Also callable manually anytime.
installUiDiagnostic();

// NOTE: Server connection is initialized in OsrsClientApp after widget manager is ready

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
    // <React.StrictMode>
    <BrowserRouter>
        <OsrsClientApp />
    </BrowserRouter>,
    // </React.StrictMode>,
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

registerServiceWorker();

// During Fast Refresh/HMR, close app-level sockets before applying updates
try {
    if (typeof module !== "undefined" && module?.hot) {
        // React Fast Refresh lifecycle: prepare -> apply -> idle
        module.hot.addStatusHandler((status: string) => {
            if (status === "prepare") {
                try {
                    disposeServerConnection("hmr prepare");
                } catch {}
            } else if (status === "idle") {
                try {
                    initServerConnection();
                } catch {}
            }
        });
    }
} catch {}
