const SVG_NS = "http://www.w3.org/2000/svg";

const CUSTOM_SKIP_ICONS = {
  "skip-back-15": {
    paths: [
      "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
      "M3 3v5h5",
    ],
    label: "15",
  },
  "skip-forward-30": {
    paths: [
      "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",
      "M21 3v5h-5",
    ],
    label: "30",
  },
};

function toPascalCase(name) {
  return String(name || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export default {
  name: "AppIcon",
  props: {
    name: {
      type: String,
      required: true,
    },
    size: {
      type: [Number, String],
      default: 16,
    },
  },
  mounted() {
    this.renderIcon();
  },
  watch: {
    name() {
      this.renderIcon();
    },
    size() {
      this.renderIcon();
    },
  },
  methods: {
    renderIcon() {
      const wrap = this.$refs.wrap;
      if (!wrap) return;
      wrap.textContent = "";

      const custom = CUSTOM_SKIP_ICONS[this.name];
      if (custom && typeof document !== "undefined") {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", String(this.size));
        svg.setAttribute("height", String(this.size));
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.9");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        for (const d of custom.paths) {
          const p = document.createElementNS(SVG_NS, "path");
          p.setAttribute("d", d);
          svg.appendChild(p);
        }
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", "12");
        text.setAttribute("y", "15.1");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", "currentColor");
        text.setAttribute("stroke", "none");
        text.setAttribute("font-size", "8.2");
        text.setAttribute("font-weight", "700");
        text.setAttribute("font-family", "inherit");
        text.style.fontVariantNumeric = "tabular-nums";
        text.textContent = custom.label;
        svg.appendChild(text);
        wrap.appendChild(svg);
        return;
      }

      const lucide = typeof window !== "undefined" ? window.lucide : null;
      if (!lucide || !lucide.icons || !lucide.createElement) return;
      const key = toPascalCase(this.name);
      const iconDef =
        lucide.icons[key] ||
        (key === "Home" ? lucide.icons.House : null);
      if (!iconDef) return;
      const svg = lucide.createElement(iconDef, {
        width: this.size,
        height: this.size,
        "stroke-width": 2,
      });
      wrap.appendChild(svg);
    },
  },
  template: `<span ref="wrap" class="app-icon" aria-hidden="true"></span>`,
};
