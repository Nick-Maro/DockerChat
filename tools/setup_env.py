"""Create local DockerChat configuration with fresh credentials (standard library only)."""
import argparse
from pathlib import Path
import secrets


def create_environment(template: Path, target: Path) -> None:
    replacements = {
        "REDIS_PASSWORD": secrets.token_urlsafe(32),
        "SECRET_KEY": secrets.token_hex(32),
        "ADMIN_PASSWORD": secrets.token_urlsafe(24),
    }
    lines = template.read_text(encoding="utf-8").splitlines()
    content = "\n".join(
        f"{line.split('=', 1)[0]}={replacements[line.split('=', 1)[0]]}"
        if "=" in line and line.split("=", 1)[0] in replacements else line
        for line in lines
    ) + "\n"
    # Exclusive creation preserves existing credentials and persistent dashboard logins.
    with target.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    try:
        target.chmod(0o600)
    except OSError:
        pass  # Windows permissions are managed through ACLs.


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=root / ".env")
    args = parser.parse_args()
    try:
        create_environment(root / ".env.template", args.output)
    except FileExistsError:
        parser.exit(1, f"Configuration already exists: {args.output}. It was left unchanged.\n")
    print(f"Created {args.output}. Read ADMIN_PASSWORD there before signing in; keep this file private.")


if __name__ == "__main__":
    main()
