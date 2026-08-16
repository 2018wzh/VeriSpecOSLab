import {
  FluentProvider,
  MessageBar,
  MessageBarBody,
  Button,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function useSystemTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return theme;
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const theme = useSystemTheme();
  return (
    <FluentProvider
      theme={theme === "dark" ? webDarkTheme : webLightTheme}
      className="portal-provider"
    >
      {children}
    </FluentProvider>
  );
}

type BoundaryState = { error: Error | null };

export class PortalErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("VOS Portal rendering error", { error, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <PortalFatalError error={this.state.error} />;
  }
}

function PortalFatalError({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <main className="portal-fatal-error" role="alert">
      <MessageBar intent="error">
        <MessageBarBody>
          <strong>{t("Portal 页面无法继续加载")}</strong>
          <span>{error.message}</span>
        </MessageBarBody>
      </MessageBar>
      <p>{t("请刷新页面；如果问题仍然存在，请将此错误交给课程团队。")}</p>
      <Button appearance="primary" onClick={() => window.location.reload()}>
        {t("刷新页面")}
      </Button>
    </main>
  );
}
