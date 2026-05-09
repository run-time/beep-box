const defaultState = {
  level: 1,
  score: 0,
  bonus: 10,
  direction: "MIDDLE"
};

const appReducer = (state, action) => {
  let change = { ...state };
  switch (action.type) {
    case "CHANGE_VALUE":
      const parsed = parseInt(action.data.value, 10);
      change[action.data.which] = isNaN(parsed) ? 1 : parsed;
      break;
    case "INIT_LEVEL":
      break;
    case "HOME":
      change = { ...defaultState };
      break;
    case "INCREMENT":
      change.score += state.bonus;
      break;
    case "DECREMENT":
      change.score -= state.bonus;
      break;
    default:
      // eslint-disable-next-line no-console
      console.error(`ERROR: Unhandled action type: ${action.type}`);
  }

  log(action, state, change);

  return { ...change };
};

class Store {
  constructor(reducer, initialState) {
    this.state = initialState;
    this.reducer = reducer;
    this.listeners = [];
  }
  getState() {
    return this.state;
  }
  dispatch(action) {
    this.state = this.reducer(this.state, action);
    this.listeners.forEach((fn) => fn(this.state));
  }
  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}

const appStore = new Store(appReducer, defaultState);

/**
 * Adds event listeners to elements in a root (shadowRoot or element) based on a mapping.
 * @param {ShadowRoot|HTMLElement} root - The root to query within.
 * @param {Object} mapping - An object where keys are selectors and values are handler functions.
 * @param {string} event - The event type to listen for (default: 'click').
 */
const addMappedListeners = (root, mapping, event = "click") => {
  Object.entries(mapping).forEach(([selector, handler]) => {
    root.querySelector(selector)?.addEventListener(event, handler);
  });
};

// set to true during development for detailed action logs in the console
const loggingOn = true;
const log = (action, state, change) => {
  if (loggingOn) {
    const diff = {};
    for (const key in change) {
      if (change[key] !== state[key]) {
        diff[key] = { from: state[key], to: change[key] };
      }
    }
    const actionSummary = `${JSON.stringify(diff)}`;
    // eslint-disable-next-line no-console
    console.groupCollapsed(
      `%cACTION: %c ${action.type} %c  ${actionSummary}`,
      "color: #82A3DB;",
      "color: #fff; background: #82A3DB; font-weight: bold;",
      "color: #aaa;"
    );
    if (action.data) {
      // eslint-disable-next-line no-console
      console.log("%cPAYLOAD:", "color: #82A3DB;", action.data);
    }
    // eslint-disable-next-line no-console
    console.log("%cBEFORE: ", "color: #a77;", state);
    // eslint-disable-next-line no-console
    console.log("%cAFTER:  ", "color: #7a7;", change);
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
};

export { defaultState, appReducer, appStore, addMappedListeners };
