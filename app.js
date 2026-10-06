"use strict";
/* ============================================================
   ZENTRIX HOMELAB — data layer + rendering + WYSIWYG editing
   Storage: localStorage key "zentrix-homelab-v1"
   XSS-safety: all user data rendered via textContent/createElement,
   attribute values set via element.setAttribute with URL validation.
   ============================================================ */

const STORAGE_KEY = "zentrix-homelab-v1";

/* ---- helpers ---- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "");
function uid() { return "g" + Math.random().toString(36).slice(2, 10); }

/* URL validation: only http(s) — blocks javascript:, data:, vbscript: etc. */
function safeUrl(raw) {
  let u = esc(raw).trim();
  if (!u) return null;
  /* block dangerous schemes BEFORE any normalization */
  if (/^(javascript|data|vbscript|file|blob|about|ws|wss):/i.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) {
    u = (/^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|[a-z0-9-]+)([:\/])/i.test(u + "/") ? "http://" : "https://") + u;
  }
  try {
    const p = new URL(u);
    if (p.protocol !== "http:" && p.protocol !== "https:") return null;
    return p.href;
  } catch { return null; }
}
/* icons: allow only https (or http for LAN) image URLs */
function safeIcon(raw) {
  const u = esc(raw).trim();
  if (!u) return null;
  try {
    const p = new URL(u, location.href);
    if (p.protocol !== "https:" && p.protocol !== "http:") return null;
    return p.href;
  } catch { return null; }
}
function initialOf(name) { return esc(name).trim().charAt(0).toUpperCase() || "?"; }

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---- settings (theme / background / clock / language) ---- */
const SETTINGS_KEY = STORAGE_KEY + "-settings";
const BG_IMAGE_KEY = STORAGE_KEY + "-bgimage";   /* data-URL of the custom background */
const THEMES = ["binary", "phosphor", "amber", "arctic", "contrast", "deepspace", "glass"];
const BGS = ["pcb", "tron", "static", "custom", "starfield", "immich"];
const BG_IMAGE_MAX = 4 * 1024 * 1024;            /* 4 MB raw size limit */
const BG_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/* accent color per theme as raw rgb — feeds the canvas backgrounds */
const THEME_ACCENT_RGB = {
  "binary": "78, 225, 160",
  "phosphor": "57, 255, 20",
  "amber": "255, 176, 0",
  "arctic": "10, 125, 92",
  "contrast": "0, 229, 255",
  "deepspace": "125, 140, 255",
};
const THEME_ACCENT_HEX = {
  "binary": "#4ee1a0", "phosphor": "#39ff14", "amber": "#ffb000",
  "arctic": "#0a7d5c", "contrast": "#00e5ff", "deepspace": "#7d8cff",
  "glass": "#4ee1a0",
};
function themeAccentHex(theme) {
  return THEME_ACCENT_HEX[theme || settings.theme] || THEME_ACCENT_HEX.binary;
}
let settings = { theme: "binary", bg: "pcb", clock: true, compact: false, gridColumns: 0, layout: "auto", title: "homelab", accent: {} };
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (THEMES.includes(p.theme)) settings.theme = p.theme;
        if (BGS.includes(p.bg)) settings.bg = p.bg;
        if (typeof p.clock === "boolean") settings.clock = p.clock;
      if (typeof p.compact === "boolean") settings.compact = p.compact;
      if (p.gridColumns === "auto" || (typeof p.gridColumns === "number" && p.gridColumns >= 2 && p.gridColumns <= 8)) settings.gridColumns = p.gridColumns;
      if (["auto", "list", "grid"].includes(p.layout)) settings.layout = p.layout;
      if (typeof p.title === "string") settings.title = p.title.slice(0, 40);
      if (p.accent && typeof p.accent === "object") {
        for (const [k, v] of Object.entries(p.accent)) {
          if (/^#[0-9a-f]{6}$/i.test(v)) settings.accent[k] = v;
        }
      }
      }
    }
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}
function themeAccentRgb() {
  let cs = "";
  try {
    if (typeof getComputedStyle === "function") {
      cs = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    }
  } catch (e) { /* engine without getComputedStyle — use table below */ }
  /* resolve hex → raw rgb for canvas use */
  const m = cs.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  return THEME_ACCENT_RGB[settings.theme] || THEME_ACCENT_RGB.binary;
}
function applyTheme() {
  if (settings.theme === "binary") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", settings.theme);
  /* per-theme custom accent (⚙ color picker) overrides the theme default */
  const custom = settings.accent[settings.theme];
  if (custom) {
    document.documentElement.style.setProperty("--accent", custom);
    const n = parseInt(custom.slice(1), 16);
    document.documentElement.style.setProperty("--accent-dim", `rgba(${(n>>16)&255}, ${(n>>8)&255}, ${n&255}, 0.12)`);
  } else {
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent-dim");
  }
  if (settings.theme === "arctic") {
    /* plate handles contrast — clear any sampled classes from previous dark themes */
    document.querySelectorAll("#board .group-head").forEach(h => h.classList.remove("light-on-dark", "dark-on-light"));
  }
  if (window.ZENTRIX_BG) window.ZENTRIX_BG.apply({ accentRgb: themeAccentRgb() });
  /* photo backgrounds: theme change alters header base colors → re-sample contrast */
  if (typeof window.ZENTRIX_ADAPT === "function") setTimeout(window.ZENTRIX_ADAPT, 30);
}
function applyBg() {
  document.body.dataset.bg = settings.bg;   /* CSS hooks (arctic header plate etc.) */
  if (!window.ZENTRIX_BG) return;
  if (settings.bg === "custom") {
    const url = localStorage.getItem(BG_IMAGE_KEY);
    window.ZENTRIX_BG.apply({ mode: "custom", imageUrl: url || null });
    updateBgUploadUi();
  } else {
    window.ZENTRIX_BG.apply({ mode: settings.bg });
  }
}
/* upload UI visibility + labels depend on selected mode */
function updateBgUploadUi() {
  const row = $("#bg-upload-row"); if (!row) return;
  const isCustom = settings.bg === "custom";
  row.style.display = isCustom ? "" : "none";
  if (!isCustom) return;
  const has = !!localStorage.getItem(BG_IMAGE_KEY);
  const btnClear = $("#btn-bg-clear"); if (btnClear) btnClear.style.display = has ? "" : "none";
  const lbl = $("#lbl-bg-upload"); if (lbl) lbl.textContent = t("set_bg_upload");
  const btnUp = $("#btn-bg-upload"); if (btnUp) btnUp.textContent = t("bg_upload_btn");
  const btnCl = $("#btn-bg-clear"); if (btnCl) btnCl.textContent = t("bg_upload_clear");
  const hint = $("#hint-bg-upload"); if (hint) hint.textContent = "JPG/PNG/WebP, max 4 MB";
}
function applyClock() {
  const c = document.querySelector(".clock");
  if (c) c.style.display = settings.clock ? "" : "none";
  document.body.classList.toggle("clock-hidden", !settings.clock);
}
function applySettings() { applyTheme(); applyBg(); applyClock(); }


/* ---- i18n: 24 languages (window.ZENTRIX_I18N from i18n.js) ---- */
const I18N = window.ZENTRIX_I18N || { default: "de", rtl: ["ar"], strings: {} };
const LANG_KEY = STORAGE_KEY + "-lang";
const FALLBACK_LANG = "en";
let currentLang = (() => {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && I18N.strings[saved]) return saved;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || I18N.default;
  const norm = (nav || "").toLowerCase();
  /* direct hit or prefix match (de-AT → de, zh-TW → zh-CN fallback below) */
  if (I18N.strings[nav]) return nav;
  const base = norm.split("-")[0];
  if (I18N.strings[norm]) return norm;
  if (base === "zh") return I18N.strings["zh-CN"] ? "zh-CN" : I18N.default;
  if (I18N.strings[base]) return base;
  return I18N.default;
})();
function t(key, vars) {
  let s = (I18N.strings[currentLang] && I18N.strings[currentLang][key])
       ?? (I18N.strings[FALLBACK_LANG] && I18N.strings[FALLBACK_LANG][key])
       ?? (I18N.strings[I18N.default] && I18N.strings[I18N.default][key])
       ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll("{" + k + "}", String(v));
  return s;
}
/* apply static UI strings + language direction; call on boot and on language switch */
function applyI18n() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = I18N.rtl.includes(currentLang) ? "rtl" : "ltr";
  const $id = (id) => document.getElementById(id);
  const chip = $id("sync-chip"); if (chip) chip.title = t("sync_chip_title");
  const btnEdit = $id("btn-edit");
  if (btnEdit) {
    /* icon-only edit button (pencil / check) with tooltip */
    btnEdit.textContent = editMode ? "✓" : "✎";
    btnEdit.title = editMode ? t("done") : t("edit");
    btnEdit.setAttribute("aria-label", btnEdit.title);
  }
  const btnExport = $id("btn-export"); if (btnExport) { btnExport.textContent = t("export"); btnExport.title = t("export_title"); }
  const btnImport = $id("btn-import"); if (btnImport) { btnImport.textContent = t("import"); btnImport.title = t("import_title"); }
  const btnReset = $id("btn-reset"); if (btnReset) { btnReset.textContent = t("reload"); btnReset.title = t("reload_title"); }
  const search = $id("search"); if (search) search.placeholder = t("search_placeholder");
  const noRes = $id("no-results"); if (noRes) noRes.textContent = t("no_results");
  const addGroup = $id("btn-addgroup"); if (addGroup) addGroup.textContent = t("add_group_btn");
  const footer = document.querySelector("footer");
  if (footer) footer.innerHTML = "";
  if (footer) {
    const mkKbd = (label) => { const k = document.createElement("span"); k.className = "kbd"; k.textContent = label; return k; };
    footer.append(
      mkKbd("Strg"), document.createTextNode("+"), mkKbd("K"), document.createTextNode(" " + t("footer_search") + " · "),
      mkKbd("Esc"), document.createTextNode(" " + t("footer_clear") + " · " + t("footer_autosave") + " · Zentrix Agent / Binary language")
    );
  }
  const lblFor = (id, txt) => { const el = $id(id); if (el) el.textContent = txt; };
  lblFor("modal-title", editingLink ? t("modal_edit_title") : t("modal_add_title"));
  /* modal labels */
  const fNameLabel = document.querySelector('label[for="f-name"]'); if (fNameLabel) fNameLabel.textContent = t("label_name");
  const fUrlLabel = document.querySelector('label[for="f-url"]'); if (fUrlLabel) fUrlLabel.textContent = t("label_url");
  const fIconLabel = document.querySelector('label[for="f-icon"]');
  if (fIconLabel) {
    fIconLabel.textContent = "";
    const hint = document.createElement("span");
    hint.textContent = "— " + t("hint_icon_word");
    hint.style.cssText = "text-transform:none";
    fIconLabel.append(t("label_icon") + " ", hint);
  }
  const fGroupLabel = document.querySelector('label[for="f-group"]'); if (fGroupLabel) fGroupLabel.textContent = t("label_group");
  const hintUrl = document.querySelector("#f-url + .hint"); if (hintUrl) hintUrl.textContent = t("hint_url");
  const fName = $id("f-name"); if (fName) fName.placeholder = t("ph_name");
  const fUrl = $id("f-url"); if (fUrl) fUrl.placeholder = t("ph_url");
  const fIcon = $id("f-icon"); if (fIcon) fIcon.placeholder = t("ph_icon");
  const btnCancel = $id("btn-cancel"); if (btnCancel) btnCancel.textContent = t("btn_cancel");
  const btnSave = $id("btn-save"); if (btnSave) btnSave.textContent = t("btn_save");
  /* token modal */
  const tokenH = document.querySelector("#token-backdrop h3"); if (tokenH) tokenH.textContent = t("token_title");
  const fTokenLabel = document.querySelector('label[for="f-token"]'); if (fTokenLabel) fTokenLabel.textContent = t("label_token");
  const fToken = $id("f-token"); if (fToken) fToken.placeholder = t("ph_token");
  const hintToken = document.querySelector("#f-token + .hint"); if (hintToken) hintToken.textContent = t("hint_token");
  const btnTokCancel = $id("btn-token-cancel"); if (btnTokCancel) btnTokCancel.textContent = t("btn_offline");
  const btnTokSave = $id("btn-token-save"); if (btnTokSave) btnTokSave.textContent = t("btn_remember");
  /* settings modal */
  const settingsTitle = $id("settings-title"); if (settingsTitle) settingsTitle.textContent = t("settings_title");
  const lblAppearance = $id("lbl-appearance"); if (lblAppearance) lblAppearance.textContent = t("set_appearance");
  const lblTheme = $id("lbl-theme"); if (lblTheme) lblTheme.textContent = t("set_theme");
  const lblBackground = $id("lbl-background"); if (lblBackground) lblBackground.textContent = t("set_background");
  const lblClock = $id("lbl-clock"); if (lblClock) lblClock.textContent = t("set_clock");
  const lblData = $id("lbl-data"); if (lblData) lblData.textContent = t("set_data");
  const themeSel = $id("set-theme");
  if (themeSel) {
    const themeNames = { binary: t("theme_binary"), phosphor: t("theme_phosphor"), amber: t("theme_amber"), arctic: t("theme_arctic"), contrast: t("theme_contrast"), deepspace: t("theme_deepspace"), glass: t("theme_glass") };
    for (const opt of themeSel.options || []) if (themeNames[opt.value]) opt.textContent = themeNames[opt.value];
  }
  const bgSel = $id("set-background");
  if (bgSel) {
    const bgNames = { pcb: t("bg_pcb"), tron: t("bg_tron"), static: t("bg_static"), custom: t("bg_custom"), starfield: t("bg_starfield") };
    for (const opt of bgSel.options || []) if (bgNames[opt.value]) opt.textContent = bgNames[opt.value];
  }
  const lblBgUpload = $id("lbl-bg-upload"); if (lblBgUpload) lblBgUpload.textContent = t("set_bg_upload");
  const btnBgUpload = $id("btn-bg-upload"); if (btnBgUpload) btnBgUpload.textContent = t("bg_upload_btn");
  const btnBgClear = $id("btn-bg-clear"); if (btnBgClear) btnBgClear.textContent = t("bg_upload_clear");
  const hintBgUpload = $id("hint-bg-upload"); if (hintBgUpload) hintBgUpload.textContent = "JPG/PNG/WebP, max 4 MB";
  /* appearance section (new) */
  const lblCompact = $id("lbl-compact"); if (lblCompact) lblCompact.textContent = t("lbl_compact");
  const lblGridColumns = $id("lbl-grid-columns"); if (lblGridColumns) lblGridColumns.textContent = t("lbl_grid_columns");
  const lblLangfollow = $id("lbl-langfollow"); if (lblLangfollow) lblLangfollow.textContent = t("lbl_langfollow");
  const colsSel2 = $id("set-grid-columns");
  if (colsSel2) {
    const gridNames = { auto: t("grid_opt_auto"), groups: t("grid_opt_groups"),
                        "4": "4", "5": "5", "6": "6", "8": "8" };
    for (const opt of colsSel2.options || []) if (gridNames[opt.value]) opt.textContent = gridNames[opt.value];
  }
  const searchToggle = $id("btn-search-toggle"); if (searchToggle) searchToggle.title = t("search_toggle_title");
  /* branding section (new) */
  const lblBranding = $id("lbl-branding"); if (lblBranding) lblBranding.textContent = t("lbl_branding");
  const lblTitle = $id("lbl-title"); if (lblTitle) lblTitle.textContent = t("lbl_title");
  const lblFavicon = $id("lbl-favicon"); if (lblFavicon) lblFavicon.textContent = t("lbl_favicon");
  const lblAccent = $id("lbl-accent"); if (lblAccent) lblAccent.textContent = t("lbl_accent");
  const btnFavUpload = $id("btn-fav-upload"); if (btnFavUpload) btnFavUpload.textContent = t("bg_upload_btn");
  const btnFavClear = $id("btn-fav-clear"); if (btnFavClear) btnFavClear.textContent = t("fav_reset");
  const btnAccentApply = $id("set-accent-apply"); if (btnAccentApply) btnAccentApply.textContent = t("accent_apply");
  const btnAccentReset = $id("set-accent-reset"); if (btnAccentReset) btnAccentReset.textContent = t("accent_reset");
  /* info pane */
  const tabInfo = $id("tab-info"); if (tabInfo) tabInfo.textContent = t("set_info");
  const lblInfoTitle = $id("lbl-info-title"); if (lblInfoTitle) lblInfoTitle.textContent = t("info_title");
  const infoVersionKey = $id("info-version-key"); if (infoVersionKey) infoVersionKey.textContent = t("info_version");
  const infoRepoKey = $id("info-repo-key"); if (infoRepoKey) infoRepoKey.textContent = t("info_repo");
  const lblInfoManuals = $id("lbl-info-manuals"); if (lblInfoManuals) lblInfoManuals.textContent = t("info_manuals");
  const infoManualEn = $id("info-manual-en"); if (infoManualEn) infoManualEn.textContent = "🇬🇧 " + t("info_manual_en");
  const infoManualDe = $id("info-manual-de"); if (infoManualDe) infoManualDe.textContent = "🇩🇪 " + t("info_manual_de");
  const infoManualFr = $id("info-manual-fr"); if (infoManualFr) infoManualFr.textContent = "🇫🇷 " + t("info_manual_fr");
  /* immich settings section */
  const tabImmich = $id("tab-immich"); if (tabImmich) tabImmich.textContent = t("tab_immich");
  const lblImmich = $id("lbl-immich"); if (lblImmich) lblImmich.textContent = t("lbl_immich");
  const lblImmichUrl = $id("lbl-immich-url"); if (lblImmichUrl) lblImmichUrl.textContent = t("lbl_immich_url");
  const lblImmichKey = $id("lbl-immich-key"); if (lblImmichKey) lblImmichKey.textContent = t("lbl_immich_key");
  const lblImmichAlbum = $id("lbl-immich-album"); if (lblImmichAlbum) lblImmichAlbum.textContent = t("lbl_immich_album");
  const lblImmichInterval = $id("lbl-immich-interval"); if (lblImmichInterval) lblImmichInterval.textContent = t("lbl_immich_interval");
  const btnImmichTestL = $id("btn-immich-test"); if (btnImmichTestL) btnImmichTestL.textContent = t("immich_test_btn");
  const btnImmichSaveL = $id("btn-immich-save"); if (btnImmichSaveL) btnImmichSaveL.textContent = t("immich_save_btn");
  /* bg dropdown option label */
  const bgSelI18n = $id("set-background");
  if (bgSelI18n) { const o = bgSelI18n.querySelector('option[value="immich"]'); if (o) o.textContent = t("bg_immich"); }
  const setCompactChk = $id("set-compact");
  if (setCompactChk) {
    /* checkbox label text lives in the adjacent span (lbl-compact) — handled above */
  }
  const btnSettingsClose = $id("btn-settings-close"); if (btnSettingsClose) btnSettingsClose.textContent = t("btn_close");
  /* settings tabs */
  const tabNames = { "tab-appearance": t("set_appearance"), "tab-branding": t("tab_branding_short"), "tab-immich": t("tab_immich"), "tab-data": t("set_data"), "tab-info": t("set_info") };
  for (const [tid, label] of Object.entries(tabNames)) {
    const el = $id(tid); if (el) el.textContent = label;
  }
  /* pair buttons */
  for (const btn of document.querySelectorAll(".pair-btn")) {
    const active = btn.classList.contains("active");
    btn.title = active ? t("pair_off") : t("pair_on");
  }
  const gearBtn = $id("btn-settings"); if (gearBtn) gearBtn.title = t("gear_title");
  const lblLanguage = $id("lbl-language"); if (lblLanguage) lblLanguage.textContent = t("set_language");
  /* settings language select — the single language control */
  const setLangSel = $id("set-language");
  if (setLangSel) {
    setLangSel.textContent = "";
    for (const code of Object.keys(I18N.strings)) {
      const opt = document.createElement("option");
      opt.value = code; opt.textContent = LANG_NAMES[code] || code;
      setLangSel.appendChild(opt);
    }
    for (const opt of setLangSel.options || []) if (opt.value === currentLang) opt.selected = true;
  }
}
function setLang(lang) {
  if (!I18N.strings[lang]) return;
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  applyI18n();
  render($("#search").value);
  tickClock();
}
const LANG_NAMES = {
  "de": "Deutsch", "en": "English", "fr": "Français", "es": "Español", "it": "Italiano",
  "pt": "Português", "nl": "Nederlands", "da": "Dansk", "sv": "Svenska", "nb": "Norsk bokmål",
  "fi": "Suomi", "pl": "Polski", "cs": "Čeština", "sk": "Slovenčina", "hu": "Magyar",
  "ro": "Română", "bg": "Български", "el": "Ελληνικά", "tr": "Türkçe", "ru": "Русский",
  "uk": "Українська", "ja": "日本語", "zh-CN": "简体中文", "ar": "العربية",
};



/* ---- state ---- */
let data = { groups: [] };  // no seed data in client code — server (links.json) is the single source of truth
let editMode = false;
let editingGroup = null;   // group obj when editing a link inside it
let editingLink = null;    // link obj being edited
let serverAvailable = false;
let saveTimer = null;      // debounce für Auto-Save

/* ---- persistence: server API mit localStorage-Fallback ---- */
function getToken() { return localStorage.getItem(STORAGE_KEY + "-token") || ""; }
function setToken(t) { localStorage.setItem(STORAGE_KEY + "-token", t); }
function localSave() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {} }

function setSync(state, text) {
  const chip = $("#sync-chip");
  chip.className = "sync-chip " + (state || "");
  chip.textContent = text;
}

async function serverLoad() {
  try {
    const res = await fetch("/api/links", { headers: { "Cache-Control": "no-store" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const remote = await res.json();
    if (remote && Array.isArray(remote.groups)) {
      data = remote;
      localSave(); // offline-Kopie auffrischen
      serverAvailable = true;
      setSync("ok", t("sync_server"));
      return true;
    }
  } catch (e) {
    console.info("Server nicht erreichbar — lokale Daten", e.message);
  }
  /* Fallback: localStorage */
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.groups)) { data = parsed; setSync("", t("sync_local")); return false; }
    }
  } catch (e) {}
  setSync("err", t("sync_offline"));
  return false;
}

/* Speichern: sofort lokal, debounced an Server (nur wenn Token vorhanden) */
function save() {
  localSave();
  if (!serverAvailable) { setSync("", t("sync_local")); return; }
  const token = getToken();
  if (!token) { setSync("err", t("sync_no_token")); return; }
  clearTimeout(saveTimer);
  setSync("", t("sync_saving"));
  saveTimer = setTimeout(async () => {
    try {
      const res = await fetch("/api/links?lang=" + encodeURIComponent(currentLang), {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Auth-Token": token },
        body: JSON.stringify(data)
      });
      if (res.status === 401) {
        setSync("err", t("sync_token_bad"));
        askToken(true);
        return;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSync("ok", t("sync_server"));
    } catch (e) {
      setSync("err", t("sync_saved_offline"));
    }
  }, 600);
}

function askToken(isRetry) {
  $("#token-backdrop").classList.add("open");
  $("#f-token").value = getToken();
  $("#f-token").placeholder = isRetry ? t("ph_token_retry") : t("ph_token");
  setTimeout(() => $("#f-token").focus(), 50);
}
$("#btn-token-save").addEventListener("click", async () => {
  setToken($("#f-token").value.trim());
  $("#token-backdrop").classList.remove("open");
  save(); /* sofort testen */
});
$("#btn-token-cancel").addEventListener("click", () => {
  $("#token-backdrop").classList.remove("open");
  setSync("", t("sync_local"));
});


/* ---- adaptive group-header contrast (custom bg mode) ----
   Samples the background image's luminance in the screen region behind each
   group header and assigns light-on-dark / dark-on-light text classes.
   Falls back silently when no custom image is active or canvas access fails
   (CORS-free: the image is a local data-URL, so sampling always works). */
const ADAPT_SAMPLER = document.createElement("canvas");
ADAPT_SAMPLER.width = 64; ADAPT_SAMPLER.height = 64;
const ADAPT_SCTX = ADAPT_SAMPLER.getContext("2d", { willReadFrequently: true });

function luminanceAt(px, py, img) {
  /* sample a small patch around (px,py) from the photo bg image, return 0..1.
     Maps screen coords through the COVER-fit transform (scale + center-crop),
     so the sampled spot matches what is actually visible behind the element. */
  if (!img) return null;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;
  try {
    /* downscale the whole image into 64x64, then read the corresponding patch */
    ADAPT_SCTX.clearRect(0, 0, 64, 64);
    ADAPT_SCTX.drawImage(img, 0, 0, 64, 64);
    const scale = Math.max(window.innerWidth / iw, window.innerHeight / ih);
    const dispW = iw * scale, dispH = ih * scale;
    const offX = (window.innerWidth - dispW) / 2, offY = (window.innerHeight - dispH) / 2;
    const ix = (px - offX) / scale, iy = (py - offY) / scale;
    const rx = Math.max(0, Math.min(63, Math.round((ix / iw) * 63)));
    const ry = Math.max(0, Math.min(63, Math.round((iy / ih) * 63)));
    const data = ADAPT_SCTX.getImageData(Math.max(0, rx - 2), Math.max(0, ry - 2), 5, 5).data;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++;
    }
    return n ? sum / n / 255 : null;
    /* note: getImageData on a canvas that drew a data-URL image is same-origin — safe */
  } catch (e) {
    return null;
  }
}

function adaptGroupHeaders() {
  /* arctic/glass themes use fixed plates — no per-header sampling needed */
  const th = document.documentElement.dataset.theme;
  if (th === "arctic" || th === "glass") return;
  if (settings.bg !== "custom" && settings.bg !== "immich") return;
  if (!window.ZENTRIX_BG) return;
  const img = settings.bg === "custom" ? window.ZENTRIX_BG.image() : window.ZENTRIX_BG.immichImage();
  if (!img) return;
  const heads = document.querySelectorAll("#board .group-head");
  for (const head of heads) {
    const title = head.querySelector(".group-title");
    if (!title) continue;
    const rect = head.getBoundingClientRect();
    const lum = luminanceAt(rect.left + rect.width / 2, rect.top + rect.height / 2, img);
    if (lum === null) continue;
    const light = lum < 0.55;  /* dark image region → light text */
    head.classList.toggle("light-on-dark", light);
    head.classList.toggle("dark-on-light", !light);
  }
}
try { window.addEventListener("resize", (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(adaptGroupHeaders, 200); }; })());
/* re-run adaptation when the custom image finished loading (async decode beats first render) */
document.addEventListener("zentrix-bg-loaded", () => setTimeout(adaptGroupHeaders, 60)); } catch (e) {}
window.ZENTRIX_ADAPT = adaptGroupHeaders;   /* exposed for tests + manual re-run */

/* ---- render ---- */
function render(filter = "") {
  const board = $("#board");
  board.textContent = "";
  const q = filter.trim().toLowerCase();
  let total = 0;

  /* per-group side-by-side: each group marked "beside" pairs with the group that
     follows it in list order (the follower is NOT marked). Build row buckets. */
  const besideSet = new Set(viewState.beside);
  const rows = [];           // each row = [group, group?] to render side by side
  let pendingPair = null;
  for (const g of data.groups) {
    if (pendingPair) { rows.push([pendingPair, g]); pendingPair = null; continue; }
    if (besideSet.has(g.id)) { pendingPair = g; continue; }
    rows.push([g]);
  }
  if (pendingPair) rows.push([pendingPair]);   /* marked but no follower left → single */

  for (const row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "group-row" + (row.length === 2 ? " duo" : "");
    board.appendChild(rowEl);

  for (const g of row) {
    const links = q
      ? g.links.filter(l => (l.name + " " + l.url).toLowerCase().includes(q))
      : g.links;
    if (q && links.length === 0) continue;
    total += links.length;

    const group = document.createElement("section");
    group.className = "group";
    group.dataset.groupId = g.id;

    /* head */
    const head = document.createElement("div");
    head.className = "group-head";
    const title = document.createElement("h2");
    title.className = "group-title";
    title.textContent = g.name;
    title.contentEditable = editMode ? "true" : "false";
    title.spellcheck = false;
    title.addEventListener("blur", () => {
      const v = title.textContent.trim();
      if (v && v !== g.name) { g.name = v; save(); toast(t("toast_group_renamed")); }
      else title.textContent = g.name;
    });
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = t("group_count", { n: links.length });

    const actions = document.createElement("div");
    actions.className = "group-actions";
    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.textContent = t("add_link");
    addBtn.addEventListener("click", () => openModal(null, g));
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = t("del_group_btn");
    delBtn.title = t("del_group_title");
    delBtn.addEventListener("click", () => {
      const fallback = data.groups.find(x => x.id !== g.id);
      if (!confirm(t("confirm_del_group", { name: g.name, target: (fallback || {}).name || "?" }))) return;
      /* NO LINK MAY BE LOST: if this is the last group, collect its links into
         a fresh dummy group instead of dropping them */
      if (data.groups.length <= 1) {
        const rescued = { id: uid(), name: t("new_group_name"), links: [...g.links] };
        data.groups = [rescued];
      } else {
        const target = fallback;
        if (target) target.links.push(...g.links);
        data.groups = data.groups.filter(x => x.id !== g.id);
      }
      save(); render($("#search").value); toast(t("toast_group_deleted"));
    });
    actions.append(addBtn, delBtn);

    /* side-by-side pair toggle (edit mode only): pairs this group with the next */
    if (editMode && !q) {
      const pairBtn = document.createElement("button");
      pairBtn.className = "btn pair-btn" + (besideSet.has(g.id) ? " active" : "");
      pairBtn.type = "button";
      pairBtn.textContent = besideSet.has(g.id) ? "⫲" : "⫲";
      pairBtn.title = besideSet.has(g.id)
        ? t("pair_off")
        : t("pair_on");
      pairBtn.setAttribute("aria-pressed", besideSet.has(g.id) ? "true" : "false");
      pairBtn.addEventListener("click", () => {
        if (besideSet.has(g.id)) {
          viewState.beside = viewState.beside.filter(id => id !== g.id);
        } else {
          viewState.beside.push(g.id);
        }
        saveViewState();
        render($("#search").value);
      });
      actions.insertBefore(pairBtn, delBtn);
    }

    /* drag handle for group reordering (edit mode only) */
    let dragHandle = null;
    if (editMode && !q && data.groups.length > 1) {
      dragHandle = document.createElement("span");
      dragHandle.className = "group-drag-handle";
      dragHandle.textContent = "⠿";
      dragHandle.title = t("drag_handle_title");
      dragHandle.draggable = true;
      dragHandle.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-zentrix-group", g.id);
        e.dataTransfer.effectAllowed = "move";
        group.classList.add("group-dragging");
      });
      dragHandle.addEventListener("dragend", () => group.classList.remove("group-dragging"));
      group.addEventListener("dragover", (e) => {
        if (!editMode || !e.dataTransfer.types.includes("application/x-zentrix-group")) return;
        e.preventDefault();
        group.classList.add("group-drag-over");
      });
      group.addEventListener("dragleave", () => group.classList.remove("group-drag-over"));
      group.addEventListener("drop", (e) => {
        if (!editMode) return;
        const draggedId = e.dataTransfer.getData("application/x-zentrix-group");
        if (!draggedId || draggedId === g.id) { group.classList.remove("group-drag-over"); return; }
        e.preventDefault();
        group.classList.remove("group-drag-over");
        const fromIdx = data.groups.findIndex(x => x.id === draggedId);
        const targetIdx = data.groups.findIndex(x => x.id === g.id);
        if (fromIdx < 0 || targetIdx < 0) return;
        const [moved] = data.groups.splice(fromIdx, 1);
        /* insertion index AFTER removal — drop onto = insert at the target's new position */
        const insertIdx = data.groups.findIndex(x => x.id === g.id);
        data.groups.splice(insertIdx < 0 ? targetIdx : insertIdx, 0, moved);
        save(); render($("#search").value); toast(t("toast_order_saved"));
      });
    }

    const delGroup = document.createElement("button");
    delGroup.className = "del-group";
    delGroup.textContent = "🗑";
    delGroup.title = t("del_group_title");
    delGroup.addEventListener("click", () => delBtn.click());

    head.append(title, count, delGroup, actions);
    if (dragHandle) head.append(dragHandle);
    group.appendChild(head);

    /* grid — per-group layout: list (cards stacked) or grid (side by side columns) */
    const grid = document.createElement("div");
    const layoutMode = groupLayoutOf(g.id);
    grid.className = "grid" + (layoutMode === "grid" ? " layout-grid" : "");
    grid.dataset.groupId = g.id;

    for (const link of links) grid.appendChild(cardEl(link, g));
    if (editMode && !q) {
      const add = document.createElement("button");
      add.className = "add-card";
      add.textContent = t("add_link_btn");
      add.addEventListener("click", () => openModal(null, g));
      grid.appendChild(add);
    }
    group.appendChild(grid);
    rowEl.appendChild(group);
  }
  board.appendChild(rowEl);
  }

  const noRes = $("#no-results");
  if (q && total === 0) {
    noRes.textContent = t("no_results");
    noRes.style.display = "block";
  } else if (!q && data.groups.length === 0) {
    noRes.textContent = t("empty_board");
    noRes.style.display = "block";
  } else {
    noRes.style.display = "none";
  }

  /* fill group select in modal */
  const sel = $("#f-group");
  sel.textContent = "";
  for (const g of data.groups) {
    const opt = document.createElement("option");
    opt.value = g.id; opt.textContent = g.name;
    sel.appendChild(opt);
  }

  /* adaptive header contrast over custom background — retries cover async image decode */
  if (settings.bg === "custom" || settings.bg === "immich") {
    requestAnimationFrame(adaptGroupHeaders);
    [300, 800, 1600].forEach(ms => setTimeout(adaptGroupHeaders, ms));
  }

  /* two groups side by side on ≥ FullHD (user opt-in via settings.gridColumns === "groups") */
  document.body.classList.toggle("groups-side-by-side", settings.gridColumns === "groups" && window.innerWidth >= COMPACT_BREAKPOINT);
}

function cardEl(link, group) {
  const url = safeUrl(link.url) || "#";
  const a = document.createElement("a");
  a.className = "card";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.draggable = editMode;
  a.dataset.url = url;

  const ico = document.createElement("div");
  ico.className = "ico";
  const iconUrl = safeIcon(link.icon);
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => { img.remove(); ico.textContent = initialOf(link.name); });
    ico.appendChild(img);
  } else {
    ico.textContent = initialOf(link.name);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = link.name;
  meta.append(name);
  if (!viewState.compact) {
    const sub = document.createElement("div");
    sub.className = "url";
    sub.textContent = url.replace(/^https?:\/\//, "");
    meta.append(sub);
  }

  const dot = document.createElement("span");
  dot.className = "status";

  const del = document.createElement("button");
  del.className = "del-btn";
  del.textContent = "✕";
  del.title = t("del_link_title");
  del.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    group.links = group.links.filter(l => l !== link);
    save(); render($("#search").value); toast(t("toast_link_deleted"));
  });

  a.append(ico, meta, dot, del);

  /* edit on click in edit mode; after opening a search hit, auto-clear the
     search field so a new term can be typed immediately (no ESC needed) */
  a.addEventListener("click", (e) => {
    if (editMode) { e.preventDefault(); openModal(link, group); return; }
    const search = $("#search");
    if (search && search.value) {
      setTimeout(() => { search.value = ""; render(""); }, 120);
    }
    /* narrow screens: search was opened via magnifier → auto-hide again */
    setTimeout(hideSearchOnMobileAfterNav, 150);
  });

  /* drag & drop reorder / move between groups */
  a.addEventListener("dragstart", (e) => {
    if (!editMode) { e.preventDefault(); return; }
    e.dataTransfer.setData("text/plain", JSON.stringify({ group: group.id, name: link.name, url: link.url, icon: link.icon }));
    a.classList.add("dragging");
  });
  a.addEventListener("dragend", () => a.classList.remove("dragging"));
  a.addEventListener("dragover", (e) => { if (editMode) { e.preventDefault(); a.classList.add("drag-over"); } });
  a.addEventListener("dragleave", () => a.classList.remove("drag-over"));
  a.addEventListener("drop", (e) => {
    if (!editMode) return;
    e.preventDefault(); a.classList.remove("drag-over");
    try {
      const payload = JSON.parse(e.dataTransfer.getData("text/plain"));
      const srcGroup = data.groups.find(g => g.id === payload.group);
      if (!srcGroup) return;
      const srcLink = srcGroup.links.find(l => l.name === payload.name && l.url === payload.url);
      if (!srcLink) return;
      srcGroup.links = srcGroup.links.filter(l => l !== srcLink);
      const targetIdx = group.links.indexOf(link);
      group.links.splice(targetIdx, 0, srcLink);
      save(); render($("#search").value);
    } catch {}
  });

  return a;
}

/* ---- modal (WYSIWYG link editor) ---- */
function openModal(link, group) {
  editingLink = link;
  editingGroup = group;
  $("#modal-title").textContent = link ? t("modal_edit_title") : t("modal_add_title");
  $("#f-name").value = link ? link.name : "";
  $("#f-url").value = link ? link.url : "";
  $("#f-icon").value = link ? (link.icon || "") : "";
  $("#f-group").value = group ? group.id : data.groups[0]?.id;
  renderIconPreview();
  $("#modal-backdrop").classList.add("open");
  $("#f-name").focus();
}
function closeModal() { $("#modal-backdrop").classList.remove("open"); editingLink = null; editingGroup = null; }

function renderIconPreview() {
  const box = $("#icon-preview");
  box.textContent = "";
  const u = safeIcon($("#f-icon").value);
  if (u) {
    const img = document.createElement("img");
    img.src = u; img.alt = t("icon_preview_alt"); img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => { box.textContent = t("icon_broken"); });
    box.appendChild(img);
  }
}

/* ---- icon picker: search dashboard-icons catalog (jsDelivr metadata.json) ---- */
const ICON_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons";
const ICON_META_URL = ICON_CDN + "@main/metadata.json";
const ICON_CACHE_KEY = "zentrix-icon-catalog-v1";
const ICON_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
let iconCatalog = null;        // { name: {base, aliases} }
let iconSearchTimer = null;

async function ensureIconCatalog() {
  if (iconCatalog) return iconCatalog;
  /* try cache */
  try {
    const raw = localStorage.getItem(ICON_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.ts && (Date.now() - cached.ts) < ICON_CACHE_TTL && cached.data) {
        iconCatalog = cached.data;
        return iconCatalog;
      }
    }
  } catch (e) { /* ignore corrupt cache */ }
  /* fetch fresh */
  const res = await fetch(ICON_META_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error("Katalog-HTTP " + res.status);
  const data = await res.json();
  if (!data || typeof data !== "object") throw new Error("Katalog-Format unerwartet");
  iconCatalog = data;
  try { localStorage.setItem(ICON_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) { /* quota — ignore */ }
  return iconCatalog;
}

function searchIcons(query, limit = 24) {
  if (!iconCatalog) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const [name, meta] of Object.entries(iconCatalog)) {
    const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else {
      for (const a of aliases) {
        const al = a.toLowerCase();
        if (al === q) { score = Math.max(score, 90); break; }
        if (al.startsWith(q)) { score = Math.max(score, 70); break; }
        if (al.includes(q)) { score = Math.max(score, 50); break; }
      }
    }
    if (score > -1) {
      /* prefer SVG (base svg = crisp) — slight bonus; name as tiebreak */
      scored.push({ name, base: meta.base || "svg", score: score + (meta.base === "svg" ? 2 : 0) });
    }
    /* color variants (colors.light / colors.dark, e.g. vaultwarden-light) —
       they exist as files in the repo but are NOT catalog keys themselves */
    const colors = meta.colors || {};
    for (const vn of [colors.light, colors.dark]) {
      if (!vn || vn === name) continue;
      let vs = -1;
      if (vn === q) vs = 95;
      else if (vn.startsWith(q)) vs = 75;
      else if (vn.includes(q)) vs = 55;
      else if (q.length >= 4 && vn.includes(q)) vs = 45;
      if (vs > -1) {
        scored.push({ name: vn, base: meta.base || "svg", score: vs });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}

function iconUrlFor(name, base) {
  return base === "png" ? `${ICON_CDN}/png/${name}.png` : `${ICON_CDN}/svg/${name}.svg`;
}

function renderIconResults(query) {
  const box = $("#icon-results");
  box.textContent = "";
  if (!query.trim()) { box.classList.remove("has-items"); return; }
  const hits = searchIcons(query);
  if (!hits.length) {
    const none = document.createElement("div");
    none.className = "icon-none";
    none.textContent = t("icon_none");
    box.appendChild(none);
    box.classList.add("has-items");
    return;
  }
  const grid = document.createElement("div");
  grid.className = "icon-grid";
  for (const hit of hits) {
    const url = iconUrlFor(hit.name, hit.base);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-item";
    btn.title = `${hit.name}.${hit.base} — ${t("icon_pick_hint")}`;
    const img = document.createElement("img");
    img.src = url; img.alt = hit.name; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => { btn.classList.add("broken"); btn.disabled = true; });
    const label = document.createElement("span");
    label.textContent = hit.name;
    btn.append(img, label);
    btn.addEventListener("click", () => {
      $("#f-icon").value = url;
      renderIconPreview();
      box.textContent = "";
      box.classList.remove("has-items");
      toast(t("icon_set", { icon: hit.name + "." + hit.base }));
    });
    grid.appendChild(btn);
  }
  box.appendChild(grid);
  box.classList.add("has-items");
}

$("#f-icon").addEventListener("input", () => {
  renderIconPreview();
  clearTimeout(iconSearchTimer);
  const q = $("#f-icon").value;
  /* only search when the user typed a WORD (no URL) */
  if (q.includes("://")) { $("#icon-results").textContent = ""; $("#icon-results").classList.remove("has-items"); return; }
  iconSearchTimer = setTimeout(async () => {
    const box = $("#icon-results");
    box.textContent = "";
    box.classList.add("has-items");
    const status = document.createElement("div");
    status.className = "icon-none";
    status.textContent = t("icon_loading");
    box.appendChild(status);
    try {
      await ensureIconCatalog();
      renderIconResults(q);
    } catch (e) {
      box.textContent = "";
      const err = document.createElement("div");
      err.className = "icon-none";
      err.textContent = t("icon_catalog_fail");
      box.appendChild(err);
    }
  }, 250);
});

$("#btn-save").addEventListener("click", () => {
  const name = $("#f-name").value.trim();
  const url = safeUrl($("#f-url").value);
  const icon = safeIcon($("#f-icon").value);
  const groupId = $("#f-group").value;
  if (!name) { toast(t("toast_name_missing")); $("#f-name").focus(); return; }
  if (!url) { toast(t("toast_url_invalid")); $("#f-url").focus(); return; }

  const targetGroup = data.groups.find(g => g.id === groupId);
  if (!targetGroup) { toast(t("toast_group_target_missing")); return; }

  if (editingLink) {
    /* remove from old group, add/update in target group */
    for (const g of data.groups) {
      const idx = g.links.indexOf(editingLink);
      if (idx > -1) g.links.splice(idx, 1);
    }
    targetGroup.links.push({ name, url, icon: icon || null });
  } else {
    targetGroup.links.push({ name, url, icon: icon || null });
  }
  save(); closeModal(); render($("#search").value);
  toast(editingLink ? t("toast_link_updated") : t("toast_link_added"));
});
$("#btn-cancel").addEventListener("click", closeModal);
$("#modal-backdrop").addEventListener("click", (e) => { if (e.target === $("#modal-backdrop")) closeModal(); });
$("#f-icon").addEventListener("input", renderIconPreview);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---- edit mode toggle ---- */
$("#btn-edit").addEventListener("click", () => {
  editMode = !editMode;
  document.body.classList.toggle("edit-mode", editMode);
  /* icon-only button: ✓ while editing, ✎ otherwise (labels go to title/aria) */
  $("#btn-edit").textContent = editMode ? "✓" : "✎";
  $("#btn-edit").title = editMode ? t("done") : t("edit");
  $("#btn-edit").setAttribute("aria-label", $("#btn-edit").title);
  $("#btn-edit").classList.toggle("primary", !editMode);
  render($("#search").value);
  toast(editMode ? t("toast_edit_on") : t("toast_edit_off"));
});

/* ---- add group ---- */
$("#btn-addgroup").addEventListener("click", () => {
  const name = prompt(t("prompt_new_group"), t("new_group_name"));
  if (!name) return;
  data.groups.push({ id: uid(), name: name.trim(), links: [] });
  save(); render($("#search").value); toast(t("toast_group_created"));
});

/* ---- export / import ---- */
$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "zentrix-homelab-links.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t("toast_export"));
});
$("#btn-import").addEventListener("click", () => $("#file-import").click());
$("#file-import").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.groups)) throw new Error(t("import_bad_format"));
      data = parsed; save(); render($("#search").value);
      toast(t("toast_import_ok", { n: data.groups.reduce((n, g) => n + g.links.length, 0) }));
    } catch (err) { toast(t("toast_import_fail", { msg: err.message })); }
  };
  reader.readAsText(file);
  e.target.value = "";
});
$("#btn-reset").addEventListener("click", async () => {
  if (!confirm(t("confirm_reset"))) return;
  const ok = await serverLoad();
  render($("#search").value);
  toast(ok ? t("toast_reset_ok") : t("toast_reset_offline"));
});

/* ---- search + hotkeys ---- */
$("#search").addEventListener("input", (e) => render(e.target.value));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#search").focus(); }
  if (e.key === "Escape" && document.activeElement === $("#search")) { $("#search").value = ""; render(""); }
});

/* ---- clock ---- */
function tickClock() {
  const now = new Date();
  $("#clock-time").textContent = now.toLocaleTimeString(currentLang === "ar" ? "ar" : currentLang);
  $("#clock-date").textContent = now.toLocaleDateString(currentLang, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
setInterval(tickClock, 1000); tickClock();


/* ---- view mode (compact/grid) + per-group layout ---- */
let viewState = { compact: false, gridColumns: 0, layout: {}, beside: [] };   // layout: groupId → "list"|"grid"; beside: [groupId,…] = pair with next marked group
const VIEW_KEY = STORAGE_KEY + "-view";
function loadViewState() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (typeof p.layout === "object" && p.layout) viewState.layout = p.layout;
        if (Array.isArray(p.beside)) viewState.beside = p.beside.filter(x => typeof x === "string");
      }
    }
  } catch (e) {}
}
function saveViewState() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewState)); } catch (e) {} }
/* FullHD = 1920: below that compact is auto-enabled (unless user set manual layout) */
const COMPACT_BREAKPOINT = 1920;
function effectiveCompact() {
  if (window.innerWidth < COMPACT_BREAKPOINT) return true;
  return settings.compact;
}
function applyViewMode() {
  const compact = effectiveCompact();
  viewState.compact = compact;
  document.body.classList.toggle("compact-links", compact);
  const cols = settings.gridColumns;   /* 0 = auto */
  document.body.style.setProperty("--grid-cols", cols >= 2 ? `repeat(${cols}, minmax(0, 1fr))` : "");
  document.body.classList.toggle("fixed-cols", cols >= 2);
}
/* group layout: "list" (default grid of cards stacked) vs "grid" (multi-column) */
function groupLayoutOf(groupId) {
  return viewState.layout[groupId] || settings.layout || "auto";
}
/* ---- settings modal wiring ---- */
function openSettings() {
  $("#settings-backdrop").classList.add("open");
  showSettingsTab("appearance");
  const themeSel = $("#set-theme");
  if (themeSel) for (const opt of themeSel.options || []) if (opt.value === settings.theme) opt.selected = true;
  const bgSel = $("#set-background");
  if (bgSel) for (const opt of bgSel.options || []) if (opt.value === settings.bg) opt.selected = true;
  const clockChk = $("#set-clock"); if (clockChk) clockChk.checked = settings.clock;
  if (settings.bg === "custom") updateBgUploadUi();
  updateFaviconUi();
  const compactChk = $("#set-compact"); if (compactChk) compactChk.checked = !!settings.compact;
  const colsSel = $("#set-grid-columns");
  if (colsSel) {
    const cur = settings.gridColumns === "groups" ? "groups" : (settings.gridColumns >= 2 ? String(settings.gridColumns) : "auto");
    for (const opt of colsSel.options || []) if (opt.value === cur) opt.selected = true;
  }
  const titleInput = $("#set-title"); if (titleInput) titleInput.value = settings.title || "homelab";
  const accentInput = $("#set-accent-color");
  if (accentInput) {
accentInput.value = settings.accent[settings.theme] || themeAccentHex();
  }
  loadImmichConfig();
  applyI18n();
}

/* ---- Immich background configuration (Branding tab) ----
   The API key is write-only: the server never returns it, the field stays
   empty and only shows a masked hint when a key is stored. */
function loadImmichConfig() {
  fetch("/api/immich/config", { headers: { "X-Auth-Token": getToken() }, credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      const status = $("#immich-status");
      if (!cfg) { if (status) status.textContent = ""; return; }
      const url = $("#set-immich-url"); if (url) url.value = cfg.url || "";
      const album = $("#set-immich-album"); if (album) album.value = cfg.album || "";
      const iv = $("#set-immich-interval");
      if (iv) { for (const o of iv.options) if (Number(o.value) === Number(cfg.interval)) o.selected = true; }
      const key = $("#set-immich-key"); if (key) key.value = "";
      const hint = $("#hint-immich-key");
      if (hint) hint.textContent = cfg.key_set ? t("immich_key_set") + " (" + cfg.key_hint + ")" : t("immich_key_hint");
      const priv = $("#hint-immich-privacy");
      if (priv) priv.textContent = t("immich_privacy_hint");
      updateImmichStatus(cfg);
    })
    .catch(() => {});
}
function updateImmichStatus(cfg) {
  const status = $("#immich-status"); if (!status || !cfg) return;
  if (cfg.error) status.textContent = "⚠ " + t("immich_err_" + (cfg.error === "album_not_found" ? "album" : "conn"));
  else if (cfg.configured) status.textContent = "✓ " + t("immich_active");
  else status.textContent = t("immich_inactive");
}
function saveImmichConfig() {
  const payload = {
    url: ($("#set-immich-url") || {}).value || "",
    key: ($("#set-immich-key") || {}).value || "",
    album: ($("#set-immich-album") || {}).value || "",
    interval: Number(($("#set-immich-interval") || {}).value || 3600),
  };
  fetch("/api/immich/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Auth-Token": getToken() },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(() => {
      const status = $("#immich-status");
      if (status) status.textContent = "✓ " + t("immich_saved");
      loadImmichConfig();
      /* switch bg to immich if not already on a photo mode */
      if (settings.bg !== "custom" && settings.bg !== "immich") {
        settings.bg = "immich"; saveSettings(); applyBg(); syncSettingsUi();
      }
    })
    .catch(() => {
      const status = $("#immich-status");
      if (status) status.textContent = "⚠ " + t("immich_save_failed");
    });
}
function testImmichConfig() {
  const status = $("#immich-status");
  if (status) status.textContent = "… " + t("immich_testing");
  const payload = {
    url: ($("#set-immich-url") || {}).value || "",
    key: ($("#set-immich-key") || {}).value || "",
    album: ($("#set-immich-album") || {}).value || "",
  };
  fetch("/api/immich/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Auth-Token": getToken() },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((res) => {
      if (!status) return;
      if (res.ok) status.textContent = "✓ " + t("immich_test_ok").replace("{n}", res.photos);
      else if (res.error === "album_not_found") status.textContent = "⚠ " + t("immich_err_album");
      else status.textContent = "⚠ " + t("immich_err_conn");
    })
    .catch(() => { if (status) status.textContent = "⚠ " + t("immich_err_conn"); });
}
function closeSettings() { $("#settings-backdrop").classList.remove("open"); }
$("#btn-settings").addEventListener("click", openSettings);
/* settings tabs */
const SETTINGS_TABS = {
  appearance: { tab: "tab-appearance", pane: "pane-appearance" },
  branding:   { tab: "tab-branding",   pane: "pane-branding" },
  immich:     { tab: "tab-immich",     pane: "pane-immich" },
  data:       { tab: "tab-data",       pane: "pane-data" },
  info:       { tab: "tab-info",       pane: "pane-info" },
};
function showSettingsTab(name) {
  for (const [key, ids] of Object.entries(SETTINGS_TABS)) {
    const active = key === name;
    const tab = document.getElementById(ids.tab);
    const pane = document.getElementById(ids.pane);
    if (tab) tab.classList.toggle("active", active);
    if (pane) pane.classList.toggle("active", active);
    if (tab) tab.setAttribute("aria-selected", active ? "true" : "false");
  }
}
for (const [key, ids] of Object.entries(SETTINGS_TABS)) {
  const tab = document.getElementById(ids.tab);
  if (tab) tab.addEventListener("click", () => showSettingsTab(key));
}
$("#btn-settings-close").addEventListener("click", closeSettings);
$("#settings-backdrop").addEventListener("click", (e) => { if (e.target === $("#settings-backdrop")) closeSettings(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });

$("#set-theme").addEventListener("change", (e) => {
  settings.theme = e.target.options?.[e.target.selectedIndex]?.value || e.target.value || "binary";
  if (!THEMES.includes(settings.theme)) settings.theme = "binary";
  saveSettings(); applyTheme();
});
$("#set-background").addEventListener("change", (e) => {
  settings.bg = e.target.options?.[e.target.selectedIndex]?.value || e.target.value || "pcb";
  if (!BGS.includes(settings.bg)) settings.bg = "pcb";
  saveSettings(); applyBg();
  if (settings.bg === "custom") updateBgUploadUi();
});
$("#set-language").addEventListener("change", (e) => {
  const v = e.target.options?.[e.target.selectedIndex]?.value || e.target.value;
  if (I18N.strings[v]) setLang(v);
});
$("#set-clock").addEventListener("change", (e) => {
  settings.clock = !!e.target.checked;
  saveSettings(); applyClock();
});

/* ---- favicon: default big red Z, custom upload via settings ---- */
const FAVICON_KEY = STORAGE_KEY + "-favicon";
const FAVICON_MAX = 256 * 1024;   /* 256 KB — favicons are tiny */
function defaultFavicon() {
  /* big red Z on a dark rounded square — canvas, with inline-SVG fallback */
  try {
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2d ctx");
    g.fillStyle = "#0a0c0f";
    g.beginPath();
    if (g.roundRect) g.roundRect(0, 0, 64, 64, 12); else g.rect(0, 0, 64, 64);
    g.fill();
    g.strokeStyle = "#e02020";
    g.lineWidth = 8;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(16, 12); g.lineTo(48, 12); g.lineTo(16, 52); g.lineTo(48, 52);
    g.stroke();
    const url = c.toDataURL("image/png");
    if (url && url.startsWith("data:")) return url;
    throw new Error("toDataURL failed");
  } catch (e) {
    /* static SVG fallback (same look, no canvas needed) */
    return "data:image/svg+xml," + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
      "<rect width='64' height='64' rx='12' fill='#0a0c0f'/>" +
      "<path d='M16 12h32L16 52h32' stroke='#e02020' stroke-width='8' " +
      "stroke-linecap='round' stroke-linejoin='round' fill='none'/></svg>");
  }
}
function applyFavicon() {
  const url = localStorage.getItem(FAVICON_KEY) || defaultFavicon();
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}
$("#btn-fav-upload").addEventListener("click", () => $("#file-favicon").click());
$("#btn-fav-clear").addEventListener("click", () => {
  localStorage.removeItem(FAVICON_KEY);
  applyFavicon();
  updateFaviconUi();
  toast(t("fav_cleared"));
});
$("#file-favicon").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml", "image/jpeg", "image/webp"].includes(file.type)) {
    toast(t("bg_upload_bad_type")); return;
  }
  if (file.size > FAVICON_MAX) { toast(t("fav_too_big")); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem(FAVICON_KEY, String(reader.result));
      applyFavicon();
      updateFaviconUi();
      toast(t("fav_saved"));
    } catch (err) { toast(t("bg_upload_failed")); }
  };
  reader.onerror = () => toast(t("bg_upload_failed"));
  reader.readAsDataURL(file);
});
function updateFaviconUi() {
  const has = !!localStorage.getItem(FAVICON_KEY);
  const btnClear = $("#btn-fav-clear"); if (btnClear) btnClear.style.display = has ? "" : "none";
  const lbl = $("#lbl-favicon"); if (lbl) lbl.textContent = t("set_favicon");
  const btnUp = $("#btn-fav-upload"); if (btnUp) btnUp.textContent = t("bg_upload_btn");
  const btnCl = $("#btn-fav-clear"); if (btnCl) btnCl.textContent = t("fav_reset");
}

/* ---- custom topbar title (/homelab → user text) ---- */
function applyTitle() {
  const em = document.querySelector(".wordmark em");
  if (em) em.textContent = "/" + (settings.title || "homelab");
}

/* ---- mobile search toggle (magnifier button in topbar) ---- */
$("#btn-search-toggle").addEventListener("click", () => {
  const wrap = document.querySelector(".searchwrap");
  const show = wrap.style.display === "none" || !wrap.style.display;
  wrap.style.display = show ? "" : "none";
  if (show) $("#search").focus();
  document.body.classList.toggle("search-open", show);
});
/* auto-hide after successful search click (narrow screens) */
document.addEventListener("click", (e) => {
  const card = e.target.closest && e.target.closest("a.card");
  if (!card || viewState.compact !== undefined) { /* no-op guard */ }
}, true);
function hideSearchOnMobileAfterNav() {
  if (window.innerWidth <= 640) {
    const wrap = document.querySelector(".searchwrap");
    if (wrap) wrap.style.display = "none";
    document.body.classList.remove("search-open");
  }
}

/* ---- per-theme accent color pickers ---- */
$("#set-accent-apply").addEventListener("click", () => {
  const val = $("#set-accent-color").value;
  settings.accent[settings.theme] = val;
  saveSettings(); applyTheme();
  toast(t("accent_saved"));
});
$("#set-accent-reset").addEventListener("click", () => {
  delete settings.accent[settings.theme];
  saveSettings(); applyTheme();
  /* restore the theme's default color in the picker immediately */
  const input = $("#set-accent-color");
  if (input) input.value = themeAccentHex();
  toast(t("accent_reset"));
});

/* ---- Immich settings handlers ---- */
const btnImmichSave = $("#btn-immich-save");
if (btnImmichSave) btnImmichSave.addEventListener("click", saveImmichConfig);
const btnImmichTest = $("#btn-immich-test");
if (btnImmichTest) btnImmichTest.addEventListener("click", testImmichConfig);

/* ---- compact / columns / layout settings handlers ---- */
$("#set-compact").addEventListener("change", (e) => {
  settings.compact = !!e.target.checked;
  saveSettings(); applyViewMode(); render($("#search").value);
});
$("#set-grid-columns").addEventListener("change", (e) => {
  const v = e.target.options?.[e.target.selectedIndex]?.value;
  settings.gridColumns = v === "groups" ? "groups" : (v === "auto" ? 0 : parseInt(v, 10));
  saveSettings(); applyViewMode(); render($("#search").value);
});
$("#set-title").addEventListener("input", (e) => {
  settings.title = e.target.value.slice(0, 40);
  saveSettings(); applyTitle();
});

/* ---- custom background upload ---- */
$("#btn-bg-upload").addEventListener("click", () => $("#file-bg").click());
$("#btn-bg-clear").addEventListener("click", () => {
  localStorage.removeItem(BG_IMAGE_KEY);
  applyBg();
  updateBgUploadUi();
  toast(t("bg_upload_removed"));
});
$("#file-bg").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!BG_IMAGE_TYPES.includes(file.type)) { toast(t("bg_upload_bad_type")); return; }
  if (file.size > BG_IMAGE_MAX) { toast(t("bg_upload_too_big")); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      localStorage.setItem(BG_IMAGE_KEY, String(reader.result));
      applyBg();
      updateBgUploadUi();
      toast(t("bg_upload_ok"));
    } catch (err) {
      /* localStorage quota (data-URL can exceed quota even under 4 MB) */
      toast(t("bg_upload_failed"));
    }
  };
  reader.onerror = () => toast(t("bg_upload_failed"));
  reader.readAsDataURL(file);
});

/* ---- boot ---- */
loadSettings();
loadViewState();
applyFavicon();
applyTitle();
applyI18n();
applySettings();
applyViewMode();
render();
serverLoad().then(() => { render($("#search").value); hideSearchOnMobileAfterNav(); });

/* Sync-Chip: Klick öffnet Token-Dialog */
$("#sync-chip").addEventListener("click", () => askToken(false));
