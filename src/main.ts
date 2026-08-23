import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { installGlobalErrorHandlers } from "./lib/ui/errorLog.svelte";

// Installed before mounting, so a failure during the first render is caught too.
installGlobalErrorHandlers();

const target = document.getElementById("app");
if (!target) throw new Error("#app mount point missing from index.html");

export default mount(App, { target });
