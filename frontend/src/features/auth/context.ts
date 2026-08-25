import { createContext, useContext } from "react";
import type { AuthResponse, User } from "../../api/types";

export interface AuthContextValue {
  status: "loading" | "authenticated" | "anonymous";
  user: User | null;
  establish: (auth: AuthResponse) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
