import React from "react";

interface Props { children: React.ReactNode }
interface State { error: Error | null }

/** Catches render/runtime errors in a tab's subtree so one broken chart degrades
 *  to a readable message instead of white-screening the whole app. App keys this
 *  boundary by tab, so switching tabs remounts it and clears the error; the Try
 *  Again button resets it in place. Error boundaries must be class components. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface for debugging; the UI shows the message.
    console.error("Tab render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="offline" role="alert">
          <h2>Something went wrong on this tab</h2>
          <p>{this.state.error.message || String(this.state.error)}</p>
          <p style={{ color: "#8b949e", fontSize: 13 }}>
            Your other tabs still work. Switch tabs, or try again once the inputs
            change.
          </p>
          <button onClick={() => this.setState({ error: null })}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
