import { render } from "preact";
import { App } from "./app";
import "./style.css";
import "./main-page.css";
import "@xterm/xterm/css/xterm.css";

render(<App />, document.getElementById("app"));
