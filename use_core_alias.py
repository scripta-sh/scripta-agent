import os
import re
import argparse
from pathlib import Path

# --- Configuration ---
SRC_DIR = Path("src")
CORE_DIR_REL_PATH = Path("core")
# Directories to process for updating imports
TARGET_DIRS_REL = [Path("cli"), Path("entrypoints")]
# --- End Configuration ---

# Pre-calculate absolute paths
WORKSPACE_ROOT = Path(os.getcwd()) # Assumes script is run from workspace root
SRC_ABS_PATH = (WORKSPACE_ROOT / SRC_DIR).resolve()
CORE_ABS_PATH = (WORKSPACE_ROOT / SRC_DIR / CORE_DIR_REL_PATH).resolve()
TARGET_ABS_DIRS = [(WORKSPACE_ROOT / SRC_DIR / d).resolve() for d in TARGET_DIRS_REL]

# Regex to find relative imports potentially pointing to core
# Captures: group 1=quote type (', "), group 2=relative path starting with ../
IMPORT_REGEX = re.compile(r"import\s+(?:.+?\s+from\s+)?(['\"])([.]{2}/[^'\"]+)\1")

def is_relative_to(path: Path, base: Path) -> bool:
    """Checks if a path is relative to a base path."""
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False

def update_file_imports(file_path: Path, dry_run: bool):
    """Processes a single file to update relative core imports to aliases."""
    try:
        content = file_path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  -> Error reading {file_path.relative_to(WORKSPACE_ROOT)}: {e}")
        return

    lines = content.splitlines()
    new_lines = list(lines)
    file_modified = False
    current_file_dir = file_path.parent # Absolute dir of the current file

    print(f"--- Processing: {file_path.relative_to(WORKSPACE_ROOT)}")

    for i, line in enumerate(lines):
        match = IMPORT_REGEX.search(line)
        if match:
            quote_char = match.group(1)
            original_relative_path_str = match.group(2) # e.g., ../../core/utils/file
            original_import_statement = match.group(0)

            # Resolve the absolute path of the imported module
            imported_module_abs_path = (current_file_dir / original_relative_path_str).resolve()

            # Check if the resolved path is within the core directory
            if is_relative_to(imported_module_abs_path, CORE_ABS_PATH):
                # Calculate path relative *to* the core directory base
                path_within_core = imported_module_abs_path.relative_to(CORE_ABS_PATH)
                # Construct the alias path
                alias_path_str = f"@core/{path_within_core.as_posix()}"
                # Remove potential trailing '.ts' or '.tsx' if present (TypeScript handles resolution)
                alias_path_str = re.sub(r'\\.(ts|tsx)$', '', alias_path_str)

                print(f"  [Alias] Matched relative: {original_relative_path_str}")
                print(f"          -> Alias:        {alias_path_str}")

                # Replace the path part
                new_import_statement = original_import_statement.replace(original_relative_path_str, alias_path_str)
                new_lines[i] = line.replace(original_import_statement, new_import_statement)
                file_modified = True


    if file_modified:
        print(f"    -> File needs update.")
        if not dry_run:
            try:
                new_content = "\n".join(new_lines)
                # Add trailing newline if original content had one
                if content.endswith('\n'):
                    new_content += '\n'
                file_path.write_text(new_content, encoding='utf-8')
                print(f"    -> UPDATED: {file_path.relative_to(WORKSPACE_ROOT)}")
            except Exception as e:
                print(f"    -> ERROR writing {file_path}: {e}")
        else:
             print(f"    -> DRY RUN: Would update {file_path.relative_to(WORKSPACE_ROOT)}")

def main():
    parser = argparse.ArgumentParser(description="Update relative src/core imports to use the @core/* alias.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show proposed changes without modifying files."
    )
    args = parser.parse_args()

    print("Core Alias Updater Script")
    print("=========================")
    print(f"Processing directories: {[str(d.relative_to(WORKSPACE_ROOT)) for d in TARGET_ABS_DIRS]}")
    print(f"Replacing relative imports pointing inside: {CORE_ABS_PATH}")
    if args.dry_run:
        print("\n*** DRY RUN MODE - NO FILES WILL BE MODIFIED ***\n")
    else:
        confirm = input("\n*** WARNING: This script will modify files in place. Make sure you have backups or use Git. Type 'yes' to continue: ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            return

    processed_files = 0
    for target_dir in TARGET_ABS_DIRS:
        if not target_dir.exists():
            print(f"Warning: Target directory not found, skipping: {target_dir}")
            continue

        for root, dirs, files in os.walk(target_dir):
            # Skip node_modules etc.
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', 'build')]

            for filename in files:
                if filename.endswith((".ts", ".tsx")):
                    file_path = Path(root) / filename
                    update_file_imports(file_path, args.dry_run)
                    processed_files += 1

    print(f"\nProcessing complete. Checked {processed_files} files.")
    if args.dry_run:
         print("Dry run finished. No files were changed.")
    else:
         print("File updates finished. Please review the changes with 'git diff'.")


if __name__ == "__main__":
    main()