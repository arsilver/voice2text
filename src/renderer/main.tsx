import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import { App } from "./App";
import "./globals.css";
import { reportStartupStageOnce } from "./startup-heartbeat";

reportStartupStageOnce("dom-ready");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
