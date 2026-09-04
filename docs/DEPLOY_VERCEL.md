Vercel deployment notes

1) Connect your GitHub repository to Vercel (Import Project → GitHub).
2) Build command: npm run build
3) Output directory: dist (vite default). A vercel.json is present to enforce this.
4) Add domains in Vercel dashboard (nobleframe.art, OmegaAtelier.Online). Vercel will display DNS records to add.

DNS guidance (Spaceship registrar):
- Prefer: add the records Vercel shows (usually an A record for the apex or a CNAME for www).
- Alternatively: change nameservers to Vercel's nameservers (simpler if you want Vercel to manage DNS).

Notes:
- Vercel provides automatic HTTPS and deploy previews for PRs.
- If you prefer GitHub Pages instead, let me know and I will prepare a GH Action to publish.
