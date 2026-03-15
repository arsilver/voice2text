import electron from "electron";

const { nativeImage } = electron;

export function createAppIcon() {
  // Build a 16x16 RGBA bitmap directly so the tray stays crisp on Windows.
  // Larger installer/executable icons are provided separately as ICO/PNG assets.

  const size = 16;
  const buffer = Buffer.alloc(size * size * 4, 0);

  const bg = [0x11, 0x13, 0x18, 0xff];
  const amber = [0xf4, 0xa3, 0x19, 0xff];
  const blue = [0x2d, 0xa9, 0xff, 0xff];

  function setPixel(x: number, y: number, rgba: number[]) {
    if (x < 0 || x >= size || y < 0 || y >= size) {
      return;
    }

    const offset = (y * size + x) * 4;
    buffer[offset] = rgba[0];
    buffer[offset + 1] = rgba[1];
    buffer[offset + 2] = rgba[2];
    buffer[offset + 3] = rgba[3];
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if ((x === 0 || x === size - 1) && (y === 0 || y === size - 1)) {
        continue;
      }

      setPixel(x, y, bg);
    }
  }

  const microphonePixels = [
    [6, 2], [7, 2], [8, 2], [9, 2],
    [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3],
    [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
    [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
    [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6],
    [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
    [6, 8], [7, 8], [8, 8], [9, 8],
    [7, 9], [8, 9],
    [7, 10], [8, 10],
    [7, 11], [8, 11],
    [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [10, 12],
    [6, 13], [7, 13], [8, 13], [9, 13],
  ];

  for (const [x, y] of microphonePixels) {
    setPixel(x, y, amber);
  }

  const signalPixels = [
    [3, 4], [2, 5], [2, 6], [2, 7], [3, 8],
    [4, 5], [4, 6], [4, 7],
    [12, 4], [13, 5], [13, 6], [13, 7], [12, 8],
    [11, 5], [11, 6], [11, 7],
  ];

  for (const [x, y] of signalPixels) {
    setPixel(x, y, blue);
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}
