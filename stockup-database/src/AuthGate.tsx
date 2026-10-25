import { useEffect, useState, type ReactNode } from "react";
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
  // The session subscription never becomes ready if the database is missing the table
  // (e.g. the module with the account reducers hasn't been published yet). Say so instead of spinning forever.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setStalled(true), 8000);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!session) {
    if (!ready && stalled) {
      return (
        <div className="auth-loading" role="alert">
          <div className="auth-stalled">
            <strong>Can’t load accounts from SpacetimeDB.</strong>
            <span>
              If you just pulled this branch, publish the module first:{" "}
              <code>npm run spacetime:publish</code>, then reload.
            </span>
          </div>
        </div>
      );
    }
    if (!ready) {
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
