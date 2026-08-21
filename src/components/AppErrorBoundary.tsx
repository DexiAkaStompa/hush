import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { BrandMark } from "./BrandMark";

type Props = { children: ReactNode };
type State = { failed: boolean; message: string };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof Error ? error.message : "Errore dell’interfaccia non specificato",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Hush UI recovery", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-crash" role="alert">
        <section>
          <BrandMark size={44} title="Hush" />
          <span className="eyebrow"><ShieldAlert size={14} /> recupero interfaccia</span>
          <h1>Hush non è riuscito a mostrare questa schermata.</h1>
          <p>{this.state.message}</p>
          <button onClick={() => window.location.reload()}><RefreshCw size={17} /> Ricarica Hush</button>
        </section>
      </main>
    );
  }
}
