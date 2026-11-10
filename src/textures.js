// Surface images for the scene.
// - Card fronts come from an image file: the official Blu Junior card artwork.
// - Everything else (card backs, wallet logo patch, fabric grain, backdrop) is
//   drawn here with the 2D canvas API and handed to three.js as a texture.
import * as THREE from 'three';

// public/cards/blu-junior-cards.webp holds the 3 card fronts the wallet shows, side
// by side (each 400 × 601 px), cut from the official artwork on jr.blubank.com.
export const CARD_SHEET = { url: '/cards/blu-junior-cards.webp', count: 3, aspect: 400 / 601 };

// Which cards sit in the wallet, ordered back → front.
// `slot` = position in the sheet: 0 astronaut, 1 unicorn, 2 footballer.
// `back` = colour of the card's reverse side.
export const CARDS = [
  { slot: 1, back: '#8d86c9' },
  { slot: 2, back: '#e8622c' },
  { slot: 0, back: '#2b2659' },
];

// The official blu logo, copied from the inline SVG in blubank.com's header
// (viewBox 0 0 52 32). Letters and dot are separate shapes.
const BLU_LOGO = {
  w: 52,
  h: 32,
  letters:
    'M27.4266 2.90918H30.0105V29.4027C30.0105 30.8372 28.8536 32.0001 27.4266 32.0001H24.8427V5.50658C24.8427 4.07208 25.9996 2.90918 27.4266 2.90918ZM39.3123 13.4025V23.2726C39.3123 25.4543 40.9211 27.1168 43.0331 27.1168C45.124 27.1168 46.7539 25.4541 46.7533 23.3362L46.7537 13.4025C46.7539 11.968 47.9107 10.8052 49.3377 10.8051H51.9216V23.0649C51.9216 27.9996 47.9421 31.9999 43.0331 31.9999C38.1241 31.9999 34.1446 27.9996 34.1446 23.0649V10.8051H36.7285C38.1555 10.8051 39.3123 11.968 39.3123 13.4025ZM5.20532 12.7729L5.20544 2.9098H2.62158C1.20794 2.9098 0.0377197 4.06383 0.0377197 5.5072V21.6111L0.0420235 21.6112C0.201377 27.3772 4.76578 32.0007 10.3732 32.0007C16.0813 32.0007 20.7078 27.3772 20.7086 21.2994C20.7086 21.2575 20.7084 21.2157 20.7078 21.1741C20.7083 21.1293 20.7086 21.0845 20.7086 21.0397C20.7086 15.1582 16.4514 10.3903 11.2 10.3903C8.92741 10.3903 6.84105 11.2832 5.20532 12.7729ZM4.89537 21.1436C4.89537 17.8442 7.30158 15.1695 10.2698 15.1695C13.238 15.1695 15.6442 17.8442 15.6442 21.1436C15.6442 24.4429 13.238 27.1176 10.2698 27.1176C7.30158 27.1176 4.89537 24.4429 4.89537 21.1436Z',
  dot: 'M12.4403 4.15584C13.5819 4.15584 14.5073 3.22553 14.5073 2.07792C14.5073 0.930317 13.5819 0 12.4403 0C11.2986 0 10.3732 0.930317 10.3732 2.07792C10.3732 3.22553 11.2986 4.15584 12.4403 4.15584Z',
  lettersColor: '#4E91E6',
  dotColor: '#0C1011',
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Load the sheet once, then hand out one texture per card that shows only its slot.
export async function loadCardFronts() {
  const sheet = await new THREE.TextureLoader().loadAsync(CARD_SHEET.url);
  sheet.colorSpace = THREE.SRGBColorSpace;
  sheet.anisotropy = 8;
  return (slot) => {
    const t = sheet.clone();
    t.repeat.set(1 / CARD_SHEET.count, 1);
    t.offset.set(slot / CARD_SHEET.count, 0);
    t.needsUpdate = true;
    return t;
  };
}

// Plain reverse side: the card's colour with a magnetic stripe down the left.
export function cardBackTexture(color) {
  const [c, ctx] = makeCanvas(400, 601);
  const { width: w, height: h } = c;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#17171a';
  ctx.fillRect(w * 0.1, 0, w * 0.2, h);
  return toTexture(c);
}

// Transparent image for the raised patch on the wallet's front panel: the
// official logo in its own colours, bottom-left. `aspect` = patch width / height.
export function holderLogoTexture(aspect) {
  const [c, ctx] = makeCanvas(1200, Math.round(1200 / aspect));
  const { width: w, height: h } = c;
  const scale = (w * 0.22) / BLU_LOGO.w; // logo takes 22% of the patch width
  const margin = w * 0.065; // same gap to the left edge and to the bottom edge
  ctx.translate(margin, h - margin - BLU_LOGO.h * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = BLU_LOGO.lettersColor;
  ctx.fill(new Path2D(BLU_LOGO.letters), 'evenodd');
  ctx.fillStyle = BLU_LOGO.dotColor;
  ctx.fill(new Path2D(BLU_LOGO.dot));
  return toTexture(c);
}

// Fine grain used as a bump map so the wallet reads as fabric, not plastic.
export function grainTexture() {
  const [c, ctx] = makeCanvas(256, 256);
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 7);
  return t;
}

// Soft studio backdrop.
export function backgroundTexture() {
  const [c, ctx] = makeCanvas(1024, 1024);
  const g = ctx.createRadialGradient(512, 430, 60, 512, 512, 760);
  g.addColorStop(0, '#f0f1f3');
  g.addColorStop(0.55, '#e3e4e7');
  g.addColorStop(1, '#cccdd1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  return toTexture(c);
}

// Woven elastic: raised ribs running along the band, crossed by a fine weave,
// with a stitched edge on each side. Used for both the colour and the bumps.
// `repeat` = how many times the weave repeats along the band's length.
export function elasticTexture(repeat) {
  const [c, ctx] = makeCanvas(256, 256);
  const { width: w, height: h } = c;
  ctx.fillStyle = '#b4b5b9';
  ctx.fillRect(0, 0, w, h);

  // Ribs along the length: a light crest and a dark groove, repeated across the width.
  const ribs = 9;
  const rib = h / ribs;
  for (let i = 0; i < ribs; i++) {
    const g = ctx.createLinearGradient(0, i * rib, 0, (i + 1) * rib);
    g.addColorStop(0, '#8f9094');
    g.addColorStop(0.45, '#d3d4d8');
    g.addColorStop(0.75, '#c0c1c5');
    g.addColorStop(1, '#8f9094');
    ctx.fillStyle = g;
    ctx.fillRect(0, i * rib, w, rib);
  }

  // Fine cross weave: thin dark ticks, offset on every other rib like real knit.
  for (let i = 0; i < ribs; i++) {
    for (let x = (i % 2) * 4; x < w; x += 8) {
      ctx.fillStyle = 'rgba(40,41,46,0.2)';
      ctx.fillRect(x, i * rib + rib * 0.15, 2, rib * 0.7);
    }
  }

  // Bound edges.
  ctx.fillStyle = '#9a9b9f';
  ctx.fillRect(0, 0, w, 5);
  ctx.fillRect(0, h - 5, w, 5);

  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, 1);
  return t;
}
