import { Component, type ReactNode } from "react";
import { revealWindow } from "../lib/windowFit";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch() {
    void revealWindow();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" data-tauri-drag-region>
        <strong>Grimview hit an error</strong>
        <pre>{this.state.error.stack ?? String(this.state.error)}</pre>
      </div>
    );
  }
}
