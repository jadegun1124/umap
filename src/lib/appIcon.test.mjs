import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function repo(path) {
  return new URL(path, import.meta.url);
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

  const report = execFileSync('python3', ['-c', `
from PIL import Image
import math
im = Image.open("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png")
w, h = im.size
assert (w, h) == (432, 432), (w, h)
assert im.getpixel((2, 2))[3] == 0
center = im.getpixel((w // 2, h // 2))
assert center[3] == 255 and not (center[0] > 240 and center[1] > 240 and center[2] > 240)
bbox = im.getbbox()
cx = cy = (w - 1) / 2
radius = w * (66 / 108) / 2
far = 0
for x, y in ((bbox[0], bbox[1]), (bbox[2] - 1, bbox[1]), (bbox[0], bbox[3] - 1), (bbox[2] - 1, bbox[3] - 1)):
    far = max(far, math.hypot(x - cx, y - cy))
assert far <= radius + 0.6, (far, radius)
print("ok")
`], { cwd: fileURLToPath(new URL('../..', import.meta.url)) });
  assert.match(report.toString(), /ok/);
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
