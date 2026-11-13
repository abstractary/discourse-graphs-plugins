import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./shared/tokens.css";
import "./canvas/canvas.css";
import "./context/context.css";
import "./library/library.css";
import "./holon/holon.css";
import "./search/search.css";
import "./run/run.css";
import "./profile/profile.css";
import "./zotero/zotero.css";
import "./papers/papers.css";
import "./grammar/grammar.css";
import { App as Canvas } from "./canvas/App.tsx";
import { App as Context } from "./context/App.tsx";
import { App as Library } from "./library/App.tsx";
import { App as Holon } from "./holon/App.tsx";
import { App as Boundary } from "./boundary/App.tsx";
import { App as Upload } from "./upload/App.tsx";
import { App as Welcome } from "./welcome/App.tsx";
import { App as Search } from "./search/App.tsx";
import { Find } from "./search/Find.tsx";
import { App as Run } from "./run/App.tsx";
import { App as ProfilePage } from "./profile/App.tsx";
import { App as Zotero } from "./zotero/App.tsx";
import { App as PaperMap } from "./papers/App.tsx";
import { App as Grammar } from "./grammar/App.tsx";
import { PeopleContext, type People } from "./shared/people.tsx";
import { connect } from "./shared/rpc.ts";

void connect().then((connection) => {
  // Initials anywhere, in any panel, lead to the same card and the same profile.
  const people: People = {
    card: (id) => connection.call("profile.card", { id }),
    open: (id) => void connection.call("profile.show", { id }).catch(() => undefined),
  };
  createRoot(document.getElementById("root")!).render(
    <PeopleContext.Provider value={people}>
    {connection.route.surface === "context" ? (
      <Context connection={connection} />
    ) : connection.route.surface === "canvases" ? (
      <Library connection={connection} />
    ) : connection.route.surface === "holon" ? (
      <Holon connection={connection} />
    ) : connection.route.surface === "boundary" ? (
      <Boundary connection={connection} />
    ) : connection.route.surface === "upload" ? (
      <Upload connection={connection} />
    ) : connection.route.surface === "welcome" ? (
      <Welcome connection={connection} />
    ) : connection.route.surface === "search" ? (
      <Search connection={connection} />
    ) : connection.route.surface === "find" ? (
      <Find connection={connection} />
    ) : connection.route.surface === "run" ? (
      <Run connection={connection} />
    ) : connection.route.surface === "zotero" ? (
      <Zotero connection={connection} />
    ) : connection.route.surface === "profile" ? (
      <ProfilePage connection={connection} />
    ) : connection.route.surface === "papers" ? (
      <PaperMap connection={connection} />
    ) : connection.route.surface === "grammar" ? (
      <Grammar connection={connection} />
    ) : (
      <ReactFlowProvider>
        <Canvas connection={connection} />
      </ReactFlowProvider>
    )}
    </PeopleContext.Provider>,
  );
});
