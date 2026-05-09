/**
 * ErrorMessage component for displaying user-friendly error messages with recovery suggestions.
 */

import type { ErrorRecovery } from "@/lib/agent/error-handler";
import { formatErrorForDisplay } from "@/lib/agent/error-handler";

interface ErrorMessageProps {
  recovery: ErrorRecovery;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorMessage({ recovery, onRetry, onDismiss }: ErrorMessageProps) {
  const display = formatErrorForDisplay(recovery);

  // Determine icon based on error type
  const getIcon = () => {
    const message = recovery.error.message.toLowerCase();
    if (message.includes("wallet") || message.includes("freighter")) return "🔌";
    if (message.includes("balance") || message.includes("insufficient")) return "💰";
    if (message.includes("slippage")) return "📊";
    if (message.includes("timeout") || message.includes("network")) return "🌐";
    if (message.includes("rejected") || message.includes("cancelled")) return "🚫";
    return "⚠️";
  };

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
      <div className="flex items-start gap-3">
        <span className="text-2xl" role="img" aria-label="error icon">
          {getIcon()}
        </span>
        <div className="flex-1 space-y-2">
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-100">{display.title}</h3>
            <p className="mt-1 text-sm text-red-800 dark:text-red-200">{display.message}</p>
          </div>

          {display.suggestion && (
            <div className="rounded bg-red-100 p-2 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">
              <strong>Suggestion:</strong> {display.suggestion}
            </div>
          )}

          <div className="flex items-center gap-2">
            {recovery.retryable && onRetry && (
              <button
                onClick={onRetry}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              >
                Try Again
              </button>
            )}

            {display.action && (
              <a
                href={display.action.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
              >
                {display.action.label} ↗
              </a>
            )}

            {onDismiss && (
              <button
                onClick={onDismiss}
                className="ml-auto rounded px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact error display for inline use in chat turns.
 */
export function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      ⚠️ {message}
    </div>
  );
}

/**
 * Retry status indicator for showing retry attempts.
 */
export function RetryStatus({ attempt, maxAttempts }: { attempt: number; maxAttempts: number }) {
  return (
    <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
      🔄 Retrying... (Attempt {attempt}/{maxAttempts})
    </div>
  );
}
