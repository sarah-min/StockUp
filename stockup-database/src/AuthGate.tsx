import type { ReactNode } from "react";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "./module_bindings";
import Login from "./Login";

export type Account = { username: string; onLogout: () => void };

// Shows the login page until this browser's identity has a session row in SpacetimeDB.
export default function AuthGate({
  children,
}: {
  children: (account: Account) => ReactNode;
}) {
  const { identity } = useSpacetimeDB();
  const [sessions, ready] = useTable(tables.session);
  const logout = useReducer(reducers.logout);
  const me = identity?.toHexString();
  const session = sessions.find((row) => row.identity.toHexString() === me);

  if (!session) {
    if (identity && !ready) {
      return (
        <div className="auth-loading" role="status">
          <span className="spinner" /> Loading…
        </div>
      );
    }
    return <Login />;
  }
  return (
    <>
      {children({
        username: session.username,
        onLogout: () => void logout(),
      })}
    </>
  );
}
