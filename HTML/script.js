// Configuration de l'accès à Supabase
const SUPABASE_URL = "https://kykglnfuvxcfitpmugld.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5a2dsbmZ1dnhjZml0cG11Z2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MjA1NDAsImV4cCI6MjA5MjI5NjU0MH0.j2-zdNR7nglDLMebecY1vbpEKYS0jSy12F0GEWWpXcw";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Configuration des villes disponibles
const CITIES = {
  paris: {
    nom: "Paris",
    lat: 48.8566,
    lng: 2.3522,
    zoom: 14,
    minZoom: 12,
    bounds: [[48.815, 2.224], [48.902, 2.470]],
    villeQuery: "PARIS",
    codePostal: "75",
  },
  lyon: {
    nom: "Lyon",
    lat: 45.7640,
    lng: 4.8357,
    zoom: 13,
    minZoom: 11,
    bounds: [[45.69, 4.72], [45.83, 4.95]],
    villeQuery: "LYON",
    codePostal: "69",
  },
  marseille: {
    nom: "Marseille",
    lat: 43.2965,
    lng: 5.3698,
    zoom: 12,
    minZoom: 10,
    bounds: [[43.16, 5.18], [43.43, 5.58]],
    villeQuery: "MARSEILLE",
    codePostal: "13",
  },
  toulouse: {
    nom: "Toulouse",
    lat: 43.6047,
    lng: 1.4442,
    zoom: 13,
    minZoom: 11,
    bounds: [[43.52, 1.32], [43.69, 1.57]],
    villeQuery: "TOULOUSE",
    codePostal: "31",
  },
};

let villeActive = null;

let map;
let markerCluster = null;
let allMarkers = [];
let allStages = [];
let domainesActifs = new Set();
let selection = new Set();
let filterPanelOpen = false;

let referencePoint = null;
let perimetreMetres = 500;
let perimetreCircle = null;
let referenceMarker = null;
let adresseSearchTimeout = null;

function initMap() {
  // Initialisation de la carte Leaflet sur la ville active
  const c = villeActive;
  map = L.map("map", {
    center: [c.lat, c.lng],
    zoom: c.zoom,
    minZoom: c.minZoom,
    maxZoom: 19,
    maxBounds: L.latLngBounds(L.latLng(c.bounds[0][0], c.bounds[0][1]), L.latLng(c.bounds[1][0], c.bounds[1][1])),
    maxBoundsViscosity: 1.0,
    zoomControl: false,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OSM',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    pane: "shadowPane",
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  markerCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 45,
    spiderfyDistanceMultiplier: 1.4,
    iconCreateFunction: (cluster) => {
      const count = cluster.getChildCount();
      let size = 38;
      if (count >= 100) size = 56;
      else if (count >= 25) size = 48;
      else if (count >= 10) size = 42;

      return L.divIcon({
        html: `<div class="cluster-bubble" style="width:${size}px;height:${size}px;"><span>${count}</span></div>`,
        className: "cluster-icon",
        iconSize: [size, size],
      });
    },
  });
  map.addLayer(markerCluster);

  initAdresseSearch();
  chargerStages();
}

async function chargerStages() {
  // Chargement des données des entreprises depuis Supabase pour la ville active
  const villeQuery = villeActive.villeQuery;
  let { data, error } = await supabaseClient
    .from("Stages")
    .select("*")
    .ilike("ville", villeQuery);

  if (error) {
    console.error("Erreur de chargement Supabase:", error);
    const fallback = await supabaseClient.from("Stages").select("*");
    if (!fallback.error) {
      data = (fallback.data || []).filter(
        (r) => (r.ville || "").toUpperCase().includes(villeQuery)
      );
    } else {
      return;
    }
  }

  allStages = data || [];

  const domainesSet = new Set();
  allStages.forEach((item) => {
    const doms = parseDomaines(item.domaines);
    item.domaines = doms;
    doms.forEach((d) => domainesSet.add(d));
  });
  afficherDomaines([...domainesSet].sort());

  afficherMarqueurs(allStages);
}

const DOMAINES_EXCLUS = new Set(["info", "autre", "null", ""]);

const MAP_DOMAINES = {
  "informatique": "Informatique & Tech",
  "tech": "Informatique & Tech",
  "développement": "Informatique & Tech",
  "data": "Informatique & Tech",

  "finance": "Finance & Conseil",
  "banque": "Finance & Conseil",
  "comptabilité": "Finance & Conseil",
  "assurance": "Finance & Conseil",
  "conseil": "Finance & Conseil",
  "management": "Finance & Conseil",
  "stratégie": "Finance & Conseil",

  "droit": "Droit & Juridique",
  "juridique": "Droit & Juridique",

  "science": "Mathématiques & Sciences",
  "math": "Mathématiques & Sciences",

  "architecture": "BTP & Immobilier",
  "ingénierie": "BTP & Immobilier",
  "btp": "BTP & Immobilier",
  "immobilier": "BTP & Immobilier",
  "construction": "BTP & Immobilier",

  "marketing": "Marketing & Médias",
  "communication": "Marketing & Médias",
  "publicité": "Marketing & Médias",
  "design": "Marketing & Médias",
  "médias": "Marketing & Médias",
  "édition": "Marketing & Médias",
  "audiovisuel": "Marketing & Médias",
  "radio": "Marketing & Médias",
  "tv": "Marketing & Médias",

  "rh": "Ressources Humaines",
  "recrutement": "Ressources Humaines",

  "commerce": "Commerce & Vente",
  "négoce": "Commerce & Vente",
  "retail": "Commerce & Vente",
  "vente": "Commerce & Vente",

  "santé": "Santé & Médical",
  "médical": "Santé & Médical",

  "enseignement": "Éducation & Admin",
  "formation": "Éducation & Admin",
  "administration": "Éducation & Admin",
  "secteur public": "Éducation & Admin",

  "logistique": "Logistique",
  "transport": "Logistique",
  "supply chain": "Logistique"
};

function parseDomaines(raw) {
  if (!raw) return [];
  let parts = [];

  if (Array.isArray(raw)) {
    parts = raw;
  } else if (typeof raw === 'string') {
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        parts = JSON.parse(raw);
      } catch(e) {
        parts = raw.replace(/[{}[\]"]/g, "").split(",");
      }
    } else {
      parts = raw.replace(/[{}[\]"]/g, "").split(",");
    }
  }

  const mapped = parts
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0 && !DOMAINES_EXCLUS.has(d))
    .map((d) => MAP_DOMAINES[d] || "Autre");

  return [...new Set(mapped)];
}

function afficherDomaines(domaines) {
  const container = document.getElementById("domaines-checkboxes");
  container.innerHTML = "";

  const domainesFiltres = domaines.filter((d) => d !== "Autre");

  if (domainesFiltres.length === 0) {
    container.innerHTML = '<span style="color:rgba(255,255,255,0.25);font-size:0.8rem">Aucun domaine disponible</span>';
    return;
  }

  domainesFiltres.forEach((dom) => {
    const chip = document.createElement("button");
    chip.className = "domain-chip";
    chip.textContent = dom;
    chip.dataset.domain = dom;
    chip.onclick = () => toggleDomaine(dom, chip);
    container.appendChild(chip);
  });
}

function toggleDomaine(dom, chipEl) {
  if (domainesActifs.has(dom)) {
    domainesActifs.delete(dom);
    chipEl.classList.remove("active");
  } else {
    domainesActifs.add(dom);
    chipEl.classList.add("active");
  }
  appliquerFiltres();
}

function appliquerFiltres() {
  // Filtrage combiné par nom, score minimum, domaines et périmètre géographique
  const nomQuery = document.getElementById("filter-nom").value.toLowerCase().trim();
  const scoreMin = parseInt(document.getElementById("filter-score").value);

  const filtered = allStages.filter((item) => {
    if (nomQuery && !(item.nom || "").toLowerCase().includes(nomQuery)) return false;

    const score = parseFloat(item.score_embauche) || 0;
    if (score < scoreMin) return false;

    if (domainesActifs.size > 0) {
      const itemDomaines = item.domaines || [];
      const hasMatch = [...domainesActifs].some((d) => itemDomaines.includes(d));
      if (!hasMatch) return false;
    }

    if (referencePoint && item.lat && item.lng) {
      const dist = distanceMetres(referencePoint.lat, referencePoint.lng, item.lat, item.lng);
      if (dist > perimetreMetres) return false;
    }

    return true;
  });

  afficherMarqueurs(filtered);
  document.getElementById("result-count").textContent = filtered.length;
}

function resetFiltres() {
  document.getElementById("filter-nom").value = "";
  document.getElementById("filter-score").value = 0;
  updateScoreDisplay();
  domainesActifs.clear();
  document.querySelectorAll(".domain-chip").forEach((c) => c.classList.remove("active"));
  effacerAdresse();
  afficherMarqueurs(allStages);
  document.getElementById("result-count").textContent = allStages.length;
}

function updateScoreDisplay() {
  const val = document.getElementById("filter-score").value;
  document.getElementById("score-value").textContent = val;
  const pct = (val / 10) * 100;
  document.getElementById("filter-score").style.setProperty("--progress", `${pct}%`);
  document.getElementById("filter-score").style.background =
    `linear-gradient(to right, #f5c518 0%, #f5c518 ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`;
}

function afficherMarqueurs(stages) {
  // Nettoyage des anciens marqueurs (clustering)
  if (markerCluster) markerCluster.clearLayers();
  allMarkers = [];

  const nouveauxMarqueurs = [];

  stages.forEach((item) => {
    if (!item.lat || !item.lng) return;

    const score = parseFloat(item.score_embauche) || 0;
    const couleur = getScoreColor(score);

    const icon = L.divIcon({
      className: "marker-pin-wrapper",
      html: `
        <div class="marker-pin" style="--pin-color: ${couleur};">
          <div class="marker-pin-inner"></div>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -14],
    });

    const domaines = item.domaines || [];
    const domainesHTML = domaines
      .filter((d) => d !== "Autre")
      .map((d) => `<span class="popup-domaine-tag">${d}</span>`)
      .join("");

    const dotsHTML = Array.from({ length: 10 }, (_, i) =>
      `<div class="score-dot${i < score ? " filled" : ""}"></div>`
    ).join("");

    let distanceHTML = "";
    if (referencePoint) {
      const d = distanceMetres(referencePoint.lat, referencePoint.lng, item.lat, item.lng);
      const dTxt = d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(2)} km`;
      distanceHTML = `<div class="popup-distance">📏 ${dTxt} de votre adresse</div>`;
    }

    const popupContent = `
      <div class="popup-card">
        <div class="popup-nom">${item.nom}</div>
        <div class="popup-adresse">📍 ${item.adresse}</div>
        ${distanceHTML}
        ${domaines.length > 0 ? `<div class="popup-domaines">${domainesHTML}</div>` : ""}
        <div class="popup-score">
          <span class="popup-score-label">Score embauche</span>
          <div class="score-stars">${dotsHTML}</div>
          <span class="popup-score-num">${score}/10</span>
        </div>
        <label class="popup-checkbox-label">
          <input type="checkbox" onchange="toggleSelection('${item.siret}')" ${selection.has(item.siret) ? 'checked' : ''}>
          Sélectionner pour l'export
        </label>
      </div>
    `;

    const marker = L.marker([item.lat, item.lng], { icon })
      .bindPopup(popupContent, {
        maxWidth: 280,
        className: "custom-popup",
      });

    nouveauxMarqueurs.push(marker);
    allMarkers.push({ marker, data: item });
  });

  if (markerCluster && nouveauxMarqueurs.length > 0) {
    markerCluster.addLayers(nouveauxMarqueurs);
  }

  document.getElementById("result-count").textContent = stages.length;
}

function getScoreColor(score) {
  if (score >= 8) return "#22c55e";
  if (score >= 5) return "#f59e0b";
  return "#ef4444";
}

function choisirVille(ville) {
  const cfg = CITIES[ville];
  if (!cfg) return;

  villeActive = cfg;

  // Mise à jour du titre du panel filtres
  const titleEl = document.querySelector(".filter-title span:last-child");
  if (titleEl) titleEl.textContent = cfg.nom;

  // Adapte le placeholder de l'adresse à la ville
  const adresseInput = document.getElementById("filter-adresse");
  if (adresseInput) adresseInput.placeholder = `Tapez une adresse à ${cfg.nom}...`;

  document.getElementById("landing-page").style.display = "none";
  document.getElementById("app-content").style.display = "flex";

  setTimeout(() => {
    initMap();
  }, 50);
}

function retourAccueil() {
  document.getElementById("app-content").style.display = "none";
  document.getElementById("landing-page").style.display = "flex";

  if (map) {
    map.remove();
    map = null;
    markerCluster = null;
    allMarkers = [];
    allStages = [];
    domainesActifs.clear();
    referencePoint = null;
    perimetreCircle = null;
    referenceMarker = null;
    document.getElementById("filter-adresse").value = "";
    document.getElementById("perimeter-section").style.display = "none";
    document.getElementById("clear-address-btn").style.display = "none";
  }
}

function toggleFilterPanel() {
  filterPanelOpen = !filterPanelOpen;
  const panel = document.getElementById("filter-panel");
  const icon = document.getElementById("toggle-icon");
  panel.classList.toggle("open", filterPanelOpen);
  icon.textContent = filterPanelOpen ? "✕" : "☰";
}

async function chargerCompteurs() {
  // Compte les entreprises dans Supabase pour chaque ville
  for (const [key, cfg] of Object.entries(CITIES)) {
    const el = document.getElementById(`${key}-count`);
    if (!el) continue;

    const { count, error } = await supabaseClient
      .from("Stages")
      .select("*", { count: "exact", head: true })
      .ilike("ville", cfg.villeQuery);

    if (!error && count !== null) {
      if (count === 0) {
        el.textContent = "Bientôt disponible";
        const card = document.getElementById(`city-${key}`);
        if (card) {
          card.classList.remove("available");
          card.classList.add("soon");
          card.onclick = null;
          const badge = card.querySelector(".city-badge");
          if (badge) {
            badge.textContent = "Bientôt";
            badge.classList.remove("available-badge");
            badge.classList.add("soon-badge");
          }
        }
      } else {
        el.textContent = `${count} entreprise${count > 1 ? "s" : ""}`;
      }
    } else if (el) {
      el.textContent = "Données indisponibles";
    }
  }
}

chargerCompteurs();

function toggleSelection(siret) {
  if (selection.has(siret)) {
    selection.delete(siret);
  } else {
    selection.add(siret);
  }
  updateExportButton();
}

function updateExportButton() {
  const btn = document.getElementById("export-btn");
  if (selection.size > 0) {
    btn.style.display = "block";
    btn.textContent = `Exporter la sélection (${selection.size})`;
  } else {
    btn.style.display = "none";
  }
}

// ==========================================
// RECHERCHE D'ADRESSE & PÉRIMÈTRE
// ==========================================

function distanceMetres(lat1, lng1, lat2, lng2) {
  // Formule haversine pour la distance entre deux points GPS (en mètres)
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function initAdresseSearch() {
  const input = document.getElementById("filter-adresse");
  const suggestions = document.getElementById("adresse-suggestions");
  if (!input) return;

  input.addEventListener("input", () => {
    clearTimeout(adresseSearchTimeout);
    const q = input.value.trim();
    document.getElementById("clear-address-btn").style.display = q ? "flex" : "none";

    if (q.length < 3) {
      suggestions.innerHTML = "";
      suggestions.classList.remove("visible");
      return;
    }
    adresseSearchTimeout = setTimeout(() => rechercherAdresse(q), 300);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".address-search-wrapper")) {
      suggestions.classList.remove("visible");
    }
  });
}

async function rechercherAdresse(query) {
  // Utilise l'API Adresse du gouvernement français (gratuite, sans clé)
  const suggestions = document.getElementById("adresse-suggestions");
  const c = villeActive;
  if (!c) return;
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=8&lat=${c.lat}&lon=${c.lng}`;
    const r = await fetch(url);
    const data = await r.json();
    const results = (data.features || []).filter((f) => {
      const ctx = f.properties.context || "";
      const city = (f.properties.city || "").toLowerCase();
      return ctx.includes(c.codePostal) || city === c.nom.toLowerCase();
    });

    if (results.length === 0) {
      suggestions.innerHTML = `<div class="suggestion-empty">Aucune adresse trouvée à ${c.nom}</div>`;
      suggestions.classList.add("visible");
      return;
    }

    suggestions.innerHTML = results
      .map((f, i) => {
        const label = f.properties.label || "";
        const ctx = f.properties.context || "";
        return `<div class="suggestion-item" data-idx="${i}">
          <span class="suggestion-pin">📍</span>
          <div class="suggestion-text">
            <div class="suggestion-label">${label}</div>
            <div class="suggestion-context">${ctx}</div>
          </div>
        </div>`;
      })
      .join("");

    suggestions.classList.add("visible");
    suggestions.querySelectorAll(".suggestion-item").forEach((el) => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.idx);
        choisirAdresse(results[idx]);
      };
    });
  } catch (e) {
    console.error("Erreur recherche adresse:", e);
  }
}

function choisirAdresse(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  const label = feature.properties.label;

  referencePoint = { lat, lng };

  document.getElementById("filter-adresse").value = label;
  document.getElementById("adresse-suggestions").classList.remove("visible");
  document.getElementById("perimeter-section").style.display = "flex";
  document.getElementById("clear-address-btn").style.display = "flex";

  dessinerReference();
  appliquerFiltres();

  if (map) {
    map.flyTo([lat, lng], 16, { duration: 0.8 });
  }
}

function dessinerReference() {
  if (!map || !referencePoint) return;

  if (perimetreCircle) map.removeLayer(perimetreCircle);
  if (referenceMarker) map.removeLayer(referenceMarker);

  perimetreCircle = L.circle([referencePoint.lat, referencePoint.lng], {
    radius: perimetreMetres,
    color: "#f5c518",
    weight: 2,
    fillColor: "#f5c518",
    fillOpacity: 0.08,
    dashArray: "6 6",
    interactive: false,
  }).addTo(map);

  const refIcon = L.divIcon({
    className: "reference-marker-wrapper",
    html: `<div class="reference-marker"><div class="reference-pulse"></div><div class="reference-dot"></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  referenceMarker = L.marker([referencePoint.lat, referencePoint.lng], {
    icon: refIcon,
    interactive: false,
    keyboard: false,
    zIndexOffset: 1000,
  }).addTo(map);
}

function updatePerimetre() {
  perimetreMetres = parseInt(document.getElementById("filter-perimeter").value);
  const display = perimetreMetres < 1000
    ? `${perimetreMetres} m`
    : `${(perimetreMetres / 1000).toFixed(1)} km`;
  document.getElementById("perimeter-value").textContent = display;

  if (perimetreCircle) perimetreCircle.setRadius(perimetreMetres);
  appliquerFiltres();
}

function effacerAdresse() {
  referencePoint = null;
  document.getElementById("filter-adresse").value = "";
  document.getElementById("adresse-suggestions").classList.remove("visible");
  document.getElementById("perimeter-section").style.display = "none";
  document.getElementById("clear-address-btn").style.display = "none";

  if (perimetreCircle) {
    map.removeLayer(perimetreCircle);
    perimetreCircle = null;
  }
  if (referenceMarker) {
    map.removeLayer(referenceMarker);
    referenceMarker = null;
  }
  appliquerFiltres();
}

function exportSelection() {
  // Création d'un fichier texte exportant les entreprises sélectionnées
  if (selection.size === 0) return;

  let txtContent = "ENTREPRISES SÉLECTIONNÉES\n=========================\n\n";
  allStages.forEach(item => {
    if (selection.has(item.siret)) {
      const nom = item.nom || "Sans nom";
      const adresse = item.adresse || "Adresse inconnue";
      const domaines = (item.domaines || []).join(", ");
      txtContent += `Nom : ${nom}\nAdresse : ${adresse}\nDomaines : ${domaines}\n-------------------------\n\n`;
    }
  });

  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'entreprises_selectionnees.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
