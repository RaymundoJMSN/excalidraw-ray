import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-V7JOEXUC-BOWiE1bS.js";
import { _ as __name } from "./index-D5Y8FJZj.js";
import "./chunk-5VM5RSS4-BRFhpXFE.js";
import "./chunk-XXDRQBXY-9P6pIc_y.js";
import "./chunk-VR4S4FIN-3yBkwhs1.js";
import "./chunk-32BRIVSS-BHUyW5L8.js";
import "./index-BcmKhzCI.js";
var diagram = {
  parser: classDiagram_default,
  get db() {
    return new ClassDB();
  },
  renderer: classRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.class) {
      cnf.class = {};
    }
    cnf.class.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
