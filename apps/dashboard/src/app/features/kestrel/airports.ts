// Liste d'aéroports (code IATA + ville) pour l'autocomplétion du formulaire de vol.
// Curée : hubs mondiaux + focus Canada / France / Europe. Suffisant pour la majorité
// des recherches ; on peut toujours taper un code IATA libre s'il manque.
export interface Airport { code: string; city: string; }

export const AIRPORTS: Airport[] = [
  // ── Canada ──
  { code: 'YUL', city: 'Montréal' }, { code: 'YYZ', city: 'Toronto' }, { code: 'YVR', city: 'Vancouver' },
  { code: 'YYC', city: 'Calgary' }, { code: 'YOW', city: 'Ottawa' }, { code: 'YEG', city: 'Edmonton' },
  { code: 'YWG', city: 'Winnipeg' }, { code: 'YHZ', city: 'Halifax' }, { code: 'YQB', city: 'Québec' },
  { code: 'YXE', city: 'Saskatoon' }, { code: 'YYJ', city: 'Victoria' }, { code: 'YTZ', city: 'Toronto (Billy Bishop)' },
  { code: 'YQR', city: 'Regina' }, { code: 'YXU', city: 'London (ON)' }, { code: 'YHM', city: 'Hamilton' },
  // ── France ──
  { code: 'CDG', city: 'Paris (Charles de Gaulle)' }, { code: 'ORY', city: 'Paris (Orly)' },
  { code: 'NCE', city: 'Nice' }, { code: 'LYS', city: 'Lyon' }, { code: 'MRS', city: 'Marseille' },
  { code: 'TLS', city: 'Toulouse' }, { code: 'BOD', city: 'Bordeaux' }, { code: 'NTE', city: 'Nantes' },
  { code: 'LIL', city: 'Lille' }, { code: 'MPL', city: 'Montpellier' }, { code: 'SXB', city: 'Strasbourg' },
  { code: 'BSL', city: 'Bâle-Mulhouse' }, { code: 'BIQ', city: 'Biarritz' }, { code: 'AJA', city: 'Ajaccio' },
  // ── Europe ──
  { code: 'LHR', city: 'Londres (Heathrow)' }, { code: 'LGW', city: 'Londres (Gatwick)' },
  { code: 'STN', city: 'Londres (Stansted)' }, { code: 'LTN', city: 'Londres (Luton)' },
  { code: 'AMS', city: 'Amsterdam' }, { code: 'FRA', city: 'Francfort' }, { code: 'MUC', city: 'Munich' },
  { code: 'BER', city: 'Berlin' }, { code: 'DUS', city: 'Düsseldorf' }, { code: 'HAM', city: 'Hambourg' },
  { code: 'MAD', city: 'Madrid' }, { code: 'BCN', city: 'Barcelone' }, { code: 'AGP', city: 'Málaga' },
  { code: 'FCO', city: 'Rome (Fiumicino)' }, { code: 'MXP', city: 'Milan (Malpensa)' }, { code: 'VCE', city: 'Venise' },
  { code: 'NAP', city: 'Naples' }, { code: 'LIS', city: 'Lisbonne' }, { code: 'OPO', city: 'Porto' },
  { code: 'BRU', city: 'Bruxelles' }, { code: 'ZRH', city: 'Zurich' }, { code: 'GVA', city: 'Genève' },
  { code: 'VIE', city: 'Vienne' }, { code: 'CPH', city: 'Copenhague' }, { code: 'ARN', city: 'Stockholm' },
  { code: 'OSL', city: 'Oslo' }, { code: 'HEL', city: 'Helsinki' }, { code: 'DUB', city: 'Dublin' },
  { code: 'ATH', city: 'Athènes' }, { code: 'WAW', city: 'Varsovie' }, { code: 'PRG', city: 'Prague' },
  { code: 'BUD', city: 'Budapest' }, { code: 'IST', city: 'Istanbul' }, { code: 'KEF', city: 'Reykjavik' },
  { code: 'EDI', city: 'Édimbourg' }, { code: 'MAN', city: 'Manchester' },
  // ── États-Unis ──
  { code: 'JFK', city: 'New York (JFK)' }, { code: 'EWR', city: 'Newark' }, { code: 'LGA', city: 'New York (LaGuardia)' },
  { code: 'BOS', city: 'Boston' }, { code: 'IAD', city: 'Washington (Dulles)' }, { code: 'DCA', city: 'Washington (Reagan)' },
  { code: 'ATL', city: 'Atlanta' }, { code: 'ORD', city: 'Chicago (O\'Hare)' }, { code: 'MDW', city: 'Chicago (Midway)' },
  { code: 'LAX', city: 'Los Angeles' }, { code: 'SFO', city: 'San Francisco' }, { code: 'SEA', city: 'Seattle' },
  { code: 'MIA', city: 'Miami' }, { code: 'FLL', city: 'Fort Lauderdale' }, { code: 'MCO', city: 'Orlando' },
  { code: 'DFW', city: 'Dallas' }, { code: 'IAH', city: 'Houston' }, { code: 'DEN', city: 'Denver' },
  { code: 'LAS', city: 'Las Vegas' }, { code: 'PHX', city: 'Phoenix' }, { code: 'PHL', city: 'Philadelphie' },
  { code: 'DTW', city: 'Détroit' }, { code: 'MSP', city: 'Minneapolis' }, { code: 'SAN', city: 'San Diego' },
  { code: 'TPA', city: 'Tampa' }, { code: 'HNL', city: 'Honolulu' }, { code: 'AUS', city: 'Austin' },
  // ── Mexique / Caraïbes / Amérique latine ──
  { code: 'MEX', city: 'Mexico' }, { code: 'CUN', city: 'Cancún' }, { code: 'PUJ', city: 'Punta Cana' },
  { code: 'SJU', city: 'San Juan' }, { code: 'NAS', city: 'Nassau' }, { code: 'HAV', city: 'La Havane' },
  { code: 'GRU', city: 'São Paulo' }, { code: 'GIG', city: 'Rio de Janeiro' }, { code: 'EZE', city: 'Buenos Aires' },
  { code: 'BOG', city: 'Bogotá' }, { code: 'LIM', city: 'Lima' }, { code: 'SCL', city: 'Santiago' },
  // ── Moyen-Orient / Afrique ──
  { code: 'DXB', city: 'Dubaï' }, { code: 'AUH', city: 'Abu Dhabi' }, { code: 'DOH', city: 'Doha' },
  { code: 'TLV', city: 'Tel-Aviv' }, { code: 'CAI', city: 'Le Caire' }, { code: 'CMN', city: 'Casablanca' },
  { code: 'RAK', city: 'Marrakech' }, { code: 'TUN', city: 'Tunis' }, { code: 'ALG', city: 'Alger' },
  { code: 'JNB', city: 'Johannesburg' }, { code: 'CPT', city: 'Le Cap' }, { code: 'NBO', city: 'Nairobi' },
  { code: 'DKR', city: 'Dakar' },
  // ── Asie / Océanie ──
  { code: 'DEL', city: 'New Delhi' }, { code: 'BOM', city: 'Mumbai' }, { code: 'BKK', city: 'Bangkok' },
  { code: 'SIN', city: 'Singapour' }, { code: 'HKG', city: 'Hong Kong' }, { code: 'NRT', city: 'Tokyo (Narita)' },
  { code: 'HND', city: 'Tokyo (Haneda)' }, { code: 'ICN', city: 'Séoul' }, { code: 'PVG', city: 'Shanghai' },
  { code: 'PEK', city: 'Pékin' }, { code: 'KUL', city: 'Kuala Lumpur' }, { code: 'DPS', city: 'Bali (Denpasar)' },
  { code: 'SYD', city: 'Sydney' }, { code: 'MEL', city: 'Melbourne' }, { code: 'AKL', city: 'Auckland' },
];
