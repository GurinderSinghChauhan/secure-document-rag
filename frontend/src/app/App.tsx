import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth, AuthGate } from "../features/auth";
import { RouteBoundary } from "./RouteBoundary";

const AskRoute = lazy(() => import("../routes/ask/AskRoute"));
const DashboardRoute = lazy(() => import("../routes/dashboard/DashboardRoute"));
const AdminRoute = lazy(() => import("../routes/admin/AdminRoute"));
const PlatformAdminRoute = lazy(
  () => import("../routes/platform-admin/PlatformAdminRoute"),
);

function RequireAuth({
  role,
  children,
}: {
  role?: "admin" | "super-admin";
  children: ReactNode;
}) {
  const { status, user } = useAuth();
  if (status === "loading")
    return (
      <div className="admin-loading" role="status">
        Restoring your secure session…
      </div>
    );
  if (!user) return <AuthGate />;
  if (role === "admin" && user.role !== "admin")
    return <Navigate to="/" replace />;
  if (role === "super-admin" && !user.is_super_admin)
    return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteBoundary>
        <Suspense
          fallback={
            <div className="admin-loading" role="status">
              Loading workspace…
            </div>
          }
        >
          <Routes>
            <Route
              path="/"
              element={
                <RequireAuth>
                  <DashboardRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/ask"
              element={
                <RequireAuth>
                  <AskRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth role="admin">
                  <AdminRoute />
                </RequireAuth>
              }
            />
            <Route
              path="/super-admin"
              element={
                <RequireAuth role="super-admin">
                  <PlatformAdminRoute />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    </BrowserRouter>
  );
}
