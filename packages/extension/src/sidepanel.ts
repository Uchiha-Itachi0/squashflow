/**
 * The side panel page's entry point. Plasmo builds it into `sidepanel.html`, using
 * `sidepanel.html` beside it as the page's template.
 */

import "./panel/panel.css";
import { PanelApp } from "./panel/app";

const root = document.getElementById("app");
if (root !== null) void new PanelApp(root).start();
