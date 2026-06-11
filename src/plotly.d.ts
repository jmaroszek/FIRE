declare module "plotly.js-dist-min";
declare module "react-plotly.js/factory" {
  import * as React from "react";
  import { PlotParams } from "react-plotly.js";
  export default function createPlotlyComponent(plotly: any): React.ComponentType<PlotParams>;
}
