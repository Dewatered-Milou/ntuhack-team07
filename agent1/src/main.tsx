import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/montserrat/latin-800.css";

import App from "./App";
import "./tailwind.css";
import "../public/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
