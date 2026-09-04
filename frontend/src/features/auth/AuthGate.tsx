import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { AuthResponse } from "../../api/types";
import {
  Button,
  FormField,
  Input,
  Icon,
  PasswordField,
  StatusMessage,
} from "../../components/ui";
import { useAuth } from "./context";

type Mode = "login" | "register" | "reset" | "invite";

export function AuthGate() {
  const { establish } = useAuth();
  const [mode, setMode] = useState<Mode>(() => {
    const query = new URLSearchParams(location.search);
    return query.has("reset")
      ? "reset"
      : query.has("invite")
        ? "invite"
        : "login";
  });
  const [message, setMessage] = useState(
    mode === "reset"
      ? "Choose a new password for your account."
      : mode === "invite"
        ? "Create your invited organization account."
        : "Use your organization account.",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("verify");
    if (!token) return;
    void api
      .authRequest<{ message: string }>("/v1/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token }),
      })
      .then((result) => {
        setMessage(result.message);
        history.replaceState({}, "", location.pathname);
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (mode === "login") {
        const result = await api.authRequest<AuthResponse>("/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
          }),
        });
        establish(result);
        return;
      }
      if (mode === "register") {
        const result = await api.authRequest<{ message: string }>(
          "/v1/auth/register",
          {
            method: "POST",
            body: JSON.stringify({
              display_name: form.get("display_name"),
              email: form.get("email"),
              password: form.get("password"),
              organization_name: form.get("organization_name"),
            }),
          },
        );
        setMessage(result.message);
        setMode("login");
        return;
      }
      const invited = mode === "invite";
      const params = new URLSearchParams(location.search);
      const result = await api.authRequest<{ message: string }>(
        invited ? "/v1/auth/accept-invitation" : "/v1/auth/reset-password",
        {
          method: "POST",
          body: JSON.stringify({
            token: params.get(invited ? "invite" : "reset"),
            password: form.get("password"),
            ...(invited ? { display_name: form.get("display_name") } : {}),
          }),
        },
      );
      setMessage(result.message);
      setMode("login");
      history.replaceState({}, "", location.pathname);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Authentication request failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword(email: string) {
    if (!email) {
      setMessage("Enter your email first.");
      return;
    }
    try {
      const result = await api.authRequest<{ message: string }>(
        "/v1/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email }) },
      );
      setMessage(result.message);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to request a reset link.",
      );
    }
  }

  return (
    <section className="auth-gate" aria-labelledby="auth-title">
      <div className="auth-layout">
        <aside className="auth-showcase" aria-label="About Arcline">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="check" />
            </span>
            <strong>Arcline</strong>
          </div>
          <div className="auth-showcase-copy">
            <span className="auth-eyebrow">
              Document intelligence workspace
            </span>
            <h2>Answers grounded in the documents you can access.</h2>
            <p>
              Search, process, and govern organizational knowledge from one
              focused workspace.
            </p>
          </div>
          <ul className="auth-benefits">
            <li>
              <Icon name="lock" />
              <span>Organization-scoped access</span>
            </li>
            <li>
              <Icon name="documents" />
              <span>Traceable document processing</span>
            </li>
            <li>
              <Icon name="message" />
              <span>Permission-aware retrieval</span>
            </li>
          </ul>
          <p className="auth-showcase-note">
            Self-hosted infrastructure · Role-based controls
          </p>
        </aside>
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="auth-mobile-logo" aria-hidden="true">
              <Icon name="check" />
            </span>
            <span className="section-kicker">Welcome to Arcline</span>
          </div>
          <h1 id="auth-title">
            {mode === "login"
              ? "Sign in to Arcline"
              : mode === "register"
                ? "Create your Arcline workspace"
                : mode === "invite"
                  ? "Accept your invitation"
                  : "Reset your password"}
          </h1>
          <StatusMessage>{message}</StatusMessage>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {(mode === "register" || mode === "invite") && (
              <FormField label="Your name">
                <Input
                  name="display_name"
                  autoComplete="name"
                  minLength={2}
                  required
                />
              </FormField>
            )}
            {(mode === "login" || mode === "register") && (
              <FormField label="Email">
                <Input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </FormField>
            )}
            <FormField label={mode === "login" ? "Password" : "New password"}>
              <PasswordField
                id="auth-password"
                name="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 12}
                required
              />
            </FormField>
            {mode === "register" && (
              <FormField label="Organization name">
                <Input name="organization_name" minLength={2} required />
              </FormField>
            )}
            <Button
              variant="primary"
              type="submit"
              busy={busy}
              busyLabel="Please wait…"
            >
              {mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create organization"
                  : "Continue"}
            </Button>
            {mode === "login" && (
              <Button
                variant="text"
                type="button"
                onClick={(event) => {
                  const value = new FormData(
                    event.currentTarget.form ?? undefined,
                  ).get("email");
                  void forgotPassword(typeof value === "string" ? value : "");
                }}
              >
                Forgot password?
              </Button>
            )}
          </form>
          {(mode === "login" || mode === "register") && (
            <div className="auth-alternate">
              <span>
                {mode === "login" ? "New to Arcline?" : "Already registered?"}
              </span>
              <Button
                variant="text"
                type="button"
                onClick={() =>
                  setMode((value) => (value === "login" ? "register" : "login"))
                }
              >
                {mode === "login" ? "Create an account" : "Sign in"}
                <Icon name="arrow-right" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
