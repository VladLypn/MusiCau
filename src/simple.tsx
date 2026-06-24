import React from "react";
import ReactDOM from "react-dom/client";
import { SimpleTrainerApp } from "./apps/SimpleTrainerApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SimpleTrainerApp />
  </React.StrictMode>,
);
