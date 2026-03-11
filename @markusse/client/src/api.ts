import axios from "axios";
import { Activity, Patch, RepositoryFiles } from "./types";

const api = axios.create({
    baseURL: "/",
    timeout: 5000,
});

export interface AuthUserProfile {
    username: string;
    fullName: string;
    email: string;
    createdAt: string;
}

export interface AuthCredentials {
    username: string;
    password: string;
}

export interface RegisterPayload extends AuthCredentials {
    fullName: string;
    email: string;
}

export interface TeamSummary {
    teamName: string;
    ownerUsername: string;
    createdAt: string;
    memberCount: number;
    isOwner: boolean;
}

export interface TeamMember {
    username: string;
    fullName: string;
    status: "active" | "pending";
    joinedAt: string | null;
    sharingEnabled: boolean;
    disabledAt: string | null;
}

export interface TeamDetails {
    teamName: string;
    ownerUsername: string;
    createdAt: string;
    members: TeamMember[];
}

export interface TeamInvitation {
    teamName: string;
    ownerUsername: string;
    invitedAt: string;
}

export interface ProfileUpdatePayload {
    fullName?: string;
    email?: string;
    currentPassword?: string;
    newPassword?: string;
}

export interface SshKeyEntry {
    id: number;
    label: string;
    publicKey: string;
    createdAt: string;
}

export function isUnauthorizedError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 401;
}

export async function registerUser(payload: RegisterPayload): Promise<void> {
    await api.post("/auth/register", payload);
}

export async function loginUser(payload: AuthCredentials): Promise<void> {
    await api.post("/auth/login", payload);
}

export async function logoutUser(): Promise<void> {
    await api.post("/auth/logout");
}

export async function fetchCurrentUser(): Promise<AuthUserProfile> {
    const response = await api.get("/auth/me", {
        params: { _: Date.now() },
    });
    return response.data as AuthUserProfile;
}

export async function fetchTeams(): Promise<TeamSummary[]> {
    const response = await api.get("/api/teams", {
        params: { _: Date.now() },
    });
    return (response.data as TeamSummary[]) || [];
}

export async function createTeam(teamName: string): Promise<void> {
    await api.post("/api/teams", { teamName });
}

export async function fetchTeamDetails(teamName: string): Promise<TeamDetails> {
    const response = await api.get(`/api/teams/${encodeURIComponent(teamName)}`, {
        params: { _: Date.now() },
    });
    return response.data as TeamDetails;
}

export async function inviteTeamMember(teamName: string, usernameOrEmail: string): Promise<void> {
    await api.post(`/api/teams/${encodeURIComponent(teamName)}/members`, {
        usernameOrEmail,
    });
}

export async function deleteTeam(teamName: string): Promise<void> {
    await api.delete(`/api/teams/${encodeURIComponent(teamName)}`);
}

export async function leaveOrDeclineTeam(teamName: string): Promise<void> {
    await api.post(`/api/invitations/${encodeURIComponent(teamName)}/decline`);
}

export async function toggleTeamSharing(teamName: string, enabled: boolean): Promise<void> {
    await api.patch(`/api/teams/${encodeURIComponent(teamName)}/sharing`, {
        enabled,
    });
}

export async function fetchInvitations(): Promise<TeamInvitation[]> {
    const response = await api.get("/api/invitations", {
        params: { _: Date.now() },
    });
    return (response.data as TeamInvitation[]) || [];
}

export async function acceptInvitation(teamName: string): Promise<void> {
    await api.post(`/api/invitations/${encodeURIComponent(teamName)}/accept`);
}

export async function updateCurrentUserProfile(payload: ProfileUpdatePayload): Promise<void> {
    await api.patch("/auth/me", payload);
}

export async function fetchSshKeys(): Promise<SshKeyEntry[]> {
    const response = await api.get("/profile/ssh-keys", {
        params: { _: Date.now() },
    });
    return (response.data as SshKeyEntry[]) || [];
}

export async function addSshKey(label: string, publicKey: string): Promise<void> {
    await api.post("/profile/ssh-keys", {
        label,
        publicKey,
    });
}

export async function deleteSshKey(id: number): Promise<void> {
    await api.delete(`/profile/ssh-keys/${id}`);
}

export async function fetchActivities(): Promise<Activity[]> {
    const response = await api.get("/activities", {
        params: { _: Date.now() },
    });
    return response.data.activities || [];
}

export async function fetchPatches(): Promise<Patch[]> {
    const response = await api.get("/patches", {
        params: { _: Date.now() },
    });
    return response.data.patches || [];
}

export async function fetchFiles(): Promise<RepositoryFiles[]> {
    const response = await api.get("/files", {
        params: { _: Date.now() },
    });
    return response.data.repositories || [];
}
