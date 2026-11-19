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
    new URLSearchParams(location.search).has("google_error")
      ? "Google sign-in failed. Use an active, verified organization account with a Gmail or Google Workspace address, or sign in with your password."
      : mode === "reset"
        ? "Choose a new password for your account."
        : mode === "invite"
          ? "Create your invited organization account."
          : "Use your organization account.",
  );
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .authRequest<{ enabled: boolean }>("/v1/auth/google/config")
      .then((result) => {
        if (active) setGoogleEnabled(result.enabled);
      })
      .catch(() => undefined);
    const params = new URLSearchParams(location.search);
    if (params.has("google_error")) {
      params.delete("google_error");
      history.replaceState(
        {},
        "",
        location.pathname + (params.size ? `?${params}` : ""),
      );
    }
    return () => {
      active = false;
    };
  }, []);

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
              Enterprise knowledge operations
            </span>
            <h2>
              Answer critical questions from the documents that matter most.
            </h2>
            <p>
              Bring policy-controlled document intelligence into one governed
              workspace so teams can search, classify, and act on trusted
              information without leaving operational guardrails behind.
            </p>
          </div>
          <div className="auth-trust-row" aria-label="Product strengths">
            <span>Role-based access</span>
            <span>Audit-friendly</span>
            <span>Self-hosted</span>
          </div>
          <ul className="auth-benefits">
            <li>
              <Icon name="lock" />
              <span>Policy-enforced access boundaries</span>
            </li>
            <li>
              <Icon name="documents" />
              <span>Traceable document processing</span>
            </li>
            <li>
              <Icon name="message" />
              <span>Permission-aware answer generation</span>
            </li>
          </ul>
          <div className="auth-showcase-footer" aria-label="Platform metrics">
            <div className="auth-stat">
              <strong>24/7</strong>
              <span>Human-in-the-loop workflows</span>
            </div>
            <div className="auth-stat">
              <strong>100%</strong>
              <span>Organization scoping</span>
            </div>
          </div>
          <p className="auth-showcase-note">
            Self-hosted infrastructure · Role-based controls · v
            {__APP_VERSION__}
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
          {mode === "login" && googleEnabled && (
            <div className="auth-social">
              <Button
                className="google-sign-in"
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  window.location.assign("/v1/auth/google/start");
                }}
              >
                <svg
                  className="google-sign-in-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.61 0-4.83-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.38 13.93A6 6 0 0 1 6.07 12c0-.67.11-1.32.31-1.93V7.48H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.52l3.34-2.59Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.95c1.47 0 2.78.51 3.82 1.52l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.34 2.59C7.17 7.71 9.39 5.95 12 5.95Z"
                  />
                </svg>
                <span>Continue with Google</span>
              </Button>
              <div className="auth-divider">
                <span>or sign in with email</span>
              </div>
            </div>
          )}
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
