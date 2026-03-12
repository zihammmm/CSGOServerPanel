export type MatchStatus =
  | "created"
  | "gathering"
  | "captain_pick"
  | "player_draft"
  | "map_veto"
  | "ready_to_start"
  | "live"
  | "finished"
  | "cancelled";

export type CaptainMode = "admin_assigned" | "random";
export type TeamSide = "A" | "B";
export type BoType = 1 | 3 | 5;
export type VetoActionType = "ban" | "pick";

export type MatchUser = {
  userId: number;
  steamId: string;
  nickname: string;
};

export type MatchPlayer = MatchUser & {
  team: TeamSide | null;
  isCaptain: boolean;
  joinedAt: string;
};

export type VetoStep = {
  order: number;
  team: TeamSide;
  action: VetoActionType;
  map: string;
};

export type MatchSummary = {
  id: string;
  title: string;
  status: MatchStatus;
  bo: BoType;
  captainMode: CaptainMode;
  creatorName: string;
  createdAt: string;
  playerCount: number;
  scoreA: number | null;
  scoreB: number | null;
};

export type MatchPlayerStat = {
  userId: number;
  steamId: string;
  nickname: string;
  avatarUrl: string;
  team: TeamSide;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  rating: number;
};

export type MatchMapResult = {
  key: string;
  map: string;
  scoreA: number;
  scoreB: number;
  playerStats: MatchPlayerStat[];
};

export type MatchDetail = Omit<MatchSummary, "playerCount"> & {
  creatorUserId: number;
  serverAddr: string;
  players: MatchPlayer[];
  playerStats: MatchPlayerStat[];
  mapResults: MatchMapResult[];
  mapsPool: string[];
  pickedMaps: string[];
  bannedMaps: string[];
  vetoSteps: VetoStep[];
  draftTurns: TeamSide[];
  draftTurnIndex: number;
  vetoTurnIndex: number;
  vetoScript: Array<{ team: TeamSide; action: VetoActionType }>;
  updatedAt: string;
};

const SERVER_ADDR = "1.116.119.184:27015";
const DEFAULT_MAPS = [
  "de_ancient",
  "de_anubis",
  "de_dust2",
  "de_inferno",
  "de_mirage",
  "de_nuke",
  "de_train",
];

const draftTurns: TeamSide[] = ["A", "B", "B", "A", "A", "B", "B", "A"];

const demoUsers: MatchUser[] = [
  { userId: 1, steamId: "76561198000000001", nickname: "Alpha" },
  { userId: 2, steamId: "76561198000000002", nickname: "Bravo" },
  { userId: 3, steamId: "76561198000000003", nickname: "Charlie" },
  { userId: 4, steamId: "76561198000000004", nickname: "Delta" },
  { userId: 5, steamId: "76561198000000005", nickname: "Echo" },
  { userId: 6, steamId: "76561198000000006", nickname: "Foxtrot" },
  { userId: 7, steamId: "76561198000000007", nickname: "Golf" },
  { userId: 8, steamId: "76561198000000008", nickname: "Hotel" },
  { userId: 9, steamId: "76561198000000009", nickname: "India" },
  { userId: 10, steamId: "76561198000000010", nickname: "Juliet" },
];

function nowISO(): string {
  return new Date().toISOString();
}

function makeTitle(bo: BoType): string {
  const d = new Date();
  return `5v5 竞技 BO${bo} - ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildVetoScript(bo: BoType): Array<{ team: TeamSide; action: VetoActionType }> {
  if (bo === 1) {
    return [
      { team: "A", action: "ban" },
      { team: "B", action: "ban" },
      { team: "A", action: "ban" },
      { team: "B", action: "ban" },
      { team: "A", action: "ban" },
      { team: "B", action: "ban" },
    ];
  }
  if (bo === 3) {
    return [
      { team: "A", action: "ban" },
      { team: "B", action: "ban" },
      { team: "A", action: "pick" },
      { team: "B", action: "pick" },
      { team: "A", action: "ban" },
      { team: "B", action: "ban" },
    ];
  }
  return [
    { team: "A", action: "ban" },
    { team: "B", action: "ban" },
  ];
}

function toSummary(m: MatchDetail): MatchSummary {
  return {
    id: m.id,
    title: m.title,
    status: m.status,
    bo: m.bo,
    captainMode: m.captainMode,
    creatorName: m.creatorName,
    createdAt: m.createdAt,
    playerCount: m.players.length,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
  };
}

function makeTimestampId(seq: number): string {
  return `${Date.now()}${String(seq).padStart(3, "0")}`;
}

function createDetail(creator: MatchUser, bo: BoType, captainMode: CaptainMode): MatchDetail {
  return {
    id: makeTimestampId(state.idSeq++),
    title: makeTitle(bo),
    status: "gathering",
    bo,
    captainMode,
    creatorName: creator.nickname,
    creatorUserId: creator.userId,
    createdAt: nowISO(),
    serverAddr: SERVER_ADDR,
    scoreA: null,
    scoreB: null,
    players: [],
    playerStats: [],
    mapResults: [],
    mapsPool: [...DEFAULT_MAPS],
    pickedMaps: [],
    bannedMaps: [],
    vetoSteps: [],
    draftTurns: [...draftTurns],
    draftTurnIndex: 0,
    vetoTurnIndex: 0,
    vetoScript: buildVetoScript(bo),
    updatedAt: nowISO(),
  };
}

function cloneMatch(match: MatchDetail): MatchDetail {
  return JSON.parse(JSON.stringify(match)) as MatchDetail;
}

function pickRandom<T>(items: T[], size: number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, size);
}

function markCaptain(match: MatchDetail, userId: number, team: TeamSide): void {
  const p = match.players.find((player) => player.userId === userId);
  if (!p) {
    throw new Error("队长必须来自房间玩家");
  }
  p.team = team;
  p.isCaptain = true;
}

function applyRandomCaptains(match: MatchDetail): void {
  const selected = pickRandom(match.players, 2);
  markCaptain(match, selected[0].userId, "A");
  markCaptain(match, selected[1].userId, "B");
  match.status = "player_draft";
  match.updatedAt = nowISO();
}

function isTeamFull(match: MatchDetail, team: TeamSide): boolean {
  return match.players.filter((p) => p.team === team).length >= 5;
}

function ensureDraftFinished(match: MatchDetail): void {
  if (isTeamFull(match, "A") && isTeamFull(match, "B")) {
    match.status = "map_veto";
    match.updatedAt = nowISO();
  }
}

function finalizeVeto(match: MatchDetail): void {
  if (match.bo === 1) {
    const decider = match.mapsPool[0];
    match.pickedMaps = [decider];
  } else if (match.bo === 3) {
    if (match.mapsPool.length !== 1) {
      throw new Error("BO3 地图流程异常");
    }
    match.pickedMaps = [...match.pickedMaps, match.mapsPool[0]];
  } else {
    match.pickedMaps = [...match.mapsPool];
  }
  match.status = "ready_to_start";
  match.updatedAt = nowISO();
}

function validateSingleActive(newStatus: MatchStatus, id: string): void {
  if (newStatus === "finished" || newStatus === "cancelled") {
    return;
  }
  const active = state.matches.find((m) => m.id !== id && m.status !== "finished" && m.status !== "cancelled");
  if (active) {
    throw new Error("当前已有一场未结束比赛，初版仅支持单场进行中");
  }
}

function pickStatByUser(userID: number, salt: number): { kills: number; deaths: number; assists: number; adr: number; rating: number } {
  const seed = Math.abs((userID * 1103515245 + 12345 + salt * 97) % 997);
  const kills = 12 + (seed % 17);
  const deaths = 10 + (seed % 13);
  const assists = 2 + (seed % 9);
  const adr = 58 + (seed % 65);
  const rating = Number((0.8 + (kills-deaths) / 30 + assists / 40 + adr / 400).toFixed(2));
  return { kills, deaths, assists, adr, rating };
}

function makeAvatarURL(steamID: string, nickname: string): string {
  const seed = Math.abs((Number(steamID.slice(-6)) || 0) % 360);
  const bg = `hsl(${seed}, 55%, 34%)`;
  const fg = "#eef4ff";
  const initial = (nickname.trim()[0] || "?").toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='32' fill='${bg}'/><text x='32' y='39' text-anchor='middle' font-size='28' font-family='Segoe UI, Arial, sans-serif' fill='${fg}' font-weight='700'>${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildFinalScoreboard(match: MatchDetail): MatchPlayerStat[] {
  return match.players
    .filter((p) => p.team === "A" || p.team === "B")
    .map((p) => {
      const base = pickStatByUser(p.userId, 0);
      return {
        userId: p.userId,
        steamId: p.steamId,
        nickname: p.nickname,
        avatarUrl: makeAvatarURL(p.steamId, p.nickname),
        team: p.team as TeamSide,
        kills: base.kills,
        deaths: base.deaths,
        assists: base.assists,
        adr: base.adr,
        rating: base.rating,
      };
    })
    .sort((a, b) => b.rating - a.rating);
}

function buildMapResults(match: MatchDetail, seriesA: number, seriesB: number): MatchMapResult[] {
  const maps = match.pickedMaps.length > 0 ? match.pickedMaps : ["decider"];
  const winners: TeamSide[] = [];
  for (let i = 0; i < seriesA; i += 1) winners.push("A");
  for (let i = 0; i < seriesB; i += 1) winners.push("B");
  while (winners.length < maps.length) {
    winners.push(winners.length % 2 === 0 ? "A" : "B");
  }
  return maps.map((map, idx) => {
    const mapSalt = map.split("").reduce((n, c) => n + c.charCodeAt(0), 0) + idx * 101;
    const winner = winners[idx] || "A";
    const closeRound = 7 + ((idx * 3) % 5);
    const scoreA = winner === "A" ? 13 : closeRound;
    const scoreB = winner === "B" ? 13 : closeRound;
    const playerStats = match.players
      .filter((p) => p.team === "A" || p.team === "B")
      .map((p) => {
        const base = pickStatByUser(p.userId, mapSalt);
        return {
          userId: p.userId,
          steamId: p.steamId,
          nickname: p.nickname,
          avatarUrl: makeAvatarURL(p.steamId, p.nickname),
          team: p.team as TeamSide,
          kills: Math.max(8, base.kills - 4),
          deaths: Math.max(6, base.deaths - 3),
          assists: Math.max(1, base.assists - 1),
          adr: Math.max(45, base.adr - 8),
          rating: Number((base.rating - 0.15).toFixed(2)),
        };
      })
      .sort((a, b) => b.rating - a.rating);
    return { key: `map_${idx}_${map}`, map, scoreA, scoreB, playerStats };
  });
}

function aggregateMapResults(mapResults: MatchMapResult[]): MatchPlayerStat[] {
  const totals = new Map<number, MatchPlayerStat & { mapCount: number }>();
  for (const map of mapResults) {
    for (const s of map.playerStats) {
      const found = totals.get(s.userId);
      if (!found) {
        totals.set(s.userId, { ...s, mapCount: 1 });
        continue;
      }
      found.kills += s.kills;
      found.deaths += s.deaths;
      found.assists += s.assists;
      found.adr += s.adr;
      found.rating += s.rating;
      found.mapCount += 1;
    }
  }
  return Array.from(totals.values())
    .map((v) => ({
      userId: v.userId,
      steamId: v.steamId,
      nickname: v.nickname,
      avatarUrl: v.avatarUrl,
      team: v.team,
      kills: v.kills,
      deaths: v.deaths,
      assists: v.assists,
      adr: Number((v.adr / v.mapCount).toFixed(1)),
      rating: Number((v.rating / v.mapCount).toFixed(2)),
    }))
    .sort((a, b) => b.rating - a.rating);
}

function ensureFinalResult(match: MatchDetail): void {
  if (match.scoreA !== null && match.scoreB !== null && match.playerStats.length > 0 && match.mapResults.length > 0) {
    return;
  }
  if (match.scoreA === null || match.scoreB === null) {
    const stats = buildFinalScoreboard(match);
    const teamAKills = stats.filter((s) => s.team === "A").reduce((n, s) => n + s.kills, 0);
    const teamBKills = stats.filter((s) => s.team === "B").reduce((n, s) => n + s.kills, 0);
    const teamAWin = teamAKills >= teamBKills;
    match.scoreA = teamAWin ? 13 : 9;
    match.scoreB = teamAWin ? 9 : 13;
  }
  match.mapResults = buildMapResults(match, match.scoreA, match.scoreB);
  match.playerStats = aggregateMapResults(match.mapResults);
}

const state: {
  idSeq: number;
  botSeq: number;
  matches: MatchDetail[];
} = {
  idSeq: 1,
  botSeq: 1,
  matches: [],
};

(function seed() {
  const now = Date.now();

  const live = createDetail({ userId: 99, steamId: "76561198009999999", nickname: "Admin-Z" }, 3, "admin_assigned");
  live.status = "gathering";
  live.players = demoUsers.slice(0, 8).map((u, i) => ({ ...u, team: null, isCaptain: false, joinedAt: new Date(Date.now() - i * 60_000).toISOString() }));

  const makeFinished = (offsetMs: number, bo: BoType, scoreA: number, scoreB: number, maps: string[], creatorName: string, captainMode: CaptainMode): MatchDetail => {
    const done = createDetail(
      { userId: 98 + Math.floor(offsetMs / 1_000_000), steamId: `7656119800${String(8888888 + Math.floor(offsetMs / 1_000_000)).padStart(8, "0")}`, nickname: creatorName },
      bo,
      captainMode,
    );
    done.id = `${now - offsetMs}`;
    done.createdAt = new Date(now - offsetMs).toISOString();
    done.updatedAt = new Date(now - offsetMs + 90 * 60 * 1000).toISOString();
    done.status = "finished";
    done.players = demoUsers.map((u, i) => ({
      ...u,
      team: i % 2 === 0 ? "A" : "B",
      isCaptain: i === 0 || i === 1,
      joinedAt: new Date(now - offsetMs - (10 - i) * 30_000).toISOString(),
    }));
    done.pickedMaps = maps;
    done.mapsPool = [];
    done.scoreA = scoreA;
    done.scoreB = scoreB;
    done.mapResults = buildMapResults(done, scoreA, scoreB);
    done.playerStats = aggregateMapResults(done.mapResults);
    return done;
  };

  const history1 = makeFinished(86_400_000, 1, 13, 10, ["de_mirage"], "Admin-Y", "random");
  history1.bannedMaps = ["de_train", "de_ancient", "de_nuke", "de_anubis", "de_inferno", "de_dust2"];

  const history2 = makeFinished(2 * 86_400_000, 3, 2, 1, ["de_inferno", "de_anubis", "de_nuke"], "Admin-K", "admin_assigned");
  history2.vetoSteps = [
    { order: 1, team: "A", action: "ban", map: "de_train" },
    { order: 2, team: "B", action: "ban", map: "de_mirage" },
    { order: 3, team: "A", action: "pick", map: "de_inferno" },
    { order: 4, team: "B", action: "pick", map: "de_anubis" },
    { order: 5, team: "A", action: "ban", map: "de_ancient" },
    { order: 6, team: "B", action: "ban", map: "de_dust2" },
  ];

  const history3 = makeFinished(4 * 86_400_000, 5, 3, 1, ["de_nuke", "de_mirage", "de_anubis", "de_inferno", "de_train"], "Admin-M", "random");
  history3.vetoSteps = [
    { order: 1, team: "A", action: "ban", map: "de_dust2" },
    { order: 2, team: "B", action: "ban", map: "de_ancient" },
  ];

  const history4 = makeFinished(6 * 86_400_000, 1, 8, 13, ["de_train"], "Admin-P", "admin_assigned");
  history4.bannedMaps = ["de_nuke", "de_mirage", "de_anubis", "de_dust2", "de_inferno", "de_ancient"];

  state.matches = [live, history1, history2, history3, history4];
})();

function getMatchById(id: string): MatchDetail {
  const match = state.matches.find((m) => m.id === id);
  if (!match) {
    throw new Error("比赛不存在");
  }
  return match;
}

function ensureUserInMatch(match: MatchDetail, userId: number): MatchPlayer {
  const p = match.players.find((player) => player.userId === userId);
  if (!p) {
    throw new Error("用户未加入该比赛");
  }
  return p;
}

function ensureUserIsCaptain(match: MatchDetail, userId: number): MatchPlayer {
  const p = ensureUserInMatch(match, userId);
  if (!p.isCaptain || !p.team) {
    throw new Error("仅队长可执行该操作");
  }
  return p;
}

export async function listMatches(): Promise<{ active: MatchSummary | null; history: MatchSummary[] }> {
  const sorted = [...state.matches].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  const active = sorted.find((m) => m.status !== "finished" && m.status !== "cancelled") || null;
  const history = sorted.filter((m) => m.status === "finished" || m.status === "cancelled").map(toSummary);
  return {
    active: active ? toSummary(active) : null,
    history,
  };
}

export async function getMatchDetail(id: string): Promise<MatchDetail> {
  return cloneMatch(getMatchById(id));
}

export async function createMatch(creator: MatchUser, bo: BoType, captainMode: CaptainMode): Promise<MatchDetail> {
  validateSingleActive("gathering", "");
  const match = createDetail(creator, bo, captainMode);
  state.matches.push(match);
  return cloneMatch(match);
}

export async function startMatch(id: string, actorUserId: number, actorRole: "guest" | "admin"): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (actorRole !== "admin") {
    throw new Error("仅管理员可开启比赛");
  }
  if (match.status !== "gathering") {
    throw new Error("当前阶段不可开启比赛");
  }
  if (match.players.length !== 10) {
    throw new Error("房间人数达到 10 人后才可开启比赛");
  }
  if (match.captainMode === "random") {
    applyRandomCaptains(match);
  } else {
    match.status = "captain_pick";
    match.updatedAt = nowISO();
  }
  return cloneMatch(match);
}

export async function joinMatch(id: string, user: MatchUser): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.status !== "gathering") {
    throw new Error("当前阶段不可加入");
  }
  if (!match.players.some((p) => p.userId === user.userId)) {
    if (match.players.length >= 10) {
      throw new Error("房间已满");
    }
    match.players.push({
      ...user,
      team: null,
      isCaptain: false,
      joinedAt: nowISO(),
    });
  }
  match.updatedAt = nowISO();
  return cloneMatch(match);
}

export async function leaveMatch(id: string, userId: number): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.status !== "gathering") {
    throw new Error("当前阶段不可退出");
  }
  if (!match.players.some((p) => p.userId === userId)) {
    throw new Error("用户未加入该比赛");
  }
  match.players = match.players.filter((p) => p.userId !== userId);
  match.updatedAt = nowISO();
  return cloneMatch(match);
}

export async function assignCaptains(id: string, actorUserId: number, captainAUserId: number, captainBUserId: number): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.creatorUserId !== actorUserId) {
    throw new Error("仅创建者可指定队长");
  }
  if (match.captainMode !== "admin_assigned" || match.status !== "captain_pick") {
    throw new Error("当前不可指定队长");
  }
  if (captainAUserId === captainBUserId) {
    throw new Error("两名队长不能是同一人");
  }
  for (const p of match.players) {
    p.team = null;
    p.isCaptain = false;
  }
  markCaptain(match, captainAUserId, "A");
  markCaptain(match, captainBUserId, "B");
  match.status = "player_draft";
  match.updatedAt = nowISO();
  return cloneMatch(match);
}

export async function draftPick(id: string, captainUserId: number, targetUserId: number): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.status !== "player_draft") {
    throw new Error("当前不是选人阶段");
  }
  const captain = ensureUserIsCaptain(match, captainUserId);
  const currentTeam = match.draftTurns[match.draftTurnIndex];
  if (captain.team !== currentTeam) {
    throw new Error("当前不是该队伍选择回合");
  }
  if (isTeamFull(match, currentTeam)) {
    match.draftTurnIndex += 1;
    return cloneMatch(match);
  }
  const target = ensureUserInMatch(match, targetUserId);
  if (target.team || target.isCaptain) {
    throw new Error("该玩家已被分配");
  }
  target.team = currentTeam;
  match.draftTurnIndex += 1;
  match.updatedAt = nowISO();
  ensureDraftFinished(match);
  return cloneMatch(match);
}

export async function vetoMap(id: string, captainUserId: number, mapName: string): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.status !== "map_veto") {
    throw new Error("当前不是 BP 阶段");
  }
  const captain = ensureUserIsCaptain(match, captainUserId);
  const turn = match.vetoScript[match.vetoTurnIndex];
  if (!turn) {
    throw new Error("BP 已完成");
  }
  if (captain.team !== turn.team) {
    throw new Error("当前不是该队伍 BP 回合");
  }
  if (!match.mapsPool.includes(mapName)) {
    throw new Error("地图不可用");
  }
  if (turn.action === "ban") {
    match.bannedMaps.push(mapName);
  } else {
    match.pickedMaps.push(mapName);
  }
  match.vetoSteps.push({
    order: match.vetoSteps.length + 1,
    team: turn.team,
    action: turn.action,
    map: mapName,
  });
  match.mapsPool = match.mapsPool.filter((m) => m !== mapName);
  match.vetoTurnIndex += 1;
  match.updatedAt = nowISO();

  if (match.vetoTurnIndex >= match.vetoScript.length) {
    finalizeVeto(match);
  }
  return cloneMatch(match);
}

export async function launchMatch(id: string, actorUserId: number): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.creatorUserId !== actorUserId) {
    throw new Error("仅创建者可启动比赛");
  }
  if (match.status !== "ready_to_start") {
    throw new Error("当前阶段不可启动");
  }
  match.status = "live";
  match.updatedAt = nowISO();
  return cloneMatch(match);
}

export async function forceStartMatch(id: string, actorUserId: number, actorRole: "guest" | "admin"): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (actorUserId <= 0 || actorRole !== "admin") {
    throw new Error("仅管理员可强制开始比赛");
  }
  if (match.status !== "gathering") {
    throw new Error("当前阶段不可强制开始");
  }
  if (match.players.length >= 10) {
    throw new Error("房间已满，请直接开启比赛");
  }
  while (match.players.length < 10) {
    const botID = 900000 + state.botSeq++;
    match.players.push({
      userId: botID,
      steamId: `7656119${String(botID).padStart(10, "0")}`,
      nickname: `BOT-${state.botSeq - 1}`,
      team: null,
      isCaptain: false,
      joinedAt: nowISO(),
    });
  }
  if (match.captainMode === "random") {
    applyRandomCaptains(match);
  } else {
    match.status = "captain_pick";
    match.updatedAt = nowISO();
  }
  return cloneMatch(match);
}

export async function cancelMatch(id: string, actorUserId: number): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.creatorUserId !== actorUserId) {
    throw new Error("仅创建者可取消比赛");
  }
  if (match.status === "finished" || match.status === "cancelled") {
    throw new Error("当前阶段不可取消比赛");
  }
  match.status = "cancelled";
  match.updatedAt = nowISO();
  return cloneMatch(match);
}

export async function finishMatch(id: string, actorUserId: number): Promise<MatchDetail> {
  const match = getMatchById(id);
  if (match.creatorUserId !== actorUserId) {
    throw new Error("仅创建者可结束比赛");
  }
  if (match.status !== "live") {
    throw new Error("仅进行中的比赛可结束");
  }
  match.status = "finished";
  ensureFinalResult(match);
  match.updatedAt = nowISO();
  return cloneMatch(match);
}
