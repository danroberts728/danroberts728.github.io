import { PROFILE } from "./config.js";

const $ = (s, r=document) => r.querySelector(s);

document.addEventListener("DOMContentLoaded", () => {
  initProfile();
  $("#year").textContent = new Date().getFullYear();
  load().then(render).catch(err => { console.error(err); render([]); });
});

let projects = [];

function initProfile() {
  $("#display-name").textContent = PROFILE.displayName || "";
  $("#display-name-footer").textContent = PROFILE.displayName || "";
  $("#tagline").textContent = PROFILE.tagline || "";
  const links = PROFILE.links || [];
  const frag = document.createDocumentFragment();
  for (const l of links) {
    const a = document.createElement("a");
    a.href = l.url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = l.label;
    frag.appendChild(a);
  }
  $("#contact-links").appendChild(frag);
  // Profile photo downloaded by Action:
  $("#profile-photo").src = "./assets/img/profile.jpg";
  $("#profile-photo").alt = `${PROFILE.displayName} profile photo`;
}

async function load() {
  const res = await fetch("./src/data/repos.json");
  if (!res.ok) throw new Error(`Failed repos.json: ${res.status}`);
  const data = await res.json();
  // Normalize
  projects = data.map(r => ({
    slug: r.name,
    title: r.name,
    description: r.description || "",
    codeUrl: r.html_url,
    liveUrl: r.homepage || "",
    screenshot: `./assets/img/screenshots/${r.name}.jpg`,
    languages: r.languages || {},
    updatedAt: r.last_commit || null,
    branches: r.branches ?? null,
    archived: !!r.archived
  }));
}

function render() {
  const wrap = $("#projects");
  wrap.innerHTML = "";
  const tpl = $("#project-card-tpl");

  // Sort by last update desc
  const items = projects.slice().sort((a,b) =>
    (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0)
  );

  const frag = document.createDocumentFragment();
  for (const p of items) {
    const node = tpl.content.cloneNode(true);
    node.querySelector(".screenshot").src = p.screenshot;
    node.querySelector(".screenshot").alt = `Screenshot of ${p.title}`;
    node.querySelector(".title").textContent = p.title;
    node.querySelector(".desc").textContent = p.description || "—";

    const langs = Object.entries(p.languages).map(([k,v]) => `${k} ${(+v).toFixed(1)}%`);
    node.querySelector(".langs").textContent = langs.length ? langs.join(" • ") : "Languages: —";
    node.querySelector(".updated").textContent = p.updatedAt ? `Last update: ${new Date(p.updatedAt).toLocaleString()}` : "Last update: —";
    node.querySelector(".branches").textContent = (p.branches ?? null) !== null ? `Branches: ${p.branches}` : "Branches: —";

    const code = node.querySelector(".btn.code");
    code.href = p.codeUrl;

    const live = node.querySelector(".btn.live");
    if (p.liveUrl) { live.href = p.liveUrl; live.hidden = false; } else { live.hidden = true; }

    frag.appendChild(node);
  }
  wrap.appendChild(frag);
}
