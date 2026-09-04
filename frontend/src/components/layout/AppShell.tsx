import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../../features/auth";
import { Button, Icon, type IconName } from "../ui";

interface AppShellProps {
  section: "Dashboard" | "Insights" | "Ask" | "Admin" | "Platform Admin";
  children: ReactNode;
  sidebar?: ReactNode;
}

export function AppShell({ section, children, sidebar }: AppShellProps) {
  const { user, logout } = useAuth();
  const admin = user?.role === "admin";
  const superAdmin = Boolean(user?.is_super_admin);
  const initials = user?.display_name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const navItems: Array<{
    icon: IconName;
    label: string;
    to: string;
    end?: boolean;
    visible: boolean;
  }> = [
    {
      icon: "dashboard",
      label: "Dashboard",
      to: "/",
      end: true,
      visible: true,
    },
    { icon: "message", label: "Ask", to: "/ask", visible: true },
    { icon: "documents", label: "Admin", to: "/admin", visible: admin },
    {
      icon: "platform",
      label: "Platform Admin",
      to: "/super-admin",
      visible: superAdmin,
    },
  ];
  return (
    <div className={`app-shell ${section === "Ask" ? "" : "admin-shell"}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span>
            <strong>Arcline</strong>
            <small>
              {section === "Ask"
                ? "Document intelligence"
                : section === "Insights"
                  ? "Intelligence insights"
                  : section === "Dashboard"
                    ? "Intelligence dashboard"
                    : section === "Admin"
                      ? "Admin console"
                      : "Platform console"}
            </small>
          </span>
        </div>
        <nav className="primary-nav">
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <NavLink
                className="nav-item"
                to={item.to}
                end={item.end}
                key={item.to}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
        </nav>
        {sidebar}
        <div className="sidebar-footer">
          <div className="sidebar-note">
            <span className="privacy-icon" aria-hidden="true">
              <Icon name="lock" />
            </span>
            <div>
              <strong>Organization scoped</strong>
              <p>
                Document access is enforced by the API for your current role.
              </p>
            </div>
          </div>
          <small className="product-version" title={`Build ${__APP_COMMIT__}`}>
            Arcline v{__APP_VERSION__}
          </small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="check" />
            </span>
            <strong>Arcline</strong>
          </div>
          <div className="breadcrumb" aria-label="Current location">
            <span>Workspace</span>
            <span aria-hidden="true">›</span>
            <strong>{section}</strong>
          </div>
          <div className="admin-account">
            <span className="account-avatar" aria-hidden="true">
              {initials || "A"}
            </span>
            <div className="admin-account-copy">
              <strong>{user?.display_name}</strong>
              <small>
                {user?.organization.name} <span aria-hidden="true">·</span>{" "}
                <span className="account-role">{user?.role}</span>
              </small>
            </div>
            <Button
              variant="secondary"
              type="button"
              onClick={() => void logout()}
            >
              <Icon name="sign-out" />
              <span>Sign out</span>
            </Button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <NavLink
                className="nav-item"
                to={item.to}
                end={item.end}
                key={item.to}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
