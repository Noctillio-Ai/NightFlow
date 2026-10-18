import { render } from "preact";
import { App } from "./app";
import "./style.css";
import "./main-page.css";
import "./dashboard.css";
import "./dataset-browser.css";
import "@xterm/xterm/css/xterm.css";

render(<App />, document.getElementById("app"));
