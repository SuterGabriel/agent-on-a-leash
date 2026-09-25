import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { DesignSystemPage } from "@/pages/design-system";
import { NotFound } from "@/pages/not-found";
import { PrototypePage } from "@/pages/prototype";
import { RouteProvider } from "@/providers/router-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <BrowserRouter>
                <RouteProvider>
                    <Routes>
                        <Route path="/" element={<Navigate to="/prototype" replace />} />
                        <Route path="/design-system" element={<DesignSystemPage />} />
                        <Route path="/prototype" element={<PrototypePage />} />
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </RouteProvider>
            </BrowserRouter>
        </ThemeProvider>
    </StrictMode>,
);
