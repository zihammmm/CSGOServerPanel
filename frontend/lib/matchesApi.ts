import { apiFetch } from "./api";
import type { BoType, CaptainMode, MatchDetail, MatchSummary, MatchUser } from "./matchesMock";

export async function listMatches(): Promise<{ active: MatchSummary | null; history: MatchSummary[] }> {
  return apiFetch<{ active: MatchSummary | null; history: MatchSummary[] }>("/api/v1/matches");
}

export async function getMatchDetail(id: string): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/matches/${id}`);
}

export async function createMatch(_creator: MatchUser, bo: BoType, captainMode: CaptainMode, title: string): Promise<MatchDetail> {
  return apiFetch<MatchDetail>("/api/v1/admin/matches", {
    method: "POST",
    body: JSON.stringify({ bo, captainMode, title }),
  });
}

export async function startMatch(id: string, _actorUserId: number, _actorRole: "guest" | "admin" | "super_admin"): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function joinMatch(id: string, _user: MatchUser): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/matches/${id}/join`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function leaveMatch(id: string, _userId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/matches/${id}/leave`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function assignCaptains(id: string, _actorUserId: number, captainAUserId: number, captainBUserId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/captains`, {
    method: "POST",
    body: JSON.stringify({ captainAUserId, captainBUserId }),
  });
}

export async function draftPick(id: string, _captainUserId: number, targetUserId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/matches/${id}/draft/pick`, {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
  });
}

export async function vetoMap(id: string, _captainUserId: number, mapName: string): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/matches/${id}/veto/action`, {
    method: "POST",
    body: JSON.stringify({ mapName }),
  });
}

export async function launchMatch(id: string, _actorUserId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/launch`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function restartMatch(id: string, _actorUserId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/restart`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function forceStartMatch(id: string, _actorUserId: number, _actorRole: "guest" | "admin" | "super_admin"): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/force-start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function cancelMatch(id: string, _actorUserId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function finishMatch(id: string, _actorUserId: number): Promise<MatchDetail> {
  return apiFetch<MatchDetail>(`/api/v1/admin/matches/${id}/finish`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
