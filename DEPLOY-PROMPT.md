# Markdown Mate - Deploy Prompt for Claude Code

Paste this entire block into Claude Code to vendor the dependencies, push to GitHub, and enable Pages. Run it in one go.

```
cd "C:\Users\Adam\source\repos\markdown-mate"

# 1. Create vendor folder and download the five third-party files
mkdir -p vendor
curl -fSL -o vendor/marked.min.js        "https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js"
curl -fSL -o vendor/purify.min.js        "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"
curl -fSL -o vendor/highlight.min.js     "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js"
curl -fSL -o vendor/github.min.css       "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css"
curl -fSL -o vendor/github-dark.min.css  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css"

# 2. Verify all five files exist and are non-empty
ls -la vendor/
echo ""
echo "Expected: 5 files, each > 1KB. Fail and stop if any are 0 bytes."

# 3. Stage everything, including new vendor folder
git add -A
git status

# 4. Commit
git commit -m "Vendor dependencies, remove Ko-fi link, add README + LICENSE, ship v1"

# 5. Create GitHub repo under buildwithbaker org and push
#    (gh CLI must be authenticated as buildwithbaker)
gh repo create buildwithbaker/markdown-mate --public --source=. --remote=origin --push --description "Lightweight PWA .md file reader. Open any markdown file and see it rendered. Files stay on your computer."

# 6. Enable GitHub Pages from main branch root
gh api -X POST "repos/buildwithbaker/markdown-mate/pages" -f "source[branch]=main" -f "source[path]=/"

# 7. Print the live URL (will be available in ~30-60 seconds)
echo ""
echo "Live URL (give it ~1 min to deploy): https://buildwithbaker.github.io/markdown-mate/"
```

## After it runs

1. Visit `https://buildwithbaker.github.io/markdown-mate/` - give it a minute for first Pages deploy
2. Open a `.md` file to confirm it renders
3. Install as PWA (Chrome address bar install icon) to verify offline
4. Share the URL with the STA team

## If anything fails

- **`curl` 404** - the CDN URL changed. Re-fetch fresh URL from the lib's docs and retry.
- **`gh repo create` "already exists"** - the repo was made earlier. Run instead:
  ```
  git remote add origin https://github.com/buildwithbaker/markdown-mate.git
  git push -u origin main
  ```
- **`gh api` Pages error 409 "already enabled"** - Pages was already on. Ignore.
- **Pages 404 after 5 minutes** - check `gh repo view buildwithbaker/markdown-mate --web` Settings -> Pages and confirm source is main / root.
