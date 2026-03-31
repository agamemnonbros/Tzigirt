import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://nuschwycdwvntbvstbrp.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51c2Nod3ljZHd2bnRidnN0YnJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MDI4NzYsImV4cCI6MjA5MDI3ODg3Nn0._CXCL5FtD83wf9OdgLV-wBBA1s7k8hhVzVinL1stDl0"
);

const STATUTS = ["Commande", "En transit", "Arrivé", "Vendu", "Annulé"];
const DEVISES = ["DZD", "USD", "EUR"];
const ASSOCIES = ["Smaine", "Yacine"];
const CATEGORIES_FLUX = ["Achat véhicule","Change USD","Fret/transport","Douane","TVN","Dégroupage","Transitaire","Commission Passeport","Ingénieur des Mines","Quittance","Assurance port","Timbre","Frais chèque certifié","Vente véhicule","Acompte client","Commission commercial","Frais bancaires","Autre"];

// Frais fixes détaillés (image)
const FRAIS_FIXES = [
  { key: "fret",                 label: "Fret / Transport",          dateKey: "date_fret" },
  { key: "dedouanement",         label: "Dédouanement",              dateKey: "date_dedouanement" },
  { key: "tvn",                  label: "TVN (Taxe Véhicule Neuf)",  dateKey: "date_tvn" },
  { key: "degroupage",           label: "Dégroupage",                dateKey: "date_degroupage" },
  { key: "transitaire",          label: "Transitaire",               dateKey: "date_transitaire" },
  { key: "commission_passeport", label: "Commission Passeport",      dateKey: "date_commission_passeport" },
  { key: "ingenieur_mines",      label: "Ingénieur des Mines",       dateKey: "date_ingenieur_mines" },
  { key: "quittance",            label: "Quittance",                 dateKey: "date_quittance" },
  { key: "assurance_port",       label: "Assurance (Sortie de port)",dateKey: "date_assurance_port" },
  { key: "timbre",               label: "Timbre",                    dateKey: "date_timbre" },
  { key: "frais_cheque",         label: "Frais chèque certifié",     dateKey: "date_frais_cheque" },
  { key: "autres_frais",         label: "Autres frais",              dateKey: null },
];

const fmt = (n, dec = 0) => { if (n === "" || n === null || n === undefined || isNaN(Number(n))) return "—"; return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n)); };
const fmtDZD = (n) => (n === "" || isNaN(Number(n))) ? "—" : `${fmt(n)} DZD`;
const fmtPct = (n) => (n === "" || isNaN(Number(n))) ? "—" : `${fmt(Number(n) * 100, 1)} %`;
const today = () => new Date().toISOString().slice(0, 10);

// ─── Mapping DB <-> App ────────────────────────────────────────
const dbToVeh = (r) => ({
  id: r.id,
  modele: r.modele || "", chassis: r.chassis || "", statut: r.statut || "Commande",
  dateAchat: r.date_achat || "", arrivePrevue: r.arrive_prevue || "", venteReelle: r.vente_reelle || "",
  achatUSD: r.achat_usd ?? "", tauxVehicule: r.taux_vehicule ?? "",
  acheteur: r.acheteur || "Smaine",
  commercial_nom: r.commercial_nom || "Yacine",
  commercial_commission: r.commercial_commission ?? 0,
  ventePrevueDZD: r.vente_prevue_dzd ?? "", venteReelleDZD: r.vente_reelle_dzd ?? "",
  // frais détaillés
  ...Object.fromEntries(FRAIS_FIXES.flatMap(f => [
    [f.key, r[f.key] ?? ""],
    ...(f.dateKey ? [[f.dateKey, r[f.dateKey] || ""]] : [])
  ])),
  date_fret: r.date_fret || "",
});

const vehToDB = (f) => ({
  modele: f.modele, chassis: f.chassis || null, statut: f.statut,
  date_achat: f.dateAchat || null, arrive_prevue: f.arrivePrevue || null, vente_reelle: f.venteReelle || null,
  achat_usd: f.achatUSD ? Number(f.achatUSD) : null,
  taux_vehicule: f.tauxVehicule ? Number(f.tauxVehicule) : null,
  acheteur: f.acheteur || "Smaine",
  commercial_nom: f.commercial_nom || "Yacine",
  commercial_commission: Number(f.commercial_commission) || 0,
  vente_prevue_dzd: f.ventePrevueDZD ? Number(f.ventePrevueDZD) : null,
  vente_reelle_dzd: f.venteReelleDZD ? Number(f.venteReelleDZD) : null,
  ...Object.fromEntries(FRAIS_FIXES.flatMap(ff => [
    [ff.key, Number(f[ff.key]) || 0],
    ...(ff.dateKey ? [[ff.dateKey, f[ff.dateKey] || null]] : [])
  ])),
  date_fret: f.date_fret || null,
});

const dbToFlux = (r) => ({ id: r.id, date: r.date || "", type: r.type || "Sortie", categorie: r.categorie || "", idVehicule: r.id_vehicule ?? "", description: r.description || "", devise: r.devise || "DZD", montant: r.montant ?? "", taux: r.taux ?? "" });
const fluxToDB = (f) => ({ date: f.date, type: f.type, categorie: f.categorie, id_vehicule: f.idVehicule ? Number(f.idVehicule) : null, description: f.description || null, devise: f.devise, montant: Number(f.montant), taux: f.taux ? Number(f.taux) : null });

// ─── Calculs ───────────────────────────────────────────────────
function calcVehicule(v, params) {
  const taux = Number(v.tauxVehicule) || Number(params.tauxUSD);
  const achatDZD = Number(v.achatUSD) ? Number(v.achatUSD) * taux : 0;
  const fraisTotal = FRAIS_FIXES.reduce((a, f) => a + (Number(v[f.key]) || 0), 0);
  const coutTotal = achatDZD + fraisTotal;
  const hasCouts = !!Number(v.achatUSD);
  const coutTotalDisplay = hasCouts ? coutTotal : "";
  const commission = Number(v.commercial_commission) || 0;
  const margeReelle = (hasCouts && Number(v.venteReelleDZD)) ? Number(v.venteReelleDZD) - coutTotal - commission : "";
  const margePct = (margeReelle !== "" && Number(v.venteReelleDZD)) ? margeReelle / Number(v.venteReelleDZD) : "";
  const margePrevue = (hasCouts && Number(v.ventePrevueDZD)) ? Number(v.ventePrevueDZD) - coutTotal - commission : "";
  const cashEngage = (!v.id || v.statut === "Vendu" || v.statut === "Annulé") ? 0 : (hasCouts ? coutTotal : 0);
  return { achatDZD, fraisTotal, coutTotalDisplay, margeReelle, margePct, margePrevue, cashEngage };
}

function montantDZD(m, params) {
  const brut = Number(m.montant) || 0;
  let dzd = m.devise === "DZD" ? brut : brut * (Number(m.taux) || (m.devise === "USD" ? Number(params.tauxUSD) : Number(params.tauxEUR)));
  return m.type === "Sortie" ? -dzd : dzd;
}

// ─── UI primitives ─────────────────────────────────────────────
function KPI({ label, value, sub, color = "amber", alert }) {
  const cols = { amber: "#f59e0b", red: "#f87171", green: "#4ade80", blue: "#60a5fa", muted: "#64748b", purple: "#c084fc" };
  return (
    <div style={{ background: "#0f172a", border: `1px solid ${alert ? "#7f1d1d" : "#1e293b"}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: cols[color] }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Badge({ statut }) {
  const map = { "Commande": ["#1e293b","#94a3b8"], "En transit": ["#0c1a3a","#93c5fd"], "Arrivé": ["#1a1200","#fbbf24"], "Vendu": ["#0a2010","#4ade80"], "Annulé": ["#1a0a0a","#f87171"] };
  const [bg, color] = map[statut] || ["#1e293b", "#94a3b8"];
  return <span style={{ background: bg, color, fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{statut}</span>;
}

function AssociBadge({ nom }) {
  const isYacine = nom === "Yacine";
  return <span style={{ background: isYacine ? "#1a0a2e" : "#0a1a2e", color: isYacine ? "#c084fc" : "#60a5fa", fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>{nom}</span>;
}

function Btn({ children, onClick, variant = "primary", small, type = "button" }) {
  const vs = { primary: { background: "#f59e0b", color: "#0c0a00", fontWeight: 600 }, ghost: { background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }, danger: { background: "#300", color: "#fca5a5", border: "1px solid #7f1d1d" }, info: { background: "#0c1a3a", color: "#93c5fd", border: "1px solid #1e3a5f" } };
  return <button type={type} onClick={onClick} style={{ ...vs[variant], borderRadius: 8, padding: small ? "4px 10px" : "7px 14px", fontSize: small ? 11 : 12, cursor: "pointer", fontFamily: "inherit" }}>{children}</button>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", backdropFilter: "blur(4px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, width: "100%", maxWidth: wide ? 780 : 600, maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #1e293b", position: "sticky", top: 0, background: "#0f172a", zIndex: 1 }}>
          <span style={{ fontWeight: 600, color: "#f1f5f9", fontSize: 14 }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "16px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

function F({ label, children, full, third }) {
  return (
    <div style={{ gridColumn: full ? "1/-1" : third ? "auto" : "auto" }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12, marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

const g2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };
const g3 = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 };
const th = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #1e293b", whiteSpace: "nowrap" };
const td = { padding: "9px 10px", borderBottom: "1px solid #0f172a", color: "#cbd5e1" };
const mono = { fontFamily: "'DM Mono', monospace" };

// ─── Formulaire véhicule ────────────────────────────────────────
function VehiculeForm({ initial, onSave, onClose, params }) {
  const blank = {
    modele: "", chassis: "", statut: "Commande", dateAchat: today(),
    arrivePrevue: "", venteReelle: "", achatUSD: "", tauxVehicule: "",
    acheteur: "Smaine", commercial_nom: params.commercial_nom || "Yacine", commercial_commission: 0,
    ventePrevueDZD: "", venteReelleDZD: "",
    ...Object.fromEntries(FRAIS_FIXES.flatMap(f => [[f.key, ""], ...(f.dateKey ? [[f.dateKey, ""]] : [])]))
  };
  const [f, setF] = useState(initial || blank);
  const [saving, setSaving] = useState(false);
  const u = (k, v) => setF(p => ({ ...p, [k]: v }));
  const calc = calcVehicule(f, params);

  const inp = (k, type = "text", placeholder) => <input type={type} value={f[k] ?? ""} onChange={e => u(k, e.target.value)} placeholder={placeholder} />;
  const sel = (k, opts) => <select value={f[k] ?? ""} onChange={e => u(k, e.target.value)}>{opts.map(o => <option key={o}>{o}</option>)}</select>;

  return (
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); await onSave(f); setSaving(false); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      <Section title="Identité du véhicule">
        <div style={g2}>
          <F label="Modèle *"><input required value={f.modele} onChange={e => u("modele", e.target.value)} /></F>
          <F label="Châssis / VIN">{inp("chassis")}</F>
          <F label="Statut">{sel("statut", STATUTS)}</F>
          <F label="Date achat">{inp("dateAchat", "date")}</F>
          <F label="Arrivée prévue">{inp("arrivePrevue", "date")}</F>
          <F label="Date vente réelle">{inp("venteReelle", "date")}</F>
        </div>
      </Section>

      <Section title="Associés & Commercial">
        <div style={g3}>
          <F label="Acheteur (associé)">{sel("acheteur", ASSOCIES)}</F>
          <F label="Nom du commercial">{inp("commercial_nom")}</F>
          <F label="Commission commercial (DZD)">{inp("commercial_commission", "number", "0")}</F>
        </div>
      </Section>

      <Section title="Prix d'achat">
        <div style={g2}>
          <F label="Achat fournisseur (USD)">{inp("achatUSD", "number")}</F>
          <F label={`Taux USD/DZD (déf. ${params.tauxUSD})`}>{inp("tauxVehicule", "number")}</F>
        </div>
        {f.achatUSD && <div style={{ fontSize: 11, ...mono, color: "#f59e0b", background: "#1a1000", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>Achat converti : {fmt(calc.achatDZD)} DZD</div>}
      </Section>

      <Section title="Frais à l'arrivée (DZD) + dates d'échéance">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
          {FRAIS_FIXES.map(ff => (
            <div key={ff.key} style={{ display: "grid", gridTemplateColumns: ff.dateKey ? "2fr 1fr 1fr" : "2fr 2fr", gap: 8, alignItems: "end", padding: "5px 0", borderBottom: "1px solid #0f172a" }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{ff.label}</label>
                <input type="number" value={f[ff.key] ?? ""} onChange={e => u(ff.key, e.target.value)} placeholder="0" />
              </div>
              {ff.dateKey && (
                <div>
                  <label style={{ display: "block", fontSize: 10, color: "#475569", marginBottom: 4 }}>Date paiement</label>
                  <input type="date" value={f[ff.dateKey] ?? ""} onChange={e => u(ff.dateKey, e.target.value)} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
                <span style={{ fontSize: 11, ...mono, color: Number(f[ff.key]) ? "#f59e0b" : "#334155" }}>{Number(f[ff.key]) ? fmt(Number(f[ff.key])) + " DZD" : "—"}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, padding: "8px 10px", background: "#1a1000", borderRadius: 8, fontSize: 11, ...mono }}>
          Total frais : <span style={{ color: "#f59e0b", fontWeight: 700 }}>{fmt(calc.fraisTotal)} DZD</span>
          {f.achatUSD && <> · Coût total : <span style={{ color: "#f59e0b", fontWeight: 700 }}>{fmt(calc.coutTotalDisplay)} DZD</span></>}
        </div>
      </Section>

      <Section title="Prix de vente">
        <div style={g2}>
          <F label="Prix vente prévu (DZD)">{inp("ventePrevueDZD", "number")}</F>
          <F label="Prix vente réel (DZD)">{inp("venteReelleDZD", "number")}</F>
        </div>
        {calc.margeReelle !== "" && (
          <div style={{ fontSize: 11, ...mono, color: calc.margeReelle >= 0 ? "#4ade80" : "#f87171", background: calc.margeReelle >= 0 ? "#0a2010" : "#1a0000", borderRadius: 8, padding: "6px 10px" }}>
            Marge nette (après commission {fmt(f.commercial_commission)} DZD) : {fmt(calc.margeReelle)} DZD · {fmtPct(calc.margePct)}
          </div>
        )}
      </Section>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
        <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
        <Btn variant="primary" type="submit">{saving ? "Enregistrement…" : "Enregistrer"}</Btn>
      </div>
    </form>
  );
}

// ─── Formulaire mouvement ───────────────────────────────────────
function MouvementForm({ onSave, onClose, vehiculeIds, initial }) {
  const [f, setF] = useState(initial || { date: today(), type: "Sortie", categorie: "Achat véhicule", idVehicule: "", description: "", devise: "DZD", montant: "", taux: "" });
  const [saving, setSaving] = useState(false);
  const u = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); await onSave(f); setSaving(false); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={g2}>
        <F label="Date *"><input required type="date" value={f.date} onChange={e => u("date", e.target.value)} /></F>
        <F label="Type"><select value={f.type} onChange={e => u("type", e.target.value)}><option>Entrée</option><option>Sortie</option></select></F>
        <F label="Catégorie" full><select value={f.categorie} onChange={e => u("categorie", e.target.value)}>{CATEGORIES_FLUX.map(c => <option key={c}>{c}</option>)}</select></F>
        <F label="Véhicule lié" full><select value={f.idVehicule} onChange={e => u("idVehicule", e.target.value)}><option value="">—</option>{vehiculeIds.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></F>
        <F label="Description" full><input value={f.description} onChange={e => u("description", e.target.value)} placeholder="Optionnel" /></F>
        <F label="Devise"><select value={f.devise} onChange={e => u("devise", e.target.value)}>{DEVISES.map(d => <option key={d}>{d}</option>)}</select></F>
        <F label="Montant *"><input required type="number" value={f.montant} onChange={e => u("montant", e.target.value)} placeholder="Toujours positif" /></F>
        {f.devise !== "DZD" && <F label="Taux (optionnel)" full><input type="number" value={f.taux} onChange={e => u("taux", e.target.value)} placeholder="Taux par défaut si vide" /></F>}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
        <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
        <Btn variant="primary" type="submit">{saving ? "Enregistrement…" : "Enregistrer"}</Btn>
      </div>
    </form>
  );
}

function ParamsForm({ params, onSave, onClose }) {
  const [f, setF] = useState(params);
  const [saving, setSaving] = useState(false);
  const fields = [
    { k: "soldeDepart", l: "Solde de départ (DZD)" },
    { k: "tauxUSD", l: "Taux USD → DZD" },
    { k: "tauxEUR", l: "Taux EUR → DZD" },
    { k: "reserve", l: "Réserve minimale (DZD)" },
    { k: "commercial_nom", l: "Nom du commercial", text: true },
    { k: "commercial_commission_pct", l: "Commission commercial (% par défaut)" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {fields.map(({ k, l, text }) => (
        <div key={k}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{l}</label>
          <input type={text ? "text" : "number"} value={f[k] ?? ""} onChange={e => setF(p => ({ ...p, [k]: text ? e.target.value : Number(e.target.value) }))} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
        <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
        <Btn variant="primary" onClick={async () => { setSaving(true); await onSave(f); setSaving(false); }}>{saving ? "Sauvegarde…" : "Sauvegarder"}</Btn>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [params, setParams] = useState({ soldeDepart: 0, tauxUSD: 280, tauxEUR: 305, reserve: 500000, commercial_nom: "Yacine", commercial_commission_pct: 2 });
  const [vehicules, setVehicules] = useState([]);
  const [tresorerie, setTresorerie] = useState([]);
  const [previsions, setPrevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [filtreAssocie, setFiltreAssocie] = useState("Tous");

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [p, v, t, pr] = await Promise.all([
        supabase.from("params").select("*").single(),
        supabase.from("vehicules").select("*").order("created_at"),
        supabase.from("tresorerie").select("*").order("date").order("created_at"),
        supabase.from("previsions").select("*").order("date").order("created_at"),
      ]);
      if (p.data) setParams({ soldeDepart: p.data.solde_depart, tauxUSD: p.data.taux_usd, tauxEUR: p.data.taux_eur, reserve: p.data.reserve, commercial_nom: p.data.commercial_nom || "Yacine", commercial_commission_pct: p.data.commercial_commission_pct || 2 });
      if (v.data) setVehicules(v.data.map(dbToVeh));
      if (t.data) setTresorerie(t.data.map(dbToFlux));
      if (pr.data) setPrevisions(pr.data.map(dbToFlux));
      setLoading(false);
    }
    load();
  }, []);

  const vehC = useMemo(() => vehicules.map(v => ({ ...v, ...calcVehicule(v, params) })), [vehicules, params]);
  const vehFiltered = useMemo(() => filtreAssocie === "Tous" ? vehC : vehC.filter(v => v.acheteur === filtreAssocie), [vehC, filtreAssocie]);

  const soldeReel = useMemo(() => params.soldeDepart + tresorerie.reduce((a, m) => a + montantDZD(m, params), 0), [tresorerie, params]);
  const tresoS = useMemo(() => { let c = params.soldeDepart; return tresorerie.map(m => { const d = montantDZD(m, params); c += d; return { ...m, dz: d, sc: c }; }); }, [tresorerie, params]);
  const prevS = useMemo(() => { let c = soldeReel; return previsions.map(m => { const d = montantDZD(m, params); c += d; return { ...m, dz: d, sc: c }; }); }, [previsions, params, soldeReel]);
  const pointBas = useMemo(() => prevS.length ? Math.min(...prevS.map(p => p.sc)) : soldeReel, [prevS, soldeReel]);
  const soldePrevFin = useMemo(() => prevS.length ? prevS.at(-1).sc : soldeReel, [prevS, soldeReel]);
  const cashEngage = useMemo(() => vehC.reduce((a, v) => a + (v.cashEngage || 0), 0), [vehC]);
  const margeReal = useMemo(() => vehC.filter(v => v.margeReelle !== "").reduce((a, v) => a + v.margeReelle, 0), [vehC]);
  const commissions = useMemo(() => vehC.reduce((a, v) => a + (Number(v.commercial_commission) || 0), 0), [vehC]);
  const enCours = useMemo(() => vehC.filter(v => v.statut && v.statut !== "Vendu" && v.statut !== "Annulé").length, [vehC]);
  const vendus = useMemo(() => vehC.filter(v => v.statut === "Vendu").length, [vehC]);
  const alerte = pointBas < params.reserve;
  const vehiculeIds = vehicules.map(v => ({ id: v.id, label: `#${v.id} ${v.modele} (${v.acheteur})` }));

  // prochaines échéances (frais avec date)
  const echeances = useMemo(() => {
    const list = [];
    vehC.forEach(v => {
      FRAIS_FIXES.forEach(ff => {
        if (ff.dateKey && v[ff.dateKey] && Number(v[ff.key])) {
          list.push({ date: v[ff.dateKey], label: ff.label, montant: Number(v[ff.key]), vehicule: v.modele, id: v.id });
        }
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  }, [vehC]);

  // ── CRUD ──────────────────────────────────────────────────────
  const saveParams = async (p) => { await supabase.from("params").upsert({ id: 1, solde_depart: p.soldeDepart, taux_usd: p.tauxUSD, taux_eur: p.tauxEUR, reserve: p.reserve, commercial_nom: p.commercial_nom, commercial_commission_pct: p.commercial_commission_pct }); setParams(p); setModal(null); showToast("Paramètres sauvegardés"); };
  const addVeh = async (f) => { const { data, error } = await supabase.from("vehicules").insert(vehToDB(f)).select().single(); if (error) { showToast("Erreur : " + error.message, "danger"); return; } setVehicules(p => [...p, dbToVeh(data)]); setModal(null); showToast("Véhicule ajouté"); };
  const updVeh = async (f) => { const { error } = await supabase.from("vehicules").update(vehToDB(f)).eq("id", f.id); if (error) { showToast("Erreur : " + error.message, "danger"); return; } setVehicules(p => p.map(v => v.id === f.id ? { ...f, ...calcVehicule(f, params) } : v)); setModal(null); showToast("Véhicule mis à jour"); };
  const delVeh = async (id) => { await supabase.from("vehicules").delete().eq("id", id); setVehicules(p => p.filter(v => v.id !== id)); showToast("Supprimé", "danger"); };

  const addFlux = (table, setter) => async (f) => { const { data, error } = await supabase.from(table).insert(fluxToDB(f)).select().single(); if (error) { showToast("Erreur : " + error.message, "danger"); return; } setter(p => [...p, dbToFlux(data)].sort((a, b) => a.date.localeCompare(b.date))); setModal(null); showToast("Enregistré"); };
  const delFlux = (table, setter) => async (id) => { await supabase.from(table).delete().eq("id", id); setter(p => p.filter(m => m.id !== id)); showToast("Supprimé", "danger"); };

  const dupliquerPrevi = async (m) => {
    const { id, dz, sc, ...rest } = m;
    const { data, error } = await supabase.from("previsions").insert(fluxToDB(rest)).select().single();
    if (error) { showToast("Erreur : " + error.message, "danger"); return; }
    setPrevisions(p => [...p, dbToFlux(data)].sort((a, b) => a.date.localeCompare(b.date)));
    showToast("Ligne dupliquée");
  };

  const addT = addFlux("tresorerie", setTresorerie);
  const delT = delFlux("tresorerie", setTresorerie);
  const addP = addFlux("previsions", setPrevisions);
  const delP = delFlux("previsions", setPrevisions);

  const kG = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 };
  const sL = { fontSize: 10, fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, marginTop: 20 };
  const typeTag = (type) => <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600, background: type === "Entrée" ? "#0a2010" : "#1a0a0a", color: type === "Entrée" ? "#4ade80" : "#f87171" }}>{type}</span>;

  const TABS = [
    { id: "dashboard", label: "Dashboard" },
    { id: "vehicules", label: `Véhicules${vehicules.length ? ` (${vehicules.length})` : ""}` },
    { id: "tresorerie", label: `Trésorerie${tresorerie.length ? ` (${tresorerie.length})` : ""}` },
    { id: "previsions", label: `Prévisions${previsions.length ? ` (${previsions.length})` : ""}` },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#020617" }}>
      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 200, background: toast.type === "danger" ? "#7f1d1d" : "#0a2010", border: `1px solid ${toast.type === "danger" ? "#f87171" : "#4ade80"}`, color: toast.type === "danger" ? "#f87171" : "#4ade80", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, boxShadow: "0 4px 20px rgba(0,0,0,.5)" }}>{toast.msg}</div>}

      <div style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>Import Véhicules</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Trésorerie & Rentabilité · Smaine & Yacine</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["Tous", "Smaine", "Yacine"].map(a => (
            <button key={a} onClick={() => setFiltreAssocie(a)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 99, fontWeight: 600, cursor: "pointer", border: "none", background: filtreAssocie === a ? (a === "Yacine" ? "#4a1d96" : a === "Smaine" ? "#1e3a5f" : "#334155") : "#1e293b", color: filtreAssocie === a ? "#fff" : "#64748b" }}>{a}</button>
          ))}
          <Btn variant="ghost" small onClick={() => setModal("params")}>⚙ Paramètres</Btn>
        </div>
      </div>

      <div style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "0 20px", display: "flex", gap: 2, overflowX: "auto" }}>
        {TABS.map(t => <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 500, color: tab === t.id ? "#f59e0b" : "#64748b", borderBottom: tab === t.id ? "2px solid #f59e0b" : "2px solid transparent", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>)}
      </div>

      <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
        {loading ? <div style={{ textAlign: "center", padding: "60px 0", color: "#334155", fontSize: 13 }}>Chargement…</div> : <>

          {/* DASHBOARD */}
          {tab === "dashboard" && <div>
            {alerte && <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: "10px 14px", color: "#fca5a5", fontSize: 12, marginBottom: 16 }}>⚠ <strong>ALERTE</strong> — Point bas ({fmtDZD(pointBas)}) sous la réserve ({fmtDZD(params.reserve)})</div>}
            <div style={sL}>Trésorerie</div>
            <div style={kG}>
              <KPI label="Solde de départ" value={fmtDZD(params.soldeDepart)} color="muted" />
              <KPI label="Solde réel actuel" value={fmtDZD(soldeReel)} color={soldeReel >= 0 ? "amber" : "red"} />
              <KPI label="Solde prévisionnel fin" value={fmtDZD(soldePrevFin)} color={soldePrevFin >= 0 ? "amber" : "red"} />
              <KPI label="Point bas prévu" value={fmtDZD(pointBas)} color={alerte ? "red" : "amber"} alert={alerte} sub={`Réserve : ${fmtDZD(params.reserve)}`} />
            </div>
            <div style={sL}>Activité véhicules</div>
            <div style={kG}>
              <KPI label="En cours" value={enCours} color="blue" />
              <KPI label="Vendus" value={vendus} color="green" />
              <KPI label="Cash engagé (stock)" value={fmtDZD(cashEngage)} color="amber" />
              <KPI label="Marge nette réalisée" value={fmtDZD(margeReal)} color={margeReal >= 0 ? "green" : "red"} />
              <KPI label={`Commissions ${params.commercial_nom}`} value={fmtDZD(commissions)} color="purple" />
            </div>
            {echeances.length > 0 && <>
              <div style={sL}>Prochaines échéances de frais</div>
              <div style={{ display: "grid", gap: 8 }}>
                {echeances.map((e, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 14px" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ ...mono, fontSize: 11, color: "#64748b" }}>{e.date}</span>
                      <span style={{ fontSize: 12, color: "#cbd5e1" }}>{e.label}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>· {e.vehicule}</span>
                    </div>
                    <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: "#f87171" }}>{fmtDZD(e.montant)}</span>
                  </div>
                ))}
              </div>
            </>}
          </div>}

          {/* VÉHICULES */}
          {tab === "vehicules" && <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>{vehFiltered.length} / {vehC.length} véhicule{vehC.length > 1 ? "s" : ""}{filtreAssocie !== "Tous" ? ` (${filtreAssocie})` : ""}</div>
              <Btn onClick={() => setModal("veh")}>+ Ajouter un véhicule</Btn>
            </div>
            {vehFiltered.length === 0 ? <div style={{ textAlign: "center", padding: "40px 20px", color: "#334155", fontSize: 13 }}>Aucun véhicule.</div> :
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>{["#","Modèle","Acheteur","Commercial","Statut","Coût total","Prix prévu","Prix réel","Marge nette","Marge %","Commission","Cash engagé",""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{vehFiltered.map(v => <tr key={v.id}>
                    <td style={{ ...td, ...mono, color: "#475569", fontSize: 11 }}>{v.id}</td>
                    <td style={{ ...td, color: "#f1f5f9", fontWeight: 500 }}>{v.modele}{v.chassis && <div style={{ fontSize: 10, color: "#475569", ...mono, marginTop: 1 }}>{v.chassis}</div>}</td>
                    <td style={td}><AssociBadge nom={v.acheteur} /></td>
                    <td style={{ ...td, fontSize: 11, color: "#94a3b8" }}>{v.commercial_nom}</td>
                    <td style={td}><Badge statut={v.statut} /></td>
                    <td style={{ ...td, ...mono, fontSize: 11 }}>{fmtDZD(v.coutTotalDisplay)}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#94a3b8" }}>{fmtDZD(v.ventePrevueDZD || "")}</td>
                    <td style={{ ...td, ...mono, fontSize: 11 }}>{fmtDZD(v.venteReelleDZD || "")}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, fontWeight: 600, color: v.margeReelle === "" ? "#475569" : v.margeReelle >= 0 ? "#4ade80" : "#f87171" }}>{fmtDZD(v.margeReelle)}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, color: v.margePct === "" ? "#475569" : v.margePct >= 0 ? "#4ade80" : "#f87171" }}>{fmtPct(v.margePct)}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#c084fc" }}>{v.commercial_commission ? fmtDZD(v.commercial_commission) : "—"}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#f59e0b" }}>{v.cashEngage ? fmtDZD(v.cashEngage) : "—"}</td>
                    <td style={td}><div style={{ display: "flex", gap: 4 }}><Btn variant="ghost" small onClick={() => setModal({ edit: v })}>✏</Btn><Btn variant="danger" small onClick={() => delVeh(v.id)}>✕</Btn></div></td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </div>}

          {/* TRÉSORERIE RÉELLE */}
          {tab === "tresorerie" && <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Solde actuel : <span style={{ ...mono, fontWeight: 700, color: soldeReel >= 0 ? "#f59e0b" : "#f87171" }}>{fmtDZD(soldeReel)}</span></div>
              <Btn onClick={() => setModal("treso")}>+ Ajouter un mouvement</Btn>
            </div>
            {tresoS.length === 0 ? <div style={{ textAlign: "center", padding: "40px 20px", color: "#334155", fontSize: 13 }}>Aucun mouvement.</div> :
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>{["Date","Type","Catégorie","Véhicule","Description","Montant DZD","Solde cumulé",""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{tresoS.map(m => <tr key={m.id}>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#64748b" }}>{m.date}</td>
                    <td style={td}>{typeTag(m.type)}</td>
                    <td style={{ ...td, color: "#94a3b8", fontSize: 11 }}>{m.categorie}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#475569" }}>{m.idVehicule ? `#${m.idVehicule}` : "—"}</td>
                    <td style={{ ...td, fontSize: 11 }}>{m.description || "—"}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, fontWeight: 600, color: m.dz >= 0 ? "#4ade80" : "#f87171" }}>{m.dz >= 0 ? "+" : ""}{fmt(m.dz)}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, fontWeight: 700, color: m.sc >= params.reserve ? "#f59e0b" : "#f87171" }}>{fmt(m.sc)}</td>
                    <td style={td}><Btn variant="danger" small onClick={() => delT(m.id)}>✕</Btn></td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </div>}

          {/* PRÉVISIONS */}
          {tab === "previsions" && <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Fin : <span style={{ ...mono, fontWeight: 700, color: soldePrevFin >= 0 ? "#f59e0b" : "#f87171" }}>{fmtDZD(soldePrevFin)}</span>
                {"  ·  "}Point bas : <span style={{ ...mono, fontWeight: 700, color: alerte ? "#f87171" : "#f59e0b" }}>{fmtDZD(pointBas)}</span>
              </div>
              <Btn onClick={() => setModal("previs")}>+ Ajouter une prévision</Btn>
            </div>
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 12px", color: "#64748b", fontSize: 11, marginBottom: 12 }}>
              💡 Quand un mouvement prévu se réalise, saisissez-le dans Trésorerie réelle puis supprimez-le ici. Utilisez ⧉ pour dupliquer une ligne.
            </div>
            {prevS.length === 0 ? <div style={{ textAlign: "center", padding: "40px 20px", color: "#334155", fontSize: 13 }}>Aucune prévision.</div> :
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>{["Date","Type","Catégorie","Véhicule","Description","Montant DZD","Tréso prévisionnelle",""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{prevS.map(m => <tr key={m.id} style={{ background: m.sc < params.reserve ? "#1a0a0a" : "transparent" }}>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#64748b" }}>{m.date}</td>
                    <td style={td}>{typeTag(m.type)}</td>
                    <td style={{ ...td, color: "#94a3b8", fontSize: 11 }}>{m.categorie}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, color: "#475569" }}>{m.idVehicule ? `#${m.idVehicule}` : "—"}</td>
                    <td style={{ ...td, fontSize: 11 }}>{m.description || "—"}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, fontWeight: 600, color: m.dz >= 0 ? "#4ade80" : "#f87171" }}>{m.dz >= 0 ? "+" : ""}{fmt(m.dz)}</td>
                    <td style={{ ...td, ...mono, fontSize: 11, fontWeight: 700, color: m.sc >= params.reserve ? "#f59e0b" : "#f87171" }}>{fmt(m.sc)}{m.sc < params.reserve ? " ⚠" : ""}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <Btn variant="info" small onClick={() => dupliquerPrevi(m)} title="Dupliquer">⧉</Btn>
                        <Btn variant="ghost" small onClick={() => setModal({ editPrevi: m })}>✏</Btn>
                        <Btn variant="danger" small onClick={() => delP(m.id)}>✕</Btn>
                      </div>
                    </td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </div>}
        </>}
      </div>

      {/* MODALS */}
      {modal === "params" && <Modal title="⚙ Paramètres" onClose={() => setModal(null)}><ParamsForm params={params} onSave={saveParams} onClose={() => setModal(null)} /></Modal>}
      {modal === "veh" && <Modal title="Nouveau véhicule" onClose={() => setModal(null)} wide><VehiculeForm onSave={addVeh} onClose={() => setModal(null)} params={params} /></Modal>}
      {modal?.edit && <Modal title="Modifier le véhicule" onClose={() => setModal(null)} wide><VehiculeForm initial={modal.edit} onSave={updVeh} onClose={() => setModal(null)} params={params} /></Modal>}
      {modal === "treso" && <Modal title="Nouveau mouvement réel" onClose={() => setModal(null)}><MouvementForm onSave={addT} onClose={() => setModal(null)} vehiculeIds={vehiculeIds} /></Modal>}
      {modal === "previs" && <Modal title="Nouvelle prévision" onClose={() => setModal(null)}><MouvementForm onSave={addP} onClose={() => setModal(null)} vehiculeIds={vehiculeIds} /></Modal>}
      {modal?.editPrevi && <Modal title="Modifier la prévision" onClose={() => setModal(null)}><MouvementForm initial={modal.editPrevi} onSave={async (f) => { const { error } = await supabase.from("previsions").update(fluxToDB(f)).eq("id", modal.editPrevi.id); if (!error) { setPrevisions(p => p.map(m => m.id === modal.editPrevi.id ? { ...m, ...f } : m).sort((a, b) => a.date.localeCompare(b.date))); setModal(null); showToast("Prévision mise à jour"); } }} onClose={() => setModal(null)} vehiculeIds={vehiculeIds} /></Modal>}
    </div>
  );
}
