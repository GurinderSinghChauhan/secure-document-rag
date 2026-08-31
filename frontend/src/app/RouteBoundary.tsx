import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../components/ui";

export class RouteBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route failed", error, info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <main className="content">
          <section className="empty-state">
            <h1>This section could not be displayed</h1>
            <p>{this.state.error.message}</p>
            <Button variant="primary" onClick={() => location.reload()}>
              Reload application
            </Button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
