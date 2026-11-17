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
      const lucide = typeof window !== "undefined" ? window.lucide : null;
      if (!lucide || !lucide.icons || !lucide.createElement) return;
      const key = toPascalCase(this.name);
      const iconDef = lucide.icons[key];
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
