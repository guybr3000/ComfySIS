# ComfySIS

A lightweight, zero-backend prototype for building SSIS-style data flows in the browser. Inspired by ComfyUI, the interface lets you drop sources, transforms, and destinations onto a canvas, connect them visually, and run a mock preview against sample data.

## Getting started

1. Start a static server (any will do). For example:

```bash
python -m http.server 3000
```

2. Open `http://localhost:3000` in your browser to launch ComfySIS.

## How to test the UI

Because everything is client-side, testing is a matter of manually exercising the interactions:

1. Add nodes from the palette (e.g., `CSV Source`, `Filter`, `Aggregate`, `Destination`).
2. Drag to reposition nodes and connect outputs to inputs to form a flow. Pan the canvas by dragging the background, and zoom with `Ctrl/Cmd + Mousewheel` or the on-screen zoom controls. You can delete connections by clicking the canvas and pressing `Backspace`.
3. Select a node to edit its inspector settings (queries, filters, column selections, and preview toggles).
4. Press **Run Preview**. Sample rows will run through the pipeline; logs appear in **Preview Output**, and full tables are printed to the browser console for deeper inspection.
5. Try the provided presets under **Demo Flows** to confirm wiring and preview behaviors without manual setup.

## How it works

- **Palette:** Click any chip to place a node on the canvas.
- **Canvas:** Drag nodes to rearrange, click output ports then input ports to connect steps.
- **Inspector:** Select a node to edit its settings (queries, filters, mappings, etc.).
- **Preview:** Press **Run Preview** to simulate the flow. Sample rows are processed and logs appear in the **Preview Output** panel while full tables print to the console.

The goal is to mirror familiar ETL actions—sources, filters, lookups, aggregates, and destinations—while keeping the experience approachable and easy to demo.
