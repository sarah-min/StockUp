import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';

// The account (user id) signed in on this connection, from the public session table; undefined until it loads.
export function useMyUserId(): bigint | undefined {
  const { identity } = useSpacetimeDB();
  const [sessions] = useTable(tables.session);
  const me = identity?.toHexString();
  return sessions.find((row) => row.identity.toHexString() === me)?.userId;
}
