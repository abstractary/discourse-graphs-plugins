import { createRoot } from "react-dom/client";
import "../shared/tokens.css";
import "./pdf.css";
import { App } from "./App.tsx";
import { connect } from "../shared/rpc.ts";

// Its own bundle: pdf.js is large, and only this panel needs it.
void connect().then((connection) => {
  createRoot(document.getElementById("root")!).render(<App connection={connection} />);
});
