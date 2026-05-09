import { HanSoloistGame } from "./main.js";

if (!customElements.get("han-soloist")) {
  customElements.define("han-soloist", HanSoloistGame);
}
