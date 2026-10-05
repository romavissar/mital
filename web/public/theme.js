/* global localStorage, document, matchMedia */
const appearance = localStorage.getItem("mital-appearance");
document.documentElement.dataset.theme = appearance === "dark" || (appearance !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
