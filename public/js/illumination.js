// Illuminated initials in the Insular manuscript manner (Book of Kells,
// Lindisfarne): interlace borders, triskele spirals, red-dot outlining and
// gilt letters, drawn as SVG so they stay crisp and cost nothing to load.
// For Islamic cards the frame is geometric only (no figurative art).

const INK = "#1a1714";
// muted, aged gilt rather than bright gold, so the initial sits into the card
const GOLD = ["#e6d4a4", "#bfa56c", "#86703f"];
const SHADE = "rgba(0,0,0,0.42)";
const PALETTES = {
  kells: { field: "#1e2d3f", accent: "#8a5a45", strand: "#bfa56c", second: "#4d5f55" },
  verdigris: { field: "#20352f", accent: "#c0913f", strand: "#e2c47a", second: "#8a3b2b" },
  lapis: { field: "#16233f", accent: "#d9b45a", strand: "#f0d88f", second: "#7a2e2a" },
};

let uid = 0;
const r2 = (n) => Math.round(n * 100) / 100;

// A two-strand plait along one edge: the strands cross and alternate over/under.
function plait(x0, y0, x1, y1, width, colour, cycles) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux;
  const amp = width / 2 - 2;
  const pts = (phase) => {
    const out = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80, s = t * len, w = Math.sin(t * cycles * 2 * Math.PI + phase) * amp;
      out.push([x0 + ux * s + nx * w, y0 + uy * s + ny * w]);
    }
    return out;
  };
  const d = (p) => "M" + p.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(" L");
  const strand = (p) => `<path d="${d(p)}" stroke="${SHADE}" stroke-width="3.6" fill="none" stroke-linecap="round"/><path d="${d(p)}" stroke="${colour}" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.85"/>`;
  const a = pts(0), b = pts(Math.PI);
  // redraw strand A over B at every other crossing, so the weave alternates
  let over = "";
  const crossings = cycles * 2;
  for (let k = 0; k < crossings; k += 2) {
    const c = Math.round(((k + 0.5) / crossings) * 80);
    over += strand(a.slice(Math.max(0, c - 5), Math.min(81, c + 6)));
  }
  return strand(a) + strand(b) + over;
}

// A triskele: three spiral arms joined at the centre, the classic Celtic motif.
function triskele(cx, cy, size, colour, width = Math.max(0.7, size / 7)) {
  let arms = "";
  for (let k = 0; k < 3; k++) {
    const rot = (k * 2 * Math.PI) / 3;
    const p = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, a = rot - t * 2.2 * Math.PI, r = size * (1 - 0.82 * t);
      p.push(`${r2(cx + Math.cos(rot) * size * 0.5 + Math.cos(a) * r * 0.5)} ${r2(cy + Math.sin(rot) * size * 0.5 + Math.sin(a) * r * 0.5)}`);
    }
    arms += `<path d="M${r2(cx)} ${r2(cy)} L${p.join(" L")}" stroke="${colour}" stroke-width="${r2(width)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r2(size * 1.05)}" fill="none" stroke="${colour}" stroke-width="${r2(width * 0.8)}"/>${arms}`;
}

// Red dots around a rectangle, as Insular scribes outlined their initials.
function dots(x, y, w, h, gap, colour) {
  let out = "";
  const n = (len) => Math.max(2, Math.round(len / gap));
  const edge = (ax, ay, bx, by) => {
    const k = n(Math.hypot(bx - ax, by - ay));
    for (let i = 0; i < k; i++) out += `<circle cx="${r2(ax + ((bx - ax) * i) / k)}" cy="${r2(ay + ((by - ay) * i) / k)}" r="1.25" fill="${colour}"/>`;
  };
  edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  return out;
}

// An eight-point star lattice: a geometric frame for Islamic cards.
function girih(x, y, w, h, colour) {
  const id = `g${uid}`;
  const star = (cx, cy, r) => {
    const p = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8, rr = i % 2 ? r * 0.42 : r;
      p.push(`${r2(cx + Math.cos(a) * rr)} ${r2(cy + Math.sin(a) * rr)}`);
    }
    return `<polygon points="${p.join(" ")}" fill="none" stroke="${colour}" stroke-width="1.1"/>`;
  };
  return `<pattern id="${id}" width="20" height="20" patternUnits="userSpaceOnUse">${star(10, 10, 9)}<rect x="0" y="0" width="20" height="20" fill="none" stroke="${colour}" stroke-width="0.4" opacity="0.5"/></pattern>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
}

function letter(ch, cx, baseline, size, gid, inner = "#b5563a") {
  const cid = `c${uid}`, pid = `p${uid}`;
  const glyph = (attrs) => `<text x="${cx}" y="${baseline}" text-anchor="middle" font-family="'EB Garamond', 'Uncial Antiqua', Georgia, serif" font-weight="600" font-size="${size}" ${attrs}>${ch}</text>`;
  // a lattice of tiny dots and hairline spirals inside the letter, as in Insular initials
  const pattern = `<pattern id="${pid}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="3.5" cy="3.5" r="0.6" fill="${inner}" opacity="0.55"/><path d="M0 0 L7 7" stroke="${GOLD[2]}" stroke-width="0.3" opacity="0.4"/></pattern>`;
  return `<defs><clipPath id="${cid}">${glyph("")}</clipPath>${pattern}</defs>` +
    glyph(`fill="none" stroke="${SHADE}" stroke-width="2.4" stroke-linejoin="round"`) +
    `<g clip-path="url(#${cid})"><rect x="0" y="0" width="96" height="96" fill="url(#${gid})"/><rect x="0" y="0" width="96" height="96" fill="url(#${pid})"/></g>` +
    glyph(`fill="none" stroke="${GOLD[0]}" stroke-width="0.5" opacity="0.8"`);
}

function gilt(gid) {
  return `<linearGradient id="${gid}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${GOLD[0]}"/><stop offset="0.55" stop-color="${GOLD[1]}"/><stop offset="1" stop-color="${GOLD[2]}"/></linearGradient>`;
}

// style: "knot" (plaited border, corner spirals), "spiral" (triskeles and red
// dots, no frame), "gilt" (plain gilt panel with corner knots), "geometric"
// (star lattice, for Islamic cards). Returns an SVG string, 96×96 viewBox.
export function initialSVG(ch, { style = "knot", palette = "kells" } = {}) {
  uid++;
  const P = PALETTES[palette] || PALETTES.kells;
  const gid = `gold${uid}`;
  const S = 96;
  let body = "";
  if (style === "knot") {
    // translucent field and hairline rules, so the card's own colour shows through
    body += `<rect x="1.5" y="1.5" width="93" height="93" rx="2" fill="rgba(0,0,0,0.22)" stroke="${GOLD[1]}" stroke-width="0.8" opacity="0.9"/>`;
    body += plait(11, 7.5, 85, 7.5, 8, GOLD[1], 5) + plait(11, 88.5, 85, 88.5, 8, GOLD[1], 5);
    body += plait(7.5, 11, 7.5, 85, 8, GOLD[1], 5) + plait(88.5, 11, 88.5, 85, 8, GOLD[1], 5);
    body += `<rect x="13" y="13" width="70" height="70" fill="${P.field}" fill-opacity="0.55" stroke="${GOLD[2]}" stroke-width="0.7"/>`;
    body += [[7.5, 7.5], [88.5, 7.5], [7.5, 88.5], [88.5, 88.5]].map(([x, y]) => triskele(x, y, 3.8, GOLD[1], 0.7)).join("");
    body += letter(ch, 48, 72, 64, gid, P.accent);
  } else if (style === "spiral") {
    body += dots(14, 10, 68, 76, 5, "#c0392b");
    body += triskele(19, 19, 9, P.strand) + triskele(77, 77, 9, P.accent) + triskele(77, 19, 6.5, P.strand) + triskele(19, 77, 6.5, P.strand);
    body += letter(ch, 48, 76, 78, gid, "#c0392b");
  } else if (style === "gilt") {
    body += `<rect x="2" y="2" width="92" height="92" fill="${P.field}" stroke="${GOLD[1]}" stroke-width="2"/>`;
    body += `<rect x="7" y="7" width="82" height="82" fill="none" stroke="${GOLD[2]}" stroke-width="0.8"/>`;
    body += [[12, 12], [84, 12], [12, 84], [84, 84]].map(([x, y]) => triskele(x, y, 6, GOLD[1], 0.9)).join("");
    body += letter(ch, 48, 72, 66, gid, P.second);
  } else if (style === "geometric") {
    body += `<rect x="1.5" y="1.5" width="93" height="93" fill="rgba(0,0,0,0.22)" stroke="${GOLD[1]}" stroke-width="0.8"/>`;
    body += `<g opacity="0.7">${girih(4, 4, 88, 88, GOLD[1])}</g>`;
    body += `<rect x="14" y="14" width="68" height="68" fill="#16302e" fill-opacity="0.75" stroke="${GOLD[1]}" stroke-width="0.8"/>`;
    body += `<rect x="17" y="17" width="62" height="62" fill="none" stroke="${GOLD[2]}" stroke-width="0.5"/>`;
    body += letter(ch, 48, 70, 58, gid, "#4f6b5d");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="presentation"><defs>${gilt(gid)}</defs>${body}</svg>`;
}
