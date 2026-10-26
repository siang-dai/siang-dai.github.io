(() => {
  "use strict";
  const root = document.getElementById("vip-ii");
  if (!root) return;
  const el = id => document.getElementById(`vip-${id}`);
  const priceChart = el("price"), metricChart = el("metric");
  const source = root.dataset.source;
  const cache = new Map();
  let manifest, current, revision = 0, syncing = false, initialized = false, drawnKey;
  let rendering = Promise.resolve();
  const state = { view: "volatility", a: "SPY", b: "TLT", months: 6 };
  const palette = ["#297fb8", "#d78328", "#9168be", "#289c87"];
  const plotlyReady = new Promise((resolve, reject) => {
    if (window.Plotly) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/plotly.js-basic-dist-min@4.1.1/plotly-basic.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("The chart library could not be loaded. Please reload."));
    document.head.appendChild(script);
  });

  async function getJson(file) {
    if (!cache.has(file)) {
      const pending = fetch(`${source}${file}${manifest ? `?v=${manifest.release}` : ""}`, { cache: "no-cache" })
        .then(response => {
          if (!response.ok) throw new Error(`Chart data unavailable (${response.status}). Please try again later.`);
          return response.json();
        }).catch(error => { cache.delete(file); throw error; });
      cache.set(file, pending);
    }
    return cache.get(file);
  }

  function cutoffDate(latest, months) {
    const date = new Date(`${latest}T12:00:00Z`);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().slice(0, 10);
  }

  function visibleTable(data) {
    const cutoff = cutoffDate(data.dates.at(-1), state.months);
    const start = data.dates.findIndex(date => date >= cutoff);
    return Object.fromEntries(Object.entries(data).filter(([, values]) => Array.isArray(values))
      .map(([key, values]) => [key, values.slice(Math.max(0, start))]));
  }

  function line(name, dates, values, color, dash = "solid") {
    return { name, uid: name.replace(/[^a-zA-Z0-9_-]/g, "-"), type: "scatter", mode: "lines", x: dates, y: values,
      connectgaps: false, line: { color, width: 1.8, dash },
      hovertemplate: `%{y:.2f}<extra>${name}</extra>` };
  }

  function layout(yTitle, range, metric = false) {
    const color = getComputedStyle(document.body).color;
    return {
      margin: { l: 64, r: 18, t: 15, b: metric ? 95 : 45 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { color, family: getComputedStyle(document.body).fontFamily, size: 12 },
      xaxis: { type: "date", range, title: { text: "Trading date" }, nticks: root.clientWidth < 500 ? 3 : 7, tickangle: 0,
        gridcolor: "rgba(127,127,127,.13)", showspikes: true, spikemode: "across", spikesnap: "cursor" },
      yaxis: { title: { text: yTitle }, automargin: true, gridcolor: "rgba(127,127,127,.18)", zeroline: false },
      hovermode: "x unified", dragmode: "zoom", autosize: true,
      legend: { orientation: "h", x: 0, y: -0.25, font: { size: 12 } },
      showlegend: metric || state.view === "correlation",
      uirevision: `${state.view}-${state.a}-${state.b}`,
      // Apply a new display range without resetting the user's legend choices.
      datarevision: state.months
    };
  }

  function draw() {
    const mine = ++revision;
    const chosen = { ...state };
    el("status").textContent = "Loading selected daily estimates…";
    el("chart-group").setAttribute("aria-busy", "true");
    // Serialize chart operations: an old Plotly promise must not overwrite a
    // newer asset selection.
    rendering = rendering.catch(() => {}).then(() => drawSelection(mine, chosen));
    return rendering;
  }

  async function drawSelection(mine, state) {
    if (mine !== revision) return;
    try {
      const a = manifest.assets.find(item => item.id === state.a);
      const b = manifest.assets.find(item => item.id === state.b);
      const paired = state.view === "correlation";
      const meta = paired ? manifest.pairs.find(item =>
        (item.a === state.a && item.b === state.b) || (item.a === state.b && item.b === state.a)) : a;
      if (!meta) throw new Error("Choose two different assets.");
      const data = await getJson(meta.file);
      await plotlyReady;
      if (mine !== revision) return;
      if (!Array.isArray(data.dates) || !data.dates.length) throw new Error("No observations are available.");
      const shown = visibleTable(data);
      const range = [shown.dates[0], shown.dates.at(-1)];
      const vix30 = !paired && ["TAIEX", "SPX"].includes(state.a) && a.vix30;
      let priceTraces, metricTraces, priceTitle, metricTitle;
      if (!paired) {
        priceTraces = [line(state.a, shown.dates, shown.price, palette[0])];
        metricTraces = [
          line("Historical · 22d", shown.dates, shown.hv, palette[0]),
          line("EWMA · 0.94", shown.dates, shown.ewma, palette[1], "dash"),
          line("GARCH · next session", shown.dates, shown.garch, palette[2], "dot"),
          line("Instantaneous · Fourier", shown.dates, shown.instantaneous, palette[3])
        ];
        if (vix30) {
          if (!shown.vix30 || shown.vix30.length !== shown.dates.length) throw new Error("30 day VIX data is incomplete. Please try again later.");
          metricTraces.push(line("30 day VIX", shown.dates, shown.vix30, "#c2545b", "dashdot"));
        }
        priceTitle = a.currency === "points" || !a.adjusted ? "Index level" : `Adjusted price (${a.currency})`;
        metricTitle = "Annualized volatility (%)";
        el("price-title").textContent = `${state.a} · ${a.name}`;
        el("metric-title").textContent = "Volatility estimators";
        el("interpretation").textContent = "GARCH shows the next-session forecast at its origin date. The other curves estimate volatility using information through that close.";
        if (vix30) el("interpretation").textContent += ` 30 day VIX uses option-implied total variance, linearly interpolated between maturities bracketing 30 calendar days from ${vix30.source}. Available from ${vix30.history_start}; missing dates remain gaps.`;
      } else {
        const pa = data.a === state.a ? shown.price_a : shown.price_b;
        const pb = data.a === state.a ? shown.price_b : shown.price_a;
        priceTraces = [line(state.a, shown.dates, pa.map(x => 100 * x / pa[0]), palette[0]),
          line(state.b, shown.dates, pb.map(x => 100 * x / pb[0]), palette[1], "dash")];
        metricTraces = [line("Historical · 22d", shown.dates, shown.historical, palette[0]),
          line("Instantaneous · Fourier", shown.dates, shown.instantaneous, palette[3], "dash")];
        priceTitle = "Starting value = 100";
        metricTitle = "Return correlation";
        el("price-title").textContent = `${state.a} / ${state.b} · relative price history`;
        el("metric-title").textContent = "Two correlation estimators";
        el("interpretation").textContent = "Correlations use log changes, not price levels. Positive and negative values describe co-movement, not a good or bad outcome. Both series use common price dates before returns are calculated.";
      }
      const pLayout = layout(priceTitle, range);
      if (paired) { pLayout.margin.b = 95; pLayout.legend.y = -0.45; }
      const mLayout = layout(metricTitle, range, true);
      if (vix30 && root.clientWidth < 500) mLayout.margin.b = 125;
      if (paired) {
        mLayout.yaxis.range = [-1.05, 1.05];
        mLayout.yaxis.tickvals = [-1, -.5, 0, .5, 1];
        mLayout.yaxis.zeroline = true;
        mLayout.yaxis.zerolinecolor = "rgba(127,127,127,.6)";
      }
      const options = { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false };
      syncing = true;
      const key = `${state.view}-${state.a}-${state.b}`;
      if (drawnKey === key && metricChart.data) {
        const visibility = new Map(metricChart.data.map(trace => [trace.uid, trace.visible]));
        metricTraces.forEach(trace => { trace.visible = visibility.get(trace.uid); });
      }
      // Fresh plots avoid stale calculated traces when reusing a cached pair.
      Plotly.purge(priceChart); Plotly.purge(metricChart); initialized = false;
      await Promise.all([Plotly.newPlot(priceChart, priceTraces, pLayout, options),
        Plotly.newPlot(metricChart, metricTraces, mLayout, options)]);
      drawnKey = key;
      syncing = false;
      if (!initialized) { bindCharts(); initialized = true; }
      if (mine !== revision) return;
      current = { range };
      const warnings = [];
      if (paired && meta.cross_market) warnings.push("Taiwan and US closes occur at different times. This comparison matches local trading dates and is descriptive, not a synchronized trading signal.");
      if (state.a === "VIX" || (paired && state.b === "VIX")) warnings.push("VIX inputs measure changes in the VIX index itself; these estimates are not SPX volatility or official VVIX.");
      if ((Date.now() - new Date(`${meta.as_of}T00:00:00Z`)) / 86400000 > 6) warnings.push("The latest observation is more than six calendar days old. Check the update status; holidays or a failed source update may explain the delay.");
      el("warning").textContent = warnings.join(" ");
      el("warning").hidden = !warnings.length;
      const basis = paired ? `${a.id}: ${a.as_of} · ${b.id}: ${b.as_of} · common date: ${meta.as_of}` : `${a.adjusted ? "Adjusted close" : "Index close"} · ${a.source} · latest: ${meta.as_of}`;
      el("status").textContent = `${range[0]} – ${range[1]} · ${shown.dates.length} observations · ${basis}${vix30 ? ` · 30 day VIX · ${vix30.source} · latest: ${vix30.as_of}` : ""}`;
      metricChart.setAttribute("aria-label", paired ? "Historical and instantaneous return correlations" : `Historical, EWMA, GARCH and instantaneous volatility estimates${vix30 ? ", and 30 day VIX" : ""}`);
      el("reset").disabled = false;
    } catch (error) {
      if (mine !== revision) return;
      current = null;
      el("status").textContent = error.message;
      el("warning").textContent = "The selected analysis could not be loaded. Previous charts are hidden to avoid showing another selection's results.";
      el("warning").hidden = false;
      if (window.Plotly) { Plotly.purge(priceChart); Plotly.purge(metricChart); initialized = false; }
      el("reset").disabled = true;
    } finally {
      if (mine === revision) el("chart-group").setAttribute("aria-busy", "false");
    }
  }

  function bindCharts() {
    [[priceChart, metricChart], [metricChart, priceChart]].forEach(([from, to]) => {
      from.on("plotly_relayout", async event => {
        if (syncing) return;
        let range;
        if (event["xaxis.range[0]"] !== undefined) range = [event["xaxis.range[0]"], event["xaxis.range[1]"]];
        if (event["xaxis.range"]) range = event["xaxis.range"];
        if (event["xaxis.autorange"]) range = current?.range;
        if (!range) return;
        syncing = true;
        try { await Plotly.relayout(to, { "xaxis.range": range }); } finally { syncing = false; }
      });
    });
  }

  function selection() {
    state.a = el("asset-a").value;
    state.b = el("asset-b").value;
    if (state.a === state.b) {
      state.b = manifest.assets.find(asset => asset.id !== state.a).id;
      el("asset-b").value = state.b;
    }
    for (const option of el("asset-b").options) option.disabled = option.value === state.a;
    return draw();
  }

  root.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    root.querySelectorAll("[data-view]").forEach(tab => tab.setAttribute("aria-selected", String(tab === button)));
    el("analysis").setAttribute("aria-labelledby", button.id);
    el("second-field").hidden = state.view !== "correlation";
    el("first-label").textContent = state.view === "correlation" ? "First asset" : "Asset";
    if (manifest) selection();
  }));
  el("asset-a").addEventListener("change", selection);
  el("asset-b").addEventListener("change", selection);
  el("range").addEventListener("change", () => { state.months = Number(el("range").value); if (manifest) draw(); });
  el("reset").addEventListener("click", () => { if (manifest) draw(); });

  let themeTimer;
  new MutationObserver(() => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => { if (current) draw(); }, 100);
  }).observe(document.body, { attributes: true, attributeFilter: ["class", "data-bs-theme"] });

  let width = root.clientWidth, resizeTimer;
  new ResizeObserver(() => {
    if (Math.abs(root.clientWidth - width) < 2) return;
    width = root.clientWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (current) draw(); }, 180);
  }).observe(root);

  Promise.all([getJson("manifest.json"), plotlyReady]).then(async ([data]) => {
    if (data.schema !== 1 || data.assets.length !== 8) throw new Error("Unsupported or incomplete data publication.");
    manifest = data;
    for (const id of ["asset-a", "asset-b"]) {
      el(id).replaceChildren(...manifest.assets.map(asset => {
        const option = document.createElement("option");
        option.value = asset.id; option.textContent = `${asset.id} · ${asset.name}`; return option;
      }));
      el(id).disabled = false;
    }
    el("asset-a").value = state.a; el("asset-b").value = state.b;
    const date = new Date(manifest.generated_at);
    el("updated").textContent = `Published ${date.toLocaleString(undefined, { timeZone: "Asia/Taipei", hour12: false })} (Taipei)`;
    await selection();
  }).catch(error => {
    el("status").textContent = error.message;
    el("updated").textContent = "Publication unavailable; check the update status below.";
    el("chart-group").setAttribute("aria-busy", "false");
  });
})();
