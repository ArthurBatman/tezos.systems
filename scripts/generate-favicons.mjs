import sharp from 'sharp';

const TILE = '<rect width="64" height="64" rx="14" fill="#0F0F1A"/>';
const SQUARE_TILE = '<rect width="64" height="64" fill="#0F0F1A"/>';
const LETTERS = `<g fill="#45E0C8">
    <rect x="16.5" y="13" width="7" height="33" rx="3"/>
    <rect x="11" y="21" width="17" height="7" rx="3"/>
    <rect x="32" y="19" width="20" height="7" rx="2"/>
    <rect x="32" y="39" width="20" height="7" rx="2"/>
    <polygon points="45,26 52,26 39,39 32,39"/>
  </g>`;

const masterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${TILE}
  ${LETTERS}
</svg>`;

const squareSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${SQUARE_TILE}
  ${LETTERS}
</svg>`;

const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${SQUARE_TILE}
  <g transform="translate(6.4 6.4) scale(0.8)">
    ${LETTERS}
  </g>
</svg>`;

const outputs = [
  { file: 'favicon-16.png', size: 16, svg: masterSvg, format: 'png' },
  { file: 'favicon-32.png', size: 32, svg: masterSvg, format: 'png' },
  { file: 'favicon-48.png', size: 48, svg: masterSvg, format: 'png' },
  { file: 'apple-touch-icon.png', size: 180, svg: squareSvg, format: 'png' },
  { file: 'icon-192.png', size: 192, svg: squareSvg, format: 'png' },
  { file: 'icon-512.png', size: 512, svg: squareSvg, format: 'png' },
  { file: 'icon-192.webp', size: 192, svg: squareSvg, format: 'webp' },
  { file: 'icon-512.webp', size: 512, svg: squareSvg, format: 'webp' },
  { file: 'icon-maskable-192.png', size: 192, svg: maskableSvg, format: 'png' },
  { file: 'icon-maskable-512.png', size: 512, svg: maskableSvg, format: 'png' }
];

async function renderIcon({ file, size, svg, format }) {
  const image = sharp(Buffer.from(svg), {
    density: 72 * (size / 64) * 2
  }).resize(size, size, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3
  });

  const pipeline = format === 'webp' ? image.webp({ quality: 95 }) : image.png();
  await pipeline.toFile(file);

  const metadata = await sharp(file).metadata();
  if (metadata.width !== size || metadata.height !== size) {
    throw new Error(`${file} rendered as ${metadata.width}x${metadata.height}; expected ${size}x${size}`);
  }

  console.log(`${file} ${metadata.width}x${metadata.height}`);
}

await Promise.all(outputs.map(renderIcon));
