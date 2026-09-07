// Best-effort final-score lookup via ESPN's public (unofficial, keyless) JSON API.
// Returns a "final_score" string or null when the game can't be matched.

import { getJson } from "../http";
import { logger } from "../logger";

// ponytail: only the leagues Polymarket runs game markets on most. Unknown
// league slug -> no score backfill (outcome is still recorded).
const ESPN_PATH: Record<string, string> = {
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  cbb: "basketball/mens-college-basketball",
  nfl: "football/nfl",
  cfb: "football/college-football",
  "college-football": "football/college-football",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  epl: "soccer/eng.1",
  "premier-league": "soccer/eng.1",
  laliga: "soccer/esp.1",
  seriea: "soccer/ita.1",
  bundesliga: "soccer/ger.1",
  ligue1: "soccer/fra.1",
  mls: "soccer/usa.1",
  ucl: "soccer/uefa.champions",
};

interface EspnTeam {
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  location?: string;
  abbreviation?: string;
}
interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  team?: EspnTeam;
}
interface EspnScoreboard {
  events?: {
    date: string;
    status?: { type?: { completed?: boolean } };
    competitions?: { competitors?: EspnCompetitor[] }[];
  }[];
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function teamMatches(needle: string | null, t: EspnTeam | undefined): boolean {
  if (!needle || !t) return false;
  const n = needle.toLowerCase();
  return [t.displayName, t.shortDisplayName, t.name, t.location, t.abbreviation]
    .filter(Boolean)
    .some((v) => {
      const x = (v as string).toLowerCase();
      return x.includes(n) || n.includes(x);
    });
}

export async function fetchFinalScore(
  sport: string | null,
  gameStart: Date | null,
  homeTeam: string | null,
  awayTeam: string | null,
): Promise<string | null> {
  const path = sport ? ESPN_PATH[sport.toLowerCase()] : undefined;
  if (!path || !gameStart) return null;

  // Check the game's local day and the day after (UTC vs venue timezone slop).
  const days = [gameStart, new Date(gameStart.getTime() + 24 * 3600 * 1000)];
  for (const day of days) {
    try {
      const data = await getJson<EspnScoreboard>(
        `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymd(day)}`,
      );
      for (const ev of data.events ?? []) {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find((c) => c.homeAway === "home");
        const away = comp?.competitors?.find((c) => c.homeAway === "away");
        if (!home || !away) continue;
        const direct = teamMatches(homeTeam, home.team) && teamMatches(awayTeam, away.team);
        const swapped = teamMatches(homeTeam, away.team) && teamMatches(awayTeam, home.team);
        if (!direct && !swapped) continue;
        if (!ev.status?.type?.completed) return null;
        return `${away.team?.abbreviation ?? "AWAY"} ${away.score ?? "?"} @ ${home.team?.abbreviation ?? "HOME"} ${home.score ?? "?"}`;
      }
    } catch (err) {
      logger.debug("espn lookup failed", { path, err });
    }
  }
  return null;
}
