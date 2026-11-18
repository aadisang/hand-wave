"""Download the pinned inference models without Git LFS. Requires Python 3.11+."""

import hashlib
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

MODEL_DIR = Path(__file__).resolve().parents[1] / "apps/inference/models"
RELEASE_URL = "https://github.com/aadisang/hand-wave/releases/download/models-v1"
MODELS = {
    "best.ckpt": "de171ee30748b1c637014f43e1e97ca93186a72882e68d655cad5c63bff773e1",
    "lm/neutral_english_4gram.kenlm": (
        "860b3bcf8cb9fd75377cf4cb5a304047372493f1e1c68cba054ecf874fba806a"
    ),
}


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main() -> None:
    for name, expected in MODELS.items():
        destination = MODEL_DIR / name
        if destination.is_file() and digest(destination) == expected:
            print(f"Verified {name}", flush=True)
            continue

        destination.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {name}", flush=True)
        with NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            try:
                with urlopen(
                    f"{RELEASE_URL}/{destination.name}", timeout=120
                ) as response:
                    shutil.copyfileobj(response, temporary)
                temporary.close()
                if digest(temporary_path) != expected:
                    raise ValueError(f"SHA-256 mismatch for {name}")
                temporary_path.replace(destination)
            finally:
                temporary_path.unlink(missing_ok=True)
        print(f"Verified {name}", flush=True)


if __name__ == "__main__":
    main()
