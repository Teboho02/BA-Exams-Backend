import os

def build_tree(start_path='.', prefix=''):
    output_lines = []

    try:
        entries = sorted(os.listdir(start_path))
    except PermissionError:
        return output_lines

    # Filter out hidden files/folders and node_modules
    entries = [
        entry for entry in entries
        if not entry.startswith('.') and entry != 'node_modules'
    ]

    for index, entry in enumerate(entries):
        path = os.path.join(start_path, entry)
        is_last = index == len(entries) - 1
        connector = '└── ' if is_last else '├── '

        output_lines.append(prefix + connector + entry)

        if os.path.isdir(path):
            new_prefix = prefix + ('    ' if is_last else '│   ')
            output_lines.extend(build_tree(path, new_prefix))

    return output_lines

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Tree view excluding node_modules and hidden files/folders')
    parser.add_argument('directory', nargs='?', default='.', help='Directory to scan')
    args = parser.parse_args()

    lines = [args.directory]
    lines += build_tree(args.directory)

    with open('file.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print('Directory tree saved to file.txt')
