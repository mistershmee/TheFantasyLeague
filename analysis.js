/**
 * Da Crew Fantasy Football — Analysis Layer
 * ==========================================
 * All calculations, parameters, and business logic live here.
 * Drop in a new fantasy_data.json and everything recalculates.
 *
 * Parameters to tune:
 *   REPL_RANK         — replacement player rank per position (12-team league)
 *   LINEUP            — starting lineup configuration
 *   PI_WEIGHTS        — Power Index formula weights
 *   PI_CAREER_BONUS   — title/playoff bonus values for Career PI
 *   CORE_MANAGERS     — which managers to include in core analysis
 */

// ─── PARAMETERS ────────────────────────────────────────────────────────────

const LINEUP = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1,
  // Flex is WR/RB/TE — we don't apply a separate replacement for flex,
  // it's absorbed into the WR/RB/TE replacement ranks below.
};

const REPL_RANK = {
  // With 12 teams: QB×1=12, RB×(2+~1flex)=36, WR×(2+~1flex)=36, TE×1~=14, DEF×1=12, K×1=12
  QB: 12, RB: 36, WR: 36, TE: 14, DEF: 12, K: 12,
};

const PI_WEIGHTS = { scoring: 0.85, consistency: 0.15 };
const PI_CAREER_BONUS = { title: 2, playoff: 1 };

const CORE_MANAGERS = [
  'Chris T','Ryan','Nels','Mike','Jack','Josh','Bryson','matt','T Rex','Chris','Wes'
];

const MGR_COLORS = {
  'Chris T': '#6C63FF', 'Ryan': '#FF6B6B', 'Nels': '#4ECDC4',
  'Mike': '#45B7D1',    'Jack': '#FFA07A', 'Josh': '#98D8C8',
  'Bryson': '#F7DC6F',  'matt': '#BB8FCE', 'T Rex': '#85C1E9',
  'Chris': '#F0B27A',   'Wes': '#A9DFBF',
};

// ─── TEAM → MANAGER MAPPING ────────────────────────────────────────────────
// Loaded from managers.json at runtime. Do NOT edit here — edit managers.json.
// Falls back to inline map if managers.json hasn't loaded yet.

let TEAM_TO_MANAGER = {};  // populated by loadManagers()

async function loadManagers() {
  try {
    const res = await fetch('managers.json');
    if (!res.ok) throw new Error('managers.json not found');
    const data = await res.json();
    // Build flat team→manager lookup from the structured JSON
    for (const mgr of data.managers) {
      for (const entry of mgr.teams) {
        // Skip unresolved unknowns that share the 'Unknown' manager bucket
        const mgrName = mgr.name === 'Unknown' ? null : mgr.name;
        if (mgrName) TEAM_TO_MANAGER[entry.name] = mgrName;
      }
    }
    console.log(`managers.json loaded — ${Object.keys(TEAM_TO_MANAGER).length} team mappings`);
  } catch (err) {
    console.warn('Could not load managers.json, using inline fallback:', err.message);
    // Inline fallback — mirrors managers.json exactly
    TEAM_TO_MANAGER = {
      'Dad Bod Squad':'Chris T',"Dad Bod's Squad":'Chris T','Taste Dwayne Bowe':'Chris T',
      'McCluster Fucks':'Chris T','Chiefs':'Chris T','Country Roads Take Mahomes':'Chris T',
      'Balls deep':'Ryan','CTown OGs':'Ryan',
      "Nelson's Man-Dillas":'Nels',"Seattle Scgreat's":'Nels','Bi - Flynning':'Nels',"Nels's Nancies":'Nels',
      'Mitha Rodgas Neybhud':'Jack',
      'Off Constantly':'Josh',"Jerry's Fairies":'Josh','Lamb and tuna fish':'Josh',"My Dick(er) Reeks":'Josh',
      'Suck My Cotchery':'Josh','My Chubb Hurts':'Josh','Turn ur head and Goff':'Josh',
      'Bills Mafia':'Mike','Paradox':'Mike','Shmeeper Bowl Champs':'Mike','Jerryworld':'Mike',
      'CARRY MY PADS BITCH':'Mike','Tony Romo':'Mike','FAT FUCKING FAGGLES':'Mike',
      'Fuuck Stan Kroenke':'Bryson','KingLaurinaitis55':'Bryson','Im the real Greenie':'Bryson',
      'Bros_B4_Shiancoes':'Bryson','pooooooooop':'Bryson','CowboyButtsAreGay':'Bryson',
      'Simmons is old!':'matt','Petersons of Anarchy':'matt','BrySons of Anarchy':'matt',
      '1st Down Syndrome':'matt','scute without the e':'matt','Discount Dbl Gut Chk':'matt',
      "Jerry's Gloryholes":'matt','Titsburgh Feelers':'matt',
      'Pity I wasnt invited':'T Rex','Golden Tate Showers':'T Rex','CItron My Face':'T Rex',
      'The Dude.':'T Rex','Hernandez Legal Team':'T Rex','Wherefore & Therein':'T Rex',
      'Dez-ed and Confused':'Chris','Bijan Mustard':'Chris','The Dirty Sanchez':'Chris',
      "TD's N' Beer":'Chris','My Vick is Itchy':'Chris',
      'ndamukong suh dude!!':'Wes',"Hangin' w/ Hernandez":'Wes','Romophobic':'Wes',
      'Stable of Stars':'Wes','Romosexuals':'Wes','The Spoiler':'Wes','The Spoiled':'Wes',
      "There's Tua Much Shit On Me":'Wes',
      'Schweddy Ballers':'Joseph',"Konys Child Soldiers":'Joseph',"Joe's Neckbeards":'Joseph',
      '2 Gurleys 1 Cup':'Evan','Sergio Dipp':'Evan',
      'Donkey Punch':'JR',"Suckin' Daddy's D":'Travis','The T.O. Show':'Travis',
      "Egbuka's Brown Burrow":'Garrett',"Çöôpèr's Pòõpēr's ẞçøøpërs":'Garrett',
      "Chase'n Jayden":'Jeremy','Jerry had a lil Lamb':'Jeremy',
      "Jeremy's Dazzling Team":'Jeremy','Not Worthy. My Pickens Hurts':'Jeremy',
      'LAPORTA PARTY':'Gary',
      '17-7 Suck it!':'Jeff','CraigersCrew':'Jeff','A Kolb Day in Hell':'Jeff',
      'SEC SPEEEEEEEED':'Jeff','Long Live Jerrrah':'Jeff',
    };
  }
}

function resolveManager(managerField, teamName) {
  if (managerField && managerField !== '--hidden--') return managerField;
  return TEAM_TO_MANAGER[teamName] || null;
}

// ─── MAIN ANALYSIS FUNCTION ─────────────────────────────────────────────────

function runAnalysis(rawData) {
  const seasons = rawData.seasons;
  const playerData = rawData.player_data || {};
  const years = Object.keys(seasons).filter(y => y !== '2026').sort();

  const GAME_TO_YEAR = {
    '222':'2009','242':'2010','257':'2011','273':'2012','314':'2013','331':'2014',
    '348':'2015','359':'2016','371':'2017','380':'2018','390':'2019','399':'2020',
    '406':'2021','414':'2022','423':'2023','449':'2024','461':'2025'
  };

  // Build player→year→pts lookup
  const playerYearPts = {};
  for (const [key, val] of Object.entries(playerData)) {
    const parts = key.split('.');
    if (parts.length >= 3) {
      const year = GAME_TO_YEAR[parts[0]];
      const name = val.name;
      if (year && name) {
        if (!playerYearPts[name]) playerYearPts[name] = {};
        playerYearPts[name][year] = val.season_points || 0;
      }
    }
  }

  // Build replacement levels per position per year from draft data
  const replLevel = {};
  for (const year of years) {
    const draft = seasons[year].draft || [];
    const posPts = {};
    for (const pick of draft) {
      const pos = pick.position;
      const pts = pick.season_points || 0;
      if (REPL_RANK[pos]) {
        if (!posPts[pos]) posPts[pos] = [];
        posPts[pos].push(pts);
      }
    }
    replLevel[year] = {};
    for (const [pos, rank] of Object.entries(REPL_RANK)) {
      const sorted = (posPts[pos] || []).sort((a, b) => b - a);
      replLevel[year][pos] = sorted[rank - 1] ?? (sorted[sorted.length - 1] ?? 0);
    }
  }

  function getVOR(pts, pos, year) {
    if (!REPL_RANK[pos]) return pts;
    return pts - (replLevel[year]?.[pos] ?? 0);
  }

  // ── CHAMPIONS ──────────────────────────────────────────────────
  const champions = [];
  for (const year of years) {
    const standings = (seasons[year].standings || []).sort((a, b) => a.rank - b.rank);
    const podium = standings.slice(0, 3);
    champions.push({
      year,
      mgr1: resolveManager(podium[0]?.manager, podium[0]?.name) || '?',
      team1: podium[0]?.name || '',
      mgr2: resolveManager(podium[1]?.manager, podium[1]?.name) || '?',
      team2: podium[1]?.name || '',
      mgr3: resolveManager(podium[2]?.manager, podium[2]?.name) || '?',
      team3: podium[2]?.name || '',
    });
  }

  // ── PPW ──────────────────────────────────────────────────────
  const ppw = [];
  for (const year of years) {
    const matchups = (seasons[year].matchups || []).filter(m => !m.is_playoffs && !m.is_consolation);
    if (matchups.length) {
      const total = matchups.reduce((s, m) => s + m.team1_points + m.team2_points, 0);
      ppw.push({ year, avg: +(total / (matchups.length * 2)).toFixed(1) });
    }
  }

  // ── MANAGER STATS ────────────────────────────────────────────
  const mgrData = {};
  for (const mgr of CORE_MANAGERS) {
    mgrData[mgr] = { seasons: new Set(), wins: 0, losses: 0, ptsFor: 0, ppgGames: 0,
      titles: 0, podiums: 0, playoffApps: 0, playoffW: 0, playoffL: 0 };
  }

  for (const year of years) {
    const s = seasons[year];
    const matchups = s.matchups || [];
    const standings = s.standings || [];

    const playoffTeams = new Set();
    for (const m of matchups.filter(m => m.is_playoffs && !m.is_consolation)) {
      const m1 = resolveManager(m.team1_manager, m.team1_name);
      const m2 = resolveManager(m.team2_manager, m.team2_name);
      playoffTeams.add(m1); playoffTeams.add(m2);
      if (m.team1_points > m.team2_points) {
        if (mgrData[m1]) mgrData[m1].playoffW++;
        if (mgrData[m2]) mgrData[m2].playoffL++;
      } else {
        if (mgrData[m2]) mgrData[m2].playoffW++;
        if (mgrData[m1]) mgrData[m1].playoffL++;
      }
    }

    const yearMgrs = new Set();
    for (const team of standings) {
      const mgr = resolveManager(team.manager, team.name);
      if (!mgrData[mgr]) continue;
      yearMgrs.add(mgr);
      mgrData[mgr].seasons.add(year);
      mgrData[mgr].wins += team.wins || 0;
      mgrData[mgr].losses += team.losses || 0;
      mgrData[mgr].ptsFor += team.points_for || 0;
      if (team.rank === 1) mgrData[mgr].titles++;
      if (team.rank <= 3) mgrData[mgr].podiums++;
    }

    for (const mgr of playoffTeams) {
      if (mgrData[mgr] && yearMgrs.has(mgr)) mgrData[mgr].playoffApps++;
    }

    for (const m of matchups.filter(m => !m.is_playoffs && !m.is_consolation)) {
      const m1 = resolveManager(m.team1_manager, m.team1_name);
      const m2 = resolveManager(m.team2_manager, m.team2_name);
      if (mgrData[m1]) mgrData[m1].ppgGames++;
      if (mgrData[m2]) mgrData[m2].ppgGames++;
    }
  }

  const managerStats = {};
  for (const [mgr, s] of Object.entries(mgrData)) {
    const total = s.wins + s.losses;
    const ptot = s.playoffW + s.playoffL;
    managerStats[mgr] = {
      seasons: s.seasons.size,
      wins: s.wins, losses: s.losses,
      winPct: total ? +(s.wins / total * 100).toFixed(1) : 0,
      ppg: s.ppgGames ? +(s.ptsFor / s.ppgGames).toFixed(1) : 0,
      titles: s.titles, podiums: s.podiums,
      playoffApps: s.playoffApps,
      playoffW: s.playoffW, playoffL: s.playoffL,
      playoffWinPct: ptot ? +(s.playoffW / ptot * 100).toFixed(1) : null,
    };
  }

  // ── LUCK INDEX ───────────────────────────────────────────────
  const luckCareer = {};
  for (const mgr of CORE_MANAGERS) luckCareer[mgr] = { actual: 0, expected: 0 };
  const luckSeasons = [];

  for (const year of years) {
    const matchups = (seasons[year].matchups || []).filter(m => !m.is_playoffs && !m.is_consolation);
    const standings = seasons[year].standings || [];
    const weeklyScores = {};
    for (const m of matchups) {
      const m1 = resolveManager(m.team1_manager, m.team1_name);
      const m2 = resolveManager(m.team2_manager, m.team2_name);
      if (!weeklyScores[m.week]) weeklyScores[m.week] = [];
      weeklyScores[m.week].push([m1, m.team1_points], [m2, m.team2_points]);
    }
    const weeklyExp = {};
    for (const [wk, scores] of Object.entries(weeklyScores)) {
      const allPts = scores.map(s => s[1]); const n = allPts.length - 1;
      if (n <= 0) continue;
      for (const [mgr, pts] of scores) {
        weeklyExp[mgr] = (weeklyExp[mgr] || 0) + allPts.filter(p => p < pts).length / n;
      }
    }
    for (const team of standings) {
      const mgr = resolveManager(team.manager, team.name);
      const actual = team.wins || 0;
      const expected = weeklyExp[mgr] || 0;
      const luck = +(actual - expected).toFixed(1);
      if (luckCareer[mgr]) {
        luckCareer[mgr].actual += actual;
        luckCareer[mgr].expected += expected;
      }
      luckSeasons.push({ year, mgr, team: team.name, luck, actual, expected: +expected.toFixed(1) });
    }
  }

  // ── H2H RECORDS ──────────────────────────────────────────────
  const h2h = {};
  for (const year of years) {
    for (const m of seasons[year].matchups || []) {
      const m1 = resolveManager(m.team1_manager, m.team1_name);
      const m2 = resolveManager(m.team2_manager, m.team2_name);
      if (!CORE_MANAGERS.includes(m1) || !CORE_MANAGERS.includes(m2) || m1 === m2) continue;
      const isPO = m.is_playoffs && !m.is_consolation;
      if (!h2h[m1]) h2h[m1] = {};
      if (!h2h[m1][m2]) h2h[m1][m2] = { reg_w: 0, reg_l: 0, po_w: 0, po_l: 0 };
      if (!h2h[m2]) h2h[m2] = {};
      if (!h2h[m2][m1]) h2h[m2][m1] = { reg_w: 0, reg_l: 0, po_w: 0, po_l: 0 };
      if (m.team1_points > m.team2_points) {
        isPO ? (h2h[m1][m2].po_w++, h2h[m2][m1].po_l++) : (h2h[m1][m2].reg_w++, h2h[m2][m1].reg_l++);
      } else if (m.team2_points > m.team1_points) {
        isPO ? (h2h[m2][m1].po_w++, h2h[m1][m2].po_l++) : (h2h[m2][m1].reg_w++, h2h[m1][m2].reg_l++);
      }
    }
  }

  // ── DRAFT VOR ────────────────────────────────────────────────
  const SNAKE_YEARS = new Set(['2009','2010','2011','2012','2013','2015','2017','2021','2023','2025']);
  const AUCTION_YEARS_SET = new Set(['2016','2018','2020','2022','2024']);
  const mgrPosVOR = {};
  for (const mgr of CORE_MANAGERS) mgrPosVOR[mgr] = {};

  const snakeDrafts = [];
  for (const year of [...SNAKE_YEARS].sort()) {
    if (!seasons[year]) continue;
    const draft = seasons[year].draft || [];
    const standings = seasons[year].standings || [];
    const teamMgr = Object.fromEntries(standings.map(t => [t.team_key, [resolveManager(t.manager, t.name), t.name]]));
    const teamVOR = {}, teamPicks = {};
    for (const pick of draft) {
      const tk = pick.team_key; const pos = pick.position;
      const pts = pick.season_points || 0; const rnd = pick.round || 99;
      const vor = getVOR(pts, pos, year);
      if (!teamVOR[tk]) teamVOR[tk] = 0;
      teamVOR[tk] += vor;
      if (!teamPicks[tk]) teamPicks[tk] = [];
      teamPicks[tk].push({ n: pick.player_name, pos, r: `R${rnd}`, pts: Math.round(pts), v: +vor.toFixed(1) });
      const [mgr] = teamMgr[tk] || [];
      if (mgr && mgrPosVOR[mgr]) {
        if (!mgrPosVOR[mgr][pos]) mgrPosVOR[mgr][pos] = [];
        mgrPosVOR[mgr][pos].push(vor);
      }
    }
    const vors = Object.values(teamVOR);
    if (vors.length < 2) continue;
    const avg = vors.reduce((a, b) => a + b, 0) / vors.length;
    const std = Math.sqrt(vors.reduce((a, b) => a + (b - avg) ** 2, 0) / vors.length);
    for (const [tk, total] of Object.entries(teamVOR)) {
      const [mgr, tname] = teamMgr[tk] || [];
      if (!mgr || mgr === 'Unknown') continue;
      const z = std > 0 ? +((total - avg) / std).toFixed(2) : 0;
      const picks = (teamPicks[tk] || []).sort((a, b) => b.v - a.v).slice(0, 5);
      snakeDrafts.push({ year, m: mgr, team: tname, vor: Math.round(total), z, type: 'snake', picks });
    }
  }

  // Auction drafts — loaded from pre-computed data (AuctionValues.xlsx processed server-side)
  // These are embedded as static data since auction salary data isn't in fantasy_data.json
  const auctionDrafts = AUCTION_DRAFT_DATA; // defined below

  // ── POWER INDEX ──────────────────────────────────────────────
  const seasonPI = [];
  for (const year of years) {
    const matchups = (seasons[year].matchups || []).filter(m => !m.is_playoffs && !m.is_consolation);
    if (!matchups.length) continue;
    const teamWeekly = {};
    const teamName = {};
    for (const m of matchups) {
      const m1 = resolveManager(m.team1_manager, m.team1_name);
      const m2 = resolveManager(m.team2_manager, m.team2_name);
      if (!teamWeekly[m1]) { teamWeekly[m1] = []; teamName[m1] = m.team1_name; }
      if (!teamWeekly[m2]) { teamWeekly[m2] = []; teamName[m2] = m.team2_name; }
      teamWeekly[m1].push(m.team1_points);
      teamWeekly[m2].push(m.team2_points);
    }
    const allScores = Object.values(teamWeekly).flat();
    const lgMean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const lgStd = Math.sqrt(allScores.reduce((a, b) => a + (b - lgMean) ** 2, 0) / allScores.length);
    for (const [mgr, scores] of Object.entries(teamWeekly)) {
      if (scores.length < 5) continue;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const std = Math.sqrt(scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length);
      const z = lgStd > 0 ? (avg - lgMean) / lgStd : 0;
      const consistency = lgStd > 0 ? 1 - std / lgStd : 0;
      seasonPI.push({ year, mgr, team: teamName[mgr] || '', avg: +avg.toFixed(1), z: +z.toFixed(3), consistency: +consistency.toFixed(3) });
    }
  }
  const allZ = seasonPI.map(t => t.z), allC = seasonPI.map(t => t.consistency);
  const zMin = Math.min(...allZ), zMax = Math.max(...allZ);
  const cMin = Math.min(...allC), cMax = Math.max(...allC);
  for (const t of seasonPI) {
    const zN = zMax > zMin ? (t.z - zMin) / (zMax - zMin) : 0.5;
    const cN = cMax > cMin ? (t.consistency - cMin) / (cMax - cMin) : 0.5;
    t.pi = +(zN * PI_WEIGHTS.scoring + cN * PI_WEIGHTS.consistency).toFixed(3) * 100;
    t.pi = +t.pi.toFixed(1);
  }

  // Career PI with bonuses
  const careerPI = {};
  for (const mgr of CORE_MANAGERS) {
    const mgr_seasons = seasonPI.filter(t => t.mgr === mgr);
    if (mgr_seasons.length < 3) continue;
    const avgPI = mgr_seasons.reduce((a, b) => a + b.pi, 0) / mgr_seasons.length;
    const stats = managerStats[mgr];
    const titleBonus = (stats?.titles || 0) * PI_CAREER_BONUS.title;
    const playoffBonus = (stats?.playoffApps || 0) * PI_CAREER_BONUS.playoff;
    careerPI[mgr] = {
      seasons: mgr_seasons.length,
      avgPI: +avgPI.toFixed(1),
      titles: stats?.titles || 0,
      titleBonus,
      playoffApps: stats?.playoffApps || 0,
      playoffBonus,
      finalPI: +(avgPI + titleBonus + playoffBonus).toFixed(1),
    };
  }

  // ── AVG VOR BY POSITION ──────────────────────────────────────
  const avgVORByPos = {};
  const positions = ['all', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'SKILL'];
  for (const pos of positions) {
    avgVORByPos[pos] = CORE_MANAGERS.map(mgr => {
      let vors;
      if (pos === 'all') vors = Object.values(mgrPosVOR[mgr] || {}).flat();
      else if (pos === 'SKILL') vors = [...(mgrPosVOR[mgr]?.RB||[]), ...(mgrPosVOR[mgr]?.WR||[]), ...(mgrPosVOR[mgr]?.TE||[])];
      else vors = mgrPosVOR[mgr]?.[pos] || [];
      return vors.length ? { n: mgr, avg: +(vors.reduce((a,b)=>a+b,0)/vors.length).toFixed(1), count: vors.length } : null;
    }).filter(Boolean).sort((a, b) => b.avg - a.avg);
  }

  // ── TRADE VOR DIFF ──────────────────────────────────────────
  const tradeVOR = {};
  for (const mgr of CORE_MANAGERS) tradeVOR[mgr] = { vorRecv: 0, vorGiven: 0, trades: 0 };

  for (const year of years) {
    for (const txn of seasons[year].transactions || []) {
      if (txn.type !== 'trade') continue;
      const sides = {};
      let valid = true;
      for (const p of txn.players || []) {
        const dest = p.dest_team_name; const src = p.source_team_name;
        if (!dest || !src) { valid = false; break; }
        const pts = playerYearPts[p.player_name]?.[year] || 0;
        const vor = getVOR(pts, p.position, year);
        sides[dest] = (sides[dest] || 0) + vor;
      }
      if (!valid || Object.keys(sides).length < 2) continue;
      for (const [dest, vorRecv] of Object.entries(sides)) {
        const mgr = TEAM_TO_MANAGER[dest];
        if (!mgr || !tradeVOR[mgr]) continue;
        const vorGiven = Object.entries(sides).filter(([dt]) => dt !== dest).reduce((s,[,v]) => s+v, 0);
        tradeVOR[mgr].vorRecv += vorRecv;
        tradeVOR[mgr].vorGiven += vorGiven;
        tradeVOR[mgr].trades++;
      }
    }
  }

  const tradeDiff = CORE_MANAGERS
    .filter(mgr => tradeVOR[mgr].trades > 0)
    .map(mgr => ({
      m: mgr, trades: tradeVOR[mgr].trades,
      recv: Math.round(tradeVOR[mgr].vorRecv),
      given: Math.round(tradeVOR[mgr].vorGiven),
      net: Math.round(tradeVOR[mgr].vorRecv - tradeVOR[mgr].vorGiven),
    }))
    .sort((a, b) => b.net - a.net);

  // ── WAIVER ACTIVITY ──────────────────────────────────────────
  const waiverByMgrYear = {};
  const waiverPosByMgr = {};
  for (const mgr of CORE_MANAGERS) { waiverByMgrYear[mgr] = {}; waiverPosByMgr[mgr] = {}; }

  for (const year of years) {
    const standings = seasons[year].standings || [];
    const teamMgr = {};
    for (const t of standings) teamMgr[t.name] = resolveManager(t.manager, t.name);
    for (const txn of seasons[year].transactions || []) {
      for (const p of txn.players || []) {
        if (p.type !== 'add') continue;
        const dest = p.dest_team_name;
        const mgr = teamMgr[dest] || TEAM_TO_MANAGER[dest];
        if (!mgr || !waiverByMgrYear[mgr]) continue;
        waiverByMgrYear[mgr][year] = (waiverByMgrYear[mgr][year] || 0) + 1;
        const pos = p.position || '?';
        waiverPosByMgr[mgr][pos] = (waiverPosByMgr[mgr][pos] || 0) + 1;
      }
    }
  }

  const waiverCareer = CORE_MANAGERS.map(mgr => {
    const byYear = waiverByMgrYear[mgr];
    const total = Object.values(byYear).reduce((a, b) => a + b, 0);
    const peakEntry = Object.entries(byYear).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
    const pos = waiverPosByMgr[mgr];
    return { m: mgr, total, peak: peakEntry[0], vol: peakEntry[1],
      rb: pos.RB||0, wr: pos.WR||0, te: pos.TE||0, qb: pos.QB||0, def: pos.DEF||0, k: pos.K||0 };
  }).sort((a, b) => b.total - a.total);

  return {
    champions, ppw, managerStats, luckCareer, luckSeasons,
    h2h, snakeDrafts, auctionDrafts, avgVORByPos,
    seasonPI, careerPI, tradeDiff, waiverCareer,
    replLevel, mgrColors: MGR_COLORS,
  };
}

// ─── NOTES ON STATIC DATA ───────────────────────────────────────────────────
// Most Lopsided Trades: ranked by VOR differential, not raw points.
//   VOR accounts for positional scarcity (an RB at 200pts > QB at 200pts).
//   tradeLopsided in index.html contains the VOR-based rankings.
//   To recalculate, run the Python analysis script and look for get_vor() output.
//
// ─── STATIC AUCTION DRAFT DATA (from AuctionValues.xlsx) ───────────────────
// Auction salary data lives outside fantasy_data.json so is embedded here.
// Update this block when running a new auction season.

const AUCTION_DRAFT_DATA = [
  {year:'2024',m:'Ryan',team:'Balls deep',vor:908,z:1.81,type:'auction',picks:[{n:'Saquon Barkley',pos:'RB',r:'$55',pts:352,v:165},{n:'George Kittle',pos:'TE',r:'$6',pts:168,v:105},{n:'Alvin Kamara',pos:'RB',r:'$12',pts:198,v:99},{n:'Aaron Jones',pos:'RB',r:'$9',pts:183,v:91},{n:'Courtland Sutton',pos:'WR',r:'$1',pts:167,v:63}]},
  {year:'2018',m:'Josh',team:"Jerry's Fairies",vor:788,z:1.76,type:'auction',picks:[{n:'Patrick Mahomes',pos:'QB',r:'$2',pts:555,v:197},{n:'Chris Carson',pos:'RB',r:'$4',pts:194,v:105},{n:'Tyreek Hill',pos:'WR',r:'$35',pts:259,v:94},{n:'Isaiah Crowell',pos:'RB',r:'$2',pts:117,v:32},{n:'Chris Godwin Jr.',pos:'WR',r:'$3',pts:133,v:30}]},
  {year:'2020',m:'matt',team:'scute without the e',vor:735,z:1.74,type:'auction',picks:[{n:'Josh Allen',pos:'QB',r:'$1',pts:494,v:191},{n:'Antonio Gibson',pos:'RB',r:'$7',pts:164,v:79},{n:'Justin Tucker',pos:'K',r:'$2',pts:145,v:74},{n:'Steelers',pos:'DEF',r:'$2',pts:148,v:64},{n:'Aaron Jones',pos:'RB',r:'$38',pts:212,v:58}]},
  {year:'2016',m:'Ryan',team:'Balls deep',vor:809,z:1.54,type:'auction',picks:[{n:'David Johnson',pos:'RB',r:'$58',pts:333,v:152},{n:'Jordan Howard',pos:'RB',r:'$1',pts:217,v:146},{n:'Connor Barth',pos:'K',r:'$1',pts:90,v:88},{n:'Eagles',pos:'DEF',r:'$1',pts:143,v:45},{n:'Patriots',pos:'DEF',r:'$1',pts:129,v:31}]},
  {year:'2022',m:'Wes',team:'Stable of Stars',vor:837,z:1.38,type:'auction',picks:[{n:'Daniel Carlson',pos:'K',r:'$1',pts:162,v:141},{n:'Josh Jacobs',pos:'RB',r:'$28',pts:284,v:134},{n:'Miles Sanders',pos:'RB',r:'$10',pts:202,v:94},{n:'Travis Kelce',pos:'TE',r:'$41',pts:224,v:68},{n:'49ers',pos:'DEF',r:'$3',pts:164,v:54}]},
  {year:'2022',m:'T Rex',team:'Pity I wasnt invited',vor:827,z:1.34,type:'auction',picks:[{n:'Jamaal Williams',pos:'RB',r:'$1',pts:215,v:128},{n:'Evan McPherson',pos:'K',r:'$1',pts:131,v:110},{n:'Kenneth Walker III',pos:'RB',r:'$1',pts:184,v:97},{n:'Rhamondre Stevenson',pos:'RB',r:'$9',pts:176,v:70},{n:'Kirk Cousins',pos:'QB',r:'$1',pts:361,v:66}]},
  {year:'2016',m:'Wes',team:'ndamukong suh dude!!',vor:741,z:1.28,type:'auction',picks:[{n:'Melvin Gordon III',pos:'RB',r:'$12',pts:211,v:119},{n:'Isaiah Crowell',pos:'RB',r:'$2',pts:169,v:96},{n:'Frank Gore',pos:'RB',r:'$6',pts:172,v:91},{n:'Devonta Freeman',pos:'RB',r:'$36',pts:224,v:85},{n:'Latavius Murray',pos:'RB',r:'$20',pts:172,v:64}]},
  {year:'2018',m:'Ryan',team:'Balls deep',vor:669,z:1.27,type:'auction',picks:[{n:'Saquon Barkley',pos:'RB',r:'$50',pts:311,v:133},{n:'George Kittle',pos:'TE',r:'$1',pts:180,v:129},{n:'Todd Gurley',pos:'RB',r:'$71',pts:325,v:106},{n:'Jared Cook',pos:'TE',r:'$1',pts:138,v:87},{n:'Mason Crosby',pos:'K',r:'$1',pts:145,v:48}]},
  {year:'2020',m:'Jack',team:'Mitha Rodgas Neybhud',vor:636,z:1.25,type:'auction',picks:[{n:'J.K. Dobbins',pos:'RB',r:'$6',pts:149,v:67},{n:'Alvin Kamara',pos:'RB',r:'$70',pts:289,v:64},{n:'Joey Slye',pos:'K',r:'$1',pts:129,v:61},{n:'Davante Adams',pos:'WR',r:'$51',pts:266,v:50},{n:'Chase Edmonds',pos:'RB',r:'$1',pts:99,v:28}]},
  {year:'2024',m:'Nels',team:"Nelson's Man-Dillas",vor:706,z:1.05,type:'auction',picks:[{n:'Jahmyr Gibbs',pos:'RB',r:'$59',pts:316,v:121},{n:'Jason Sanders',pos:'K',r:'$1',pts:166,v:70},{n:"D'Andre Swift",pos:'RB',r:'$10',pts:164,v:70},{n:'Trey McBride',pos:'TE',r:'$13',pts:145,v:67},{n:'Brian Robinson',pos:'RB',r:'$2',pts:142,v:64}]},
  // Worst auction drafts
  {year:'2022',m:'matt',team:'scute without the e (2022)',vor:115,z:-1.72,type:'auction',picks:[{n:'Justin Tucker',pos:'K',r:'$2',pts:164,v:140},{n:'Davante Adams',pos:'WR',r:'$45',pts:261,v:62},{n:'C. Patterson',pos:'RB',r:'$2',pts:135,v:45},{n:'Travis Etienne Jr.',pos:'RB',r:'$28',pts:182,v:32},{n:'Bills',pos:'DEF',r:'$3',pts:136,v:26}]},
  {year:'2024',m:'Bryson',team:'Fuuck Stan Kroenke (2024)',vor:39,z:-1.45,type:'auction',picks:[{n:'Rico Dowdle',pos:'RB',r:'$9',pts:162,v:70},{n:'Justin Tucker',pos:'K',r:'$3',pts:143,v:43},{n:'Mark Andrews',pos:'TE',r:'$16',pts:126,v:42},{n:'Rhamondre Stevenson',pos:'RB',r:'$13',pts:134,v:33},{n:'Tee Higgins',pos:'WR',r:'$8',pts:151,v:33}]},
  {year:'2016',m:'matt',team:'Simmons is old! (2016)',vor:21,z:-1.43,type:'auction',picks:[{n:'Stephen Hauschka',pos:'K',r:'$1',pts:138,v:136},{n:"Le'Veon Bell",pos:'RB',r:'$45',pts:255,v:99},{n:'Chiefs',pos:'DEF',r:'$1',pts:164,v:66},{n:'Brandin Cooks',pos:'WR',r:'$37',pts:171,v:12},{n:'Tyler Eifert',pos:'TE',r:'$1',pts:68,v:-3}]},
  {year:'2018',m:'Wes',team:"Hangin' w/ Hernandez",vor:124,z:-0.97,type:'auction',picks:[{n:'Wil Lutz',pos:'K',r:'$1',pts:151,v:54},{n:'Texans',pos:'DEF',r:'$1',pts:148,v:51},{n:'Robbie Gould',pos:'K',r:'$1',pts:139,v:42},{n:'O.J. Howard',pos:'TE',r:'$1',pts:82,v:31},{n:'David Njoku',pos:'TE',r:'$3',pts:82,v:27}]},
  {year:'2020',m:'Wes',team:'Dez-ed and Confused (2020)',vor:189,z:-0.97,type:'auction',picks:[{n:'Kyler Murray',pos:'QB',r:'$29',pts:433,v:67},{n:'Travis Kelce',pos:'TE',r:'$47',pts:224,v:48},{n:'Jamison Crowder',pos:'WR',r:'$1',pts:120,v:16},{n:'Tony Pollard',pos:'RB',r:'$1',pts:81,v:10},{n:'Matt Gay',pos:'K',r:'$1',pts:66,v:0}]},
];

// Export for use in dashboard
if (typeof module !== 'undefined') module.exports = { runAnalysis, TEAM_TO_MANAGER, CORE_MANAGERS, MGR_COLORS, AUCTION_DRAFT_DATA };
