// server.js
//
// One small web server that does two jobs:
//   1. Serves the website (everything in /public)
//   2. Answers GET /api/matchup?a=Name1%23Tag1&b=Name2%23Tag2
//      by calling the real Riot API and returning shared match history
//      as JSON.
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

// Serve the static website files (index.html, etc.) from /public
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Riot API helpers (same logic as riot-matchup.js, adapted to answer
// one web request instead of running once from the command line)
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

async function getMatchIds(puuid, count = 50) {
  const url = `https://${CONTINENT}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${count}`;
  return riotFetch(url);
}

async function getMatch(matchId) {
  const url = `https://${CONTINENT}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

function extractHeadToHead(matchData, puuidA, puuidB) {
  const { info } = matchData;
  const pA = info.participants.find((p) => p.puuid === puuidA);
  const pB = info.participants.find((p) => p.puuid === puuidB);
  if (!pA || !pB) return null;

  const statsFor = (p) => ({
    champion: p.championName,
    win: p.win,
    k: p.kills,
    d: p.deaths,
    a: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
  });

  return {
    matchId: matchData.metadata.matchId,
    gameCreation: info.gameCreation,
    durationMin: Math.round(info.gameDuration / 60),
    queueId: info.queueId,
    sameTeam: pA.teamId === pB.teamId,
    a: statsFor(pA),
    b: statsFor(pB),
  };
}

// ---------------------------------------------------------------------------
// The one API route the website calls
// ---------------------------------------------------------------------------

app.get("/api/matchup", async (req, res) => {
  const riotIdA = req.query.a;
  const riotIdB = req.query.b;

  if (!RIOT_API_KEY) {
    return res.status(500).json({ error: "Server is missing RIOT_API_KEY. Set it in your host's environment variables." });
  }
  if (!riotIdA || !riotIdB) {
    return res.status(400).json({ error: "Provide both ?a=Name#Tag and ?b=Name#Tag" });
  }

  try {
    const [puuidA, puuidB] = await Promise.all([getPuuid(riotIdA), getPuuid(riotIdB)]);

    const [idsA, idsB] = await Promise.all([getMatchIds(puuidA, 50), getMatchIds(puuidB, 50)]);

    const setB = new Set(idsB);
    const sharedIds = idsA.filter((id) => setB.has(id));

    const matches = [];
    for (const matchId of sharedIds) {
      const matchData = await getMatch(matchId);
      const h2h = extractHeadToHead(matchData, puuidA, puuidB);
      if (h2h) matches.push(h2h);
      await new Promise((r) => setTimeout(r, 50)); // be gentle with rate limits
    }

    matches.sort((m1, m2) => m2.gameCreation - m1.gameCreation);

    const enemyGames = matches.filter((m) => !m.sameTeam);
    const record = {
      aWins: enemyGames.filter((m) => m.a.win).length,
      bWins: enemyGames.filter((m) => m.b.win).length,
      allyGames: matches.length - enemyGames.length,
    };

    res.json({ riotIdA, riotIdB, matches, record });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
