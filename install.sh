#!/usr/bin/env bash
# Links (or copies, with --copy) every folder of this repository into
# ~/.claude/skills so Claude Code can load the dr-* skills.
#
#   ./install.sh           symlink each folder
#   ./install.sh --copy    copy instead (if your Claude Code does not follow symlinks)
#   ./install.sh --remove  remove what this script installed
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mode="${1:-link}"
mkdir -p "$target"

# A folder renamed or removed in this repository leaves a dangling link behind
# (the former ud-* names, for instance): remove links into this repository that
# point at nothing.
for link in "$target"/*; do
  [ -L "$link" ] || continue
  case "$(readlink "$link")" in
    "$repo"/*) [ -e "$link" ] || { rm "$link"; echo "removed stale $(basename "$link")"; } ;;
  esac
done

for dir in "$repo"/dr "$repo"/dr-*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  dest="$target/$name"
  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    if [ -f "$dest/.dr-installed" ]; then
      rm -rf "$dest"
    else
      echo "skip  $name: $dest exists and was not installed by this script" >&2
      continue
    fi
  fi
  case "$mode" in
    --remove) echo "removed $name" ;;
    --copy) cp -R "$dir" "$dest"; touch "$dest/.dr-installed"; echo "copied  $name" ;;
    *) ln -s "$dir" "$dest"; echo "linked  $name" ;;
  esac
done
