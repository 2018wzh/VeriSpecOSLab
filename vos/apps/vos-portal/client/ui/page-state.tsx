import { Button, MessageBar, MessageBarBody, Skeleton, SkeletonItem } from "@fluentui/react-components";

export function PageLoading({ label }: { label: string }) {
  return <div className="page-loading" role="status" aria-live="polite" aria-label={label}>
    <Skeleton><SkeletonItem shape="rectangle" /><SkeletonItem shape="rectangle" /><SkeletonItem shape="rectangle" /></Skeleton>
  </div>;
}

export function PageError({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return <MessageBar intent="error" role="alert"><MessageBarBody>{message}</MessageBarBody><Button appearance="secondary" onClick={onRetry}>{retryLabel}</Button></MessageBar>;
}
