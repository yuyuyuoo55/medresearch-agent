import "antd/dist/reset.css";
import { App as AntApp, ConfigProvider, theme } from "antd";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#6b7352",
          colorSuccess: "#6b7352",
          colorWarning: "#b3894b",
          colorError: "#aa5a4e",
          colorInfo: "#6b7352",
          colorBgBase: "#f8f5ef",
          colorBgContainer: "#fffdf9",
          colorText: "#302f2b",
          colorTextSecondary: "#76736a",
          colorBorder: "#e3ded4",
          borderRadius: 6,
          fontFamily:
            "'Research Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
          fontFamilyCode:
            "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
        },
        components: {
          Button: {
            controlHeightLG: 46,
            primaryShadow: "none"
          },
          Input: {
            activeBorderColor: "#6b7352",
            hoverBorderColor: "#555e3e"
          }
        }
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
