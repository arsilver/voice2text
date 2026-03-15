import React from "react";
import ReactDOM from "react-dom/client";

import { WidgetApp } from "./WidgetApp";
import "@renderer/globals.css";

ReactDOM.createRoot(document.getElementById("widget-root") as HTMLElement).render(
  <React.StrictMode>
    <WidgetApp />
  </React.StrictMode>
);

