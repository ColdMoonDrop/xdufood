import React from "react";
import ReactDOM from "react-dom/client";
import AdminApp from "./AdminApp";
import App from "./App";
import "./styles.css";

function getAppPath() {
  const base = import.meta.env.BASE_URL || "/";
  const pathname = window.location.pathname;
  if (base !== "/" && pathname.startsWith(base)) {
    return `/${pathname.slice(base.length)}`;
  }
  return pathname;
}

const Root = getAppPath().startsWith("/admin") ? AdminApp : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
