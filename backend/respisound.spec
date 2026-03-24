import sys
from pathlib import Path

# SPECPATH is provided by PyInstaller — the directory containing this spec file.
ICON_PATH = str(Path(SPECPATH) / '../tauri-app/src-tauri/icons/icon.ico')

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[str(Path('backend').resolve())],
    binaries=[],
    datas=[
        ('model/', 'model/'),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'fastapi',
        'pydantic',
        'pydantic.deprecated.class_validators',
        'pydantic.deprecated.config',
        'pydantic.deprecated.tools',
        'starlette',
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'anyio',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
        'torch',
        'numpy',
        'sqlite3',
        'model_definition',
        'librosa',
        'librosa.core',
        'librosa.feature',
        'librosa.util',
        'soundfile',
        'scipy',
        'scipy.fft',
        'scipy.fftpack',
        'matplotlib',
        'matplotlib.pyplot',
        'matplotlib.backends.backend_agg',
        'matplotlib.figure',
        'matplotlib.colors',
        'matplotlib._cm_listed',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'IPython',
        'jupyter',
        'notebook',
        # Exclude CUDA/GPU libs — app uses CPU inference only
        'nvidia',
        'nvidia.cublas',
        'nvidia.cuda_cupti',
        'nvidia.cuda_nvrtc',
        'nvidia.cuda_runtime',
        'nvidia.cudnn',
        'nvidia.cufft',
        'nvidia.cufile',
        'nvidia.curand',
        'nvidia.cusolver',
        'nvidia.cusparse',
        'nvidia.cusparselt',
        'nvidia.nccl',
        'nvidia.nvshmem',
        'nvidia.nvjitlink',
        'nvidia.nvtx',
        'triton',
        'tensorboard',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='respisound-api',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX triggers Windows Defender heuristics — keep off
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON_PATH,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,          # UPX triggers Windows Defender heuristics — keep off
    upx_exclude=[],
    name='respisound-api',
)
