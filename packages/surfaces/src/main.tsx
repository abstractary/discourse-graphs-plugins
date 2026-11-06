import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./shared/tokens.css";
import "./canvas/canvas.css";
import "./context/context.css";
import "./library/library.css";
import { App as Canvas } from "./canvas/App.tsx";
import { App as Context } from "./context/App.tsx";
import { App as Library } from "./library/App.tsx";
import { App as Upload } from "./upload/App.tsx";
import { App as Welcome } from "./welcome/App.tsx";
import { connect } from "./shared/rpc.ts";

void connect().then((connection) => {
  createRoot(document.getElementById("root")!).render(
    connection.route.surface === "context" ? (
      <Context connection={connection} />
    ) : connection.route.surface === "canvases" ? (
      <Library connection={connection} />
    ) : connection.route.surface === "upload" ? (
      <Upload connection={connection} />
    ) : connection.route.surface === "welcome" ? (
      <Welcome connection={connection} />
    ) : (
      <ReactFlowProvider>
        <Canvas connection={connection} />
      </ReactFlowProvider>
    ),
  );
});
