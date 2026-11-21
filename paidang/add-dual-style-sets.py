# -*- coding: utf-8 -*-
"""把双风格批量生产已交付的 22 套（第1-22套）加进派单系统待派送池。
来源: workspace/新品-双风格-2026-11-21/<pid>/风格*/图1/2/3.jpg
目标: workspace/派单系统/data/NN-<short>/ + products.json 续 set_no 24-45
注意: Dowinx 新风格4 的 pid 在池子里已有第14套旧版, 新套编新 set_no, 同 pid 不同风格按 README 派给不同账号。
"""
import json, shutil, os, sys

SRC_BASE = "/home/hatch/workspace/新品-双风格-2026-11-21"
DST_BASE = "/home/hatch/workspace/派单系统/data"
JSON_PATH = "/home/hatch/workspace/派单系统/products.json"

# (pid, style_folder, folder_name, title_cn, title_en, style_label)
SETS = [
    ("1732306620069417457", "风格4-沉浸式使用场景", "24-dowinx-电竞椅-风格4",
     "Dowinx 人体工学按摩腰靠电竞椅（带脚踏）", "Dowinx Ergonomic Massage Lumbar Gaming Chair with Footrest",
     "风格 4 沉浸式使用场景"),
    ("1732321182598533162", "风格12-第三人称女装", "25-chemist-风格12",
     "Chemist At Play 三件套（AHA 身体乳 5% + 日常去角质沐浴露 4% + 提亮沐浴露 3%）",
     "Chemist At Play 3-Piece Body Care Set (AHA Body Lotion 5% + Daily Exfoliating Body Wash 4% + Brightening Body Wash 3%)",
     "风格 12 第三人称女装"),
    ("1732321182598533162", "风格13-第一人称女装", "26-chemist-风格13",
     "Chemist At Play 三件套（AHA 身体乳 5% + 日常去角质沐浴露 4% + 提亮沐浴露 3%）",
     "Chemist At Play 3-Piece Body Care Set (AHA Body Lotion 5% + Daily Exfoliating Body Wash 4% + Brightening Body Wash 3%)",
     "风格 13 第一人称女装"),
    ("1729405110248771668", "风格10-痛点类", "27-rhino-绑带-风格10",
     "Rhino USA 棘轮绑带 4 件装", "Rhino USA Retractable Ratchet Tie-Down Straps 4-Pack (Medium-Duty)",
     "风格 10 痛点类"),
    ("1729405110248771668", "风格4-沉浸式使用场景", "28-rhino-绑带-风格4",
     "Rhino USA 棘轮绑带 4 件装", "Rhino USA Retractable Ratchet Tie-Down Straps 4-Pack (Medium-Duty)",
     "风格 4 沉浸式使用场景"),
    ("1729598425179198439", "风格10-痛点类", "29-momcozy-奶瓶机-风格10",
     "Momcozy 奶瓶机（KleanPal Pro 奶瓶清洗消毒烘干一体机）",
     "Momcozy KleanPal Pro Baby Bottle Washer, Sterilizer & Dryer",
     "风格 10 痛点类"),
    ("1729598425179198439", "风格13-第一人称女装", "30-momcozy-奶瓶机-风格13",
     "Momcozy 奶瓶机（KleanPal Pro 奶瓶清洗消毒烘干一体机）",
     "Momcozy KleanPal Pro Baby Bottle Washer, Sterilizer & Dryer",
     "风格 13 第一人称女装"),
    ("1729386045344158341", "风格13-第一人称女装", "31-colorwow-风格13",
     "Color Wow 定型喷雾（Style on Steroids）", "Color Wow Style on Steroids Texture + Finishing Spray",
     "风格 13 第一人称女装"),
    ("1729386045344158341", "风格5-拉踩对比", "32-colorwow-风格5",
     "Color Wow 定型喷雾（Style on Steroids）", "Color Wow Style on Steroids Texture + Finishing Spray",
     "风格 5 拉踩对比"),
    ("1732305963897557680", "风格10-痛点类", "33-shark-风格10",
     "Shark WANDVAC WV201 手持吸尘器（玫瑰金）", "Shark WANDVAC WV201 Cordless Handheld Vacuum (Rose Gold)",
     "风格 10 痛点类"),
    ("1732552230009344024", "风格8-送礼", "34-bluey-风格8",
     "Bluey Toniebox 2 套装（粉色 Toniebox + Bingo/Bluey/Muffin 三只）",
     "Toniebox 2 Bluey Starter Set (Pink Toniebox + Bingo, Bluey & Muffin Tonies)",
     "风格 8 送礼"),
    ("1732552230009344024", "风格4-沉浸式使用场景", "35-bluey-风格4",
     "Bluey Toniebox 2 套装（粉色 Toniebox + Bingo/Bluey/Muffin 三只）",
     "Toniebox 2 Bluey Starter Set (Pink Toniebox + Bingo, Bluey & Muffin Tonies)",
     "风格 4 沉浸式使用场景"),
    ("1730261669388521504", "风格10-痛点类", "36-护颈枕-风格10",
     "护颈枕（X/蝴蝶型记忆棉护颈枕，中间圆孔）", "Contoured Memory Foam Neck Pillow (X/Butterfly Shape)",
     "风格 10 痛点类"),
    ("1730261669388521504", "风格13-第一人称女装", "37-护颈枕-风格13",
     "护颈枕（X/蝴蝶型记忆棉护颈枕，中间圆孔）", "Contoured Memory Foam Neck Pillow (X/Butterfly Shape)",
     "风格 13 第一人称女装"),
    ("1732210098822615777", "风格3-生活化节庆送礼", "38-feppo-保温托盘-风格3",
     "FEPPO 保温托盘（三片式电热保温板）", "FEPPO Electric Warming Tray (3-Panel)",
     "风格 3 生活化节庆送礼"),
    ("1732210098822615777", "风格10-痛点类", "39-feppo-保温托盘-风格10",
     "FEPPO 保温托盘（三片式电热保温板）", "FEPPO Electric Warming Tray (3-Panel)",
     "风格 10 痛点类"),
    ("1731671632272986911", "风格10-痛点类", "40-aopo-滑板车-风格10",
     "AOPO 成人电动滑板车 350W", "AOPO Electric Scooter for Adults 350W",
     "风格 10 痛点类"),
    ("1732309713013542929", "风格3-生活化节庆送礼", "41-面罩-风格3",
     "7 色光疗 LED 美容面罩", "7-Color Light Therapy LED Beauty Face Mask",
     "风格 3 生活化节庆送礼"),
    ("1731934360673161954", "风格4-沉浸式使用场景", "42-毛巾桶-风格4",
     "Sweetcrispy 20L 浴室毛巾烘干桶", "Sweetcrispy 20L Bathroom Towel Warmer",
     "风格 4 沉浸式使用场景"),
    ("1731887330794378206", "风格14-四宫格小红书", "43-运动套装-风格14",
     "女士金拉链运动夹克+打底裤套装", "Women's Gold Zipper Sporty Jacket and Leggings Set",
     "风格 14 四宫格小红书"),
    ("1732837164865458507", "风格9-生活化分享类", "44-红大衣-风格9",
     "男士圣诞老人风红色仿毛边长款大衣（白色仿毛边）",
     "Men's Santa Claus Fleece-Lined Coat, Red Christmas Longline Button-Up Jacket with White Faux Fur Trim",
     "风格 9 生活化分享类"),
    ("1732837164865458507", "风格11-节日", "45-红大衣-风格11",
     "男士圣诞老人风红色仿毛边长款大衣（白色仿毛边）",
     "Men's Santa Claus Fleece-Lined Coat, Red Christmas Longline Button-Up Jacket with White Faux Fur Trim",
     "风格 11 节日"),
]

def main():
    with open(JSON_PATH, encoding="utf-8") as f:
        products = json.load(f)
    existing = {p["set_no"] for p in products}
    assert max(existing) == 23, f"pool max set_no is {max(existing)}, expected 23"
    assert len(products) == 23

    new_entries = []
    for i, (pid, style_folder, folder, cn, en, style) in enumerate(SETS):
        set_no = 24 + i
        src_dir = os.path.join(SRC_BASE, pid, style_folder)
        dst_dir = os.path.join(DST_BASE, folder)
        # verify all 3 images exist at source
        for img in ("图1.jpg", "图2.jpg", "图3.jpg"):
            p = os.path.join(src_dir, img)
            if not os.path.isfile(p):
                print(f"MISSING: {p}")
                sys.exit(1)
        # copy (skip if already there with same size)
        os.makedirs(dst_dir, exist_ok=True)
        for img in ("图1.jpg", "图2.jpg", "图3.jpg"):
            src = os.path.join(src_dir, img)
            dst = os.path.join(dst_dir, img)
            if os.path.isfile(dst) and os.path.getsize(dst) == os.path.getsize(src):
                continue
            shutil.copy2(src, dst)
        # verify destination
        got = sorted(os.listdir(dst_dir))
        assert got == ["图1.jpg", "图2.jpg", "图3.jpg"], f"{dst_dir}: {got}"
        new_entries.append({
            "set_no": set_no,
            "folder": folder,
            "pid": pid,
            "title_cn": cn,
            "title_en": en,
            "style": style,
            "images": ["图1.jpg", "图2.jpg", "图3.jpg"],
            "zip": f"第{set_no}套.zip",
        })
        print(f"ok set {set_no}: {folder}")

    products.extend(new_entries)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(products, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"products.json now has {len(products)} sets, max set_no {max(p['set_no'] for p in products)}")

if __name__ == "__main__":
    main()
