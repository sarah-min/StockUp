import { t } from "spacetimedb";
import { SenderError } from "spacetimedb/server";
import spacetimedb from "..";
import { sha256Hex } from "../helpers/sha256";

const USERNAME = /^[a-z0-9_]{3,20}$/;
const PROOF = /^[0-9a-f]{64}$/;
const HASH_ROUNDS = 2000;
const STARTING_BALANCE_CENTS = 100000n; // $1,000 of paper money, same as the old test user

function normalizeUsername(raw: string) {
  const username = raw.trim().toLowerCase();
  if (!USERNAME.test(username)) {
    throw new SenderError(
      "Usernames are 3-20 characters: letters, numbers or _",
    );
  }
  return username;
}

function requireProof(proof: string) {
  if (!PROOF.test(proof)) throw new SenderError("Invalid login request");
}

// Salted, iterated SHA-256 of the browser's PBKDF2 proof.
function hashProof(salt: string, proof: string) {
  let digest = sha256Hex(`${salt}:${proof}`);
  for (let i = 1; i < HASH_ROUNDS; i++) digest = sha256Hex(`${salt}:${digest}`);
  return digest;
}

function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newSalt(ctx: any) {
  let salt = "";
  for (let i = 0; i < 4; i++) {
    salt += Math.floor(ctx.random() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return salt;
}

// Bind the caller's identity to userId: one signed-in identity per account, one account per identity.
function startSession(ctx: any, userId: bigint, username: string) {
  const mine = ctx.db.userAuth.identity.find(ctx.sender);
  if (mine) ctx.db.userAuth.identity.delete(ctx.sender);
  const previous = ctx.db.userAuth.userId.find(userId);
  if (previous) {
    ctx.db.userAuth.identity.delete(previous.identity);
    ctx.db.session.identity.delete(previous.identity);
  }
  ctx.db.session.identity.delete(ctx.sender);

  ctx.db.userAuth.insert({ identity: ctx.sender, userId });
  ctx.db.session.insert({
    identity: ctx.sender,
    userId,
    username,
    signedInAt: ctx.timestamp,
  });
}

export const registerAccount = spacetimedb.reducer(
  {
    username: t.string(),
    passwordProof: t.string(),
  },
  (ctx, { username: rawUsername, passwordProof }) => {
    const username = normalizeUsername(rawUsername);
    requireProof(passwordProof);
    if (ctx.db.credential.username.find(username)) {
      throw new SenderError("That username is taken");
    }

    const user = ctx.db.user.insert({
      id: 0n,
      name: username,
      balanceCents: STARTING_BALANCE_CENTS,
      balanceStock: 0n,
      isMarket: false,
    });
    const salt = newSalt(ctx);
    ctx.db.credential.insert({
      username,
      userId: user.id,
      salt,
      passwordHash: hashProof(salt, passwordProof),
      createdAt: ctx.timestamp,
    });
    startSession(ctx, user.id, username);
  },
);

export const login = spacetimedb.reducer(
  {
    username: t.string(),
    passwordProof: t.string(),
  },
  (ctx, { username: rawUsername, passwordProof }) => {
    const failure = "Incorrect username or password";
    const username = rawUsername.trim().toLowerCase();
    const credential = USERNAME.test(username)
      ? ctx.db.credential.username.find(username)
      : undefined;
    if (!credential || !PROOF.test(passwordProof))
      throw new SenderError(failure);
    if (
      !sameHash(
        hashProof(credential.salt, passwordProof),
        credential.passwordHash,
      )
    ) {
      throw new SenderError(failure);
    }
    startSession(ctx, credential.userId, credential.username);
  },
);

export const logout = spacetimedb.reducer({}, (ctx) => {
  ctx.db.userAuth.identity.delete(ctx.sender);
  ctx.db.session.identity.delete(ctx.sender);
});
