#!/bin/sh
# Wraps src/page.html (the editable source) into a deployable index.html.
cd "$(dirname "$0")" && {
  printf '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  cat src/page.html
  printf '</html>\n'
} > index.html
