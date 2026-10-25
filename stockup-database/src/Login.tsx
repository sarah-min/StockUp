import { useState, type FormEvent } from "react";
import { useReducer, useSpacetimeDB } from "spacetimedb/react";
import { reducers } from "./module_bindings";
import ThemeToggle from "./ThemeToggle";
import {
  MIN_PASSWORD_LENGTH,
  USERNAME_PATTERN,
  normalizeUsername,
  passwordProof,
} from "./auth/password";
import "./Login.css";

type Mode = "signin" | "register";

function errorText(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^.*?Error:\s*/, "") || "Something went wrong";
}

export default function Login() {
  const { isActive } = useSpacetimeDB();
  const login = useReducer(reducers.login);
  const registerAccount = useReducer(reducers.registerAccount);
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isRegister = mode === "register";
  const name = normalizeUsername(username);
  const usernameOk = USERNAME_PATTERN.test(name);
  const passwordOk = password.length >= MIN_PASSWORD_LENGTH;
  const confirmOk = !isRegister || confirm === password;
  const canSubmit =
    isActive &&
    !busy &&
    (isRegister
      ? usernameOk && passwordOk && confirmOk
      : name !== "" && password !== "");

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setConfirm("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const proof = await passwordProof(name, password);
      if (isRegister)
        await registerAccount({ username: name, passwordProof: proof });
      else await login({ username: name, passwordProof: proof });
      // The session row arrives through the subscription and AuthGate swaps in the game.
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                d="M4 17l5-5 4 4 7-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          StockUp
        </div>
        <ThemeToggle />
      </header>

      <section className="auth-grid">
        <div className="auth-pitch">
          <h1>
            Trade with agents.
            <span> Risk nothing.</span>
          </h1>
          <p>
            Start with $1,000 of paper money, deploy AI agents and turn profits
            into wishlist rewards.
          </p>
          <svg
            className="auth-chart"
            viewBox="0 0 320 120"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className="auth-chart-area"
              d="M0 96 L40 88 L80 92 L120 70 L160 76 L200 50 L240 58 L280 30 L320 18 L320 120 L0 120 Z"
            />
            <path
              className="auth-chart-line"
              d="M0 96 L40 88 L80 92 L120 70 L160 76 L200 50 L240 58 L280 30 L320 18"
            />
            <circle className="auth-chart-dot" cx="320" cy="18" r="4" />
          </svg>
          <ul className="auth-points">
            <li>Paper trades only. No real money moves.</li>
            <li>Your agents and trades are saved to your account.</li>
          </ul>
        </div>

        <form className="card auth-card" onSubmit={submit} noValidate>
          <div
            className="segmented"
            role="tablist"
            aria-label="Sign in or create an account"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              className={!isRegister ? "selected" : ""}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              className={isRegister ? "selected" : ""}
              onClick={() => switchMode("register")}
            >
              Create account
            </button>
          </div>

          <h2>{isRegister ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-sub">
            {isRegister
              ? "Pick a username and password to start playing."
              : "Sign in to pick up where you left off."}
          </p>

          <label className="auth-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. sarah_trades"
              autoFocus
            />
            {isRegister && username !== "" && !usernameOk && (
              <em className="auth-hint bad">
                3-20 characters: letters, numbers or _
              </em>
            )}
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div className="auth-password">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={
                  isRegister ? `At least ${MIN_PASSWORD_LENGTH} characters` : ""
                }
              />
              <button
                type="button"
                className="auth-reveal"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {isRegister && password !== "" && (
              <div className="auth-strength" aria-hidden="true">
                <i
                  style={{
                    width: `${Math.min(100, (password.length / 14) * 100)}%`,
                  }}
                  className={passwordOk ? "ok" : ""}
                />
              </div>
            )}
          </label>

          {isRegister && (
            <label className="auth-field">
              <span>Confirm password</span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
              />
              {confirm !== "" && !confirmOk && (
                <em className="auth-hint bad">Passwords don’t match</em>
              )}
            </label>
          )}

          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
            </div>
          )}

          <button className="primary auth-submit" disabled={!canSubmit}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                {isRegister ? "Creating account…" : "Signing in…"}
              </>
            ) : isRegister ? (
              "Create account →"
            ) : (
              "Sign in →"
            )}
          </button>

          <p className="auth-switch">
            {isRegister ? "Already have an account? " : "New to StockUp? "}
            <button
              type="button"
              onClick={() => switchMode(isRegister ? "signin" : "register")}
            >
              {isRegister ? "Sign in" : "Create one"}
            </button>
          </p>
          {!isActive && <p className="auth-status">Connecting to StockUp…</p>}
        </form>
      </section>
    </main>
  );
}
