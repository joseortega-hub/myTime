/**
 * Comunidades autónomas de España (códigos ISO 3166-2) y sus provincias,
 * para traducir "España, Alicante" al código regional de la fuente de festivos.
 */
export interface Region {
  code: string;
  name: string;
  provinces: string[];
}

export const SPAIN_REGIONS: Region[] = [
  { code: "ES-AN", name: "Andalucía", provinces: ["Almería", "Cádiz", "Córdoba", "Granada", "Huelva", "Jaén", "Málaga", "Sevilla"] },
  { code: "ES-AR", name: "Aragón", provinces: ["Huesca", "Teruel", "Zaragoza"] },
  { code: "ES-AS", name: "Principado de Asturias", provinces: ["Asturias"] },
  { code: "ES-IB", name: "Illes Balears", provinces: ["Illes Balears", "Baleares"] },
  { code: "ES-CN", name: "Canarias", provinces: ["Las Palmas", "Santa Cruz de Tenerife"] },
  { code: "ES-CB", name: "Cantabria", provinces: ["Cantabria"] },
  { code: "ES-CL", name: "Castilla y León", provinces: ["Ávila", "Burgos", "León", "Palencia", "Salamanca", "Segovia", "Soria", "Valladolid", "Zamora"] },
  { code: "ES-CM", name: "Castilla-La Mancha", provinces: ["Albacete", "Ciudad Real", "Cuenca", "Guadalajara", "Toledo"] },
  { code: "ES-CT", name: "Cataluña", provinces: ["Barcelona", "Girona", "Lleida", "Tarragona"] },
  { code: "ES-VC", name: "Comunitat Valenciana", provinces: ["Alicante", "Alacant", "Castellón", "Castelló", "Valencia", "València"] },
  { code: "ES-EX", name: "Extremadura", provinces: ["Badajoz", "Cáceres"] },
  { code: "ES-GA", name: "Galicia", provinces: ["A Coruña", "Lugo", "Ourense", "Pontevedra"] },
  { code: "ES-MD", name: "Comunidad de Madrid", provinces: ["Madrid"] },
  { code: "ES-MC", name: "Región de Murcia", provinces: ["Murcia"] },
  { code: "ES-NC", name: "Comunidad Foral de Navarra", provinces: ["Navarra"] },
  { code: "ES-PV", name: "País Vasco", provinces: ["Álava", "Araba", "Bizkaia", "Vizcaya", "Gipuzkoa", "Guipúzcoa"] },
  { code: "ES-RI", name: "La Rioja", provinces: ["La Rioja"] },
  { code: "ES-CE", name: "Ceuta", provinces: ["Ceuta"] },
  { code: "ES-ML", name: "Melilla", provinces: ["Melilla"] },
];

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Acepta el nombre de la comunidad, su código o el de una provincia. */
export function resolveSpanishRegion(input: string | null | undefined): Region | null {
  if (!input) return null;
  const q = norm(input);
  return (
    SPAIN_REGIONS.find(
      (r) => norm(r.code) === q || norm(r.name) === q || r.provinces.some((p) => norm(p) === q),
    ) ?? null
  );
}
