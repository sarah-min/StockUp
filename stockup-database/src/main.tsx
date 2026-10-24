import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { Identity } from "spacetimedb";
import { SpacetimeDBProvider } from "spacetimedb/react";
import { DbConnection, ErrorContext, tables } from "./module_bindings/index.ts";

const savedToken = localStorage.getItem("spacetimedb_token");

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? "ws://localhost:3000";
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? "stockup-db";
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const onConnect = (conn: DbConnection, identity: Identity, token: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  console.log(
    "Connected to SpacetimeDB with identity:",
    identity.toHexString(),
  );
};

const onDisconnect = () => {
  console.log("Disconnected from SpacetimeDB");
};

const onConnectError = (_ctx: ErrorContext, err: Error) => {
  console.log("Error connecting to SpacetimeDB:", err);
};

let connectionBuilder = DbConnection.builder()
  .withUri("wss://maincloud.spacetimedb.com")
  .withDatabaseName("stockup-db")
  .withAutomaticReconnect()
  .onConnect((conn, identity, token) => {
    console.log("Connected to SpacetimeDB:", identity.toHexString());

    localStorage.setItem("spacetimedb_token", token);

    conn
      .subscriptionBuilder()
      .subscribe([
        tables.user,
        tables.agent,
        tables.trade,
        tables.agentPosition,
        tables.marketPrice,
      ]);
  })
  .onConnectError((_ctx, error) => {
    console.error("SpacetimeDB connection failed:", error);
  });

if (savedToken) {
  connectionBuilder = connectionBuilder.withToken(savedToken);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
