import React from "react";
import { createRoot } from "react-dom/client";

import Page from "../app/page";
import "@fontsource/urbanist/latin-700.css";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("mital root element missing");
createRoot(root).render(<Page />);
