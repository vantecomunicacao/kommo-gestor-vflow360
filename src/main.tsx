import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installGlobalErrorReporter } from "./lib/errorReporter";
import ErrorBoundary from "./components/ErrorBoundary";

installGlobalErrorReporter();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
