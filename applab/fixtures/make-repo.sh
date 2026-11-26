#!/usr/bin/env bash
# A small repository with a shape: three commits, a branch besides main, and a
# file that moved in the last one. Fixed identity and dates, so two runs make
# the same history on any machine and a spec can name its commits.
#
#   applab/fixtures/make-repo.sh /tmp/somewhere/fixture
set -euo pipefail

dir="${1:?usage: make-repo.sh <dir>}"
rm -rf "$dir"
mkdir -p "$dir"
cd "$dir"

git init -q -b main
git config user.name "App Lab"
git config user.email "applab@example.com"
git config commit.gpgsign false
git config tag.gpgsign false
git config core.hooksPath no-hooks
git config core.autocrlf false

# One date per commit, so the history is stable without a clock in the lab.
commit() { # message, date
  git add -A
  GIT_AUTHOR_DATE="$2" GIT_COMMITTER_DATE="$2" git commit -qm "$1"
}

printf '# Fixture\n\nA small repository the app lab opens.\n' > README.md
commit "seed the fixture" "2024-01-01T09:00:00 +0000"

printf '# Reading list\n\n- git for computer scientists\n' > notes.md
printf 'export const answer = 42\n' > app.ts
commit "add the reading list" "2024-01-02T09:00:00 +0000"

# A branch that left main two commits ago, so the two are not the same line.
git branch feature/login

mkdir -p docs
git mv notes.md docs/notes.md
commit "move the notes under docs" "2024-01-03T09:00:00 +0000"

git branch --format='%(refname:short)' | tr '\n' ' '
printf 'in %s\n' "$dir"
