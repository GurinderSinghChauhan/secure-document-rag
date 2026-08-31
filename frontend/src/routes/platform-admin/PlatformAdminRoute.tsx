import { AppShell } from "../../components/layout/AppShell";
import { PlatformOversight } from "../../features/platform-oversight";

export default function PlatformAdminRoute() {
  return (
    <AppShell section="Platform Admin">
      <PlatformOversight />
    </AppShell>
  );
}
