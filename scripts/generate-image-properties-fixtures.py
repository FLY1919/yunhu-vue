"""Optional fixture regeneration, needs Pillow; application has no Python dependency."""
from pathlib import Path
from PIL import Image
from PIL.TiffImagePlugin import IFDRational
root = Path(__file__).parent / 'image-properties-fixtures'
root.mkdir(exist_ok=True)
image = Image.new('RGB', (48, 32), 'red')
for x in range(24, 48):
    for y in range(32):
        image.putpixel((x, y), (0, 0, 255))
exif = Image.Exif()
exif[271] = 'QA Camera'
exif[272] = 'Test Device'
exif[274] = 1
exif[34665] = {36867: '2026:11:03 12:00:00', 33434: IFDRational(1, 125), 34855: 100}
exif[34853] = {1: 'N', 2: tuple(IFDRational(n) for n in (31, 12, 0)), 3: 'E', 4: tuple(IFDRational(n) for n in (121, 30, 0))}
for fmt, ext in [('JPEG', 'jpg'), ('PNG', 'png'), ('WEBP', 'webp')]:
    image.save(root / f'photo.{ext}', format=fmt, exif=exif)
exif[274] = 6
image.save(root / 'oriented.jpg', exif=exif, quality=95)
exif[274] = 1
for fmt, ext in [('PNG', 'png'), ('WEBP', 'webp')]:
    image.save(root / f'animated.{ext}', format=fmt, save_all=True, append_images=[Image.new('RGB', image.size, 'green')], duration=200, loop=0, exif=exif)
