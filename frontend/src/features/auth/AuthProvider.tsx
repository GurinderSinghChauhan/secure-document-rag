import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../api/client";
import type { AuthResponse, User } from "../../api/types";
import { AuthContext, type AuthContextValue } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.setAuthListener((auth) => {
      setUser(auth?.user ?? null);
      setStatus(auth ? "authenticated" : "anonymous");
    });
    void api.refresh().catch(() => {
      api.clear(false);
      setUser(null);
      setStatus("anonymous");
    });
    return () => api.setAuthListener(() => undefined);
  }, []);

  const establish = useCallback(
    (auth: AuthResponse) => api.establish(auth),
    [],
  );
  const logout = useCallback(() => api.logout(), []);
  const value = useMemo(
    () => ({ status, user, establish, logout }),
    [status, user, establish, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
