import sharp from 'sharp'
import { mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
// Fuente única de TODAS las imágenes del PWA: el logo vectorial.
const src = resolve(root, 'images', 'logo.svg')
const iconsDir = resolve(root, 'public', 'icons')
const publicDir = resolve(root, 'public')

await mkdir(iconsDir, { recursive: true })

// El SVG está en mm a tamaño grande; rasterizamos sin tope de píxeles y
// reescalamos a la medida final (contain, fondo transparente).
function raster (size) {
  return sharp(src, { density: 200, limitInputPixels: false })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
}

for (const size of [192, 512]) {
  await raster(size).toFile(resolve(iconsDir, `icon-${size}.png`))
  console.log(`✓ icon-${size}.png`)
}

// Maskable: logo al ~80% centrado sobre fondo sólido (safe zone).
await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .composite([{ input: await raster(410).toBuffer(), gravity: 'center' }])
  .png()
  .toFile(resolve(iconsDir, 'icon-maskable-512.png'))
console.log('✓ icon-maskable-512.png')

// Favicon e icono SVG del manifest: el propio logo vectorial.
await copyFile(src, resolve(publicDir, 'favicon.svg'))
await copyFile(src, resolve(iconsDir, 'logo.svg'))
console.log('✓ favicon.svg + icons/logo.svg')
