// Build metadata + images for the showcase.
// Requires GH_TOKEN (secret) and projects.json at repo root.
// Node 20+ (global fetch). No external deps.

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT_JSON = path.join(ROOT, "src/data/repos.json");
const SHOTS_DIR = path.join(ROOT, "assets/img/screenshots");
const PROFILE_IMG = path.join(ROOT, "assets/img/profile.jpg");

const token = process.env.GH_TOKEN || "";
if (!token) {
  console.error("Missing GH_TOKEN in env.");
  process.exit(1);
}
const authHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  Authorization: `Bearer ${token}`,
};

const projectsCfg = JSON.parse(await fs.readFile(path.join(ROOT, "projects.json"), "utf8"));
const USER = projectsCfg.username;

async function getJSON(url) {
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
async function downloadTo(url, filepath) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await ensureDir(path.dirname(filepath));
  await fs.writeFile(filepath, buf);
}

function normalizeLangPercents(langBytes) {
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0) || 0;
  if (!total) return {};
  const entries = Object.entries(langBytes)
    .map(([k, v]) => [k, (v / total) * 100])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const sumTop = entries.reduce((a, [, v]) => a + v, 0);
  return Object.fromEntries(entries.map(([k, v]) => [k, +(v * (100 / sumTop)).toFixed(1)]));
}

async function pickScreenshot(user, repo) {
  // 1) Try README first image (markdown or HTML)
  try {
    const readme = await getJSON(`https://api.github.com/repos/${user}/${repo}/readme`);
    if (readme?.download_url) {
      const md = await getText(readme.download_url);
      // markdown ![alt](url) or HTML <img src="...">
      const mdImg = md.match(/!\[[^\]]*]\(([^)]+)\)/);
      const htmlImg = md.match(/<img[^>]+src=["']([^"']+)["']/i);
      const url = (mdImg?.[1] || htmlImg?.[1] || "").trim();
      if (url && /^https?:\/\//i.test(url)) return url;
      // If relative path, construct raw URL
      if (url && !/^https?:\/\//i.test(url)) {
        return `https://raw.githubusercontent.com/${user}/${repo}/HEAD/${url.replace(/^\.?\//, "")}`;
      }
    }
  } catch (e) {
    /* ignore */
  }

  // 2) Try common file names/locations via contents API
  const candidates = [
    "screenshot.png", "screenshot.jpg", "screenshot.jpeg", "screenshot.webp",
    "preview.png", "preview.jpg", "hero.png", "banner.png",
    "docs/screenshot.png", "docs/preview.png", "docs/hero.png",
    "assets/screenshot.png", "assets/preview.png", "assets/hero.png",
  ];
  for (const p of candidates) {
    try {
      const info = await getJSON(`https://api.github.com/repos/${user}/${repo}/contents/${p}`);
      if (info?.download_url) return info.download_url;
    } catch {/* try next */}
  }

  return ""; // not found
}

async function getReposList() {
  if (projectsCfg.include && projectsCfg.include.length) {
    // fetch and order by include list
    const repoObjs = [];
    for (const name of projectsCfg.include) {
      try {
        const r = await getJSON(`https://api.github.com/repos/${USER}/${name}`);
        repoObjs.push(r);
      } catch {
        console.warn(`Skip missing repo: ${name}`);
      }
    }
    return repoObjs;
  }
  // fallback: recent public repos minus excludes
  const all = await getJSON(`https://api.github.com/users/${USER}/repos?per_page=100&sort=updated`);
  const ex = new Set((projectsCfg.exclude || []).map(s => s.toLowerCase()));
  return all.filter(r => !ex.has(r.name.toLowerCase()));
}

async function main() {
  await ensureDir(path.dirname(OUT_JSON));
  await ensureDir(SHOTS_DIR);

  // Profile picture
  const userInfo = await getJSON(`https://api.github.com/users/${USER}`);
  if (userInfo?.avatar_url) {
    await downloadTo(userInfo.avatar_url, PROFILE_IMG);
  }

  const repos = await getReposList();
  const out = [];
  for (const r of repos) {
    const [langsRaw, branchesCount, commits] = await Promise.all([
      getJSON(`https://api.github.com/repos/${USER}/${r.name}/languages`).catch(() => ({})),
      // efficient branch count via Link header
      (async () => {
        const res = await fetch(`https://api.github.com/repos/${USER}/${r.name}/branches?per_page=1`, { headers: authHeaders });
        if (!res.ok) return null;
        const link = res.headers.get("Link");
        if (link && /rel="last"/.test(link)) {
          const m = link.match(/[\?&]page=(\d+)>;\s*rel="last"/);
          if (m) return parseInt(m[1], 10);
        }
        const arr = await res.json();
        return Array.isArray(arr) ? arr.length : null;
      })().catch(() => null),
      getJSON(`https://api.github.com/repos/${USER}/${r.name}/commits?sha=${encodeURIComponent(r.default_branch || "main")}&per_page=1`).catch(() => []),
    ]);

    const lastCommit = Array.isArray(commits) && commits[0]?.commit?.committer?.date || null;

    // Screenshot
    let shotUrl = "";
    try {
      shotUrl = await pickScreenshot(USER, r.name);
      if (shotUrl) {
        const ext = (shotUrl.split(".").pop() || "jpg").toLowerCase();
        const safeExt = ["png","jpg","jpeg","webp"].includes(ext) ? ext : "jpg";
        await downloadTo(shotUrl, path.join(SHOTS_DIR, `${r.name}.${safeExt}`));
        // normalize extension to .jpg on disk for simplicity
        if (safeExt !== "jpg") {
          const src = path.join(SHOTS_DIR, `${r.name}.${safeExt}`);
          const dst = path.join(SHOTS_DIR, `${r.name}.jpg`);
          await fs.copyFile(src, dst);
          await fs.rm(src);
        }
      }
    } catch (e) {
      console.warn(`No screenshot for ${r.name}`);
    }

    out.push({
      name: r.name,
      description: r.description,
      html_url: r.html_url,
      homepage: r.homepage,
      default_branch: r.default_branch || "main",
      archived: !!r.archived,
      languages: normalizeLangPercents(langsRaw),
      branches: branchesCount,
      last_commit: lastCommit
    });
  }

  await fs.writeFile(OUT_JSON, JSON.stringify(out, null, 2));
  console.log(`Wrote ${out.length} repos to src/data/repos.json`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
