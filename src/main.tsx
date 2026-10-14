import React, { StrictMode, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Catch and handle global window errors
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    // ResizeObserver loop notifications are standard benign browser notifications during fast resizes
    if (
      event.message &&
      (event.message.includes('ResizeObserver loop completed with undelivered notifications') ||
       event.message.includes('ResizeObserver loop limit exceeded'))
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    console.warn('[Application Error Caught]:', event.message || event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Unhandled Rejection Caught]:', event.reason);
  });
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends (React.Component as any) {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React Error Boundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl space-y-4">
            <h2 className="text-xl font-bold text-red-400">Адбылася памылка адлюстравання</h2>
            <p className="text-sm text-slate-400">
              Праграма сутыкнулася з неспадзяванай памылкай. Вы можаце аднавіць працу або перазагрузіць старонку.
            </p>
            {this.state.error && (
              <div className="bg-slate-950 p-3 rounded text-xs font-mono text-left text-red-300 overflow-x-auto max-h-36 border border-red-900/40">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition cursor-pointer"
              >
                Паспрабаваць зноў
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition cursor-pointer"
              >
                Перазагрузіць старонку
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}


