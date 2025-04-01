import os
import re
import argparse
from pathlib import Path

# --- Configuration ---
SRC_DIR = Path("src")
OLD_COMPONENTS_REL_PATH = Path("components")
NEW_COMPONENTS_REL_PATH = Path("cli/components")
# --- End Configuration ---

# Pre-calculate absolute paths
WORKSPACE_ROOT = Path(os.getcwd()) # Assumes script is run from workspace root
SRC_ABS_PATH = (WORKSPACE_ROOT / SRC_DIR).resolve()
OLD_COMPONENTS_ABS_PATH = (WORKSPACE_ROOT / SRC_DIR / OLD_COMPONENTS_REL_PATH).resolve()
NEW_COMPONENTS_ABS_PATH = (WORKSPACE_ROOT / SRC_DIR / NEW_COMPONENTS_REL_PATH).resolve()

# Regex to find relative imports (handles './' and '../')
# Captures: group 1=quote type (', "), group 2=relative path
IMPORT_REGEX = re.compile(r"import\s+(?:.+?\s+from\s+)?(['\"])([.][^'\"]+)\1")

def is_relative_to(path: Path, base: Path) -> bool:
    """Checks if a path is relative to a base path."""
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False

def update_file_imports(file_path: Path, dry_run: bool):
    """Processes a single file to update imports."""
    try:
        content = file_path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return

    lines = content.splitlines()
    new_lines = list(lines)
    file_modified = False
    current_file_abs_path = file_path.resolve()
    current_file_dir = current_file_abs_path.parent

    is_file_in_new_components = is_relative_to(current_file_abs_path, NEW_COMPONENTS_ABS_PATH)

    print(f"--- Processing: {file_path.relative_to(WORKSPACE_ROOT)} {'(in new components)' if is_file_in_new_components else ''}")

    for i, line in enumerate(lines):
        match = IMPORT_REGEX.search(line)
        if match:
            quote_char = match.group(1)
            original_relative_path_str = match.group(2)
            original_import_statement = match.group(0) # Full matched import part (e.g., from './path')

            # Resolve the absolute path of the imported module based on the *original* import
            imported_module_abs_path = (current_file_dir / original_relative_path_str).resolve()

            new_relative_path_str = None

            # --- Scenario A: File is OUTSIDE new_components, importing from OLD_components ---
            if not is_file_in_new_components and is_relative_to(imported_module_abs_path, OLD_COMPONENTS_ABS_PATH):
                # Calculate path relative to old components base
                path_within_components = imported_module_abs_path.relative_to(OLD_COMPONENTS_ABS_PATH)
                # Calculate new absolute path
                new_imported_module_abs_path = (NEW_COMPONENTS_ABS_PATH / path_within_components).resolve()
                # Calculate new relative path from current file to the new location
                new_relative_path = Path(os.path.relpath(new_imported_module_abs_path, current_file_dir))
                # Format for import statement (use forward slashes, add ./ if needed)
                new_relative_path_str = str(new_relative_path.as_posix())
                if not new_relative_path_str.startswith(("../", "./")):
                    new_relative_path_str = "./" + new_relative_path_str
                print(f"  [OUT->OLD] Matched: {original_relative_path_str}")
                print(f"             -> New: {new_relative_path_str}")


            # --- Scenario B: File is INSIDE new_components, importing from OUTSIDE old_components ---
            # Check if import is *not* pointing within the old components dir (or new dir - handled implicitly)
            elif is_file_in_new_components and not is_relative_to(imported_module_abs_path, OLD_COMPONENTS_ABS_PATH):
                 # Target absolute path hasn't changed, but the *source* file moved. Recalculate relative path.
                 # Exception: If the import was already relative *within* components, it shouldn't change much,
                 # but recalculating is safest. Let's just always recalculate if source is inside new dir.
                 new_relative_path = Path(os.path.relpath(imported_module_abs_path, current_file_dir))
                 new_relative_path_str_temp = str(new_relative_path.as_posix())
                 if not new_relative_path_str_temp.startswith(("../", "./")):
                    new_relative_path_str_temp = "./" + new_relative_path_str_temp

                 # Only update if the recalculated path is different (handles imports within moved dir)
                 if new_relative_path_str_temp != original_relative_path_str:
                    new_relative_path_str = new_relative_path_str_temp
                    print(f"  [IN->OUT] Matched: {original_relative_path_str}")
                    print(f"            -> New: {new_relative_path_str}")


            # --- Apply Update ---
            if new_relative_path_str:
                # Replace only the path part within the original statement match
                # This is safer than rebuilding the whole line
                new_import_statement = original_import_statement.replace(original_relative_path_str, new_relative_path_str)
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
    # else:
    #     print(f"    -> No changes needed.")


def main():
    parser = argparse.ArgumentParser(description="Update TypeScript import paths after moving components directory.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show proposed changes without modifying files."
    )
    args = parser.parse_args()

    print("Scripta Import Path Updater")
    print("===========================")
    print(f"Source Root: {SRC_ABS_PATH}")
    print(f"Old Components: {OLD_COMPONENTS_ABS_PATH}")
    print(f"New Components: {NEW_COMPONENTS_ABS_PATH}")
    if args.dry_run:
        print("\n*** DRY RUN MODE - NO FILES WILL BE MODIFIED ***\n")
    else:
        confirm = input("\n*** WARNING: This script will modify files in place. Make sure you have backups or use Git. Type 'yes' to continue: ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            return

    # Ensure target directory exists before processing files *within* it
    if not NEW_COMPONENTS_ABS_PATH.exists():
         print(f"Error: New components directory does not exist: {NEW_COMPONENTS_ABS_PATH}")
         print("Please move the files manually first.")
         return

    for root, dirs, files in os.walk(SRC_ABS_PATH):
        # Skip node_modules and potentially other build/ignored dirs
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', 'build')] # Modify dirs in-place

        for filename in files:
            if filename.endswith((".ts", ".tsx")):
                file_path = Path(root) / filename
                # Avoid processing files within the *old* components dir if it still exists somehow
                if not is_relative_to(file_path.resolve(), OLD_COMPONENTS_ABS_PATH):
                     update_file_imports(file_path, args.dry_run)

    print("\nProcessing complete.")
    if args.dry_run:
         print("Dry run finished. No files were changed.")
    else:
         print("File updates finished. Please review the changes.")


if __name__ == "__main__":
    main()