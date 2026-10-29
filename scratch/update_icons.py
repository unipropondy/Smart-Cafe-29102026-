import os
from PIL import Image, ImageDraw

src_path = r"C:\Users\UNIPRO\.gemini\antigravity-ide\brain\fb20d844-c570-4721-9d72-e5e3cb3c2ed6\.user_uploaded\media_1792475929032.png"
base_res = r"c:\Users\UNIPRO\Desktop\POS\frontend\android\app\src\main\res"

src = Image.open(src_path).convert("RGBA")

# 1. Precise crop of the POS logo artwork inside the white card
# Antenna starts at y=207, ends at y=767. Width from x=220 to 742.
# We crop with balanced padding around the artwork.
logo_crop = src.crop((215, 202, 747, 772))

# 2. Build 1024x1024 master icon on pure white background
master_size = 1024
master = Image.new("RGBA", (master_size, master_size), (255, 255, 255, 255))

# Android Adaptive icon safe zone is the central 66%-72% of the canvas.
# Setting logo height to 540px (~52.7%) ensures optimal visual weight and safe margins on any mask.
target_h = 540
aspect = logo_crop.width / logo_crop.height
target_w = int(target_h * aspect)

logo_resized = logo_crop.resize((target_w, target_h), Image.Resampling.LANCZOS)
pos_x = (master_size - target_w) // 2
pos_y = (master_size - target_h) // 2

master.paste(logo_resized, (pos_x, pos_y), logo_resized)

# Save master icon to frontend asset paths
frontend_assets_path = r"c:\Users\UNIPRO\Desktop\POS\frontend\assets\images\logo_pos.png"
frontend_images_path = r"c:\Users\UNIPRO\Desktop\POS\frontend\images\logo_pos.png"
master.save(frontend_assets_path, "PNG")
master.save(frontend_images_path, "PNG")
print(f"Master logo_pos.png saved to {frontend_assets_path} and {frontend_images_path}")

# 3. Android Mipmap densities
configs = {
    "mipmap-mdpi": {"launcher": 48, "foreground": 108},
    "mipmap-hdpi": {"launcher": 72, "foreground": 162},
    "mipmap-xhdpi": {"launcher": 96, "foreground": 216},
    "mipmap-xxhdpi": {"launcher": 144, "foreground": 324},
    "mipmap-xxxhdpi": {"launcher": 192, "foreground": 432},
}

for folder, sizes in configs.items():
    folder_path = os.path.join(base_res, folder)
    if not os.path.exists(folder_path):
        continue

    l_size = sizes["launcher"]
    fg_size = sizes["foreground"]

    # 3.1 ic_launcher.webp (Square icon on clean white)
    im_launcher = master.resize((l_size, l_size), Image.Resampling.LANCZOS)
    im_launcher.save(os.path.join(folder_path, "ic_launcher.webp"), "WEBP", quality=98)

    # 3.2 ic_launcher_round.webp (Circular icon on clean white)
    mask = Image.new("L", (l_size, l_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, l_size, l_size), fill=255)
    im_round = im_launcher.copy()
    im_round.putalpha(mask)
    im_round.save(os.path.join(folder_path, "ic_launcher_round.webp"), "WEBP", quality=98)

    # 3.3 ic_launcher_foreground.webp (Adaptive icon foreground)
    # Scaled to the 108dp canvas where logo sits centered within 72dp safe zone
    im_fg = master.resize((fg_size, fg_size), Image.Resampling.LANCZOS)
    im_fg.save(os.path.join(folder_path, "ic_launcher_foreground.webp"), "WEBP", quality=98)

    print(f"Generated {folder}: launcher={l_size}x{l_size}, round={l_size}x{l_size}, foreground={fg_size}x{fg_size}")

print("All Android launcher icons successfully updated with clean white background and balanced alignment!")
