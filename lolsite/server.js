// server.js
//
// One small web server that does two jobs:
//   1. Serves the website (everything in /public)
//   2. Answers GET /api/matchup?a=Name1%23Tag1&b=Name2%23Tag2
//      by calling the real Riot API and returning shared match history
//      as JSON, going back up to LOOKBACK_DAYS days.
//
// Run locally with:  RIOT_API_KEY=RGAPI-xxxx node server.js
// On a host like Render, RIOT_API_KEY is set in their dashboard instead
// of typed on the command line — see DEPLOY.md.

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const CONTINENT = process.env.RIOT_CONTINENT || "americas"; // americas | europe | asia

// How far back to search for shared matches. match-v5's startTime/endTime
// filter lets us ask for a real date range instead of guessing how many
// games covers "2 months" — a person who plays daily needs way more than
// 50 games to cover 2 months, a person who plays rarely needs way fewer.
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "60", 10);

// Safety ceiling so one lookup can't run away and chew through the whole
// rate-limit budget if two players share an unusually large number of games.
const MAX_SHARED_MATCHES_TO_FETCH = 60;

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Riot API helpers
// ---------------------------------------------------------------------------

async function riotFetch(url) {
  const res = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("retry-after") || "1", 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return riotFetch(url);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Riot API error ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

async function getPuuid(riotId) {
  const [gameName, tagLine] = riotId.split("#");
  if (!gameName || !tagLine) {
    const err = new Error(`"${riotId}" isn't a valid Riot ID. Use the format Name#Tag.`);
    err.status = 400;
    throw err;
  }
  const url = `https://${CONTINENT}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const data = await riotFetch(url);
  return data.puuid;
}

// Fetches ALL match IDs within the lookback window, paginating in batches
// of 100 (match-v5's max per call) until Riot returns an empty page.
async function getMatchIdsInWindow(puuid, lookbackDays) {
  const startTime = Math.floor((Date.now() - lookbackDays * 86400000) / 1000); // seconds
  const allIds = [];
  let start = 0;
  const pageSize = 100;

  while (true) {
    const url =
      `https://${CONTINENT}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids` +
      `?startTime=${startTime}&start=${start}&count=${pageSize}`;
    const page = await riotFetch(url);
    allIds.push(...page);

    if (page.length < pageSize) break; // last page
    start += pageSize;
    if (start > 1000) break; // hard safety ceiling, ~10 pages
  }

  return allIds;
}

async function getMatch(matchId) {
  const url = `https://${CONTINENT}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

// Smite's summonerId in Riot's API. This is one of the oldest, most stable
// numeric IDs in the whole API (predates match-v5 itself) — equipping it
// is a more reliable jungle signal than teamPosition/individualPosition,
// which Riot's own classifier sometimes gets wrong in ARAM, customs, or
// odd lane setups. Only junglers take Smite, full stop.
const SMITE_SPELL_ID = 11;

// Pulls the rich per-player breakdown used by the expandable match detail
// view: champion, KDA, CS, damage, gold, wards, and full item list.
function statsFor(p) {
  return {
    champion: p.championName,
    win: p.win,
    k: p.kills,
    d: p.deaths,
    a: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    damageDealt: p.totalDamageDealtToChampions,
    damageTaken: p.totalDamageTaken,
    goldEarned: p.goldEarned,
    visionScore: p.visionScore,
    wardsPlaced: p.wardsPlaced,
    position: p.teamPosition || p.individualPosition || null,
    isJungle: p.summoner1Id === SMITE_SPELL_ID || p.summoner2Id === SMITE_SPELL_ID,
    summonerLevel: p.summonerLevel,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i) => i && i !== 0),
    trinket: p.item6 && p.item6 !== 0 ? p.item6 : null,
    summoner1Id: p.summoner1Id,
    summoner2Id: p.summoner2Id,
  };
}

function extractHeadToHead(matchData, puuidA, puuidB) {
  const { info } = matchData;
  const pA = info.participants.find((p) => p.puuid === puuidA);
  const pB = info.participants.find((p) => p.puuid === puuidB);
  if (!pA || !pB) return null;

  const a = statsFor(pA);
  const b = statsFor(pB);

  return {
    matchId: matchData.metadata.matchId,
    gameCreation: info.gameCreation,
    durationMin: Math.round(info.gameDuration / 60),
    queueId: info.queueId,
    gameMode: info.gameMode,
    sameTeam: pA.teamId === pB.teamId,
    bothJungle: a.isJungle && b.isJungle,
    a,
    b,
  };
}

// ---------------------------------------------------------------------------
// The API route the website calls
// ---------------------------------------------------------------------------

app.get("/api/matchup", async (req, res) => {
  const riotIdA = req.query.a;
  const riotIdB = req.query.b;
  const jungleOnly = req.query.jungleOnly === "true";

  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: "Server is missing RIOT_API_KEY. Set it in your host's environment variables." });
  }
  if (!riotIdA || !riotIdB) {
    return res.status(400).json({ error: "Provide both ?a=Name#Tag and ?b=Name#Tag" });
  }

  try {
    const [puuidA, puuidB] = await Promise.all([getPuuid(riotIdA), getPuuid(riotIdB)]);

    const [idsA, idsB] = await Promise.all([
      getMatchIdsInWindow(puuidA, LOOKBACK_DAYS),
      getMatchIdsInWindow(puuidB, LOOKBACK_DAYS),
    ]);

    const setB = new Set(idsB);
    let sharedIds = idsA.filter((id) => setB.has(id));
    const totalSharedFound = sharedIds.length;
    const truncated = sharedIds.length > MAX_SHARED_MATCHES_TO_FETCH;
    sharedIds = sharedIds.slice(0, MAX_SHARED_MATCHES_TO_FETCH);

    let matches = [];
    for (const matchId of sharedIds) {
      const matchData = await getMatch(matchId);
      const h2h = extractHeadToHead(matchData, puuidA, puuidB);
      if (h2h) matches.push(h2h);
      await new Promise((r) => setTimeout(r, 50)); // be gentle with rate limits
    }

    matches.sort((m1, m2) => m2.gameCreation - m1.gameCreation);

    // Fetched count is the same regardless of filter — keep this for an
    // honest "X of Y total shared games were jungle vs jungle" message.
    const jungleMatchCount = matches.filter((m) => m.bothJungle).length;

    if (jungleOnly) {
      matches = matches.filter((m) => m.bothJungle);
    }

    const enemyGames = matches.filter((m) => !m.sameTeam);
    const record = {
      aWins: enemyGames.filter((m) => m.a.win).length,
      bWins: enemyGames.filter((m) => m.b.win).length,
      allyGames: matches.length - enemyGames.length,
    };

    res.json({
      riotIdA,
      riotIdB,
      matches,
      record,
      lookbackDays: LOOKBACK_DAYS,
      truncated,
      jungleOnly,
      jungleMatchCount,
      totalFetchedCount: sharedIds.length,
      totalSharedFound,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
