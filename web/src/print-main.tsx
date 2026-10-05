import React from "react";
import { createRoot } from "react-dom/client";

import PrintPage from "../app/print/page";
import "@fontsource/urbanist/latin-700.css";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Print root element missing");
createRoot(root).render(<PrintPage />);
