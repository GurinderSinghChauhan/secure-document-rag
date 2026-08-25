import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../../features/auth";

interface AppShellProps {
  section: "Ask" | "Admin" | "Platform Admin";
  children: ReactNode;
  sidebar?: ReactNode;
}

export function AppShell({ section, children, sidebar }: AppShellProps) {
  const { user, logout } = useAuth();
  const admin = user?.role === "admin";
  const superAdmin = Boolean(user?.is_super_admin);
  return (
    <div className={`app-shell ${section === "Ask" ? "" : "admin-shell"}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>Arcline</strong>
            <small>
              {section === "Ask"
                ? "Document intelligence"
                : section === "Admin"
                  ? "Admin console"
                  : "Platform console"}
            </small>
          </span>
        </div>
        <nav className="primary-nav">
          <NavLink className="nav-item" to="/" end>
            Ask
          </NavLink>
          {admin && (
            <NavLink className="nav-item" to="/admin">
              Admin
            </NavLink>
          )}
          {superAdmin && (
            <NavLink className="nav-item" to="/super-admin">
              Platform Admin
            </NavLink>
          )}
        </nav>
        {sidebar}
        <div className="sidebar-note">
          <span className="privacy-icon" aria-hidden="true">
            🔒
          </span>
          <div>
            <strong>Security by design</strong>
            <p>Access is isolated by organization and enforced by the API.</p>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true">
              ✓
            </span>
            <strong>Arcline</strong>
          </div>
          <div className="breadcrumb" aria-label="Current location">
            <span>Workspace</span>
            <span aria-hidden="true">›</span>
            <strong>{section}</strong>
          </div>
          <div className="admin-account">
            <div className="admin-account-copy">
              <strong>{user?.display_name}</strong>
              <small>
                {user?.organization.name} · {user?.role}
              </small>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void logout()}
            >
              Sign out
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
