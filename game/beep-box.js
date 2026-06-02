import "../vendor/audio-libs.js";
import { BeepBoxGame } from "./main.js";

if (!customElements.get("beep-box")) {
  customElements.define("beep-box", BeepBoxGame);
}
