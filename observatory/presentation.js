(() => {
  "use strict";
  const plots = new Map();
  const narrow = () => window.innerWidth < 768;

  function axes(layout) {
    const result = {};
    for (const [key, axis] of Object.entries(layout)) {
      if (!/^[xy]axis\d*$/.test(key)) continue;
      const title = typeof axis.title === "string" ? { text: axis.title } : { ...axis.title };
      if (title.text) title.font = { ...title.font, size: narrow() ? 11 : 12 };
      result[key] = { ...axis, title, automargin: true,
        tickfont: { ...axis.tickfont, size: narrow() ? 11 : 12 } };
    }
    return result;
  }

  function presentation(layout, toolbar) {
    return {
      ...layout,
      ...axes(layout),
      title: { text: "" },
      font: { ...layout.font, color: getComputedStyle(document.body).color,
        family: getComputedStyle(document.body).fontFamily, size: narrow() ? 11 : 12 },
      colorway: ["#297fb8", "#d78328", "#9168be", "#289c87"],
      modebar: { ...layout.modebar, bgcolor: "rgba(0,0,0,0)", color: getComputedStyle(document.body).color,
        activecolor: document.body.classList.contains("quarto-dark") ? "#78b7df" : "#297fb8" },
      margin: { ...layout.margin, l: narrow() ? 58 : 68, r: 16,
        t: toolbar ? (window.innerWidth <= 360 ? 72 : 44) : 12 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"
    };
  }

  function render(method, element, data, layout, config) {
    const text = typeof layout.title === "string" ? layout.title : layout.title?.text;
    if (text) {
      let title = element.previousElementSibling;
      if (!title?.classList.contains("observatory-chart-title")) {
        title = document.createElement("h4");
        title.className = "observatory-chart-title";
        element.before(title);
      }
      title.textContent = text;
    }
    const toolbar = config.displayModeBar !== false;
    plots.set(element, toolbar);
    return Plotly[method](element, data, presentation(layout, toolbar),
      { ...config, displayModeBar: toolbar });
  }

  let timer;
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const [plot, toolbar] of plots) {
        if (!plot.isConnected || !plot.data) { plots.delete(plot); continue; }
        const style = presentation(plot.layout, toolbar);
        // Patch visual properties only, preserving selected ranges and traces.
        const update = { font: style.font, margin: style.margin, modebar: style.modebar };
        for (const key of Object.keys(axes(plot.layout))) {
          update[`${key}.title`] = style[key].title;
          update[`${key}.tickfont`] = style[key].tickfont;
        }
        Plotly.relayout(plot, update);
      }
    }, 100);
  }
  new MutationObserver(refresh).observe(document.body,
    { attributes: true, attributeFilter: ["class", "data-bs-theme"] });
  document.querySelectorAll("link.quarto-color-scheme").forEach(link => link.addEventListener("load", refresh));
  window.addEventListener("resize", refresh);
  window.ObservatoryCharts = {
    react: (...args) => render("react", ...args),
    newPlot: (...args) => render("newPlot", ...args)
  };
})();
