import os

parts = [
    'part_01_head.html',
    'part_02_body.html',
    'part_03_engine.html',
    'part_03b_bgm.html',
    'part_04_act1.html',
    'part_05_act2.html',
    'part_06_act3.html',
    'part_07_act4.html',
    'part_14_endings_full.html',
]

output_path = os.path.join(os.path.dirname(__file__), 'index.html')

with open(output_path, 'w', encoding='utf-8') as outfile:
    for part in parts:
        part_path = os.path.join(os.path.dirname(__file__), part)
        with open(part_path, 'r', encoding='utf-8') as infile:
            outfile.write(infile.read())
            outfile.write('\n')

print(f"Successfully assembled index.html ({os.path.getsize(output_path)} bytes)")
