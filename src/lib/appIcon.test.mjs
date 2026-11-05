import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function repo(path) {
  return new URL(path, import.meta.url);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** RGBA pixels from an 8-bit PNG. Node's zlib is enough; CI does not have Pillow. */
function decodeRgbaPng(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected 8-bit non-interlaced RGBA');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = previous[i];
      const upLeft = i >= 4 ? previous[i - 4] : 0;
      const value = raw[src + i];
      if (filter === 0) row[i] = value;
      else if (filter === 1) row[i] = (value + left) & 255;
      else if (filter === 2) row[i] = (value + up) & 255;
      else if (filter === 3) row[i] = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[i] = (value + paeth(left, up, upLeft)) & 255;
      else throw new Error(`png filter ${filter}`);
    }
    previous = Buffer.from(row);
    src += stride;
  }
  return { width, height, pixels };
}

function rgbaAt(png, x, y) {
  const index = (y * png.width + x) * 4;
  return png.pixels.subarray(index, index + 4);
}

test('KINVO artwork is the launcher source and stays inside the adaptive safe circle', () => {
  const source = readFileSync(repo('../../resources/kinvo-app-icon.png'));
  assert.equal(source.readUInt32BE(16), 1080);
  assert.equal(source.readUInt32BE(20), 1080);
  const agents = text('../../AGENTS.md');
  assert.match(agents, /kinvo-app-icon\.png/);
  assert.match(agents, /66dp/);
  const script = text('../../scripts/render-kinvo-icon.py');
  assert.match(script, /66 \/ 108/);
  assert.match(script, /sqrt\(2\)/);

  const foreground = decodeRgbaPng(readFileSync(repo('../../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png')));
  assert.deepEqual([foreground.width, foreground.height], [432, 432]);
  assert.equal(rgbaAt(foreground, 2, 2)[3], 0);
  const center = rgbaAt(foreground, Math.floor(foreground.width / 2), Math.floor(foreground.height / 2));
  assert.equal(center[3], 255);
  assert.equal(center[0] > 240 && center[1] > 240 && center[2] > 240, false);
  let wordmark = 0;
  for (let y = 0; y < foreground.height; y += 1) {
    for (let x = 0; x < foreground.width; x += 1) {
      const pixel = rgbaAt(foreground, x, y);
      if (pixel[3] > 200 && pixel[0] >= 248 && pixel[1] >= 248 && pixel[2] >= 248) wordmark += 1;
    }
  }
  assert.ok(wordmark > 400, `KINVO letters collapsed to ${wordmark} near-white pixels`);
  let minX = foreground.width;
  let minY = foreground.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < foreground.height; y += 1) {
    for (let x = 0; x < foreground.width; x += 1) {
      if (rgbaAt(foreground, x, y)[3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const cx = (foreground.width - 1) / 2;
  const cy = (foreground.height - 1) / 2;
  const radius = foreground.width * (66 / 108) / 2;
  let far = 0;
  for (const [x, y] of [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]]) {
    far = Math.max(far, Math.hypot(x - cx, y - cy));
  }
  assert.ok(far <= radius + 0.6, `artwork corner ${far} is outside safe radius ${radius}`);
});

test('Android adaptive background is deep blue and the foreground is the KINVO bitmap', () => {
  const adaptive = text('../../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml');
  assert.match(adaptive, /@drawable\/ic_launcher_background/);
  assert.match(adaptive, /@mipmap\/ic_launcher_foreground/);
  assert.match(adaptive, /@drawable\/ic_launcher_monochrome/);

  const background = text('../../android/app/src/main/res/drawable/ic_launcher_background.xml');
  assert.match(background, /#FF0149D3/);
  assert.equal(background.includes('<gradient'), false);

  const foreground = text('../../android/app/src/main/res/drawable/ic_launcher_foreground.xml');
  assert.match(foreground, /<bitmap/);
  assert.match(foreground, /@mipmap\/ic_launcher_foreground/);

  const mono = text('../../android/app/src/main/res/drawable/ic_launcher_monochrome.xml');
  assert.match(mono, /#FFFFFFFF/);
  assert.equal(mono.includes('evenOdd'), false);

  const notify = text('../../android/app/src/main/res/drawable/ic_stat_notify.xml');
  assert.match(notify, /android:width="24dp"/);
  assert.match(notify, /#FFFFFFFF/);

  const java = text('../../android/app/src/main/java/kr/co/umap/tracker/AlertWatchService.java');
  assert.match(java, /R\.drawable\.ic_stat_notify/);
  assert.equal(java.includes('android.R.drawable.ic_dialog_'), false);
});

test('legacy mipmaps, web icons, and maskable PWA icons are present', () => {
  const files = [
    '../../android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
    '../../android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png',
    '../../android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
    '../../android/app/src/main/res/mipmap-xhdpi/ic_launcher.png',
    '../../android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
    '../../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
    '../../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
    '../../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
    '../../public/favicon.png',
    '../../public/apple-touch-icon.png',
    '../../public/umap-icon-192.png',
    '../../public/umap-icon-512.png',
    '../../public/umap-icon-192-maskable.png',
    '../../public/umap-icon-512-maskable.png',
    '../../resources/icon-master.png',
    '../../resources/kinvo-app-icon.png',
  ];
  for (const file of files) {
    assert.equal(existsSync(repo(file)), true, file);
  }

  const manifest = JSON.parse(text('../../public/manifest.json'));
  assert.equal(manifest.background_color, '#0149D3');
  const purposes = manifest.icons.map((icon) => `${icon.src}:${icon.purpose}`);
  assert.ok(purposes.includes('umap-icon-192.png:any'));
  assert.ok(purposes.includes('umap-icon-512.png:any'));
  assert.ok(purposes.includes('umap-icon-192-maskable.png:maskable'));
  assert.ok(purposes.includes('umap-icon-512-maskable.png:maskable'));
});
