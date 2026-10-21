#!/usr/bin/env python3
"""Build runtime-only ZIPs and an optional locally signed CRX without copying secrets."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_zip(destination, contents):
    # Fixed timestamps and permissions make identical sources produce identical ZIPs.
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(contents.items()):
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    check_zip(destination, contents)


def check_zip(source, expected):
    with zipfile.ZipFile(source) as archive:
        # Chrome's CRX ZIP includes directory entries; our ZIP writer only emits files.
        actual = [entry.filename for entry in archive.infolist() if not entry.is_dir()]
        directories = {str(parent) + '/' for name in expected for parent in Path(name).parents if str(parent) != '.'}
        if any(entry.is_dir() and entry.filename not in directories for entry in archive.infolist()):
            raise RuntimeError(f'Unexpected archive directory: {source.name}')
        if archive.testzip() is not None or sorted(actual) != sorted(expected):
            raise RuntimeError(f'Archive integrity/file list mismatch: {source.name}')
        for name, data in expected.items():
            if archive.read(name) != data:
                raise RuntimeError(f'Archive content mismatch: {name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--crx', action='store_true', help='Also sign a CRX using local Chrome and OpenSSL')
    parser.add_argument('--chrome', help='Chrome/Chromium executable path')
    parser.add_argument('--output-dir', type=Path, help='Use a new output directory without replacing an earlier build')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    version = manifest['version']
    if not re.fullmatch(r'\d+(?:\.\d+){0,3}', version):
        raise RuntimeError('Invalid manifest version')
    destination = (ROOT / args.output_dir).resolve() if args.output_dir else ROOT / 'dist' / f'v{version}'
    if destination.exists():
        raise RuntimeError(f'Existing release preserved: {destination}. Use a new version for a new build.')

    files = sorted(set([
        'manifest.json', 'panel.html', 'privacy.html', 'css/style.css',
        'lib/lightweight-charts.standalone.js',
        *manifest['icons'].values(),
        *(str(path.relative_to(ROOT)) for path in (ROOT / 'js').glob('*.js')),
    ]))
    for name in files:
        if not (ROOT / name).is_file() or (ROOT / name).is_symlink():
            raise RuntimeError(f'Missing/nonregular runtime file: {name}')
    referenced = re.findall(r'<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"', (ROOT / 'panel.html').read_text())
    referenced += [manifest['background']['service_worker'], manifest['side_panel']['default_path']]
    if any(name not in files for name in referenced):
        raise RuntimeError('A manifest/HTML asset is missing from the runtime allowlist')
    for name in files:
        if name.endswith('.js'):
            subprocess.run(['node', '--check', str(ROOT / name)], check=True)
    tests = sorted(str(path) for path in (ROOT / 'js' / '__tests__').glob('*.test.js'))
    subprocess.run(['node', '--test', *tests], cwd=ROOT, check=True)
    contents = {name: (ROOT / name).read_bytes() for name in files}
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='.build-', dir=destination.parent) as work:
        work = Path(work)
        output = work / f'v{version}'
        output.mkdir()
        folder_name = f'stock-pulse-v{version}'
        unpacked = output / folder_name
        for name, data in contents.items():
            target = unpacked / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        store = output / f'{folder_name}-webstore.zip'
        install = output / f'{folder_name}-install.zip'
        instructions = f'''Stock Pulse v{version} 安装说明

1. 将整个安装 ZIP 解压到一个长期保留的目录。
2. Chrome 打开 chrome://extensions/；Edge 打开 edge://extensions/。
3. 开启“开发者模式”，选择“加载已解压的扩展程序”。
4. 选择 {folder_name} 文件夹（里面直接包含 manifest.json）。
5. 点击浏览器工具栏的 Stock Pulse 图标打开侧边栏。

更新已有解压版时，可先导出备份，再将新版运行文件复制到原扩展目录并点击重新加载。
普通 Windows/macOS Chrome 对商店外 CRX 安装有限制；请使用上述解压加载方式。
商店发布请上传单独的 *-webstore.zip，不要上传本安装 ZIP。
签名 CRX 使用本地签名身份，不代表原有商店条目的签名身份。
本包不包含个人设置、API Key、签名私钥、测试或开发工具文件。
'''.encode()
        write_zip(store, contents)
        write_zip(install, {f'{folder_name}/{name}': data for name, data in contents.items()} | {'INSTALL.txt': instructions})
        artifacts = [install, store]

        if args.crx:
            chrome = args.chrome or shutil.which('google-chrome') or shutil.which('chromium')
            if not chrome:
                raise RuntimeError('Chrome/Chromium is required for --crx')
            private_dir = ROOT / '.local' / 'release'
            private_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            key = private_dir / 'chrome-signing-key.pem'
            if key.is_symlink():
                raise RuntimeError('Signing key must be a regular private file')
            if not key.exists():
                previous_umask = os.umask(0o077)
                try:
                    subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)], check=True, stderr=subprocess.DEVNULL)
                finally:
                    os.umask(previous_umask)
            key.chmod(0o600)
            env = dict(os.environ, XDG_CONFIG_HOME=str(work / 'config'), XDG_CACHE_HOME=str(work / 'cache'))
            subprocess.run([chrome, '--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--disable-breakpad', f'--user-data-dir={work / "profile"}', f'--pack-extension={unpacked}', f'--pack-extension-key={key}'], env=env, check=True, timeout=60, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            crx = output / f'{folder_name}.crx'
            raw = crx.read_bytes()
            if len(raw) < 12 or raw[:4] != b'Cr24' or struct.unpack_from('<I', raw, 4)[0] != 3:
                raise RuntimeError('Chrome did not produce a CRX3 package')
            header_end = 12 + struct.unpack_from('<I', raw, 8)[0]
            if raw[header_end:header_end + 4] != b'PK\x03\x04':
                raise RuntimeError('Invalid CRX3 embedded ZIP offset')
            check_zip(crx, contents)
            artifacts.append(crx)

        hashes = {artifact.name: digest(artifact.read_bytes()) for artifact in artifacts}
        (output / 'SHA256SUMS').write_text(''.join(f'{sha}  {name}\n' for name, sha in sorted(hashes.items())))
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
        tracked_files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', head, '--', *files], cwd=ROOT, check=True, capture_output=True, text=True).stdout.splitlines()
        runtime_matches_head = sorted(tracked_files) == files and subprocess.run(['git', 'diff', '--quiet', head, '--', *files], cwd=ROOT).returncode == 0
        receipt = {'version': version, 'source_git_head': head, 'source_has_uncommitted_changes': bool(subprocess.run(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()), 'runtime_matches_git_head': runtime_matches_head, 'runtime_files': {name: digest(data) for name, data in contents.items()}, 'artifacts': hashes, 'checks': ['JavaScript syntax', 'automated tests', 'ZIP integrity', 'runtime file/content equality'] + (['CRX3 header and embedded ZIP content'] if args.crx else [])}
        (output / 'BUILD.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        shutil.copyfile(ROOT / f'RELEASE_NOTES_v{version}.md', output / 'RELEASE_NOTES.md')
        output.rename(destination)
    for artifact in sorted(destination.iterdir()):
        print(artifact)


if __name__ == '__main__':
    main()
