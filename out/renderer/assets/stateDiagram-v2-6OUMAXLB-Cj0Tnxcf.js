import { s as styles_default, b as stateRenderer_v3_unified_default, a as stateDiagram_default, S as StateDB } from "./chunk-EX3LRPZG-Bbp-lh55.js";
import { _ as __name } from "./index-D5Y8FJZj.js";
import "./chunk-XXDRQBXY-9P6pIc_y.js";
import "./chunk-VR4S4FIN-3yBkwhs1.js";
import "./chunk-32BRIVSS-BHUyW5L8.js";
import "./index-BcmKhzCI.js";
var diagram = {
  parser: stateDiagram_default,
  get db() {
    return new StateDB(2);
  },
  renderer: stateRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.state) {
      cnf.state = {};
    }
    cnf.state.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
