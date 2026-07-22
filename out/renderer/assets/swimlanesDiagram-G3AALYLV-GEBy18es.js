import { c as createFlowDiagram, s as styles_default } from "./flowDiagram-23GEKE2U-B2i2pRr0.js";
import { _ as __name } from "./index-D5Y8FJZj.js";
import "./chunk-5VM5RSS4-BRFhpXFE.js";
import "./chunk-XXDRQBXY-9P6pIc_y.js";
import "./chunk-VR4S4FIN-3yBkwhs1.js";
import "./chunk-32BRIVSS-BHUyW5L8.js";
import "./channel-BPX3LUSt.js";
import "./index-BcmKhzCI.js";
var getStyles = /* @__PURE__ */ __name((options) => `${styles_default(options)}
  .swimlane.cluster rect {
    stroke: ${options.clusterBorder} !important;
  }
  [data-look="neo"].cluster rect {
    filter: none;
  }
`, "getStyles");
var styles_default2 = getStyles;
var diagram = createFlowDiagram({ defaultLayout: "swimlane", styles: styles_default2 });
export {
  diagram
};
