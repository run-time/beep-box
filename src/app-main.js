// app-main.js
import { appStore, addMappedListeners } from "./app-state.js";
import "./components/han-soloist.js";

class AppMain extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.render();
    this.addListeners();
    this.unsubscribe = appStore.subscribe(() => {
      this.render();
      this.addListeners();
    });
  }
  disconnectedCallback() {
    this.unsubscribe && this.unsubscribe();
  }
  addListeners() {
    addMappedListeners(this.shadowRoot, {
      "#counter-output": () => appStore.dispatch({ type: "CHANGE_THEME" }),
      "#increment-button": () => appStore.dispatch({ type: "INCREMENT" }),
      "#decrement-button": () => appStore.dispatch({ type: "DECREMENT" }),
      "#reset-button": () => appStore.dispatch({ type: "RESET" })
    });
  }
  render() {
    const state = appStore.getState();

    const componentStyle = `
      <style>
        .container {
          font-family: sans-serif;
          padding: 16px;
          max-width: 400px;
          text-align: center;
          margin: auto;
        }
        .state-view {
          margin-top: 24px;
          background: #111;
          color: #0ff;
          border-radius: 8px;
          padding: 12px;
          font-size: 1rem;
          box-shadow: 0 0 8px #00bfff44;
          word-break: break-all;
        }
      </style>
    `;

    const stateView = `
      <div class="state-view">
        <strong>App State:</strong><br/>
        <pre>${JSON.stringify(state, null, 2)}</pre>
      </div>
    `;

    const componentDom = `
      <han-soloist></han-soloist>
    `;

    this.shadowRoot.innerHTML = `${componentStyle}${componentDom}`;
  }
}

customElements.define("app-main", AppMain);
