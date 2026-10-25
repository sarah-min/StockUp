import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

const loginReducer = vi.fn((_args: unknown) => Promise.resolve());
const registerReducer = vi.fn((_args: unknown) => Promise.resolve());

vi.mock("spacetimedb/react", () => ({
  useSpacetimeDB: () => ({
    isActive: true,
    identity: undefined,
    getConnection: () => null,
  }),
  useReducer: (
    reducer: { name?: string; accessorName?: string } | undefined,
  ) => {
    const name = String(reducer?.accessorName ?? reducer?.name ?? "");
    return /register/i.test(name) ? registerReducer : loginReducer;
  },
}));

describe("Login page", () => {
  beforeEach(() => {
    loginReducer.mockClear();
    registerReducer.mockClear();
  });

  it("signs in with a password proof, never the password", async () => {
    const user = userEvent.setup();
    render(<Login />);
    await user.type(screen.getByLabelText(/username/i), "Sarah_Trades");
    await user.type(screen.getByLabelText(/^password/i), "correct horse");
    await user.click(screen.getByRole("button", { name: /^sign in →/i }));
    await vi.waitFor(() => expect(loginReducer).toHaveBeenCalledTimes(1));
    const args = loginReducer.mock.calls[0][0] as unknown as {
      username: string;
      passwordProof: string;
    };
    expect(args.username).toBe("sarah_trades");
    expect(args.passwordProof).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("correct horse");
  });

  it("validates registration before creating an account", async () => {
    const user = userEvent.setup();
    render(<Login />);
    await user.click(screen.getByRole("tab", { name: /create account/i }));
    await user.type(screen.getByLabelText(/username/i), "ab");
    await user.type(screen.getByLabelText(/^password/i), "short");
    expect(
      screen.getByRole("button", { name: /create account →/i }),
    ).toBeDisabled();
    expect(screen.getByText(/3-20 characters/i)).toBeInTheDocument();
  });
});
