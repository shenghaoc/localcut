import { ErrorBoundary as SolidErrorBoundary, type JSX } from 'solid-js';
import { RotateCcw } from 'lucide-solid';
import { Button } from './components/button';

interface ErrorBoundaryProps {
  children: JSX.Element;
}

function Fallback(props: { error: unknown; reset: () => void }) {
  const message =
    props.error instanceof Error
      ? props.error.message
      : typeof props.error === 'string'
        ? props.error
        : 'An unexpected error occurred.';
  return (
    <div class="error-boundary-fallback" role="alert">
      <div class="error-boundary-content">
        <h2 class="error-boundary-title">Something went wrong</h2>
        <p class="error-boundary-message">{message}</p>
        <Button variant="default" onClick={() => window.location.reload()}>
          <RotateCcw size={14} aria-hidden="true" />
          Reload
        </Button>
      </div>
    </div>
  );
}

export function AppErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <SolidErrorBoundary fallback={(error: unknown, reset: () => void) => <Fallback error={error} reset={reset} />}>
      {props.children}
    </SolidErrorBoundary>
  );
}
