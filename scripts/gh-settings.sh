#!/usr/bin/env bash
# GitHub repository settings for promotion (Phase 0). Run it yourself after
# `gh auth login` with an account that administers Lokkisanek/Dash.
# Idempotent: running it again sets the same values. Uses no secrets.
#
# Not covered (no supported API): Settings -> General -> Social preview
# (upload docs/img/social-preview.png) and the Discussions categories.
set -euo pipefail

REPO="Lokkisanek/Dash"

gh repo edit "$REPO" \
  --description "iOS-style wall & guest dashboard for Home Assistant - installable PWA, locked guest mode, HACS integration" \
  --homepage "https://dash.matyas.online" \
  --enable-issues \
  --enable-discussions \
  --add-topic home-assistant \
  --add-topic homeassistant \
  --add-topic hacs \
  --add-topic hacs-integration \
  --add-topic dashboard \
  --add-topic pwa \
  --add-topic vue \
  --add-topic vuejs \
  --add-topic tailwindcss \
  --add-topic daisyui \
  --add-topic wall-panel \
  --add-topic kiosk \
  --add-topic smart-home \
  --add-topic guest-mode \
  --add-topic ios-style \
  --add-topic self-hosted

# Private vulnerability reporting (Security tab -> "Report a vulnerability")
gh api --method PUT "repos/$REPO/private-vulnerability-reporting" --silent

echo "--- read-back ---"
gh repo view "$REPO" --json description,homepageUrl,repositoryTopics,hasIssuesEnabled,hasDiscussionsEnabled
gh api "repos/$REPO/private-vulnerability-reporting"
